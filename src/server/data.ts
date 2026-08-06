import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { dashboardCacheKey } from "@/lib/dashboard-cache";
import { currentChangeSet } from "./change-set";
import { env } from "@/lib/env";
import {
  considerationFunctions,
  accountScope,
  allowedAccountFunctions as _allowedAccountFunctions,
  canSeeLcConcerns as _canSeeLcConcerns,
  canFilterUnassigned,
  canSeeUnassigned,
  canUseAdminTools,
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
  parsePhoneSessionKey, normalizeName, accountSlug } from "@/lib/types";
import { monthOf, sprintOf } from "@/lib/plan";

export interface PipelineRow extends AccountPipeline {
  responsible_role: MemberRole;
  responsible_team_name: string | null;
  /** the account's own birth as a History entry (v31) — only `getAccount`
   *  fills it; list reads leave it undefined (one row = one extra query). */
  creation?: AccountCreationEntry;
}

/** The FIRST entry of an account's History: the account being added. */
export interface AccountCreationEntry {
  /** accounts.created_at — when the row was really born */
  at: string;
  /** who added it; null when it genuinely can't be recovered (never guessed) */
  by: string | null;
  /** how it arrived — only known for accounts added after v31 */
  via: "manual" | "import" | null;
  /** label → value pairs of what the account was filed as */
  facts: [string, string][];
  /** the tagged contacts filed WITH the account (creation snapshot only) */
  contacts: { tag: string; kind: string; value: string }[];
  /** the comment written while adding it */
  comment: string | null;
  /** true when `facts`/`contacts` come from the creation snapshot in the audit
   *  log; false when they're read off the account row (older accounts) */
  snapshot: boolean;
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
  // the admin CAPABILITY, not the env list (v33.4) — this returned [] for a
  // capability-admin, and a picker with zero options doesn't look empty, it
  // looks like a control that won't open
  if (!canUseAdminTools(real)) return [];
  const { data } = await db()
    .from("members")
    .select("id, name, role, functions")
    .eq("is_active", true)
    .neq("id", real.id) // you can't test-view yourself
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((m) => ({
    id: m.id,
    label: m.name,
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
  // same capability gate as the picker and `startViewAs`: all three have to
  // agree, or a capability-admin picks a member and the app quietly stays
  // itself
  if (!canUseAdminTools(real)) return real;
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

// -------------------------------------------------- consideration dashboard (v27)

export interface ConsiderationStats {
  /** which product lane this snapshot is for (v29 — the lane is split) */
  fn: "IGV" | "IGT";
  /** the CV pool is an IGT hunt: the IGV lane hides the CV cards entirely */
  showCvs: boolean;
  irTotal: number;
  irThisMonth: number;
  irUpcoming: number;
  partnerLcsContacted: number;
  cvTotal: number;
  cvThisMonth: number;
  cvByIndustry: { industry: string; count: number }[];
  plan: { applicants: number; accepted: number; approvals: number } | null;
}

/** A consideration row (IR call / MM plan) carries no product column — the
 *  crew markets the whole ICX from one log. So a row is attributed to a lane
 *  through its OWNER's functions: an IGT member's calls feed the IGT lane, an
 *  IGV member's the IGV lane. Someone with NEITHER on their row (the pure
 *  Consideration crew) markets both products, so their rows count in BOTH
 *  lanes — as do orphaned rows whose owner left the LC. */
function ownerInLane(
  m: { functions?: string[] | null; sub_functions?: string[] | null } | null | undefined,
  fn: "IGV" | "IGT"
): boolean {
  if (!m) return true;
  const all = [...(m.functions ?? []), ...(m.sub_functions ?? [])];
  const icx = all.filter((f) => f === "IGV" || f === "IGT");
  return icx.length === 0 || icx.includes(fn);
}

/** The Consideration lanes on the ICX dashboard (v27, split per product in
 *  v29): IR-call + CV-pool volume for the requested function. Visible to that
 *  function's VPs/Directors, the consideration crew and the LCP. */
export async function considerationStats(
  viewer: Viewer,
  fn: "IGV" | "IGT"
): Promise<ConsiderationStats | null> {
  if (!considerationFunctions(viewer).includes(fn)) return null;
  const showCvs = fn === "IGT" && _canSeeCvPool(viewer);
  const monthStart = monthOf().start;
  const [callRowsAll, cvRowsAll, plans, memberRows] = await Promise.all([
    fetchAll<{
      called_at: string;
      status: string;
      partner_lc_name: string;
      member_id: string | null;
    }>(() =>
      db()
        .from("ir_calls")
        .select("called_at, status, partner_lc_name, member_id")
        .order("id")
    ),
    // the CV pool is IGT-only (v27) — never even read for the IGV lane
    showCvs
      ? fetchAll<{ created_at: string; industry: string | null }>(() =>
          db().from("cvs").select("created_at, industry").order("id")
        )
      : Promise.resolve([] as { created_at: string; industry: string | null }[]),
    db()
      .from("mm_plans")
      .select("applicants, accepted, approvals, month, member:members!mm_plans_member_id_fkey(functions, sub_functions)")
      .eq("month", monthStart),
    db().from("members").select("id, functions, sub_functions"),
  ]);
  const now = new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byMember = new Map<string, any>(((memberRows.data ?? []) as any[]).map((m) => [m.id, m]));
  const callRows = callRowsAll.filter((c) =>
    ownerInLane(c.member_id ? byMember.get(c.member_id) : null, fn)
  );
  const cvRows = cvRowsAll;
  const inMonth = (iso: string) => iso >= monthStart;
  const industries = new Map<string, number>();
  for (const c of cvRows) {
    const key = c.industry || "Unsorted";
    industries.set(key, (industries.get(key) ?? 0) + 1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const considerationPlans = ((plans.data ?? []) as any[]).filter(
    (p) =>
      [...(p.member?.functions ?? []), ...(p.member?.sub_functions ?? [])].includes(
        "Consideration"
      ) && ownerInLane(p.member, fn)
  );
  const plan =
    considerationPlans.length > 0
      ? considerationPlans.reduce(
          (acc, p) => ({
            applicants: acc.applicants + (p.applicants ?? 0),
            accepted: acc.accepted + (p.accepted ?? 0),
            approvals: acc.approvals + (p.approvals ?? 0),
          }),
          { applicants: 0, accepted: 0, approvals: 0 }
        )
      : null;
  return {
    fn,
    showCvs,
    irTotal: callRows.filter((c) => c.status !== "cancelled").length,
    irThisMonth: callRows.filter((c) => c.status !== "cancelled" && inMonth(c.called_at)).length,
    irUpcoming: callRows.filter(
      (c) => c.status === "scheduled" && new Date(c.called_at) >= now
    ).length,
    partnerLcsContacted: new Set(callRows.map((c) => c.partner_lc_name.toLowerCase())).size,
    cvTotal: cvRows.length,
    cvThisMonth: cvRows.filter((c) => inMonth(c.created_at)).length,
    cvByIndustry: [...industries.entries()]
      .map(([industry, count]) => ({ industry, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    plan,
  };
}

// ------------------------------------------------------------------ scope helpers

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyScope<T extends { eq: any; in: any; or?: any }>(
  query: T,
  scope: AccountScope,
  /** functions whose UNASSIGNED accounts this viewer may also see (v32.4) —
   *  nobody owns them, so anyone who may work that function can take one */
  claimableFns: AccountFunction[] = []
): T {
  if (scope.kind === "functions") return query.in("function", scope.fns);
  if (scope.kind === "members") {
    const ids = scope.ids.map((i) => `"${i}"`).join(",");
    if (claimableFns.length > 0 && query.or) {
      const fns = claimableFns.map((f) => `"${f}"`).join(",");
      return query.or(
        `responsible_id.in.(${ids}),and(responsible_id.is.null,function.in.(${fns}))`
      );
    }
    return query.in("responsible_id", scope.ids);
  }
  return query;
}

// ------------------------------------------------------------------ accounts

/** Splits a multi-select filter value ("IGV,IGT") into its picks — the server
 *  twin of `multi` in data-table-kit. */
function pickList(value?: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}


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
  /** v33: the 3-contact-limit flag is retired — "no next step" and "needs
   *  Podio checking" are the two that actually drive work */
  flag?: "needs_podio" | "next_step_missing";
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
  max = MAX_FETCH_ROWS,
  columns?: string
): Promise<PipelineRow[]> {
  const out: PipelineRow[] = [];
  for (let off = 0; off < max; off += DB_PAGE) {
    const attempt = async (bdSafe: boolean) =>
      (await buildAccountsQuery(viewer, filters, bdSafe, false, columns)).query.range(
        off,
        off + DB_PAGE - 1
      );
    let { data, error } = await attempt(false);
    // MIGRATION-0014 GRACE: before the migration runs, Postgres rejects the
    // "BD" enum value (22P02 on lc_function). Retry without BD so a deploy can
    // never break the dashboard/accounts while the SQL editor lags behind.
    if (error && `${error.message}`.includes("lc_function")) {
      if (filters.fn === "BD") return [];
      ({ data, error } = await attempt(true));
    }
    if (error) throw error;
    const chunk = (data ?? []) as unknown as PipelineRow[];
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
  const rows = (data ?? []) as unknown as PipelineRow[];
  // The Comment column shows the WHOLE thread, not just the pinned line — one
  // extra query for the page's ~100 accounts, never per row (v33). Archived
  // comments stay hidden, exactly as they are on the account page.
  if (rows.length > 0) {
    // the FK column is member_id — an `author_id` hint silently errored the
    // whole query, so every row rendered "—" (v33 fix)
    const { data: cs, error: cErr } = await db()
      .from("account_comments")
      .select("account_id, body, created_at, author_label, member:members(name)")
      .in("account_id", rows.map((r) => r.id))
      .eq("archived", false)
      .order("created_at", { ascending: true });
    if (cErr) console.error("[accounts] comment column query failed:", cErr.message);
    const byAccount = new Map<string, { body: string; author: string | null; at: string }[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of ((cs ?? []) as any[])) {
      const list = byAccount.get(c.account_id) ?? [];
      list.push({
        body: c.body,
        author: c.member?.name ?? c.author_label ?? null,
        at: c.created_at,
      });
      byAccount.set(c.account_id, list);
    }
    for (const r of rows) r.comments_all = byAccount.get(r.id) ?? [];
  }
  return { rows, total: count ?? 0, page: served };
}

async function buildAccountsQuery(
  viewer: Viewer,
  filters: AccountFilters,
  bdSafe: boolean,
  withCount = false,
  /** a narrowed projection, e.g. the dashboard's 16 fields */
  columns?: string
) {
  const scope = accountScope(viewer);
  const effScope: AccountScope =
    bdSafe && scope.kind === "functions"
      ? { kind: "functions", fns: scope.fns.filter((f) => f !== "BD") }
      : scope;
  let query = db()
    .from("accounts_pipeline")
    // COLUMNS ARE A HOSTING BILL (v33.6). The view has ~70 columns and the
    // dashboard aggregates 16 of them, over ~4,000 rows, on every render —
    // the rest is payload to ship, parse and throw away. Callers that know
    // what they need say so; everyone else still gets the whole row.
    // "planned" instead of "exact" (v33.14): an exact count scans the whole
    // filtered set on EVERY page load — four thousand rows to render twenty.
    // The number only drives "N accounts in your scope" and the pager, and
    // Postgres's own estimate is right to within a rounding error at this
    // size, for a fraction of the work.
    .select(columns ?? "*", withCount ? { count: "planned" } : undefined);
  // the Archived TAB is LC-wide (v22.2): the archive is the shared blacklist,
  // so it skips the account scope. Everything else stays scoped (dashboards'
  // includeArchived reads included).
  // members/TLs also see the UNOWNED accounts of their own function(s) — the
  // imported market research nobody has taken yet (v32.4)
  // THE PODIO WORKLIST IS FUNCTION-WIDE (v33.10). Checking a name on Podio is
  // one person's errand done for everyone — an MM opening it wants every
  // account in their function that still needs checking, not only the ones
  // that happen to sit in their own team. It is a read-only queue: opening an
  // account out of it still obeys the normal scope.
  const podioWorklist = filters.flag === "needs_podio" && !filters.archived;
  const worklistScope: AccountScope = podioWorklist
    ? { kind: "functions", fns: _allowedAccountFunctions(viewer) }
    : effScope;
  if (!filters.archived)
    query = applyScope(
      query,
      worklistScope,
      worklistScope.kind === "members" && canSeeUnassigned(viewer)
        ? _allowedAccountFunctions(viewer)
        : []
    );
  // test accounts live in a parallel universe: visible ONLY in test mode
  // (admin's "Show test data" toggle or any test view)
  if (!viewer.testMode) query = query.eq("is_test", false);
  if (filters.archived) query = query.eq("out_of_process", true);
  else if (!filters.includeArchived) query = query.eq("out_of_process", false);
  // EVERY column filter is MULTI-SELECT (v33.3): the value is a comma-joined
  // list, so one pick is `.eq` and several are `.in`. `pickList` is the same
  // parser the UI uses — client and server must agree on what a filter value
  // means, or the funnel icon says one thing and the rows show another.
  const one = <T,>(vals: T[]): T | null => (vals.length === 1 ? vals[0] : null);
  const eqOrIn = (col: string, raw?: string) => {
    const vals = pickList(raw);
    if (vals.length === 0) return;
    const single = one(vals);
    query = single !== null ? query.eq(col, single) : query.in(col, vals);
  };

  eqOrIn("function", filters.fn);
  eqOrIn("project", filters.project);
  eqOrIn("product", filters.product);
  // sub_product is free-ish text (a row may hold several values) — match
  // loosely, and OR the picks together rather than intersecting them
  {
    const subs = pickList(filters.subProduct);
    if (subs.length === 1) query = query.ilike("sub_product", `%${subs[0]}%`);
    else if (subs.length > 1)
      query = query.or(subs.map((v) => `sub_product.ilike.%${v}%`).join(","));
  }
  eqOrIn("stage", filters.stage);
  eqOrIn("last_contact_status", filters.lastStatus);

  // Responsible carries a pseudo-value: "none" = unassigned. Mixed with real
  // people it has to become an OR, because NULL is not `in` anything.
  {
    const resp = pickList(filters.responsibleId);
    const wantsNone = resp.includes("none");
    const ids = resp.filter((r) => r !== "none");
    if (wantsNone && ids.length === 0) query = query.is("responsible_id", null);
    else if (wantsNone && ids.length > 0)
      query = query.or(
        `responsible_id.is.null,responsible_id.in.(${ids.map((i) => `"${i}"`).join(",")})`
      );
    else if (ids.length === 1) query = query.eq("responsible_id", ids[0]);
    else if (ids.length > 1) query = query.in("responsible_id", ids);
  }

  // a team filter means "this TL and everyone reporting to them" — several
  // teams is the UNION of those people
  {
    const teams = pickList(filters.teamId);
    if (teams.length > 0) {
      const { data: team } = await db()
        .from("members")
        .select("id")
        .in("stakeholder_id", teams);
      query = query.in("responsible_id", [...teams, ...(team ?? []).map((t) => t.id)]);
    }
  }
  // accounts can't be created in the future — clamp the range to today
  const today = new Date().toISOString().slice(0, 10);
  const from = filters.from && filters.from <= today ? filters.from : filters.from ? today : undefined;
  const to = filters.to && filters.to <= today ? filters.to : filters.to ? today : undefined;
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59Z`);
  // NEEDS PODIO CHECKING: never submitted and nobody has set a request state,
  // so nobody knows whether the partner is already taken (v33)
  if (filters.flag === "needs_podio")
    // UNOWNED accounts are excluded: nobody is going to submit a name that
    // hasn't been given to anyone, and 1,300 of them would bury the real
    // worklist (v33.2). The SCOPE is widened separately — see below.
    query = query
      .eq("requested_podio", false)
      .is("request_state", null)
      .not("responsible_id", "is", null);
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
 *  the normalized name; raw UUIDs keep working for old links. Access is ALWAYS
 *  re-checked server-side (canViewAccount).
 *
 *  A SLUG IS NOT A NAME (v33.7). It is the name with every space turned into a
 *  dash — so a name that already CONTAINS a dash produces a slug that no
 *  simple reversal can undo. "i-fikra software company" slugs to
 *  "i-fikra-software-company", and the old lookup tried exactly two guesses,
 *  all-dashes-were-spaces and no-change, matching neither. That account was
 *  unreachable by its own link; worse, the guess "i fikra software company"
 *  matched a DIFFERENT account in another function, so the URL opened someone
 *  else's row — or 404'd for a viewer with no access to it.
 *
 *  So: ask the database for anything that could slug to this, using `_` (LIKE's
 *  single-character wildcard) in every dash position, then compare real slugs
 *  in JS. When several genuinely collide, prefer one the VIEWER can open. */
export async function findAccountRow(
  idOrSlug: string,
  viewer?: Viewer
): Promise<PipelineRow | null> {
  const raw = decodeURIComponent(idOrSlug);
  if (UUID_RE.test(raw)) {
    const { data } = await db()
      .from("accounts_pipeline")
      .select("*")
      .eq("id", raw)
      .maybeSingle<PipelineRow>();
    return data ?? null;
  }

  // every dash could have been a space OR a real dash in the name
  const pattern = raw.replace(/[%_]/g, "").replace(/-/g, "_");
  const { data } = await db()
    .from("accounts_pipeline")
    .select("*")
    .ilike("normalized_name", pattern)
    .order("out_of_process", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = ((data ?? []) as PipelineRow[]).filter(
    (r) => accountSlug(r.name) === raw || normalizeName(r.name) === raw.replace(/-/g, " ")
  );
  if (rows.length === 0) return null;
  // an exact slug collision is rare but real (two names one dash apart) —
  // hand back the one this viewer can actually work, not an arbitrary row
  if (viewer) {
    const mine = rows.find((r) => canViewAccount(viewer, r) && !(r.is_test && !viewer.testMode));
    if (mine) return mine;
  }
  return rows[0];
}

export async function getAccount(viewer: Viewer, idOrSlug: string) {
  const account = await findAccountRow(idOrSlug, viewer);
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
        "*, member:members(name), allocations:deal_allocations(member_id, slots_igv, slots_igta, slots_igte, member:members(name))"
      )
      .eq("account_id", id)
      .order("created_at", { ascending: false });
    if (!withAllocs.error) return withAllocs;
    return db()
      .from("deals")
      .select("*, member:members(name)")
      .eq("account_id", id)
      .order("created_at", { ascending: false });
  };
  const [{ data: attempts }, { data: visits }, { data: comments }, { data: deals }] =
    await Promise.all([
      db()
        .from("contact_attempts")
        .select("*, member:members(name)")
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
        .select("*, member:members(name)")
        .eq("account_id", id)
        .order("created_at", { ascending: true }),
      fetchDeals(),
    ]);
  const commentRows = (comments ?? []) as CommentWithMember[];
  return {
    account: {
      ...account,
      creation: await accountCreationEntry(account, commentRows),
    },
    attempts: attempts ?? [],
    visits: visits ?? [],
    comments: commentRows,
    deals: (deals ?? []) as DealWithMember[],
  };
}

/** The account's creation, rebuilt as the oldest History entry.
 *
 *  SOURCES, honest ones only:
 *   1. the audit_log "create" row — since v31 it carries the full snapshot of
 *      what was entered (function/product/project, type, industry, the
 *      contacts, the first comment, and whether the row came from the bulk
 *      import), plus the actor who added it;
 *   2. otherwise the account row itself — `created_at`, `created_by` and the
 *      account's current classification.
 *  Nothing is invented: an account whose creator can't be recovered (the v22
 *  market-research import ran outside the app) renders without a name. */
async function accountCreationEntry(
  account: PipelineRow,
  comments: CommentWithMember[]
): Promise<AccountCreationEntry> {
  const { data: auditRow } = await db()
    .from("audit_log")
    .select("actor_id, details, created_at, actor:members!actor_id(name)")
    .eq("entity", "account")
    .eq("entity_id", account.id)
    .eq("action", "create")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audit = auditRow as any;
  const details: Record<string, unknown> | null =
    audit?.details && typeof audit.details === "object" ? audit.details : null;
  const snapshot = !!details && "function" in details;
  const str = (k: string): string | null => {
    const v = details?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  // ---- who added it
  let by: string | null = audit?.actor ? audit.actor.name : null;
  if (!by && account.created_by) {
    const { data: creator } = await db()
      .from("members")
      .select("name")
      .eq("id", account.created_by)
      .maybeSingle<{ name: string }>();
    by = creator ? creator.name : null;
  }

  // ---- what it was filed as (the snapshot when we have it, else the row)
  const fn = (snapshot ? str("function") : account.function) ?? account.function;
  const facts: [string, string][] = [["Function", fn]];
  const product = snapshot ? str("product") : account.product;
  const subProduct = snapshot ? str("sub_product") : account.sub_product;
  const project = snapshot ? str("project") : account.project;
  const accountType = snapshot ? str("account_type") : account.account_type;
  const industry = snapshot ? str("industry") : account.industry;
  if (product) facts.push(["Product", product]);
  if (subProduct) facts.push(["Sub product", subProduct]);
  if (project) facts.push(["Project", project]);
  if (accountType) facts.push([fn === "B2C" ? "Type" : "Account type", accountType]);
  if (industry) facts.push(["Industry", industry]);
  if (snapshot && details?.requested_podio === true)
    facts.push(["Podio", "already submitted"]);

  // the responsible AT CREATION — only from the snapshot (today's responsible
  // may be a later reassignment, and claiming otherwise would be a lie)
  const responsibleId = snapshot ? str("responsible_id") : null;
  if (responsibleId) {
    const { data: owner } = await db()
      .from("members")
      .select("name")
      .eq("id", responsibleId)
      .maybeSingle<{ name: string }>();
    if (owner) facts.push(["Responsible", owner.name]);
  }

  // ---- the contacts filed with it (snapshot only — today's list has changed)
  const rawContacts = snapshot ? details?.contacts : null;
  const contacts = Array.isArray(rawContacts)
    ? rawContacts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => ({
          tag: typeof c?.tag === "string" ? c.tag : "",
          kind: typeof c?.kind === "string" ? c.kind : "",
          value: typeof c?.value === "string" ? c.value : "",
        }))
        .filter((c) => c.value)
    : [];

  // ---- the comment written while adding it. The snapshot holds it verbatim;
  // for older accounts the opening comment is the first one filed by the
  // creator within a couple of minutes of the row itself.
  let comment = snapshot ? str("comment") : null;
  if (!comment && !snapshot && account.created_by) {
    const bornAt = new Date(account.created_at).getTime();
    const opening = comments.find(
      (c) =>
        c.member_id === account.created_by &&
        Math.abs(new Date(c.created_at).getTime() - bornAt) <= 2 * 60 * 1000
    );
    comment = opening?.body ?? null;
  }

  const via = details?.via === "import" ? "import" : details?.via === "manual" ? "manual" : null;
  return { at: account.created_at, by, via, facts, contacts, comment, snapshot };
}

export interface DealAllocation {
  member_id: string;
  slots_igv: number;
  slots_igta: number;
  slots_igte: number;
  member: { name: string } | null;
}

export type DealWithMember = Deal & {
  member: { name: string } | null;
  allocations?: DealAllocation[];
};

export type CommentWithMember = AccountComment & {
  member: { name: string } | null;
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
 *  ACTIVE names are unique across every function, but each WORLD keeps its own
 *  archive — the two sell different things, so a name one burned says nothing
 *  about the other:
 *
 *    OPENS   IGV · IGT · B2B  — raising opens for the ICX programmes
 *    SERVICE BD  · B2C        — money partnerships and courses/events
 *
 *  (v32.5 moved BD out of the opens world: BD sells a service like B2C does,
 *  and an IGV team burning a company for opens must not stop BD selling them
 *  a partnership.) A cross-world archived match is a non-blocking heads-up. */
export async function checkAccountName(
  name: string,
  fn?: AccountFunction
): Promise<NameCheckResult> {
  const normalized = normalizeName(name);
  if (!normalized)
    return { duplicate: null, blacklisted: null, crossWorldArchived: null };
  const serviceWorld = (f?: string | null) => f === "B2C" || f === "BD";
  const world: "OPENS" | "SERVICE" = serviceWorld(fn) ? "SERVICE" : "OPENS";
  // TWO NAMES ONE DASH APART ARE THE SAME ACCOUNT (v33.7). "i fikra software
  // company" and "i-fikra software company" normalise differently but slug
  // IDENTICALLY, so both live at one URL — which is how the LC ended up with
  // two of the same partner in different functions, one of them unreachable.
  // A name that would collide on the URL is a duplicate.
  const slugPattern = normalized.replace(/[%_]/g, "").replace(/[\s-]/g, "_");
  const [{ data: rows }, { data: blacklistHit }] = await Promise.all([
    db()
      .from("accounts_pipeline")
      .select("*")
      .ilike("normalized_name", slugPattern)
      .eq("is_test", false) // a hidden test account never blocks a real name
      .limit(10),
    db()
      .from("blacklist")
      .select("*")
      .eq("normalized_name", normalized)
      .maybeSingle<BlacklistEntry>(),
  ]);
  const all = ((rows ?? []) as PipelineRow[]).filter(
    (r) => accountSlug(r.name) === accountSlug(name)
  );
  const sameWorld = (r: PipelineRow) =>
    serviceWorld(r.function) === (world === "SERVICE");
  const active = all.find((r) => !r.out_of_process) ?? null;
  const archivedSame = all.find((r) => r.out_of_process && sameWorld(r)) ?? null;
  const archivedOther = all.find((r) => r.out_of_process && !sameWorld(r)) ?? null;
  // the manual blacklist is the OPENS world's list — it never blocks the
  // service side (BD/B2C)
  const blacklisted = world === "OPENS" ? (blacklistHit ?? null) : null;
  const duplicate = active ?? archivedSame;
  return {
    duplicate,
    blacklisted,
    crossWorldArchived: !duplicate && !blacklisted ? archivedOther : null,
  };
}

// ------------------------------------------------------------------ members

/** Every function whose people can own an ACCOUNT. Filter option lists are
 *  built from this world only — a Responsible picker on the accounts list must
 *  never offer OGX / TM / F&L people, who can't appear in it (v31). */
const ACCOUNT_WORLD_FNS: AccountFunction[] = ["IGV", "IGT", "B2B", "BD", "B2C"];

/** Restrict a `members` query to people who work `fns`. B2B/BD and B2C are
 *  often carried as a SUB-function only, so both columns are matched. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function membersInFunctions<T extends { or: any; overlaps: any }>(query: T, fns: string[]): T {
  const subFns = fns.filter((f) => f === "B2B" || f === "BD" || f === "B2C");
  return subFns.length > 0
    ? query.or(`functions.ov.{${fns.join(",")}},sub_functions.ov.{${subFns.join(",")}}`)
    : query.overlaps("functions", fns);
}

/** The account functions a given view can actually contain: the viewer's own
 *  scope, optionally narrowed to the Function filter that is switched on. */
function viewAccountFunctions(viewer: Viewer, fn?: AccountFunction): AccountFunction[] {
  const scope = accountScope(viewer);
  const base = scope.kind === "functions" ? scope.fns : ACCOUNT_WORLD_FNS;
  if (!fn) return base;
  // B2B and BD are ONE crew wearing two labels
  const wanted: AccountFunction[] = fn === "B2B" || fn === "BD" ? ["B2B", "BD"] : [fn];
  const narrowed = wanted.filter((f) => base.includes(f));
  return narrowed.length > 0 ? narrowed : base;
}

/** The members who can appear in this viewer's ACCOUNTS views — the source of
 *  every Responsible/member filter list. Two rules, both server-side:
 *   • the viewer's account scope (function-wide leader, TL's team, own row);
 *   • the account world — an OGX or TM member never owns a raising account, so
 *     they are never an option (the v30 bug: the LCP/admin's "all" scope had
 *     no function filter at all and listed the whole LC).
 *  Pass `fn` to narrow further to the Function filter that is switched on. */
export async function listVisibleMembers(
  viewer: Viewer,
  opts: { fn?: AccountFunction } = {}
): Promise<Member[]> {
  let query = db().from("members").select("*").eq("is_active", true);
  const scope = accountScope(viewer);
  if (scope.kind === "members") {
    // a member/TL sees themself + their team: already the tightest list there
    // is, and every one of them can hold an account of this viewer's world
    query = query.in("id", scope.ids);
  } else {
    query = membersInFunctions(query, viewAccountFunctions(viewer, opts.fn));
  }
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
  if (scope.kind === "members") {
    query = query.in("id", scope.ids);
  } else {
    // any of the viewer's functions — and, for the LCP/admin's "all" scope,
    // still only people who can HOLD an account (never OGX/TM/F&L)
    query = membersInFunctions(
      query,
      scope.kind === "functions" ? scope.fns : ACCOUNT_WORLD_FNS
    );
  }
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

/** How many ACTIVE accounts nobody owns, inside the viewer's scope (v33.2).
 *  The Responsible filter only offers "— Unassigned" when there is something
 *  to find — an empty option that always returns nothing is furniture. */
export async function countUnassigned(
  viewer: Viewer,
  fn?: AccountFunction
): Promise<number> {
  if (!canFilterUnassigned(viewer)) return 0;
  const scope = accountScope(viewer);
  let q = db()
    .from("accounts_pipeline")
    .select("id", { count: "exact", head: true })
    .is("responsible_id", null)
    .eq("out_of_process", false);
  if (!viewer.testMode) q = q.eq("is_test", false);
  // the count has to match exactly what the list would show: a leader sees
  // their function's unowned accounts, an MM sees the ones they may claim
  if (scope.kind === "functions") q = q.in("function", scope.fns);
  else if (scope.kind === "members") {
    const claimable = _allowedAccountFunctions(viewer);
    if (claimable.length === 0) return 0;
    q = q.in("function", claimable);
  }
  if (fn) q = q.eq("function", fn);
  const { count } = await q;
  return count ?? 0;
}

/** Does this person work the given account function? BD and B2B are one crew,
 *  so either label answers for both. Reads the Function AND Sub Function
 *  columns, because half the LC carries its function in only one of them. */
export function memberWorksFunction(
  m: { functions?: string[] | null; sub_functions?: string[] | null },
  fn: string
): boolean {
  const own = [...(m.functions ?? []), ...(m.sub_functions ?? [])];
  if (fn === "B2B" || fn === "BD") return own.some((f) => f === "B2B" || f === "BD");
  return own.includes(fn);
}

/** Team-filter options: the NORMAL teams only — a Team Leader with their
 *  members (v32.8).
 *
 *  Since the membership sheet started listing every team a person belongs to,
 *  `team_name` can read "تملي معاك, شماريخ" — their TL team AND the LB AND the
 *  function team. Filtering by "everything they're in" is meaningless, so we
 *  take the one name that is a registered `Team` (a real TL team) and ignore
 *  the structural ones. A Team Leader whose cell names no registered team
 *  still gets a row, labelled after them ("Alex's team"), because their team
 *  exists whether or not anyone named it.
 *
 *  SCOPED TO THE LANE when `fn` is given (v33.1). The dashboard filter used to
 *  list every team the VIEWER could see, so the LCP standing on the IGT lane
 *  was offered the whole LC's teams and an IGV VP was offered B2B's — teams
 *  whose accounts are not in that lane at all (`rowInLane` matches on the
 *  account's own function), so picking one emptied the dashboard. */
export async function listTeamFilterOptions(
  viewer: Viewer,
  opts: { fn?: string } = {}
): Promise<{ id: string; label: string }[]> {
  const [allLeads, { data: teamRows }] = await Promise.all([
    listTeamLeaders(viewer),
    db().from("teams").select("name").eq("type", "Team"),
  ]);
  const leads = opts.fn
    ? allLeads.filter((m) => memberWorksFunction(m, opts.fn!))
    : allLeads;
  const normal = new Set(
    ((teamRows ?? []) as { name: string }[]).map((t) => t.name.trim().toLowerCase())
  );
  return leads.map((m) => {
    const named = (m.team_name ?? "")
      .split(/[,;]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .find((t) => normal.has(t.toLowerCase()));
    return {
      id: m.id,
      label: named || `${m.name}'s team`,
    };
  });
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
  // v32.6: BD is its OWN lane — B2B raises opens, BD sells partnerships, and
  // mixing them made both numbers meaningless
  if (lane === "B2B") return r.function === "B2B";
  if (lane === "BD") return r.function === "BD";
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
  if (lane === "B2B") return r.function === "B2B" ? r.slots_count ?? 0 : 0;
  if (lane === "BD") return r.function === "BD" ? r.slots_count ?? 0 : 0;
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

/** How long a dashboard read may be reused.
 *
 *  RAISED TO 5 MINUTES (v33.14) with the project near its CPU allowance. The
 *  dashboard reads ~4,000 rows and aggregates them in JS; on a working-hours
 *  day with forty people in the system that read was being paid for again
 *  every time anyone anywhere logged a contact, because each write expired the
 *  SHARED entry. Numbers up to five minutes old on a dashboard nobody watches
 *  second-by-second is a trade worth making to keep the system up. */
const DASHBOARD_TTL_SECONDS = 300;

/** The registered `Team` names, lower-cased. Structural teams (EB, LB,
 *  Function, Function leaders) are deliberately excluded — they are not
 *  anybody's team. */
async function registeredTeamNames(): Promise<Set<string>> {
  try {
    const { data } = await db().from("teams").select("name").eq("type", "Team");
    return new Set(
      ((data ?? []) as { name: string }[]).map((t) => t.name.trim().toLowerCase())
    );
  } catch {
    return new Set();
  }
}

/** Picks the one REAL team out of a membership cell that lists several. */
function teamLabelOf(cell: string | null, registered: Set<string>): string | null {
  const names = (cell ?? "")
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  const real = names.find((n) => registered.has(n.toLowerCase()));
  // a cell with several names and no registered team names no team of theirs
  return real ?? (names.length === 1 ? names[0] : null);
}

/** Exactly the columns the dashboard reads — every one of them is used by
 *  `addRowLane`, `laneSlots`, `rowInLane` or a drill grouping. Adding a field
 *  to those functions means adding it HERE too, or it arrives undefined and
 *  the number it feeds silently reads zero. */
const DASHBOARD_COLUMNS = [
  "id",
  "function",
  "product",
  "stage",
  "attempts",
  "visit_id",
  "visit_done",
  "out_of_process",
  "contact_limit_reached",
  "next_step_missing",
  "deals_count",
  "slots_count",
  "slots_igv_count",
  "slots_igta_count",
  "slots_igte_count",
  "responsible_id",
  "responsible_name",
  "responsible_role",
  "responsible_team_name",
  "responsible_stakeholder_id",
  "created_at",
  "is_test",
].join(",");

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
  if (lane === "B2B") return accountFn === "B2B" ? totalSlots : 0;
  if (lane === "BD") return accountFn === "BD" ? totalSlots : 0;
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
  // UNOWNED accounts are excluded from every dashboard number (v33.2). The
  // 1,300 imported market-research names nobody has taken are not work anyone
  // has done: counting them as Market Research inflates the top of the funnel
  // and drags every conversion below it toward zero, so the lane looks like it
  // is failing at contacting when really nobody has been given the names yet.
  // They can carry nothing else — scheduling a visit or recording a deal both
  // refuse until the account is assigned.
  const rowFilters = {
    ...filters,
    fn: undefined,
    product: undefined,
    responsibleId: undefined,
    includeArchived: true,
  };
  const key = dashboardCacheKey(accountScope(dashViewer), !!dashViewer.testMode, {
    from: rowFilters.from,
    to: rowFilters.to,
  });
  const { unstable_cache } = await import("next/cache");
  const readRows = unstable_cache(
    async () =>
      listAccounts(dashViewer, rowFilters, MAX_FETCH_ROWS, DASHBOARD_COLUMNS),
    ["dashboard-rows", key],
    { revalidate: DASHBOARD_TTL_SECONDS, tags: ["accounts"] }
  );
  const rows = (await readRows()).filter((r) => r.responsible_id != null);
  const inKpiScope = (r: PipelineRow) =>
    !filters.responsibleId || r.responsible_id === filters.responsibleId;
  const members = await listVisibleMembers(dashViewer);
  const byId = new Map(members.map((m) => [m.id, m]));
  // the registered TL teams — the only names in a member's team cell that
  // actually name THEIR team (v33.10)
  const registeredTeams = await registeredTeamNames();

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
      // THE TEAM NAME, NOT THE WHOLE CELL (v33.10). `team_name` lists every
      // team a person belongs to — Hana's reads "Suits, شماريخ", the B2B
      // function-leaders team and the LB, neither of which is her team. The
      // registered `Team` in that cell if there is one, otherwise just the
      // person: "Hana Wael" beats "Hana Wael — Suits, شماريخ".
      const own = teamLabelOf(mm.team_name, registeredTeams);
      const mmLabel = own ? `${mm.name} — ${own}` : mm.name;
      addRowLane(getOrInit(byTeam, mm.id, mmLabel), r, lane);
    }

    // leaderboards (VPs/Directors/LCP never appear — leaders steer):
    //  • Members board  → role Member
    //  • MMs board      → Team Leaders + Coordinators
    // each row is that person's OWN accounts (no team rollup)
    const respLabel = r.responsible_name;
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
      const label = m.name;
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
  // whose plan does this dashboard track? a TL's (their team), or — v25 — a
  // planning COORDINATOR's own plan vs their own numbers
  let planOwnerId = teamLeadId && teamMemberIds && teamLeadPlans ? teamLeadId : null;
  let planScopeIds = planOwnerId ? teamMemberIds! : null;
  if (!planOwnerId && viewer.role === "Coordinator" && isPlanningTl(viewer)) {
    planOwnerId = viewer.id;
    planScopeIds = new Set([viewer.id]);
  }
  if (planOwnerId && planScopeIds) {
    const month = monthOf();
    const { data: planRow } = await db()
      .from("tl_plans")
      .select("opens")
      .eq("member_id", planOwnerId)
      .eq("month", month.planKeys[0])
      .maybeSingle<{ opens: number }>();
    let q = db()
      .from("deal_allocations")
      .select(
        "slots_igv, slots_igta, slots_igte, deal:deals!inner(created_at, account:accounts!inner(is_test))"
      )
      .in("member_id", [...planScopeIds])
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
      teamLeaderId: planOwnerId,
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
  // v25: the VP/Director planning numbers are for leaders' eyes — an MM
  // tracks THEIR OWN plan (the team card below), not the function's
  const viewerIsPlanLeader =
    viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
  if (viewerIsPlanLeader && (lane === "IGV" || lane === "IGTa" || lane === "IGTe" || lane === "IGT")) {
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
  added_by_member: { name: string } | null;
}

/** Manually archived account names (never worked in the CRM) — they live in
 *  the blacklist table and block re-adding exactly like OOP accounts. */
export async function listManualArchived(): Promise<ManualArchivedRow[]> {
  return fetchAll<ManualArchivedRow>(() =>
    db()
      .from("blacklist")
      .select("*, added_by_member:members!blacklist_added_by_fkey(name)")
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
  // EVERY function the member carries, as the sheet spells it (v32.7). B2B and
  // BD share a membership today but are separate functions and may split in a
  // future peak, so a BD member joins the BD teams — not B2B's.
  const fns = [...new Set(viewer.functions.filter(Boolean))];

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
  /** EVERY side this member works, in order (v33.6). Plenty of ICX MMs are
   *  "Raising, Consideration" — showing one set of numbers and calling it
   *  their MOS hid half their job, and made a whole side of the funnel
   *  invisible to the person reviewing them. `mos` stays as the primary. */
  mosAll: ("raising" | "bd" | "b2c" | "consideration" | "ogx" | "other")[];
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
    /** OGX only (v25): REAL approvals — sign-ups they own with status Approved */
    signupApprovals: number;
    /** OGX only (v29): the member's own slice of the sign-up funnel — the SAME
     *  ladder the OGX dashboard lane draws (Approved ⊂ Accepted ⊂ Applied),
     *  counted over the live (non-OOP) sign-ups assigned to them */
    signupTotal: number;
    signupContacted: number;
    signupInterested: number;
    signupApplied: number;
    signupAccepted: number;
  };
}

/** v29.4 — the directory exists to REVIEW performance, so it lists ONLY the
 *  people whose performance is reviewed here: **Members, Coordinators and
 *  Team Leaders**. Dropped:
 *  · the LCP,
 *  · EVERY LCVP and EVERY Director, in every function — leaders are not part
 *    of the TM performance review (they review, they aren't reviewed here),
 *  · CXP's MMs (CXP reviews CXP),
 *  · TM's OWN MMs — TM runs this tab. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reviewedInDirectory(m: any): boolean {
  const role: string = m.role;
  if (role === "LCP" || role === "LCVP" || role === "Director") return false;
  const all: string[] = [...(m.functions ?? []), ...(m.sub_functions ?? [])];
  const has = (...keys: string[]) => keys.some((k) => all.includes(k));
  const isMm = role === "Team Leader" || role === "Coordinator";
  if (has("CXP") && isMm) return false;
  if (has("TM") && isMm) return false;
  return true;
}

/** The TM directory's date window (?from / ?to — inclusive Cairo days).
 *  Empty = ALL TIME, which is the default: a viewer who never touches the
 *  filter bar sees exactly the lifetime numbers the tab always showed. */
export interface DirectoryWindow {
  from?: string;
  to?: string;
}

const DIRECTORY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The Cairo day AFTER `day` (pure YYYY-MM-DD math). */
const nextDayIso = (day: string): string =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/** Sanitize ?from/?to before they touch a query: real YYYY-MM-DD days only,
 *  never in the future (Cairo "today" is the ceiling — work can't be logged
 *  ahead of time), and an inverted range self-heals instead of returning an
 *  empty tab. Applied SERVER-SIDE so a hand-typed URL can't widen it. */
export function clampDirectoryWindow(raw: DirectoryWindow): DirectoryWindow {
  const today = cairoDayIso();
  const clean = (v?: string) =>
    v && DIRECTORY_DAY_RE.test(v) ? (v > today ? today : v) : undefined;
  let from = clean(raw.from);
  let to = clean(raw.to);
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

/** The work rows behind the KPIs — one shape per mode so the aggregation
 *  below stays readable. All time reads the accounts' running counters (what
 *  the tab always did); a window has to read the WORK ITSELF, each item by
 *  its own date. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type DirectoryWork =
  | { kind: "all"; bdDeals: any[]; allocations: any[] }
  | {
      kind: "window";
      contacts: any[];
      visitsBooked: any[];
      visitsDone: any[];
      deals: any[];
      allocations: any[];
    };
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The TM module's whole-LC members directory: every active member with their
 *  info + personal KPIs (MOS) + contact shortcuts. TM function, LCP, admin.
 *
 *  v29.4 — every number honours an optional DATE WINDOW, each KPI counted on
 *  its OWN date (never the account's):
 *    · market research → accounts.created_at
 *    · contacted       → contact_attempts.created_at (the attempt itself)
 *    · visits          → visits.created_at (the booking ACTION — the work done
 *                        in the window; visit_date would drop a visit booked
 *                        now for a date still to come)
 *    · visits done     → visits.visit_date (the day it actually happened)
 *    · deals / opens / BD money → deals.created_at (opens via that deal's
 *                        allocations, so split deals still credit correctly)
 *    · filed plans     → mm_plans.month, counted when the month OVERLAPS
 *    · sign-ups        → signed_up_at, the very column the OGX dashboard lane
 *                        filters on (no status carries its own date; the row's
 *                        import stamp is the fallback). */
export async function listMembersDirectory(
  viewer: Viewer,
  range: DirectoryWindow = {}
): Promise<MemberDirectoryEntry[]> {
  if (!hasTmAccess(viewer)) return [];

  const { from, to } = clampDirectoryWindow(range);
  const windowed = !!(from || to);
  // Cairo day bounds → UTC instants, half-open [startIso, endIso). DST-aware:
  // a UTC midnight would slice the wrong 2–3 hours off each end.
  const { cairoToUtc } = await import("@/lib/time");
  const startIso = from ? cairoToUtc(from, "00:00").toISOString() : null;
  const endIso = to ? cairoToUtc(nextDayIso(to), "00:00").toISOString() : null;
  const startTs = startIso ? Date.parse(startIso) : -Infinity;
  const endTs = endIso ? Date.parse(endIso) : Infinity;
  const inWindow = (ts: string | null | undefined) => {
    if (!windowed) return true;
    if (!ts) return false;
    const t = Date.parse(ts);
    return Number.isFinite(t) && t >= startTs && t < endTs;
  };
  const inDayWindow = (day: string | null | undefined) => {
    if (!windowed) return true;
    if (!day) return false;
    const d = day.slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  };

  const allTimeWork = async (): Promise<DirectoryWork> => {
    const [bd, allocations] = await Promise.all([
      // BD money: Σ deal amounts on BD accounts, per responsible
      db()
        .from("deals")
        .select("amount, account:accounts!inner(responsible_id, function, is_test)")
        .eq("account.function", "BD")
        .eq("account.is_test", false),
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
    return { kind: "all", bdDeals: bd.data ?? [], allocations };
  };

  const windowWork = async (): Promise<DirectoryWork> => {
    const [contacts, visitsBooked, visitsDone, deals, allocations] = await Promise.all([
      // contacted = the contact ATTEMPT's own timestamp
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<any>(() => {
        let q = db().from("contact_attempts").select("account_id, created_at");
        if (startIso) q = q.gte("created_at", startIso);
        if (endIso) q = q.lt("created_at", endIso);
        return q.order("id");
      }).catch(() => []),
      // "Visits" = the booking ACTION (visits.created_at) — that's the work the
      // member did inside the window. Keying it on visit_date would silently
      // drop the visits they booked this month for a date still to come.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<any>(() => {
        let q = db().from("visits").select("account_id, created_at");
        if (startIso) q = q.gte("created_at", startIso);
        if (endIso) q = q.lt("created_at", endIso);
        return q.order("id");
      }).catch(() => []),
      // "Visits done" = the day the visit ACTUALLY HAPPENED (visits.visit_date)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<any>(() => {
        let q = db().from("visits").select("account_id, visit_date").eq("done", true);
        if (from) q = q.gte("visit_date", from);
        if (to) q = q.lte("visit_date", to);
        return q.order("id");
      }).catch(() => []),
      // deals (+ BD money) = when the deal was signed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<any>(() => {
        let q = db()
          .from("deals")
          .select(
            "slots, amount, created_at, account:accounts!inner(responsible_id, function, is_test)"
          )
          .eq("account.is_test", false);
        if (startIso) q = q.gte("created_at", startIso);
        if (endIso) q = q.lt("created_at", endIso);
        return q.order("id");
      }).catch(() => []),
      // opens = the allocations of the deals signed INSIDE the window
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<any>(() => {
        let q = db()
          .from("deal_allocations")
          .select(
            "member_id, slots_igv, slots_igta, slots_igte, deal:deals!inner(created_at, account:accounts!inner(is_test))"
          )
          .eq("deal.account.is_test", false);
        if (startIso) q = q.gte("deal.created_at", startIso);
        if (endIso) q = q.lt("deal.created_at", endIso);
        return q.order("id");
      }).catch(() => []),
    ]);
    return { kind: "window", contacts, visitsBooked, visitsDone, deals, allocations };
  };

  const [{ data: membersData }, accountsData, { data: mmPlans }, ogxSignups, work] =
    await Promise.all([
      db()
        .from("members")
        .select(
          "id, name, email, phone, role, functions, sub_functions, team_name, stakeholder_id"
        )
        .eq("is_active", true)
        .order("name"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<any>(() =>
        db()
          .from("accounts_pipeline")
          .select(
            "id, created_at, responsible_id, attempts, visit_id, visit_done, deals_count, slots_count"
          )
          .eq("is_test", false)
          .order("id")
      ),
      db().from("mm_plans").select("member_id, month, applicants, accepted, approvals"),
      // v29: the WHOLE live sign-up funnel per assigned member (v25 only read
      // the Approved rows) — the directory's OGX row now mirrors the dashboard
      // lane exactly. fetchAll pages past the 1000-row response cap.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<any>(() =>
        db()
          .from("signups")
          .select("assigned_to, contact_status, interested, status, signed_up_at, created_at")
          .eq("out_of_process", false)
          .not("assigned_to", "is", null)
          .order("id")
      ).catch(() => []),
      windowed ? windowWork() : allTimeWork(),
    ]);

  type Agg = MemberDirectoryEntry["kpis"];
  const emptyAgg = (): Agg => ({
    mr: 0, contacted: 0, visits: 0, visitsDone: 0, deals: 0, slots: 0,
    egp: 0, planApplicants: 0, planAccepted: 0, planApprovals: 0,
    signupApprovals: 0, signupTotal: 0, signupContacted: 0,
    signupInterested: 0, signupApplied: 0, signupAccepted: 0,
  });
  const kpisById = new Map<string, Agg>();
  const agg = (id: string) => {
    let k = kpisById.get(id);
    if (!k) { k = emptyAgg(); kpisById.set(id, k); }
    return k;
  };

  // market research is the ACCOUNT's own creation date in both modes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = (accountsData ?? []) as any[];
  const responsibleOf = new Map<string, string>();
  for (const a of accounts) {
    if (!a.responsible_id) continue; // unassigned imports belong to nobody yet
    responsibleOf.set(a.id, a.responsible_id);
    if (inWindow(a.created_at)) agg(a.responsible_id).mr += 1;
  }

  if (work.kind === "all") {
    const useAllocations = work.allocations.length > 0;
    for (const a of accounts) {
      if (!a.responsible_id) continue;
      const k = agg(a.responsible_id);
      if (a.attempts > 0) k.contacted += 1;
      if (a.visit_id) k.visits += 1;
      if (a.visit_done) k.visitsDone += 1;
      k.deals += a.deals_count ?? 0;
      // pre-0018 fallback: no allocations table → account counters
      if (!useAllocations) k.slots += a.slots_count ?? 0;
    }
    // opens are allocation-attributed (a split deal credits each member their share)
    for (const al of work.allocations) {
      agg(al.member_id).slots +=
        (al.slots_igv ?? 0) + (al.slots_igta ?? 0) + (al.slots_igte ?? 0);
    }
    for (const d of work.bdDeals) {
      const owner = d.account?.responsible_id;
      if (owner) agg(owner).egp += Number(d.amount) || 0;
    }
  } else {
    // Windowed: same UNITS as all-time (contacted / visits / visits done count
    // ACCOUNTS, deals count deals) — an account is only counted once even if
    // it was worked several times inside the window. Test accounts never enter
    // responsibleOf, so their work is dropped here too.
    const seenContact = new Set<string>();
    const seenVisit = new Set<string>();
    const seenDone = new Set<string>();
    for (const c of work.contacts) {
      const owner = responsibleOf.get(c.account_id);
      if (!owner || seenContact.has(c.account_id)) continue;
      seenContact.add(c.account_id);
      agg(owner).contacted += 1;
    }
    for (const v of work.visitsBooked) {
      const owner = responsibleOf.get(v.account_id);
      if (!owner || seenVisit.has(v.account_id)) continue;
      seenVisit.add(v.account_id);
      agg(owner).visits += 1;
    }
    for (const v of work.visitsDone) {
      const owner = responsibleOf.get(v.account_id);
      if (!owner || seenDone.has(v.account_id)) continue;
      seenDone.add(v.account_id);
      agg(owner).visitsDone += 1;
    }
    for (const d of work.deals) {
      const owner = d.account?.responsible_id;
      if (!owner) continue;
      const k = agg(owner);
      k.deals += 1;
      if (d.account?.function === "BD") k.egp += Number(d.amount) || 0;
    }
    if (work.allocations.length > 0) {
      for (const al of work.allocations) {
        agg(al.member_id).slots +=
          (al.slots_igv ?? 0) + (al.slots_igta ?? 0) + (al.slots_igte ?? 0);
      }
    } else {
      // pre-0018 fallback: no allocations → the deal's own opens to its owner
      for (const d of work.deals) {
        const owner = d.account?.responsible_id;
        if (owner) agg(owner).slots += d.slots ?? 0;
      }
    }
  }

  // filed plans are MONTHLY: a plan counts when its month OVERLAPS the window
  const planInWindow = (month: string | null) => {
    if (!windowed) return true;
    if (!month) return false;
    const start = month.slice(0, 10);
    if (!DIRECTORY_DAY_RE.test(start)) return false;
    const y = Number(start.slice(0, 4));
    const m0 = Number(start.slice(5, 7)) - 1;
    const last = String(new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()).padStart(2, "0");
    const end = `${start.slice(0, 8)}${last}`;
    return (!from || end >= from) && (!to || start <= to);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (mmPlans ?? []) as any[]) {
    if (!planInWindow(p.month)) continue;
    const k = agg(p.member_id);
    k.planApplicants += p.applicants ?? 0;
    k.planAccepted += p.accepted ?? 0;
    k.planApprovals += p.approvals ?? 0;
  }
  // the OGX ladder, exactly as ogxDashboard counts it: Contacted/Interested are
  // the sheet's yes-ish text, and Approved ⊂ Accepted ⊂ Applied. No status
  // carries its own date, so the window uses the SIGN-UP's own date — the very
  // column the OGX dashboard lane filters on (its import stamp is the fallback).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of ogxSignups as any[]) {
    if (!s.assigned_to) continue;
    if (windowed && !inDayWindow(signupDayIso(s.signed_up_at) ?? s.created_at)) continue;
    const k = agg(s.assigned_to);
    k.signupTotal += 1;
    if (_ogxYes(s.contact_status)) k.signupContacted += 1;
    if (_ogxYes(s.interested)) k.signupInterested += 1;
    if (s.status === "Applied" || s.status === "Accepted" || s.status === "Approved")
      k.signupApplied += 1;
    if (s.status === "Accepted" || s.status === "Approved") k.signupAccepted += 1;
    if (s.status === "Approved") k.signupApprovals += 1;
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

  /** Every side, not just the dominant one — an ICX member labelled
   *  "Raising, Consideration" does both jobs and is reviewed on both. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const classifyAll = (m: any): MemberDirectoryEntry["mosAll"] => {
    const primary = classify(m);
    const fns: string[] = m.functions ?? [];
    const subs: string[] = m.sub_functions ?? [];
    const icx = fns.includes("IGV") || fns.includes("IGT");
    const out: MemberDirectoryEntry["mosAll"] = [primary];
    if (
      icx &&
      primary === "raising" &&
      subs.includes("Consideration") &&
      m.role !== "LCVP" &&
      m.role !== "Director"
    )
      out.push("consideration");
    if (icx && primary === "consideration" && (subs.includes("Raising") || subs.includes("ICX")))
      out.unshift("raising");
    return out;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = (membersData ?? []) as any[];
  // names resolve over EVERY active member (a dropped person can still be
  // someone's manager) — only the listed ROWS are filtered
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  return members.filter(reviewedInDirectory).map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    role: m.role,
    functions: m.functions ?? [],
    sub_functions: m.sub_functions ?? [],
    team_name: m.team_name,
    manager: m.stakeholder_id ? nameById.get(m.stakeholder_id) ?? null : null,
    mos: classify(m),
    mosAll: classifyAll(m),
    kpis: kpisById.get(m.id) ?? emptyAgg(),
  }));
}

// ------------------------------------------------------------------ my people

export interface PersonCard {
  id: string;
  name: string;
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
        "member:members(id, name)"
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
  // v32: stamp the action's CHANGE SET (and the LC test session it belongs to,
  // if one is open) so /admin can reverse exactly this action's journal rows.
  let change_set: string | null = null;
  let test_session_id: string | null = null;
  try {
    // STATIC import — a dynamic one lands in a different module instance and
    // gets its own `cache()` memo, which is exactly how the audit rows and
    // their journal rows ended up with different ids (v33.10)
    const { lcTestSession } = await import("./sandbox");
    change_set = currentChangeSet();
    test_session_id = await lcTestSession();
  } catch {
    /* outside a request scope (crons, scripts) — a plain audit row is fine */
  }
  const base = {
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId,
    details: details ?? null,
  };
  const { error } = await db()
    .from("audit_log")
    .insert({ ...base, change_set, test_session_id });
  // Pre-0033 grace: the undo columns may not exist yet (migrations are applied
  // by hand in the SQL editor). Auditing must never stop because of that — fall
  // back to the classic row, just without the undo link.
  if (error?.code === "42703") await db().from("audit_log").insert(base);
  else if (error) console.error("[audit] insert failed:", error.message);
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
  /** the action's change set — null on entries written before v32 */
  changeSet: string | null;
  /** how many journal rows this action can reverse (0 = nothing to undo) */
  undoable: number;
  /** set once someone has undone it, so it can't be replayed twice */
  undoneAt: string | null;
  /** true when the action was taken inside an LC-wide testing session */
  inTestSession: boolean;
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

  // private storage buckets: deal contracts + the consideration CV pool
  for (const bucket of ["contracts", "cvs"] as const) {
    try {
      const { error } = await db().storage.from(bucket).list("", { limit: 1 });
      checks.push({
        label: `Storage bucket (${bucket})`,
        ok: !error,
        detail: error ? error.message : "Available",
      });
    } catch (e) {
      checks.push({ label: `Storage bucket (${bucket})`, ok: false, detail: `${e}` });
    }
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
  checks.push({
    label: "Public URL (NEXT_PUBLIC_APP_URL)",
    ok: !!process.env.NEXT_PUBLIC_APP_URL,
    detail: process.env.NEXT_PUBLIC_APP_URL
      ? env.appUrl
      : `Missing — links & booking pages fall back to ${env.appUrl}`,
  });

  // counts — every live module, defensive per table (-1 = table unreachable)
  const counts: SystemHealth["counts"] = [
    { label: "Active members", value: await countOf("members", ["is_active", true]) },
    { label: "Active accounts", value: await countOf("accounts", ["out_of_process", false]) },
    { label: "Archived accounts", value: await countOf("accounts", ["out_of_process", true]) },
    { label: "Deals", value: await countOf("deals") },
    { label: "Sign-ups (OGX)", value: await countOf("signups") },
    { label: "IR calls", value: await countOf("ir_calls") },
    { label: "CVs in the pool", value: await countOf("cvs") },
    { label: "Partner LCs", value: await countOf("partner_lcs") },
    { label: "Touch points", value: await countOf("touch_points") },
    { label: "Attendance rows", value: await countOf("touch_point_attendance") },
    { label: "Plan cells", value: await countOf("plan_cells") },
    { label: "Visits", value: await countOf("visits") },
    { label: "Contact attempts", value: await countOf("contact_attempts") },
    { label: "Blacklist", value: await countOf("blacklist") },
  ];

  // cron last-run — real timestamps stamped by markCronRun (app_settings).
  // Keep this list in sync with supabase/cron.sql + src/app/api/cron/*.
  const CRON_META: { key: string; label: string; note: string }[] = [
    { key: "visit-followups", label: "Visit follow-ups", note: "every 15 min" },
    { key: "signups-import", label: "Sign-ups sheet sync", note: "every 15 min" },
    { key: "membership-import", label: "Membership import", note: "every 30 min" },
    { key: "sheets-export", label: "Sheets export", note: "hourly (:05)" },
    { key: "podio-updates", label: "Podio continuous updates", note: "daily 05:00 UTC" },
    { key: "period-reports", label: "Period reports", note: "daily 07:00 UTC (fires on sprint/month/quarter ends)" },
    { key: "streak-nags", label: "OGV streak nags", note: "daily 16:00 UTC (19:00 Cairo)" },
    { key: "attendance-reminders", label: "Attendance reminders", note: "daily 21:00 UTC" },
    { key: "backup", label: "Nightly backup", note: "daily 02:00 UTC (04:00 Cairo)" },
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
/** v25: OGX/consideration functions overlap check (B2B↔BD aliased). */
function memberInFns(
  m: { functions?: string[] | null; sub_functions?: string[] | null } | null | undefined,
  fns: string[]
): boolean {
  const all = [...(m?.functions ?? []), ...(m?.sub_functions ?? [])];
  return fns.some(
    (f) =>
      all.includes(f) ||
      (f === "B2B" && all.includes("BD")) ||
      (f === "BD" && all.includes("B2B")) ||
      // B2B/BD raise for the whole ICX — their plans belong on the IGV/IGT
      // VPs' planning board too (mirrors scopeFunctions)
      ((f === "IGV" || f === "IGT") && ["B2B", "BD"].some((b) => all.includes(b)))
  );
}

export async function listMmPlans(
  memberIds?: string[],
  /** restrict to MMs of these functions (a VP sees only their own crew) */
  memberFns?: string[]
): Promise<MmPlanRow[]> {
  let q = db()
    .from("mm_plans")
    .select("member_id, month, applicants, accepted, approvals, peak, member:members!member_id(name, role, team_name, functions, sub_functions)")
    .order("month");
  if (memberIds && memberIds.length > 0) q = q.in("member_id", memberIds);
  const { data: rawData } = await q;
  const scoped = memberFns?.length
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((rawData ?? []) as any[]).filter((r) => memberInFns(r.member, memberFns))
    : rawData;
  // A plan belongs to the member's CURRENT job (v32). Move someone from
  // Consideration to Raising and their old applicants/approvals plan stops
  // being their plan — reading through the live membership row means the
  // board is right the moment the sheet changes, with no cleanup to remember.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = ((scoped ?? []) as any[]).filter((r) => stillPlans(r.member, "mm"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    member_id: r.member_id,
    member_name: r.member?.name || "?",
    member_role: r.member?.role ?? "",
    team_name: r.member?.team_name ?? null,
    month: r.month,
    applicants: r.applicants,
    accepted: r.accepted,
    approvals: r.approvals,
    peak: r.peak,
  }));
}

/** Does this member STILL qualify for the plan type filed against them?
 *
 *  Plans outlive the job that produced them: move someone from Consideration
 *  to Raising (or out of an MM role, or to another function) and their old
 *  applicants/approvals plan is left behind, still showing on /planning as if
 *  it were their target. Every plan LIST read goes through this, so a stale
 *  plan stops counting the moment the Membership sheet changes — no cleanup
 *  job to remember and nothing to fix by hand. `prunePlansForMember` then
 *  deletes the rows for good on the next membership edit or import. */
function stillPlans(
  member:
    | { role?: string | null; functions?: string[] | null; sub_functions?: string[] | null }
    | null
    | undefined,
  kind: "mm" | "tl"
): boolean {
  if (!member) return false;
  const v = {
    role: member.role ?? "",
    functions: member.functions ?? [],
    sub_functions: member.sub_functions ?? [],
  };
  return kind === "mm" ? isPlanningMm(v) : isPlanningTl(v);
}

/** Drops the plan rows a member no longer qualifies for. Called after every
 *  membership write (in-app editor + the 30-min sheet import), so a role or
 *  sub-function change cleans up after itself. Best-effort: a failure here
 *  never blocks the membership save — `stillPlans` already hides the row. */
export async function prunePlansForMember(m: {
  id: string;
  role?: string | null;
  functions?: string[] | null;
  sub_functions?: string[] | null;
}): Promise<void> {
  try {
    if (!stillPlans(m, "mm"))
      await db().from("mm_plans").delete().eq("member_id", m.id);
    if (!stillPlans(m, "tl"))
      await db().from("tl_plans").delete().eq("member_id", m.id);
  } catch (e) {
    console.error("[plans] prune failed for", m.id, e);
  }
}

/** Sweeps the WHOLE LC for plans whose owner no longer qualifies and deletes
 *  them. Runs at the end of every membership import (every 30 min), so a
 *  sub-function change made in the Google Sheet — the way most of these
 *  actually happen — cleans up on its own. Returns how many rows went.
 *  Idempotent, and safe to run at any time. */
export async function pruneStalePlans(): Promise<{ mm: number; tl: number }> {
  const { data: members } = await db()
    .from("members")
    .select("id, role, functions, sub_functions");
  const rows = (members ?? []) as {
    id: string;
    role: string | null;
    functions: string[] | null;
    sub_functions: string[] | null;
  }[];
  const staleMm = rows.filter((m) => !stillPlans(m, "mm")).map((m) => m.id);
  const staleTl = rows.filter((m) => !stillPlans(m, "tl")).map((m) => m.id);
  let mm = 0;
  let tl = 0;
  // chunked: an `in` list of every member would blow past the URL limit
  for (let i = 0; i < staleMm.length; i += 100) {
    const { data } = await db()
      .from("mm_plans")
      .delete()
      .in("member_id", staleMm.slice(i, i + 100))
      .select("id");
    mm += (data ?? []).length;
  }
  for (let i = 0; i < staleTl.length; i += 100) {
    const { data } = await db()
      .from("tl_plans")
      .delete()
      .in("member_id", staleTl.slice(i, i + 100))
      .select("id");
    tl += (data ?? []).length;
  }
  if (mm || tl) console.log(`[plans] pruned ${mm} mm_plans + ${tl} tl_plans rows`);
  return { mm, tl };
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
export async function listTlPlans(
  memberIds?: string[],
  /** restrict to MMs of these functions (a VP sees only their own crew) */
  memberFns?: string[]
): Promise<TlPlanRow[]> {
  let q = db()
    .from("tl_plans")
    .select("member_id, month, opens, peak, member:members!member_id(name, role, team_name, functions, sub_functions)")
    .order("month");
  if (memberIds && memberIds.length > 0) q = q.in("member_id", memberIds);
  const { data: rawData, error } = await q;
  if (error) return []; // pre-0018 grace
  const scoped = memberFns?.length
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((rawData ?? []) as any[]).filter((r) => memberInFns(r.member, memberFns))
    : rawData;
  // same rule as listMmPlans: an opens plan only counts while its owner is
  // still a raising MM
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = ((scoped ?? []) as any[]).filter((r) => stillPlans(r.member, "tl"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    member_id: r.member_id,
    member_name: r.member?.name || "?",
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
  let q = db().from("members").select("id, name, role").eq("is_active", true);
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
    .map((m) => ({ id: m.id, label: m.name }));
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
    .select("id, name, email, role, functions, sub_functions, team_name, stakeholder_id")
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
  const label = (m: (typeof crew)[number]) => m.name;
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

export interface AttendedTouchPointOption {
  id: string;
  /** "Team meeting · Sat, Aug 9 · 6:30 PM (Cairo time)" */
  label: string;
  ownerName: string;
}

/** Touch points the viewer actually SHOWED UP to (attended or late) — the
 *  pick-list for feedback ABOUT a touch point (v29). You can only review a
 *  session you were in. Most recent first. */
export async function listAttendedTouchPoints(
  viewer: Viewer
): Promise<AttendedTouchPointOption[]> {
  const { touchPointLabel } = await import("@/lib/types");
  const { cairoWhen } = await import("@/lib/touch-points");
  const { data: att, error } = await db()
    .from("touch_point_attendance")
    .select("touch_point_id, status")
    .eq("member_id", viewer.id)
    .in("status", ["attended", "late"]);
  if (error) {
    console.error("[lc-feedback] attended touch points failed:", error.message);
    return [];
  }
  const ids = [...new Set(((att ?? []) as { touch_point_id: string }[]).map((r) => r.touch_point_id))];
  if (ids.length === 0) return [];
  const { data } = await db()
    .from("touch_points")
    .select("id, scope, kind, starts_at, owner_id, owner_name")
    .in("id", ids)
    .order("starts_at", { ascending: false })
    .limit(30);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    // no organiser left = nobody to send a shout-out to
    .filter((tp) => tp.owner_id && tp.owner_id !== viewer.id)
    .map((tp) => ({
      id: tp.id,
      label: `${touchPointLabel(tp.scope, tp.kind)} · ${cairoWhen(tp.starts_at)}`,
      ownerName: tp.owner_name,
    }));
}

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
  if (!_canSeeLcConcerns(viewer)) return [];
  const [{ data }, { data: membersData }] = await Promise.all([
    db()
      .from("lc_feedback")
      .select("id, positive, anonymous, author_id, about, message, status, created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    db().from("members").select("id, name"),
  ]);
  const nameById = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((membersData ?? []) as any[]).map((m) => [m.id, m.name])
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
    .select(
      "id, action, entity, entity_id, details, created_at, change_set, undone_at, test_session_id, actor:members!actor_id(name)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  // pre-0033 grace: fall back to the classic columns so the log still renders
  // (without Undo) on a database where the migration hasn't been run yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any[] | null = data;
  if (!raw) {
    const { data: legacy } = await db()
      .from("audit_log")
      .select("id, action, entity, entity_id, details, created_at, actor:members!actor_id(name)")
      .order("created_at", { ascending: false })
      .limit(limit);
    raw = legacy;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (raw ?? []) as any[];
  // how many journal rows each action can actually reverse — an entry with
  // none shows a disabled Undo and says why, instead of lying
  const { changeSetSizes } = await import("./sandbox");
  const sizes = await changeSetSizes(
    [...new Set(rows.map((r) => r.change_set).filter(Boolean))] as string[]
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    actor: r.actor ? r.actor.name : null,
    details: r.details ? JSON.stringify(r.details) : null,
    createdAt: r.created_at,
    changeSet: r.change_set ?? null,
    undoable: r.undone_at || !r.change_set ? 0 : (sizes.get(r.change_set) ?? 0),
    undoneAt: r.undone_at ?? null,
    inTestSession: !!r.test_session_id,
  }));
}

// ================================================================== OGX sign-ups (v25)

import {
  canEditSignupVpFields as _canEditSignupVpFields,
  canViewSignup as _canViewSignup,
  ogxFunctions as _ogxFunctions,
  ogxLanes as _ogxLanes,
} from "@/lib/rbac";
import { SIGNUP_STATUSES } from "@/lib/types";
import type { OgxFunction, SignupComment, SignupRow } from "@/lib/types";

export interface SignupFilters {
  /** unassigned (default main view) · mine · team (TL+) · all (VP+) · archived */
  view?: string;
  fn?: string;
  batch?: string;
  program?: string;
  status?: string;
  interested?: string;
  contacted?: string;
  country?: string;
  /** straight from the tracker — free-form, so the options come from the data */
  personStatus?: string;
  /** rows with a missing/unusable phone (null, empty or "deleted…") */
  /** "missing" = no usable number · "has" = a number exists */
  phone?: "missing" | "has";
  /** v28 potential pipeline: a status value, or "none" = plain sign-ups */
  potential?: string;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
}

const SIGNUP_SORTABLE = new Set([
  "signed_up_at", "name", "program", "contact_status", "interested",
  "status", "country", "created_at", "updated_at", "assigned_at",
]);

/** Which list views this viewer may open (server-enforced). */
export function signupViewsFor(v: Viewer): string[] {
  const leader =
    v.isAdmin || ["LCP", "LCVP", "Director"].includes(v.role);
  // THE POOL IS NOT A MEMBER'S VIEW (v33.10). Sign-ups are handed out by the
  // Team Leader — a member browsing the unclaimed pool picks the easy ones and
  // the distribution stops being anyone's decision. MMs and above still see
  // it, because assigning IS their job. A member lands on "My sign-ups".
  const seesPool = leader || ["Team Leader", "Coordinator"].includes(v.role);
  return [
    ...(seesPool ? ["unassigned"] : []),
    "mine",
    ...(v.role === "Team Leader" ? ["team"] : []),
    ...(leader ? ["all"] : []),
    "archived",
  ];
}

/** Paginated, scoped sign-ups list. Scope: leaders → their function(s); TL →
 *  own + team + the unassigned pool; members → own + unassigned. The
 *  "archived" view (Out of Process) is read-only browsing for the crew. */
export async function listSignupsPage(
  viewer: Viewer,
  filters: SignupFilters,
  page: number,
  pageSize = 100
): Promise<{ rows: SignupRow[]; total: number; page: number; view: string }> {
  const fns = _ogxFunctions(viewer);
  if (fns.length === 0) return { rows: [], total: 0, page: 0, view: "unassigned" };
  const allowedViews = signupViewsFor(viewer);
  const view = allowedViews.includes(filters.view ?? "")
    ? filters.view!
    : (allowedViews[0] ?? "mine");

  const build = () => {
    let q = db().from("signups").select("*", { count: "exact" });
    // function scope
    const fn = filters.fn && fns.includes(filters.fn as OgxFunction) ? [filters.fn] : fns;
    q = q.in("fn", fn);
    // view scope
    if (view === "archived") q = q.eq("out_of_process", true);
    else q = q.eq("out_of_process", false);
    if (view === "unassigned") q = q.is("assigned_to", null);
    else if (view === "mine") {
      // "MINE" MEANS WHAT YOU ANSWER FOR (v33.12): a member's own, a Team
      // Leader's own plus their team's, a VP/Director/LCP every assigned
      // sign-up in their function. A leader opening "My sign-ups" and seeing
      // three rows while their function works four hundred was reading it as
      // a personal inbox when it is their responsibility.
      const leader = viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
      if (leader) q = q.not("assigned_to", "is", null);
      else if (viewer.role === "Team Leader")
        q = q.in("assigned_to", [viewer.id, ...viewer.teamMemberIds]);
      else q = q.eq("assigned_to", viewer.id);
    }
    else if (view === "team")
      q = q.in("assigned_to", [viewer.id, ...viewer.teamMemberIds]);
    else if (view === "all" || view === "archived") {
      // leaders browse the whole function; non-leaders' archived view is
      // still scoped to what they could otherwise see
      const leader = viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
      if (!leader && view === "archived") {
        if (viewer.role === "Team Leader")
          q = q.or(
            `assigned_to.is.null,assigned_to.in.(${[viewer.id, ...viewer.teamMemberIds].join(",")})`
          );
        else q = q.or(`assigned_to.is.null,assigned_to.eq.${viewer.id}`);
      }
    }
    // MULTI-SELECT (v33.3) — same rule as the accounts list: a comma-joined
    // value means "any of these".
    {
      const batches = pickList(filters.batch).filter((b) => b === "new" || b === "old");
      if (batches.length === 1) q = q.eq("batch", batches[0]);
      else if (batches.length > 1) q = q.in("batch", batches);
    }
    {
      const programs = pickList(filters.program);
      if (programs.length === 1) q = q.ilike("program", programs[0]);
      else if (programs.length > 1)
        q = q.or(programs.map((v) => `program.ilike.${v}`).join(","));
    }
    if (filters.status) q = q.eq("status", filters.status);
    // 🎯 Potential (v28): specific stages, or "none" = no stage set yet — and
    // "none" can't be `in`-ed, so a mix becomes an OR
    {
      const picks = pickList(filters.potential);
      const wantsNone = picks.includes("none");
      const stages = picks.filter(
        (v) => v !== "none" && (SIGNUP_STATUSES as readonly string[]).includes(v)
      );
      if (wantsNone && stages.length === 0) q = q.is("status", null);
      else if (wantsNone && stages.length > 0)
        q = q.or(`status.is.null,status.in.(${stages.map((v) => `"${v}"`).join(",")})`);
      else if (stages.length === 1) q = q.eq("status", stages[0]);
      else if (stages.length > 1) q = q.in("status", stages);
    }
    // the display treats any y*/n* as Yes/No — the filter must match it
    const ynPat = (v: string) => (v === "Yes" ? "y%" : v === "No" ? "n%" : v);
    {
      const picks = pickList(filters.interested);
      if (picks.length === 1) q = q.ilike("interested", ynPat(picks[0]));
      else if (picks.length > 1)
        q = q.or(picks.map((v) => `interested.ilike.${ynPat(v)}`).join(","));
    }
    {
      const picks = pickList(filters.contacted);
      if (picks.length === 1) q = q.ilike("contact_status", ynPat(picks[0]));
      else if (picks.length > 1)
        q = q.or(picks.map((v) => `contact_status.ilike.${ynPat(v)}`).join(","));
    }
    if (filters.country) q = q.ilike("country", `%${filters.country}%`);
    {
      const picks = pickList(filters.personStatus);
      if (picks.length === 1) q = q.eq("person_status", picks[0]);
      else if (picks.length > 1) q = q.in("person_status", picks);
    }
    // phone filter (v27, both directions): "missing" = null / empty / the
    // sheets' "deleted phone number" placeholder; "has" = a usable number
    if (filters.phone === "missing")
      q = q.or("phone.is.null,phone.eq.,phone.ilike.%deleted%");
    else if (filters.phone === "has")
      q = q.not("phone", "is", null).neq("phone", "").not("phone", "ilike", "%deleted%");
    if (filters.q) {
      const safe = filters.q.replaceAll(",", " ").replaceAll("(", "").replaceAll(")", "");
      q = q.or(`name.ilike.%${safe}%,ep_id.ilike.%${safe}%,phone.ilike.%${safe}%`);
    }
    const sortField =
      filters.sort && SIGNUP_SORTABLE.has(filters.sort) ? filters.sort : "signed_up_at";
    return q
      .order(sortField, { ascending: filters.dir === "asc", nullsFirst: false })
      .order("id");
  };

  let from = Math.max(0, page) * pageSize;
  let { data, count, error } = await build().range(from, from + pageSize - 1);
  if (error && from > 0) {
    ({ data, count, error } = await build().range(0, pageSize - 1));
    from = 0;
  }
  if (error) return { rows: [], total: 0, page: 0, view };
  const total = count ?? 0;
  // clamp past-the-end pages back to the last real page
  if ((data ?? []).length === 0 && total > 0 && from >= total) {
    const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    const res2 = await build().range(lastPage * pageSize, lastPage * pageSize + pageSize - 1);
    return { rows: (res2.data ?? []) as SignupRow[], total, page: lastPage, view };
  }
  return { rows: (data ?? []) as SignupRow[], total, page: Math.floor(from / pageSize), view };
}

export interface SignupDetail {
  signup: SignupRow;
  comments: SignupComment[];
  assignedLabel: string | null;
  canWork: boolean;
  canVp: boolean;
}

export async function getSignupDetail(
  viewer: Viewer,
  id: string
): Promise<SignupDetail | null> {
  const { data } = await db().from("signups").select("*").eq("id", id).maybeSingle<SignupRow>();
  if (!data || !_canViewSignup(viewer, data)) return null;
  const [{ data: comments }, assigned] = await Promise.all([
    db()
      .from("signup_comments")
      .select("*")
      .eq("signup_id", id)
      .order("created_at"),
    data.assigned_to
      ? db()
          .from("members")
          .select("name")
          .eq("id", data.assigned_to)
          .maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
  ]);
  const { canWorkSignup } = await import("@/lib/rbac");
  return {
    signup: data,
    comments: (comments ?? []) as SignupComment[],
    assignedLabel: assigned.data
      ? assigned.data.name
      : data.assigned_name,
    canWork: canWorkSignup(viewer, data),
    canVp: _canEditSignupVpFields(viewer, data),
  };
}

/** Members a leader can assign sign-ups to: TL → self + team; VP/Director/
 *  LCP/admin → every active member of the function. */
export async function signupReassignTargets(
  viewer: Viewer,
  fn: OgxFunction
): Promise<{ id: string; label: string }[]> {
  if (!_ogxFunctions(viewer).includes(fn)) return [];
  const { data } = await db()
    .from("members")
    .select("id, name, role, functions, sub_functions")
    .eq("is_active", true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (data ?? []) as any[];
  const inFn = (m: { functions?: string[]; sub_functions?: string[] }) =>
    [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes(fn);
  let pool = all.filter((m) => inFn(m) && m.role !== "LCP");
  if (viewer.role === "Team Leader")
    pool = pool.filter((m) => m.id === viewer.id || viewer.teamMemberIds.includes(m.id));
  else if (!viewer.isAdmin && !["LCP", "LCVP", "Director"].includes(viewer.role))
    pool = pool.filter((m) => m.id === viewer.id);
  return pool.map((m) => ({ id: m.id, label: m.name }));
}

export interface OgxPlanCard {
  /** first day of the current month (YYYY-MM-01) — the mm_plans key */
  month: string;
  plan: { applicants: number; accepted: number; approvals: number };
  /** the viewer's CURRENT pipeline: their live sign-ups bucketed by status
   *  (Applied → applicants; Accepted → applicants+accepted; Approved → all
   *  three; "Parents Approval" counts toward none) — an honest "where you
   *  stand now" next to the month's plan, not a this-month delta */
  actual: { applicants: number; accepted: number; approvals: number };
}

/** The /signups motivation card: an OGX MM's (TL/Coordinator of OGT/OGV)
 *  filed mm_plan for the CURRENT month vs their live sign-up pipeline.
 *  Null when the viewer isn't an OGX MM or has no plan row this month. */
export async function ogxPlanCard(viewer: Viewer): Promise<OgxPlanCard | null> {
  if (viewer.role !== "Team Leader" && viewer.role !== "Coordinator") return null;
  if (_ogxFunctions(viewer).length === 0) return null;
  const month = monthOf().start; // Cairo-derived YYYY-MM-01, like every period helper
  const { data: plan } = await db()
    .from("mm_plans")
    .select("applicants, accepted, approvals")
    .eq("member_id", viewer.id)
    .eq("month", month)
    .maybeSingle<{ applicants: number; accepted: number; approvals: number }>();
  if (!plan) return null;
  const { data: rows } = await db()
    .from("signups")
    .select("status")
    .eq("assigned_to", viewer.id)
    .eq("out_of_process", false)
    .in("status", ["Applied", "Accepted", "Approved"]);
  const actual = { applicants: 0, accepted: 0, approvals: 0 };
  for (const r of (rows ?? []) as { status: string | null }[]) {
    if (r.status === "Approved") {
      actual.applicants += 1;
      actual.accepted += 1;
      actual.approvals += 1;
    } else if (r.status === "Accepted") {
      actual.applicants += 1;
      actual.accepted += 1;
    } else if (r.status === "Applied") actual.applicants += 1;
  }
  return {
    month,
    plan: {
      applicants: plan.applicants ?? 0,
      accepted: plan.accepted ?? 0,
      approvals: plan.approvals ?? 0,
    },
    actual,
  };
}

// -------------------------------------------------- OGX dashboard (v28)

/** The OGX funnel — a status LADDER: Approved implies Accepted implies
 *  Applied (an approved sign-up counts in all three columns). */
export interface OgxFunnel {
  signups: number;
  contacted: number;
  interested: number;
  applied: number;
  accepted: number;
  /** the OGX MOS */
  approved: number;
}

export interface OgxBoardRow extends OgxFunnel {
  key: string;
  label: string;
}

export interface OgxDashboardFilters {
  /** signed_up_at range (YYYY-MM-DD) */
  from?: string;
  to?: string;
  /** a Team Leader's member id — their team's assigned sign-ups */
  team?: string;
  /** scopes the KPI TOTALS only (like the ICX "My numbers") */
  member?: string;
}

export interface OgxDashboardData {
  fn: OgxFunction;
  total: OgxFunnel;
  /** MEMBERS — ranked by Approvals, every funnel number per person */
  board: OgxBoardRow[];
  /** MMs (Team Leaders + Coordinators) — their own assigned sign-ups. A
   *  separate board because they are doing a different job, and ranking them
   *  against members flattered neither (v33.13). */
  mmBoard: OgxBoardRow[];
  /** per-TL-team drill (the assigned member's team) — [] when no teams exist */
  byTeam: OgxBoardRow[];
  /** the fn's filed mm_plans for the current month vs the LIVE pipeline
   *  (all-time standing, like the /signups MmPlanCard) — null when nobody
   *  filed a plan this month */
  plan: {
    monthLabel: string;
    plan: { applicants: number; accepted: number; approvals: number };
    actual: { applicants: number; accepted: number; approvals: number };
  } | null;
  /** lane-scoped filter options (OGX crews are invisible to the ICX pickers) */
  teamOptions: { id: string; label: string }[];
  memberOptions: { id: string; label: string }[];
}

const emptyOgxFunnel = (): OgxFunnel => ({
  signups: 0, contacted: 0, interested: 0, applied: 0, accepted: 0, approved: 0,
});

const _ogxYes = (v: string | null) => !!v && /^y/i.test(v.trim());

/** signed_up_at is free sheet TEXT ("2/9/2026", "2025-12-03", …) — normalize
 *  to YYYY-MM-DD for range filtering; unparseable → null (only matches when
 *  no date filter is active). M/D/YYYY, mirroring the importer's reader. */
export function signupDayIso(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(t);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function addOgxRow(
  s: OgxFunnel,
  r: { contact_status: string | null; interested: string | null; status: string | null }
) {
  s.signups += 1;
  if (_ogxYes(r.contact_status)) s.contacted += 1;
  if (_ogxYes(r.interested)) s.interested += 1;
  // the ladder: Approved ⊂ Accepted ⊂ Applied
  if (r.status === "Applied" || r.status === "Accepted" || r.status === "Approved")
    s.applied += 1;
  if (r.status === "Accepted" || r.status === "Approved") s.accepted += 1;
  if (r.status === "Approved") s.approved += 1;
}

interface OgxDashSignup {
  assigned_to: string | null;
  /** when it became someone's work — what the peak window is measured on */
  assigned_at: string | null;
  contact_status: string | null;
  interested: string | null;
  status: string | null;
  out_of_process: boolean;
  signed_up_at: string | null;
}

/** The OGT / OGV dashboard lane (v28). Aggregates are FUNCTION-wide for
 *  everyone in the fn (like the ICX lanes — the numbers are a shared
 *  trigger); rows themselves stay scoped on /signups. Date + team filters
 *  shape everything; the member filter scopes the KPI totals only. */
export async function ogxDashboard(
  viewer: Viewer,
  fn: OgxFunction,
  filters: OgxDashboardFilters = {}
): Promise<OgxDashboardData | null> {
  // the DASHBOARD is open to the LC-wide overseers too (v32) — `ogxLanes`,
  // not `ogxFunctions`, which still gates the sign-ups module itself
  if (!_ogxLanes(viewer).includes(fn)) return null;

  const [rows, memberRes] = await Promise.all([
    fetchAll<OgxDashSignup>(() =>
      db()
        .from("signups")
        .select(
          "assigned_to, assigned_at, contact_status, interested, status, out_of_process, signed_up_at"
        )
        .eq("fn", fn)
        .order("id")
    ),
    db()
      .from("members")
      .select("id, name, role, stakeholder_id, team_name, functions, sub_functions")
      .eq("is_active", true),
  ]);
  if (memberRes.error) throw new Error(memberRes.error.message);
  interface MemberLiteRow {
    id: string; name: string; role: string;
    stakeholder_id: string | null; team_name: string | null;
    functions: string[] | null; sub_functions: string[] | null;
  }
  const members = (memberRes.data ?? []) as MemberLiteRow[];
  const byId = new Map(members.map((m) => [m.id, m]));
  const inFn = (m: MemberLiteRow) =>
    [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes(fn);

  // the assigned member's Team Leader: themself, or their manager IF that
  // manager is a real Team Leader (the EB is never a team — raising rule)
  const tlOf = (memberId: string | null): MemberLiteRow | null => {
    if (!memberId) return null;
    const m = byId.get(memberId);
    if (!m) return null;
    if (m.role === "Team Leader") return m;
    const mgr = m.stakeholder_id ? byId.get(m.stakeholder_id) : undefined;
    return mgr?.role === "Team Leader" ? mgr : null;
  };

  const total = emptyOgxFunnel();
  const board = new Map<string, OgxBoardRow>();
  const mmBoard = new Map<string, OgxBoardRow>();
  const byTeam = new Map<string, OgxBoardRow>();
  const init = (map: Map<string, OgxBoardRow>, key: string, label: string) => {
    let g = map.get(key);
    if (!g) {
      g = { key, label, ...emptyOgxFunnel() };
      map.set(key, g);
    }
    return g;
  };

  // THE LANE IS THIS PEAK'S WORK (v33.13).
  //
  // Two things were inflating every number. UNASSIGNED sign-ups counted as
  // "Sign-ups", so the top of the funnel was the whole imported tracker —
  // thousands of rows nobody has been given — and every conversion under it
  // read as near zero. And rows carried over from previous peaks counted
  // alongside this one, so the lane never started from zero at a peak change.
  //
  // A sign-up enters this dashboard when it is ASSIGNED TO SOMEONE IN THIS
  // PEAK. That is the moment it became someone's work, and it is what the
  // funnel below it is measuring.
  const { peakForPlanning } = await import("@/lib/plan");
  const peakStart = peakForPlanning(new Date()).start ?? null;
  const registered = await registeredTeamNames();

  for (const r of rows) {
    if (r.out_of_process) continue; // archived sign-ups leave every KPI
    // NOBODY'S = not in the funnel. The pool is a to-do list, not progress.
    if (!r.assigned_to) continue;
    // this peak only — assigned_at is when it became work
    if (peakStart && !filters.from && !filters.to) {
      const day = (r.assigned_at ?? r.signed_up_at ?? "").slice(0, 10);
      if (day && day < peakStart) continue;
    }
    // an explicit date range overrides the peak default
    if (filters.from || filters.to) {
      const day = signupDayIso(r.assigned_at ?? r.signed_up_at);
      if (!day) continue;
      if (filters.from && day < filters.from) continue;
      if (filters.to && day > filters.to) continue;
    }
    const tl = tlOf(r.assigned_to);
    if (filters.team && tl?.id !== filters.team) continue;

    // KPI totals — the member filter ("My numbers") scopes these ONLY
    if (!filters.member || r.assigned_to === filters.member) addOgxRow(total, r);

    // TWO BOARDS (v33.13): members and MMs are doing different jobs and were
    // ranked against each other on one list, which flattered neither.
    const m = byId.get(r.assigned_to);
    if (m?.role === "Member") addOgxRow(init(board, m.id, m.name), r);
    else if (m && (m.role === "Team Leader" || m.role === "Coordinator"))
      addOgxRow(init(mmBoard, m.id, m.name), r);

    if (tl)
      addOgxRow(
        // the REGISTERED team out of the cell, never the whole comma-list
        init(byTeam, tl.id, teamLabelOf(tl.team_name, registered) ?? `${tl.name}'s team`),
        r
      );
  }

  const rank = (a: OgxBoardRow, b: OgxBoardRow) =>
    b.approved - a.approved ||
    b.accepted - a.accepted ||
    b.applied - a.applied ||
    b.contacted - a.contacted ||
    b.signups - a.signups;

  // ---- the fn's plan (mm_plans, current month) vs the LIVE pipeline -----
  const month = monthOf();
  const { data: planRows } = await db()
    .from("mm_plans")
    .select(
      "applicants, accepted, approvals, member:members!mm_plans_member_id_fkey(functions, sub_functions)"
    )
    .eq("month", month.start);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fnPlans = ((planRows ?? []) as any[]).filter((p) =>
    [...(p.member?.functions ?? []), ...(p.member?.sub_functions ?? [])].includes(fn)
  );
  let plan: OgxDashboardData["plan"] = null;
  if (fnPlans.length > 0) {
    const planned = fnPlans.reduce(
      (acc, p) => ({
        applicants: acc.applicants + (p.applicants ?? 0),
        accepted: acc.accepted + (p.accepted ?? 0),
        approvals: acc.approvals + (p.approvals ?? 0),
      }),
      { applicants: 0, accepted: 0, approvals: 0 }
    );
    // standing pipeline, fn-wide (live rows only — OOP left the process)
    const actual = { applicants: 0, accepted: 0, approvals: 0 };
    for (const r of rows) {
      if (r.out_of_process) continue;
      if (r.status === "Applied" || r.status === "Accepted" || r.status === "Approved")
        actual.applicants += 1;
      if (r.status === "Accepted" || r.status === "Approved") actual.accepted += 1;
      if (r.status === "Approved") actual.approvals += 1;
    }
    plan = { monthLabel: month.label, plan: planned, actual };
  }

  const fnMembers = members.filter((m) => inFn(m) && m.role !== "LCP");
  return {
    fn,
    total,
    board: [...board.values()].sort(rank),
    mmBoard: [...mmBoard.values()].sort(rank),
    byTeam: [...byTeam.values()].sort(rank),
    plan,
    teamOptions: fnMembers
      .filter((m) => m.role === "Team Leader")
      .map((m) => ({
        id: m.id,
        label: teamLabelOf(m.team_name, registered) ?? `${m.name}'s team`,
      })),
    memberOptions: fnMembers.map((m) => ({ id: m.id, label: m.name })),
  };
}

// ================================================================== consideration (v26)

import {
  hasConsiderationAccess as _hasConsiderationAccess,
  canSeeCvPool as _canSeeCvPool,
} from "@/lib/rbac";

export interface PartnerLc {
  id: string;
  name: string;
  country: string | null;
}

/** Partner LCs abroad (the IR-call & CV combobox). Any module member may add
 *  one inline; the list is shared. */
export async function listPartnerLcs(viewer: Viewer): Promise<PartnerLc[]> {
  if (!_hasConsiderationAccess(viewer)) return [];
  const { data } = await db()
    .from("partner_lcs")
    .select("id, name, country")
    .order("name");
  return (data ?? []) as PartnerLc[];
}

/** What the IR calls have taught us about each partner LC (v29): the people
 *  who booked from it, plus how much history it carries. Shown in the LC
 *  registry so a name isn't just a name. */
interface ManualLcContact {
  id: string;
  partner_lc_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

export interface PartnerLcDetail extends PartnerLc {
  calls: number;
  cvs: number;
  lastCallAt: string | null;
  contacts: {
    name: string | null;
    role: string | null;
    email: string | null;
    /** with its country code — the booking collects it (v33.6) */
    phone: string | null;
    /** set when a person was added BY HAND (v33.9) — only those can be removed */
    manualId?: string | null;
  }[];
}

export async function listPartnerLcDetails(viewer: Viewer): Promise<PartnerLcDetail[]> {
  if (!_hasConsiderationAccess(viewer)) return [];
  // Supabase caps one response at 1000 rows — page both whole-table reads on a
  // STABLE key (fetchAll re-runs the builder per page), then restore the
  // newest-first order the counts and the contacts loop rely on
  const [lcs, calls, cvRows, manual] = await Promise.all([
    listPartnerLcs(viewer),
    fetchAll<{
      partner_lc_id: string | null;
      called_at: string;
      booker_name: string | null;
      booker_role: string | null;
      booker_email: string | null;
      booker_phone: string | null;
      status: string;
    }>(() =>
      db()
        .from("ir_calls")
        .select("partner_lc_id, called_at, booker_name, booker_role, booker_email, booker_phone, status")
        .order("id")
    ),
    fetchAll<{ partner_lc_id: string | null }>(() =>
      db().from("cvs").select("partner_lc_id").order("id")
    ),
    // IRs added BY HAND (v33.9) — the ones who never booked a call themselves
    (async (): Promise<ManualLcContact[]> => {
      // pre-0041 grace: the table may not exist yet on a lagging database
      const { data } = await db()
        .from("partner_lc_contacts")
        .select("id, partner_lc_id, name, role, email, phone")
        .order("created_at");
      return (data ?? []) as ManualLcContact[];
    })().catch(() => [] as ManualLcContact[]),
  ]);
  const manualByLc = new Map<string, ManualLcContact[]>();
  for (const c of manual) {
    const list = manualByLc.get(c.partner_lc_id) ?? [];
    list.push(c);
    manualByLc.set(c.partner_lc_id, list);
  }
  calls.sort((a, b) => (a.called_at < b.called_at ? 1 : a.called_at > b.called_at ? -1 : 0));
  const cvCounts = new Map<string, number>();
  for (const c of cvRows) {
    if (c.partner_lc_id) cvCounts.set(c.partner_lc_id, (cvCounts.get(c.partner_lc_id) ?? 0) + 1);
  }
  return lcs.map((lc) => {
    const mine = calls.filter((c) => c.partner_lc_id === lc.id && c.status !== "cancelled");
    // one entry per person (most recent first), so the crew knows who to reach
    const seen = new Set<string>();
    const contacts: PartnerLcDetail["contacts"] = (manualByLc.get(lc.id) ?? []).map(
      (c) => ({ name: c.name, role: c.role, email: c.email, phone: c.phone, manualId: c.id })
    );
    const seenManual = new Set(
      contacts.map((c) => (c.email || c.name || "").toLowerCase()).filter(Boolean)
    );
    for (const k of seenManual) seen.add(k);
    for (const c of mine) {
      const key = (c.booker_email || c.booker_name || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      contacts.push({
        name: c.booker_name,
        role: c.booker_role,
        email: c.booker_email,
        phone: c.booker_phone,
      });
      if (contacts.length >= 5) break;
    }
    return {
      ...lc,
      calls: mine.length,
      cvs: cvCounts.get(lc.id) ?? 0,
      lastCallAt: mine[0]?.called_at ?? null,
      contacts,
    };
  });
}

export interface IrCallRow {
  id: string;
  partner_lc_id: string | null;
  partner_lc_name: string;
  called_at: string;
  notes: string | null;
  screenshot_drive_id: string | null;
  screenshot_name: string | null;
  screenshot_link: string | null;
  member_id: string | null;
  member_name: string;
  created_at: string;
  /** v27 booking: 'scheduled' rows come from /book/<slug>, in-call notes
   *  flip them to 'completed'; manual records are born 'completed'. */
  status: "scheduled" | "completed" | "cancelled";
  demand: string | null;
  b2c_campaigns: string | null;
  /** the partner LC's own CV pool, if they shared one (v33.6) */
  cv_pool_link: string | null;
  booker_name: string | null;
  booked_at: string | null;
  calendar_event_id: string | null;
  /** v28 booking parity (migration 0029) */
  booker_email: string | null;
  /** v32.6 — full international number, so the crew can WhatsApp the IR */
  booker_phone: string | null;
  meet_link: string | null;
  /** the raw token NEVER leaves the server — the UI only needs the flag */
  has_manage_link: boolean;
  cancel_reason: string | null;
  reschedule_requested_at: string | null;
  duration_minutes: number | null;
}

/** IR calls — one SHARED international-relations effort: every module member
 *  sees ALL calls. v27: SCHEDULED (booked) calls ride on top soonest-first;
 *  the completed/cancelled log stays paged 50, newest first. */
export async function listIrCalls(
  viewer: Viewer,
  page = 0,
  pageSize = 50,
  /** a DATE WINDOW instead of page 0 — the calendar needs the month it shows,
   *  not the 50 newest calls in the LC's whole history (v29) */
  range?: { fromIso: string; toIso: string }
): Promise<{ scheduled: IrCallRow[]; rows: IrCallRow[]; total: number; page: number }> {
  if (!_hasConsiderationAccess(viewer))
    return { scheduled: [], rows: [], total: 0, page: 0 };
  const from = Math.max(0, page) * pageSize;
  let schedQ = db()
    .from("ir_calls")
    .select("*")
    .eq("status", "scheduled")
    .order("called_at", { ascending: true })
    .order("id");
  let logQ = db()
    .from("ir_calls")
    .select("*", { count: "exact" })
    .neq("status", "scheduled")
    .order("called_at", { ascending: false })
    .order("id");
  if (range) {
    schedQ = schedQ.gte("called_at", range.fromIso).lte("called_at", range.toIso);
    logQ = logQ.gte("called_at", range.fromIso).lte("called_at", range.toIso);
  }
  const [sched, log] = await Promise.all([
    schedQ.limit(500),
    // a windowed read takes the WHOLE window (a month can't realistically
    // exceed 1000 calls); the paged log keeps its 50-row page
    range ? logQ.limit(1000) : logQ.range(from, from + pageSize - 1),
  ]);
  if (log.error) return { scheduled: [], rows: [], total: 0, page: 0 };
  // the manage token is an email-held capability for the IR — shipping it to
  // every crew member's browser would let anyone drive the public
  // reschedule/cancel endpoints on teammates' calls
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrub = (r: any): IrCallRow => {
    const { manage_token, ...rest } = r;
    return { ...rest, has_manage_link: !!manage_token } as IrCallRow;
  };
  return {
    scheduled: (sched.data ?? []).map(scrub),
    rows: (log.data ?? []).map(scrub),
    total: log.count ?? 0,
    page,
  };
}

export interface CvRow {
  id: string;
  partner_lc_id: string | null;
  partner_lc_name: string | null;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  person_name: string | null;
  phone: string | null;
  email: string | null;
  industry: string | null;
  skills: string | null;
  summary: string | null;
  extracted_text: string | null;
  extraction_status: "pending" | "done" | "failed" | "unsupported";
  uploaded_by: string | null;
  uploader_name: string;
  created_at: string;
  updated_at: string;
}

/** ilike-safe fragment for a PostgREST .or() chain. */
const _cvSafe = (s: string) =>
  s.replaceAll(",", " ").replaceAll("(", "").replaceAll(")", "").trim();

/** The consideration CV pool, searchable server-side (name / skills /
 *  extracted text / industry / file name / LC / summary). Paged 50. */
export async function listCvsPage(
  viewer: Viewer,
  filters: { q?: string; lc?: string },
  page = 0,
  pageSize = 50
): Promise<{ rows: CvRow[]; total: number; page: number }> {
  // v27: the CV pool is an IGT hunt — Consideration crew + IGT leaders only
  if (!_canSeeCvPool(viewer)) return { rows: [], total: 0, page: 0 };
  const build = () => {
    let q = db().from("cvs").select("*", { count: "exact" });
    if (filters.lc) q = q.eq("partner_lc_id", filters.lc);
    if (filters.q) {
      // every word must match at least one field (AND across .or() calls)
      const words = _cvSafe(filters.q).split(/\s+/).filter(Boolean).slice(0, 6);
      for (const w of words) {
        q = q.or(
          `person_name.ilike.%${w}%,skills.ilike.%${w}%,extracted_text.ilike.%${w}%,industry.ilike.%${w}%,file_name.ilike.%${w}%,partner_lc_name.ilike.%${w}%,summary.ilike.%${w}%`
        );
      }
    }
    return q.order("created_at", { ascending: false }).order("id");
  };
  const from = Math.max(0, page) * pageSize;
  const { data, count, error } = await build().range(from, from + pageSize - 1);
  if (error) return { rows: [], total: 0, page: 0 };
  return { rows: (data ?? []) as CvRow[], total: count ?? 0, page };
}

/** The Blue Man's CV search (v26): the query is split into words and EVERY
 *  word must match at least one of name / skills / industry / summary / full
 *  text. Up to 8 hits — RBAC-gated to the Consideration module. */
export async function searchCvs(
  viewer: Viewer,
  query: string
): Promise<
  | { error: string }
  | {
      matches: {
        name: string; lc: string | null; industry: string | null;
        phone: string | null; email: string | null; skills: string | null;
        summary: string | null; file: string;
      }[];
    }
> {
  if (!_canSeeCvPool(viewer))
    return { error: "The consideration CV pool is outside this user's access." };
  const words = _cvSafe(query)
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 6);
  if (words.length === 0) return { error: "query too short" };
  let q = db()
    .from("cvs")
    .select(
      "person_name, file_name, partner_lc_name, industry, phone, email, skills, summary"
    );
  for (const w of words) {
    q = q.or(
      `person_name.ilike.%${w}%,skills.ilike.%${w}%,industry.ilike.%${w}%,summary.ilike.%${w}%,extracted_text.ilike.%${w}%`
    );
  }
  const { data, error } = await q.order("created_at", { ascending: false }).limit(8);
  if (error) return { error: error.message };
  type CvHit = Pick<
    CvRow,
    | "person_name" | "file_name" | "partner_lc_name" | "industry"
    | "phone" | "email" | "skills" | "summary"
  >;
  return {
    matches: ((data ?? []) as CvHit[]).map((c) => ({
      name: c.person_name || c.file_name,
      lc: c.partner_lc_name ?? null,
      industry: c.industry ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
      skills: c.skills ?? null,
      summary: c.summary ?? null,
      file: c.file_name,
    })),
  };
}

// ---------------------------------------------------- IR-call booking (v27/v28)

export interface IrAvailabilityRow {
  /** 0 = Sunday … 6 = Saturday (Cairo time) — weekly repeat rows */
  day?: number;
  /** one-off Cairo date "YYYY-MM-DD" — replaces `day` (v28 "one date only") */
  date?: string;
  from: string; // "18:00"
  to: string; // "21:00"
}

export interface IrBookingSettings {
  member_id: string;
  slug: string;
  slot_minutes: number;
  availability: IrAvailabilityRow[];
  active: boolean;
  /** v28 Calendar-parity scheduling controls (migration 0029) */
  buffer_minutes: number;
  min_notice_minutes: number;
  max_advance_days: number;
  start_date: string | null;
  end_date: string | null;
  guests_can_invite: boolean;
}

/** every column freeBookingSlots/getBookingPage need — one place to keep the
 *  selects in sync with the interface */
const BOOKING_SETTINGS_COLS =
  "member_id, slug, slot_minutes, availability, active, buffer_minutes, min_notice_minutes, max_advance_days, start_date, end_date, guests_can_invite";

export interface MyIrBooking {
  settings: IrBookingSettings | null;
  suggestedSlug: string;
}

const SLUG_RE = /^[a-z0-9-]{3,40}$/;

/** The viewer's own booking-link settings + a slug suggestion. */
export async function myIrBooking(viewer: Viewer): Promise<MyIrBooking | null> {
  if (!_hasConsiderationAccess(viewer)) return null;
  const { data } = await db()
    .from("ir_booking_settings")
    .select(BOOKING_SETTINGS_COLS)
    .eq("member_id", viewer.id)
    .maybeSingle<IrBookingSettings>();
  let suggested = (viewer.name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (suggested.length < 3) suggested = `ir-${suggested || "call"}`.slice(0, 40);
  return {
    settings: data
      ? { ...data, availability: sanitizeAvailability(data.availability) }
      : null,
    suggestedSlug: data?.slug ?? suggested,
  };
}

/** Defensive read of the jsonb availability — malformed rows are dropped.
 *  v28: accepts BOTH shapes — weekly {day,from,to} and one-off {date,from,to}. */
export function sanitizeAvailability(raw: unknown): IrAvailabilityRow[] {
  if (!Array.isArray(raw)) return [];
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const out: IrAvailabilityRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const row = r as IrAvailabilityRow;
    if (!TIME_RE.test(String(row.from)) || !TIME_RE.test(String(row.to))) continue;
    if (
      typeof row.date === "string" &&
      DATE_RE.test(row.date) &&
      !Number.isNaN(new Date(`${row.date}T00:00:00Z`).getTime())
    ) {
      out.push({ date: row.date, from: row.from, to: row.to });
    } else if (Number.isInteger(row.day) && row.day! >= 0 && row.day! <= 6) {
      out.push({ day: row.day, from: row.from, to: row.to });
    }
  }
  return out;
}

export interface BookingSlot {
  /** UTC instant — the booking key */
  iso: string;
  /** Cairo wall-clock label, 12-hour ("6:00 PM") */
  label: string;
}

export interface BookingDay {
  date: string; // Cairo YYYY-MM-DD
  label: string; // "Sat, Aug 2"
  slots: BookingSlot[];
}

const _cairoYmd = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

const _slotLabel = (hh: number, mm: number): string => {
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
};

/** The FREE slots of the member's booking horizon (max_advance_days Cairo
 *  days): availability windows ÷ slot_minutes, minus already-booked scheduled
 *  calls (± overlap, padded by buffer_minutes on BOTH sides), minus times
 *  inside the minimum notice, clipped to the optional start/end dates. All
 *  Cairo wall-clock; each slot's key is its UTC instant. Shared by the public
 *  /book page, the manage page's reschedule picker (which excludes the call
 *  being moved) AND bookIrCall's re-validation. */
export async function freeBookingSlots(
  s: IrBookingSettings,
  opts?: { excludeCallId?: string }
): Promise<BookingDay[]> {
  const { cairoToUtc } = await import("@/lib/time");
  const availability = sanitizeAvailability(s.availability);
  if (availability.length === 0) return [];
  const slotMin = Math.min(120, Math.max(10, s.slot_minutes || 30));
  const slotMs = slotMin * 60_000;
  const bufferMs = Math.min(60, Math.max(0, s.buffer_minutes ?? 0)) * 60_000;
  const horizon = Math.min(90, Math.max(1, s.max_advance_days ?? 14));
  const now = Date.now();
  // minimum notice replaces the old hardcoded 10-min lead (10-min floor kept
  // so nobody can book a call that starts "right now")
  const noticeMin = Math.min(10_080, Math.max(0, s.min_notice_minutes ?? 60));
  const notBefore = now + Math.max(10, noticeMin) * 60_000;

  // every scheduled call blocks the span it was BOOKED with — an existing
  // 60-min call must still block fully after the member switches to 30-min
  let bookedQ = db()
    .from("ir_calls")
    .select("id, called_at, duration_minutes")
    .eq("member_id", s.member_id)
    .eq("status", "scheduled")
    .gte("called_at", new Date(now - 3 * 3_600_000).toISOString())
    .lte("called_at", new Date(now + (horizon + 1) * 86_400_000).toISOString());
  // the manage page's reschedule picker must not let the call block ITSELF
  if (opts?.excludeCallId) bookedQ = bookedQ.neq("id", opts.excludeCallId);
  const { data: bookedRows } = await bookedQ;
  const busy = (bookedRows ?? [])
    .map((r) => ({
      start: new Date(r.called_at as string).getTime(),
      ms: Math.max(10, Math.min(120, (r.duration_minutes as number) || slotMin)) * 60_000,
    }))
    .filter((b) => !Number.isNaN(b.start));

  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const days: BookingDay[] = [];
  // iterate CALENDAR days from today's Cairo date — stepping raw 24h epochs
  // would skip/duplicate a day across a DST transition
  const [y0, m0, d0] = _cairoYmd(new Date(now)).split("-").map(Number);
  for (let i = 0; i < horizon; i++) {
    const utcNoon = new Date(Date.UTC(y0, m0 - 1, d0 + i));
    const ymd = utcNoon.toISOString().slice(0, 10);
    // the schedule only runs inside the optional start/end date range
    if (s.start_date && ymd < s.start_date) continue;
    if (s.end_date && ymd > s.end_date) continue;
    const dow = utcNoon.getUTCDay();
    // weekly rows match the day-of-week; one-off rows match their exact day
    const windows = availability.filter((w) =>
      w.date ? w.date === ymd : w.day === dow
    );
    if (windows.length === 0) continue;
    const seen = new Set<string>();
    const slots: BookingSlot[] = [];
    for (const w of windows) {
      const from = toMin(w.from);
      const to = toMin(w.to);
      for (let m = from; m + slotMin <= to; m += slotMin) {
        const hh = Math.floor(m / 60);
        const mm = m % 60;
        const hhmm = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        const start = cairoToUtc(ymd, hhmm);
        const startMs = start.getTime();
        if (startMs < notBefore) continue;
        // buffer pads every existing call on BOTH sides — back-to-back slots
        // within the buffer of a booked call are excluded
        if (
          busy.some(
            (b) =>
              startMs < b.start + b.ms + bufferMs &&
              b.start - bufferMs < startMs + slotMs
          )
        )
          continue;
        const iso = start.toISOString();
        if (seen.has(iso)) continue;
        seen.add(iso);
        slots.push({ iso, label: _slotLabel(hh, mm) });
      }
    }
    if (slots.length === 0) continue;
    slots.sort((a, b) => a.iso.localeCompare(b.iso));
    days.push({
      date: ymd,
      label: utcNoon.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      slots,
    });
  }
  return days;
}

/** PUBLIC (no viewer): everything the /book/<slug> page renders. Returns null
 *  for unknown/inactive links (the page shows a branded "not active" card). */
export async function getBookingPage(slug: string): Promise<{
  memberName: string;
  slotMinutes: number;
  days: BookingDay[];
} | null> {
  const clean = (slug ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(clean)) return null;
  // the slug charset has no % or _ — ilike is a safe case-insensitive equal
  const { data: s } = await db()
    .from("ir_booking_settings")
    .select(BOOKING_SETTINGS_COLS)
    .ilike("slug", clean)
    .maybeSingle<IrBookingSettings>();
  if (!s || !s.active) return null;
  const { data: member } = await db()
    .from("members")
    .select("name, is_active")
    .eq("id", s.member_id)
    .maybeSingle<{ name: string; is_active: boolean }>();
  if (!member?.is_active) return null;
  return {
    memberName: member.name,
    slotMinutes: s.slot_minutes,
    days: await freeBookingSlots(s),
  };
}

/** "Sat, Aug 2 · 6:00 PM (Cairo time)" for a stored UTC instant — the one
 *  label format every booking surface (emails, manage page, bells) shares. */
export function cairoWhenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Africa/Cairo",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Cairo",
  });
  return `${date} · ${time} (Cairo time)`;
}

const MANAGE_TOKEN_RE = /^[0-9a-f-]{20,64}$/i;

/** Everything the PUBLIC /book/manage/<token> page renders: the booking's
 *  state + (while it's still scheduled) the member's CURRENT free slots for a
 *  reschedule — the call being moved doesn't block itself. Null for unknown
 *  tokens. */
export interface ManageBookingData {
  callId: string;
  memberName: string;
  partnerLc: string;
  status: "scheduled" | "completed" | "cancelled";
  whenLabel: string;
  durationMinutes: number;
  meetLink: string | null;
  cancelReason: string | null;
  /** the member asked to move this call — the manage page nudges a pick */
  rescheduleRequested: boolean;
  /** the member's live /book/<slug> page (for rebooking after a cancel) */
  bookingUrl: string | null;
  days: BookingDay[];
}

export async function getManageBooking(token: string): Promise<ManageBookingData | null> {
  const clean = (token ?? "").trim();
  if (!MANAGE_TOKEN_RE.test(clean)) return null;
  const { data: call } = await db()
    .from("ir_calls")
    .select(
      "id, member_id, member_name, partner_lc_name, called_at, status, duration_minutes, meet_link, cancel_reason, reschedule_requested_at"
    )
    .eq("manage_token", clean)
    .maybeSingle<{
      id: string;
      member_id: string | null;
      member_name: string;
      partner_lc_name: string;
      called_at: string;
      status: "scheduled" | "completed" | "cancelled";
      duration_minutes: number | null;
      meet_link: string | null;
      cancel_reason: string | null;
      reschedule_requested_at: string | null;
    }>();
  if (!call) return null;

  let settings: IrBookingSettings | null = null;
  let memberName = call.member_name;
  if (call.member_id) {
    const [{ data: s }, { data: member }] = await Promise.all([
      db()
        .from("ir_booking_settings")
        .select(BOOKING_SETTINGS_COLS)
        .eq("member_id", call.member_id)
        .maybeSingle<IrBookingSettings>(),
      db()
        .from("members")
        .select("name, is_active")
        .eq("id", call.member_id)
        .maybeSingle<{ name: string; is_active: boolean }>(),
    ]);
    if (member?.is_active) {
      memberName = member.name;
      settings = s ?? null;
    }
  }
  const linkLive = !!settings?.active;

  return {
    callId: call.id,
    memberName,
    partnerLc: call.partner_lc_name,
    status: call.status,
    whenLabel: cairoWhenLabel(call.called_at),
    durationMinutes: call.duration_minutes ?? settings?.slot_minutes ?? 30,
    meetLink: call.meet_link,
    cancelReason: call.cancel_reason,
    rescheduleRequested: !!call.reschedule_requested_at,
    bookingUrl: linkLive ? `${env.appUrl}/book/${settings!.slug}` : null,
    // excludeCallId frees THIS call's own slot so the grid isn't blocked by
    // itself — but the IR must never "move" to the time they already have,
    // so that exact slot is dropped from the offer (v29)
    days:
      call.status === "scheduled" && linkLive
        ? (await freeBookingSlots(settings!, { excludeCallId: call.id }))
            .map((d) => ({
              // PostgREST returns "…+00:00" while the grid mints "….000Z" —
              // compare INSTANTS or the exclusion silently never matches
              ...d,
              slots: d.slots.filter(
                (s) => new Date(s.iso).getTime() !== new Date(call.called_at).getTime()
              ),
            }))
            .filter((d) => d.slots.length > 0)
        : [],
  };
}

// ================================================================== OGV contact streaks (v27)

/** Cairo "today" as YYYY-MM-DD (mirrors src/lib/plan.ts's cairo() shift). */
export function cairoDayIso(d = new Date()): string {
  const c = new Date(d.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}-${String(
    c.getDate()
  ).padStart(2, "0")}`;
}

/** The Cairo day before `day` (pure YYYY-MM-DD math, UTC-anchored). */
const prevDayIso = (day: string): string =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

/** Length of the consecutive activity run ending exactly at `end`. */
export function streakEndingAt(days: ReadonlySet<string>, end: string): number {
  let n = 0;
  let cursor = end;
  while (days.has(cursor)) {
    n += 1;
    cursor = prevDayIso(cursor);
  }
  return n;
}

/** Classic streak rule: a run ending today — or, until today's save lands, a
 *  run ending YESTERDAY still counts as alive (tonight decides its fate). */
export function currentStreak(days: ReadonlySet<string>, today: string): number {
  const viaToday = streakEndingAt(days, today);
  return viaToday > 0 ? viaToday : streakEndingAt(days, prevDayIso(today));
}

/** The streak game's audience: a Team Leader / Coordinator / Member with OGV
 *  in functions OR sub_functions. (Activity is STAMPED for anyone working
 *  sign-ups — the UI and nags are OGV-only.) */
export function isOgvMm(m: {
  role: string;
  functions?: string[] | null;
  sub_functions?: string[] | null;
}): boolean {
  return (
    ["Team Leader", "Coordinator", "Member"].includes(m.role) &&
    [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes("OGV")
  );
}

export interface StreakStats {
  /** consecutive days ending today (or yesterday, until today's first contact) */
  current: number;
  /** longest run in the window (~last 400 days) */
  best: number;
  savedToday: boolean;
  /** how many sign-ups the viewer has contacted TODAY */
  todayCount: number;
  /** which OGX side the board is showing */
  scope: "OGX" | "OGT" | "OGV";
  /** the sides this viewer may filter to (>1 → show the chips) */
  scopes: ("OGX" | "OGT" | "OGV")[];
  /** top current streaks on the board, with today's contact count each */
  topStreaks: { name: string; current: number; today: number }[];
}

/** The OGX contact streak (v32.4).
 *
 *  DERIVED, NOT STAMPED. Until now a day was recorded by an activity stamp the
 *  moment you touched a sign-up, and nothing ever removed it — so contacting
 *  someone and immediately undoing it kept the flame alive. The streak is now
 *  computed from the LIVE data: a day counts when a sign-up ASSIGNED TO YOU is
 *  currently marked contacted with `contacted_at` on that Cairo day. Undo the
 *  contact and the day stops counting, because there is no longer any contact
 *  to count. It cannot be gamed, and it gives the daily count for free.
 *
 *  Audience is the whole OGX crew — both products, and leaders too: a VP who
 *  cannot see their function's board cannot push it. */
export async function streakStats(
  viewer: Viewer,
  scopeParam?: string
): Promise<StreakStats | null> {
  const fns = _ogxFunctions(viewer);
  if (fns.length === 0) return null;

  const scopes: ("OGX" | "OGT" | "OGV")[] =
    fns.length > 1 ? ["OGX", "OGT", "OGV"] : [fns[0] as "OGT" | "OGV"];
  const scope = (scopes as string[]).includes(scopeParam ?? "")
    ? (scopeParam as "OGX" | "OGT" | "OGV")
    : scopes[0];
  // "OGX" = both sides; otherwise just the one
  const wanted: OgxFunction[] = scope === "OGX" ? (fns as OgxFunction[]) : [scope as OgxFunction];

  const today = cairoDayIso();
  const cutoff = cairoDayIso(new Date(Date.now() - 400 * 86_400_000));

  let rows: { assigned_to: string | null; contacted_at: string; fn: string }[];
  let members: {
    id: string; name: string; role: string;
    functions: string[] | null; sub_functions: string[] | null; is_active: boolean;
  }[];
  try {
    // every CURRENTLY-contacted sign-up in the window — the streak's raw
    // material. `contact_status` is re-checked here, so an undone contact
    // simply isn't in the set.
    const [actRes, memRes] = await Promise.all([
      fetchAll<{ assigned_to: string | null; contacted_at: string; fn: string }>(() =>
        db()
          .from("signups")
          .select("assigned_to, contacted_at, fn")
          .in("fn", wanted)
          .eq("contact_status", "Yes")
          .not("contacted_at", "is", null)
          .not("assigned_to", "is", null)
          .gte("contacted_at", `${cutoff}T00:00:00`)
          .order("id")
      ),
      db()
        .from("members")
        .select("id, name, role, functions, sub_functions, is_active")
        .eq("is_active", true),
    ]);
    if (memRes.error) throw new Error(memRes.error.message);
    rows = actRes;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    members = (memRes.data ?? []) as any[];
  } catch (e) {
    // fail CLOSED — a transient error must hide the card, never render a
    // lying 0-day streak
    console.error("[streaks] stats fetch failed:", e);
    return null;
  }

  // member → the Cairo days they contacted on, and today's tally
  const byMember = new Map<string, { days: Set<string>; today: number }>();
  for (const r of rows) {
    if (!r.assigned_to) continue;
    const day = cairoDayIso(new Date(r.contacted_at));
    const e = byMember.get(r.assigned_to) ?? { days: new Set<string>(), today: 0 };
    e.days.add(day);
    if (day === today) e.today += 1;
    byMember.set(r.assigned_to, e);
  }

  const mine = byMember.get(viewer.id) ?? { days: new Set<string>(), today: 0 };
  const current = currentStreak(mine.days, today);

  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...mine.days].sort()) {
    run = prev !== null && prevDayIso(d) === prev ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }

  // the board: everyone on this side who is actually working sign-ups
  const inScope = (m: { functions?: string[] | null; sub_functions?: string[] | null }) => {
    const all = [...(m.functions ?? []), ...(m.sub_functions ?? [])];
    return wanted.some((f) => all.includes(f));
  };
  const topStreaks = members
    .filter(inScope)
    .map((m) => {
      const e = byMember.get(m.id);
      return {
        name: (m.name) as string,
        current: e ? currentStreak(e.days, today) : 0,
        today: e?.today ?? 0,
      };
    })
    .filter((e) => e.current > 0)
    .sort((a, b) => b.current - a.current || b.today - a.today || a.name.localeCompare(b.name))
    .slice(0, 5);

  return {
    current,
    best,
    savedToday: mine.days.has(today),
    todayCount: mine.today,
    scope,
    scopes,
    topStreaks,
  };
}

/** The viewer's NEXT working-hours touch point (v33).
 *
 *  "Call them again during working hours" is the most common next step in a
 *  raising team, and typing the date by hand means guessing when the session
 *  actually is. This returns the next one the viewer is expected at, so the
 *  next step can be set to it in one click — the account then resurfaces
 *  exactly when they're sitting down to work it. */
export async function nextWorkingHoursFor(
  viewer: Viewer
): Promise<{ id: string; startsAt: string; label: string } | null> {
  try {
    const { data } = await db()
      .from("touch_points")
      .select("id, starts_at, scope, kind, function_key, team_name")
      .eq("kind", "working_hours")
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(20);
    const rows = (data ?? []) as {
      id: string; starts_at: string; scope: string;
      function_key: string | null; team_name: string | null;
    }[];
    if (rows.length === 0) return null;
    const fns = [...(viewer.functions ?? []), ...(viewer.sub_functions ?? [])];
    // the soonest session this member actually belongs to
    const mine = rows.find(
      (r) =>
        r.scope === "lc" ||
        (r.scope === "function" && !!r.function_key && fns.includes(r.function_key)) ||
        (r.scope === "team" && !!r.team_name && (viewer.team_name ?? "").includes(r.team_name))
    );
    if (!mine) return null;
    return {
      id: mine.id,
      startsAt: mine.starts_at,
      label: mine.starts_at,
    };
  } catch (e) {
    console.error("[next-step] working-hours lookup failed:", e);
    return null;
  }
}
