import { getViewer, getDashboard, listTeamLeaders, listVisibleMembers } from "@/server/data";
import type { AccountFilters } from "@/server/data";
import { accountScope, icxFunctions } from "@/lib/rbac";
import { DashboardView, type DashboardScopeView } from "@/components/crm/dashboard-view";

export const metadata = { title: "Dashboard" };

/** fn URL param → query filters. IGTa/IGTe are IGT product lanes. */
function parseFnParam(fn?: string): Pick<AccountFilters, "fn" | "product"> {
  if (fn === "IGV") return { fn: "IGV" };
  if (fn === "IGT") return { fn: "IGT" };
  if (fn === "IGTa") return { fn: "IGT", product: "GTa" };
  if (fn === "IGTe") return { fn: "IGT", product: "GTe" };
  return {};
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  const params = await searchParams;

  // Which lanes may this viewer switch between? IGV members see IGV only;
  // IGT members see IGTa + IGTe; members with both functions (and LCP /
  // LCVPs / admins) see everything.
  const scope = accountScope(viewer);
  const fns: ("IGV" | "IGT")[] =
    scope.kind === "all" ? ["IGV", "IGT"] : icxFunctions(viewer);
  const views: DashboardScopeView[] = [];
  if (fns.includes("IGV") && fns.includes("IGT")) views.push({ key: "all", label: "All ICX" });
  if (fns.includes("IGV")) views.push({ key: "IGV", label: "IGV" });
  if (fns.includes("IGT")) {
    if (!fns.includes("IGV")) views.push({ key: "IGT", label: "All IGT" });
    views.push({ key: "IGTa", label: "IGTa" }, { key: "IGTe", label: "IGTe" });
  }

  const requestedFn =
    params.fn && views.some((v) => v.key === params.fn) ? params.fn : undefined;
  const filters: AccountFilters = {
    ...parseFnParam(requestedFn),
    teamId: params.team || undefined,
    responsibleId: params.member || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
  };
  // single-function members always stay inside their function
  if (!filters.fn && fns.length === 1) filters.fn = fns[0];

  const [data, teamLeaders, members] = await Promise.all([
    getDashboard(viewer, filters),
    listTeamLeaders(viewer),
    listVisibleMembers(viewer),
  ]);

  const scopeLabel =
    viewer.isAdmin || viewer.role === "LCP"
      ? "Whole LC"
      : viewer.role === "LCVP" || viewer.role === "Director"
        ? `${viewer.functions.join(" & ")} function`
        : viewer.role === "Team Leader"
          ? viewer.team_name || "Your team"
          : "Your accounts";

  return (
    <DashboardView
      total={data.total}
      byFunction={data.byFunction}
      byTeam={data.byTeam}
      byMember={data.byMember}
      goals={data.goals}
      views={views}
      activeFn={requestedFn ?? (views.length > 0 ? views[0].key : "all")}
      scopeLabel={scopeLabel}
      showTeamDrill={!["Member", "Coordinator"].includes(viewer.role)}
      teamOptions={teamLeaders.map((t) => ({
        id: t.id,
        label: t.team_name || `Team ${t.nickname || t.name}`,
      }))}
      memberOptions={members.map((m) => ({ id: m.id, label: m.nickname || m.name }))}
      filters={{
        team: params.team ?? "",
        member: params.member ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
      }}
    />
  );
}
