import "server-only";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { cxpDocumentDigestEmail } from "@/lib/email/cxp-templates";
import { routeForFunction, type RecipientMember } from "@/lib/cxp/recipients";
import { cxpToday } from "@/lib/cxp/deadlines";
import { digestItemsFor } from "@/lib/cxp/digest";
import { resolveEmailMode, loadStatusMap, type EmailMode } from "./cxp-reminders";
import { CXP_FUNCTIONS, type CxpEpRecord, type CxpFunction } from "@/lib/cxp/types";

/**
 * THE DAILY DOCUMENT DIGEST — the branded replacement for the old system's
 * per-document Google Calendar notifications. See lib/cxp/digest.ts for why
 * it is per-function rather than per-person.
 *
 * Rides the SAME cutover gate as the submission reminder (`resolveEmailMode`):
 * before 1 September it resolves everything and sends nothing, so switching
 * this on today does not add a second stream of mail on top of the old
 * calendar pings before the LC is ready for it.
 */

export interface DigestOutcome {
  function: CxpFunction;
  itemCount: number;
  recipients: string[];
  missingRecipients: string[];
  status: "sent" | "blocked" | "dry-run" | "failed" | "skipped";
  reason?: string;
}

export interface DigestRun {
  today: string;
  mode: EmailMode;
  heldBack: boolean;
  results: DigestOutcome[];
}

export async function runDailyDigest(
  opts: { only?: CxpFunction | null; force?: boolean } = {}
): Promise<DigestRun> {
  const today = cxpToday();
  const resolved = resolveEmailMode(today);
  const mode = resolved.mode;

  const [{ data: members }, { data: records }, statusMap] = await Promise.all([
    db()
      .from("members")
      .select("id, name, email, role, functions, sub_functions, is_active")
      .eq("is_active", true),
    db().from("cxp_ep_records").select("*").eq("is_past_month", false),
    loadStatusMap(),
  ]);
  const allRecords = (records ?? []) as CxpEpRecord[];
  const targets = opts.only ? [opts.only] : CXP_FUNCTIONS;
  const results: DigestOutcome[] = [];

  for (const fn of targets) {
    const items = digestItemsFor(allRecords, statusMap, fn, today);

    // NOTHING DUE, NOTHING SENT — a digest that always arrives empty stops
    // being read, same reasoning as the submission reminder.
    if (items.length === 0) {
      results.push({
        function: fn,
        itemCount: 0,
        recipients: [],
        missingRecipients: [],
        status: "skipped",
        reason: "Nothing due today.",
      });
      continue;
    }

    const routing = routeForFunction((members ?? []) as RecipientMember[], fn);
    const to = routing.recipients.map((r) => r.email);
    const reminderKey = `${fn}|${today}|digest`;

    const { data: already } = await db()
      .from("cxp_email_log")
      .select("id")
      .eq("reminder_key", reminderKey)
      .eq("status", "sent")
      .maybeSingle();
    if (already && !opts.force) {
      results.push({
        function: fn,
        itemCount: items.length,
        recipients: to,
        missingRecipients: [],
        status: "skipped",
        reason: "Already sent today.",
      });
      continue;
    }

    const { subject, html } = cxpDocumentDigestEmail({
      functionLabel: fn,
      audienceLabel: `${fn} team`,
      items: items.map((i) => ({
        function: i.function,
        epName: i.epName,
        epOppId: i.epOppId,
        requirementName: i.requirementName,
        dueDate: i.dueDate,
        window: i.window,
        overdue: i.overdue,
      })),
      epUrlFor: (id) => `${env.appUrl}/cxp/ep/${encodeURIComponent(id)}`,
    });

    let status: DigestOutcome["status"] = "dry-run";
    let reason: string | undefined;

    if (mode === "dry-run") {
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
        deadline_date: today,
        reminder_type: "digest",
        recipients: to,
        missing_recipients: routing.missingRecipients.map((m) => m.name),
        ep_count: items.length,
        status,
        reason,
        mode,
      })
      .then(undefined, () => {});

    results.push({
      function: fn,
      itemCount: items.length,
      recipients: to,
      missingRecipients: routing.missingRecipients.map((m) => m.name),
      status,
      reason,
    });
  }

  return { today, mode, heldBack: resolved.heldBack, results };
}
