import "server-only";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { cxpSubmissionReminderEmail } from "@/lib/email/cxp-templates";
import { routeForFunction, type RecipientMember } from "@/lib/cxp/recipients";
import { cxpToday, deadlineOneDayAfter, previousWeeklyDeadline } from "@/lib/cxp/deadlines";
import { selectWeeklyEps } from "@/lib/cxp/weekly";
import { CXP_FUNCTIONS, type CxpEpRecord, type CxpFunction } from "@/lib/cxp/types";

/**
 * THE WEEKLY SUBMISSION REMINDER.
 *
 * The one job the LC actually depends on today, ported with its behaviour
 * deliberately unchanged:
 *
 *   · runs daily, but SENDS NOTHING unless tomorrow is an ECB deadline
 *     (the 6th / 13th / 20th / 27th) — so it fires on the 5th, 12th, 19th, 26th
 *   · ONE email per function, never per person
 *   · recipients = that function's VP(s) + the CXP leadership of its side
 *   · idempotent: a `sent` row in cxp_email_log blocks a second send
 *
 * WHAT CHANGED: the letter's clothes, and only those. Same subject line, same
 * roster table, same trigger, same audience.
 *
 * THE THREE MODES are carried over verbatim, including the default. An unset
 * CXP_EMAIL_MODE means **dry-run** — resolve everything, send nothing, log
 * what would have happened. That default is why a first deploy cannot mail
 * real VPs by accident, and it should stay that way until the cutover.
 */

export type EmailMode = "dry-run" | "beta" | "production";

/** THE EMAIL CUTOVER DATE (set by the CXP directors: 1 September 2026).
 *
 *  The module went live in August, but the OLD auditing system kept sending
 *  the submission reminders — so until this date the new one must resolve
 *  everything and send NOTHING, or every VP gets two emails per deadline.
 *
 *  A DATE, NOT A CHECKLIST ITEM. Flipping an env var on the right morning is
 *  the kind of thing that gets forgotten or done a day early, so the switch is
 *  in the code where it can be tested. `CXP_EMAIL_GO_LIVE` overrides it, which
 *  is how the date is moved (or how a test pins it) without a deploy.
 *
 *  The ECB deadlines are the 6th, 13th, 20th and 27th, and a reminder goes out
 *  the day before. So the last deadline before the cutover is 27 Aug (mailed
 *  the 26th, by the old system) and the first after it is 6 Sep (mailed the
 *  5th, by this one). The handover falls in the gap between two cycles — no
 *  deadline is covered twice, and none is missed. */
export const CXP_EMAIL_GO_LIVE_DEFAULT = "2026-09-01";

export function emailGoLiveDate(): string {
  const raw = (process.env.CXP_EMAIL_GO_LIVE ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : CXP_EMAIL_GO_LIVE_DEFAULT;
}

/** What CXP_EMAIL_MODE asks for, before the date gate is applied. */
export function configuredEmailMode(): EmailMode {
  const raw = (process.env.CXP_EMAIL_MODE ?? "").toLowerCase();
  return raw === "production" || raw === "beta" ? raw : "dry-run";
}

export interface ResolvedMode {
  mode: EmailMode;
  /** what the env asked for, when the gate overrode it */
  configured: EmailMode;
  /** true while we are before the cutover date */
  heldBack: boolean;
  goLive: string;
  reason?: string;
}

/** THE ONE PLACE THAT DECIDES WHETHER MAIL LEAVES THE BUILDING.
 *
 *  Before the cutover the answer is dry-run no matter what the env says — a
 *  mis-set variable cannot start mailing people early. On or after it, the env
 *  decides as normal, so `production` set today simply starts working on the
 *  1st with nobody touching anything. */
export function resolveEmailMode(today: string = cxpToday()): ResolvedMode {
  const configured = configuredEmailMode();
  const goLive = emailGoLiveDate();
  if (today < goLive) {
    return {
      mode: "dry-run",
      configured,
      heldBack: true,
      goLive,
      reason:
        `Held back until the ${goLive} cutover — the standalone auditing system ` +
        `still owns these reminders, so nothing is sent from here yet.`,
    };
  }
  return { mode: configured, configured, heldBack: false, goLive };
}

/** Back-compat alias for the resolved mode. */
export function emailMode(): EmailMode {
  return resolveEmailMode().mode;
}

export interface ReminderOutcome {
  function: CxpFunction;
  deadline: string;
  recipients: string[];
  missingRecipients: string[];
  epCount: number;
  missingCount: number;
  status: "sent" | "blocked" | "dry-run" | "failed" | "skipped";
  reason?: string;
}

export interface ReminderRun {
  ran: boolean;
  deadline: string | null;
  mode: EmailMode;
  /** what CXP_EMAIL_MODE asks for — differs from `mode` while held back */
  configuredMode: EmailMode;
  /** true while we are before the cutover date */
  heldBack: boolean;
  goLive: string;
  results: ReminderOutcome[];
  message: string;
}

/** Run the reminder job. `force` bypasses the deadline gate (for a manual
 *  send); `only` narrows to one function; `dryRun` overrides the mode. */
export async function runWeeklyReminders(opts: {
  force?: boolean;
  deadline?: string | null;
  only?: CxpFunction | null;
  dryRun?: boolean;
} = {}): Promise<ReminderRun> {
  const today = cxpToday();
  const resolved = resolveEmailMode(today);
  // an explicit ?dry=1 can only ever make it SAFER, never the reverse
  const mode: EmailMode = opts.dryRun ? "dry-run" : resolved.mode;

  // THE GATE. Without it this would mail four VPs every single morning.
  const gate = opts.deadline
    ? { date: opts.deadline }
    : deadlineOneDayAfter(today);
  if (!gate && !opts.force) {
    return {
      ran: false,
      deadline: null,
      mode,
      configuredMode: resolved.configured,
      heldBack: resolved.heldBack,
      goLive: resolved.goLive,
      results: [],
      message: "No ECB deadline tomorrow — nothing to send.",
    };
  }
  const deadline = gate?.date ?? today;

  const targets = opts.only ? [opts.only] : CXP_FUNCTIONS;

  const [{ data: members }, { data: records }] = await Promise.all([
    db()
      .from("members")
      .select("id, name, email, role, functions, sub_functions, is_active")
      .eq("is_active", true),
    db().from("cxp_ep_records").select("*").eq("is_past_month", false),
  ]);

  const statusMap = await loadStatusMap();
  const allRecords = (records ?? []) as CxpEpRecord[];
  const results: ReminderOutcome[] = [];

  for (const fn of targets) {
    const eps = selectWeeklyEps(allRecords, statusMap, fn, deadline);
    const missingCount = eps.reduce((n, e) => n + e.missingCount, 0);
    const routing = routeForFunction((members ?? []) as RecipientMember[], fn);
    const to = routing.recipients.map((r) => r.email);
    const reminderKey = `${fn}|${deadline}|weekly`;

    // NOTHING OWED, NOTHING SENT. The old system mailed a roster even when it
    // was all green; an email that never carries news stops being read.
    if (eps.length === 0) {
      results.push({
        function: fn,
        deadline,
        recipients: to,
        missingRecipients: routing.missingRecipients.map((m) => m.name),
        epCount: 0,
        missingCount: 0,
        status: "skipped",
        reason: "No EPs owe anything at this deadline.",
      });
      continue;
    }

    // idempotency: already sent for this function + deadline
    const { data: already } = await db()
      .from("cxp_email_log")
      .select("id")
      .eq("reminder_key", reminderKey)
      .eq("status", "sent")
      .maybeSingle();
    if (already && !opts.force) {
      results.push({
        function: fn,
        deadline,
        recipients: to,
        missingRecipients: [],
        epCount: eps.length,
        missingCount,
        status: "skipped",
        reason: "Already sent for this deadline.",
      });
      continue;
    }

    const { subject, html } = cxpSubmissionReminderEmail({
      function: fn,
      deadlineDate: deadline,
      epList: eps.map((e) => ({
        epName: e.epName,
        epOppId: e.epOppId,
        missing: e.missingCount,
        overdue: e.items.filter((i) => i.bucket === "overdue").length,
      })),
      weeklyUrl: `${env.appUrl}/cxp/weekly?deadline=${deadline}`,
    });

    let status: ReminderOutcome["status"] = "dry-run";
    let reason: string | undefined;

    if (mode === "dry-run") {
      // say WHY: "held back until the cutover" and "someone set dry-run" are
      // very different situations to read in a log three weeks from now
      reason = resolved.heldBack
        ? resolved.reason
        : "CXP_EMAIL_MODE=dry-run — resolved recipients, sent nothing.";
    } else if (to.length === 0) {
      status = "blocked";
      reason = `No valid recipients for ${fn}. ${
        routing.missingRecipients.length > 0
          ? `Matched but unreachable: ${routing.missingRecipients.map((m) => m.name).join(", ")}.`
          : "Nobody on the membership sheet matches the rule."
      }`;
    } else {
      try {
        await sendEmail({ topic: "cxp", to, subject, html });
        status = "sent";
      } catch (err) {
        status = "failed";
        reason = err instanceof Error ? err.message : String(err);
      }
    }

    await db()
      .from("cxp_email_log")
      .insert({
        reminder_key: reminderKey,
        function: fn,
        deadline_date: deadline,
        reminder_type: "weekly",
        recipients: to,
        missing_recipients: routing.missingRecipients.map((m) => m.name),
        ep_count: eps.length,
        status,
        reason,
        mode,
      })
      // a logging failure must never break a send that already happened —
      // but it must be SAID (v37.14): this row is the only thing stopping the
      // next run from sending the same email again. supabase-js resolves with
      // an error rather than rejecting, so the old `.then(undefined, …)` never
      // saw one. A forced resend colliding with the first `sent` row (23505)
      // is expected.
      .then(({ error }) => {
        if (error && error.code !== "23505")
          console.error(`[cxp-reminders] email log write failed — the next run may resend:`, error.message);
      }, (e) => console.error("[cxp-reminders] email log write failed:", e));

    results.push({
      function: fn,
      deadline,
      recipients: to,
      missingRecipients: routing.missingRecipients.map((m) => m.name),
      epCount: eps.length,
      missingCount,
      status,
      reason,
    });
  }

  // THE SNAPSHOT. Written on every run, before anything is gated, so the
  // per-week history exists even when no mail goes out — this is what the
  // weekly board reads back for past weeks.
  await writeWeeklySnapshot(allRecords, statusMap, targets, deadline);

  return {
    ran: true,
    deadline,
    mode,
    configuredMode: resolved.configured,
    heldBack: resolved.heldBack,
    goLive: resolved.goLive,
    results,
    message: resolved.heldBack
      ? `Reminder run for ${deadline} — held back until ${resolved.goLive}; nothing sent.`
      : `Reminder run for ${deadline} (mode=${mode}).`,
  };
}

/** Shared with cxp-digest.ts — one query, not two copies of it. */
export async function loadStatusMap(): Promise<Record<string, { uploaded: boolean }>> {
  const { data } = await db()
    .from("cxp_requirement_status")
    .select("ep_opp_id, stage_key, requirement_key, uploaded");
  const map: Record<string, { uploaded: boolean }> = {};
  for (const s of data ?? []) {
    map[`${s.ep_opp_id}|${s.stage_key}|${s.requirement_key}`] = { uploaded: s.uploaded };
  }
  return map;
}

/** Record what is outstanding at this deadline, marking anything that was
 *  ALSO outstanding at the previous one as a carry-over. */
async function writeWeeklySnapshot(
  records: CxpEpRecord[],
  statusMap: Record<string, { uploaded: boolean }>,
  fns: CxpFunction[],
  deadline: string
): Promise<void> {
  const prev = previousWeeklyDeadline(deadline);
  const { data: previousRows } = await db()
    .from("cxp_weekly_missing")
    .select("function, ep_opp_id, stage_key, requirement_key")
    .eq("deadline_date", prev);
  const carried = new Set(
    (previousRows ?? []).map(
      (r) => `${r.function}|${r.ep_opp_id}|${r.stage_key}|${r.requirement_key}`
    )
  );

  const now = new Date().toISOString();
  const payload = fns.flatMap((fn) =>
    selectWeeklyEps(records, statusMap, fn, deadline).flatMap((ep) =>
      ep.items.map((i) => ({
        function: fn,
        deadline_date: deadline,
        ep_opp_id: i.epOppId,
        ep_name: i.epName,
        stage_key: i.stageKey,
        requirement_key: i.requirementKey,
        requirement_name: i.requirementName,
        uploaded: false,
        origin: carried.has(`${fn}|${i.epOppId}|${i.stageKey}|${i.requirementKey}`)
          ? ("carry-over" as const)
          : ("current" as const),
        updated_at: now,
      }))
    )
  );

  for (let i = 0; i < payload.length; i += 250) {
    await db()
      .from("cxp_weekly_missing")
      .upsert(payload.slice(i, i + 250), {
        onConflict: "function,deadline_date,ep_opp_id,stage_key,requirement_key",
      })
      .then(({ error }) => {
        // the weekly board reads these rows — a failed write is a stale board,
        // so it is logged (v37.14), never thrown (the email already went)
        if (error) console.error("[cxp-reminders] weekly-missing write failed:", error.message);
      }, (e) => console.error("[cxp-reminders] weekly-missing write failed:", e));
  }
}
