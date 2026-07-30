import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import {
  accountScope,
  canViewAccount,
  hasRaisingAccess,
  hasTmAccess,
  icxFunctions,
  isB2B,
  isB2C,
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
import {
  parsePhoneSessionKey, normalizeName } from "@/lib/types";
import { monthOf, sprintOf } from "@/lib/plan";

export interface PipelineRow extends AccountPipeline {
  responsible_role: MemberRole;
  responsible_team_name: string | null;
}

// ------------------------------------------------------------------ viewer

/** Cookie carrying the admin's "view as" test target (member id). */
export const VIEW_AS_COOKIE = "sodio-view-as";

/** The REAL signed-in member — never impersonated. Use for admin checks.
 *  cache(): layouts, pages and actions in one request share one lookup. */
export const getRealViewer = cache(async (): Promise<Viewer> => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/login");
  const viewer = await getViewerByEmail(email);
  if (!viewer) {
    // deactivated mid-session? send them to the "you're inactive" screen
    // instead of a confusing login loop
    if (await sessionKeyIsInactiveMember(email)) redirect("/inactive");
    redirect("/login");
  }
  return viewer;
});

/** True when the session key belongs to a member row that EXISTS but is
 *  deactivated (Active = No on the sheet). Distinguishes "kicked out" from
 *  "never existed" so getRealViewer can route to /inactive. */
async function sessionKeyIsInactiveMember(email: string): Promise<boolean> {
  const phoneDigits = parsePhoneSessionKey(email);
  if (phoneDigits) {
    const m = await memberByPhoneDigits(phoneDigits, "id, is_active, email, phone");
    return !!m && !(m as { is_active: boolean }).is_active;
  }
  const { data } = await db()
    .from("members")
    .select("id, is_active")
    .ilike("email", email)
    .limit(1);
  const row = (data ?? [])[0] as { is_active: boolean } | undefined;
  return !!row && !row.is_active;
}

/** Resolves a phone-keyed session to its member by EXACT digit equality (the
 *  session key carries the full number — never a tail match, so a shared
 *  9-digit tail can't swap identities). Members whose email landed mid-session
 *  still resolve (email-less rows win ties) so their session survives. */
async function memberByPhoneDigits(
  phoneDigits: string,
  columns: string
): Promise<Record<string, unknown> | null> {
  const { data } = await db()
    .from("members")
    .select(columns)
    .not("phone", "is", null)
    .ilike("phone", `%${phoneDigits}%`)
    .limit(10);
  const rows = (data ?? []) as unknown as { email: string | null; phone: string | null }[];
  const exact = rows.filter(
    (m) => (m.phone ?? "").replace(/\D/g, "") === phoneDigits
  );
  return (exact.find((m) => !m.email) ?? exact[0] ?? null) as Record<string, unknown> | null;
}

/** The members an admin can test-view as — [] for everyone else. Powers the
 *  profile picker AND the switch-list on the floating test-view banner. */
export interface ViewAsTarget {
  id: string;
  label: string;
  role: string;
  functions: string;
}
export async function listViewAsTargets(): Promise<ViewAsTarget[]> {
  const real = await getRealViewer();
  if (!real.isAdmin) return [];
  const { data } = await db()
    .from("members")
    .select("id, name, nickname, role, functions")
    .eq("is_active", true)
    .neq("id", real.id) // you can't test-view yourself
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((m) => ({
    id: m.id,
    label: m.nickname || m.name,
    role: m.role,
    functions: (m.functions ?? []).join(", "),
  }));
}

/** The effective viewer. When the REAL user is an admin and the view-as
 *  cookie is set, this becomes the impersonated member (marked
 *  `impersonated`) — the whole app then behaves exactly as it would for
 *  them, which is the point of the test view.
 *
 *  Cookie format (v21): `<targetId>|<mode>|<sessionId>` where mode is
 *  `sandbox` (default — journaled + undone on exit, side effects suppressed)
 *  or `real`. A bare `<targetId>` (legacy) means real mode. Outside view-as,
 *  the admin's `sodio-test-mode` cookie makes test accounts visible. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const real = await getRealViewer();
  if (!real.isAdmin) return real;
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const showTest = jar.get("sodio-test-mode")?.value === "1";
  const raw = jar.get(VIEW_AS_COOKIE)?.value;
  if (!raw) return showTest ? { ...real, testMode: true } : real;
  const [targetId, mode, sessionId] = raw.split("|");
  if (!targetId || targetId === real.id)
    return showTest ? { ...real, testMode: true } : real;
  const target = await getViewerById(targetId);
  if (!target) return showTest ? { ...real, testMode: true } : real;
  const sandbox = mode === "sandbox" && !!sessionId;
  return {
    ...target,
    impersonated: true,
    sandbox,
    sandboxSession: sandbox ? sessionId : null,
    // any test view sees the seeded test accounts — that's what they're for
    testMode: true,
  };
});

async function getViewerById(id: string): Promise<Viewer | null> {
  const { data: member } = await db()
    .from("members")
    .select("*")
    .eq("id", id)
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
    isAdmin: env.adminEmails.includes((member.email ?? "").toLowerCase()),
    teamMemberIds: (team ?? []).map((t) => t.id),
  };
}

export async function getViewerByEmail(email: string): Promise<Viewer | null> {
  // members without an AIESEC email carry a synthetic phone-keyed session
  // identity (phone+<digits>@sodio.local) — resolve those by phone
  const phoneDigits = parsePhoneSessionKey(email);
  let member: Member | null = null;
  if (phoneDigits) {
    member = (await memberByPhoneDigits(phoneDigits, "*")) as Member | null;
  } else {
    const { data } = await db()
      .from("members")
      .select("*")
      .ilike("email", email)
      .maybeSingle<Member>();
    member = data;
  }
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
    isAdmin: env.adminEmails.includes((member.email ?? "").toLowerCase()),
    teamMemberIds: (team ?? []).map((t) => t.id),
  };
}

// ------------------------------------------------------------------ teams registry

export interface TeamRegistryRow {
  id: string;
  type: string;
  function_key: string;
  name: string;
}

/** Every named team (EB / LB / Function / MM from the sheet + the in-app
 *  'Team' registry rows) — powers the membership Teams card and the
 *  role-filtered team pickers (v24). */
export async function listTeamsRegistry(): Promise<TeamRegistryRow[]> {
  const { data } = await db()
    .from("teams")
    .select("id, type, function_key, name")
    .order("type")
    .order("function_key")
    .order("name");
  return (data ?? []) as TeamRegistryRow[];
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
  /** IGT sub-product (Other, Teaching…) — loose text match */
  subProduct?: string;
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
  /** column sorting (v24): whitelisted field + direction; default updated_at desc */
  sort?: string;
  dir?: "asc" | "desc";
  /** OOP accounts are archived: hidden unless explicitly requested */
  archived?: boolean;
  /** dashboards need the full picture including archived accounts */
  includeArchived?: boolean;
  /** B2B/BD accounts not yet requested on Podio (no request, no state) —
   *  the leaders' submission worklist */
  podioPending?: boolean;
}

/** Supabase caps one response at 1000 rows — big reads must page. */
const DB_PAGE = 1000;
/** Sanity ceiling for "fetch everything" reads (dashboards, mirrors). */
const MAX_FETCH_ROWS = 20000;

/** Pages through a query in 1000-row chunks. The builder MUST apply a stable
 *  order (we re-run it per page) or rows can repeat/skip across pages. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T>(build: () => any, max = MAX_FETCH_ROWS): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; off < max; off += DB_PAGE) {
    const { data, error } = await build().range(off, Math.min(off + DB_PAGE, max) - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < DB_PAGE) break;
  }
  return out;
}

/** ALL matching accounts (paged under the hood) — dashboards, mirrors, the
 *  assistant. The accounts LIST page uses listAccountsPage instead.
 *  `max` caps the fetch for consumers that only need the freshest slice. */
export async function listAccounts(
  viewer: Viewer,
  filters: AccountFilters = {},
  max = MAX_FETCH_ROWS
): Promise<PipelineRow[]> {
  const out: PipelineRow[] = [];
  for (let off = 0; off < max; off += DB_PAGE) {
    const attempt = async (bdSafe: boolean) =>
      (await buildAccountsQuery(viewer, filters, bdSafe)).query.range(off, off + DB_PAGE - 1);
    let { data, error } = await attempt(false);
    // MIGRATION-0014 GRACE: before the migration runs, Postgres rejects the
    // "BD" enum value (22P02 on lc_function). Retry without BD so a deploy can
    // never break the dashboard/accounts while the SQL editor lags behind.
    if (error && `${error.message}`.includes("lc_function")) {
      if (filters.fn === "BD") return [];
      ({ data, error } = await attempt(true));
    }
    if (error) throw error;
    const chunk = (data ?? []) as PipelineRow[];
    out.push(...chunk);
    if (chunk.length < DB_PAGE || out.length >= max) break;
  }
  return out.slice(0, max);
}

export interface AccountsPage {
  rows: PipelineRow[];
  total: number;
  /** the page actually served — a stale/out-of-range param gets clamped */
  page: number;
}

/** One page of the accounts list + the total match count (v22 — the list is
 *  paginated since the big market-research import). */
export async function listAccountsPage(
  viewer: Viewer,
  filters: AccountFilters = {},
  page = 0,
  pageSize = 100
): Promise<AccountsPage> {
  const fetchPage = async (p: number) => {
    const attempt = async (bdSafe: boolean) =>
      (await buildAccountsQuery(viewer, filters, bdSafe, true)).query.range(
        p * pageSize,
        p * pageSize + pageSize - 1
      );
    let res = await attempt(false);
    if (res.error && `${res.error.message}`.includes("lc_function")) {
      if (filters.fn === "BD") return { data: [], error: null, count: 0 };
      res = await attempt(true);
    }
    return res;
  };
  let { data, error, count } = await fetchPage(page);
  if (error) throw error;
  // a stale page param past the end returns 200 + [] — serve the LAST page
  // instead of a blank list (e.g. after bulk-reassigning a whole page away)
  let served = page;
  if ((data ?? []).length === 0 && (count ?? 0) > 0 && page > 0) {
    served = Math.max(0, Math.ceil((count ?? 0) / pageSize) - 1);
    ({ data, error, count } = await fetchPage(served));
    if (error) throw error;
  }
  return { rows: (data ?? []) as PipelineRow[], total: count ?? 0, page: served };
}

async function buildAccountsQuery(
  viewer: Viewer,
  filters: AccountFilters,
  bdSafe: boolean,
  withCount = false
) {
  const scope = accountScope(viewer);
  const effScope: AccountScope =
    bdSafe && scope.kind === "functions"
      ? { kind: "functions", fns: scope.fns.filter((f) => f !== "BD") }
      : scope;
  let query = db()
    .from("accounts_pipeline")
    .select("*", withCount ? { count: "exact" } : undefined);
  // the Archived TAB is LC-wide (v22.2): the archive is the shared blacklist,
  // so it skips the account scope. Everything else stays scoped (dashboards'
  // includeArchived reads included).
  if (!filters.archived) query = applyScope(query, effScope);
  // test accounts live in a parallel universe: visible ONLY in test mode
  // (admin's "Show test data" toggle or any test view)
  if (!viewer.testMode) query = query.eq("is_test", false);
  if (filters.archived) query = query.eq("out_of_process", true);
  else if (!filters.includeArchived) query = query.eq("out_of_process", false);
  if (filters.podioPending)
    query = query
      .in("function", bdSafe ? ["B2B"] : ["B2B", "BD"])
      .eq("requested_podio", false)
      .is("request_state", null);
  if (filters.fn) query = query.eq("function", filters.fn);
  if (filters.project) query = query.eq("project", filters.project);
  if (filters.product) query = query.eq("product", filters.product);
  // sub_product is free-ish text (may hold several values) — match loosely
  if (filters.subProduct) query = query.ilike("sub_product", `%${filters.subProduct}%`);
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.lastStatus) query = query.eq("last_contact_status", filters.lastStatus);
  // "none" = unassigned (imported market research awaiting an owner)
  if (filters.responsibleId === "none") query = query.is("responsible_id", null);
  else if (filters.responsibleId) query = query.eq("responsible_id", filters.responsibleId);
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
  // column sorting (v24) — WHITELISTED fields only; anything else falls back
  // to the default recency order. Nulls always sink to the bottom.
  const SORTABLE = new Set([
    "created_at", "updated_at", "normalized_name", "stage", "attempts",
    "next_step_date", "last_contact_at", "slots_count", "deals_count", "function",
  ]);
  const sortField = filters.sort && SORTABLE.has(filters.sort) ? filters.sort : "updated_at";
  const ascending = filters.dir === "asc";
  // id tiebreak: bulk-imported rows share timestamps — pages must be stable.
  // Wrapped in an object: the builder is a THENABLE, so returning it bare from
  // this async function would let `await` execute it before .range() applies.
  return {
    query: query
      .order(sortField, { ascending, nullsFirst: false })
      .order("id"),
  };
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
  // slug: dashes were spaces (names containing real dashes are matched second).
  // v23.2: a name can exist TWICE (archived in one world + active in the
  // other) — the slug resolves to the ACTIVE one first, newest as tiebreak;
  // archived rows are always reachable by their UUID link.
  const candidates = [...new Set([raw.replace(/-/g, " "), raw])];
  const { data } = await db()
    .from("accounts_pipeline")
    .select("*")
    .in("normalized_name", candidates)
    .order("out_of_process", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PipelineRow>();
  return data ?? null;
}

export async function getAccount(viewer: Viewer, idOrSlug: string) {
  const account = await findAccountRow(idOrSlug);
  if (!account || !canViewAccount(viewer, account)) return null;
  // test accounts open ONLY in test mode — no guessing a test URL to see fake
  // data (a followup email could even hand out the link)
  if (account.is_test && !viewer.testMode) return null;
  const id = account.id;

  // MIGRATION-0018 GRACE: the deal_allocations embed fails the WHOLE deals
  // query on a pre-0018 DB — retry without it so deal history never vanishes.
  const fetchDeals = async () => {
    const withAllocs = await db()
      .from("deals")
      .select(
        "*, member:members(name, nickname), allocations:deal_allocations(member_id, slots_igv, slots_igta, slots_igte, member:members(name, nickname))"
      )
      .eq("account_id", id)
      .order("created_at", { ascending: false });
    if (!withAllocs.error) return withAllocs;
    return db()
      .from("deals")
      .select("*, member:members(name, nickname)")
      .eq("account_id", id)
      .order("created_at", { ascending: false });
  };
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
      fetchDeals(),
    ]);
  return {
    account,
    attempts: attempts ?? [],
    visits: visits ?? [],
    comments: (comments ?? []) as CommentWithMember[],
    deals: (deals ?? []) as DealWithMember[],
  };
}

export interface DealAllocation {
  member_id: string;
  slots_igv: number;
  slots_igta: number;
  slots_igte: number;
  member: { name: string; nickname: string | null } | null;
}

export type DealWithMember = Deal & {
  member: { name: string; nickname: string | null } | null;
  allocations?: DealAllocation[];
};

export type CommentWithMember = AccountComment & {
  member: { name: string; nickname: string | null } | null;
};

export interface NameCheckResult {
  /** BLOCKS: an active account anywhere, or an archived one in the SAME world */
  duplicate: PipelineRow | null;
  /** BLOCKS: manual/imported archive names (the ICX-raising world's list) */
  blacklisted: BlacklistEntry | null;
  /** INFO ONLY (v23.2): archived in the OTHER world — B2C has no relation
   *  with the raising archive and vice versa, so this never blocks */
  crossWorldArchived: PipelineRow | null;
}

/** Duplicate + archive check for the Add Account flow — WORLD-AWARE (v23.2):
 *  ACTIVE names are unique across every function, but each world (ICX-raising
 *  IGV/IGT/B2B/BD vs B2C) keeps its OWN archive: a name the raising crews
 *  burned can still be a fresh B2C partner, and vice versa. */
export async function checkAccountName(
  name: string,
  fn?: AccountFunction
): Promise<NameCheckResult> {
  const normalized = normalizeName(name);
  if (!normalized)
    return { duplicate: null, blacklisted: null, crossWorldArchived: null };
  const world: "ICX" | "B2C" = fn === "B2C" ? "B2C" : "ICX";
  const [{ data: rows }, { data: blacklistHit }] = await Promise.all([
    db()
      .from("accounts_pipeline")
      .select("*")
      .eq("normalized_name", normalized)
      .eq("is_test", false) // a hidden test account never blocks a real name
      .limit(2),
    db()
      .from("blacklist")
      .select("*")
      .eq("normalized_name", normalized)
      .maybeSingle<BlacklistEntry>(),
  ]);
  const all = (rows ?? []) as PipelineRow[];
  const sameWorld = (r: PipelineRow) => (r.function === "B2C") === (world === "B2C");
  const active = all.find((r) => !r.out_of_process) ?? null;
  const archivedSame = all.find((r) => r.out_of_process && sameWorld(r)) ?? null;
  const archivedOther = all.find((r) => r.out_of_process && !sameWorld(r)) ?? null;
  // the manual blacklist is the RAISING world's list — it never blocks B2C
  const blacklisted = world === "ICX" ? (blacklistHit ?? null) : null;
  const duplicate = active ?? archivedSame;
  return {
    duplicate,
    blacklisted,
    crossWorldArchived: !duplicate && !blacklisted ? archivedOther : null,
  };
}

// ------------------------------------------------------------------ members

export async function listVisibleMembers(viewer: Viewer): Promise<Member[]> {
  let query = db().from("members").select("*").eq("is_active", true);
  const scope = accountScope(viewer);
  if (scope.kind === "functions") {
    // B2B/BD (and B2C) people may carry those names as sub-functions only —
    // match both columns
    const subFns = scope.fns.filter((f) => f === "B2B" || f === "BD" || f === "B2C");
    query =
      subFns.length > 0
        ? query.or(
            `functions.ov.{${scope.fns.join(",")}},sub_functions.ov.{${subFns.join(",")}}`
          )
        : query.overlaps("functions", scope.fns);
  }
  if (scope.kind === "members") query = query.in("id", scope.ids);
  const { data } = await query.order("name");
  return (data ?? []) as Member[];
}

/** The members a viewer may reassign accounts TO at the list level (bulk
 *  reassign) — the viewer-wide reassign scope, NOT the wider view scope.
 *  Mirrors reassignTargetScope so the bulk dialog can't offer people the
 *  per-account rule would reject. */
export async function listReassignTargetsForViewer(viewer: Viewer): Promise<Member[]> {
  const scope = reassignTargetScope(viewer);
  if (scope.kind === "members" && scope.ids.length === 0) return [];
  let query = db().from("members").select("*").eq("is_active", true);
  if (scope.kind === "functions") {
    // any of the viewer's functions — B2B/BD/B2C folks may sit in sub-functions
    const fns = scope.fns;
    const subFns = fns.filter((f) => f === "B2B" || f === "BD" || f === "B2C");
    query =
      subFns.length > 0
        ? query.or(`functions.ov.{${fns.join(",")}},sub_functions.ov.{${subFns.join(",")}}`)
        : query.overlaps("functions", fns);
  } else if (scope.kind === "members") {
    query = query.in("id", scope.ids);
  }
  // scope.kind === "all" → no filter (every active member)
  const { data } = await query.order("name");
  return (data ?? []) as Member[];
}

export async function listReassignTargets(viewer: Viewer, fn: AccountFunction): Promise<Member[]> {
  const scope = reassignTargetScope(viewer);
  if (scope.kind === "members" && scope.ids.length === 0) return [];
  let query = db().from("members").select("*").eq("is_active", true);
  if (scope.kind === "all" || scope.kind === "functions") {
    // reassignment stays inside the account's function (B2B/BD = the B2B crew)
    query =
      fn === "B2B" || fn === "BD"
        ? query.or("functions.ov.{B2B,BD},sub_functions.ov.{B2B,BD}")
        : fn === "B2C"
          ? query.or("functions.ov.{B2C},sub_functions.ov.{B2C}")
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
  // B2C is its own module — it never pollutes the All-ICX lane (v23)
  if (lane === "all") return r.function !== "B2C";
  if (lane === "IGV") return r.function === "IGV";
  if (lane === "IGT") return r.function === "IGT";
  if (lane === "IGTa") return r.function === "IGT" && r.product === "GTa";
  if (lane === "IGTe") return r.function === "IGT" && r.product === "GTe";
  // B2B & BD are one function — the B2B lane shows both labels
  if (lane === "B2B") return r.function === "B2B" || r.function === "BD";
  if (lane === "B2C") return r.function === "B2C";
  return true;
}

/** Opens this account contributes to a lane. Deals carry a per-product split
 *  (B2B mixes all three; IGT deals split IGTa/IGTe), so a lane's slots include
 *  every account's contribution — B2B included. */
function laneSlots(r: PipelineRow, lane: string): number {
  // B2C deals carry no opens — the lane has no slots at all (v23)
  if (lane === "B2C" || r.function === "B2C") return 0;
  if (lane === "all") return r.slots_count ?? 0;
  // pre-0009 fallback: attribute the account's total to its own product
  if (r.slots_igv_count == null)
    return rowInLane(r, lane) ? r.slots_count ?? 0 : 0;
  if (lane === "IGV") return r.slots_igv_count ?? 0;
  if (lane === "IGTa") return r.slots_igta_count ?? 0;
  if (lane === "IGTe") return r.slots_igte_count ?? 0;
  if (lane === "IGT") return (r.slots_igta_count ?? 0) + (r.slots_igte_count ?? 0);
  if (lane === "B2B")
    return r.function === "B2B" || r.function === "BD" ? r.slots_count ?? 0 : 0;
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
    // B2C deals carry NO opens — count them straight off the account (v23)
    if (r.function === "B2C" && (r.deals_count ?? 0) > 0) {
      s.deals += r.deals_count ?? 0;
      s.dealAccounts += 1;
    }
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
  // B2B/BD crew: whole-FUNCTION aggregates (their B2B/BD accounts) — but NOT
  // the rest of the ICX (v15 isolation); scopeFunctions gives them B2B + BD
  if (isB2B(viewer)) return { ...viewer, role: "Director" };
  // B2C crew: whole-B2C aggregates, same isolation idea (v23)
  if (isB2C(viewer)) return { ...viewer, role: "Director" };
  if (scope.kind === "functions") return viewer;
  const fns = icxFunctions(viewer);
  if (fns.length === 0) return viewer;
  // widen the scope to the member's function(s) by impersonating a Director-like view
  return { ...viewer, role: "Director" };
}

/** One deal_allocations row + its deal's account (for lane/scope checks).
 *  v22: a deal's opens can be split across members — every per-MEMBER opens
 *  number reads from allocations, not the account counters. */
interface AllocRow {
  member_id: string;
  slots_igv: number;
  slots_igta: number;
  slots_igte: number;
  deal: { account_id: string } | null;
}

/** Opens one allocation contributes to a lane (mirror of laneSlots, but for a
 *  single allocation row instead of an account's running counters). */
function laneAllocSlots(
  a: { slots_igv: number; slots_igta: number; slots_igte: number },
  lane: string,
  accountFn: string
): number {
  // B2C has NO opens at all (v23) — allocations never count into its lane
  if (lane === "B2C" || accountFn === "B2C") return 0;
  if (lane === "IGV") return a.slots_igv ?? 0;
  if (lane === "IGTa") return a.slots_igta ?? 0;
  if (lane === "IGTe") return a.slots_igte ?? 0;
  if (lane === "IGT") return (a.slots_igta ?? 0) + (a.slots_igte ?? 0);
  const totalSlots = (a.slots_igv ?? 0) + (a.slots_igta ?? 0) + (a.slots_igte ?? 0);
  if (lane === "B2B") return accountFn === "B2B" || accountFn === "BD" ? totalSlots : 0;
  return totalSlots; // "all"
}

export async function getDashboard(
  viewer: Viewer,
  filters: AccountFilters = {},
  laneKey?: string
) {
  const lane = laneKey && laneKey !== "all" ? laneKey : "all";
  const dashViewer = dashboardViewer(viewer);
  // lane filtering happens HERE in JS — a DB fn/product filter would drop the
  // B2B (and cross-product IGT) accounts whose opens feed this lane.
  // responsibleId ("My numbers" / the member select) is ALSO applied in JS:
  // it scopes the KPI + conversion totals ONLY — leaderboards, drills and
  // goal progress always show the full picture.
  const rows = await listAccounts(dashViewer, {
    ...filters,
    fn: undefined,
    product: undefined,
    responsibleId: undefined,
    includeArchived: true,
  });
  const inKpiScope = (r: PipelineRow) =>
    !filters.responsibleId || r.responsible_id === filters.responsibleId;
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
  const rowById = new Map(rows.map((r) => [r.id, r]));

  for (const r of rows) {
    const inLane = rowInLane(r, lane);
    const contributes = laneSlots(r, lane) > 0;
    if (!inLane && !contributes) continue; // nothing for this lane

    if (inKpiScope(r)) addRowLane(total, r, lane);

    // product drill: IGV / IGTa / IGTe / B2B rows (account-level numbers)
    if (inLane) {
      const fnKey =
        r.function === "IGT" ? (r.product ? `I${r.product}` : "IGT") : r.function;
      addRowLane(getOrInit(byFunction, fnKey, fnKey), r, lane);
    }

    // MM drill (v23.2 — was "by team"): every Team Leader AND Coordinator
    // gets a row aggregating their whole portfolio (a TL's row includes the
    // team's accounts; a Coordinator's their own). VP/admin-owned accounts
    // still create no row — the EB is not an MM.
    const mmKey =
      r.responsible_role === "Team Leader" || r.responsible_role === "Coordinator"
        ? r.responsible_id
        : r.responsible_stakeholder_id ?? null;
    const mm = mmKey ? byId.get(mmKey) : undefined;
    if (mm && (mm.role === "Team Leader" || mm.role === "Coordinator")) {
      const mmLabel = mm.team_name
        ? `${mm.nickname || mm.name} — ${mm.team_name}`
        : mm.nickname || mm.name;
      addRowLane(getOrInit(byTeam, mm.id, mmLabel), r, lane);
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
  }

  // ---- per-member opens come from deal ALLOCATIONS (v22): a deal's opens can
  // be split across members, so boards can't trust the account counters. Only
  // allocations whose parent account is in the scoped/filtered row set count —
  // the boards stay consistent with the rest of the dashboard. When the table
  // is empty (pre-migration), keep the account-based numbers.
  const allocations = await fetchAll<AllocRow>(() =>
    db()
      .from("deal_allocations")
      .select("member_id, slots_igv, slots_igta, slots_igte, deal:deals!inner(account_id)")
      .order("id")
  ).catch(() => [] as AllocRow[]);
  const allocSlotsByMember = new Map<string, number>();
  for (const al of allocations) {
    const acc = al.deal ? rowById.get(al.deal.account_id) : undefined;
    if (!acc) continue; // outside this viewer's scope / the active filters
    const v = laneAllocSlots(al, lane, acc.function);
    if (v > 0)
      allocSlotsByMember.set(al.member_id, (allocSlotsByMember.get(al.member_id) ?? 0) + v);
  }
  if (allocations.length > 0) {
    // members who received split opens without owning a scoped account still
    // deserve a board row
    for (const [mid, v] of allocSlotsByMember) {
      const m = byId.get(mid);
      if (!m || v <= 0) continue;
      const label = m.nickname || m.name;
      if (m.role === "Member") {
        getOrInit(byMemberRole, mid, label);
        getOrInit(byPerson, mid, label);
      } else if (m.role === "Team Leader" || m.role === "Coordinator") {
        getOrInit(byMM, mid, label);
        getOrInit(byPerson, mid, label);
      }
    }
    for (const map of [byMemberRole, byMM, byPerson])
      for (const g of map.values()) g.slots = allocSlotsByMember.get(g.key) ?? 0;
    // "My numbers": the member's personal opens are what was ALLOCATED to them
    if (filters.responsibleId && filters.responsibleId !== "none")
      total.slots = allocSlotsByMember.get(filters.responsibleId) ?? 0;
  }

  const rank = (a: DrillGroup, b: DrillGroup) =>
    b.slots - a.slots || b.deals - a.deals || b.visitDone - a.visitDone || b.contacted - a.contacted;
  const memberBoard = [...byMemberRole.values()].sort(rank);
  const mmBoard = [...byMM.values()].sort(rank);
  const teamBoard = teamMemberIds
    ? [...byPerson.values()].filter((g) => teamMemberIds.has(g.key)).sort(rank)
    : [];

  // ---- the team's plan (v22 — goals come from planning, never set in-app):
  // the TL's filed opens plan for the CURRENT month vs what the team actually
  // raised this month (allocation-attributed, so split opens count correctly).
  let teamPlan: TeamPlan | null = null;
  const teamLeadRow = teamLeadId ? byId.get(teamLeadId) : undefined;
  const teamLeadPlans =
    !!teamLeadRow &&
    isPlanningTl({
      role: teamLeadRow.role,
      functions: teamLeadRow.functions ?? [],
      sub_functions: teamLeadRow.sub_functions ?? [],
    });
  if (teamLeadId && teamMemberIds && teamLeadPlans) {
    const month = monthOf();
    const { data: planRow } = await db()
      .from("tl_plans")
      .select("opens")
      .eq("member_id", teamLeadId)
      .eq("month", month.planKeys[0])
      .maybeSingle<{ opens: number }>();
    let q = db()
      .from("deal_allocations")
      .select(
        "slots_igv, slots_igta, slots_igte, deal:deals!inner(created_at, account:accounts!inner(is_test))"
      )
      .in("member_id", [...teamMemberIds])
      .gte("deal.created_at", `${month.start}T00:00:00`)
      .lte("deal.created_at", `${month.end}T23:59:59`);
    if (!viewer.testMode) q = q.eq("deal.account.is_test", false);
    const { data: monthAllocs } = await q;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actualOpens = ((monthAllocs ?? []) as any[]).reduce(
      (s, a) => s + (a.slots_igv ?? 0) + (a.slots_igta ?? 0) + (a.slots_igte ?? 0),
      0
    );
    teamPlan = {
      teamLeaderId: teamLeadId,
      monthLabel: month.label,
      plannedOpens: planRow?.opens ?? 0,
      actualOpens,
    };
  }

  // ---- VP plan snapshot (from the imported planning sheet) --------------
  // Product lanes only: IGV / IGTa / IGTe map 1:1 to plan_cells.fn; the IGT
  // lane sums IGTa+IGTe. Opens are planned monthly AND split per sprint; the
  // consideration funnel is per sprint. Actual opens come from deals created
  // in the window (per-product split — B2B deals feed the lanes too).
  let lanePlan: LanePlan | null = null;
  if (lane === "IGV" || lane === "IGTa" || lane === "IGTe" || lane === "IGT") {
    const planFns = lane === "IGT" ? ["IGTa", "IGTe"] : [lane];
    const [cells, sprint, month] = [await listPlanCells(planFns), sprintOf(), monthOf()];
    if (cells.length > 0) {
      const sum = (scope: string, keys: string[], metric: string) =>
        cells
          .filter((c) => c.scope === scope && keys.includes(c.period_start) && c.metric === metric)
          .reduce((s, c) => s + c.value, 0);
      const [sprintActual, monthActual] = await Promise.all([
        laneOpensActual(sprint.start, sprint.end, { includeTest: !!viewer.testMode }),
        laneOpensActual(month.start, month.end, { includeTest: !!viewer.testMode }),
      ]);
      const act = (a: { IGV: number; IGTa: number; IGTe: number }) =>
        lane === "IGT" ? a.IGTa + a.IGTe : a[lane as "IGV" | "IGTa" | "IGTe"];
      const funnel = (scope: string, keys: string[]) =>
        (["applicants", "accepted", "approvals"] as const).map((m) => ({
          metric: m,
          value: sum(scope, keys, m),
        }));
      lanePlan = {
        lane,
        sprint: {
          label: sprint.label,
          plannedOpens: sum("sprint", sprint.planKeys, "opens"),
          actualOpens: act(sprintActual),
          funnel: funnel("sprint", sprint.planKeys),
        },
        month: {
          label: month.label,
          plannedOpens: sum("month", month.planKeys, "opens"),
          actualOpens: act(monthActual),
          funnel: funnel("month", month.planKeys),
        },
      };
    }
  }

  return {
    total,
    byFunction: [...byFunction.values()],
    byTeam: [...byTeam.values()].sort((a, b) => b.mr - a.mr),
    memberBoard,
    mmBoard,
    teamBoard,
    teamLeadId,
    lanePlan,
    teamPlan,
  };
}

/** The dashboard's per-lane plan snapshot (current sprint + current month). */
export interface LanePlan {
  lane: string;
  sprint: LanePlanWindow;
  month: LanePlanWindow;
}
export interface LanePlanWindow {
  label: string;
  plannedOpens: number;
  actualOpens: number;
  funnel: { metric: string; value: number }[];
}

/** The viewer's team plan snapshot (v22): the TL's filed opens plan for the
 *  current month vs the team's allocation-attributed opens this month. */
export interface TeamPlan {
  teamLeaderId: string;
  monthLabel: string;
  plannedOpens: number;
  actualOpens: number;
}

// ------------------------------------------------------------------ manual archive

export interface ManualArchivedRow extends BlacklistEntry {
  added_by_member: { name: string; nickname: string | null } | null;
}

/** Manually archived account names (never worked in the CRM) — they live in
 *  the blacklist table and block re-adding exactly like OOP accounts. */
export async function listManualArchived(): Promise<ManualArchivedRow[]> {
  return fetchAll<ManualArchivedRow>(() =>
    db()
      .from("blacklist")
      .select("*, added_by_member:members!blacklist_added_by_fkey(name, nickname)")
      .order("created_at", { ascending: false })
      .order("id")
  );
}

function getOrInit(map: Map<string, DrillGroup>, key: string, label: string): DrillGroup {
  let g = map.get(key);
  if (!g) {
    g = { key, label, ...emptyStats() };
    map.set(key, g);
  }
  return g;
}

// ------------------------------------------------------------------ teams

export interface Team {
  type: "EB" | "LB" | "Function" | "Function leaders" | "Team";
  function_key: string; // "" | IGV | IGT | B2B
  name: string;
}

export async function listTeams(): Promise<Team[]> {
  const { data } = await db().from("teams").select("type, function_key, name");
  return (data ?? []) as Team[];
}

/** The named teams a member belongs to, derived from their role + functions +
 *  stakeholder link. Everyone is in AIESEC teams at several levels. */
export async function teamsForViewer(viewer: Viewer): Promise<{ label: string; name: string }[]> {
  const teams = await listTeams();
  const byKey = new Map(teams.map((t) => [`${t.type}:${t.function_key}`, t.name]));
  const out: { label: string; name: string }[] = [];
  const push = (label: string, name?: string | null) => {
    if (name) out.push({ label, name });
  };

  const onEb = viewer.isAdmin || viewer.role === "LCP" || viewer.role === "LCVP";
  const isManager =
    viewer.isAdmin || ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(viewer.role);
  const fns = [
    ...new Set([
      ...viewer.functions.filter((f) => ["IGV", "IGT", "B2B", "BD"].includes(f)),
      ...(isB2B(viewer) ? ["B2B"] : []),
    ]),
  ];

  if (onEb) push("Executive Board", byKey.get("EB:"));
  if (isManager) push("Leadership Body", byKey.get("LB:"));
  for (const fn of fns) push(`${fn} function`, byKey.get(`Function:${fn}`));
  // the "Function leaders" team: the function's VP/Director + their TLs
  if (["Team Leader", "Coordinator", "Director", "LCVP"].includes(viewer.role))
    for (const fn of fns) push(`${fn} leaders`, byKey.get(`Function leaders:${fn}`));

  // Team-Leader team (from members.team_name): their own if TL, else their manager's
  if (viewer.role === "Team Leader") push("My team", viewer.team_name);
  else if (viewer.stakeholder_id) {
    const { data: tl } = await db()
      .from("members")
      .select("role, team_name")
      .eq("id", viewer.stakeholder_id)
      .maybeSingle<{ role: string; team_name: string | null }>();
    if (tl?.role === "Team Leader") push("My team", tl.team_name);
  }

  // de-dupe by name
  const seen = new Set<string>();
  return out.filter((t) => (seen.has(t.name) ? false : seen.add(t.name)));
}

/** The display name of a function's team (e.g. "فرقة ناجي عطالله" for IGT). */
export async function functionTeamName(fn: string): Promise<string | null> {
  const { data } = await db()
    .from("teams")
    .select("name")
    .eq("type", "Function")
    .eq("function_key", fn)
    .maybeSingle<{ name: string }>();
  return data?.name ?? null;
}

// ------------------------------------------------------------------ TM module

export interface MemberDirectoryEntry {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  phone: string | null;
  role: string;
  functions: string[];
  sub_functions: string[];
  team_name: string | null;
  manager: string | null;
  /** which MOS family this member's numbers belong to (v21):
   *  raising → opens · bd → money (EGP) · consideration/ogx → approvals (plan)
   *  · other → info only */
  mos: "raising" | "bd" | "b2c" | "consideration" | "ogx" | "other";
  /** the member's MOS/KPIs — their own accounts' funnel numbers */
  kpis: {
    mr: number;
    contacted: number;
    visits: number;
    visitsDone: number;
    deals: number;
    slots: number;
    /** BD only: Σ deal amounts (EGP) on their accounts */
    egp: number;
    /** consideration/OGX only: their mm_plans totals (applicants·accepted·approvals) */
    planApplicants: number;
    planAccepted: number;
    planApprovals: number;
  };
}

/** The TM module's whole-LC members directory: every active member with their
 *  info + personal KPIs (MOS) + contact shortcuts. TM function, LCP, admin. */
export async function listMembersDirectory(
  viewer: Viewer
): Promise<MemberDirectoryEntry[]> {
  if (!hasTmAccess(viewer)) return [];

  const [{ data: membersData }, accountsData, { data: bdDeals }, { data: mmPlans }, allocations] =
    await Promise.all([
      db()
        .from("members")
        .select(
          "id, name, nickname, email, phone, role, functions, sub_functions, team_name, stakeholder_id"
        )
        .eq("is_active", true)
        .order("name"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<any>(() =>
        db()
          .from("accounts_pipeline")
          .select("responsible_id, attempts, visit_id, visit_done, deals_count, slots_count")
          .eq("is_test", false)
          .order("id")
      ),
      // BD money: Σ deal amounts on BD accounts, per responsible
      db()
        .from("deals")
        .select("amount, account:accounts!inner(responsible_id, function, is_test)")
        .eq("account.function", "BD")
        .eq("account.is_test", false),
      db().from("mm_plans").select("member_id, applicants, accepted, approvals"),
      // per-member opens = deal allocations (v22 — split deals count correctly)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<any>(() =>
        db()
          .from("deal_allocations")
          .select(
            "member_id, slots_igv, slots_igta, slots_igte, deal:deals!inner(account:accounts!inner(is_test))"
          )
          .eq("deal.account.is_test", false)
          .order("id")
      ).catch(() => []),
    ]);

  type Agg = MemberDirectoryEntry["kpis"];
  const emptyAgg = (): Agg => ({
    mr: 0, contacted: 0, visits: 0, visitsDone: 0, deals: 0, slots: 0,
    egp: 0, planApplicants: 0, planAccepted: 0, planApprovals: 0,
  });
  const kpisById = new Map<string, Agg>();
  const agg = (id: string) => {
    let k = kpisById.get(id);
    if (!k) { k = emptyAgg(); kpisById.set(id, k); }
    return k;
  };
  const useAllocations = allocations.length > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const a of (accountsData ?? []) as any[]) {
    if (!a.responsible_id) continue; // unassigned imports belong to nobody yet
    const k = agg(a.responsible_id);
    k.mr += 1;
    if (a.attempts > 0) k.contacted += 1;
    if (a.visit_id) k.visits += 1;
    if (a.visit_done) k.visitsDone += 1;
    k.deals += a.deals_count ?? 0;
    // pre-0018 fallback: no allocations table → account counters
    if (!useAllocations) k.slots += a.slots_count ?? 0;
  }
  // opens are allocation-attributed (a split deal credits each member their share)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const al of allocations as any[]) {
    agg(al.member_id).slots +=
      (al.slots_igv ?? 0) + (al.slots_igta ?? 0) + (al.slots_igte ?? 0);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of (bdDeals ?? []) as any[]) {
    const owner = d.account?.responsible_id;
    if (owner) agg(owner).egp += Number(d.amount) || 0;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (mmPlans ?? []) as any[]) {
    const k = agg(p.member_id);
    k.planApplicants += p.applicants ?? 0;
    k.planAccepted += p.accepted ?? 0;
    k.planApprovals += p.approvals ?? 0;
  }

  /** MOS classification (v21) — mirrors the function definitions in rbac.ts,
   *  but on bare member rows:
   *  BD-only crew → money · B2B/BD → opens (raising) · ICX raising (or ICX
   *  leaders) → opens · OGX → approvals · ICX consideration-only → approvals
   *  · everyone else (TM/F&L/B2C/CXP/LCP…) → info only. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const classify = (m: any): MemberDirectoryEntry["mos"] => {
    const fns: string[] = m.functions ?? [];
    const subs: string[] = m.sub_functions ?? [];
    const b2b = ["B2B", "BD"].some((f) => fns.includes(f) || subs.includes(f));
    const b2c = fns.includes("B2C") || subs.includes("B2C");
    if (b2c && !b2b) return "b2c"; // B2C's MOS = deals signed (v23)
    const icx = fns.includes("IGV") || fns.includes("IGT");
    const ogx = fns.includes("OGV") || fns.includes("OGT");
    if (b2b) {
      // one crew, two MOS: money when they're BD-labeled only, else opens
      const bdOnly = (fns.includes("BD") || subs.includes("BD")) &&
        !fns.includes("B2B") && !subs.includes("B2B");
      return bdOnly ? "bd" : "raising";
    }
    if (icx) {
      const leader = m.role === "LCVP" || m.role === "Director";
      const raising = subs.includes("Raising") || subs.includes("ICX");
      const consideration = subs.includes("Consideration");
      if (leader || raising) return "raising";
      if (consideration) return "consideration";
      return "raising";
    }
    if (ogx) return "ogx";
    return "other";
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = (membersData ?? []) as any[];
  const nameById = new Map(members.map((m) => [m.id, m.nickname || m.name]));
  return members.map((m) => ({
    id: m.id,
    name: m.name,
    nickname: m.nickname,
    email: m.email,
    phone: m.phone,
    role: m.role,
    functions: m.functions ?? [],
    sub_functions: m.sub_functions ?? [],
    team_name: m.team_name,
    manager: m.stakeholder_id ? nameById.get(m.stakeholder_id) ?? null : null,
    mos: classify(m),
    kpis: kpisById.get(m.id) ?? emptyAgg(),
  }));
}

// ------------------------------------------------------------------ my people

export interface PersonCard {
  id: string;
  name: string;
  nickname: string | null;
  role: string;
  email: string | null;
  phone: string | null;
  team_name: string | null;
  functions: string[];
}

/** The people a leader looks after, for the profile card:
 *  Team Leader → their direct team · VP/Director → their whole function ·
 *  LCP/admin → the EB (the LCVPs) · Members/Coordinators → nothing. */
export async function profilePeople(
  viewer: Viewer
): Promise<{ title: string; people: PersonCard[] } | null> {
  const strip = (m: Member): PersonCard => ({
    id: m.id,
    name: m.name,
    nickname: m.nickname,
    role: m.role,
    email: m.email,
    phone: m.phone,
    team_name: m.team_name,
    functions: m.functions ?? [],
  });

  if (viewer.isAdmin || viewer.role === "LCP") {
    const { data } = await db()
      .from("members")
      .select("*")
      .eq("is_active", true)
      .eq("role", "LCVP")
      .order("name");
    const people = ((data ?? []) as Member[]).map(strip);
    return people.length > 0 ? { title: "The Executive Board", people } : null;
  }

  if (viewer.role === "LCVP" || viewer.role === "Director") {
    // match by the VP's OWN functions (works for TM/OGX/… too, not only ICX)
    const fns = (viewer.functions ?? []).filter(Boolean);
    if (fns.length === 0) return null;
    const list = `{${fns.join(",")}}`;
    const { data } = await db()
      .from("members")
      .select("*")
      .eq("is_active", true)
      .or(`functions.ov.${list},sub_functions.ov.${list}`)
      .order("name");
    const people = ((data ?? []) as Member[])
      .filter((m) => m.id !== viewer.id && m.role !== "LCP")
      .map(strip);
    return people.length > 0 ? { title: "My function", people } : null;
  }

  if (viewer.role === "Team Leader") {
    const { data } = await db()
      .from("members")
      .select("*")
      .eq("is_active", true)
      .eq("stakeholder_id", viewer.id)
      .order("name");
    const people = ((data ?? []) as Member[]).map(strip);
    return people.length > 0 ? { title: "My team", people } : null;
  }

  // Members & Coordinators see their own team: their Team Leader + teammates
  if (viewer.stakeholder_id) {
    const { data: tl } = await db()
      .from("members")
      .select("*")
      .eq("id", viewer.stakeholder_id)
      .eq("is_active", true)
      .maybeSingle<Member>();
    if (tl?.role !== "Team Leader") return null;
    const { data: mates } = await db()
      .from("members")
      .select("*")
      .eq("is_active", true)
      .eq("stakeholder_id", tl.id)
      .order("name");
    const people = [
      strip(tl),
      ...((mates ?? []) as Member[]).filter((m) => m.id !== viewer.id).map(strip),
    ];
    return { title: `My team${tl.team_name ? ` — ${tl.team_name}` : ""}`, people };
  }

  return null;
}

// ------------------------------------------------------------------ calendar

export interface CalendarVisit {
  id: string;
  visit_date: string;
  visit_time: string;
  done: boolean | null;
  account: { id: string; name: string; function: string };
  member: { id: string; name: string; nickname: string | null };
}

/** Every visit of the viewer's OWN function(s) in a date range: IGV people
 *  see IGV visits, IGT people IGT, the B2B/BD crew theirs — only the LCP and
 *  admins see the whole LC's calendar. Archived accounts' visits are hidden. */
export async function listFunctionVisits(
  viewer: Viewer,
  from: string,
  to: string
): Promise<CalendarVisit[]> {
  // hard server-side gate: no raising access → no visit data, ever (the
  // layout's ComingSoon overlay is cosmetic — RSC payloads still ship)
  if (!hasRaisingAccess(viewer)) return [];
  let visitsQuery = db()
    .from("visits")
    .select(
      "id, visit_date, visit_time, done, " +
        "account:accounts!inner(id, name, function, out_of_process, is_test), " +
        "member:members(id, name, nickname)"
    );
  if (!viewer.testMode) visitsQuery = visitsQuery.eq("account.is_test", false);
  const { data } = await visitsQuery
    .gte("visit_date", from)
    .lte("visit_date", to)
    .order("visit_date")
    .order("visit_time");

  const master = accountScope(viewer).kind === "all";
  const fns = new Set<string>(
    viewer.functions.filter((f) => f === "IGV" || f === "IGT")
  );
  if (isB2B(viewer)) {
    fns.add("B2B");
    fns.add("BD");
  }
  if (isB2C(viewer)) fns.add("B2C");
  type Row = CalendarVisit & { account: CalendarVisit["account"] & { out_of_process: boolean } };
  return ((data ?? []) as unknown as Row[])
    .filter((v) => v.account && !v.account.out_of_process && v.member)
    .filter((v) => master || fns.has(v.account.function));
}

// ------------------------------------------------------------------ audit

export async function logAudit(
  actorId: string | null,
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

// ------------------------------------------------------------------ cron run tracking

/** Stamp a cron's last successful run (app_settings key `cron:<name>`), so the
 *  admin health page can show real last-run times. Best-effort. */
export async function markCronRun(name: string): Promise<void> {
  try {
    await db()
      .from("app_settings")
      .upsert(
        { key: `cron:${name}`, value: {}, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
  } catch {
    /* never let tracking break a cron */
  }
}

// ------------------------------------------------------------------ admin: health & logs

export interface SystemHealth {
  checks: { label: string; ok: boolean; detail: string }[];
  counts: { label: string; value: number }[];
  crons: { label: string; lastRun: string | null; note: string }[];
}

export interface AuditEntry {
  id: number;
  action: string;
  entity: string;
  actor: string | null;
  details: string | null;
  createdAt: string;
}

/** Head-only count of a table, optionally filtered on one boolean column. */
async function countOf(
  table: string,
  eq?: [string, boolean]
): Promise<number> {
  try {
    const base = db().from(table).select("*", { count: "exact", head: true });
    const { count } = await (eq ? base.eq(eq[0], eq[1]) : base);
    return count ?? 0;
  } catch {
    return -1;
  }
}

/** The Google Calendar health probe is the one EXPENSIVE external call in the
 *  health snapshot; cache it 5 min so the admin page's 30s auto-refresh (and
 *  many admins) can't burn Calendar quota or add token-refresh latency. */
let calHealthCache: { at: number; result: { ok: boolean; detail: string } } | null = null;
async function cachedCalendarHealth(): Promise<{ ok: boolean; detail: string }> {
  if (calHealthCache && Date.now() - calHealthCache.at < 5 * 60_000)
    return calHealthCache.result;
  const { diagnoseMailboxCalendar } = await import("@/lib/google/calendar");
  const result = await diagnoseMailboxCalendar();
  calHealthCache = { at: Date.now(), result };
  return result;
}

/** Live health snapshot for the admin page — DB, storage, Google calendar,
 *  key env vars, table counts, and cron last-run proxies. Admin-gated by the
 *  caller. Every probe is defensive: one failure never breaks the page. */
export async function getSystemHealth(): Promise<SystemHealth> {
  const checks: SystemHealth["checks"] = [];

  // DB reachability (a trivial head query)
  let dbOk = false;
  try {
    const { error } = await db().from("members").select("id", { head: true, count: "exact" });
    dbOk = !error;
    checks.push({ label: "Database (Supabase)", ok: dbOk, detail: dbOk ? "Reachable" : (error?.message ?? "Unreachable") });
  } catch (e) {
    checks.push({ label: "Database (Supabase)", ok: false, detail: `${e}` });
  }

  // contracts storage bucket
  try {
    const { error } = await db().storage.from("contracts").list("", { limit: 1 });
    checks.push({
      label: "Storage bucket (contracts)",
      ok: !error,
      detail: error ? error.message : "Available",
    });
  } catch (e) {
    checks.push({ label: "Storage bucket (contracts)", ok: false, detail: `${e}` });
  }

  // shared visits calendar (Tier 2) — cached 5 min so the admin page's 30s
  // auto-refresh never hammers the Google Calendar API (quota + latency)
  try {
    const cal = await cachedCalendarHealth();
    checks.push({ label: "Shared visits calendar", ok: cal.ok, detail: cal.detail });
  } catch (e) {
    checks.push({ label: "Shared visits calendar", ok: false, detail: `${e}` });
  }

  // env vars (presence only — never the values)
  checks.push({
    label: "The Blue Man (GEMINI_API_KEY)",
    ok: !!process.env.GEMINI_API_KEY,
    detail: process.env.GEMINI_API_KEY ? "Configured" : "Missing",
  });
  checks.push({
    label: "Cron secret (CRON_SECRET)",
    ok: !!env.cronSecret,
    detail: env.cronSecret ? "Configured" : "Missing",
  });
  checks.push({
    label: "Admin emails (ADMIN_EMAILS)",
    ok: env.adminEmails.length > 0,
    detail: `${env.adminEmails.length} configured`,
  });

  // counts — defensive per table
  const counts: SystemHealth["counts"] = [
    { label: "Active members", value: await countOf("members", ["is_active", true]) },
    { label: "Active accounts", value: await countOf("accounts", ["out_of_process", false]) },
    { label: "Archived accounts", value: await countOf("accounts", ["out_of_process", true]) },
    { label: "Deals", value: await countOf("deals") },
    { label: "Visits", value: await countOf("visits") },
    { label: "Contact attempts", value: await countOf("contact_attempts") },
    { label: "Blacklist", value: await countOf("blacklist") },
    { label: "Feedback", value: await countOf("feedback") },
  ];

  // cron last-run — real timestamps stamped by markCronRun (app_settings)
  const CRON_META: { key: string; label: string; note: string }[] = [
    { key: "visit-followups", label: "Visit follow-ups", note: "every 15 min" },
    { key: "membership-import", label: "Membership import", note: "every 30 min" },
    { key: "sheets-export", label: "Sheets export", note: "hourly" },
    { key: "period-reports", label: "Period reports", note: "daily 07:00 UTC (fires on sprint/month/quarter ends)" },
    { key: "podio-updates", label: "B2C Podio updates", note: "daily 05:00 UTC" },
  ];
  const crons: SystemHealth["crons"] = [];
  try {
    const { data } = await db()
      .from("app_settings")
      .select("key, updated_at")
      .like("key", "cron:%");
    const byKey = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((data ?? []) as any[]).map((r) => [String(r.key).replace("cron:", ""), r.updated_at as string])
    );
    for (const c of CRON_META)
      crons.push({ label: c.label, lastRun: byKey.get(c.key) ?? null, note: c.note });
  } catch {
    for (const c of CRON_META) crons.push({ label: c.label, lastRun: null, note: c.note });
  }

  return { checks, counts, crons };
}

// ================================================================== planning

export interface PlanCell {
  fn: string;
  scope: "month" | "sprint";
  period_start: string;
  metric: string;
  value: number;
}

/** All imported plan cells for the given plan-functions (IGV/IGTa/IGTe/OGV/OGTa/OGTe).
 *  Paged: the full six-lane set is 1500+ rows — over Supabase's 1000-row cap. */
export async function listPlanCells(fns: string[]): Promise<PlanCell[]> {
  if (fns.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchAll<any>(() =>
    db()
      .from("plan_cells")
      .select("id, fn, scope, period_start, metric, value")
      .in("fn", fns)
      .order("period_start")
      .order("id")
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((r) => ({ ...r, value: Number(r.value) })) as PlanCell[];
}

export interface MmPlanRow {
  member_id: string;
  member_name: string;
  member_role: string;
  team_name: string | null;
  month: string;
  applicants: number;
  accepted: number;
  approvals: number;
  peak: string;
}

/** MM monthly plans for a set of members (or all when ids omitted). */
export async function listMmPlans(memberIds?: string[]): Promise<MmPlanRow[]> {
  let q = db()
    .from("mm_plans")
    .select("member_id, month, applicants, accepted, approvals, peak, member:members!member_id(name, nickname, role, team_name)")
    .order("month");
  if (memberIds && memberIds.length > 0) q = q.in("member_id", memberIds);
  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    member_id: r.member_id,
    member_name: r.member?.nickname || r.member?.name || "?",
    member_role: r.member?.role ?? "",
    team_name: r.member?.team_name ?? null,
    month: r.month,
    applicants: r.applicants,
    accepted: r.accepted,
    approvals: r.approvals,
    peak: r.peak,
  }));
}

/** Whether this member is an OGX/Consideration MM who still needs to fill
 *  their first plan. MM = Team Leader or Coordinator. */
export function isPlanningMm(v: {
  role: string; functions: string[]; sub_functions: string[];
}): boolean {
  if (v.role !== "Team Leader" && v.role !== "Coordinator") return false;
  const ogx = v.functions.some((f) => f === "OGV" || f === "OGT");
  const icxConsid =
    v.functions.some((f) => f === "IGV" || f === "IGT") &&
    v.sub_functions.includes("Consideration");
  return ogx || icxConsid;
}

/** True when an eligible MM has not filled a single plan month yet. */
export async function needsMmPlan(v: Viewer): Promise<boolean> {
  if (!isPlanningMm(v)) return false;
  const { count } = await db()
    .from("mm_plans")
    .select("id", { count: "exact", head: true })
    .eq("member_id", v.id);
  return (count ?? 0) === 0;
}

// ------------------------------------------------------- raising MM plans (v22)

/** A RAISING MM — Team Leader or Coordinator of IGV/IGT or the B2B/BD crew —
 *  who plans OPENS per month. Every MM plans (v22.2): raising MMs file opens,
 *  OGX & Consideration MMs file applicants/accepted/approvals (isPlanningMm) —
 *  and an MM wearing BOTH hats (e.g. subs "Raising, Consideration") files
 *  BOTH plans. A TL's opens plan is their TEAM's; a Coordinator's their own. */
export function isPlanningTl(v: {
  role: string;
  functions: string[];
  sub_functions: string[];
}): boolean {
  if (v.role !== "Team Leader" && v.role !== "Coordinator") return false;
  if (["B2B", "BD"].some((f) => v.functions.includes(f) || v.sub_functions.includes(f)))
    return true;
  if (!v.functions.some((f) => f === "IGV" || f === "IGT")) return false;
  // raising sub explicitly — or no Consideration sub at all (default raising)
  return (
    v.sub_functions.includes("Raising") ||
    v.sub_functions.includes("ICX") ||
    !v.sub_functions.includes("Consideration")
  );
}

/** True when an eligible raising MM has not filed a single plan month yet. */
export async function needsTlPlan(v: Viewer): Promise<boolean> {
  if (!isPlanningTl(v)) return false;
  const { count, error } = await db()
    .from("tl_plans")
    .select("id", { count: "exact", head: true })
    .eq("member_id", v.id);
  if (error) return false; // pre-0018 grace: never lock anyone out
  return (count ?? 0) === 0;
}

export interface TlPlanRow {
  member_id: string;
  member_name: string;
  team_name: string | null;
  month: string;
  opens: number;
  peak: string;
}

/** Every TL's monthly opens plan (for /planning) — optionally scoped to ids. */
export async function listTlPlans(memberIds?: string[]): Promise<TlPlanRow[]> {
  let q = db()
    .from("tl_plans")
    .select("member_id, month, opens, peak, member:members!member_id(name, nickname, team_name)")
    .order("month");
  if (memberIds && memberIds.length > 0) q = q.in("member_id", memberIds);
  const { data, error } = await q;
  if (error) return []; // pre-0018 grace
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    member_id: r.member_id,
    member_name: r.member?.nickname || r.member?.name || "?",
    team_name: r.member?.team_name ?? null,
    month: r.month,
    opens: r.opens ?? 0,
    peak: r.peak,
  }));
}

export interface TlPlanData {
  peakLabel: string;
  /** month key (YYYY-MM-01) → filed plan + the team's actual opens that month */
  months: { month: string; opens: number; actual: number }[];
}

/** The profile "My plan" card data for a raising MM: their filed plan for the
 *  current planning peak + the ACTUAL opens per month (allocation-attributed,
 *  so split deals credit the right people). For a TL the actuals cover the
 *  whole team; a Coordinator (no team) tracks their own opens. */
export async function tlPlanForProfile(viewer: Viewer): Promise<TlPlanData | null> {
  if (!isPlanningTl(viewer)) return null;
  const { peakForPlanning } = await import("@/lib/plan");
  const peak = peakForPlanning();
  const teamIds = [viewer.id, ...(viewer.teamMemberIds ?? [])];
  const [{ data: planRows }, { data: allocRows }] = await Promise.all([
    db().from("tl_plans").select("month, opens").eq("member_id", viewer.id),
    db()
      .from("deal_allocations")
      .select(
        "slots_igv, slots_igta, slots_igte, deal:deals!inner(created_at, account:accounts!inner(is_test))"
      )
      .in("member_id", teamIds)
      .eq("deal.account.is_test", false),
  ]);
  const planByMonth = new Map(
    // normalize: PG dates can round-trip with a day component
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((planRows ?? []) as any[]).map((r) => [`${String(r.month).slice(0, 7)}-01`, r.opens ?? 0])
  );
  const actualByMonth = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const a of (allocRows ?? []) as any[]) {
    const created = a.deal?.created_at as string | undefined;
    if (!created) continue;
    const key = `${created.slice(0, 7)}-01`;
    const v = (a.slots_igv ?? 0) + (a.slots_igta ?? 0) + (a.slots_igte ?? 0);
    actualByMonth.set(key, (actualByMonth.get(key) ?? 0) + v);
  }
  return {
    peakLabel: peak.label,
    months: peak.months.map((m) => ({
      month: m,
      opens: planByMonth.get(m) ?? 0,
      actual: actualByMonth.get(m) ?? 0,
    })),
  };
}

export interface MmPlanData {
  peakLabel: string;
  months: { month: string; applicants: number; accepted: number; approvals: number }[];
}

/** The profile "My plan" card data for an OGX / Consideration MM (v22.2 —
 *  the plan used to be fileable only on first sign-in, invisible after). */
export async function mmPlanForProfile(viewer: Viewer): Promise<MmPlanData | null> {
  if (!isPlanningMm(viewer)) return null;
  const { peakForPlanning } = await import("@/lib/plan");
  const peak = peakForPlanning();
  const { data } = await db()
    .from("mm_plans")
    .select("month, applicants, accepted, approvals")
    .eq("member_id", viewer.id);
  const byMonth = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((data ?? []) as any[]).map((r) => [`${String(r.month).slice(0, 7)}-01`, r])
  );
  return {
    peakLabel: peak.label,
    months: peak.months.map((m) => {
      const r = byMonth.get(m);
      return {
        month: m,
        applicants: r?.applicants ?? 0,
        accepted: r?.accepted ?? 0,
        approvals: r?.approvals ?? 0,
      };
    }),
  };
}

/** Everyone in a function (for the deal opens-split picker): active members
 *  carrying the account's function — B2B/BD matches sub-functions too. The
 *  LCP never appears (they don't raise). */
export async function listFunctionMembers(
  fn: AccountFunction
): Promise<{ id: string; label: string }[]> {
  let q = db().from("members").select("id, name, nickname, role").eq("is_active", true);
  q =
    fn === "B2B" || fn === "BD"
      ? q.or("functions.ov.{B2B,BD},sub_functions.ov.{B2B,BD}")
      : fn === "B2C"
        ? q.or("functions.ov.{B2C},sub_functions.ov.{B2C}")
        : q.contains("functions", [fn]);
  const { data } = await q.order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter((m) => m.role !== "LCP")
    .map((m) => ({ id: m.id, label: m.nickname || m.name }));
}

/** Actual opens raised per product lane inside a date window — sum of each
 *  deal's per-product split (B2B/BD deals feed the product lanes too). */
export async function laneOpensActual(
  fromIso: string,
  toIso: string,
  opts: { includeTest?: boolean } = {}
): Promise<{ IGV: number; IGTa: number; IGTe: number }> {
  const { data } = await db()
    .from("deals")
    .select("slots_igv, slots_igta, slots_igte, created_at, account:accounts!account_id(is_test)")
    .gte("created_at", `${fromIso}T00:00:00`)
    .lte("created_at", `${toIso}T23:59:59`);
  const out = { IGV: 0, IGTa: 0, IGTe: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of (data ?? []) as any[]) {
    if (!opts.includeTest && d.account?.is_test) continue;
    out.IGV += d.slots_igv ?? 0;
    out.IGTa += d.slots_igta ?? 0;
    out.IGTe += d.slots_igte ?? 0;
  }
  return out;
}

// ================================================================== period reports (v21)

export interface FunctionReportData {
  functionLabel: string;
  recipients: string[]; // whole function + the LCP
  kpis: [string, string][];
  planLine: string | null;
  waterfallHeaders: string[];
  waterfallRows: (string | number)[][];
  boldRows: number[];
  indentRows: number[];
  mmPlanLines: string[];
}

/** Builds one function's period report: function totals, plan-vs-achieved and
 *  the waterfall (every team in bold, every person under it). Window-based:
 *  MR = accounts created in the window; contacts/visits/deals by their own
 *  dates. Test accounts are always excluded. */
export async function buildFunctionReport(
  fnKey: "IGV" | "IGT" | "B2B",
  window: { start: string; end: string },
  kind: "sprint" | "month" | "quarter" = "month"
): Promise<FunctionReportData | null> {
  const isB2BReport = fnKey === "B2B";
  const { data: membersData } = await db()
    .from("members")
    .select("id, name, nickname, email, role, functions, sub_functions, team_name, stakeholder_id")
    .eq("is_active", true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMembers = (membersData ?? []) as any[];
  const inFn = (m: (typeof allMembers)[number]) =>
    isB2BReport
      ? ["B2B", "BD"].some((f) => (m.functions ?? []).includes(f) || (m.sub_functions ?? []).includes(f))
      : (m.functions ?? []).includes(fnKey);
  const crew = allMembers.filter(inFn);
  if (crew.length === 0) return null;
  const crewIds = new Set(crew.map((m) => m.id as string));
  const lcp = allMembers.find((m) => m.role === "LCP");

  // ---- window events on the crew's accounts --------------------------------
  const fromTs = `${window.start}T00:00:00`;
  const toTs = `${window.end}T23:59:59`;
  const [accs, attempts, visits, deals, allocs] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll<any>(() =>
      db()
        .from("accounts")
        .select("id, responsible_id, created_at, is_test")
        .eq("is_test", false)
        .gte("created_at", fromTs)
        .lte("created_at", toTs)
        .order("id")
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll<any>(() =>
      db()
        .from("contact_attempts")
        .select("id, member_id, account_id, created_at, account:accounts!inner(responsible_id, is_test)")
        .eq("account.is_test", false)
        .gte("created_at", fromTs)
        .lte("created_at", toTs)
        .order("id")
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll<any>(() =>
      db()
        .from("visits")
        .select("id, member_id, done, visit_date, account:accounts!inner(responsible_id, is_test)")
        .eq("account.is_test", false)
        .gte("visit_date", window.start)
        .lte("visit_date", window.end)
        .order("id")
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll<any>(() =>
      db()
        .from("deals")
        .select("id, member_id, slots, slots_igv, slots_igta, slots_igte, amount, created_at, account:accounts!inner(responsible_id, is_test)")
        .eq("account.is_test", false)
        .gte("created_at", fromTs)
        .lte("created_at", toTs)
        .order("id")
    ),
    // per-member opens = allocations (v22) — split deals credit each member
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll<any>(() =>
      db()
        .from("deal_allocations")
        .select("member_id, slots_igv, slots_igta, slots_igte, deal:deals!inner(created_at, account:accounts!inner(is_test))")
        .eq("deal.account.is_test", false)
        .gte("deal.created_at", fromTs)
        .lte("deal.created_at", toTs)
        .order("id")
    ).catch(() => []),
  ]);

  interface PersonStats {
    mr: number; contacts: number; visits: number; visitsDone: number;
    deals: number; opens: number; egp: number;
  }
  const zero = (): PersonStats =>
    ({ mr: 0, contacts: 0, visits: 0, visitsDone: 0, deals: 0, opens: 0, egp: 0 });
  const stats = new Map<string, PersonStats>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) { s = zero(); stats.set(id, s); }
    return s;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const a of (accs ?? []) as any[])
    if (crewIds.has(a.responsible_id)) get(a.responsible_id).mr++;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (attempts ?? []) as any[]) {
    const owner = c.account?.responsible_id;
    if (owner && crewIds.has(owner)) get(owner).contacts++;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of (visits ?? []) as any[]) {
    const owner = v.account?.responsible_id;
    if (!owner || !crewIds.has(owner)) continue;
    get(owner).visits++;
    if (v.done) get(owner).visitsDone++;
  }
  const useAllocs = allocs.length > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of (deals ?? []) as any[]) {
    const owner = d.account?.responsible_id;
    if (!owner || !crewIds.has(owner)) continue;
    const s = get(owner);
    s.deals++;
    // pre-0018 fallback: no allocations yet → the whole deal to the owner
    if (!useAllocs) s.opens += d.slots ?? 0;
    s.egp += Number(d.amount) || 0;
  }
  // opens are allocation-attributed (v22): each member gets their agreed share
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const al of allocs as any[]) {
    if (!crewIds.has(al.member_id)) continue;
    get(al.member_id).opens +=
      (al.slots_igv ?? 0) + (al.slots_igta ?? 0) + (al.slots_igte ?? 0);
  }

  // ---- waterfall: team (bold) → its people --------------------------------
  const label = (m: (typeof crew)[number]) => m.nickname || m.name;
  const tls = crew.filter((m) => m.role === "Team Leader");
  const leaders = crew.filter((m) => m.role === "LCVP" || m.role === "Director");
  const grouped = new Set<string>();
  const headers = isB2BReport
    ? ["Who", "MR", "Contacts", "Visits", "Done", "Deals", "Opens", "EGP"]
    : ["Who", "MR", "Contacts", "Visits", "Done", "Deals", "Opens"];
  const rows: (string | number)[][] = [];
  const boldRows: number[] = [];
  const indentRows: number[] = [];
  const sum = (ids: string[]): PersonStats =>
    ids.reduce((acc, id) => {
      const s = stats.get(id) ?? zero();
      acc.mr += s.mr; acc.contacts += s.contacts; acc.visits += s.visits;
      acc.visitsDone += s.visitsDone; acc.deals += s.deals; acc.opens += s.opens; acc.egp += s.egp;
      return acc;
    }, zero());
  const toCells = (who: string, s: PersonStats): (string | number)[] =>
    isB2BReport
      ? [who, s.mr, s.contacts, s.visits, s.visitsDone, s.deals, s.opens, s.egp ? `${s.egp.toLocaleString()} EGP` : 0]
      : [who, s.mr, s.contacts, s.visits, s.visitsDone, s.deals, s.opens];

  for (const tl of tls) {
    const teamPeople = crew.filter((m) => m.stakeholder_id === tl.id && m.id !== tl.id);
    const ids = [tl.id, ...teamPeople.map((m) => m.id)];
    ids.forEach((id) => grouped.add(id));
    boldRows.push(rows.length);
    rows.push(toCells(`${tl.team_name || `Team ${label(tl)}`}`, sum(ids)));
    indentRows.push(rows.length);
    rows.push(toCells(`${label(tl)} (TL)`, stats.get(tl.id) ?? zero()));
    for (const p of teamPeople) {
      indentRows.push(rows.length);
      rows.push(toCells(label(p), stats.get(p.id) ?? zero()));
    }
  }
  const loose = crew.filter(
    (m) => !grouped.has(m.id) && m.role !== "LCVP" && m.role !== "Director" && m.role !== "LCP"
  );
  if (loose.length > 0) {
    boldRows.push(rows.length);
    rows.push(toCells("No team yet", sum(loose.map((m) => m.id))));
    for (const p of loose) {
      indentRows.push(rows.length);
      rows.push(toCells(label(p), stats.get(p.id) ?? zero()));
    }
  }
  const leadersWithNumbers = leaders.filter((m) => stats.has(m.id));
  if (leadersWithNumbers.length > 0) {
    boldRows.push(rows.length);
    rows.push(toCells("Leaders' own accounts", sum(leadersWithNumbers.map((m) => m.id))));
    for (const p of leadersWithNumbers) {
      indentRows.push(rows.length);
      rows.push(toCells(`${label(p)} (${p.role})`, stats.get(p.id) ?? zero()));
    }
  }

  const total = sum(crew.map((m) => m.id));
  const kpis: [string, string][] = [
    ["Market Research (accounts added)", String(total.mr)],
    ["Contact attempts", String(total.contacts)],
    ["Visits scheduled", String(total.visits)],
    ["Visits done", String(total.visitsDone)],
    ["Deals", String(total.deals)],
    ["Opens raised", String(total.opens)],
    ...(isB2BReport ? ([["BD money", `${total.egp.toLocaleString()} EGP`]] as [string, string][]) : []),
  ];

  // ---- plan vs achieved (opens) for planned lanes --------------------------
  // every month key the window touches (a quarter spans 3 — not just its ends)
  const windowMonthKeys: string[] = [];
  {
    let y = Number(window.start.slice(0, 4));
    let m = Number(window.start.slice(5, 7));
    const endKey = `${window.end.slice(0, 7)}`;
    while (`${y}-${String(m).padStart(2, "0")}` <= endKey) {
      windowMonthKeys.push(`${y}-${String(m).padStart(2, "0")}-01`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  let planLine: string | null = null;
  if (!isB2BReport) {
    const planFns = fnKey === "IGT" ? ["IGTa", "IGTe"] : [fnKey];
    const cells = await listPlanCells(planFns);
    // a SPRINT report compares against the sprint's planned opens (the plan
    // splits opens per half-month); month/quarter use the month cells they span
    const planned =
      kind === "sprint"
        ? cells
            .filter((c) => c.scope === "sprint" && c.metric === "opens" && c.period_start === window.start)
            .reduce((s, c) => s + c.value, 0)
        : cells
            .filter((c) => c.scope === "month" && c.metric === "opens" && windowMonthKeys.includes(c.period_start))
            .reduce((s, c) => s + c.value, 0);
    if (planned > 0) {
      const actual = await laneOpensActual(window.start, window.end);
      const ach = fnKey === "IGT" ? actual.IGTa + actual.IGTe : actual[fnKey];
      const span = kind === "sprint" ? "this sprint" : windowMonthKeys.length > 1 ? "these months" : "this month";
      planLine = `Plan check (opens): ${ach} raised of ~${planned} planned for ${span} (${planned ? Math.round((ach / planned) * 100) : 0}%).`;
    }
  }

  // ---- MM plans covering the window ----------------------------------------
  const mmPlanLines: string[] = [];
  const { data: plans } = await db()
    .from("mm_plans")
    .select("member_id, month, applicants, accepted, approvals")
    .in("month", windowMonthKeys);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (plans ?? []) as any[]) {
    const m = crew.find((c) => c.id === p.member_id);
    if (!m) continue;
    mmPlanLines.push(
      `${label(m)} — ${p.month.slice(0, 7)}: ${p.applicants} applicants · ${p.accepted} accepted · ${p.approvals} approvals (plan)`
    );
  }

  const recipients = [
    ...crew.map((m) => m.email as string),
    ...(lcp?.email ? [lcp.email as string] : []),
  ].filter(Boolean);

  return {
    functionLabel: isB2BReport ? "B2B & BD" : fnKey,
    recipients: [...new Set(recipients.map((e) => e.toLowerCase()))],
    kpis,
    planLine,
    waterfallHeaders: headers,
    waterfallRows: rows,
    boldRows,
    indentRows,
    mmPlanLines,
  };
}

// ================================================================== LC feedback

export interface LcFeedbackRow {
  id: string;
  positive: boolean;
  anonymous: boolean;
  author: string | null; // hidden (null) when anonymous
  aboutNames: string[];
  message: string;
  status: "new" | "seen" | "done";
  created_at: string;
}

/** The LC people-feedback inbox — LCP + admin ONLY. Anonymous rows never
 *  expose the author, not even here. */
export async function listLcFeedback(viewer: Viewer): Promise<LcFeedbackRow[]> {
  if (!viewer.isAdmin && viewer.role !== "LCP") return [];
  const [{ data }, { data: membersData }] = await Promise.all([
    db()
      .from("lc_feedback")
      .select("id, positive, anonymous, author_id, about, message, status, created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    db().from("members").select("id, name, nickname"),
  ]);
  const nameById = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((membersData ?? []) as any[]).map((m) => [m.id, m.nickname || m.name])
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    positive: r.positive,
    anonymous: r.anonymous,
    author: r.anonymous ? null : nameById.get(r.author_id) ?? "(left the LC)",
    aboutNames: (r.about ?? []).map((id: string) => nameById.get(id) ?? "(left the LC)"),
    message: r.message,
    status: r.status,
    created_at: r.created_at,
  }));
}

/** Recent audit-log rows (admin page). Actor joined for a readable name. */
export async function listRecentAudit(limit = 60): Promise<AuditEntry[]> {
  const { data } = await db()
    .from("audit_log")
    .select("id, action, entity, entity_id, details, created_at, actor:members!actor_id(name, nickname)")
    .order("created_at", { ascending: false })
    .limit(limit);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    actor: r.actor ? r.actor.nickname || r.actor.name : null,
    details: r.details ? JSON.stringify(r.details) : null,
    createdAt: r.created_at,
  }));
}
