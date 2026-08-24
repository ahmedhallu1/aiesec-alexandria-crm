/** "THIS WEEK" HAS TO MEAN ONE THING (v34.8).
 *
 *  THE BUG THIS FILE EXISTS TO KILL: The Violet Man was asked things like
 *  "how many visits did I schedule this week" and answered with a number that
 *  was simply wrong — because nothing in his context had a date in it. He was
 *  handed the ALL-TIME KPI block, the freshest 300 account names, and no
 *  today, no week, no month. There was no date arithmetic to get wrong; there
 *  was no date arithmetic at all, so he produced a plausible number the same
 *  way he'd produce a plausible sentence.
 *
 *  The fix is not a sterner prompt. It is to make the window a COMPUTED,
 *  TESTED value that he looks up rather than invents — resolved here, then
 *  handed to the very same `getDashboard` the dashboard itself renders from,
 *  so his answer and the screen cannot disagree.
 *
 *  Everything is anchored to CAIRO, like every other date in Sodio: a member
 *  asking at 01:00 is asking about the day they think it is, and
 *  `new Date().toISOString()` would answer about yesterday.
 *
 *  ⚠️ THE WEEK STARTS ON SATURDAY. That is the LC's week (the calendar has
 *  rendered Saturday-first since v12) and it is a working week in Egypt, so a
 *  Sunday-start or Monday-start "this week" would put Saturday's work in the
 *  wrong bucket — which is exactly the class of quietly-wrong answer this file
 *  is here to prevent.
 */

const CAIRO = "Africa/Cairo";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Today in Cairo as YYYY-MM-DD. Injectable so the tests aren't a clock race. */
export function cairoDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Cairo weekday of an ISO day, 0 = Sunday … 6 = Saturday. */
export function isoWeekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** Shift an ISO day by N days. Noon anchors it clear of any DST edge. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const lastOfMonth = (y: number, m0: number): number =>
  new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

export const PERIOD_KEYS = [
  "today", "yesterday",
  "this_week", "last_week",
  "this_month", "last_month",
  "this_sprint", "last_sprint",
  "this_peak",
  "all_time",
  "custom",
] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface ResolvedPeriod {
  /** inclusive Cairo day, or null for "no lower bound" (all time) */
  from: string | null;
  /** inclusive Cairo day, or null for "no upper bound" */
  to: string | null;
  /** what to SHOW the member, so the answer states the window it used */
  label: string;
}

/** THE SATURDAY-FIRST WEEK containing `day`. */
export function weekOf(day: string): { from: string; to: string } {
  // getUTCDay: Sat = 6. Days since the most recent Saturday:
  //   Sat 6 → 0 · Sun 0 → 1 · Mon 1 → 2 … Fri 5 → 6
  const back = (isoWeekday(day) + 1) % 7;
  const from = shiftDay(day, -back);
  return { from, to: shiftDay(from, 6) };
}

/** The half-month sprint containing `day` — 1–15 or 16–EOM, matching plan.ts. */
export function sprintOfDay(day: string): { from: string; to: string; label: string } {
  const y = Number(day.slice(0, 4));
  const m0 = Number(day.slice(5, 7)) - 1;
  const dd = Number(day.slice(8, 10));
  const second = dd > 15;
  const mm = String(m0 + 1).padStart(2, "0");
  const eom = lastOfMonth(y, m0);
  return {
    from: `${y}-${mm}-${second ? "16" : "01"}`,
    to: `${y}-${mm}-${second ? String(eom).padStart(2, "0") : "15"}`,
    label: `${MONTHS[m0]} · Sprint ${second ? 2 : 1}`,
  };
}

function monthBounds(y: number, m0: number) {
  const mm = String(m0 + 1).padStart(2, "0");
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(lastOfMonth(y, m0)).padStart(2, "0")}`,
    label: `${MONTHS[m0]} ${y}`,
  };
}

/** THE PEAK containing `day` — summer Feb–Jul, winter Aug–Jan (mirrors
 *  `peakOf` in plan.ts, which the whole planning module runs on). */
export function peakOfDay(day: string): { from: string; to: string; label: string } {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  if (m >= 2 && m <= 7) {
    return { from: `${y}-02-01`, to: `${y}-07-31`, label: `Summer peak (Feb–Jul ${y})` };
  }
  // winter spans a year boundary: January belongs to the peak that STARTED
  // last August, not to a peak starting this one
  const startY = m === 1 ? y - 1 : y;
  return {
    from: `${startY}-08-01`,
    to: `${startY + 1}-01-31`,
    label: `Winter peak (Aug ${startY} – Jan ${startY + 1})`,
  };
}

/** Resolve a named period against a Cairo "today".
 *
 *  `custom` needs from/to; anything missing or malformed falls back to the
 *  month, because a silently-unbounded window is the failure mode that
 *  produces an all-time number wearing a "this week" label. */
export function resolvePeriod(
  key: PeriodKey,
  today: string,
  custom?: { from?: string | null; to?: string | null }
): ResolvedPeriod {
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  switch (key) {
    case "all_time":
      return { from: null, to: null, label: "all time" };

    case "today":
      return { from: today, to: today, label: `today (${today})` };

    case "yesterday": {
      const d = shiftDay(today, -1);
      return { from: d, to: d, label: `yesterday (${d})` };
    }

    case "this_week": {
      const w = weekOf(today);
      // never claim work from days that have not happened yet
      return { from: w.from, to: today, label: `this week (${w.from} → ${today}, week starts Saturday)` };
    }

    case "last_week": {
      const thisWeek = weekOf(today);
      const from = shiftDay(thisWeek.from, -7);
      const to = shiftDay(from, 6);
      return { from, to, label: `last week (${from} → ${to})` };
    }

    case "this_month": {
      const m = monthBounds(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1);
      return { from: m.from, to: today, label: `${m.label} so far (${m.from} → ${today})` };
    }

    case "last_month": {
      const y = Number(today.slice(0, 4));
      const m0 = Number(today.slice(5, 7)) - 1;
      const prev = m0 === 0 ? monthBounds(y - 1, 11) : monthBounds(y, m0 - 1);
      // every label spells out its own dates — the model repeats the label
      // back to the member, and that is what makes a wrong window visible
      return { from: prev.from, to: prev.to, label: `${prev.label} (${prev.from} → ${prev.to})` };
    }

    case "this_sprint": {
      const s = sprintOfDay(today);
      return { from: s.from, to: today, label: `${s.label} so far (${s.from} → ${today})` };
    }

    case "last_sprint": {
      const s = sprintOfDay(today);
      // the sprint before this one is the day before this one started
      const prev = sprintOfDay(shiftDay(s.from, -1));
      return { from: prev.from, to: prev.to, label: `${prev.label} (${prev.from} → ${prev.to})` };
    }

    case "this_peak": {
      const p = peakOfDay(today);
      return { from: p.from, to: today, label: `${p.label}, so far (${p.from} → ${today})` };
    }

    case "custom": {
      let from = custom?.from && DAY.test(custom.from) ? custom.from : null;
      let to = custom?.to && DAY.test(custom.to) ? custom.to : null;
      if (!from && !to) {
        // a "custom" window with no dates is not a window — fall back to the
        // month rather than silently answering about all time
        const m = monthBounds(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1);
        return {
          from: m.from,
          to: today,
          label: `${m.label} so far (${m.from} → ${today}) — no dates were given, so this is the month`,
        };
      }
      if (from && to && from > to) [from, to] = [to, from];
      // work cannot exist in the future
      if (to && to > today) to = today;
      if (from && from > today) from = today;
      return {
        from, to,
        label: from && to ? `${from} → ${to}` : from ? `since ${from}` : `until ${to}`,
      };
    }
  }
}

/** The named periods, described for the model's tool schema. Kept next to the
 *  implementation so a new period cannot be offered without being resolvable. */
export const PERIOD_HELP: Record<Exclude<PeriodKey, "custom">, string> = {
  today: "the current Cairo day",
  yesterday: "the previous Cairo day",
  this_week: "the current Saturday→Friday week, up to today",
  last_week: "the whole previous Saturday→Friday week",
  this_month: "the 1st of this month up to today",
  last_month: "the whole previous calendar month",
  this_sprint: "the current half-month sprint (1–15 or 16–end), up to today",
  last_sprint: "the whole previous half-month sprint",
  this_peak: "the current peak (summer Feb–Jul / winter Aug–Jan), up to today",
  all_time: "no date limit at all",
};
