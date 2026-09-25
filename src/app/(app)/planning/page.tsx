import { redirect } from "next/navigation";
import { getViewer, laneOpensActual, listMmPlans, listPlanCells, listTlPlans } from "@/server/data";
import { canSeePlanning } from "@/lib/rbac";
import {
  PLAN_FUNCTIONS,
  isOgxPlanFn,
  monthOf,
  peakForPlanning,
  planFunctionsFor,
  quarterOf,
  sprintOf,
  type PlanFunction,
} from "@/lib/plan";
import { PlanningView } from "@/components/crm/planning-view";
import { approvalsByWindow } from "@/server/icx-approvals";

export const metadata = { title: "Planning" };

/** The VP planning cockpit (v21): the imported "Alexandria | Planning Tool"
 *  sheet (plan_cells) vs the opens actually raised, plus the MM plans filed
 *  on first sign-in. Leadership only (canSeePlanning). */
export default async function PlanningPage() {
  const viewer = await getViewer();
  if (!canSeePlanning(viewer)) redirect("/");

  // LCP/admin see all six lanes; VPs/Directors just their own family pair(s).
  const fns: PlanFunction[] =
    viewer.isAdmin || viewer.role === "LCP"
      ? [...PLAN_FUNCTIONS]
      : planFunctionsFor(viewer.functions);
  if (fns.length === 0) redirect("/");

  const sprint = sprintOf();
  const month = monthOf();
  const quarter = quarterOf();
  const peak = peakForPlanning();

  // Actuals exist for ICX lanes only — OGX has no signup tracking in Sodio yet.
  const hasIcx = fns.some((f) => !isOgxPlanFn(f));
  const opts = { includeTest: !!viewer.testMode };
  // v25: a VP/Director sees only THEIR function's MM plans (LCP/admin: all)
  const mmScope =
    viewer.isAdmin || viewer.role === "LCP" ? undefined : viewer.functions;
  // 🏆 approvals achieved (v37) — the same windows, from icx_approvals
  const y0 = Number(month.start.slice(0, 4));
  const m0 = Number(month.start.slice(5, 7));
  const termStart = `${m0 >= 2 ? y0 : y0 - 1}-02-01`;
  const termEnd = `${m0 >= 2 ? y0 + 1 : y0}-01-31`;
  const peakEnd = (() => {
    const last = peak.months[peak.months.length - 1];
    const d = new Date(`${last}T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  })();
  const approvalWindows = hasIcx
    ? await approvalsByWindow({
        sprint: sprint,
        month: month,
        quarter: quarter,
        peak: { start: peak.months[0], end: peakEnd },
        term: { start: termStart, end: termEnd },
      }).catch(() => null)
    : null;
  const [cells, mmPlans, tlPlans, sprintActual, monthActual, quarterActual] = await Promise.all([
    listPlanCells(fns),
    listMmPlans(undefined, mmScope),
    listTlPlans(undefined, mmScope),
    hasIcx ? laneOpensActual(sprint.start, sprint.end, opts) : Promise.resolve(null),
    hasIcx ? laneOpensActual(month.start, month.end, opts) : Promise.resolve(null),
    hasIcx ? laneOpensActual(quarter.start, quarter.end, opts) : Promise.resolve(null),
  ]);

  // The running term (Feb → Jan) as first-of-month keys — S2 = the last six.
  const y = Number(month.start.slice(0, 4));
  const m = Number(month.start.slice(5, 7));
  const startYear = m >= 2 ? y : y - 1;
  const termMonths = Array.from({ length: 12 }, (_, i) => {
    const mo = 2 + i; // 2..13
    const yy = mo > 12 ? startYear + 1 : startYear;
    const mm = ((mo - 1) % 12) + 1;
    return `${yy}-${String(mm).padStart(2, "0")}-01`;
  });

  return (
    <PlanningView
      fns={fns}
      cells={cells}
      mmPlans={mmPlans}
      tlPlans={tlPlans}
      sprint={sprint}
      month={month}
      quarter={quarter}
      termMonths={termMonths}
      peak={{ label: peak.label, months: peak.months }}
      actuals={{ sprint: sprintActual, month: monthActual, quarter: quarterActual }}
      approvalActuals={approvalWindows}
    />
  );
}
