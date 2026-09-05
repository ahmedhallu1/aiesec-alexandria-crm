/** THE DASHBOARD'S FUNNEL MODEL — pure, so it can be tested (v33.49).
 *
 *  Which lane an account belongs to, which lane its opens feed, and — the part
 *  that was wrong for a year — WHICH DATE each KPI is judged on. It lived
 *  inside `getDashboard` next to the queries, where the only way to check it
 *  was to look at the dashboard and believe it. It doesn't touch the database,
 *  so it doesn't have to live there. */

/** The account columns the funnel reads. `PipelineRow` satisfies this. */
export interface LaneRow {
  // v36: NULL = the unowned research pool — nobody has claimed it, so nobody
  // has decided which function it belongs to. See rowInLane for what that
  // means for the lanes.
  function: string | null;
  product?: string | null;
  out_of_process?: boolean | null;
  contact_limit_reached?: boolean | null;
  next_step_missing?: boolean | null;
  attempts?: number | null;
  visit_id?: string | null;
  visit_done?: boolean | null;
  deals_count?: number | null;
  slots_count?: number | null;
  slots_igv_count?: number | null;
  slots_igta_count?: number | null;
  slots_igte_count?: number | null;
}

export interface FunnelStats {
  /** Market Research — every account that entered the system */
  mr: number;
  contacted: number;
  visitScheduled: number;
  visitDone: number;
  /** number of DEALS signed (an account can close several) */
  deals: number;
  /** accounts with at least one deal (used for conversion rates) */
  dealAccounts: number;
  slots: number;
  outOfProcess: number;
  contactLimitFlags: number;
  nextStepMissingFlags: number;
}

export const emptyStats = (): FunnelStats => ({
  mr: 0, contacted: 0, visitScheduled: 0, visitDone: 0, deals: 0,
  dealAccounts: 0, slots: 0, outOfProcess: 0, contactLimitFlags: 0,
  nextStepMissingFlags: 0,
});

/** ONE ACCOUNT'S WORK INSIDE THE ACTIVE DATE WINDOW (v33.49).
 *
 *  THE BUG THIS TYPE EXISTS TO KILL: the dashboard's date filter was a filter
 *  on `accounts.created_at` and nothing else, so EVERY KPI was really asking
 *  "…on accounts ADDED in this range". Market Research is the only number for
 *  which that is the right question. Pick "This month" and a contact made
 *  today on a name imported in July vanished, a visit booked this morning for
 *  an account added last sprint vanished, and a deal signed this week on a
 *  six-week-old account vanished — while the member who did all three was
 *  looking straight at their own work being counted as zero. Measured against
 *  production the day this was written: 110 of the 423 contact attempts made
 *  in August (26%) and 9 of the 36 visits booked (25%) sat on accounts created
 *  before August, so a "this month" dashboard was hiding a quarter of the
 *  month's work.
 *
 *  Every KPI is now counted on ITS OWN DATE, which is the rule the period
 *  reports (v33.45) and the TM directory (v29.4) already follow:
 *    · Market Research → accounts.created_at   (the account was added)
 *    · Contacted       → contact_attempts.created_at (the attempt itself)
 *    · Visits          → visits.created_at — the BOOKING, which is the work
 *                        done in the window; keying it on visit_date would
 *                        drop every visit booked now for a date still to come
 *                        (30 of the 36 live visits are booked for another day)
 *    · Visits done     → visits.visit_date, done — the day it actually happened
 *    · Deals + opens   → deals.created_at (opens via that deal's per-product
 *                        split, and per MEMBER via that deal's allocations)
 *
 *  THE UNIT IS UNCHANGED: contacted / visits / visits done still count
 *  ACCOUNTS (an account worked five times in a window is one account moving
 *  one step), because the strip underneath these KPIs is a funnel and a funnel
 *  compares stages of the same thing. Deals count deals, opens count opens.
 *  The period-report emails count EVENTS instead — deliberate there; that is a
 *  report of activity, not a funnel. */
export interface RowWork {
  /** the account itself was added inside the window */
  mr: boolean;
  /** ≥1 contact attempt of its own inside the window */
  contacted: boolean;
  /** ≥1 visit BOOKED inside the window */
  visitBooked: boolean;
  /** ≥1 visit HELD inside the window */
  visitDone: boolean;
  /** deals signed inside the window, and the opens they carry */
  deals: number;
  slots: number;
  igv: number;
  igta: number;
  igte: number;
  /** false when nothing here carries a per-product split (pre-0009 deals) */
  split: boolean;
}

export const noWork = (): RowWork => ({
  mr: false, contacted: false, visitBooked: false, visitDone: false,
  deals: 0, slots: 0, igv: 0, igta: 0, igte: 0, split: true,
});

/** ALL TIME: the account's own running counters, which is what the dashboard
 *  has always read when no date range is set. Kept as the no-window path on
 *  purpose — it costs nothing, it is what every existing number was built
 *  from, and the work tables only have to be read when a window actually
 *  narrows them. */
export const allTimeWork = (r: LaneRow): RowWork => ({
  mr: true,
  contacted: (r.attempts ?? 0) > 0,
  visitBooked: !!r.visit_id,
  visitDone: !!r.visit_done,
  deals: r.deals_count ?? 0,
  slots: r.slots_count ?? 0,
  igv: r.slots_igv_count ?? 0,
  igta: r.slots_igta_count ?? 0,
  igte: r.slots_igte_count ?? 0,
  split: r.slots_igv_count != null,
});

/** True when this row carries anything at all inside the window — an account
 *  the viewer didn't touch must not take a row on a board or a drill. */
export const didAnything = (w: RowWork): boolean =>
  w.mr || w.contacted || w.visitBooked || w.visitDone || w.deals > 0 || w.slots > 0;

/** Which dashboard lane an account belongs to for FUNNEL metrics (MR,
 *  contacted, visits…). B2B accounts live in the All-ICX lane (and the B2B
 *  drill row); their opens still feed the product lanes via deal breakdowns. */
export function rowInLane(r: LaneRow, lane: string): boolean {
  // B2C is its own module — it never pollutes the All-ICX lane (v23).
  //
  // ⚠️ v36 — THE UNOWNED POOL (function === null) COUNTS HERE, DELIBERATELY.
  // A research name nobody has claimed is still market research the LC did,
  // and All-ICX is the one lane that asks "what has this LC got in front of
  // it" rather than "what is my product's". Leaving it out would make the
  // pool invisible on the only board where it is anybody's business.
  // It correctly falls OUT of every product lane below, because those all
  // compare with === and a null equals nothing — an unclaimed name has no
  // product to be counted against, and stamping one on it is exactly the
  // v22 mistake this release exists to undo.
  if (lane === "all") return r.function !== "B2C";
  if (lane === "IGV") return r.function === "IGV";
  if (lane === "IGT") return r.function === "IGT";
  if (lane === "IGTa") return r.function === "IGT" && r.product === "GTa";
  if (lane === "IGTe") return r.function === "IGT" && r.product === "GTe";
  // B2B & BD are one function — the B2B lane shows both labels
  // v32.6: BD is its OWN lane — B2B raises opens, BD sells partnerships, and
  // mixing them made both numbers meaningless
  if (lane === "B2B") return r.function === "B2B";
  if (lane === "BD") return r.function === "BD";
  if (lane === "B2C") return r.function === "B2C";
  return true;
}

/** Opens this account contributes to a lane. Deals carry a per-product split
 *  (B2B mixes all three; IGT deals split IGTa/IGTe), so a lane's slots include
 *  every account's contribution — B2B included. */
export function laneWorkSlots(r: LaneRow, w: RowWork, lane: string): number {
  // B2C deals carry no opens — the lane has no slots at all (v23)
  if (lane === "B2C" || r.function === "B2C") return 0;
  if (lane === "all") return w.slots;
  // pre-0009 fallback: attribute the account's total to its own product
  if (!w.split) return rowInLane(r, lane) ? w.slots : 0;
  if (lane === "IGV") return w.igv;
  if (lane === "IGTa") return w.igta;
  if (lane === "IGTe") return w.igte;
  if (lane === "IGT") return w.igta + w.igte;
  if (lane === "B2B") return r.function === "B2B" ? w.slots : 0;
  if (lane === "BD") return r.function === "BD" ? w.slots : 0;
  return w.slots;
}

/** Opens one allocation contributes to a lane (mirror of laneWorkSlots, but
 *  for a single allocation row instead of an account's totals). */
export function laneAllocSlots(
  a: { slots_igv: number; slots_igta: number; slots_igte: number },
  lane: string,
  accountFn: string
): number {
  // B2C has NO opens at all (v23) — allocations never count into its lane
  if (lane === "B2C" || accountFn === "B2C") return 0;
  if (lane === "IGV") return a.slots_igv ?? 0;
  if (lane === "IGTa") return a.slots_igta ?? 0;
  if (lane === "IGTe") return a.slots_igte ?? 0;
  if (lane === "IGT") return (a.slots_igta ?? 0) + (a.slots_igte ?? 0);
  const totalSlots = (a.slots_igv ?? 0) + (a.slots_igta ?? 0) + (a.slots_igte ?? 0);
  if (lane === "B2B") return accountFn === "B2B" ? totalSlots : 0;
  if (lane === "BD") return accountFn === "BD" ? totalSlots : 0;
  return totalSlots; // "all"
}

/** Funnel metrics come from the lane's own accounts; slots/deals count every
 *  account contributing opens to the lane (B2B feeding IGV/IGTa/IGTe). */
export function addRowLane(s: FunnelStats, r: LaneRow, w: RowWork, lane: string) {
  if (rowInLane(r, lane)) {
    if (w.mr) {
      s.mr += 1;
      // THE FLAGS ARE STATE, NOT EVENTS. "Archived", "3 contacts no answer"
      // and "no next step" describe the account as it stands today and carry
      // no date of their own, so inside a window they answer the only
      // question they can: of the accounts ADDED in this range, how many are
      // in that state now. (None of the three is on the KPI row; the Violet Man
      // reads `outOfProcess`.)
      if (r.out_of_process) s.outOfProcess += 1;
      if (r.contact_limit_reached) s.contactLimitFlags += 1;
      if (r.next_step_missing) s.nextStepMissingFlags += 1;
    }
    if (w.contacted) s.contacted += 1;
    if (w.visitBooked) s.visitScheduled += 1;
    if (w.visitDone) s.visitDone += 1;
    // B2C deals carry NO opens — count them straight off the account (v23)
    if (r.function === "B2C" && w.deals > 0) {
      s.deals += w.deals;
      s.dealAccounts += 1;
    }
  }
  const ls = laneWorkSlots(r, w, lane);
  if (ls > 0) {
    s.slots += ls;
    s.deals += w.deals || 1;
    s.dealAccounts += 1;
  }
}
