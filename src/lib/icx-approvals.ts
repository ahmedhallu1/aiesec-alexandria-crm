// =============================================================================
// ICX APPROVALS — the pure half (v37).
//
// An approval is the ICX MOS: an EP from abroad approved on one of our
// opportunities. The planning sheet has planned them per product every month
// since v21 (IGV · IGTa · IGTe), the consideration MMs file an approvals plan
// every month, and until this release nothing in Sodio ever counted one.
//
// THE CREDIT RULE (the LC's, stated when this was built): an approval belongs
// to ONE person. A member's approvals ALSO count for their MM — the Team
// Leader they report to — and the MM's own approvals are theirs too, "as
// always". That is exactly how raising opens roll up to a Team Leader's plan
// (`tlPlanForProfile`), so the two floors read the same way.
//
// Nothing here touches the database, so all of it is unit-tested.
// =============================================================================

export type ApprovalProduct = "GV" | "GTa" | "GTe";
export type ApprovalFunction = "IGV" | "IGT";
export type ApprovalSource = "ir_call" | "cv_pool" | "expa" | "referral" | "other";

export const APPROVAL_PRODUCTS: ApprovalProduct[] = ["GV", "GTa", "GTe"];

export const APPROVAL_SOURCES: { value: ApprovalSource; label: string; hint: string }[] = [
  { value: "ir_call", label: "IR call", hint: "An LC we spoke to on an IR call sent them" },
  { value: "cv_pool", label: "CV pool", hint: "Their CV came in through the pool" },
  { value: "expa", label: "EXPA (organic)", hint: "They applied on EXPA by themselves" },
  { value: "referral", label: "Partner referral", hint: "A partner LC or IR referred them to us" },
  { value: "other", label: "Other", hint: "Anything else — say how in the notes" },
];

export const SOURCE_LABEL: Record<ApprovalSource, string> = Object.fromEntries(
  APPROVAL_SOURCES.map((s) => [s.value, s.label])
) as Record<ApprovalSource, string>;

/** IGV = GV; IGT = GTa + GTe — the planning sheet's own split. */
export function functionOfProduct(p: ApprovalProduct): ApprovalFunction {
  return p === "GV" ? "IGV" : "IGT";
}

/** The products a consideration lane counts. */
export function productsOfLane(fn: ApprovalFunction): ApprovalProduct[] {
  return fn === "IGV" ? ["GV"] : ["GTa", "GTe"];
}

/** The planning sheet's rows for a lane (plan_cells.fn). */
export function planFnsOfLane(fn: ApprovalFunction): ("IGV" | "IGTa" | "IGTe")[] {
  return fn === "IGV" ? ["IGV"] : ["IGTa", "IGTe"];
}

/** The planning sheet names products iGTa/iGTe; an approval says GTa/GTe. */
export function planFnOfProduct(p: ApprovalProduct): "IGV" | "IGTa" | "IGTe" {
  return p === "GV" ? "IGV" : p === "GTa" ? "IGTa" : "IGTe";
}

/** The SubTool's raw product ("GV", "gta", "Global Talent Teacher"…) →
 *  ours. Null when it cannot be told apart — the person picks it then. */
export function productFromRaw(raw: string | null | undefined, fn?: string | null): ApprovalProduct | null {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (s === "gv" || s.includes("volunteer")) return "GV";
  if (s === "gte" || s.includes("teacher")) return "GTe";
  if (s === "gta" || s.includes("talent")) return "GTa";
  if (fn === "IGV") return "GV";
  return null;
}

/** The normalised EXPA reference — mirrors the `expa_key` generated column in
 *  0083 exactly (lower-cased, whitespace removed), so the app and the unique
 *  index agree on what "the same EP" means. */
export function expaKey(id: string | null | undefined): string | null {
  const k = String(id ?? "").replace(/\s+/g, "").toLowerCase();
  return k || null;
}

/** The PERSON part of an "EP ID / Opportunity ID" pair: "6207212_1334682" →
 *  "6207212". Someone logging by hand often types only the EP id. */
export function epPartOf(id: string | null | undefined): string | null {
  const k = expaKey(id);
  if (!k) return null;
  return k.split(/[_/|-]/)[0] || null;
}

/**
 * HAS THIS SUBTOOL APPROVAL ALREADY BEEN LOGGED?
 *
 * Exact match on the full "EP_OPP" pair wins. A hand-logged approval that
 * carries ONLY the EP id ("6207212") also covers the SubTool row
 * "6207212_1334682" — the same person, typed the short way. The reverse is
 * deliberately NOT assumed: one EP can be approved on two different
 * opportunities, and two full pairs that differ are two approvals.
 */
export function isAlreadyLogged(
  subtoolId: string,
  logged: (string | null | undefined)[]
): boolean {
  const full = expaKey(subtoolId);
  if (!full) return false;
  const person = epPartOf(subtoolId);
  for (const l of logged) {
    const k = expaKey(l);
    if (!k) continue;
    if (k === full) return true;
    // a bare EP id (no opportunity part) matches that EP's pair
    if (!/[_/|-]/.test(k) && k === person) return true;
  }
  return false;
}

// ------------------------------------------------------------ the credit rule

export interface CreditMember {
  id: string;
  name: string;
  role: string;
  /** the member's manager (stakeholder) */
  managerId: string | null;
}

export interface CreditRow {
  made_by: string | null;
  made_by_name: string;
}

export interface PersonTally {
  id: string | null;
  name: string;
  /** approvals credited to this person themselves */
  own: number;
}

export interface MmTally {
  id: string;
  name: string;
  /** the MM's own approvals */
  own: number;
  /** their team's (everyone who reports to them) */
  team: number;
  /** own + team — the MM's MOS */
  total: number;
}

/** The Team Leader a member's MOS rolls up to: themself when they ARE one,
 *  else their manager when that manager is a Team Leader. The EB is never a
 *  team (the rule every drill in Sodio follows), so a member filed straight
 *  under a VP rolls up to nobody. Coordinators have no team (v36 ⑥). */
export function teamLeaderOf(
  memberId: string | null,
  byId: Map<string, CreditMember>
): string | null {
  if (!memberId) return null;
  const m = byId.get(memberId);
  if (!m) return null;
  if (m.role === "Team Leader") return m.id;
  const mgr = m.managerId ? byId.get(m.managerId) : undefined;
  return mgr?.role === "Team Leader" ? mgr.id : null;
}

/**
 * THE TWO LEADERBOARDS, from one list of approvals.
 *
 *  · by person — what each individual was credited with
 *  · by MM     — every Team Leader: their own + their team's
 *
 * A Team Leader appears on BOTH, and that is the point: their own approvals
 * are their own, AND the team's rolls up to them. Names come from the member
 * row today (renames cascade), falling back to the snapshot on the approval
 * for someone who has since left.
 */
export function tallyApprovals(
  rows: CreditRow[],
  members: CreditMember[]
): { people: PersonTally[]; mms: MmTally[] } {
  const byId = new Map(members.map((m) => [m.id, m]));
  const people = new Map<string, PersonTally>();
  const mms = new Map<string, MmTally>();

  for (const r of rows) {
    const key = r.made_by ?? `name:${r.made_by_name || "—"}`;
    const person =
      people.get(key) ??
      ({
        id: r.made_by,
        name: (r.made_by && byId.get(r.made_by)?.name) || r.made_by_name || "—",
        own: 0,
      } as PersonTally);
    person.own += 1;
    people.set(key, person);

    const tl = teamLeaderOf(r.made_by, byId);
    if (tl) {
      const mm =
        mms.get(tl) ??
        ({ id: tl, name: byId.get(tl)?.name ?? "—", own: 0, team: 0, total: 0 } as MmTally);
      if (tl === r.made_by) mm.own += 1;
      else mm.team += 1;
      mm.total += 1;
      mms.set(tl, mm);
    }
  }

  return {
    people: [...people.values()].sort((a, b) => b.own - a.own || a.name.localeCompare(b.name)),
    mms: [...mms.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

/** How many approvals count for ONE person's MOS: their own, plus — when they
 *  are a Team Leader — everyone who reports to them. */
export function mosCountFor(
  memberId: string,
  rows: CreditRow[],
  members: CreditMember[]
): number {
  const byId = new Map(members.map((m) => [m.id, m]));
  const me = byId.get(memberId);
  let n = 0;
  for (const r of rows) {
    if (!r.made_by) continue;
    if (r.made_by === memberId) n += 1;
    else if (me?.role === "Team Leader" && teamLeaderOf(r.made_by, byId) === memberId) n += 1;
  }
  return n;
}

/** A plain yyyy-mm-dd that is a real calendar day and not in the future. */
export function isValidApprovalDate(day: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) return false;
  if (day < "2020-01-01") return false;
  return day <= today;
}

// ------------------------------------------------------- the lane's numbers

export interface LaneApprovalRow extends CreditRow {
  approved_on: string;
  product: ApprovalProduct;
  partner_lc_name: string | null;
  source: ApprovalSource;
}

export interface PlanCellLike {
  fn: string;
  scope: string;
  period_start: string;
  metric: string;
  value: number;
}

export interface WindowLike {
  start: string;
  end: string;
  label: string;
  planKeys: string[];
}

/**
 * WHOSE PLAN THE VIEWER IS HELD AGAINST (v37.1) — the same rule the raising
 * lanes have followed since v25 / v36:
 *
 *   sheet  VP · Director · LCP · admin — the function's planning sheet,
 *          against the whole lane
 *   mine   Team Leader · Coordinator — the plan THEY filed on their profile,
 *          against their own MOS (a TL's: own + team)
 *   none   a Member — no plan vs achieved at all
 */
export type ApprovalPlanSource =
  | { kind: "sheet"; cells: PlanCellLike[] }
  | { kind: "mine"; memberId: string; monthly: Record<string, number> }
  | { kind: "none" };

export interface LaneApprovals {
  /** which plan the cards and the strip are measured against */
  planKind: "sheet" | "mine" | "none";
  /** in the filter window when one is set, else the whole current peak */
  total: number;
  totalLabel: string;
  thisMonth: number;
  lastMonth: number | null;
  /** PLANNED VS ACHIEVED for the period the filter bar is on (v33.56 rule:
   *  the month, or the sprint while "This sprint" is pressed). `planned` is
   *  null when the planning sheet has no approvals row for it. */
  plan: { mode: "month" | "sprint"; label: string; planned: number | null; achieved: number };
  /** the whole peak, planned vs achieved so far */
  peak: { label: string; planned: number | null; achieved: number };
  /** one bar per month of the peak so far: achieved against planned */
  byMonth: { month: string; label: string; achieved: number; planned: number | null }[];
  byProduct: { product: ApprovalProduct; count: number }[];
  bySource: { source: ApprovalSource; label: string; count: number }[];
  /** where they came from — the sending LCs, most first */
  topLcs: { name: string; count: number }[];
  people: PersonTally[];
  mms: MmTally[];
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Sum a lane's approvals plan over some plan keys, or null when the sheet
 *  holds no approvals row for any of them — "no plan" is not "a plan of 0". */
export function plannedApprovals(
  cells: PlanCellLike[],
  scope: "month" | "sprint",
  keys: string[]
): number | null {
  const hit = cells.filter(
    (c) => c.metric === "approvals" && c.scope === scope && keys.includes(c.period_start)
  );
  if (hit.length === 0) return null;
  // the sheet carries fractions (a 16.5 split across two products); a target
  // is a whole number of people, rounded up so it is never quietly easier
  return Math.ceil(hit.reduce((a, c) => a + Number(c.value || 0), 0));
}

/**
 * Everything the consideration lane shows about approvals, from rows that are
 * ALREADY narrowed to the lane and to the filter bar's member/team pick. The
 * date windows are applied here, each to its own question.
 */
export function laneApprovals(input: {
  rows: LaneApprovalRow[];
  members: CreditMember[];
  plan: ApprovalPlanSource;
  month: WindowLike;
  sprint: WindowLike;
  peak: { label: string; start: string; end: string; months: string[] };
  /** the filter bar's own range, when one is set */
  window?: { from?: string | null; to?: string | null };
  sprintMode: boolean;
  today: string;
}): LaneApprovals {
  const { rows, month, sprint, peak, plan: source } = input;
  const byId = new Map(input.members.map((m) => [m.id, m]));
  // "mine" measures the viewer's OWN MOS: theirs, plus their team's when they
  // lead one — every other view measures the lane
  const planRows =
    source.kind === "mine"
      ? rows.filter(
          (r) =>
            r.made_by === source.memberId ||
            (byId.get(source.memberId)?.role === "Team Leader" &&
              teamLeaderOf(r.made_by, byId) === source.memberId)
        )
      : rows;
  /** the plan for a set of month keys (scope month) or the sprint's key */
  const plannedFor = (scope: "month" | "sprint", keys: string[]): number | null => {
    if (source.kind === "sheet") return plannedApprovals(source.cells, scope, keys);
    if (source.kind === "none") return null;
    // an MM files MONTHS; a sprint's share is half its month, rounded up (the
    // v33.56 rule every MM card already follows)
    if (scope === "sprint") {
      const monthKey = `${keys[0]?.slice(0, 7)}-01`;
      const m = source.monthly[monthKey];
      return m == null ? null : Math.ceil(m / 2);
    }
    const hit = keys.filter((k) => source.monthly[k] != null);
    return hit.length === 0 ? null : hit.reduce((a, k) => a + source.monthly[k], 0);
  };
  const inRange = (d: string, a?: string | null, b?: string | null) =>
    (!a || d >= a) && (!b || d <= b);
  const filtered = !!(input.window?.from || input.window?.to);
  const windowRows = filtered
    ? rows.filter((r) => inRange(r.approved_on, input.window?.from, input.window?.to))
    : rows.filter((r) => inRange(r.approved_on, peak.start, peak.end));

  const planWin = input.sprintMode ? sprint : month;
  const achievedIn = (w: { start: string; end: string }) =>
    rows.filter((r) => inRange(r.approved_on, w.start, w.end)).length;
  const planAchievedIn = (w: { start: string; end: string }) =>
    planRows.filter((r) => inRange(r.approved_on, w.start, w.end)).length;

  const lastMonthStart = (() => {
    const d = new Date(`${month.start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const lastMonthEnd = (() => {
    const d = new Date(`${month.start}T00:00:00Z`);
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  })();

  const monthKeys = peak.months.filter((m) => m <= month.start);
  const byMonth = monthKeys.map((m) => {
    const d = new Date(`${m}T00:00:00Z`);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
    return {
      month: m.slice(0, 7),
      label: MONTH_SHORT[d.getUTCMonth()],
      achieved: planAchievedIn({ start: m, end }),
      planned: plannedFor("month", [m]),
    };
  });

  const count = <K extends string>(keyOf: (r: LaneApprovalRow) => K | null) => {
    const m = new Map<K, number>();
    for (const r of windowRows) {
      const k = keyOf(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const products = count((r) => r.product);
  const sources = count((r) => r.source);
  const lcs = count((r) => (r.partner_lc_name ? r.partner_lc_name : null));
  const tallies = tallyApprovals(windowRows, input.members);

  return {
    planKind: source.kind,
    total: windowRows.length,
    totalLabel: filtered ? "in the filtered window" : peak.label,
    thisMonth: achievedIn(month),
    lastMonth: lastMonthStart < peak.start ? null : achievedIn({ start: lastMonthStart, end: lastMonthEnd }),
    plan: {
      mode: input.sprintMode ? "sprint" : "month",
      label: planWin.label,
      planned: plannedFor(input.sprintMode ? "sprint" : "month", planWin.planKeys),
      achieved: planAchievedIn(planWin),
    },
    peak: {
      label: peak.label,
      planned: plannedFor("month", peak.months),
      achieved: planAchievedIn({ start: peak.start, end: input.today < peak.end ? input.today : peak.end }),
    },
    byMonth,
    byProduct: APPROVAL_PRODUCTS.filter((p) => products.has(p)).map((p) => ({
      product: p,
      count: products.get(p)!,
    })),
    bySource: APPROVAL_SOURCES.filter((s) => sources.has(s.value)).map((s) => ({
      source: s.value,
      label: s.label,
      count: sources.get(s.value)!,
    })),
    topLcs: [...lcs.entries()]
      .map(([name, c]) => ({ name, count: c }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 8),
    people: tallies.people,
    mms: tallies.mms,
  };
}
