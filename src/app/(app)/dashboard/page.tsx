import {
  considerationStats, getViewer, getDashboard, listVisibleMembers,
  listTeamFilterOptions, ogxDashboard, streakStats } from "@/server/data";
import type { AccountFilters } from "@/server/data";
import {
  considerationFunctions, accountScope, icxFunctions, isB2B, isB2C,
  isBd, ogxLanes, raisingFunctions, seesEveryLane } from "@/lib/rbac";
import { memberIsB2C, type OgxFunction } from "@/lib/types";
import { DashboardView, type DashboardScopeView } from "@/components/crm/dashboard-view";

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
  const scope = accountScope(viewer);
  const master = scope.kind === "all";
  const raisingFns = raisingFunctions(viewer);
  const consFns = considerationFunctions(viewer);
  const overseer = seesEveryLane(viewer);
  const views: DashboardScopeView[] = [];
  if (raisingFns.includes("IGV") && raisingFns.includes("IGT"))
    views.push({ key: "all", label: "All ICX" });
  if (raisingFns.includes("IGV")) views.push({ key: "IGV", label: "IGV Raising" });
  if (consFns.includes("IGV"))
    views.push({ key: "CONS_IGV", label: "IGV Consideration" });
  if (raisingFns.includes("IGT")) {
    views.push(
      { key: "IGT", label: "IGT Raising" },
      { key: "IGTa", label: "IGTa Raising" },
      { key: "IGTe", label: "IGTe Raising" }
    );
  }
  if (consFns.includes("IGT"))
    views.push({ key: "CONS_IGT", label: "IGT Consideration" });
  if (
    master ||
    overseer ||
    isB2B(viewer) ||
    // B2B raises FOR the product functions, so their leaders follow it too
    ((viewer.role === "LCVP" || viewer.role === "Director") &&
      icxFunctions(viewer).length > 0)
  ) {
    views.push({ key: "B2B", label: "B2B" });
  }
  // BD is its own lane and its own audience (v32.6): B2B raises opens FOR the
  // product functions, so their VPs follow it — BD sells partnerships, which
  // is the BD crew's business and nobody else's.
  if (master || overseer || isBd(viewer)) {
    views.push({ key: "BD", label: "BD" });
  }
  // B2C is its own module (v23): its crew, the LCP/admin and the overseers
  if (master || overseer || isB2C(viewer)) {
    views.push({ key: "B2C", label: "B2C" });
  }
  // OGX (v28): OGT / OGV sign-up funnel lanes. `ogxLanes` adds the overseers
  // WITHOUT granting them the sign-ups module itself.
  const ogxFns = ogxLanes(viewer);
  for (const f of ogxFns) views.push({ key: f, label: f });

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

  // CONS_* / OGT / OGV are pseudo-lanes — getDashboard never receives them:
  // it runs on the viewer's first REAL account lane (or "all", which for a
  // pure-OGX viewer scopes to their own — empty — accounts and returns fast)
  const SPECIAL_LANES = new Set(["CONS", "CONS_IGV", "CONS_IGT", "OGT", "OGV"]);
  const baseLane = views.find((v) => !SPECIAL_LANES.has(v.key))?.key ?? "all";
  const isOgxLane = activeFn === "OGT" || activeFn === "OGV";
  const consLane: "IGV" | "IGT" | null =
    activeFn === "CONS_IGV" ? "IGV" : activeFn === "CONS_IGT" ? "IGT" : null;

  const [data, teamFilterOptions, members, consideration, ogx, streak] = await Promise.all([
    getDashboard(viewer, filters, SPECIAL_LANES.has(activeFn) ? baseLane : activeFn),
    listTeamFilterOptions(viewer),
    listVisibleMembers(viewer),
    consLane ? considerationStats(viewer, consLane) : Promise.resolve(null),
    isOgxLane
      ? ogxDashboard(viewer, activeFn as OgxFunction, {
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
    ...ogxFns,
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
      ogx={ogx}
      streak={streak}
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
      filters={{
        team: params.team ?? "",
        member: params.member ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
      }}
    />
  );
}
