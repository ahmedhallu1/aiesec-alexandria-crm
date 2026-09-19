/** Planning calendar math — term, peaks, sprints, quarters.
 *
 *  The AIESEC term runs February → January ("26.27" = Feb 2026 – Jan 2027).
 *  S1 = SUMMER peak = Feb–Jul (Q1 Feb-Apr, Q2 May-Jul).
 *  S2 = WINTER peak = Aug–Jan (Q3 Aug-Oct, Q4 Nov-Jan).
 *  Every month has exactly TWO sprints: Sprint 1 = day 1–15, Sprint 2 = 16–EOM.
 *  (Mirrors the LC's "Alexandria | Planning Tool" sheet — see plan_cells.)
 */

/** Functions covered by the imported VP plan's month/sprint funnel
 *  (TM deliberately out — its sheet tab plans internal member recruitment,
 *  not anything Sodio's accounts/signups data can be measured against). */
export const PLAN_FUNCTIONS = ["IGV", "IGTa", "IGTe", "OGV", "OGTa", "OGTe"] as const;
export type PlanFunction = (typeof PLAN_FUNCTIONS)[number];

export type PlanMetric =
  | "opens" | "signups" | "applicants" | "accepted"
  | "approvals" | "realised" | "finished" | "complete";

/** Funnel order per family: i* leads with opens (raising), o* with signups. */
export const PLAN_FUNNEL: Record<"icx" | "ogx", PlanMetric[]> = {
  icx: ["opens", "applicants", "accepted", "approvals", "realised", "finished", "complete"],
  ogx: ["signups", "applicants", "accepted", "approvals", "realised", "finished", "complete"],
};

export const METRIC_LABEL: Record<PlanMetric, string> = {
  opens: "Opens", signups: "Sign Ups", applicants: "Applicants",
  accepted: "Accepted", approvals: "Approvals", realised: "Realised",
  finished: "Finished", complete: "Complete",
};

export const isOgxPlanFn = (fn: PlanFunction) => fn.startsWith("O");

/** A member's plan-functions from their membership functions
 *  (IGT → IGTa+IGTe, OGT → OGTa+OGTe). */
export function planFunctionsFor(memberFns: string[]): PlanFunction[] {
  const out = new Set<PlanFunction>();
  for (const f of memberFns) {
    if (f === "IGV") out.add("IGV");
    if (f === "IGT") { out.add("IGTa"); out.add("IGTe"); }
    if (f === "OGV") out.add("OGV");
    if (f === "OGT") { out.add("OGTa"); out.add("OGTe"); }
  }
  return [...out];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const cairo = (d: Date) =>
  new Date(d.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));

export interface Period {
  start: string;  // ISO date (inclusive)
  end: string;    // ISO date (inclusive)
  label: string;
  /** plan_cells period_start keys covered by this period */
  planKeys: string[];
}

const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

function eom(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** The sprint containing `now` (Cairo time): day 1–15 or 16–EOM. */
export function sprintOf(now = new Date()): Period {
  const d = cairo(now);
  const y = d.getFullYear(), m0 = d.getMonth();
  const second = d.getDate() > 15;
  const start = `${y}-${String(m0 + 1).padStart(2, "0")}-${second ? "16" : "01"}`;
  const end = `${y}-${String(m0 + 1).padStart(2, "0")}-${second ? String(eom(y, m0)).padStart(2, "0") : "15"}`;
  return {
    start, end,
    label: `${MONTH_NAMES[m0]} · Sprint ${second ? 2 : 1} (${second ? "16" : "1"}–${second ? eom(y, m0) : 15})`,
    planKeys: [start],
  };
}

/** The month containing `now`. Its plan keys: the month cell + both sprints. */
export function monthOf(now = new Date()): Period {
  const d = cairo(now);
  const y = d.getFullYear(), m0 = d.getMonth();
  const mm = String(m0 + 1).padStart(2, "0");
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(eom(y, m0)).padStart(2, "0")}`,
    label: `${MONTH_NAMES[m0]} ${y}`,
    planKeys: [`${y}-${mm}-01`],
  };
}

/** Term quarter containing `now`: Q1 Feb-Apr · Q2 May-Jul · Q3 Aug-Oct · Q4 Nov-Jan. */
export function quarterOf(now = new Date()): Period & { q: 1 | 2 | 3 | 4 } {
  const d = cairo(now);
  const y = d.getFullYear(), m = d.getMonth() + 1; // 1-12
  // months since February (term start), wrapping January to the PREVIOUS Feb
  const offset = m >= 2 ? m - 2 : 11; // Jan = 11
  const q = (Math.floor(offset / 3) + 1) as 1 | 2 | 3 | 4;
  const startMonth = 2 + (q - 1) * 3; // 2,5,8,11
  const startYear = m >= 2 ? y : y - 1;
  const months: string[] = [];
  for (let i = 0; i < 3; i++) {
    const mo = startMonth + i;          // 2..13
    const yy = mo > 12 ? startYear + 1 : startYear;
    const mm = ((mo - 1) % 12) + 1;
    months.push(`${yy}-${String(mm).padStart(2, "0")}-01`);
  }
  const lastY = Number(months[2].slice(0, 4));
  const lastM0 = Number(months[2].slice(5, 7)) - 1;
  return {
    q,
    start: months[0],
    end: `${months[2].slice(0, 8)}${String(eom(lastY, lastM0)).padStart(2, "0")}`,
    label: `Q${q}`,
    planKeys: months,
  };
}

export interface Peak {
  name: "winter" | "summer";
  label: string;
  /** ISO first-of-month for the six peak months, in order. */
  months: string[];
  start: string;
  end: string;
}

function buildPeak(name: "winter" | "summer", anchorYear: number): Peak {
  // summer = Feb..Jul of anchorYear · winter = Aug..Jan (Jan of anchorYear+1)
  const firstMonth = name === "summer" ? 2 : 8;
  const months: string[] = [];
  for (let i = 0; i < 6; i++) {
    const mo = firstMonth + i;
    const yy = mo > 12 ? anchorYear + 1 : anchorYear;
    const mm = ((mo - 1) % 12) + 1;
    months.push(`${yy}-${String(mm).padStart(2, "0")}-01`);
  }
  const lastY = Number(months[5].slice(0, 4));
  const lastM0 = Number(months[5].slice(5, 7)) - 1;
  return {
    name,
    label: name === "winter"
      ? `Winter peak (Aug ${anchorYear} – Jan ${anchorYear + 1})`
      : `Summer peak (Feb – Jul ${anchorYear})`,
    months,
    start: months[0],
    end: `${months[5].slice(0, 8)}${String(eom(lastY, lastM0)).padStart(2, "0")}`,
  };
}

/** The peak containing `d` (calendar membership, no edge rule). */
export function peakOf(d = new Date()): Peak {
  const c = cairo(d);
  const y = c.getFullYear(), m = c.getMonth() + 1;
  if (m >= 2 && m <= 7) return buildPeak("summer", y);
  return buildPeak("winter", m === 1 ? y - 1 : y);
}

/** The peak a NEW MM should plan on sign-up: the current one — unless we're in
 *  its LAST month (July / January), when the next peak is the real target
 *  (a July signup plans the winter Aug–Jan peak — confirmed by Ahmed). */
export function peakForPlanning(signup = new Date()): Peak {
  const c = cairo(signup);
  const y = c.getFullYear(), m = c.getMonth() + 1;
  if (m === 7) return buildPeak("winter", y);                 // July → next winter
  if (m === 1) return buildPeak("summer", y);                 // January → next summer
  return peakOf(signup);
}

/** Human month label from an ISO first-of-month key. */
export function monthKeyLabel(key: string): string {
  const m0 = Number(key.slice(5, 7)) - 1;
  return `${MONTH_NAMES[m0]} ${key.slice(0, 4)}`;
}

/** Both sprint keys (1st + 16th) of an ISO month key. */
export function sprintKeysOfMonth(monthKey: string): [string, string] {
  return [monthKey, `${monthKey.slice(0, 8)}16`];
}

/** Whether `dateIso` falls inside [p.start, p.end]. */
export function inPeriod(dateIso: string, p: { start: string; end: string }): boolean {
  const d = dateIso.slice(0, 10);
  return d >= p.start && d <= p.end;
}

/** The year the current term's February belongs to (Cairo time) — a January
 *  date belongs to the term that started the PREVIOUS February. Mirrors the
 *  anchoring `importPlanningSheet` already uses for the 6-lane funnel. */
export function currentTermFebYear(d = new Date()): number {
  const c = cairo(d);
  return c.getMonth() === 0 ? c.getFullYear() - 1 : c.getFullYear();
}

/** ISO first-of-term (always February 1st) for a Feb-anchored term year. */
export function termStartIso(anchorFebYear: number): string {
  return `${anchorFebYear}-02-01`;
}

export { iso as isoDate };
