import { getViewer, getDashboard, listTeamLeaders, listVisibleMembers } from "@/server/data";
import type { AccountFilters } from "@/server/data";
import { accountScope, icxFunctions, isB2B } from "@/lib/rbac";
import { memberIsB2B } from "@/lib/types";
import { DashboardView, type DashboardScopeView } from "@/components/crm/dashboard-view";

export const metadata = { title: "Dashboard" };

/** fn URL param → query filters. IGTa/IGTe are IGT product lanes. */
function parseFnParam(fn?: string): Pick<AccountFilters, "fn" | "product"> {
  if (fn === "IGV") return { fn: "IGV" };
  if (fn === "IGT") return { fn: "IGT" };
  if (fn === "IGTa") return { fn: "IGT", product: "GTa" };
  if (fn === "IGTe") return { fn: "IGT", product: "GTe" };
  if (fn === "B2B") return { fn: "B2B" };
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
  // IGT members see All IGT + IGTa + IGTe; the B2B/BD crew sees ONLY their
  // B2B lane (v15 isolation); LCP / admins see everything. IGV/IGT VPs and
  // Directors also get the B2B lane — B2B raises for their functions.
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
  if (
    master ||
    isB2B(viewer) ||
    ((viewer.role === "LCVP" || viewer.role === "Director") && fns.length > 0)
  ) {
    views.push({ key: "B2B", label: "B2B" });
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
    ["B2B", "BD"].some(
      (f) => (m.functions ?? []).includes(f) || (m.sub_functions ?? []).includes(f)
    );
  const memberOptions = members
    .filter((m) => m.role !== "LCP")
    .filter((m) =>
      isB2BMember(m) ||
      (laneFn
        ? (m.functions ?? []).includes(laneFn)
        : (m.functions ?? []).some((f) => f === "IGV" || f === "IGT"))
    )
    .map((m) => ({ id: m.id, label: m.nickname || m.name }));

  // BD & B2B are one function shown under ONE name: "B2B"
  const fnNames = [...icxFunctions(viewer), ...(isB2B(viewer) ? ["B2B"] : [])];
  const scopeLabel =
    viewer.isAdmin || viewer.role === "LCP"
      ? "Whole LC"
      : viewer.role === "LCVP" || viewer.role === "Director"
        ? `${fnNames.join(" & ") || viewer.functions.join(" & ")} function`
        : viewer.role === "Team Leader"
          ? viewer.team_name || "Your team"
          : `${fnNames.join(" & ")} — your function's picture`;

  // goal-setting powers: goals live on the IGV / IGTa / IGTe / B2B lanes —
  // the IGT lane shows the derived sum (IGTa + IGTe). The B2B goal belongs to
  // the B2B/BD VP or Director (the function-leaders team's leader), never to
  // its TLs.
  const laneForGoal =
    activeFn === "IGV" || activeFn === "IGTa" || activeFn === "IGTe" || activeFn === "B2B"
      ? activeFn
      : null;
  const canSetFunctionGoal =
    !!laneForGoal &&
    (viewer.isAdmin ||
      viewer.role === "LCP" ||
      ((viewer.role === "LCVP" || viewer.role === "Director") &&
        (laneForGoal === "B2B"
          ? memberIsB2B(viewer)
          : viewer.functions.includes(laneForGoal === "IGV" ? "IGV" : "IGT"))));
  // team goals need an actual team — a TL with no members has none to steer
  const leadsTeam =
    viewer.role === "Team Leader" && members.some((m) => m.stakeholder_id === viewer.id);
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
      funcAchieved={data.funcAchieved}
      funcGoal={data.funcGoal}
      lanePlan={data.lanePlan}
      bdGoal={data.bdGoal}
      bdMoneyAchieved={data.bdMoneyAchieved}
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
      viewerId={viewer.id}
      filters={{
        team: params.team ?? "",
        member: params.member ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
      }}
      goalCaps={{
        functionGoalFn: canSetFunctionGoal ? laneForGoal : null,
        bdMoneyGoal: canSetFunctionGoal && activeFn === "B2B",
        teamGoal: leadsTeam,
        teamLeaderId: leadsTeam
          ? viewer.id
          : viewer.role !== "Team Leader"
            ? data.teamLeadId
            : null,
        teamLabel: leadsTeam
          ? viewer.team_name || "My team"
          : teamLead
            ? teamLead.team_name || `Team ${teamLead.nickname || teamLead.name}`
            : null,
      }}
    />
  );
}
