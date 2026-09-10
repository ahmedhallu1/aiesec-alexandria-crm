import { notifyMembers } from "@/server/notify";
import { markCronRun } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { cairoToUtc } from "@/lib/time";
import { accountSlug, cairoToday, fmtClock12 } from "@/lib/types";
import { nextStepDue, nextStepKey } from "@/lib/next-step-reminder";
import { sendEmail } from "@/lib/google/gmail";
import {
  nextStepsDueEmail, visitFollowupEmail, visitForgottenEmail,
} from "@/lib/email/templates";

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
  /** B2C call-backs that came due and were nudged (v35.1) */
  callBacks: number;
  /** account next steps reminded on their day (v36.2) */
  nextSteps: number;
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
      if (to.length > 0) await sendEmail({ topic: "visit_followups", to, ...mail });
      await notifyMembers(
        [visit.member.id, ...(leader ? [leader.id] : [])],
        "followup",
        `How did the visit to ${visit.account.name} go? 📝`,
        "Report it from the account page — your leaders get notified automatically.",
        null,
        `/accounts/${visit.account.id}`,
        "visit_followups"
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
      if (to.length > 0) await sendEmail({ topic: "visit_followups", to, ...mail });
      await notifyMembers(
        [visit.member.id, ...(leader ? [leader.id] : [])],
        "followup",
        `⏰ ${visit.account.name} is still unreported`,
        "Log the visit result, or mark the account Out of Process if they're not interested.",
        null,
        `/accounts/${visit.account.id}`,
        "visit_followups"
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

  // B2C CALL-BACKS (v35.1) — "ring me at four" is an appointment the person
  // themselves asked for, and it was being kept in somebody's head. It rides
  // this tick rather than earning a cron of its own: the project is already at
  // its invocation ceiling (v34.7), so the time is a FLOOR, not an alarm — the
  // nudge lands at the next pass after it falls due.
  let callBacks = 0;
  try {
    callBacks = await runB2cCallBacks();
  } catch (e) {
    console.error("[cron] b2c call-backs failed:", e);
  }

  // NEXT STEPS (v36.2) — the same tick, for the same reason: the time is a
  // floor, and the nudge lands at the first pass after it (see
  // `lib/next-step-reminder.ts` for when that is).
  let nextSteps = 0;
  try {
    nextSteps = await runNextStepReminders();
  } catch (e) {
    console.error("[cron] next-step reminders failed:", e);
  }

  await markCronRun("visit-followups");
  return {
    checked: pending?.length ?? 0,
    sent,
    forgottenChecked: forgotten?.length ?? 0,
    nagged,
    bounces,
    callBacks,
    nextSteps,
  };
}

interface NextStepRow {
  id: string;
  name: string;
  next_step: string | null;
  next_step_date: string;
  next_step_time: string | null;
  next_step_reminded_key: string | null;
  responsible_id: string;
}

interface StepOwner {
  id: string;
  name: string;
  email: string | null;
  fallback_email: string | null;
  is_active: boolean;
}

/** REMIND EVERY RESPONSIBLE OF TODAY'S NEXT STEPS (v36.2).
 *
 *  The calendar event `syncNextStepReminder` writes only exists for members
 *  who connected Google — 44 of the 100 upcoming steps had no reminder at all.
 *  This one reaches everyone: one bell (which is also the phone push) and one
 *  email per person per pass, however many of their steps fell due together.
 *  Both respect the member's "Next-step reminders" switches. Stamped per
 *  account only AFTER delivery, so a failure retries on the next pass. */
async function runNextStepReminders(): Promise<number> {
  const today = cairoToday();
  const now = Date.now();
  const { data, error } = await db()
    .from("accounts")
    .select(
      "id, name, next_step, next_step_date, next_step_time, next_step_reminded_key, responsible_id"
    )
    .eq("next_step_date", today)
    .eq("out_of_process", false)
    .eq("is_test", false) // test accounts never trigger real reminders
    .not("responsible_id", "is", null)
    .limit(1000);
  if (error) throw new Error(error.message);

  const due = ((data ?? []) as NextStepRow[]).filter((a) => nextStepDue(a, today, now));
  if (due.length === 0) return 0;

  const byOwner = new Map<string, NextStepRow[]>();
  for (const a of due) byOwner.set(a.responsible_id, [...(byOwner.get(a.responsible_id) ?? []), a]);
  const { data: ownerRows } = await db()
    .from("members")
    .select("id, name, email, fallback_email, is_active")
    .in("id", [...byOwner.keys()]);

  let reminded = 0;
  for (const owner of (ownerRows ?? []) as StepOwner[]) {
    if (!owner.is_active) continue;
    const items = byOwner.get(owner.id) ?? [];
    if (items.length === 0) continue;
    const one = items[0];
    try {
      await notifyMembers(
        [owner.id],
        "followup",
        items.length === 1
          ? `⏰ Next step today — ${one.name}`
          : `⏰ ${items.length} next steps due today`,
        items.length === 1
          ? `${one.next_step || "Your planned next step"}${one.next_step_time ? ` · ${fmtClock12(one.next_step_time)}` : ""}`
          : `${items.slice(0, 4).map((a) => a.name).join(" · ")}${items.length > 4 ? ` · +${items.length - 4} more` : ""}`,
        null,
        items.length === 1 ? `/accounts/${accountSlug(one.name)}` : "/accounts",
        "next_steps"
      );
      const to = owner.email ?? owner.fallback_email;
      if (to) {
        const mail = nextStepsDueEmail({
          firstName: owner.name.split(" ")[0] || owner.name,
          items: items.map((a) => ({
            accountName: a.name,
            step: a.next_step,
            time: a.next_step_time,
            url: `${env.appUrl}/accounts/${accountSlug(a.name)}`,
          })),
        });
        await sendEmail({ topic: "next_steps", to: [to], ...mail });
      }
      for (const a of items) {
        await db()
          .from("accounts")
          .update({ next_step_reminded_key: nextStepKey(a.next_step_date, a.next_step_time) })
          .eq("id", a.id);
      }
      reminded += items.length;
    } catch (e) {
      console.error(`[cron] next-step reminder for ${owner.id} failed:`, e);
    }
  }
  return reminded;
}

interface CallBackRow {
  id: string;
  signup_id: string;
  caller_id: string | null;
  caller_name: string;
  call_back_at: string;
  signup: { name: string; phone: string | null } | null;
}

/** Nudge the B2C caller when a call-back they promised comes due.
 *
 *  The bell is the delivery — it reaches the phone too since v35 — and it
 *  deep-links to the CIC queue. Stamped once so a call-back that stays open
 *  does not nag every pass; the caller resolves it by recording the next
 *  outcome, which clears the appointment. */
async function runB2cCallBacks(): Promise<number> {
  const { data } = await db()
    .from("signup_cic_calls")
    .select("id, signup_id, caller_id, caller_name, call_back_at, signup:signups(name, phone)")
    .eq("side", "B2C")
    .eq("outcome", "call_back")
    .is("call_back_reminded_at", null)
    .lte("call_back_at", new Date().toISOString())
    .limit(200);
  const rows = (data ?? []) as unknown as CallBackRow[];
  let nudged = 0;
  for (const row of rows) {
    if (!row.caller_id) continue;
    const who = row.signup?.name ?? "someone";
    try {
      await notifyMembers(
        [row.caller_id],
        "followup",
        `⏰ Call ${who} back`,
        `You said you'd ring ${who} around now${row.signup?.phone ? ` — ${row.signup.phone}` : ""}.`,
        null,
        "/signups?view=cic&cicMine=1",
        "cic_calls"
      );
      // stamped only AFTER the nudge is actually out, so a failure retries on
      // the next pass instead of going silent (the v34.1 Podio-digest lesson)
      await db()
        .from("signup_cic_calls")
        .update({ call_back_reminded_at: new Date().toISOString() })
        .eq("id", row.id);
      nudged++;
    } catch (e) {
      console.error(`[cron] call-back nudge ${row.id} failed:`, e);
    }
  }
  return nudged;
}
