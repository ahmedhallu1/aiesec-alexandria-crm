// =============================================================================
// CXP — THE DAILY DOCUMENT DIGEST
//
// WHAT THIS REPLACES. The old system never emailed per-document reminders —
// it created one Google Calendar event per (EP × requirement) and let Google's
// own notifications fire at 10:00 same-day and 14:00 the day before. That
// meant no branding was possible (Google composes the notification, not us)
// and a busy function could get a dozen separate pings a day with no single
// place to see them together.
//
// THE RECOMMENDED REPLACEMENT (product owner asked for "what is recommended"):
// ONE EMAIL PER FUNCTION PER DAY, listing every document whose reminder fires
// today. Not per-person: CXP EPs carry no "responsible member" field the way
// CRM accounts do — the SubTool has no such column, and inventing one here
// would be a bigger change than the digest itself. Per-function is the same
// audience the submission reminder already uses (that function's VP(s) + the
// CXP leadership of its side), so what used to be a dozen separate calendar
// pings becomes one grouped list.
//
// The calendar events THEMSELVES are untouched — this rides alongside them
// until the LC decides to retire the calendar side, a separate call.
// =============================================================================

import { computeDeadlinesForRecord, deadlineInputsOf } from "./deadlines";
import type { CxpEpRecord, CxpFunction } from "./types";

export interface DigestItem {
  function: CxpFunction;
  epOppId: string;
  epName: string;
  requirementKey: string;
  requirementName: string;
  dueDate: string | null;
  window: string | null;
  /** true when the due date has already passed today */
  overdue: boolean;
}

/**
 * The documents to mention TODAY, for one function.
 *
 * THE OLD CALENDAR EVENTS TOUCHED EACH DOCUMENT TWICE: a reminder override at
 * 1200 minutes before the event (= 14:00 the day before its due date/window)
 * and one at 0 minutes (= 10:00 on the day itself). This asks the same
 * two-part question — `reminderDate === today` (the advance nudge) OR
 * `dueDate === today` (the day-of one) — so a document gets exactly the two
 * touches it used to get, not one, and not a growing pile of "still missing"
 * repeats on every day after. Uploaded documents are excluded either way.
 */
export function digestItemsFor(
  records: CxpEpRecord[],
  statusMap: Record<string, { uploaded: boolean }>,
  fn: CxpFunction,
  today: string,
  now: Date = new Date()
): DigestItem[] {
  const out: DigestItem[] = [];
  for (const r of records.filter((r) => r.function === fn && !r.is_past_month)) {
    for (const d of computeDeadlinesForRecord(deadlineInputsOf(r), now)) {
      const isDueToday = d.dueDate === today;
      if (d.reminderDate !== today && !isDueToday) continue;
      const status = statusMap[`${r.ep_opp_id}|${r.stage_key}|${d.requirementKey}`];
      const uploaded = status ? status.uploaded : Boolean(r.sheet_flags?.[d.requirementKey]);
      if (uploaded) continue;
      out.push({
        function: fn,
        epOppId: r.ep_opp_id,
        epName: r.ep_name,
        requirementKey: d.requirementKey,
        requirementName: d.requirementName,
        dueDate: d.dueDate,
        window: d.windowStart && d.windowEnd ? `${d.windowStart} → ${d.windowEnd}` : null,
        // "due today" is the day-of touch — the urgent one. It is NOT a
        // continuously-tracked "overdue" state: a document whose reminder
        // window has passed unnoticed simply does not resurface here, same
        // as the old calendar events never re-fired either.
        overdue: isDueToday,
      });
    }
  }
  // stable ordering — the same (EP, stage, requirement) can appear at most
  // once, since computeDeadlinesForRecord never repeats a requirement key
  return out.sort((a, b) =>
    `${a.epName}|${a.requirementName}`.localeCompare(`${b.epName}|${b.requirementName}`)
  );
}
