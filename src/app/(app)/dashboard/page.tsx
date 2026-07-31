import {
  considerationStats, getViewer, getDashboard, listTeamLeaders, listVisibleMembers } from "@/server/data";
import type { AccountFilters } from "@/server/data";
import {
  hasConsiderationAccess, accountScope, icxFunctions, isB2B, isB2C } from "@/lib/rbac";
import { memberIsB2C } from "@/lib/types";
import { DashboardView, type DashboardScopeView } from "@/components/crm/dashboard-view";

export const metadata = { title: "Dashboard" };

/** fn URL param → query filters. IGTa/IGTe are IGT product lanes. */
function parseFnParam(fn?: string): Pick<AccountFilters, "fn" | "product"> {
  if (fn === "IGV") return { fn: "IGV" };
  if (fn === "IGT") return { fn: "IGT" };
  if (fn === "IGTa") return { fn: "IGT", product: "GTa" };
  if (fn === "IGTe") return { fn: "IGT", product: "GTe" };
  if (fn === "B2B") return { fn: "B2B" };
  if (fn === "B2C") return { fn: "B2C" };
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
  // B2C is its own module (v23): only its crew + the LCP/admin get the lane
  if (master || isB2C(viewer)) {
    views.push({ key: "B2C", label: "B2C" });
  }
  // Consideration (v27): IR calls + the CV pool — ICX VPs/Directors, the
  // consideration crew and the LCP get the lane
  if (hasConsiderationAccess(viewer)) {
    views.push({ key: "CONS", label: "Consideration" });
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

  const [data, teamLeaders, members, consideration] = await Promise.all([
    getDashboard(viewer, filters, activeFn === "CONS" ? views[0]?.key ?? "all" : activeFn),
    listTeamLeaders(viewer),
    listVisibleMembers(viewer),
    activeFn === "CONS" ? considerationStats(viewer) : Promise.resolve(null),
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
      laneFn === "B2C"
        ? memberIsB2C(m) // the B2C lane lists ONLY the B2C crew (v23)
        : isB2BMember(m) ||
          (laneFn
            ? (m.functions ?? []).includes(laneFn)
            : (m.functions ?? []).some((f) => f === "IGV" || f === "IGT"))
    )
    .map((m) => ({ id: m.id, label: m.nickname || m.name }));

  // BD & B2B are one function shown under ONE name: "B2B"
  const fnNames = [
    ...icxFunctions(viewer),
    ...(isB2B(viewer) ? ["B2B"] : []),
    ...(isB2C(viewer) ? ["B2C"] : []),
  ];
  const scopeLabel =
    viewer.isAdmin || viewer.role === "LCP"
      ? "Whole LC"
      : viewer.role === "LCVP" || viewer.role === "Director"
        ? `${fnNames.join(" & ") || viewer.functions.join(" & ")} function`
        : viewer.role === "Team Leader"
          ? viewer.team_name || "Your team"
          : `${fnNames.join(" & ")} — your function's picture`;

  // v22: goals are never set in-app — the lane goal comes from the VPs'
  // planning sheet (PlanCard) and the team goal from the TL's filed plan.
  const teamLead = data.teamLeadId
    ? members.find((m) => m.id === data.teamLeadId)
    : null;
  const teamLabel =
    viewer.role === "Team Leader"
      ? viewer.team_name || "My team"
      : teamLead
        ? teamLead.team_name || `Team ${teamLead.nickname || teamLead.name}`
        : null;
  // leaders already see the whole function — "My numbers" is for the people
  // who actually carry accounts (members, coordinators, TLs)
  const showMyNumbers =
    !viewer.isAdmin && !["LCP", "LCVP", "Director"].includes(viewer.role);

  return (
    <DashboardView
      consideration={consideration}
      total={data.total}
      byFunction={data.byFunction}
      byTeam={data.byTeam}
      memberBoard={data.memberBoard}
      mmBoard={data.mmBoard}
      teamBoard={data.teamBoard}
      lanePlan={data.lanePlan}
      teamPlan={data.teamPlan}
      teamLabel={teamLabel}
      views={views}
      activeFn={activeFn}
      laneLabel={activeFn === "all" ? "ICX" : activeFn === "CONS" ? "Consideration" : activeFn}
      scopeLabel={scopeLabel}
      showTeamDrill={members.some(
        (m) => m.role === "Team Leader" || m.role === "Coordinator"
      )}
      teamOptions={teamLeaders.map((t) => ({
        id: t.id,
        label: t.team_name || `Team ${t.nickname || t.name}`,
      }))}
      memberOptions={memberOptions}
      viewerId={viewer.id}
      showMyNumbers={showMyNumbers}
      isB2cLane={activeFn === "B2C"}
      filters={{
        team: params.team ?? "",
        member: params.member ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
      }}
    />
  );
}
