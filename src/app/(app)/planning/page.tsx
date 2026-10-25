import { gateTab } from "@/server/tabs";
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
  // the code rule here is canSeePlanning, NOT canOpenPlanning: a master with
  // no planned function still passes the gate and meets the empty state below
  // rather than a bounce — the tab and home use canOpenPlanning, so nobody is
  // SENT here to meet it
  const leads = canSeePlanning(viewer);
  await gateTab(viewer, "/planning", leads);

  // LCP/admin see all six lanes; VPs/Directors just their own family pair(s).
  const fns: PlanFunction[] =
    viewer.isAdmin || viewer.role === "LCP"
      ? [...PLAN_FUNCTIONS]
      : planFunctionsFor(viewer.functions);
  // NO PLANNED FUNCTION (v38.3) — an empty state, never a redirect: this
  // page used to send them to "/", and "/" sent a person the tab rules had
  // opened Planning to straight back here, forever. Planning is not
  // widened to every lane for them either.
  if (fns.length === 0)
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-bold">Planning</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No planning lanes for your function yet — the planning sheet covers IGV, IGT, OGV and OGT.
        </p>
      </div>
    );

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
  // OPENED BY A TAB RULE (v38.3), not by the code: the lane plan is theirs to
  // read (every lane member already sees it on the dashboard's plan card),
  // but the MM plans are each MM's own numbers, which only the function's
  // leaders read — so only their OWN plan rides along. Defence in depth
  // behind Settings → Tabs, whatever audience a rule names.
  const ownOnly = leads ? undefined : [viewer.id];
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
    listMmPlans(ownOnly, mmScope),
    listTlPlans(ownOnly, mmScope),
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
