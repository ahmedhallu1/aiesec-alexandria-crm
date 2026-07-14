import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import {
  accountScope,
  canViewAccount,
  icxFunctions,
  isB2B,
  reassignTargetScope,
  type Viewer,
  type AccountScope,
} from "@/lib/rbac";
import type {
  AccountComment,
  AccountFunction,
  AccountPipeline,
  BlacklistEntry,
  Deal,
  Member,
  MemberRole,
  Stage,
} from "@/lib/types";
import { normalizeName } from "@/lib/types";

export interface PipelineRow extends AccountPipeline {
  responsible_role: MemberRole;
  responsible_team_name: string | null;
}

// ------------------------------------------------------------------ viewer

export async function getViewer(): Promise<Viewer> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/login");
  const viewer = await getViewerByEmail(email);
  if (!viewer) redirect("/login");
  return viewer;
}

export async function getViewerByEmail(email: string): Promise<Viewer | null> {
  const { data: member } = await db()
    .from("members")
    .select("*")
    .ilike("email", email)
    .maybeSingle<Member>();
  if (!member || !member.is_active) return null;
  const { data: team } = await db()
    .from("members")
    .select("id")
    .eq("stakeholder_id", member.id)
    .eq("is_active", true);
  return {
    ...member,
    functions: member.functions ?? [],
    sub_functions: member.sub_functions ?? [],
    isAdmin: env.adminEmails.includes(member.email.toLowerCase()),
    teamMemberIds: (team ?? []).map((t) => t.id),
  };
}

// ------------------------------------------------------------------ scope helpers

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyScope<T extends { eq: any; in: any }>(query: T, scope: AccountScope): T {
  if (scope.kind === "functions") return query.in("function", scope.fns);
  if (scope.kind === "members") return query.in("responsible_id", scope.ids);
  return query;
}

// ------------------------------------------------------------------ accounts

export interface AccountFilters {
  q?: string;
  fn?: AccountFunction;
  project?: string;
  product?: "GTa" | "GTe";
  stage?: Stage;
  responsibleId?: string;
  /** filter by the account's LAST contact result (No Response, Interested…) */
  lastStatus?: string;
  /** a Team Leader's id — their own accounts + their members' accounts */
  teamId?: string;
  flag?: "contact_limit" | "next_step_missing";
  /** created_at range (YYYY-MM-DD) */
  from?: string;
  to?: string;
  /** OOP accounts are archived: hidden unless explicitly requested */
  archived?: boolean;
  /** dashboards need the full picture including archived accounts */
  includeArchived?: boolean;
}

export async function listAccounts(
  viewer: Viewer,
  filters: AccountFilters = {}
): Promise<PipelineRow[]> {
  let query = applyScope(
    db().from("accounts_pipeline").select("*"),
    accountScope(viewer)
  );
  if (filters.archived) query = query.eq("out_of_process", true);
  else if (!filters.includeArchived) query = query.eq("out_of_process", false);
  if (filters.fn) query = query.eq("function", filters.fn);
  if (filters.project) query = query.eq("project", filters.project);
  if (filters.product) query = query.eq("product", filters.product);
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.lastStatus) query = query.eq("last_contact_status", filters.lastStatus);
  if (filters.responsibleId) query = query.eq("responsible_id", filters.responsibleId);
  if (filters.teamId) {
    const { data: team } = await db()
      .from("members")
      .select("id")
      .eq("stakeholder_id", filters.teamId);
    query = query.in("responsible_id", [filters.teamId, ...(team ?? []).map((t) => t.id)]);
  }
  // accounts can't be created in the future — clamp the range to today
  const today = new Date().toISOString().slice(0, 10);
  const from = filters.from && filters.from <= today ? filters.from : filters.from ? today : undefined;
  const to = filters.to && filters.to <= today ? filters.to : filters.to ? today : undefined;
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59Z`);
  if (filters.flag === "contact_limit") query = query.eq("contact_limit_reached", true);
  if (filters.flag === "next_step_missing") query = query.eq("next_step_missing", true);
  if (filters.q) query = query.ilike("normalized_name", `%${normalizeName(filters.q)}%`);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(1000);
  if (error) throw error;
  return (data ?? []) as PipelineRow[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accounts are addressed by an expressive slug (/accounts/hadana) built from
 *  the unique normalized name; raw UUIDs keep working for old links. Access is
 *  ALWAYS re-checked server-side (canViewAccount) — a member who guesses a URL
 *  outside their scope gets a 404, never the data. */
export async function findAccountRow(idOrSlug: string): Promise<PipelineRow | null> {
  const raw = decodeURIComponent(idOrSlug);
  if (UUID_RE.test(raw)) {
    const { data } = await db()
      .from("accounts_pipeline")
      .select("*")
      .eq("id", raw)
      .maybeSingle<PipelineRow>();
    return data ?? null;
  }
  // slug: dashes were spaces (names containing real dashes are matched second)
  const candidates = [...new Set([raw.replace(/-/g, " "), raw])];
  const { data } = await db()
    .from("accounts_pipeline")
    .select("*")
    .in("normalized_name", candidates)
    .limit(1)
    .maybeSingle<PipelineRow>();
  return data ?? null;
}

export async function getAccount(viewer: Viewer, idOrSlug: string) {
  const account = await findAccountRow(idOrSlug);
  if (!account || !canViewAccount(viewer, account)) return null;
  const id = account.id;

  const [{ data: attempts }, { data: visits }, { data: comments }, { data: deals }] =
    await Promise.all([
      db()
        .from("contact_attempts")
        .select("*, member:members(name, nickname)")
        .eq("account_id", id)
        .order("created_at", { ascending: false }),
      db()
        .from("visits")
        .select("*")
        .eq("account_id", id)
        .order("visit_date", { ascending: false })
        .order("visit_time", { ascending: false }),
      db()
        .from("account_comments")
        .select("*, member:members(name, nickname)")
        .eq("account_id", id)
        .order("created_at", { ascending: true }),
      db()
        .from("deals")
        .select("*, member:members(name, nickname)")
        .eq("account_id", id)
        .order("created_at", { ascending: false }),
    ]);
  return {
    account,
    attempts: attempts ?? [],
    visits: visits ?? [],
    comments: (comments ?? []) as CommentWithMember[],
    deals: (deals ?? []) as DealWithMember[],
  };
}

export type DealWithMember = Deal & {
  member: { name: string; nickname: string | null } | null;
};

export type CommentWithMember = AccountComment & {
  member: { name: string; nickname: string | null } | null;
};

export interface NameCheckResult {
  duplicate: PipelineRow | null;
  blacklisted: BlacklistEntry | null;
}

/** Cross-ICX duplicate + archive/blacklist check for the Add Account flow.
 *  Out-of-process accounts stay in the data as an archive — re-adding their
 *  name is blocked exactly like a blacklist hit. */
export async function checkAccountName(name: string): Promise<NameCheckResult> {
  const normalized = normalizeName(name);
  if (!normalized) return { duplicate: null, blacklisted: null };
  const [{ data: duplicate }, { data: blacklisted }] = await Promise.all([
    db()
      .from("accounts_pipeline")
      .select("*")
      .eq("normalized_name", normalized)
      .maybeSingle<PipelineRow>(),
    db()
      .from("blacklist")
      .select("*")
      .eq("normalized_name", normalized)
      .maybeSingle<BlacklistEntry>(),
  ]);
  return { duplicate: duplicate ?? null, blacklisted: blacklisted ?? null };
}

// ------------------------------------------------------------------ members

export async function listVisibleMembers(viewer: Viewer): Promise<Member[]> {
  let query = db().from("members").select("*").eq("is_active", true);
  const scope = accountScope(viewer);
  if (scope.kind === "functions") {
    // B2B people may carry B2B as a sub-function only — match both columns
    query = scope.fns.includes("B2B")
      ? query.or(`functions.ov.{${scope.fns.join(",")}},sub_functions.cs.{B2B}`)
      : query.overlaps("functions", scope.fns);
  }
  if (scope.kind === "members") query = query.in("id", scope.ids);
  const { data } = await query.order("name");
  return (data ?? []) as Member[];
}

export async function listReassignTargets(viewer: Viewer, fn: AccountFunction): Promise<Member[]> {
  const scope = reassignTargetScope(viewer);
  if (scope.kind === "members" && scope.ids.length === 0) return [];
  let query = db().from("members").select("*").eq("is_active", true);
  if (scope.kind === "all" || scope.kind === "functions") {
    // reassignment stays inside the account's function (B2B = the B2B crew)
    query =
      fn === "B2B"
        ? query.or("functions.cs.{B2B},sub_functions.cs.{B2B}")
        : query.contains("functions", [fn]);
  } else {
    query = query.in("id", scope.ids);
  }
  const { data } = await query.order("name");
  return (data ?? []) as Member[];
}

export async function listAllMembers(): Promise<Member[]> {
  const { data } = await db().from("members").select("*").order("role").order("name");
  return (data ?? []) as Member[];
}

/** Team Leaders visible to this viewer (for the dashboard team filter). */
export async function listTeamLeaders(viewer: Viewer): Promise<Member[]> {
  const members = await listVisibleMembers(viewer);
  return members.filter((m) => m.role === "Team Leader");
}

// ------------------------------------------------------------------ dashboard

export interface FunnelStats {
  /** Market Research — every account that entered the system */
  mr: number;
  contacted: number;
  visitScheduled: number;
  visitDone: number;
  /** number of DEALS signed (an account can close several) */
  deals: number;
  /** accounts with at least one deal (used for conversion rates) */
  dealAccounts: number;
  slots: number;
  outOfProcess: number;
  contactLimitFlags: number;
  nextStepMissingFlags: number;
}

export interface DrillGroup extends FunnelStats {
  key: string;
  label: string;
}

const emptyStats = (): FunnelStats => ({
  mr: 0, contacted: 0, visitScheduled: 0, visitDone: 0, deals: 0,
  dealAccounts: 0, slots: 0, outOfProcess: 0, contactLimitFlags: 0,
  nextStepMissingFlags: 0,
});

/** Which dashboard lane an account belongs to for FUNNEL metrics (MR,
 *  contacted, visits…). B2B accounts live in the All-ICX lane (and the B2B
 *  drill row); their opens still feed the product lanes via deal breakdowns. */
function rowInLane(r: PipelineRow, lane: string): boolean {
  if (lane === "all") return true;
  if (lane === "IGV") return r.function === "IGV";
  if (lane === "IGT") return r.function === "IGT";
  if (lane === "IGTa") return r.function === "IGT" && r.product === "GTa";
  if (lane === "IGTe") return r.function === "IGT" && r.product === "GTe";
  if (lane === "B2B") return r.function === "B2B";
  return true;
}

/** Opens this account contributes to a lane. Deals carry a per-product split
 *  (B2B mixes all three; IGT deals split IGTa/IGTe), so a lane's slots include
 *  every account's contribution — B2B included. */
function laneSlots(r: PipelineRow, lane: string): number {
  if (lane === "all") return r.slots_count ?? 0;
  // pre-0009 fallback: attribute the account's total to its own product
  if (r.slots_igv_count == null)
    return rowInLane(r, lane) ? r.slots_count ?? 0 : 0;
  if (lane === "IGV") return r.slots_igv_count ?? 0;
  if (lane === "IGTa") return r.slots_igta_count ?? 0;
  if (lane === "IGTe") return r.slots_igte_count ?? 0;
  if (lane === "IGT") return (r.slots_igta_count ?? 0) + (r.slots_igte_count ?? 0);
  if (lane === "B2B") return r.function === "B2B" ? r.slots_count ?? 0 : 0;
  return r.slots_count ?? 0;
}

/** Funnel metrics come from the lane's own accounts; slots/deals count every
 *  account contributing opens to the lane (B2B feeding IGV/IGTa/IGTe). */
function addRowLane(s: FunnelStats, r: PipelineRow, lane: string) {
  if (rowInLane(r, lane)) {
    s.mr += 1;
    if (r.attempts > 0) s.contacted += 1;
    if (r.visit_id) s.visitScheduled += 1;
    if (r.visit_done) s.visitDone += 1;
    if (r.out_of_process) s.outOfProcess += 1;
    if (r.contact_limit_reached) s.contactLimitFlags += 1;
    if (r.next_step_missing) s.nextStepMissingFlags += 1;
  }
  const ls = laneSlots(r, lane);
  if (ls > 0) {
    s.slots += ls;
    s.deals += r.deals_count || 1;
    s.dealAccounts += 1;
  }
}

/** Dashboard visibility is FUNCTION-wide for everyone in the module (the goal
 *  and the numbers are a shared trigger) — members still only OPEN their own
 *  accounts; this affects aggregates only. */
function dashboardViewer(viewer: Viewer): Viewer {
  const scope = accountScope(viewer);
  if (scope.kind === "all") return viewer;
  // B2B raises for the whole ICX — their dashboard aggregates span all of it
  if (isB2B(viewer))
    return {
      ...viewer,
      role: "Director",
      functions: [...new Set([...viewer.functions, "IGV", "IGT", "B2B"])],
    };
  if (scope.kind === "functions") return viewer;
  const fns = icxFunctions(viewer);
  if (fns.length === 0) return viewer;
  // widen the scope to the member's function(s) by impersonating a Director-like view
  return { ...viewer, role: "Director" };
}

export interface PerformanceGoal {
  id: string;
  scope: "function" | "team";
  function: string | null;
  team_leader_id: string | null;
  metric: string;
  target: number;
  period_label: string;
  period_start: string;
  period_end: string;
}

/** The goal currently in effect (today inside its period; latest wins). */
export async function getActiveGoal(
  scope: "function" | "team",
  key: string
): Promise<PerformanceGoal | null> {
  const today = new Date().toISOString().slice(0, 10);
  let query = db()
    .from("performance_goals")
    .select("*")
    .eq("scope", scope)
    .lte("period_start", today)
    .gte("period_end", today)
    .order("created_at", { ascending: false })
    .limit(1);
  query = scope === "function" ? query.eq("function", key) : query.eq("team_leader_id", key);
  const { data } = await query.maybeSingle<PerformanceGoal>();
  return data ?? null;
}

export async function getDashboard(
  viewer: Viewer,
  filters: AccountFilters = {},
  laneKey?: string
) {
  const lane = laneKey && laneKey !== "all" ? laneKey : "all";
  const dashViewer = dashboardViewer(viewer);
  // lane filtering happens HERE in JS — a DB fn/product filter would drop the
  // B2B (and cross-product IGT) accounts whose opens feed this lane
  const rows = await listAccounts(dashViewer, {
    ...filters,
    fn: undefined,
    product: undefined,
    includeArchived: true,
  });
  const members = await listVisibleMembers(dashViewer);
  const byId = new Map(members.map((m) => [m.id, m]));

  // the viewer's team: themself (TL) or their manager — but ONLY if that
  // manager is a real Team Leader (the EB is not a team)
  const managerIsTl =
    viewer.stakeholder_id != null &&
    byId.get(viewer.stakeholder_id)?.role === "Team Leader";
  const teamLeadId =
    viewer.role === "Team Leader" ? viewer.id : managerIsTl ? viewer.stakeholder_id : null;
  const teamMemberIds = teamLeadId
    ? new Set([
        teamLeadId,
        ...members.filter((m) => m.stakeholder_id === teamLeadId).map((m) => m.id),
      ])
    : null;

  const total = emptyStats();
  const byFunction = new Map<string, DrillGroup>();
  const byTeam = new Map<string, DrillGroup>();
  // two boards: Members, and MMs (Team Leaders + Coordinators)
  const byMemberRole = new Map<string, DrillGroup>();
  const byMM = new Map<string, DrillGroup>();
  const byPerson = new Map<string, DrillGroup>(); // union, for the team board
  let teamAchieved = 0;

  for (const r of rows) {
    const inLane = rowInLane(r, lane);
    const contributes = laneSlots(r, lane) > 0;
    if (!inLane && !contributes) continue; // nothing for this lane

    addRowLane(total, r, lane);

    // product drill: IGV / IGTa / IGTe / B2B rows (account-level numbers)
    if (inLane) {
      const fnKey =
        r.function === "IGT" ? (r.product ? `I${r.product}` : "IGT") : r.function;
      addRowLane(getOrInit(byFunction, fnKey, fnKey), r, lane);
    }

    // team = a REAL Team Leader's group only — the EB (IRIS) is not a team,
    // so accounts owned by VPs/admins don't create a fake EB leaderboard row
    const teamKey =
      r.responsible_role === "Team Leader"
        ? r.responsible_id
        : r.responsible_stakeholder_id ?? null;
    const teamLead = teamKey ? byId.get(teamKey) : undefined;
    if (teamLead && teamLead.role === "Team Leader") {
      const teamLabel = teamLead.team_name || `Team ${teamLead.nickname || teamLead.name}`;
      addRowLane(getOrInit(byTeam, teamLead.id, teamLabel), r, lane);
    }

    // leaderboards (VPs/Directors/LCP never appear — leaders steer):
    //  • Members board  → role Member
    //  • MMs board      → Team Leaders + Coordinators
    // each row is that person's OWN accounts (no team rollup)
    const respLabel = r.responsible_nickname || r.responsible_name;
    if (r.responsible_role === "Member") {
      addRowLane(getOrInit(byMemberRole, r.responsible_id, respLabel), r, lane);
      addRowLane(getOrInit(byPerson, r.responsible_id, respLabel), r, lane);
    } else if (r.responsible_role === "Team Leader" || r.responsible_role === "Coordinator") {
      addRowLane(getOrInit(byMM, r.responsible_id, respLabel), r, lane);
      addRowLane(getOrInit(byPerson, r.responsible_id, respLabel), r, lane);
    }

    // team goal progress counts the WHOLE team (TL's own accounts included)
    if (teamMemberIds?.has(r.responsible_id)) teamAchieved += laneSlots(r, lane);
  }

  const rank = (a: DrillGroup, b: DrillGroup) =>
    b.slots - a.slots || b.deals - a.deals || b.visitDone - a.visitDone || b.contacted - a.contacted;
  const memberBoard = [...byMemberRole.values()].sort(rank);
  const mmBoard = [...byMM.values()].sort(rank);
  const teamBoard = teamMemberIds
    ? [...byPerson.values()].filter((g) => teamMemberIds.has(g.key)).sort(rank)
    : [];

  // ---- goals in effect. Lane goals live at IGV / IGTa / IGTe; the IGT goal
  // is DERIVED: goal(IGT) = goal(IGTa) + goal(IGTe).
  let funcGoal: PerformanceGoal | null = null;
  if (laneKey === "IGV" || laneKey === "IGTa" || laneKey === "IGTe") {
    funcGoal = await getActiveGoal("function", laneKey);
  } else if (laneKey === "IGT") {
    const [a, e] = await Promise.all([
      getActiveGoal("function", "IGTa"),
      getActiveGoal("function", "IGTe"),
    ]);
    if (a || e) {
      const first = (a ?? e)!;
      funcGoal = {
        id: "igt-combined",
        scope: "function",
        function: "IGT",
        team_leader_id: null,
        metric: "Slots",
        target: (a?.target ?? 0) + (e?.target ?? 0),
        period_label:
          a && e
            ? a.period_label === e.period_label
              ? `${a.period_label} · IGTa+IGTe`
              : `${a.period_label} + ${e.period_label}`
            : `${first.period_label} · ${a ? "IGTa only" : "IGTe only"}`,
        period_start: first.period_start,
        period_end: first.period_end,
      };
    }
  }
  const teamGoal = teamLeadId ? await getActiveGoal("team", teamLeadId) : null;

  return {
    total,
    byFunction: [...byFunction.values()],
    byTeam: [...byTeam.values()].sort((a, b) => b.mr - a.mr),
    memberBoard,
    mmBoard,
    teamBoard,
    teamAchieved,
    funcGoal,
    teamGoal,
    teamLeadId,
  };
}

// ------------------------------------------------------------------ manual archive

export interface ManualArchivedRow extends BlacklistEntry {
  added_by_member: { name: string; nickname: string | null } | null;
}

/** Manually archived account names (never worked in the CRM) — they live in
 *  the blacklist table and block re-adding exactly like OOP accounts. */
export async function listManualArchived(): Promise<ManualArchivedRow[]> {
  const { data } = await db()
    .from("blacklist")
    .select("*, added_by_member:members!blacklist_added_by_fkey(name, nickname)")
    .order("created_at", { ascending: false })
    .limit(2000);
  return (data ?? []) as ManualArchivedRow[];
}

function getOrInit(map: Map<string, DrillGroup>, key: string, label: string): DrillGroup {
  let g = map.get(key);
  if (!g) {
    g = { key, label, ...emptyStats() };
    map.set(key, g);
  }
  return g;
}

// ------------------------------------------------------------------ audit

export async function logAudit(
  actorId: string,
  action: string,
  entity: string,
  entityId: string | null,
  details?: Record<string, unknown>
) {
  await db().from("audit_log").insert({
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId,
    details: details ?? null,
  });
}
