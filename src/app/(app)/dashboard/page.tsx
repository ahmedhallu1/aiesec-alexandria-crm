import {
  b2cCicStats, considerationStats, getViewer, getDashboard, listVisibleMembers,
  listTeamFilterOptions, memberWorksFunction, ogxDashboard, streakStats,
  type OgxLane } from "@/server/data";
import type { AccountFilters } from "@/server/data";
import { icxFunctions, isB2B, isB2C, ogxLanes } from "@/lib/rbac";
import { tmStats } from "@/server/tm-stats";
import { memberIsB2C, teamLabel } from "@/lib/types";
import { isOgxLaneKey } from "@/lib/dashboard-funnel";
import { DashboardView, type DashboardScopeView } from "@/components/crm/dashboard-view";
import { dashboardLaneViews } from "@/lib/dashboard-lanes";

export const metadata = { title: "Dashboard" };

/** fn URL param → query filters. IGTa/IGTe are IGT product lanes. */
function parseFnParam(fn?: string): Pick<AccountFilters, "fn" | "product"> {
  if (fn === "IGV") return { fn: "IGV" };
  if (fn === "IGT") return { fn: "IGT" };
  if (fn === "IGTa") return { fn: "IGT", product: "GTa" };
  if (fn === "IGTe") return { fn: "IGT", product: "GTe" };
  if (fn === "B2B") return { fn: "B2B" };
  if (fn === "BD") return { fn: "BD" };
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
  // v32 — every lane is named for the SIDE it shows, and each side is gated
  // on the work the viewer actually does:
  //   Member / Coordinator / Team Leader → the side(s) their Sub Function
  //     column names (Raising, Consideration, or both)
  //   LCVP / Director  → both sides of THEIR product function
  //   nobody           → the other product's lanes
  //   LCP/admin + the TM and F&L leadership → everything
  const views: DashboardScopeView[] = dashboardLaneViews(viewer);
  const ogxFns = ogxLanes(viewer);
  // MY DEFAULT LANE (v37.2) — the lane a person picked in their settings,
  // while it is still one of theirs; else the first lane, as before
  const { resolveMemberSettings } = await import("@/lib/member-settings");
  const myLane = resolveMemberSettings((viewer as { settings?: unknown }).settings).defaults.dashboardLane;
  const defaultView =
    (myLane && views.some((v) => v.key === myLane) ? myLane : null) ?? views[0]?.key ?? "all";
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

  // CONS_* / OGT / OGV are pseudo-lanes — getDashboard never receives them:
  // it runs on the viewer's first REAL account lane (or "all", which for a
  // pure-OGX viewer scopes to their own — empty — accounts and returns fast)
  const SPECIAL_LANES = new Set(["CONS", "CONS_IGV", "CONS_IGT", "OGT", "OGV", "OGX", "TM"]);
  const baseLane = views.find((v) => !SPECIAL_LANES.has(v.key))?.key ?? "all";
  const isOgxLane = isOgxLaneKey(activeFn);
  const consLane: "IGV" | "IGT" | null =
    activeFn === "CONS_IGV" ? "IGV" : activeFn === "CONS_IGT" ? "IGT" : null;

  const [data, teamFilterOptions, members, consideration, ogx, streak, tm, b2cCic] = await Promise.all([
    getDashboard(viewer, filters, SPECIAL_LANES.has(activeFn) ? baseLane : activeFn),
    listTeamFilterOptions(viewer, { fn: filters.fn ?? undefined }),
    listVisibleMembers(viewer),
    // the filter bar reaches the IR floor too (v33.32) — same params, matched
    // against the CALL's own time and its owner
    consLane
      ? considerationStats(viewer, consLane, {
          from: params.from || undefined,
          to: params.to || undefined,
          member: params.member || undefined,
          team: params.team || undefined,
        })
      : Promise.resolve(null),
    isOgxLane
      ? ogxDashboard(viewer, activeFn as OgxLane, {
          from: params.from || undefined,
          to: params.to || undefined,
          team: params.team || undefined,
          member: params.member || undefined,
        })
      : Promise.resolve(null),
    // the OGV contact streak (v27) belongs on the OGV lane, for the whole crew —
    // it lived only on /signups before. `streakStats` decides who has one
    // (it returns null for anyone it doesn't consider an OGV streak player).
    isOgxLane ? streakStats(viewer, activeFn) : Promise.resolve(null),
    activeFn === "TM" ? tmStats(viewer) : Promise.resolve(null),
    // the B2C lane's CIC card (v33.29): what the selling side is doing with
    // the sign-up pool
    activeFn === "B2C" ? b2cCicStats(viewer) : Promise.resolve(null),
  ]);

  // Member filter = the people whose accounts are actually IN this lane, and
  // whose numbers are a SUBSET of what's already on screen (v33.1):
  //
  //  - scoped to the lane's own function. `rowInLane` matches on the account's
  //    function, so a B2B member has no rows in the IGV lane — offering them
  //    there just emptied the dashboard. (B2B/BD still show on their own lane.)
  //  - no LCP, and no VP or Director: the whole function is theirs already, so
  //    "filter to them" is the picture the viewer is looking at.
  const laneFn = filters.fn ?? null;
  const OVERSEER_ROLES = new Set(["LCP", "LCVP", "Director", "Admin"]);
  const memberOptions = members
    .filter((m) => !OVERSEER_ROLES.has(m.role))
    .filter((m) =>
      // a CONSIDERATION lane lists the people who make its calls (v33.32) —
      // the product's crew whose sub-function says Consideration, not every
      // raiser in the function
      consLane
        ? memberWorksFunction(m, consLane) &&
          [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes("Consideration")
        : laneFn === "B2C"
          ? memberIsB2C(m) // the B2C lane lists ONLY the B2C crew (v23)
          : laneFn
            ? memberWorksFunction(m, laneFn)
            : // All-ICX: the raising products (B2C and OGX are their own lanes)
              ["IGV", "IGT", "B2B", "BD"].some((f) => memberWorksFunction(m, f))
    )
    .map((m) => ({ id: m.id, label: m.name }));

  // BD & B2B are one function shown under ONE name: "B2B"
  const fnNames = [
    ...icxFunctions(viewer),
    ...(isB2B(viewer) ? ["B2B"] : []),
    ...(isB2C(viewer) ? ["B2C"] : []),
    ...ogxFns,
  ];
  const scopeLabel =
    viewer.isAdmin || viewer.role === "LCP"
      ? "Whole LC"
      : viewer.role === "LCVP" || viewer.role === "Director"
        ? `${fnNames.join(" & ") || viewer.functions.join(" & ")} function`
        : viewer.role === "Team Leader"
          ? teamLabel(viewer.name)
          : `${fnNames.join(" & ")} — your function's picture`;

  // v22: goals are never set in-app — the lane goal comes from the VPs'
  // planning sheet (PlanCard) and the team goal from the TL's filed plan.
  const teamLead = data.teamLeadId
    ? members.find((m) => m.id === data.teamLeadId)
    : null;
  // A TEAM IS ITS LEADER (v33.53) — no registry lookup left to do.
  const teamCardLabel =
    viewer.role === "Team Leader"
      ? teamLabel(viewer.name)
      : teamLead
        ? teamLabel(teamLead.name)
        : null;
  // leaders already see the whole function — "My numbers" is for the people
  // who actually carry accounts (members, coordinators, TLs)
  const showMyNumbers =
    !viewer.isAdmin && !["LCP", "LCVP", "Director"].includes(viewer.role);

  return (
    <DashboardView
      consideration={consideration}
      ogx={ogx}
      streak={streak}
      tm={tm}
      total={data.total}
      byFunction={data.byFunction}
      byTeam={data.byTeam}
      memberBoard={data.memberBoard}
      mmBoard={data.mmBoard}
      teamBoard={data.teamBoard}
      lanePlan={data.lanePlan}
      teamPlan={data.teamPlan}
      termPlan={data.termPlan}
      teamLabel={teamCardLabel}
      views={views}
      activeFn={activeFn}
      // the chip's own label IS the heading — "IGV Raising Dashboard",
      // "IGT Consideration Dashboard" — never the raw key ("CONS_IGV")
      laneLabel={
        activeFn === "all"
          ? "ICX"
          : (views.find((v) => v.key === activeFn)?.label ?? activeFn)
      }
      scopeLabel={scopeLabel}
      showTeamDrill={members.some(
        (m) => m.role === "Team Leader" || m.role === "Coordinator"
      )}
      teamOptions={
        isOgxLane && ogx
          ? ogx.teamOptions
          : teamFilterOptions
      }
      memberOptions={isOgxLane && ogx ? ogx.memberOptions : memberOptions}
      viewerId={viewer.id}
      showMyNumbers={showMyNumbers}
      isB2cLane={activeFn === "B2C"}
      b2cCic={b2cCic}
      filters={{
        team: params.team ?? "",
        member: params.member ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
      }}
    />
  );
}
