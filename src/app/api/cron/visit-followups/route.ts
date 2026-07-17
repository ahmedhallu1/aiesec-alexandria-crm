import { NextRequest, NextResponse } from "next/server";
import { notifyMembers } from "@/server/notify";
import { markCronRun } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { cairoToUtc } from "@/lib/time";
import { sendEmail } from "@/lib/google/gmail";
import { visitFollowupEmail, visitForgottenEmail } from "@/lib/email/templates";

export const dynamic = "force-dynamic";

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
    nickname: string | null;
    email: string;
    role: string;
    stakeholder_id: string | null;
  } | null;
}

interface Leader {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  role: string;
  is_active: boolean;
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
    .select("id, name, nickname, email, role, is_active")
    .eq("id", member.stakeholder_id)
    .maybeSingle();
  const leader = data as Leader | null;
  if (!leader || !leader.is_active || !leader.email || leader.role === "LCP") return null;
  return leader;
}

const VISIT_SELECT =
  "id, visit_date, visit_time, next_step, followup_prompt_sent_at, " +
  "account:accounts(id, name, out_of_process), " +
  "member:members(id, name, nickname, email, role, stakeholder_id)";

/** Runs every 15 min (Supabase pg_cron). Two passes:
 *  1. Exactly 2 hours after a visit's scheduled time → "was it completed?"
 *     prompt with the visit details, to the responsible (+ their TL).
 *  2. One week after that prompt with STILL no report → a firmer "you forgot
 *     about it" email to the same people: report the result, or mark the
 *     account Out of Process if the company isn't interested — so no
 *     resources sit wasted and the pipeline stays organized. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  let sent = 0;
  let nagged = 0;

  // ---------------------------------------------- pass 1: +2h report prompt
  const { data: pending, error } = await db()
    .from("visits")
    .select(VISIT_SELECT)
    .is("done", null)
    .is("followup_prompt_sent_at", null)
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const twoHours = 2 * 60 * 60 * 1000;
  for (const visit of (pending ?? []) as unknown as VisitRow[]) {
    if (!visit.account || visit.account.out_of_process || !visit.member?.email) continue;
    const visitAt = cairoToUtc(visit.visit_date, visit.visit_time).getTime();
    if (now < visitAt + twoHours) continue;

    const leader = await resolveLeader(visit.member);
    const mail = visitFollowupEmail({
      memberFirstName: visit.member.nickname || visit.member.name.split(" ")[0],
      responsibleName: visit.member.nickname || visit.member.name,
      accountName: visit.account.name,
      visitDate: visit.visit_date,
      visitTime: visit.visit_time,
      nextStep: visit.next_step,
      leaderName: leader ? leader.nickname || leader.name.split(" ")[0] : null,
      reportUrl: `${env.appUrl}/accounts/${visit.account.id}?report=${visit.id}`,
    });
    try {
      const to = [visit.member.email, ...(leader ? [leader.email] : [])];
      await sendEmail({ to, ...mail });
      await notifyMembers(
        [visit.member.id, ...(leader ? [leader.id] : [])],
        "followup",
        `How did the visit to ${visit.account.name} go? 📝`,
        "Report it from the account page — your leaders get notified automatically."
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
    .is("done", null)
    .is("forgotten_nag_sent_at", null)
    .not("followup_prompt_sent_at", "is", null)
    .lte("followup_prompt_sent_at", weekAgo)
    .limit(50);

  for (const visit of (forgotten ?? []) as unknown as VisitRow[]) {
    if (!visit.account || visit.account.out_of_process || !visit.member?.email) continue;

    const leader = await resolveLeader(visit.member);
    const mail = visitForgottenEmail({
      memberFirstName: visit.member.nickname || visit.member.name.split(" ")[0],
      responsibleName: visit.member.nickname || visit.member.name,
      accountName: visit.account.name,
      visitDate: visit.visit_date,
      visitTime: visit.visit_time,
      leaderName: leader ? leader.nickname || leader.name.split(" ")[0] : null,
      reportUrl: `${env.appUrl}/accounts/${visit.account.id}?report=${visit.id}`,
    });
    try {
      const to = [visit.member.email, ...(leader ? [leader.email] : [])];
      await sendEmail({ to, ...mail });
      await notifyMembers(
        [visit.member.id, ...(leader ? [leader.id] : [])],
        "followup",
        `⏰ ${visit.account.name} is still unreported`,
        "Log the visit result, or mark the account Out of Process if they're not interested."
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

  await markCronRun("visit-followups");
  return NextResponse.json({
    checked: pending?.length ?? 0,
    sent,
    forgottenChecked: forgotten?.length ?? 0,
    nagged,
  });
}
