// =============================================================================
// CXP — DEADLINES & TIMELINE ENGINE
//
// The ECB date rules, migrated from the standalone auditing system:
//   Before arrival    = arrival - 10..15 days (window)
//   24h after arrival = arrival + 24h
//   GV mid duration   = startDate + round(duration / 2)
//   Last week         = endDate - 7 days
//   GT monthly        = first 5 days of each month
//   PGS / LDA         = approval + 14 days
//   Flight / Health   = travel - 20 days
//   OPS               = travel - 7 days
//   IPS               = arrival + 36h
//   Entry stamp       = arrival + 3 days
// Reminders fire ONE DAY BEFORE the action / window start.
//
// ONE DELIBERATE CHANGE FROM THE OLD APP: every calculation is UTC-anchored
// yyyy-MM-dd arithmetic instead of `new Date(y, m, d)` local-time arithmetic.
// The old code was correct on a machine set to Africa/Cairo and off by a day
// on Vercel (UTC) for any date near a DST boundary. The FORMULAS are
// unchanged — only the clock they are evaluated against is now explicit.
// =============================================================================

import { requirementsForStage } from "./requirements";
import type {
  CxpComputedDeadline,
  CxpDeadlineRule,
  CxpEpRecord,
  CxpFunction,
  CxpRequirementDef,
  CxpStageKey,
  CxpWeeklyDeadline,
} from "./types";

/** The ECB submits on the 6th / 13th / 20th / 27th — the day before each of
 *  its audit days (7-8, 14-15, 21-22, 28-29). */
export const WEEKLY_DEADLINE_DAYS: (6 | 13 | 20 | 27)[] = [6, 13, 20, 27];

/** Reminders go out one day before. */
export const REMINDER_OFFSET_DAYS = 1;

const DAY_MS = 86_400_000;

// ------------------------------------------------------------- date plumbing

/** Cairo "today" as yyyy-MM-dd — the LC's clock, not the server's. */
export function cxpToday(now: Date = new Date()): string {
  const c = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  return iso(c.getFullYear(), c.getMonth() + 1, c.getDate());
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse a sheet date into yyyy-MM-dd, or null.
 *
 *  Accepts an ISO prefix directly. Anything else goes through `Date`, which is
 *  what the old parser did — the SubTool stores locale-formatted strings and
 *  the sync layer is responsible for normalising them before they land here. */
export function toIsoDate(s?: string | null): string | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** yyyy-MM-dd -> epoch ms at UTC midnight. */
function ms(day: string): number {
  return new Date(`${day}T00:00:00Z`).getTime();
}

/** epoch ms -> yyyy-MM-dd (UTC). */
function day(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return day(ms(d) + n * DAY_MS);
}

export function diffDays(a: string, b: string): number {
  return Math.round((ms(a) - ms(b)) / DAY_MS);
}

// --------------------------------------------------------------- the engine

interface DeadlineInputs {
  epOppId: string;
  function: CxpFunction;
  stageKey: CxpStageKey;
  approvalDate: string | null;
  startDate: string | null;
  endDate: string | null;
  arrivalDate: string | null;
  product: string;
}

/** The subset of an EP record the engine actually reads. Accepting this shape
 *  rather than the full row keeps the engine unit-testable with plain objects
 *  and reusable from the sync layer before a row exists. */
export function deadlineInputsOf(r: CxpEpRecord): DeadlineInputs {
  return {
    epOppId: r.ep_opp_id,
    function: r.function,
    stageKey: r.stage_key,
    approvalDate: toIsoDate(r.approval_date),
    startDate: toIsoDate(r.start_date),
    endDate: toIsoDate(r.end_date),
    arrivalDate: toIsoDate(r.arrival_date),
    product: r.product ?? "",
  };
}

/** Compute a single requirement's deadline for one EP record. */
export function computeDeadline(
  rec: DeadlineInputs,
  req: CxpRequirementDef,
  now: Date = new Date()
): CxpComputedDeadline {
  const rule: CxpDeadlineRule | undefined = req.deadlineRule;
  const base: CxpComputedDeadline = {
    epOppId: rec.epOppId,
    function: rec.function,
    stageKey: rec.stageKey,
    requirementKey: req.key,
    requirementName: req.name,
    dueDate: null,
    windowStart: null,
    windowEnd: null,
    reminderDate: null,
    note: rule?.note,
  };
  if (!rule || rule.type === "none") return base;

  const approval = rec.approvalDate;
  const start = rec.startDate;
  const end = rec.endDate;
  // the flight date anchors travel rules; the slot start is the fallback the
  // old app used and the sheet often only carries one of the two
  const arrival = rec.arrivalDate || start;

  let due: string | null = null;
  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  let basedOn = "";

  switch (rule.type) {
    case "fixed_after_approval":
      if (approval) {
        due = addDays(approval, rule.offsetDays ?? 14);
        basedOn = "approvalDate";
      }
      break;
    case "before_travel":
      if (arrival) {
        due = addDays(arrival, -(rule.offsetDays ?? 0));
        basedOn = rec.arrivalDate ? "arrivalDate" : "startDate";
      }
      break;
    case "after_arrival_hours":
      if (arrival) {
        // hours, but the output is a DATE — 36h after arrival lands on the
        // next day, which is exactly what the ECB counts
        due = day(ms(arrival) + (rule.offsetHours ?? 24) * 3_600_000);
        basedOn = "arrivalDate";
      }
      break;
    case "within_after_arrival_days":
      if (arrival) {
        due = addDays(arrival, rule.offsetDays ?? 3);
        windowStart = arrival;
        basedOn = "arrivalDate";
      }
      break;
    case "window_before_arrival":
      if (arrival) {
        windowStart = addDays(arrival, -(rule.windowMaxDays ?? 15));
        windowEnd = addDays(arrival, -(rule.windowMinDays ?? 10));
        due = windowEnd;
        basedOn = "arrivalDate";
      }
      break;
    case "mid_duration":
      if (start && end) {
        due = addDays(start, Math.round(diffDays(end, start) / 2));
        basedOn = "startDate+duration/2";
      }
      break;
    case "last_week":
      if (end) {
        windowStart = addDays(end, -(rule.offsetDays ?? 7));
        windowEnd = end;
        due = windowStart;
        basedOn = "endDate";
      }
      break;
    case "monthly_first_days": {
      // the NEXT occurrence of "the first N days of a month"
      const today = cxpToday(now);
      const ref = start || approval || today;
      let y = Number(ref.slice(0, 4));
      let m = Number(ref.slice(5, 7));
      let first = iso(y, m, 1);
      if (ms(first) < ms(today)) {
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
        first = iso(y, m, 1);
      }
      windowStart = first;
      windowEnd = addDays(first, (rule.offsetDays ?? 5) - 1);
      due = windowEnd;
      basedOn = "first days of month";
      break;
    }
  }

  base.dueDate = due;
  base.windowStart = windowStart;
  base.windowEnd = windowEnd;
  base.basedOn = basedOn;

  // remind one day before the window start (or before the due date)
  const anchor = windowStart || due;
  base.reminderDate = anchor ? addDays(anchor, -REMINDER_OFFSET_DAYS) : null;

  // POST-APPROVAL IS THE EXCEPTION. PGS and the LDA are due within two weeks
  // of approval, but the EP should be nudged to START them immediately — so
  // the reminder is the day AFTER approval, not the day before the due date.
  // A newly approved EP therefore gets its LDA reminder right away.
  if (rec.stageKey === "post_approval" && approval) {
    base.reminderDate = addDays(approval, 1);
  }
  return base;
}

/** Every deadline for one EP record — its own stage's requirements, plus the
 *  date-driven ones that belong to LATER stages.
 *
 *  Communications, alignment spaces and (GT) monthly comms happen DURING the
 *  experience and are driven by start/end dates. They must be reminded on as
 *  soon as the EP is realized — waiting until someone moves the row into the
 *  Finish / Monthly section is how a realized IGT misses a month of
 *  communication proof. */
export function computeDeadlinesForRecord(
  rec: DeadlineInputs,
  now: Date = new Date()
): CxpComputedDeadline[] {
  const reqs = [...requirementsForStage(rec.function, rec.stageKey)];

  const realized = rec.stageKey === "realization" || rec.stageKey === "finish";
  if (realized && rec.startDate) {
    const seen = new Set(reqs.map((r) => r.key));
    const isGT = /^GT/i.test(rec.product || "");
    for (const stageKey of ["finish", "monthly"] as const) {
      // monthly communication is a GT-product thing only
      if (stageKey === "monthly" && !isGT) continue;
      for (const req of requirementsForStage(rec.function, stageKey)) {
        // date-driven only: a requirement with no rule has nothing to remind on
        if (!req.deadlineRule || req.deadlineRule.type === "none") continue;
        if (seen.has(req.key)) continue;
        reqs.push(req);
        seen.add(req.key);
      }
    }
  }

  return reqs.map((req) => computeDeadline(rec, req, now));
}

/** Human-readable timeline string for a requirement (UI + calendar). */
export function describeDeadline(d: CxpComputedDeadline): string {
  if (d.windowStart && d.windowEnd) return `Window: ${d.windowStart} → ${d.windowEnd}`;
  if (d.dueDate) return `Due: ${d.dueDate}`;
  if (d.note) return d.note;
  return "No fixed deadline";
}

// ------------------------------------------- WEEKLY DEADLINES (6/13/20/27)

/** The weekly deadlines of one calendar month (1-based month). */
export function weeklyDeadlinesForMonth(year: number, month: number): CxpWeeklyDeadline[] {
  return WEEKLY_DEADLINE_DAYS.map((d) => ({ date: iso(year, month, d), dayOfMonth: d }));
}

/** The next `count` weekly deadlines on or after `from` (oldest first). */
export function upcomingWeeklyDeadlines(
  from: string = cxpToday(),
  count = 4
): CxpWeeklyDeadline[] {
  const out: CxpWeeklyDeadline[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  while (out.length < count) {
    for (const d of WEEKLY_DEADLINE_DAYS) {
      const date = iso(y, m, d);
      if (ms(date) >= ms(from)) out.push({ date, dayOfMonth: d });
      if (out.length >= count) break;
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.slice(0, count);
}

/** The most recent `count` weekly deadlines strictly BEFORE `from` (oldest
 *  first) — the "past weeks" the board lets you review. */
export function recentWeeklyDeadlines(
  from: string = cxpToday(),
  count = 2
): CxpWeeklyDeadline[] {
  const out: CxpWeeklyDeadline[] = []; // newest-first while collecting
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  while (out.length < count) {
    for (let i = WEEKLY_DEADLINE_DAYS.length - 1; i >= 0 && out.length < count; i--) {
      const d = WEEKLY_DEADLINE_DAYS[i];
      const date = iso(y, m, d);
      if (ms(date) < ms(from)) out.push({ date, dayOfMonth: d });
    }
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out.reverse();
}

/** The weekly deadline immediately BEFORE `deadline` — what "carry-over"
 *  compares against. */
export function previousWeeklyDeadline(deadline: string): string {
  return recentWeeklyDeadlines(deadline, 1)[0].date;
}

/** The weekly deadline that falls exactly one day after `from`, if any.
 *  This is the cron's gate: it sends only on the 5th / 12th / 19th / 26th. */
export function deadlineOneDayAfter(from: string = cxpToday()): CxpWeeklyDeadline | null {
  const tomorrow = addDays(from, REMINDER_OFFSET_DAYS);
  const d = Number(tomorrow.slice(8, 10));
  if ((WEEKLY_DEADLINE_DAYS as number[]).includes(d)) {
    return { date: tomorrow, dayOfMonth: d as 6 | 13 | 20 | 27 };
  }
  return null;
}

/** Appeal date for a deadline (deadline + offset). ECB opens appeals on the
 *  5th and 6th day after each audit. */
export function appealDateFor(deadlineDate: string, offsetDays: number): string | null {
  const d = toIsoDate(deadlineDate);
  return d ? addDays(d, offsetDays) : null;
}

/** The submission MONTH a date belongs to, as yyyy-MM-01 — the key the EP
 *  list's "current month" default filters on. */
export function submissionMonthOf(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

/** The month before `month` (yyyy-MM-01 in, yyyy-MM-01 out). */
export function previousMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? iso(y - 1, 12, 1) : iso(y, m - 1, 1);
}
