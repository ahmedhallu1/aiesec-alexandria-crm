import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import {
  accountScope,
  canViewAccount,
  icxFunctions,
  reassignTargetScope,
  type Viewer,
  type AccountScope,
} from "@/lib/rbac";
import type {
  AccountComment,
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
  fn?: "IGV" | "IGT";
  project?: string;
  product?: "GTa" | "GTe";
  stage?: Stage;
  responsibleId?: string;
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
  if (scope.kind === "functions") query = query.overlaps("functions", scope.fns);
  if (scope.kind === "members") query = query.in("id", scope.ids);
  const { data } = await query.order("name");
  return (data ?? []) as Member[];
}

export async function listReassignTargets(viewer: Viewer, fn: "IGV" | "IGT"): Promise<Member[]> {
  const scope = reassignTargetScope(viewer);
  if (scope.kind === "members" && scope.ids.length === 0) return [];
  let query = db().from("members").select("*").eq("is_active", true);
  if (scope.kind === "all" || scope.kind === "functions") {
    // reassignment stays inside the account's function
    query = query.contains("functions", [fn]);
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

function addRow(s: FunnelStats, r: PipelineRow) {
  s.mr += 1;
  if (r.attempts > 0) s.contacted += 1;
  if (r.visit_id) s.visitScheduled += 1;
  if (r.visit_done) s.visitDone += 1;
  if (r.slot_raised) {
    s.dealAccounts += 1;
    s.deals += r.deals_count || 1;
    s.slots += r.slots_count || 1;
  }
  if (r.out_of_process) s.outOfProcess += 1;
  if (r.contact_limit_reached) s.contactLimitFlags += 1;
  if (r.next_step_missing) s.nextStepMissingFlags += 1;
}

/** Dashboard visibility is FUNCTION-wide for everyone in the module (the goal
 *  and the numbers are a shared trigger) — members still only OPEN their own
 *  accounts; this affects aggregates only. */
function dashboardViewer(viewer: Viewer): Viewer {
  const scope = accountScope(viewer);
  if (scope.kind === "all" || scope.kind === "functions") return viewer;
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

export async function getDashboard(viewer: Viewer, filters: AccountFilters = {}) {
  const dashViewer = dashboardViewer(viewer);
  const rows = await listAccounts(dashViewer, { ...filters, includeArchived: true });
  const members = await listVisibleMembers(dashViewer);
  const byId = new Map(members.map((m) => [m.id, m]));

  const total = emptyStats();
  const byFunction = new Map<string, DrillGroup>();
  const byTeam = new Map<string, DrillGroup>();
  const byMember = new Map<string, DrillGroup>();

  for (const r of rows) {
    addRow(total, r);

    // IGT splits into its products (IGTa / IGTe); IGV stays one lane
    const fnKey =
      r.function === "IGT" ? (r.product ? `I${r.product}` : "IGT") : r.function;
    addRow(getOrInit(byFunction, fnKey, fnKey), r);

    // team = the TL: the responsible themself when they lead, otherwise their stakeholder
    const teamKey =
      r.responsible_role === "Team Leader"
        ? r.responsible_id
        : r.responsible_stakeholder_id ?? "none";
    const teamLead = byId.get(teamKey);
    const teamLabel =
      teamLead?.team_name ||
      (teamLead ? `Team ${teamLead.nickname || teamLead.name}` : "No team");
    addRow(getOrInit(byTeam, teamKey, teamLabel), r);

    const respLabel = r.responsible_nickname || r.responsible_name;
    addRow(getOrInit(byMember, r.responsible_id, respLabel), r);
  }

  // ---- leaderboards (never across functions: they live inside the lane filter)
  const rank = (a: DrillGroup, b: DrillGroup) =>
    b.slots - a.slots || b.deals - a.deals || b.visitDone - a.visitDone || b.contacted - a.contacted;
  const functionBoard = [...byMember.values()].sort(rank);

  // the viewer's team: the TL is themself (TL) or their manager (member/coordinator)
  const teamLeadId =
    viewer.role === "Team Leader" ? viewer.id : viewer.stakeholder_id ?? null;
  const teamMemberIds = teamLeadId
    ? new Set([
        teamLeadId,
        ...members.filter((m) => m.stakeholder_id === teamLeadId).map((m) => m.id),
      ])
    : null;
  const teamBoard = teamMemberIds
    ? functionBoard.filter((g) => teamMemberIds.has(g.key))
    : [];

  // ---- goals in effect (function goal for the lane, the viewer's team goal)
  const laneFn = filters.fn ?? null;
  const [funcGoal, teamGoal] = await Promise.all([
    laneFn ? getActiveGoal("function", laneFn) : Promise.resolve(null),
    teamLeadId ? getActiveGoal("team", teamLeadId) : Promise.resolve(null),
  ]);

  return {
    total,
    byFunction: [...byFunction.values()],
    byTeam: [...byTeam.values()].sort((a, b) => b.mr - a.mr),
    byMember: functionBoard,
    functionBoard,
    teamBoard,
    funcGoal,
    teamGoal,
    teamLeadId,
  };
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
