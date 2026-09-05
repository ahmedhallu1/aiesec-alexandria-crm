/** THE PDP / O2O HELPERS — pure, so the form, the server and the email agree.
 *
 *  A PDP is a month's development plan a leader files FOR one of their people:
 *  a personal goal, a professional one, the funnel step they are weakest at,
 *  and the action steps that carry each of those — divided by week, because
 *  "improve your closing" over a whole month is a wish and "call these five
 *  back on Tuesday" is a plan.
 *
 *  Both halves of this file exist to stop a number being invented. The weeks
 *  are a real calendar, not four equal guesses; the funnel gap is refused
 *  outright when there is not enough work behind it to mean anything. A leader
 *  who walks into a development conversation quoting a made-up weakness has
 *  been actively harmed by the tool, which is worse than the tool saying
 *  nothing.
 *
 *  Nothing here touches the database or imports a server module, so the form,
 *  the action and the tests all read the same rules.
 */

/* -------------------------------------------------------------------------
 * THE MONTH'S FOUR WEEKS
 * ---------------------------------------------------------------------- */

export const PDP_WEEKS = [1, 2, 3, 4] as const;
export type PdpWeek = (typeof PDP_WEEKS)[number];

/** ⚠️ A PDP WEEK IS NOT A SPRINT, AND MUST NOT BE "FIXED" INTO ONE.
 *
 *  `src/lib/plan.ts` models the LC's planning calendar — term, peak, month,
 *  sprint, quarter — and a sprint there is exactly HALF a month (1–15, 16–EOM).
 *  There is no four-week primitive anywhere in it, so this is a new period and
 *  it deliberately does NOT line up with sprints: a PDP's action steps are the
 *  member's own week-by-week commitments, not the function's reporting cadence,
 *  and folding them into two half-months would take the plan from four
 *  checkpoints to two and quietly change what a leader agreed with their
 *  member. If a later reader is tempted to make these align — don't; the
 *  mismatch is the point.
 *
 *  Week 1 always starts on the 1st and the last week absorbs whatever is left,
 *  so the ranges are contiguous, cover the whole month and never run past its
 *  end: 28 days → 7/7/7/7 · 29 → 7/7/7/8 · 30 → 7/7/7/9 · 31 → 7/7/7/10.
 *  The shortest month in the Gregorian calendar is 28 days, so weeks 1–3 are
 *  always a full seven and week 4 is never empty. */
const WEEK_DAYS = 7;

const CAIRO = "Africa/Cairo";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Days in a month. Day 0 of the NEXT month is the last day of this one. */
const lastOfMonth = (y: number, m0: number): number =>
  new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** "YYYY-MM" or any "YYYY-MM-DD" → that month.
 *
 *  This THROWS on anything else rather than returning an empty list. A broken
 *  month key here is a programmer error — every real caller passes a `date`
 *  column or a key built by `pdpMonthKey` — and a PDP form that silently
 *  rendered no week rows would be a bug nobody could see. */
function parseMonth(monthIso: string): { y: number; m0: number } {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec((monthIso ?? "").trim());
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12)
    throw new Error(`pdp: "${monthIso}" is not a month (expected YYYY-MM or YYYY-MM-DD)`);
  return { y: Number(m[1]), m0: month - 1 };
}

/** The month a PDP cycle filed NOW belongs to, as an ISO first-of-month key.
 *
 *  Cairo, like every other business day in Sodio: a cycle opened at 00:30 on
 *  the 1st is opened on the 1st, and `new Date().toISOString()` would file it
 *  under the previous month. */
export function pdpMonthKey(now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return `${day.slice(0, 7)}-01`;
}

export interface PdpWeekRange {
  week: number;
  /** ISO day, inclusive */
  start: string;
  /** ISO day, inclusive */
  end: string;
  /** "Week 1 · 1–7 Sep" — what the member reads above their action steps */
  label: string;
}

/** The month's four action-step weeks. See WEEK_DAYS above for why this is a
 *  new primitive and not a sprint. */
export function pdpWeeks(monthIso: string): PdpWeekRange[] {
  const { y, m0 } = parseMonth(monthIso);
  const last = lastOfMonth(y, m0);
  const mm = pad2(m0 + 1);
  const short = MONTH_SHORT[m0];
  return PDP_WEEKS.map((week) => {
    const from = (week - 1) * WEEK_DAYS + 1;
    // the final week runs to the end of the month, however long that is
    const to = week === PDP_WEEKS[PDP_WEEKS.length - 1] ? last : week * WEEK_DAYS;
    return {
      week,
      start: `${y}-${mm}-${pad2(from)}`,
      end: `${y}-${mm}-${pad2(to)}`,
      label: `Week ${week} · ${from}–${to} ${short}`,
    };
  });
}

/** Which week an ISO day falls in, or null when it is outside the month.
 *
 *  Pure string comparison on ISO days — the ranges are already Cairo calendar
 *  days, so parsing them back into `Date` would only reintroduce the timezone
 *  question they were built to answer. */
export function pdpWeekOf(monthIso: string, dayIso: string): number | null {
  const day = (dayIso ?? "").slice(0, 10);
  for (const w of pdpWeeks(monthIso))
    if (day >= w.start && day <= w.end) return w.week;
  return null;
}

/* -------------------------------------------------------------------------
 * THE WEAKEST FUNNEL STEP
 * ---------------------------------------------------------------------- */

export const FUNNEL_STEPS = ["mr", "contacted", "visits", "visitsDone", "deals"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelCounts {
  mr: number;
  contacted: number;
  visits: number;
  visitsDone: number;
  deals: number;
}

/** The name of the WORK at each step — a development goal is about the work,
 *  not about the metric. Shown on the PDP form and in the nag email. */
export const FUNNEL_STEP_LABEL: Record<FunnelStep, string> = {
  mr: "Market research",
  contacted: "Contacting",
  visits: "Booking visits",
  visitsDone: "Holding visits",
  deals: "Closing deals",
};

/** HOW MUCH WORK IS ENOUGH TO TALK ABOUT — the honesty threshold.
 *
 *  A rate needs a denominator before it means anything. A member with 3
 *  accounts who contacted 1 of them has "33%", and comparing that to a
 *  function running at 70% would send their leader into a development
 *  conversation built on a premise the data cannot support. Ten is the
 *  smallest denominator where a single extra event moves the rate by no more
 *  than ten points, which is the point at which the number stops swinging
 *  wildly on one phone call; below that the honest answer is "not enough work
 *  to say", and this function returns null and says nothing. It is also low
 *  enough that a real month of an MM's work clears it easily — the crews here
 *  carry dozens of accounts each — so the gap is refused because the DATA is
 *  thin, never because the bar was set for show. */
export const PDP_MIN_VOLUME = 10;

/** A gap smaller than this is noise, not a weakness.
 *
 *  Even at the minimum volume above, one event either way is worth ~10 points,
 *  so a member two points behind their function is not behind it in any sense
 *  a person should act on — and rounding alone can produce a point or two. The
 *  step returned here becomes a whole month's development plan; it should be
 *  something a leader can say out loud without flinching. */
export const PDP_MIN_GAP_POINTS = 5;

interface Transition {
  /** the step being LOST — the destination of the transition, because that is
   *  the work the member is not getting to */
  step: FunnelStep;
  from: FunnelStep;
  note: (from: number, to: number, minePct: number, benchPct: number) => string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The four step-to-step transitions, in funnel order, each with the sentence
 *  a human reads. The note is shown on the PDP form and quoted in the email,
 *  so it carries the RAW COUNTS as well as the two rates — a leader must be
 *  able to sanity-check the claim without opening the dashboard. */
const TRANSITIONS: Transition[] = [
  {
    step: "contacted", from: "mr",
    note: (f, t, m, b) =>
      `You've contacted ${t} of the ${plural(f, "account")} you added — ${m}%. The function contacts ${b}%.`,
  },
  {
    step: "visits", from: "contacted",
    note: (f, t, m, b) =>
      `You booked a visit on ${t} of the ${plural(f, "account")} you contacted — ${m}%. The function books ${b}%.`,
  },
  {
    step: "visitsDone", from: "visits",
    note: (f, t, m, b) =>
      `${t} of your ${plural(f, "booked visit")} actually happened — ${m}%. The function holds ${b}%.`,
  },
  {
    step: "deals", from: "visitsDone",
    note: (f, t, m, b) =>
      `You signed ${plural(t, "deal")} off ${plural(f, "visit")} held — ${m}%. The function closes ${b}%.`,
  },
];

/** Counts arrive from database sums, so a null, a negative or a stray float
 *  must not become a rate. */
const count = (n: unknown): number => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** A conversion as a fraction, CAPPED AT 1 — the house rule everywhere since
 *  v22 (see `pct` in dashboard-view and the funnel strip). It is not a guard
 *  against bad data: "deals" counts DEALS and "visits held" counts ACCOUNTS,
 *  and an account can close several deals, so a genuinely excellent month
 *  legitimately produces 150% and would otherwise be reported as a member
 *  outperforming their function by half again. Null when there is nothing to
 *  divide by. */
const rate = (num: number, den: number): number | null =>
  den > 0 ? Math.min(1, count(num) / den) : null;

export interface FunnelGap {
  step: FunnelStep;
  /** the member's conversion into that step, 0–100 */
  mine: number;
  /** the benchmark's conversion into the same step, 0–100 */
  benchmark: number;
  /** one plain sentence, ready to show a person */
  note: string;
}

/** THE WEAKEST STEP: the transition whose conversion falls furthest below the
 *  benchmark (the function's own rate over the same window).
 *
 *  Returns null — deliberately, and often — when:
 *    · no transition has enough volume on BOTH sides (a function with 8 held
 *      visits is no benchmark either),
 *    · the member is at or above the benchmark everywhere, which is not a gap
 *      and must not be dressed up as one,
 *    · or the biggest shortfall is inside the noise floor.
 *  Every one of those is a real answer: the PDP simply carries no auto-filled
 *  gap, and the leader writes what they actually see. */
export function funnelGap(
  mine: FunnelCounts,
  benchmark: FunnelCounts,
  minVolume: number = PDP_MIN_VOLUME,
): FunnelGap | null {
  const floor = Math.max(1, count(minVolume));
  let best: { t: Transition; gap: number; mine: number; bench: number } | null = null;

  for (const t of TRANSITIONS) {
    const mineFrom = count(mine[t.from]);
    const benchFrom = count(benchmark[t.from]);
    // both denominators have to carry real work — comparing a thin member
    // against a thin function is two guesses, not a finding
    if (mineFrom < floor || benchFrom < floor) continue;

    const mineRate = rate(mine[t.step], mineFrom);
    const benchRate = rate(benchmark[t.step], benchFrom);
    if (mineRate === null || benchRate === null) continue;

    const gap = benchRate - mineRate;
    if (gap <= 0) continue;              // at or above the function — no gap here
    if (!best || gap > best.gap) best = { t, gap, mine: mineRate, bench: benchRate };
  }

  if (!best) return null;
  // the shortfall is measured on the raw rates and only then rounded, so a
  // gap can never be created or destroyed by the rounding a human reads
  if (best.gap * 100 < PDP_MIN_GAP_POINTS) return null;

  const minePct = Math.round(best.mine * 100);
  const benchPct = Math.round(best.bench * 100);
  return {
    step: best.t.step,
    mine: minePct,
    benchmark: benchPct,
    note: best.t.note(count(mine[best.t.from]), count(mine[best.t.step]), minePct, benchPct),
  };
}

/** Is this string one of the five steps? Guards `pdps.gap_step`, which is free
 *  text in the database and arrives from a form. */
export function isFunnelStep(v: unknown): v is FunnelStep {
  return typeof v === "string" && (FUNNEL_STEPS as readonly string[]).includes(v);
}
