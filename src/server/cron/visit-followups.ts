import { notifyMembers } from "@/server/notify";
import { markCronRun } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { cairoToUtc } from "@/lib/time";
import { sendEmail } from "@/lib/google/gmail";
import { visitFollowupEmail, visitForgottenEmail } from "@/lib/email/templates";

/** THE VISIT REMINDER JOB, LIFTED OUT OF ITS ROUTE (v33.46).
 *
 *  This used to live inside the Vercel route handler, which meant the only
 *  way to run it was to spend Vercel CPU — every 15 minutes, all night, for a
 *  job that is usually a no-op at 3 AM. The logic is unchanged; it just lives
 *  somewhere both the route and the GitHub Actions runner can call, the same
 *  arrangement `scripts/run-import.mjs` already uses for the sheet imports.
 *  One implementation, two triggers. */

interface VisitRow {
  id: string;
  visit_date: string;
  visit_time: string;
  next_step: string | null;
  followup_prompt_sent_at: string | null;
  account: { id: string; name: string; out_of_process: boolean } | null;
  member: {
    id: string;
    name: string;
    email: string | null;
    /** the personal Gmail (v33.29) — many members have no @aiesec.net yet */
    fallback_email: string | null;
    role: string;
    stakeholder_id: string | null;
  } | null;
}

interface Leader {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export interface VisitFollowupResult {
  checked: number;
  sent: number;
  forgottenChecked: number;
  nagged: number;
  bounces: { checked: number; flagged: number };
}

/** Reminders go to the responsible member AND their team leader (manager)
 *  when the responsible is a Member/Coordinator; anyone Team Leader or above
 *  handles their own accounts, so they get it alone. The LCP never receives
 *  operational email. */
async function resolveLeader(member: VisitRow["member"]): Promise<Leader | null> {
  if (!member?.stakeholder_id) return null;
  if (member.role !== "Member" && member.role !== "Coordinator") return null;
  const { data } = await db()
    .from("members")
    .select("id, name, email, role, is_active")
    .eq("id", member.stakeholder_id)
    .maybeSingle();
  const leader = data as Leader | null;
  if (!leader || !leader.is_active || !leader.email || leader.role === "LCP") return null;
  return leader;
}

const VISIT_SELECT =
  "id, visit_date, visit_time, next_step, followup_prompt_sent_at, " +
  "account:accounts!inner(id, name, out_of_process, is_test), " +
  "member:members(id, name, email, fallback_email, role, stakeholder_id)";

/** Two passes:
 *  1. Exactly 2 hours after a visit's scheduled time → "was it completed?"
 *     prompt with the visit details, to the responsible (+ their TL).
 *  2. One week after that prompt with STILL no report → a firmer "you forgot
 *     about it" email to the same people: report the result, or mark the
 *     account Out of Process if the company isn't interested — so no
 *     resources sit wasted and the pipeline stays organized.
 *
 *  Throws only on a failed READ; a single member's email failing is logged
 *  and stepped over, because one bad address must not stop the other 39. */
export async function runVisitFollowups(): Promise<VisitFollowupResult> {
  const now = Date.now();
  let sent = 0;
  let nagged = 0;

  // ---------------------------------------------- pass 1: +2h report prompt
  const { data: pending, error } = await db()
    .from("visits")
    .select(VISIT_SELECT)
    .eq("account.is_test", false) // test visits never trigger real reminders
    .is("done", null)
    .is("followup_prompt_sent_at", null)
    .limit(50);
  if (error) throw new Error(error.message);

  const twoHours = 2 * 60 * 60 * 1000;
  for (const visit of (pending ?? []) as unknown as VisitRow[]) {
    // NO INBOX IS NOT A REASON TO SAY NOTHING (v33.36.2). This used to skip
    // the whole reminder when the member had no @aiesec.net — no email, no
    // BELL, and no stamp, so the week-later nag could never fire either and
    // the visit went unchased forever. Many members are still waiting for
    // their AIESEC address; they get the backup Gmail if they saved one, and
    // the in-app notification either way.
    if (!visit.account || visit.account.out_of_process || !visit.member) continue;
    const visitAt = cairoToUtc(visit.visit_date, visit.visit_time).getTime();
    if (now < visitAt + twoHours) continue;

    const leader = await resolveLeader(visit.member);
    const mail = visitFollowupEmail({
      memberFirstName: visit.member.name.split(" ")[0],
      responsibleName: visit.member.name,
      accountName: visit.account.name,
      visitDate: visit.visit_date,
      visitTime: visit.visit_time,
      nextStep: visit.next_step,
      leaderName: leader ? leader.name.split(" ")[0] : null,
      reportUrl: `${env.appUrl}/accounts/${visit.account.id}?report=${visit.id}`,
    });
    try {
      const to = [
        visit.member.email ?? visit.member.fallback_email,
        ...(leader ? [leader.email] : []),
      ].filter((e): e is string => !!e);
      if (to.length > 0) await sendEmail({ to, ...mail });
      await notifyMembers(
        [visit.member.id, ...(leader ? [leader.id] : [])],
        "followup",
        `How did the visit to ${visit.account.name} go? 📝`,
        "Report it from the account page — your leaders get notified automatically.",
        null,
        `/accounts/${visit.account.id}`
      );
      await db()
        .from("visits")
        .update({ followup_prompt_sent_at: new Date().toISOString() })
        .eq("id", visit.id);
      sent += 1;
    } catch (e) {
      console.error(`[cron] follow-up for visit ${visit.id} failed:`, e);
    }
  }

  // ------------------------------------- pass 2: +1 week "you forgot" nudge
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: forgotten } = await db()
    .from("visits")
    .select(VISIT_SELECT)
    .eq("account.is_test", false) // test visits never trigger real reminders
    .is("done", null)
    .is("forgotten_nag_sent_at", null)
    .not("followup_prompt_sent_at", "is", null)
    .lte("followup_prompt_sent_at", weekAgo)
    .limit(50);

  for (const visit of (forgotten ?? []) as unknown as VisitRow[]) {
    if (!visit.account || visit.account.out_of_process || !visit.member) continue;

    const leader = await resolveLeader(visit.member);
    const mail = visitForgottenEmail({
      memberFirstName: visit.member.name.split(" ")[0],
      responsibleName: visit.member.name,
      accountName: visit.account.name,
      visitDate: visit.visit_date,
      visitTime: visit.visit_time,
      leaderName: leader ? leader.name.split(" ")[0] : null,
      reportUrl: `${env.appUrl}/accounts/${visit.account.id}?report=${visit.id}`,
    });
    try {
      const to = [
        visit.member.email ?? visit.member.fallback_email,
        ...(leader ? [leader.email] : []),
      ].filter((e): e is string => !!e);
      if (to.length > 0) await sendEmail({ to, ...mail });
      await notifyMembers(
        [visit.member.id, ...(leader ? [leader.id] : [])],
        "followup",
        `⏰ ${visit.account.name} is still unreported`,
        "Log the visit result, or mark the account Out of Process if they're not interested.",
        null,
        `/accounts/${visit.account.id}`
      );
      await db()
        .from("visits")
        .update({ forgotten_nag_sent_at: new Date().toISOString() })
        .eq("id", visit.id);
      nagged += 1;
    } catch (e) {
      console.error(`[cron] forgotten-nag for visit ${visit.id} failed:`, e);
    }
  }

  // IR EMAIL BOUNCES (v33.29 part 2) — ride the 15-minute tick: scan the IM
  // mailbox for mailer-daemon reports and flag scheduled calls whose invite
  // bounced. Best-effort; a Gmail hiccup never fails the visit reminders.
  let bounces: { checked: number; flagged: number } = { checked: 0, flagged: 0 };
  try {
    const { checkIrEmailBounces } = await import("@/server/bounces");
    bounces = await checkIrEmailBounces();
  } catch (e) {
    console.error("[cron] bounce watch failed:", e);
  }

  await markCronRun("visit-followups");
  return {
    checked: pending?.length ?? 0,
    sent,
    forgottenChecked: forgotten?.length ?? 0,
    nagged,
    bounces,
  };
}
