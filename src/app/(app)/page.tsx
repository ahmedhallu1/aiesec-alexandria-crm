import { getViewer, getDashboard, listTeamLeaders, listVisibleMembers } from "@/server/data";
import type { AccountFilters } from "@/server/data";
import { accountScope, icxFunctions } from "@/lib/rbac"; // icxFunctions is B2B-aware
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
  // IGT members see All IGT + IGTa + IGTe; members with both functions (and
  // LCP / LCVPs / admins) see everything.
  const scope = accountScope(viewer);
  const master = scope.kind === "all";
  const fns: ("IGV" | "IGT")[] = master ? ["IGV", "IGT"] : icxFunctions(viewer);
  const views: DashboardScopeView[] = [];
  if (fns.includes("IGV") && fns.includes("IGT")) views.push({ key: "all", label: "All ICX" });
  if (fns.includes("IGV")) views.push({ key: "IGV", label: "IGV" });
  if (fns.includes("IGT")) {
    views.push(
      { key: "IGT", label: "All IGT" },
      { key: "IGTa", label: "IGTa" },
      { key: "IGTe", label: "IGTe" }
    );
  }

  const defaultView = views[0]?.key ?? "all";
  const requestedFn =
    params.fn && views.some((v) => v.key === params.fn) ? params.fn : undefined;
  const activeFn = requestedFn ?? defaultView;
  const filters: AccountFilters = {
    ...parseFnParam(activeFn === "all" ? undefined : activeFn),
    teamId: params.team || undefined,
    responsibleId: params.member || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
  };

  const [data, teamLeaders, members] = await Promise.all([
    getDashboard(viewer, filters, activeFn),
    listTeamLeaders(viewer),
    listVisibleMembers(viewer),
  ]);

  // Member filter: only people with access to the active lane — and never the
  // LCP (they don't do market research or operations). B2B people raise for
  // every lane, so they always show.
  const laneFn = filters.fn ?? null;
  const isB2BMember = (m: (typeof members)[number]) =>
    (m.functions ?? []).includes("B2B") || (m.sub_functions ?? []).includes("B2B");
  const memberOptions = members
    .filter((m) => m.role !== "LCP")
    .filter((m) =>
      isB2BMember(m) ||
      (laneFn
        ? (m.functions ?? []).includes(laneFn)
        : (m.functions ?? []).some((f) => f === "IGV" || f === "IGT"))
    )
    .map((m) => ({ id: m.id, label: m.nickname || m.name }));

  const scopeLabel =
    viewer.isAdmin || viewer.role === "LCP"
      ? "Whole LC"
      : viewer.role === "LCVP" || viewer.role === "Director"
        ? `${viewer.functions.join(" & ")} function`
        : viewer.role === "Team Leader"
          ? viewer.team_name || "Your team"
          : `${icxFunctions(viewer).join(" & ")} — your function's picture`;

  // goal-setting powers: goals are set on IGV / IGTa / IGTe lanes only —
  // the IGT lane shows the derived sum (IGTa + IGTe)
  const laneForGoal =
    activeFn === "IGV" || activeFn === "IGTa" || activeFn === "IGTe" ? activeFn : null;
  const parentFn = laneForGoal === "IGV" ? "IGV" : "IGT";
  const canSetFunctionGoal =
    !!laneForGoal &&
    (viewer.isAdmin ||
      viewer.role === "LCP" ||
      ((viewer.role === "LCVP" || viewer.role === "Director") &&
        viewer.functions.includes(parentFn)));
  const teamLead = data.teamLeadId
    ? members.find((m) => m.id === data.teamLeadId)
    : null;

  return (
    <DashboardView
      total={data.total}
      byFunction={data.byFunction}
      byTeam={data.byTeam}
      memberBoard={data.memberBoard}
      mmBoard={data.mmBoard}
      teamBoard={data.teamBoard}
      teamAchieved={data.teamAchieved}
      funcGoal={data.funcGoal}
      teamGoal={data.teamGoal}
      views={views}
      activeFn={activeFn}
      laneLabel={activeFn === "all" ? "ICX" : activeFn}
      scopeLabel={scopeLabel}
      showTeamDrill={teamLeaders.length > 0}
      teamOptions={teamLeaders.map((t) => ({
        id: t.id,
        label: t.team_name || `Team ${t.nickname || t.name}`,
      }))}
      memberOptions={memberOptions}
      filters={{
        team: params.team ?? "",
        member: params.member ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
      }}
      goalCaps={{
        functionGoalFn: canSetFunctionGoal ? laneForGoal : null,
        teamGoal: viewer.role === "Team Leader",
        teamLeaderId:
          viewer.role === "Team Leader" ? viewer.id : data.teamLeadId,
        teamLabel:
          viewer.role === "Team Leader"
            ? viewer.team_name || "My team"
            : teamLead
              ? teamLead.team_name || `Team ${teamLead.nickname || teamLead.name}`
              : null,
      }}
    />
  );
}
