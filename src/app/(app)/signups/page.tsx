import { redirect } from "next/navigation";
import {
  b2cCicAccess, b2cCicCallerTargets,
  cicCallerTargets, getViewer, listSignupLogs, listSignupsPage, ogxPlanCard, seesB2cCicQueue, seesCicQueue,
  signupFilterOptions, signupReassignTargets,
  signupViewsFor,
  streakStats,
} from "@/server/data";
import { hasOgxAccess, ogxFunctions } from "@/lib/rbac";
import { SignupsView } from "@/components/crm/signups-view";
import type { OgxFunction, SignupLog } from "@/lib/types";
import { PAGE_SIZES, pageSizeOf } from "@/lib/page-size";

export const metadata = { title: "Sign-ups" };

/** Rows per page (?size) — the universal table kit's picker drives it. */
const DEFAULT_PAGE_SIZE = 100;

/** THE OGX WORKSPACE (v25): OGT & OGV sign-ups, two-way synced with the LC's
 *  tracker sheets. Main view = the unassigned pool — contact one, it's yours. */
export default async function SignupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  // B2C (v33.29) enters for its CIC queue — everything else stays OGX-gated
  const b2cOnly = !hasOgxAccess(viewer) && b2cCicAccess(viewer);
  if (!hasOgxAccess(viewer) && !b2cOnly) redirect("/");
  const fns: OgxFunction[] = b2cOnly ? ["OGT", "OGV"] : ogxFunctions(viewer);
  const sp = await searchParams;

  // DID THEY PICK A SIDE, or are we defaulting? It matters for B2C: their
  // queue spans BOTH OGX sides, so defaulting to fns[0] would have hidden
  // every OGV sign-up (436 of the 668 live candidates) behind a chip nobody
  // knew to press. An OGX viewer keeps the old behaviour — they own one side.
  const explicitFn: OgxFunction | null = fns.includes((sp.fn ?? "") as OgxFunction)
    ? (sp.fn as OgxFunction)
    : null;
  const activeFn: OgxFunction = explicitFn ?? fns[0];
  const fnAll = b2cOnly && !explicitFn;

  const page = Math.max(0, (parseInt(sp.page ?? "1", 10) || 1) - 1);
  // rows per page — anything off the list falls back to the default (a
  // hand-typed ?size can't ask the DB for 10k rows)
  const size = pageSizeOf(sp.size);
  const [result, planCard, streak] = await Promise.all([
    listSignupsPage(
      viewer,
      {
        view: sp.view,
        fn: fnAll ? undefined : activeFn,
        batch: sp.batch,
        program: sp.program,
        status: sp.status,
        potential: sp.potential,
        interested: sp.interested,
        contacted: sp.contacted,
        country: sp.country,
        personStatus: sp.personStatus,
        assigned: sp.assigned,
        campaign: sp.campaign,
        cicMine: sp.cicMine === "1",
        // validated in listSignupsPage, which also understands a comma list
        phone: sp.phone,
        q: sp.q,
        sort: sp.sort,
        dir: sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined,
      },
      page,
      size
    ),
    ogxPlanCard(viewer),
    streakStats(viewer, sp.streak),
  ]);

  const isLeader = viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
  // CIC (v33.19) is handed out by MMs and above — Coordinators included, who
  // are NOT part of the reassign flow. One fetch, two audiences: `targets`
  // keeps its exact old meaning (the bulk/reassign pickers), `cicTargets`
  // feeds the second-caller picker.
  const canCic = !b2cOnly && seesCicQueue(viewer);
  const canB2cCic = seesB2cCicQueue(viewer);
  const needsTargets = !b2cOnly && (isLeader || viewer.role === "Team Leader");
  // two DIFFERENT questions: who may own a sign-up (reassign scope) vs who may
  // make the verification call (the whole function — a Coordinator must be
  // able to hand it to someone other than themselves)
  const [targets, cicTargets, b2cTargets] = await Promise.all([
    needsTargets ? signupReassignTargets(viewer, activeFn) : Promise.resolve([]),
    canCic ? cicCallerTargets(viewer, activeFn) : Promise.resolve([]),
    canB2cCic ? b2cCicCallerTargets(viewer) : Promise.resolve([]),
  ]);

  /** One sign-up's edit history for the detail dialog — an inline Server
   *  Function (Next 16's `use server` at the top of a function body). The
   *  viewer is read from the session HERE and `listSignupLogs` re-checks the
   *  sign-up against their scope, so the id is the only thing the client
   *  gets to choose. */
  async function loadSignupLogs(signupId: string): Promise<SignupLog[]> {
    "use server";
    const v = await getViewer();
    return listSignupLogs(v, signupId);
  }

  return (
    <SignupsView
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={size}
      pageSizeOptions={PAGE_SIZES}
      activeView={result.view}
      views={signupViewsFor(viewer)}
      filterOptions={await signupFilterOptions(viewer, activeFn)}
      fns={fns}
      activeFn={activeFn}
      fnAll={fnAll}
      targets={targets}
      cicTargets={cicTargets}
      b2cTargets={b2cTargets}
      loadLogs={loadSignupLogs}
      planCard={planCard}
      streak={streak}
      viewer={{
        id: viewer.id,
        name: viewer.name,
        isLeader,
        isTl: viewer.role === "Team Leader",
        canCic,
        canB2cCic,
        b2cOnly,
        canVp:
          viewer.isAdmin ||
          viewer.role === "LCP" ||
          ((viewer.role === "LCVP" || viewer.role === "Director") && fns.includes(activeFn)),
      }}
      filters={{
        q: sp.q ?? "",
        batch: sp.batch ?? "",
        personStatus: sp.personStatus ?? "",
        assigned: sp.assigned ?? "",
        campaign: sp.campaign ?? "",
        cicMine: sp.cicMine ?? "",
        program: sp.program ?? "",
        status: sp.status ?? "",
        potential: sp.potential ?? "",
        interested: sp.interested ?? "",
        contacted: sp.contacted ?? "",
        phone: sp.phone ?? "",
        sort: sp.sort ?? "",
        dir: sp.dir ?? "",
      }}
    />
  );
}
