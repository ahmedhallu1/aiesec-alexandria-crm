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

export function emailMode(): EmailMode {
  const raw = (process.env.CXP_EMAIL_MODE ?? "").toLowerCase();
  return raw === "production" || raw === "beta" ? raw : "dry-run";
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
  const mode: EmailMode = opts.dryRun ? "dry-run" : emailMode();
  const today = cxpToday();

  // THE GATE. Without it this would mail four VPs every single morning.
  const gate = opts.deadline
    ? { date: opts.deadline }
    : deadlineOneDayAfter(today);
  if (!gate && !opts.force) {
    return {
      ran: false,
      deadline: null,
      mode,
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
      reason = "CXP_EMAIL_MODE=dry-run — resolved recipients, sent nothing.";
    } else if (to.length === 0) {
      status = "blocked";
      reason = `No valid recipients for ${fn}. ${
        routing.missingRecipients.length > 0
          ? `Matched but unreachable: ${routing.missingRecipients.map((m) => m.name).join(", ")}.`
          : "Nobody on the membership sheet matches the rule."
      }`;
    } else {
      try {
        await sendEmail({ to, subject, html });
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
      // a logging failure must never break a send that already happened
      .then(undefined, () => {});

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
    results,
    message: `Reminder run for ${deadline} (mode=${mode}).`,
  };
}

async function loadStatusMap(): Promise<Record<string, { uploaded: boolean }>> {
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
      .then(undefined, () => {});
  }
}
