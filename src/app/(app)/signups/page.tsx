import { redirect } from "next/navigation";
import {
  getViewer, listSignupsPage, ogxPlanCard, signupReassignTargets, signupViewsFor,
  streakStats,
} from "@/server/data";
import { hasOgxAccess, ogxFunctions } from "@/lib/rbac";
import { SignupsView } from "@/components/crm/signups-view";
import type { OgxFunction } from "@/lib/types";

export const metadata = { title: "Sign-ups" };

/** THE OGX WORKSPACE (v25): OGT & OGV sign-ups, two-way synced with the LC's
 *  tracker sheets. Main view = the unassigned pool — contact one, it's yours. */
export default async function SignupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  if (!hasOgxAccess(viewer)) redirect("/");
  const fns = ogxFunctions(viewer);
  const sp = await searchParams;

  const activeFn: OgxFunction = fns.includes((sp.fn ?? "") as OgxFunction)
    ? (sp.fn as OgxFunction)
    : fns[0];

  const page = Math.max(0, (parseInt(sp.page ?? "1", 10) || 1) - 1);
  const [result, planCard, streak] = await Promise.all([
    listSignupsPage(
      viewer,
      {
        view: sp.view,
        fn: activeFn,
        batch: sp.batch,
        program: sp.program,
        status: sp.status,
        potential: sp.potential,
        interested: sp.interested,
        contacted: sp.contacted,
        country: sp.country,
        phone: sp.phone === "missing" || sp.phone === "has" ? sp.phone : undefined,
        q: sp.q,
        sort: sp.sort,
        dir: sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined,
      },
      page
    ),
    ogxPlanCard(viewer),
    streakStats(viewer),
  ]);

  const isLeader = viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
  const targets = isLeader || viewer.role === "Team Leader"
    ? await signupReassignTargets(viewer, activeFn)
    : [];

  return (
    <SignupsView
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={100}
      activeView={result.view}
      views={signupViewsFor(viewer)}
      fns={fns}
      activeFn={activeFn}
      targets={targets}
      planCard={planCard}
      streak={streak}
      viewer={{
        id: viewer.id,
        name: viewer.nickname || viewer.name,
        isLeader,
        isTl: viewer.role === "Team Leader",
        canVp:
          viewer.isAdmin ||
          viewer.role === "LCP" ||
          ((viewer.role === "LCVP" || viewer.role === "Director") && fns.includes(activeFn)),
      }}
      filters={{
        q: sp.q ?? "",
        batch: sp.batch ?? "",
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
