import "server-only";
import { touchPointName } from "@/lib/touch-points";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { dashboardCacheKey } from "@/lib/dashboard-cache";
import { env } from "@/lib/env";
import {
  considerationFunctions,
  accountScope,
  allowedAccountFunctions as _allowedAccountFunctions,
  canSeeLcConcerns as _canSeeLcConcerns,
  canEditAccount,
  canEditRequestState,
  canFilterUnassigned,
  canReassignAccount,
  canSeeUnassigned,
  canSeeUnownedPool as _canSeeUnownedPool,
  canUseAdminTools,
  canViewAccount,
  hasRaisingAccess,
  hasTmAccess,
  icxFunctions,
  isB2B,
  isB2C,
  fnSetting as _fnSetting,
  master as _master,
  openViewFunctions as _openViewFunctions,
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
  IrProduct,
  Member,
  MemberRole,
  Stage,
} from "@/lib/types";
import {
  parsePhoneSessionKey, normalizeName, accountSlug, fmtClock12,
  slugLikePattern } from "@/lib/types";
import { teamLabel } from "@/lib/types";
import { cairoToUtc } from "@/lib/time";
import { monthOf, sprintOf } from "@/lib/plan";
import {
  addRowLane, allTimeWork, didAnything, emptyStats, laneAllocSlots, laneWorkSlots,
  noWork, rowInLane, type FunnelStats, type RowWork } from "@/lib/dashboard-funnel";

export interface PipelineRow extends AccountPipeline {
  responsible_role: MemberRole;
  responsible_team_name: string | null;
  /** the account's own birth as a History entry (v31) — only `getAccount`
   *  fills it; list reads leave it undefined (one row = one extra query). */
  creation?: AccountCreationEntry;
  /** per-row capability flags for the list's INLINE edits (v33.17) — only
   *  `listAccountsPage` fills them (the server re-checks on every mutation
   *  anyway); other producers leave them undefined. */
  can_edit?: boolean;
  can_reassign?: boolean;
  can_request_state?: boolean;
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
  const rows = (data ?? []) as unknown as {
    email: string | null;
    phone: string | null;
    is_active?: boolean;
  }[];
  const exact = rows.filter(
    (m) => (m.phone ?? "").replace(/\D/g, "") === phoneDigits
  );
  // ACTIVE rows first: a deactivated duplicate (an import hiccup) must never
  // shadow the member's live row and strand their session on /inactive
  return (exact.find((m) => !m.email && m.is_active !== false) ??
    exact.find((m) => m.is_active !== false) ??
    exact.find((m) => !m.email) ??
    exact[0] ??
    null) as Record<string, unknown> | null;
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

/** WHICH FLOORS THIS PERSON MAY READ IN FULL (v33.32).
 *
 *  A function's leader can open their function to a role from the Function
 *  defaults card. Resolved here, once, so `accountScope` and every `can*`
 *  predicate stay synchronous and pure — they read the answer off the Viewer
 *  instead of hitting the database mid-check.
 *
 *  Leaders are skipped: they already read their whole function. */
async function viewerFunctionSettings(m: {
  role: string;
  functions: string[] | null;
  sub_functions: string[] | null;
}): Promise<{
  openViewFns: string[];
  fnSettings: Record<string, import("@/lib/function-settings").FunctionSettings>;
}> {
  const none = { openViewFns: [], fnSettings: {} };
  try {
    const [{ allFunctionSettings }, { opensViewTo, SETTABLE_FUNCTIONS }] = await Promise.all([
      import("./function-settings"),
      import("@/lib/function-settings"),
    ]);
    const all = await allFunctionSettings();
    const mine = new Set([...(m.functions ?? []), ...(m.sub_functions ?? [])]);
    // B2B and BD are one crew with two labels, as everywhere else
    if (mine.has("B2B") || mine.has("BD")) { mine.add("B2B"); mine.add("BD"); }
    const openViewFns = ["Member", "Coordinator", "Team Leader"].includes(m.role)
      ? SETTABLE_FUNCTIONS.filter(
          (fn) => mine.has(fn) && all[fn] && opensViewTo(all[fn], m.role)
        )
      : [];
    return { openViewFns, fnSettings: all };
  } catch {
    // the settings table is an ADDITION — if it can't be read, everyone keeps
    // exactly the behaviour they had before 0054
    return none;
  }
}

async function getViewerById(id: string): Promise<Viewer | null> {
  const { data: member } = await db()
    .from("members")
    .select("*")
    .eq("id", id)
    .maybeSingle<Member>();
  if (!member || !member.is_active) return null;
  const [{ data: team }, fnConf] = await Promise.all([
    db()
      .from("members")
      .select("id")
      .eq("stakeholder_id", member.id)
      .eq("is_active", true),
    viewerFunctionSettings(member),
  ]);
  return {
    ...member,
    functions: member.functions ?? [],
    sub_functions: member.sub_functions ?? [],
    isAdmin: env.adminEmails.includes((member.email ?? "").toLowerCase()),
    teamMemberIds: (team ?? []).map((t) => t.id),
    openViewFns: fnConf.openViewFns,
    fnSettings: fnConf.fnSettings,
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
  const [{ data: team }, fnConf] = await Promise.all([
    db()
      .from("members")
      .select("id")
      .eq("stakeholder_id", member.id)
      .eq("is_active", true),
    viewerFunctionSettings(member),
  ]);
  return {
    ...member,
    functions: member.functions ?? [],
    sub_functions: member.sub_functions ?? [],
    isAdmin: env.adminEmails.includes((member.email ?? "").toLowerCase()),
    teamMemberIds: (team ?? []).map((t) => t.id),
    openViewFns: fnConf.openViewFns,
    fnSettings: fnConf.fnSettings,
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
  /** REAL NUMBERS FOR THE LANE (v33.29 part 2) — the panel was three cards
   *  and a link; the floor asked for a dashboard. */
  /** null = last month is BEFORE this peak started, so there is nothing to
   *  compare against — the consideration floor does not carry work across a
   *  peak boundary (v33.32.2) */
  irLastMonth: number | null;
  /** the peak this snapshot lives in ("Winter 26.2"), for the trend strip */
  peakLabel: string;
  irCompleted: number;
  irCancelled: number;
  /** completed ÷ (completed + cancelled), % — how many booked calls survive */
  completionRate: number | null;
  /** partner LCs whose FIRST-EVER call happened this month — new ground */
  newLcsThisMonth: number;
  /** BOOKED, THE TIME PASSED, STILL NOT REPORTED (v33.32). A scheduled call
   *  whose slot is behind us is not "upcoming" and not "completed" — it is
   *  someone's unfinished business, and until now it was invisible. */
  irOverdue: number;
  /** per-member drill, ranked by total calls. The columns are DISJOINT by
   *  design (done + upcoming + overdue = total) — the old table showed
   *  month/upcoming/total, which read as arithmetic that didn't add up. */
  byMember: {
    name: string;
    total: number;
    month: number;
    done: number;
    upcoming: number;
    overdue: number;
    /** distinct partner LCs this person has actually spoken to (v33.52) */
    lcs: number;
    /** 🤝 partnerships they MADE in this lane */
    partnerships: number;
    /** CVs they put in the pool — IGT only, 0 on the IGV lane */
    cvs: number;
  }[];
  /** the last 6 months' call volume, oldest first — the trend strip */
  byMonth: { month: string; label: string; calls: number }[];
  /** what the filter bar actually narrowed this snapshot to (v33.32) — the
   *  panel says so out loud, so nobody reads a filtered number as the lane's */
  filtered: boolean;
  /** 🤝 NEW PARTNERSHIPS (v33.38) — approached a new LC and opened the group.
   *  Counted per the partnership's OWN product tag, so an LC that is a GT
   *  partnership counts here only on the GT lane. */
  partnerships: {
    total: number;
    thisMonth: number;
    /** targets assigned and still waiting to be made */
    pending: number;
    byMember: { name: string; total: number; month: number }[];
  };
}

/** The dashboard filter bar, applied to a consideration lane (v33.32). Every
 *  other lane honoured Added→ / team / member and this one silently ignored
 *  all three. `from`/`to` are Cairo DAYS matched against the call's own time. */
export interface ConsiderationFilters {
  from?: string;
  to?: string;
  /** a member id — their own calls (and, for CVs, their own uploads) */
  member?: string;
  /** a Team Leader's id — their team's calls */
  team?: string;
}

/** An MM PLAN carries no product column — the crew plans the whole ICX in one
 *  row. So a plan is attributed to a lane through its OWNER's functions: an
 *  IGT member's plan feeds the IGT lane, an IGV member's the IGV lane. Someone
 *  with NEITHER on their row (the pure Consideration crew) plans for both, so
 *  their rows count in BOTH lanes — as do orphaned rows whose owner left.
 *
 *  IR CALLS NO LONGER USE THIS (v33.23): since 0048 a call carries its own
 *  `product`, decided when it was booked. */
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
  fn: "IGV" | "IGT",
  filters: ConsiderationFilters = {}
): Promise<ConsiderationStats | null> {
  if (!considerationFunctions(viewer).includes(fn)) return null;
  const showCvs = fn === "IGT" && _canSeeCvPool(viewer);
  const monthStart = monthOf().start;
  const [callRowsAll, cvRowsAll, plans, memberRows, partnershipRowsAll] = await Promise.all([
    fetchAll<{
      called_at: string;
      status: string;
      partner_lc_name: string;
      member_id: string | null;
      member_name: string;
      product: string | null;
    }>(() =>
      db()
        .from("ir_calls")
        .select("called_at, status, partner_lc_name, member_id, member_name, product")
        .order("id")
    ),
    // the CV pool is IGT-only (v27) — never even read for the IGV lane
    showCvs
      ? fetchAll<{ created_at: string; industry: string | null; uploaded_by: string | null }>(
          () => db().from("cvs").select("created_at, industry, uploaded_by").order("id")
        )
      : Promise.resolve(
          [] as { created_at: string; industry: string | null; uploaded_by: string | null }[]
        ),
    db()
      .from("mm_plans")
      .select("applicants, accepted, approvals, month, member:members!mm_plans_member_id_fkey(functions, sub_functions)")
      .eq("month", monthStart),
    db().from("members").select("id, role, stakeholder_id, functions, sub_functions"),
    // 🤝 partnerships (v33.38) — small table; pre-0059 grace: fail to empty
    (async () => {
      const { data } = await db()
        .from("lc_partnerships")
        .select(
          "product, status, partnership_date, made_by, assigned_to, " +
            "maker:members!lc_partnerships_made_by_fkey(name)"
        )
        .limit(5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[];
    })().catch(() => []),
  ]);
  const now = new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byMember = new Map<string, any>(((memberRows.data ?? []) as any[]).map((m) => [m.id, m]));
  // THE CALL'S OWN TAG DECIDES ITS LANE (v33.23). It used to be re-derived
  // from the owner's current functions, which counted a dual-function host's
  // calls in BOTH lanes. An untagged call still counts in both — that is what
  // "we don't know which" honestly means.
  const laneTag = fn === "IGT" ? "GT" : "GV";

  // THE FILTER BAR REACHES THIS LANE NOW (v33.32). A Cairo DAY window, since
  // that is what the two date inputs mean everywhere else in the app; the
  // member and team picks are matched on the call's OWNER.
  const { cairoToUtc } = await import("@/lib/time");
  const fromIso = filters.from ? cairoToUtc(filters.from, "00:00").toISOString() : null;
  const toIso = filters.to
    ? new Date(cairoToUtc(filters.to, "00:00").getTime() + 24 * 60 * 60_000).toISOString()
    : null;
  /** a member's Team Leader: themself, or their manager if that manager is one
   *  (the EB is never a team — the same rule as every other drill) */
  const tlIdOf = (memberId: string | null): string | null => {
    if (!memberId) return null;
    const m = byMember.get(memberId);
    if (!m) return null;
    if (m.role === "Team Leader") return m.id as string;
    const mgr = m.stakeholder_id ? byMember.get(m.stakeholder_id) : undefined;
    return mgr?.role === "Team Leader" ? (mgr.id as string) : null;
  };
  const inWindow = (iso: string | null) =>
    !!iso && (!fromIso || iso >= fromIso) && (!toIso || iso < toIso);
  const filtered = !!(filters.from || filters.to || filters.member || filters.team);

  const callRows = callRowsAll.filter(
    (c) =>
      (c.product === laneTag || c.product == null) &&
      (!fromIso && !toIso ? true : inWindow(c.called_at)) &&
      (!filters.member || c.member_id === filters.member) &&
      (!filters.team || tlIdOf(c.member_id) === filters.team)
  );
  const cvRows = cvRowsAll.filter(
    (c) =>
      (!fromIso && !toIso ? true : inWindow(c.created_at)) &&
      (!filters.member || c.uploaded_by === filters.member) &&
      (!filters.team || tlIdOf(c.uploaded_by) === filters.team)
  );
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
  // v33.29: the deeper cuts the floor asked for
  const live = callRows.filter((c) => c.status !== "cancelled");
  const lastStart = new Date(`${monthStart}T00:00:00Z`);
  lastStart.setUTCMonth(lastStart.getUTCMonth() - 1);
  const lastMonthKey = lastStart.toISOString().slice(0, 7);
  const completed = callRows.filter((c) => c.status === "completed").length;
  const cancelled = callRows.filter((c) => c.status === "cancelled").length;
  // an LC is NEW this month when its first-ever call falls in it
  const firstCall = new Map<string, string>();
  for (const c of live) {
    const key = c.partner_lc_name.toLowerCase();
    const prev = firstCall.get(key);
    if (!prev || c.called_at < prev) firstCall.set(key, c.called_at);
  }
  const newLcsThisMonth = [...firstCall.values()].filter((d) => inMonth(d)).length;
  /** a booked call whose slot has passed and that nobody has reported on */
  const isOverdue = (c: { status: string; called_at: string }) =>
    c.status === "scheduled" && new Date(c.called_at) < now;
  const isUpcoming = (c: { status: string; called_at: string }) =>
    c.status === "scheduled" && new Date(c.called_at) >= now;
  // per-member drill from the calls' own name snapshots (renames cascade).
  // THE COLUMNS ARE DISJOINT (v33.32): every live call is exactly one of
  // done / upcoming / overdue, so those three add up to the total and the
  // table can be read as arithmetic. "This month" sits apart — it is a slice
  // of the same calls, not a fourth bucket, and the header says so.
  // THE CONSIDERATION LEADERBOARD (v33.52). The floor had a calls drill and no
  // RANKING — every other lane in Sodio ranks its people on their own KPIs, and
  // the IR crew's KPIs are calls, the LCs they reach, the partnerships they
  // make and (on IGT) the CVs they bring in. Same row, more columns.
  const perMember = new Map<
    string,
    {
      name: string; total: number; month: number; done: number; upcoming: number;
      overdue: number; lcs: number; partnerships: number; cvs: number;
    }
  >();
  const lcsByMember = new Map<string, Set<string>>();
  const blank = (name: string) => ({
    name, total: 0, month: 0, done: 0, upcoming: 0, overdue: 0,
    lcs: 0, partnerships: 0, cvs: 0,
  });
  for (const c of live) {
    const key = c.member_name || "—";
    const row = perMember.get(key) ?? blank(key);
    row.total += 1;
    if (inMonth(c.called_at)) row.month += 1;
    if (c.status === "completed") row.done += 1;
    else if (isUpcoming(c)) row.upcoming += 1;
    else if (isOverdue(c)) row.overdue += 1;
    perMember.set(key, row);
    // an LC counts ONCE per person however many times they called it
    const seen = lcsByMember.get(key) ?? new Set<string>();
    seen.add(c.partner_lc_name.toLowerCase());
    lcsByMember.set(key, seen);
  }
  for (const [key, seen] of lcsByMember) {
    const row = perMember.get(key);
    if (row) row.lcs = seen.size;
  }
  // CVs are the IGT hunt: `cvRows` is already lane-scoped (empty on IGV)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const cv of cvRows as any[]) {
    const key = cv.uploaded_by || "";
    if (!key) continue;
    const row = perMember.get(key) ?? blank(key);
    row.cvs += 1;
    perMember.set(key, row);
  }
  // THE TREND STRIP IS THE PEAK, NOT THE LAST SIX MONTHS (v33.32.2).
  //
  // A rolling six-month window reached back BEFORE the peak began — the
  // winter peak starts in August, so July and June sat on the strip carrying
  // the previous term's calls. That is not this floor's work and reading it
  // beside this month's invites a comparison nobody should make. The strip
  // now runs from the peak's first month to the current one; a peak that has
  // only just started shows one bar, honestly.
  const { peakForPlanning } = await import("@/lib/plan");
  const peak = peakForPlanning(now);
  const peakFirstKey = (peak.months[0] ?? monthStart).slice(0, 7);
  const monthKeys: string[] = [];
  {
    const cur = new Date(`${peakFirstKey}-01T00:00:00Z`);
    const thisKey = monthStart.slice(0, 7);
    // guard against a clock/peak mismatch: never build an unbounded list
    for (let i = 0; i < 12; i++) {
      const key = cur.toISOString().slice(0, 7);
      monthKeys.push(key);
      if (key >= thisKey) break;
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }
  // 🤝 PARTNERSHIPS IN THE LANE (v33.38). The row's own product decides the
  // lane (the 0048 lesson — never re-derive from the owner's functions). The
  // filter bar reaches them like everything else: member/team on the MAKER
  // (pending targets follow the assignee), dates on the partnership's own day.
  const monthDay = monthStart.slice(0, 10);
  const inDayWindow = (day: string | null) =>
    !!day && (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to);
  const partnershipRows = partnershipRowsAll.filter((r) => {
    if (r.product !== laneTag) return false;
    const owner = r.status === "done" ? r.made_by : r.assigned_to;
    if (filters.member && owner !== filters.member) return false;
    if (filters.team && tlIdOf(owner) !== filters.team) return false;
    if ((filters.from || filters.to) && r.status === "done")
      return inDayWindow(r.partnership_date);
    return true;
  });
  const madeRows = partnershipRows.filter((r) => r.status === "done");
  const perPartnerMember = new Map<string, { name: string; total: number; month: number }>();
  for (const r of madeRows) {
    const key = r.maker?.name || "—";
    const row = perPartnerMember.get(key) ?? { name: key, total: 0, month: 0 };
    row.total += 1;
    if ((r.partnership_date ?? "") >= monthDay) row.month += 1;
    perPartnerMember.set(key, row);
    // the same person's row on the leaderboard (v33.52) — a partnership is a
    // consideration KPI, not a separate scoreboard
    const board = perMember.get(key) ?? blank(key);
    board.partnerships += 1;
    perMember.set(key, board);
  }
  const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const byMonth = monthKeys.map((key) => ({
    month: key,
    label: `${MONTH_SHORT[Number(key.slice(5, 7)) - 1]}`,
    calls: live.filter((c) => c.called_at.slice(0, 7) === key).length,
  }));
  return {
    fn,
    showCvs,
    irTotal: live.length,
    irThisMonth: live.filter((c) => inMonth(c.called_at)).length,
    irUpcoming: live.filter(isUpcoming).length,
    partnerLcsContacted: new Set(live.map((c) => c.partner_lc_name.toLowerCase())).size,
    cvTotal: cvRows.length,
    cvThisMonth: cvRows.filter((c) => inMonth(c.created_at)).length,
    cvByIndustry: [...industries.entries()]
      .map(([industry, count]) => ({ industry, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    plan,
    // a month before the peak is not a comparison — it is another term
    irLastMonth:
      lastMonthKey < peakFirstKey
        ? null
        : live.filter((c) => c.called_at.slice(0, 7) === lastMonthKey).length,
    peakLabel: peak.label,
    irCompleted: completed,
    irCancelled: cancelled,
    completionRate:
      completed + cancelled > 0
        ? Math.round((completed / (completed + cancelled)) * 100)
        : null,
    newLcsThisMonth,
    irOverdue: live.filter(isOverdue).length,
    byMember: [...perMember.values()].sort(
      (a, b) =>
        b.done - a.done || b.total - a.total || b.partnerships - a.partnerships ||
        b.lcs - a.lcs || b.cvs - a.cvs
    ),
    byMonth,
    filtered,
    partnerships: {
      total: madeRows.length,
      thisMonth: madeRows.filter((r) => (r.partnership_date ?? "") >= monthDay).length,
      pending: partnershipRows.filter((r) => r.status === "pending").length,
      byMember: [...perPartnerMember.values()]
        .sort((a, b) => b.total - a.total || b.month - a.month)
        .slice(0, 15),
    },
  };
}

/** VISITS THAT HAPPENED AND WERE NEVER REPORTED (v33.35).
 *
 *  The +2h prompt and the one-week nag have chased these by EMAIL since v11,
 *  which works right up until someone stops reading email. In the app they
 *  were invisible: an account sat at "Visit Scheduled" forever and the funnel
 *  counted a visit that, as far as anyone can prove, never happened.
 *
 *  Same shape as the IR-calls banner (v33.32) and the same hierarchy: a member
 *  answers for their own, a Team Leader for their team's, a VP/Director for
 *  their function's, the LCP for the LC. Nobody with a clean slate sees
 *  anything at all — a warning everyone sees is wallpaper.
 */
export interface UnreportedVisit {
  id: string;
  accountId: string;
  accountName: string;
  accountSlug: string;
  fn: string;
  /** Cairo, already formatted */
  whenLabel: string;
  /** how long ago it was, in days */
  daysAgo: number;
  memberId: string | null;
  memberName: string;
}

export async function unreportedVisits(viewer: Viewer): Promise<UnreportedVisit[]> {
  if (!hasRaisingAccess(viewer)) return [];
  const scope = accountScope(viewer);
  // only the last two months: a visit nobody reported in April is not a
  // to-do any more, it is history, and a banner that never empties is noise
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  let q = db()
    .from("visits")
    .select(
      "id, account_id, member_id, visit_date, visit_time, " +
        "account:accounts!visits_account_id_fkey(name, function, out_of_process, is_test), " +
        "member:members!visits_member_id_fkey(name)"
    )
    // A PENDING VISIT IS `done IS NULL`, NOT `done = false` (v33.36.2).
    // The column is nullable and nothing ever writes false — reporting a
    // visit sets it TRUE. The first cut of this banner filtered on `false`,
    // so it matched zero rows and silently never appeared, while thirteen
    // real visits sat unreported. Every other reader in the system (the
    // +2h prompt, the week-later nag, the account page) uses `is null`.
    .is("done", null)
    .gte("visit_date", since)
    .order("visit_date", { ascending: false })
    .limit(200);
  // the hierarchy, applied to the VISIT's owner (who owes the report)
  if (scope.kind === "members") q = q.in("member_id", scope.ids);
  const { data, error } = await q;
  if (error) {
    console.error("[visits] unreported query failed:", error.message);
    return [];
  }
  const out: UnreportedVisit[] = [];
  const now = new Date(nowIso).getTime();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of (data ?? []) as any[]) {
    const acc = Array.isArray(v.account) ? v.account[0] : v.account;
    if (!acc || acc.out_of_process) continue;
    if (acc.is_test && !viewer.testMode) continue;
    // a leader's scope is functional — match the ACCOUNT's function
    if (scope.kind === "functions" && !scope.fns.includes(acc.function)) continue;
    const when = cairoToUtcVisit(v.visit_date, v.visit_time);
    if (when.getTime() >= now) continue; // still ahead of us
    const member = Array.isArray(v.member) ? v.member[0] : v.member;
    out.push({
      id: v.id,
      accountId: v.account_id,
      accountName: acc.name,
      accountSlug: accountSlug(acc.name),
      fn: acc.function,
      whenLabel: `${v.visit_date}${v.visit_time ? ` · ${fmtClock12(v.visit_time)}` : ""}`,
      daysAgo: Math.max(0, Math.floor((now - when.getTime()) / 86_400_000)),
      memberId: v.member_id,
      memberName: member?.name ?? "Unassigned",
    });
  }
  return out;
}

/** A visit's Cairo wall-clock as an instant. Date-only visits are judged from
 *  the END of their day — "Tuesday" isn't late until Tuesday is over. */
function cairoToUtcVisit(date: string, time: string | null): Date {
  return time ? cairoToUtc(date, time.slice(0, 5)) : cairoToUtc(date, "23:59");
}

// ------------------------------------------------------------------ scope helpers

/** THE UNOWNED POOL, AS A QUERY FRAGMENT (v36).
 *
 *  Since 0073 a name nobody has taken carries NO FUNCTION — it belongs to no
 *  crew until somebody claims it, and claiming is what stamps a function on
 *  it. That is honest, and it is also why it needed saying out loud here:
 *  EVERY scope branch below filters by function, so without an explicit
 *  disjunct a function-less row would be visible to precisely nobody. The
 *  229-row research pool would have vanished from the app the hour the
 *  migration ran, with no error anywhere to say why. */
const UNOWNED_POOL_CLAUSE = "and(responsible_id.is.null,function.is.null)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyScope<T extends { eq: any; in: any; or?: any }>(
  query: T,
  scope: AccountScope,
  /** functions whose UNASSIGNED accounts this viewer may also see (v32.4) —
   *  nobody owns them, so anyone who may work that function can take one.
   *  Still needed after 0073: an unowned row that a hand-over left carrying a
   *  function, and every archived one, keeps its label. */
  claimableFns: AccountFunction[] = [],
  /** functions this viewer may READ IN FULL because their leader opened them
   *  to this role (v33.32) — read-only: editing is still per-row scoped */
  openFns: AccountFunction[] = [],
  /** `canSeeUnownedPool(viewer)` — may this viewer also see the FUNCTION-LESS
   *  research pool? MMs and the IGV/IGT/B2B/BD leaders can; a plain Member
   *  and the B2C crew cannot (v36, ask #9). */
  unownedPool = false
): T {
  if (scope.kind === "functions") {
    // A LEADER'S SCOPE IS A LIST OF FUNCTIONS, AND THE POOL MATCHES NONE OF
    // THEM. Without this the people whose whole job is DISTRIBUTING the pool
    // — every VP and Director of IGV/IGT/B2B/BD — would be the only ones who
    // could not see it.
    if (unownedPool && query.or)
      return query.or(
        [`function.in.(${scope.fns.map((f) => `"${f}"`).join(",")})`, UNOWNED_POOL_CLAUSE].join(",")
      );
    return query.in("function", scope.fns);
  }
  if (scope.kind === "members") {
    const ids = scope.ids.map((i) => `"${i}"`).join(",");
    const clauses = [`responsible_id.in.(${ids})`];
    if (claimableFns.length > 0) {
      const fns = claimableFns.map((f) => `"${f}"`).join(",");
      clauses.push(`and(responsible_id.is.null,function.in.(${fns}))`);
    }
    if (unownedPool) clauses.push(UNOWNED_POOL_CLAUSE);
    if (openFns.length > 0) {
      const fns = openFns.map((f) => `"${f}"`).join(",");
      clauses.push(`function.in.(${fns})`);
    }
    if (clauses.length > 1 && query.or) return query.or(clauses.join(","));
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
  /** THE PRODUCT COLUMN'S OWN FILTER (v34.1). That column renders
   *  productBadge(function, product) — IGV · IGTa · IGTe · IGT · B2B · BD ·
   *  B2C — which spans TWO db fields, so it cannot be expressed as `fn` or
   *  `product` alone. A csv of those badge values, OR'd: picking IGV and IGTa
   *  means "show me either", which is what a multi-select promises. `fn`
   *  stays single-valued for the bar control and for inbound links. */
  lane?: string;
  /** IGT sub-product (Other, Teaching…) — loose text match */
  subProduct?: string;
  stage?: Stage;
  responsibleId?: string;
  /** filter by the account's LAST contact result (No Response, Interested…) */
  lastStatus?: string;
  /** v33.38 — the columns that had no funnel */
  industry?: string;
  accountType?: string;
  /** "sent" | "not_sent" (csv — both picked = no filter) */
  proposal?: string;
  /** "has" | "none" — accounts with at least one recorded deal */
  deals?: string;
  /** Podio: requested | not_requested | Checking | Approved | Rejected (OR'd) */
  podio?: string;
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
  /** INTERNAL (v33.49) — a fixed id list. Only the dashboard's delta refresh
   *  uses it, to re-read exactly the accounts that changed since its snapshot;
   *  nothing parses it from a URL. The scope is applied on top as always. */
  ids?: string[];
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
  // Per-row capability flags so the list can offer INLINE edits (v33.17) —
  // display hints only; every mutation re-runs the same predicates server-side.
  for (const r of rows) {
    r.can_edit = canEditAccount(viewer, r);
    r.can_reassign = canReassignAccount(viewer, r);
    r.can_request_state = canEditRequestState(viewer, r);
  }
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
    // Back to "exact" (v33.19). v33.14's planner estimate was wrong exactly
    // where it hurts: it guessed 20 for a member's 27 accounts, and since the
    // page size is also 20, the pager concluded "one page" and hid itself —
    // seven accounts unreachable, the header lying. An exact indexed count on
    // the LIST is one cheap query per page view; the estimate's savings were
    // never worth a member losing sight of their own accounts.
    .select(columns ?? "*", withCount ? { count: "exact" } : undefined);
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
        : [],
      _openViewFunctions(viewer),
      // THE FUNCTION-LESS RESEARCH POOL (v36) — asked for at BOTH scope
      // shapes, because the people who distribute it are leaders (a
      // `functions` scope) and MMs (a `members` one). The Podio worklist
      // deliberately excludes unowned rows further down, so widening the
      // scope here cannot leak the pool into that queue.
      _canSeeUnownedPool(viewer)
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

  if (filters.ids && filters.ids.length > 0) query = query.in("id", filters.ids);

  eqOrIn("function", filters.fn);
  // the Product column's funnel: OR across (function, product) pairs
  {
    const lanes = pickList(filters.lane);
    if (lanes.length > 0) {
      const term = (v: string) =>
        v === "GTa" || v === "GTe"
          ? `and(function.eq.IGT,product.eq.${v})`
          : `function.eq.${v}`;
      query = query.or(lanes.map(term).join(","));
    }
  }
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
  eqOrIn("industry", filters.industry);
  eqOrIn("account_type", filters.accountType);
  // two-state funnels: picking BOTH options is picking neither
  {
    const p = pickList(filters.proposal);
    if (p.includes("sent") && !p.includes("not_sent"))
      query = query.eq("proposal_sent", true);
    else if (p.includes("not_sent") && !p.includes("sent"))
      query = query.eq("proposal_sent", false);
  }
  {
    const d = pickList(filters.deals);
    if (d.includes("has") && !d.includes("none")) query = query.gte("deals_count", 1);
    else if (d.includes("none") && !d.includes("has")) query = query.eq("deals_count", 0);
  }
  // the Podio funnel mixes two columns (requested? + the request state), so
  // several picks OR together by hand — `.in` can't span columns
  {
    const pods = pickList(filters.podio);
    const clauses: string[] = [];
    for (const v of pods) {
      if (v === "requested") clauses.push("requested_podio.eq.true");
      else if (v === "not_requested") clauses.push("requested_podio.eq.false");
      else if (["Checking", "Approved", "Rejected"].includes(v))
        clauses.push(`request_state.eq.${v}`);
    }
    if (clauses.length === 1) query = query.or(clauses[0]);
    else if (clauses.length > 1) query = query.or(clauses.join(","));
  }

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
  let raw = idOrSlug;
  try {
    raw = decodeURIComponent(idOrSlug);
  } catch {
    // a hand-typed URL with a stray % — match it as-is
  }
  if (UUID_RE.test(raw)) {
    const { data } = await db()
      .from("accounts_pipeline")
      .select("*")
      .eq("id", raw)
      .maybeSingle<PipelineRow>();
    return data ?? null;
  }

  // Every dash could have been a space OR a real dash — and a name may hold
  // LIKE metacharacters itself ("omama_burgerhouse", "purity 101%"). Each such
  // character must become the SINGLE-char wildcard `_`, never be stripped:
  // stripping shortens the pattern and it can then match nothing at all
  // (32 live accounts were unreachable that way). The JS slug comparison
  // below keeps the wider pattern exact.
  const pattern = slugLikePattern(raw);
  const { data } = await db()
    .from("accounts_pipeline")
    .select("*")
    .ilike("normalized_name", pattern)
    .order("out_of_process", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = ((data ?? []) as PipelineRow[]).filter(
    (r) =>
      accountSlug(r.name) === raw ||
      // slugs percent-encode non-ASCII (Arabic names) while `raw` arrives
      // decoded — compare the decoded forms too
      decodeURIComponent(accountSlug(r.name)) === raw ||
      normalizeName(r.name) === raw.replace(/-/g, " ")
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
  // AN UNOWNED RESEARCH NAME HAS NO FUNCTION AT ALL (v36) — it belongs to no
  // crew until somebody claims it. Saying so is the honest fact; printing an
  // empty "Function:" row would read as data we lost.
  const facts: [string, string][] = [
    ["Function", fn ?? "— none yet (unowned research)"],
  ];
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
  /** BLOCKS: an active OR archived account in the SAME world (v33.29 — an
   *  active name in ANOTHER world no longer blocks, it informs) */
  duplicate: PipelineRow | null;
  /** BLOCKS: manual/imported archive names (the ICX world's list) */
  blacklisted: BlacklistEntry | null;
  /** INFO ONLY (v23.2): archived in another world — each world keeps its own
   *  archive, so this never blocks */
  crossWorldArchived: PipelineRow | null;
  /** INFO ONLY (v33.29): the name is ACTIVE in another world — "already
   *  active in IGV, responsible: X" — the add proceeds anyway */
  crossWorldActive: PipelineRow | null;
}

/** Duplicate + archive check for the Add Account flow — WORLD-AWARE, three
 *  ways since v33.29 (was two: v23.2 split B2C off, v32.5 moved BD across):
 *
 *    ICX  IGV · IGT · B2B  — raising opens for the ICX programmes
 *    BD                    — money partnerships
 *    B2C                   — courses / events / student activities
 *
 *  A name is unique WITHIN its world (active or archived — the archive is the
 *  blacklist), and each world keeps its own archive. Across worlds NOTHING
 *  blocks any more: an ACTIVE namesake elsewhere is an info note ("already
 *  active in IGV, responsible: X") and an ARCHIVED one a heads-up — the same
 *  company can be an IGV partner, a BD sponsor and a B2C venue at once.
 *  Mirrors the accounts_normalized_name_world_key index (0052). */
export async function checkAccountName(
  name: string,
  fn?: AccountFunction,
  opts?: { excludeId?: string }
): Promise<NameCheckResult> {
  const normalized = normalizeName(name);
  if (!normalized)
    return { duplicate: null, blacklisted: null, crossWorldArchived: null, crossWorldActive: null };
  const worldOf = (f?: string | null): "ICX" | "BD" | "B2C" =>
    f === "B2C" ? "B2C" : f === "BD" ? "BD" : "ICX";
  const world = worldOf(fn);
  // TWO NAMES ONE DASH APART ARE THE SAME ACCOUNT (v33.7). "i fikra software
  // company" and "i-fikra software company" normalise differently but slug
  // IDENTICALLY, so both live at one URL — which is how the LC ended up with
  // two of the same partner in different functions, one of them unreachable.
  // A name that would collide on the URL is a duplicate. LIKE metacharacters
  // in the name itself (_ % \) become single-char wildcards — stripping them
  // shortened the pattern and silently disabled this check for such names.
  const slugPattern = slugLikePattern(normalized).replace(/\s/g, "_");
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
    (r) => accountSlug(r.name) === accountSlug(name) && r.id !== opts?.excludeId
  );
  const sameWorld = (r: PipelineRow) => worldOf(r.function) === world;
  const activeSame = all.find((r) => !r.out_of_process && sameWorld(r)) ?? null;
  const activeOther = all.find((r) => !r.out_of_process && !sameWorld(r)) ?? null;
  const archivedSame = all.find((r) => r.out_of_process && sameWorld(r)) ?? null;
  const archivedOther = all.find((r) => r.out_of_process && !sameWorld(r)) ?? null;
  // the manual blacklist is the ICX world's list — BD and B2C never see it
  const blacklisted = world === "ICX" ? (blacklistHit ?? null) : null;
  const duplicate = activeSame ?? archivedSame;
  return {
    duplicate,
    blacklisted,
    crossWorldArchived: !duplicate && !blacklisted ? archivedOther : null,
    crossWorldActive: !duplicate && !blacklisted ? activeOther : null,
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

export async function listReassignTargets(
  viewer: Viewer,
  // v36: NULL for the unclaimed pool. There is no incumbent function to match
  // a target against, so the question becomes simply "who may take this" —
  // handled below by falling through to the any-raising-function branch.
  fn: AccountFunction | null,
  opts?: { anyRaisingFunction?: boolean }
): Promise<Member[]> {
  const scope = reassignTargetScope(viewer);
  if (scope.kind === "members" && scope.ids.length === 0) return [];
  let query = db().from("members").select("*").eq("is_active", true);
  if (scope.kind === "all" || scope.kind === "functions") {
    // HANDING AN ACCOUNT ACROSS FUNCTIONS (v33.18). Distribution isn't always
    // inside one function: an unowned company researched by IGV may belong to
    // B2C, and whoever distributes the pool needs the whole raising world in
    // the picker. The account then FOLLOWS its new owner (reassignAccount).
    // ⚠️ v36: `!fn` (the unclaimed pool) takes the SAME branch as an explicit
    // cross-function hand-out, and it must. There is no incumbent function to
    // stay inside, so "who may receive this" is the whole raising world — and
    // the fallthrough below would otherwise reach `contains("functions",
    // [null])`, which matches nobody and would hand a distributing VP an empty
    // picker with no error to explain it.
    query = opts?.anyRaisingFunction || !fn
      ? query.or(
          `functions.ov.{${ACCOUNT_WORLD_FNS.join(",")}},sub_functions.ov.{B2B,BD,B2C}`
        )
      : // otherwise reassignment stays inside the account's function
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
  // THE POOL CARRIES NO FUNCTION (v36) — so the count has to ask for
  // function-less rows explicitly, exactly as `applyScope` does, or the
  // "— Unassigned (n)" option would read 0 while the list shows hundreds.
  const pool = _canSeeUnownedPool(viewer);
  const withPool = (fns: AccountFunction[]) =>
    pool
      ? q.or([`function.in.(${fns.map((f) => `"${f}"`).join(",")})`, "function.is.null"].join(","))
      : q.in("function", fns);
  if (scope.kind === "functions") q = withPool(scope.fns);
  else if (scope.kind === "members") {
    const claimable = _allowedAccountFunctions(viewer);
    // a viewer with neither a claimable function nor the pool has nothing to
    // count; one with the pool alone (there is no such role today, but the
    // predicate is not this function's to assume) still counts the pool
    if (claimable.length === 0 && !pool) return 0;
    q = claimable.length > 0 ? withPool(claimable) : q.is("function", null);
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
  const allLeads = await listTeamLeaders(viewer);
  const leads = opts.fn
    ? allLeads.filter((m) => memberWorksFunction(m, opts.fn!))
    : allLeads;
  return leads.map((m) => {
    return {
      id: m.id,
      label: teamLabel(m.name),
    };
  });
}

// ------------------------------------------------------------------ dashboard

/** THE FUNNEL MODEL LIVES IN `@/lib/dashboard-funnel` (v33.49) — which lane a
 *  row belongs to, which lane its opens feed, and which DATE each KPI is
 *  judged on. It is pure, so it is unit-tested; this file supplies the rows. */
export type { FunnelStats, RowWork } from "@/lib/dashboard-funnel";

export interface DrillGroup extends FunnelStats {
  key: string;
  label: string;
}

/** How long a dashboard read may be reused.
 *
 *  30 MINUTES (v33.15), raised deliberately with the project against its CPU
 *  allowance and a working-hours day tomorrow.
 *
 *  WHAT IS ACTUALLY CACHED: only the dashboard's aggregate — the KPI row, the
 *  conversion strip, the leaderboards and the drills. It reads ~4,000 account
 *  rows and folds them in JS, which is the single most expensive thing the
 *  system does, and it is SHARED between everyone with the same scope, so one
 *  read serves a whole function.
 *
 *  WHAT IS NOT: everything else. The accounts list, an account page, sign-ups,
 *  the calendar, attendance — all still read live on every request, and every
 *  write still refreshes them immediately. Logging a contact updates the
 *  account in front of you at once; it is only the dashboard's totals that may
 *  lag.
 *
 *  THE COST: a number on the dashboard can be up to half an hour behind. The
 *  dashboard is a steering instrument, not a live scoreboard — nobody makes a
 *  decision on the difference between 61 and 62 opens — and the Refresh button
 *  is always there for someone who wants it now. */
const DASHBOARD_TTL_SECONDS = 1800;

/** WHY THIS IS NOT `unstable_cache` ANYMORE (v33.46).
 *
 *  v33.14 stopped `refresh()` from expiring the dashboard entry, and left a
 *  comment saying the entry now lives out its life. It didn't. Two lines
 *  above that comment `refresh()` calls `revalidatePath("/", "layout")` —
 *  which Next's own reference documents under the heading "Revalidating all
 *  data": it invalidates ALL cached data, `unstable_cache` entries included.
 *  So every contact logged by any of forty members still dropped the shared
 *  4,000-row read for everyone, which is the exact cost v33.14 set out to
 *  remove. The tag on the entry was inert too — nothing in the codebase has
 *  ever called `revalidateTag("accounts")`.
 *
 *  `refresh()` is called from ~94 places and its blanket invalidation is what
 *  keeps every other page correct, so it stays. The dashboard read moves out
 *  of Next's cache instead, into plain module memory that `revalidatePath`
 *  cannot reach. Per-instance rather than global, which only means a cold
 *  instance pays for one read.
 *
 *  THE COST is the one v33.14 already accepted and wrote down: a dashboard
 *  number can be up to DASHBOARD_TTL_SECONDS behind. It is a steering
 *  instrument, not a live scoreboard. Account pages and lists are unaffected
 *  — `refresh()` still expires those immediately. */
interface DashboardSnapshot {
  /** when the FULL read was taken — governs the TTL */
  at: number;
  /** the instant the snapshot is current AS OF: everything written after this
   *  is picked up by the delta below. Taken BEFORE the read starts, so a row
   *  written while it ran is re-read rather than missed. */
  asOf: string;
  rows: PipelineRow[];
}
const dashboardMemo = new Map<string, DashboardSnapshot>();
/** The key space is SCOPES, not viewers (see dashboardCacheKey) — since
 *  v33.49 it carries no filters at all, so this is bounded by roles × teams.
 *  The cap is a guardrail, not a working limit. */
const DASHBOARD_MEMO_MAX = 32;
/** More accounts than this changed since the snapshot (a market-research
 *  import, a bulk reassign) → re-read the lot instead of patching row by row. */
const DASHBOARD_DELTA_MAX = 400;

/** THE SNAPSHOT SELF-FRESHENS (v33.49).
 *
 *  v33.46 was right that the expensive read should not be dropped every time
 *  somebody logs a contact — but it left the dashboard genuinely frozen for
 *  half an hour, and the Refresh button unable to do anything about it
 *  (`refresh()` calls `revalidatePath`, which module memory does not listen
 *  to). "The numbers are wrong" is what that looks like from the floor.
 *
 *  So the full read still happens at most once per TTL, and every render adds
 *  one tiny query on top: which accounts have been touched since the snapshot.
 *  Normally that returns nothing and costs a scan of a 4,000-row table. When
 *  it returns something, only those rows are re-read — so a new account, a
 *  reassignment, an archive or an account that has just left this scope lands
 *  on the dashboard immediately, at a fraction of the cost of re-reading
 *  everything. (The work numbers — contacts, visits, deals — are read live
 *  from their own tables and were never affected by this cache.)
 *
 *  WHAT STILL LAGS: a permanently DELETED account, which by definition can't
 *  appear in a list of changed rows. That is a VP-only action on an archived
 *  name, and it heals on the next full read. */
async function readDashboardRows(viewer: Viewer): Promise<PipelineRow[]> {
  const key = dashboardCacheKey(accountScope(viewer), !!viewer.testMode);
  // THE READ IS FILTER-FREE — see dashboardCacheKey. Every filter (date range,
  // team, member) is applied in JS by getDashboard, so this row set is exactly
  // "every account this scope can see", and nothing about the caller's filters
  // can make one viewer's entry wrong for the next.
  const readAll = async (): Promise<DashboardSnapshot> => {
    const asOf = new Date().toISOString();
    const rows = await listAccounts(
      viewer,
      { includeArchived: true },
      MAX_FETCH_ROWS,
      DASHBOARD_COLUMNS
    );
    return { at: Date.now(), asOf, rows };
  };
  const remember = (snap: DashboardSnapshot) => {
    if (dashboardMemo.size >= DASHBOARD_MEMO_MAX && !dashboardMemo.has(key)) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [k, v] of dashboardMemo) {
        if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
      }
      if (oldestKey) dashboardMemo.delete(oldestKey);
    }
    dashboardMemo.set(key, snap);
    return snap.rows;
  };

  const hit = dashboardMemo.get(key);
  if (!hit || Date.now() - hit.at >= DASHBOARD_TTL_SECONDS * 1000)
    return remember(await readAll());

  try {
    const asOf = new Date().toISOString();
    const { data, error } = await db()
      .from("accounts")
      .select("id")
      .gte("updated_at", hit.asOf)
      .limit(DASHBOARD_DELTA_MAX + 1);
    if (error) throw error;
    const ids = ((data ?? []) as { id: string }[]).map((c) => c.id);
    if (ids.length > DASHBOARD_DELTA_MAX) return remember(await readAll());
    if (ids.length > 0) {
      const fresh = await listAccounts(
        viewer,
        { includeArchived: true, ids },
        ids.length,
        DASHBOARD_COLUMNS
      );
      // a changed row is dropped and re-added: one that no longer matches this
      // scope (reassigned into another function) simply doesn't come back
      const changed = new Set(ids);
      hit.rows = [...hit.rows.filter((r) => !changed.has(r.id)), ...fresh];
    }
    hit.asOf = asOf;
  } catch (e) {
    // a delta that fails leaves the snapshot exactly as stale as it already
    // was — never wrong, and never a blank dashboard
    console.error("[dashboard] delta refresh failed:", (e as Error).message);
  }
  return hit.rows;
}


/** v33.53 — this used to pick the one REGISTERED team name out of a member's
 *  comma-list. There are no registered team names and no Team Name column any
 *  more: a Team Leader's row IS their team, a Coordinator's is their own work.
 *  Kept as a named function because the drills read better for it. */
function mmDrillLabel(m: { name: string; role: string }): string {
  return m.role === "Team Leader" ? teamLabel(m.name) : m.name;
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


/** THE WORK ITSELF, read per table and keyed by account (v33.49) — one query
 *  per KPI that has a date of its own, each filtered on ITS OWN column.
 *
 *  Only reached when a date range is set: with no range the account row's
 *  running counters already are the all-time answer, so the LC's whole contact
 *  log never has to be read. Inside a range these tables are bounded by the
 *  range itself (a month of an LC's work is a few hundred rows), which is why
 *  they can be read LIVE on every render while the 4,000-row account read is
 *  the one that gets cached.
 *
 *  Test accounts need no filter here: the caller looks every row up in its own
 *  account set, which already excludes them unless the viewer is in a test
 *  view. Anything that doesn't resolve to an account in scope is dropped. */
async function dashboardWindowWork(
  startIso: string | null,
  endIso: string | null,
  from?: string,
  to?: string
): Promise<Map<string, RowWork>> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [contacts, booked, held, deals] = await Promise.all([
    // contacted → the ATTEMPT's own timestamp
    fetchAll<any>(() => {
      let q = db().from("contact_attempts").select("account_id");
      if (startIso) q = q.gte("created_at", startIso);
      if (endIso) q = q.lt("created_at", endIso);
      return q.order("id");
    }).catch(() => []),
    // visits → the BOOKING (created_at), which is the work done in the window
    fetchAll<any>(() => {
      let q = db().from("visits").select("account_id");
      if (startIso) q = q.gte("created_at", startIso);
      if (endIso) q = q.lt("created_at", endIso);
      return q.order("id");
    }).catch(() => []),
    // visits done → the day it actually HAPPENED (visit_date, a Cairo calendar
    // day, so it stays a plain date comparison)
    fetchAll<any>(() => {
      let q = db().from("visits").select("account_id").eq("done", true);
      if (from) q = q.gte("visit_date", from);
      if (to) q = q.lte("visit_date", to);
      return q.order("id");
    }).catch(() => []),
    // deals + the opens they carry → when the deal was signed
    fetchAll<any>(() => {
      let q = db()
        .from("deals")
        .select("account_id, slots, slots_igv, slots_igta, slots_igte");
      if (startIso) q = q.gte("created_at", startIso);
      if (endIso) q = q.lt("created_at", endIso);
      return q.order("id");
    }).catch(() => []),
  ]);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const out = new Map<string, RowWork>();
  const at = (id: string): RowWork => {
    let w = out.get(id);
    if (!w) { w = noWork(); out.set(id, w); }
    return w;
  };
  for (const c of contacts) if (c.account_id) at(c.account_id).contacted = true;
  for (const v of booked) if (v.account_id) at(v.account_id).visitBooked = true;
  for (const v of held) if (v.account_id) at(v.account_id).visitDone = true;
  for (const d of deals) {
    if (!d.account_id) continue;
    const w = at(d.account_id);
    w.deals += 1;
    w.slots += d.slots ?? 0;
    w.igv += d.slots_igv ?? 0;
    w.igta += d.slots_igta ?? 0;
    w.igte += d.slots_igte ?? 0;
    // pre-0009 deals carry no per-product split — the account's own product
    // takes the whole total, exactly as the counters' fallback does
    if (d.slots_igv == null && d.slots_igta == null && d.slots_igte == null)
      w.split = false;
  }
  return out;
}

export async function getDashboard(
  viewer: Viewer,
  filters: AccountFilters = {},
  laneKey?: string
) {
  const lane = laneKey && laneKey !== "all" ? laneKey : "all";
  const dashViewer = dashboardViewer(viewer);
  // EVERY FILTER IS APPLIED HERE, IN JS (v33.49) — the DB read is the scope's
  // whole account set and nothing else, which is what makes it safely
  // cacheable (see dashboardCacheKey for the collision this closes).
  //   · lane (fn/product) — a DB filter would drop the B2B and cross-product
  //     IGT accounts whose opens feed this lane
  //   · date range — each KPI is judged on its OWN date, so the accounts read
  //     can't be narrowed by one of them (see RowWork)
  //   · team — the TL and everyone reporting to them
  //   · responsibleId ("My numbers" / the member select) — scopes the KPI +
  //     conversion totals ONLY; leaderboards, drills and goal progress always
  //     show the full picture
  // UNOWNED accounts are excluded from every dashboard number (v33.2). The
  // 1,300 imported market-research names nobody has taken are not work anyone
  // has done: counting them as Market Research inflates the top of the funnel
  // and drags every conversion below it toward zero, so the lane looks like it
  // is failing at contacting when really nobody has been given the names yet.
  // They can carry nothing else — scheduling a visit or recording a deal both
  // refuse until the account is assigned.
  const allRows = (await readDashboardRows(dashViewer)).filter(
    (r) => r.responsible_id != null
  );
  // a team filter means "this TL and everyone reporting to them" — several
  // teams is the UNION of those people (it was a DB filter until v33.49,
  // which is exactly what poisoned the shared cache entry)
  const teamPicks = pickList(filters.teamId);
  let teamScope: Set<string> | null = null;
  if (teamPicks.length > 0) {
    const { data: team } = await db()
      .from("members")
      .select("id")
      .in("stakeholder_id", teamPicks);
    teamScope = new Set([
      ...teamPicks,
      ...((team ?? []) as { id: string }[]).map((t) => t.id),
    ]);
  }
  const rows = teamScope
    ? allRows.filter((r) => teamScope.has(r.responsible_id))
    : allRows;

  // ---- the window, and the work inside it --------------------------------
  // Cairo day bounds → UTC instants, half-open [startIso, endIso). A naive
  // "YYYY-MM-DDT00:00:00Z" is 2–3 hours out here, which silently moved the
  // first evening of every range into the period before it.
  const { from, to } = clampDirectoryWindow({ from: filters.from, to: filters.to });
  const windowed = !!(from || to);
  const startIso = from ? cairoToUtc(from, "00:00").toISOString() : null;
  const endIso = to ? cairoToUtc(nextDayIso(to), "00:00").toISOString() : null;
  const startTs = startIso ? Date.parse(startIso) : -Infinity;
  const endTs = endIso ? Date.parse(endIso) : Infinity;
  const inWindow = (ts: string | null | undefined) => {
    if (!ts) return false;
    const t = Date.parse(ts);
    return Number.isFinite(t) && t >= startTs && t < endTs;
  };
  const workById = windowed
    ? await dashboardWindowWork(startIso, endIso, from, to)
    : null;
  // IS THE "THIS SPRINT" CHIP ON? (v33.56) — the plan cards are monthly and
  // only follow the sprint when the whole page does. An exact match on the
  // current sprint's own bounds is the chip; a hand-typed range is not.
  // ⚠️ Compared against the RAW filter, not the clamped window: the clamp
  // pulls `to` back to today, so mid-sprint the chip's own end date would
  // never match itself.
  const sprintNow = sprintOf();
  const sprintMode =
    filters.from === sprintNow.start && filters.to === sprintNow.end;
  const workOf = (r: PipelineRow): RowWork => {
    if (!workById) return allTimeWork(r);
    const w = workById.get(r.id) ?? noWork();
    w.mr = inWindow(r.created_at);
    return w;
  };

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
    const w = workOf(r);
    const inLane = rowInLane(r, lane);
    const contributes = laneWorkSlots(r, w, lane) > 0;
    if (!inLane && !contributes) continue; // nothing for this lane
    // Inside a window, an account the viewer simply didn't touch this month
    // must not take a row on a board or a drill — it would be a name with
    // seven zeroes beside it. (With no window every account counts as MR, so
    // this never fires and the picture is the one it has always been.)
    if (windowed && !didAnything(w)) continue;

    if (inKpiScope(r)) addRowLane(total, r, w, lane);

    // product drill: IGV / IGTa / IGTe / B2B rows (account-level numbers)
    //
    // ⚠️ v36: the unowned pool (function === null) is skipped here on purpose.
    // It reaches this point because it legitimately counts in the All-ICX
    // funnel (see rowInLane), but this drill answers "how is each PRODUCT
    // doing" and an unclaimed name has no product — it would open a drill row
    // labelled with nothing, which is how the v22 mislabelling looked from the
    // outside in the first place.
    if (inLane && r.function) {
      const fnKey =
        r.function === "IGT" ? (r.product ? `I${r.product}` : "IGT") : r.function;
      addRowLane(getOrInit(byFunction, fnKey, fnKey), r, w, lane);
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
      addRowLane(getOrInit(byTeam, mm.id, mmDrillLabel(mm)), r, w, lane);
    }

    // leaderboards (VPs/Directors/LCP never appear — leaders steer):
    //  • Members board  → role Member
    //  • MMs board      → Team Leaders + Coordinators
    // each row is that person's OWN accounts (no team rollup)
    const respLabel = r.responsible_name;
    if (r.responsible_role === "Member") {
      addRowLane(getOrInit(byMemberRole, r.responsible_id, respLabel), r, w, lane);
      addRowLane(getOrInit(byPerson, r.responsible_id, respLabel), r, w, lane);
    } else if (r.responsible_role === "Team Leader" || r.responsible_role === "Coordinator") {
      addRowLane(getOrInit(byMM, r.responsible_id, respLabel), r, w, lane);
      addRowLane(getOrInit(byPerson, r.responsible_id, respLabel), r, w, lane);
    }
  }

  // ---- per-member opens come from deal ALLOCATIONS (v22): a deal's opens can
  // be split across members, so boards can't trust the account counters. Only
  // allocations whose parent account is in the scoped/filtered row set count —
  // the boards stay consistent with the rest of the dashboard. When the table
  // is empty (pre-migration), keep the account-based numbers.
  // v33.49 — inside a window these are the allocations of the deals SIGNED in
  // that window (they used to be every allocation ever, narrowed only by which
  // accounts happened to be created inside it: a board could credit a member
  // for opens raised months earlier, or drop this week's deal because the
  // account was older than the filter).
  const allocations = await fetchAll<AllocRow>(() => {
    let q = db()
      .from("deal_allocations")
      .select(
        windowed
          ? "member_id, slots_igv, slots_igta, slots_igte, deal:deals!inner(account_id, created_at)"
          : "member_id, slots_igv, slots_igta, slots_igte, deal:deals!inner(account_id)"
      );
    if (startIso) q = q.gte("deal.created_at", startIso);
    if (endIso) q = q.lt("deal.created_at", endIso);
    return q.order("id");
  }).catch(() => [] as AllocRow[]);
  const allocSlotsByMember = new Map<string, number>();
  for (const al of allocations) {
    const acc = al.deal ? rowById.get(al.deal.account_id) : undefined;
    if (!acc) continue; // outside this viewer's scope / the active filters
    // v36: a deal cannot exist on an unclaimed account — recordDeal refuses an
    // unassigned one (v22), and claiming stamps a function before any deal can
    // be recorded. So a null here is not a pool row passing through, it is a
    // broken row; skipping it keeps a bad row out of the numbers rather than
    // crediting its opens to a lane picked by accident.
    if (!acc.function) continue;
    const v = laneAllocSlots(al, lane, acc.function);
    if (v > 0)
      allocSlotsByMember.set(al.member_id, (allocSlotsByMember.get(al.member_id) ?? 0) + v);
  }
  // A window with no deals in it means "nobody raised opens in this window" —
  // zero, not "fall back to everything they ever raised". The pre-0018 fallback
  // (an empty allocations TABLE) only applies to the all-time view.
  if (allocations.length > 0 || windowed) {
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
  // THE TEAM BOARD RANKS THE TEAM, NOT ITS LEADER (v33.21). Every other
  // leaderboard lists Members and Coordinators only — a leader is measured on
  // what their people raise, not against them. The TL stays inside
  // `teamMemberIds` (the team's PLAN actuals do include their own accounts);
  // they just don't take a row on the board they're reading.
  const teamBoard = teamMemberIds
    ? [...byPerson.values()]
        .filter((g) => teamMemberIds.has(g.key) && g.key !== teamLeadId)
        .sort(rank)
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
  // ⚠️ v36 — A PLAN IS A PERSON'S OWN COMMITMENT, AND ONLY THEY SEE IT.
  //
  // `planOwnerId` above resolves to the TEAM LEADER whenever the viewer's
  // manager files a plan — so every member of that team was served their
  // manager's target and their manager's shortfall on their own dashboard,
  // every day. That is a private number between an MM and the person who
  // reviews them: a member cannot act on it, and watching a manager sit at
  // 4/15 is not context, it is exposure. The client did carry an `isOwnPlan`
  // flag, but it only changed the WORDING — the numbers were already in the
  // payload, so it was never a gate.
  //
  // The FUNCTION's shared goal is untouched and still shows to the whole lane
  // (`lanePlan`). That distinction is the whole rule: a function's goal is
  // something the crew is chasing together and v33.52 exists precisely because
  // members had no goal to see; one person's filed plan is not.
  if (planOwnerId !== viewer.id) {
    planOwnerId = null;
    planScopeIds = null;
  }
  if (planOwnerId && planScopeIds) {
    const month = monthOf();
    // the filed plan is MONTHLY; the window it is judged against follows the
    // bar (v33.56)
    const win = sprintMode ? sprintNow : month;
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
      .gte("deal.created_at", `${win.start}T00:00:00`)
      .lte("deal.created_at", `${win.end}T23:59:59`);
    if (!viewer.testMode) q = q.eq("deal.account.is_test", false);
    const { data: monthAllocs } = await q;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actualOpens = ((monthAllocs ?? []) as any[]).reduce(
      (s, a) => s + (a.slots_igv ?? 0) + (a.slots_igta ?? 0) + (a.slots_igte ?? 0),
      0
    );
    teamPlan = {
      teamLeaderId: planOwnerId,
      monthLabel: win.label,
      // half a month, rounded up: a target you can't quite reach is worse
      // than one you can just about beat
      plannedOpens: sprintMode
        ? Math.ceil((planRow?.opens ?? 0) / 2)
        : planRow?.opens ?? 0,
      actualOpens,
      mode: sprintMode ? "sprint" : "month",
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
      // the bar decides: "This sprint" on → the sprint's own planned cells;
      // anything else (including a custom range) → the month
      const win = sprintMode ? sprint : month;
      const scope = sprintMode ? "sprint" : "month";
      lanePlan = {
        lane,
        mode: sprintMode ? "sprint" : "month",
        window: {
          label: win.label,
          plannedOpens: sum(scope, win.planKeys, "opens"),
          actualOpens: act(sprintMode ? sprintActual : monthActual),
          funnel: funnel(scope, win.planKeys),
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
  /** WHICH WINDOW THIS CARD IS ABOUT (v33.56). The dashboard's plan cards are
   *  MONTHLY — that is the period an LC actually steers by — and they switch
   *  to the sprint only while the "This sprint" filter is on. So the card no
   *  longer carries a toggle of its own: it follows the bar above it, and the
   *  numbers on screen always belong to the window the whole page is showing. */
  mode: "month" | "sprint";
  window: LanePlanWindow;
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
  /** v33.56 — an MM files a MONTH. With "This sprint" on, the card shows half
   *  of it against the sprint's own opens: they never planned a sprint, so the
   *  target is derived and the card says so rather than pretending. */
  mode: "month" | "sprint";
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

  // EB AND LB ARE THE ONLY NAMED BODIES (v33.53). The Teams tab is gone from
  // the sheet and with it every function / function-leaders / team NAME —
  // everything else a member belongs to is derived: their function, and the
  // manager they report to.
  if (onEb) push("Executive Board", byKey.get("EB:"));
  if (isManager) push("Leadership Body", byKey.get("LB:"));
  for (const fn of fns) push(`${fn} function`, fn);

  // their team = the manager's, or their own when they ARE the manager
  if (viewer.role === "Team Leader") push("My team", teamLabel(viewer.name));
  else if (viewer.stakeholder_id) {
    const { data: tl } = await db()
      .from("members")
      .select("name, role")
      .eq("id", viewer.stakeholder_id)
      .maybeSingle<{ name: string; role: string }>();
    if (tl?.role === "Team Leader") push("My team", teamLabel(tl.name));
  }

  // de-dupe by name
  const seen = new Set<string>();
  return out.filter((t) => (seen.has(t.name) ? false : seen.add(t.name)));
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

/** THE AUDIT TRAIL LIVES IN `./audit` NOW (v36).
 *
 *  It used to be thirty lines here writing five columns. `audit_log` holds
 *  ~14k rows across 102 actions and grows by ~350 a day, and every one of
 *  them said only *who did what to which row* — never what changed, never
 *  from where, and (the gap that mattered) not one authentication event in
 *  the history of the system. That is a file's worth of behaviour, not a
 *  helper wedged between the calendar reads and the cron stamps.
 *
 *  IT IS RE-EXPORTED FROM HERE ON PURPOSE. About 123 call sites across
 *  `actions.ts`, the crons and the server modules import `logAudit` from
 *  `@/server/data`; the five positional parameters are unchanged and
 *  everything new arrives through an optional sixth `opts` argument, so not
 *  one of them had to move. `diffFields`, `logAuth` and `logDenied` are
 *  imported from `@/server/audit` directly — they are new, so there is no
 *  history to preserve and no reason to route them through this file.
 *
 *  ⚠️ NO IMPORT CYCLE: `audit.ts` reaches back into `data.ts` only through a
 *  DYNAMIC import inside `realActorId` (it needs `getRealViewer` to name the
 *  admin behind an impersonated action). A static edge there would close the
 *  ring at module-evaluation time. */
export { logAudit } from "./audit";

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
  /** the actor was resolved from an ANONYMOUS lc_feedback row and is shown
   *  to ADMIN_EMAILS alone (v33.30) — the UI labels it so it isn't repeated */
  actorAdminOnly?: boolean;
  details: string | null;
  createdAt: string;
  /** the action's change set — null on entries written before v32 */
  changeSet: string | null;
  /** how many journal rows this action can reverse (0 = nothing to undo) */
  undoable: number;
  /** set once someone has undone it, so it can't be replayed twice */
  undoneAt: string | null;
  /** v36 — who REALLY acted, when the actor above is being impersonated in a
   *  test view. Recording it is the entire point of the column: an action
   *  taken during a test view is attributed to the target member (by design,
   *  v14), and without this the log cannot tell that apart from the target
   *  doing it themselves. */
  realActor: string | null;
  /** {field: [from, to]} for the keys that actually moved */
  changed: string | null;
  category: string;
  outcome: string;
  severity: string;
  /** one human sentence, so the console is readable without parsing JSON */
  summary: string | null;
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
    label: "The Violet Man (GEMINI_API_KEY)",
    ok: !!process.env.GEMINI_API_KEY,
    detail: process.env.GEMINI_API_KEY ? "Configured" : "Missing",
  });
  // PHONE NOTIFICATIONS (v35) — configured, and how far they actually reach.
  // "Configured" alone would be a green tick over a channel nobody has turned
  // on, so the detail is the reach: devices, and the PEOPLE behind them.
  try {
    const configured = !!env.vapidPublicKey && !!env.vapidPrivateKey;
    if (!configured) {
      checks.push({
        label: "Phone notifications (VAPID)",
        ok: false,
        detail: "Missing — set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY",
      });
    } else {
      const { data: subs } = await db()
        .from("push_subscriptions")
        .select("member_id")
        .limit(5000);
      const rows = (subs ?? []) as { member_id: string }[];
      const people = new Set(rows.map((r) => r.member_id)).size;
      const { count: active } = await db()
        .from("members")
        .select("id", { head: true, count: "exact" })
        .eq("is_active", true);
      checks.push({
        label: "Phone notifications (VAPID)",
        ok: true,
        detail:
          rows.length === 0
            ? "Configured — no device has turned them on yet"
            : `${rows.length} device(s) · ${people} of ${active ?? "?"} members reachable`,
      });
    }
  } catch (e) {
    checks.push({ label: "Phone notifications (VAPID)", ok: false, detail: `${e}` });
  }

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
    // GitHub Actions (free) — see .github/workflows/
    { key: "visit-followups", label: "Visit follow-ups", note: "every 30 min, 04–21 UTC (Actions)" },
    { key: "signups-import", label: "Sign-ups sheet sync", note: "every 15 min, 04–21 UTC (Actions)" },
    { key: "membership-import", label: "Membership import", note: "every 30 min, 04–21 UTC (Actions)" },
    { key: "sheets-export", label: "Sheets export", note: "hourly (:05), 04–21 UTC (Actions)" },
    // Supabase pg_cron → Vercel — see supabase/cron.sql
    { key: "podio-updates", label: "Podio continuous updates", note: "daily 05:00 UTC" },
    { key: "period-reports", label: "Period reports", note: "daily 07:00 UTC (fires on sprint/month/quarter ends)" },
    { key: "streak-nags", label: "OGV streak nags", note: "daily 16:00 UTC (19:00 Cairo)" },
    // v33.46 — this one runs, stamps, and was the only job the health page
    // could not report on: it was missing from this list, so a silent failure
    // would have shown as nothing at all.
    { key: "touch-point-feedback", label: "Touch-point feedback", note: "daily 19:00 UTC" },
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
/** A RENAME MUST TRAVEL (v33.18).
 *
 *  Several tables keep a member's name as a SNAPSHOT next to the id — the IR
 *  log, touch points, custom calendar items, sign-up assignments — because
 *  they must still read correctly when a member leaves. The cost is that a
 *  spelling correction on the membership sheet ("Elina Tallat" → "Elina
 *  Talaat") left the old string behind, and every filter built from those
 *  snapshots then offered the SAME person twice.
 *
 *  So: whenever a member's name changes, the snapshots follow. Best-effort by
 *  design — a rename must never fail because a side table hiccuped. */
export async function cascadeMemberRename(memberId: string, name: string): Promise<void> {
  const clean = (name ?? "").trim();
  if (!memberId || !clean) return;
  const jobs: { table: string; col: string }[] = [
    { table: "ir_calls", col: "member_name" },
    { table: "touch_points", col: "owner_name" },
    { table: "calendar_items", col: "owner_name" },
    { table: "signups", col: "assigned_name" },
  ];
  for (const j of jobs) {
    const { error } = await db()
      .from(j.table)
      .update({ [j.col]: clean })
      .eq(j.table === "signups" ? "assigned_to" : j.table === "ir_calls" ? "member_id" : "owner_id", memberId)
      .neq(j.col, clean);
    if (error) console.error(`[rename] ${j.table}.${j.col} failed:`, error.message);
  }
  // the manager is carried BY NAME on every member row (the sheet's own shape)
  const { error: mgrErr } = await db()
    .from("members")
    .update({ stakeholder_name: clean })
    .eq("stakeholder_id", memberId)
    .neq("stakeholder_name", clean);
  if (mgrErr) console.error("[rename] members.stakeholder_name failed:", mgrErr.message);
}

/** A PROMOTION RELEASES MEMBER-LEVEL WORK (v33.19).
 *
 *  Sign-ups are assigned to the person who works them. When a Member or
 *  Coordinator becomes a Team Leader (or above), the pool they were handed
 *  as an individual isn't theirs to keep — a TL distributes, they don't sit
 *  on 61 sign-ups. Releasing to Unassigned lets their new team pick them up.
 *
 *  Only rows WITHOUT a status (no Applied/Accepted/Approved MOS) are released
 *  — a completed approval is history, not a live assignment. Best-effort;
 *  logged. `oldRole`/`newRole` come from the caller comparing before/after. */
export async function releaseSignupsOnPromotion(
  memberId: string,
  oldRole: string,
  newRole: string
): Promise<number> {
  const wasMm = oldRole === "Member" || oldRole === "Coordinator";
  const nowLead = ["Team Leader", "LCVP", "Director", "LCP", "Admin"].includes(newRole);
  if (!wasMm || !nowLead) return 0;
  // the names go into the log BEFORE they're cleared — "who had this" is the
  // only way to undo a wrong release by hand (v33.19 review)
  const { data: before } = await db()
    .from("signups")
    .select("id, assigned_name")
    .eq("assigned_to", memberId)
    .is("status", null)
    .eq("out_of_process", false);
  const rows = (before ?? []) as { id: string; assigned_name: string | null }[];
  if (rows.length === 0) return 0;
  const { data } = await db()
    .from("signups")
    .update({
      assigned_to: null,
      assigned_name: null,
      assigned_at: null,
      contact_status: null,
      interested: null,
      // the CIC second call belonged to that assignment too
      cic_assigned_to: null,
      cic_assigned_name: null,
      cic_assigned_at: null,
      cic_contact_status: null,
      cic_interested: null,
      sodio_touched: true,
      last_edited_at: new Date().toISOString(),
    })
    .eq("assigned_to", memberId)
    .is("status", null)
    .eq("out_of_process", false)
    .select("id");
  const n = (data ?? []).length;
  if (n > 0) {
    // an audit trail per row: 61 sign-ups leaving someone's list with no
    // record is exactly what made this hard to explain the first time
    await db()
      .from("signup_logs")
      .insert(
        rows.map((r) => ({
          signup_id: r.id,
          member_id: memberId,
          member_name: r.assigned_name ?? "—",
          field: "assigned",
          old_value: r.assigned_name,
          new_value: null,
        }))
      )
      .then(({ error }) => {
        if (error) console.error("[signups] release log failed:", error.message);
      });
    // the tracker sheet still shows the old assignee until it's pushed back —
    // same shape the bulk reassign uses (comments included, or the write-back
    // would blank the sheet's comment cells)
    try {
      const ids = rows.map((r) => r.id);
      const [{ data: full }, { data: cmts }] = await Promise.all([
        db().from("signups").select("*").in("id", ids),
        db().from("signup_comments").select("*").in("signup_id", ids).order("created_at"),
      ]);
      const byId = new Map<string, unknown[]>();
      for (const c of (cmts ?? []) as { signup_id: string }[]) {
        const list = byId.get(c.signup_id) ?? [];
        list.push(c);
        byId.set(c.signup_id, list);
      }
      const { writeSignupsBackBatch } = await import("@/lib/google/signups");
      await writeSignupsBackBatch(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((full ?? []) as any[]).map((sg) => ({
          signup: sg,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          comments: (byId.get(sg.id) ?? []) as any[],
          assignedDisplay: null,
        }))
      );
    } catch (e) {
      // the DB is right either way — the import reconciles the sheet
      console.error("[signups] release write-back failed:", e);
    }
    console.log(`[signups] released ${n} member-level sign-ups on ${oldRole}→${newRole} promotion`);
  }
  return n;
}

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
/** ONCE THEY HAVE FILED, STOP ASKING THE DATABASE (v33.59).
 *
 *  The app layout calls `needsMmPlan` AND `needsTlPlan` before rendering ANY
 *  page, so every MM in the LC paid two count queries per page view, forever,
 *  to be told the same thing they were told yesterday: yes, they filed. The
 *  hosting bill is made of exactly this kind of query.
 *
 *  Only the "they have filed" answer is remembered — never "they still need
 *  to", so the redirect that makes a new MM file on day one is untouched and
 *  can never be skipped by a stale cache. The TTL is there because plan rows
 *  CAN be deleted (`pruneStalePlans` drops the plans of someone whose role
 *  changed), and the redirect has to come back for them within the hour. */
const PLAN_FILED_TTL_MS = 1_800_000;
const planFiled = new Map<string, number>();

async function hasFiledPlan(table: "mm_plans" | "tl_plans", memberId: string): Promise<boolean> {
  const key = `${table}:${memberId}`;
  const at = planFiled.get(key);
  if (at !== undefined && Date.now() - at < PLAN_FILED_TTL_MS) return true;
  const { count, error } = await db()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId);
  // an unreadable table is not evidence of anything — say "filed" so nobody is
  // trapped in a redirect by a blip, exactly as `needsTlPlan` already did
  if (error) return true;
  const filed = (count ?? 0) > 0;
  if (filed) {
    if (planFiled.size > 200) planFiled.clear();
    planFiled.set(key, Date.now());
  }
  return filed;
}

export async function needsMmPlan(v: Viewer): Promise<boolean> {
  if (!isPlanningMm(v)) return false;
  return !(await hasFiledPlan("mm_plans", v.id));
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
  // pre-0018 grace (an unreadable table) is inside `hasFiledPlan`: it answers
  // "filed", which lands here as "doesn't need to" — never lock anyone out
  return !(await hasFiledPlan("tl_plans", v.id));
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

/** THE OGX PERIOD REPORT (v33.54).
 *
 *  OGX never had one: `buildFunctionReport` counts accounts, contacts, visits
 *  and opens, and an OGX crew has none of those — their funnel is sign-ups.
 *  Same email, same shape (KPIs + a team waterfall + last period in brackets),
 *  different numbers.
 *
 *  WHAT A WINDOW MEANS HERE. A sign-up carries one usable date — `signed_up_at`,
 *  free sheet text, normalised by `signupDayIso` — and the statuses carry none
 *  at all. So the window is the sign-ups that ARRIVED in it, and the funnel is
 *  where those particular people stand today. That is the honest reading of
 *  the data we hold, and the report says so in as many words rather than
 *  implying that eight approvals happened inside the fortnight. */
export async function buildOgxReport(
  fn: "OGT" | "OGV",
  window: { start: string; end: string },
  kind: "sprint" | "month" = "month",
  previous?: { start: string; end: string } | null
): Promise<FunctionReportData | null> {
  const { data: membersData } = await db()
    .from("members")
    .select("id, name, email, role, functions, sub_functions, stakeholder_id")
    .eq("is_active", true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (membersData ?? []) as any[];
  const inFn = (m: (typeof all)[number]) =>
    [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes(fn);
  const crew = all.filter(inFn);
  if (crew.length === 0) return null;
  const crewIds = new Set(crew.map((m) => m.id as string));
  const lcp = all.find((m) => m.role === "LCP");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await fetchAll<any>(() =>
    db()
      .from("signups")
      .select("assigned_to, assigned_at, contact_status, interested, status, signed_up_at, created_at, out_of_process")
      .eq("fn", fn)
      .order("id")
  );
  // WHEN A SIGN-UP BECAME WORK, NOT WHEN THEY FILLED THE FORM (v33.55 — the
  // first cut of this report keyed on `signed_up_at` alone and handed OGT a
  // row of zeroes for August. It was reading the truth about the wrong
  // question: OGT's tracker holds 2,079 people whose newest form is dated
  // 10 May, and the crew has been working that backlog all peak. The OGX
  // DASHBOARD has used `assigned_at ?? signed_up_at` since v33.47 for exactly
  // this reason; the report now uses the same rule, so the two agree.)
  const inWindow = (r: {
    assigned_at: string | null; signed_up_at: string | null; created_at: string;
  }) => {
    const day =
      signupDayIso(r.assigned_at) ?? signupDayIso(r.signed_up_at) ?? r.created_at.slice(0, 10);
    return !!day && day >= window.start && day <= window.end;
  };

  interface P { signups: number; contacted: number; interested: number; applied: number; accepted: number; approved: number }
  const zero = (): P => ({ signups: 0, contacted: 0, interested: 0, applied: 0, accepted: 0, approved: 0 });
  const stats = new Map<string, P>();
  const get = (id: string) => {
    let p = stats.get(id);
    if (!p) { p = zero(); stats.set(id, p); }
    return p;
  };
  const yes = (v: string | null) => !!v && /^y/i.test(v.trim());
  for (const r of rows) {
    if (r.out_of_process) continue;
    if (!r.assigned_to || !crewIds.has(r.assigned_to)) continue;
    if (!inWindow(r)) continue;
    const p = get(r.assigned_to);
    p.signups += 1;
    if (yes(r.contact_status)) p.contacted += 1;
    if (yes(r.interested)) p.interested += 1;
    // the status LADDER: approved implies accepted implies applied
    if (["Applied", "Accepted", "Approved"].includes(r.status ?? "")) p.applied += 1;
    if (["Accepted", "Approved"].includes(r.status ?? "")) p.accepted += 1;
    if (r.status === "Approved") p.approved += 1;
  }

  const sum = (ids: string[]): P =>
    ids.reduce((acc, id) => {
      const s = stats.get(id) ?? zero();
      acc.signups += s.signups; acc.contacted += s.contacted; acc.interested += s.interested;
      acc.applied += s.applied; acc.accepted += s.accepted; acc.approved += s.approved;
      return acc;
    }, zero());
  const cells = (who: string, p: P): (string | number)[] =>
    [who, p.signups, p.contacted, p.interested, p.applied, p.accepted, p.approved];

  // the waterfall:每 team (its leader) in bold, its people under it
  const headers = ["Who", "Sign-ups", "Contacted", "Interested", "Applied", "Accepted", "Approved"];
  const table: (string | number)[][] = [];
  const boldRows: number[] = [];
  const indentRows: number[] = [];
  const grouped = new Set<string>();
  for (const tl of crew.filter((m) => m.role === "Team Leader")) {
    const people = crew.filter((m) => m.stakeholder_id === tl.id && m.id !== tl.id);
    const ids = [tl.id, ...people.map((m) => m.id as string)];
    ids.forEach((id) => grouped.add(id));
    boldRows.push(table.length);
    table.push(cells(teamLabel(tl.name), sum(ids)));
    indentRows.push(table.length);
    table.push(cells(`${tl.name} (TL)`, stats.get(tl.id) ?? zero()));
    for (const p of people) {
      indentRows.push(table.length);
      table.push(cells(p.name, stats.get(p.id) ?? zero()));
    }
  }
  const loose = crew.filter(
    (m) => !grouped.has(m.id) && !["LCVP", "Director", "LCP"].includes(m.role)
  );
  if (loose.length > 0) {
    boldRows.push(table.length);
    table.push(cells("No team yet", sum(loose.map((m) => m.id as string))));
    for (const p of loose) {
      indentRows.push(table.length);
      table.push(cells(p.name, stats.get(p.id) ?? zero()));
    }
  }

  const total = sum([...crewIds]);
  const prev = previous ? await buildOgxReport(fn, previous, kind, null) : null;
  const cmp = (now: number, before: number | undefined): string | undefined => {
    if (before === undefined || prev === null) return undefined;
    const d = now - before;
    if (d === 0) return `same as last ${kind}`;
    return `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString("en")} vs last ${kind} (${before.toLocaleString("en")})`;
  };
  const kpis: [string, string, string?][] = [
    ["Sign-ups worked in this period", String(total.signups), cmp(total.signups, prev?.totals.mr)],
    ["Contacted", String(total.contacted), cmp(total.contacted, prev?.totals.contacts)],
    ["Interested", String(total.interested), cmp(total.interested, prev?.totals.visits)],
    ["Applied", String(total.applied), cmp(total.applied, prev?.totals.visitsDone)],
    ["Accepted", String(total.accepted), cmp(total.accepted, prev?.totals.deals)],
    ["Approved 🏆 (the MOS)", String(total.approved), cmp(total.approved, prev?.totals.opens)],
  ];

  // the filed MM plans that overlap the window — their goals for the period
  const mmPlanLines: string[] = [];
  const months = new Set<string>();
  {
    const c = new Date(`${window.start.slice(0, 7)}-01T00:00:00Z`);
    const endKey = window.end.slice(0, 7);
    for (let i = 0; i < 6; i++) {
      const key = c.toISOString().slice(0, 7);
      months.add(`${key}-01`);
      if (key >= endKey) break;
      c.setUTCMonth(c.getUTCMonth() + 1);
    }
  }
  const { data: plans } = await db()
    .from("mm_plans")
    .select("member_id, month, applicants, accepted, approvals")
    .in("month", [...months]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of (plans ?? []) as any[]) {
    const m = crew.find((c2) => c2.id === p.member_id);
    if (!m) continue;
    mmPlanLines.push(
      `${m.name} — ${String(p.month).slice(0, 7)}: ${p.applicants} applicants · ${p.accepted} accepted · ${p.approvals} approvals (plan)`
    );
  }

  const recipients = [
    ...crew.map((m) => m.email as string),
    ...(lcp?.email ? [lcp.email as string] : []),
  ].filter(Boolean);

  return {
    functionLabel: fn,
    recipients: [...new Set(recipients.map((e) => e.toLowerCase()))],
    // the OGX funnel reuses the ICX slots so one email template serves both
    totals: {
      mr: total.signups, contacts: total.contacted, visits: total.interested,
      visitsDone: total.applied, deals: total.accepted, opens: total.approved, egp: 0,
    },
    kpis,
    planLine:
      "Counted on the sign-ups HANDED OUT in this period (the tracker's own sign-up date when they were never assigned) — the funnel below is where those people stand today, since no status carries a date of its own.",
    waterfallHeaders: headers,
    waterfallRows: table,
    boldRows,
    indentRows,
    mmPlanLines,
  };
}

export interface FunctionReportData {
  functionLabel: string;
  recipients: string[]; // whole function + the LCP
  /** the window's own totals — what the NEXT period compares itself against */
  totals: {
    mr: number; contacts: number; visits: number; visitsDone: number;
    deals: number; opens: number; egp: number;
  };
  /** label · value · an optional "▲ 12 vs last sprint (31)" note (v33.54) */
  kpis: [string, string, string?][];
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
  kind: "sprint" | "month" = "month",
  /** the window BEFORE this one, for the comparison line. Pass null to skip it
   *  — the recursive call for the previous period does, so it can never
   *  recurse further than one step. */
  previous?: { start: string; end: string } | null
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
  // v33.45 — these were naive strings ("2026-08-01T00:00:00"), which PostgREST
  // hands to Postgres as UTC. The window is a CAIRO sprint/month, so every
  // report silently sliced the first 2–3 hours off the opening day and stole
  // the same hours from the day after the close. Anchor both ends in Cairo
  // and make the range half-open so midnight belongs to exactly one period.
  const { cairoToUtc } = await import("@/lib/time");
  const fromTs = cairoToUtc(window.start, "00:00").toISOString();
  const toTs = cairoToUtc(nextDayIso(window.end), "00:00").toISOString();
  const [accs, attempts, visitsBooked, visitsDone, deals, allocs] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll<any>(() =>
      db()
        .from("accounts")
        .select("id, responsible_id, created_at, is_test")
        .eq("is_test", false)
        .gte("created_at", fromTs)
        .lt("created_at", toTs)
        .order("id")
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll<any>(() =>
      db()
        .from("contact_attempts")
        .select("id, member_id, account_id, created_at, account:accounts!inner(responsible_id, is_test)")
        .eq("account.is_test", false)
        .gte("created_at", fromTs)
        .lt("created_at", toTs)
        .order("id")
    ),
    // "Visits" = the booking ACTION (visits.created_at), matching the members
    // directory. v33.45 — this used visit_date, so a member who booked three
    // visits on the 13th for the 16th–18th had that work moved OUT of the
    // sprint they did it in and INTO a sprint they had not worked yet: the
    // report said 2, the directory said 5, and neither agreed with the member.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll<any>(() =>
      db()
        .from("visits")
        .select("id, member_id, created_at, account:accounts!inner(responsible_id, is_test)")
        .eq("account.is_test", false)
        .gte("created_at", fromTs)
        .lt("created_at", toTs)
        .order("id")
    ),
    // "Done" = the day the visit ACTUALLY HAPPENED (visits.visit_date), a
    // Cairo calendar day, so it stays a plain date comparison.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll<any>(() =>
      db()
        .from("visits")
        .select("id, member_id, visit_date, account:accounts!inner(responsible_id, is_test)")
        .eq("account.is_test", false)
        .eq("done", true)
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
        .lt("created_at", toTs)
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
        .lt("deal.created_at", toTs)
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
  // booked and done are two different questions on two different dates, so
  // they are two different lists — a visit booked in this window and held in
  // the next counts once in each, which is what actually happened.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of (visitsBooked ?? []) as any[]) {
    const owner = v.account?.responsible_id;
    if (owner && crewIds.has(owner)) get(owner).visits++;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const v of (visitsDone ?? []) as any[]) {
    const owner = v.account?.responsible_id;
    if (owner && crewIds.has(owner)) get(owner).visitsDone++;
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
    rows.push(toCells(teamLabel(label(tl)), sum(ids)));
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
  // LAST PERIOD, FOR CONTEXT (v33.54). A number on its own says nothing about
  // whether the sprint went well — the same read over the PREVIOUS window of
  // the same length is what turns it into news. `prev` is null when there is
  // no previous window inside the peak, and then nothing is printed.
  const prev = previous ? await buildFunctionReport(fnKey, previous, kind, null) : null;
  const cmp = (now: number, before: number | undefined): string | undefined => {
    if (before === undefined || prev === null) return undefined;
    const d = now - before;
    if (d === 0) return `same as last ${kind}`;
    return `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toLocaleString("en")} vs last ${kind} (${before.toLocaleString("en")})`;
  };
  const kpis: [string, string, string?][] = [
    ["Market Research (accounts added)", String(total.mr), cmp(total.mr, prev?.totals.mr)],
    ["Contact attempts", String(total.contacts), cmp(total.contacts, prev?.totals.contacts)],
    ["Visits scheduled", String(total.visits), cmp(total.visits, prev?.totals.visits)],
    ["Visits done", String(total.visitsDone), cmp(total.visitsDone, prev?.totals.visitsDone)],
    ["Deals", String(total.deals), cmp(total.deals, prev?.totals.deals)],
    ["Opens raised", String(total.opens), cmp(total.opens, prev?.totals.opens)],
    ...(isB2BReport
      ? ([["BD money", `${total.egp.toLocaleString()} EGP`, cmp(total.egp, prev?.totals.egp)]] as [string, string, string?][])
      : []),
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
    totals: total,
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
    .select("id, scope, kind, starts_at, owner_id, owner_name, function_key, team_name, invited_teams, invited_functions, members")
    .in("id", ids)
    .order("starts_at", { ascending: false })
    .limit(30);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    // no organiser left = nobody to send a shout-out to
    .filter((tp) => tp.owner_id && tp.owner_id !== viewer.id)
    .map((tp) => ({
      id: tp.id,
      label: `${touchPointName(tp)} · ${cairoWhen(tp.starts_at)}`,
      ownerName: tp.owner_name,
    }));
}

/** Every PAST touch point the viewer can see — the pick-list for feedback about
 *  a session (v33.19). Attendance is no longer the gate: the LCP asked for
 *  feedback on anything they were part of, and a missing attendance row means
 *  nobody took the register, not that nobody was there. Cancelled points are
 *  out (there was no session to review), the viewer's own are out (nobody to
 *  send a shout-out to), newest first. */
export async function listPastTouchPointsForFeedback(
  viewer: Viewer
): Promise<AttendedTouchPointOption[]> {
  const { cairoWhen } = await import("@/lib/touch-points");
  const { viewerSeesTouchPoint } = await import("./touch-points-read");
  const { data, error } = await db()
    .from("touch_points")
    .select("*")
    .lte("starts_at", new Date().toISOString())
    .neq("status", "cancelled")
    .order("starts_at", { ascending: false })
    // visibility is a JS filter, so read a wider slab than the 60 we keep
    .limit(300);
  if (error) {
    console.error("[lc-feedback] past touch points failed:", error.message);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter((tp) => viewerSeesTouchPoint(viewer, tp))
    // no organiser left = nobody to send a shout-out to
    .filter((tp) => tp.owner_id && tp.owner_id !== viewer.id)
    .slice(0, 60)
    .map((tp) => ({
      id: tp.id,
      label: `${touchPointName(tp)} · ${cairoWhen(tp.starts_at)}`,
      ownerName: tp.owner_name,
    }));
}

/** The member's own outbox (v33.24) — what Sodio sent on their behalf, and
 *  the addresses they have written to before. */
export interface SentEmailRow {
  id: string;
  to: string[];
  cc: string[];
  subject: string;
  status: "sent" | "draft";
  createdAt: string;
}

/** THE GROUPS AN EMAIL CAN BE ADDRESSED TO (v33.27).
 *
 *  "Write to the EB" or "write to my team" meant looking up six addresses one
 *  at a time — which is how a person gets left off. The groups come from the
 *  membership itself, so they can never go stale: the EB, the LB, every
 *  function, every standing team, and everyone. */
export interface EmailGroup {
  key: string;
  label: string;
  emails: string[];
}

export async function listEmailGroups(viewer: Viewer): Promise<EmailGroup[]> {
  const [members, teams] = await Promise.all([listAllMembers(), listTeamsRegistry()]);
  const active = members.filter((m) => m.is_active && m.email && m.id !== viewer.id);
  const mail = (list: typeof active) =>
    [...new Set(list.map((m) => m.email as string))].sort();

  const groups: EmailGroup[] = [];
  const push = (key: string, label: string, list: typeof active) => {
    const emails = mail(list);
    if (emails.length > 0) groups.push({ key, label, emails });
  };

  // A GROUP BLAST IS AN MM'S TOOL (v33.41). The Emails tab belongs to every
  // member now, but "Everyone in the LC" on one click is reach a member never
  // had — and a mass mail nobody asked for is the fastest way to make the tab
  // something people mute. Members and Coordinators-in-name-only get the two
  // groups they are actually part of; MMs and above keep the whole set.
  const isMm =
    viewer.isAdmin ||
    ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(viewer.role);
  const ownFns = [...viewer.functions, ...viewer.sub_functions];
  if (!isMm) {
    const mineTeam = active.filter((m) => viewer.teamMemberIds.includes(m.id));
    if (mineTeam.length > 0)
      groups.push({ key: "myteam", label: "My team", emails: mail(mineTeam) });
    for (const fn of [...new Set(ownFns)].sort())
      push(
        `fn:${fn}`,
        `${fn} — the whole function`,
        active.filter((m) => [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes(fn))
      );
    return groups;
  }

  push("all", "Everyone in the LC", active);
  push(
    "eb",
    "The EB (LCP + LCVPs)",
    active.filter((m) => m.role === "LCP" || m.role === "LCVP")
  );
  push(
    "lb",
    "The LB (EB + Directors + MMs)",
    active.filter((m) =>
      ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(m.role)
    )
  );
  push(
    "mms",
    "All MMs (TLs & Coordinators)",
    active.filter((m) => ["Team Leader", "Coordinator"].includes(m.role))
  );

  // every function that actually has people
  const fns = [
    ...new Set(active.flatMap((m) => [...(m.functions ?? []), ...(m.sub_functions ?? [])])),
  ].sort();
  for (const fn of fns)
    push(
      `fn:${fn}`,
      `${fn} — the whole function`,
      active.filter((m) => [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes(fn))
    );

  // the standing teams, by the name on their membership row
  for (const t of teams.filter((t) => t.type === "Team")) {
    push(
      `team:${t.name}`,
      `Team — ${t.name}`,
      active.filter((m) => (m.team_name ?? "") === t.name)
    );
  }

  // and the viewer's own team, however it is named
  const mine = active.filter((m) => viewer.teamMemberIds.includes(m.id));
  if (mine.length > 0) groups.unshift({ key: "myteam", label: "My team", emails: mail(mine) });

  return groups;
}

export async function listMyEmails(
  viewer: Viewer,
  limit = 40
): Promise<{ rows: SentEmailRow[]; recents: string[] }> {
  if (!viewer?.id) return { rows: [], recents: [] };
  const { data } = await db()
    .from("sent_emails")
    .select("id, to_addresses, cc_addresses, subject, status, created_at")
    .eq("member_id", viewer.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    to: r.to_addresses ?? [],
    cc: r.cc_addresses ?? [],
    subject: r.subject,
    status: (r.status === "draft" ? "draft" : "sent") as "sent" | "draft",
    createdAt: r.created_at,
  }));
  // "who did I write to already" — newest first, de-duplicated
  const recents: string[] = [];
  for (const r of rows)
    for (const a of [...r.to, ...r.cc])
      if (a && !recents.includes(a) && recents.length < 25) recents.push(a);
  return { rows, recents };
}

export interface LcFeedbackRow {
  id: string;
  /** what KIND of feedback this is — the inbox is grouped by it (v33.22).
   *  A session note and a concern about a person need different handling, and
   *  gluing the session's name onto the message never let the inbox tell them
   *  apart. Rows filed before 0046 have no touch point, so old session notes
   *  read as their positive/negative kind. */
  kind: "concern" | "shoutout" | "session";
  positive: boolean;
  /** 1–5 stars on a touch-point review (v33.33); null on everything else */
  rating: number | null;
  anonymous: boolean;
  /** null when anonymous — EXCEPT for the break-glass admin (ADMIN_EMAILS),
   *  who sees the name so a shout-out can be rewarded and a concern followed
   *  up (v33.30). Everyone else who reads this inbox — the LCP, TM, F&L's
   *  LCVP — still gets null. */
  author: string | null;
  /** true when `author` is only populated because the viewer is that admin:
   *  the UI marks it so nobody repeats it into a room that shouldn't have it */
  authorAdminOnly: boolean;
  /** the author is still an active member, so "tell them it's handled" works */
  canTellAuthor: boolean;
  authorTold: boolean;
  aboutNames: string[];
  sessionLabel: string | null;
  message: string;
  attachments: { path: string; name: string }[];
  status: "new" | "done" | "archived";
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  sharedWith: string[];
  created_at: string;
}

/** The LC people-feedback inbox — `canSeeLcConcerns` (TM, the LCP, F&L's
 *  LCVP and the IM director). Anonymous rows never expose the author, not
 *  even here. */
export async function listLcFeedback(viewer: Viewer): Promise<LcFeedbackRow[]> {
  if (!_canSeeLcConcerns(viewer)) return [];
  const { cairoWhen } = await import("@/lib/touch-points");
  const [{ data }, { data: membersData }] = await Promise.all([
    db()
      .from("lc_feedback")
      .select(
        "id, positive, rating, anonymous, author_id, about, message, status, created_at, " +
          "attachments, touch_point_id, resolution, resolved_by, resolved_at, " +
          "shared_with, author_told_at, touch_point:touch_points(kind, scope, starts_at)"
      )
      .order("created_at", { ascending: false })
      .limit(300),
    db().from("members").select("id, name, is_active"),
  ]);
  const byId = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((membersData ?? []) as any[]).map((m) => [m.id, m])
  );
  const nameOf = (id: string | null) =>
    (id && byId.get(id)?.name) || "(left the LC)";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => {
    const tp = Array.isArray(r.touch_point) ? r.touch_point[0] : r.touch_point;
    return {
      id: r.id,
      kind: (r.touch_point_id
        ? "session"
        : r.positive
          ? "shoutout"
          : "concern") as LcFeedbackRow["kind"],
      positive: r.positive,
      rating: typeof r.rating === "number" ? r.rating : null,
      anonymous: r.anonymous,
      // ANONYMOUS IS ANONYMOUS TO THE ROOM, NOT TO THE ADMIN (v33.30). The
      // author id has always been stored (it is what lets "tell them it's
      // handled" reach someone who filed anonymously); this only decides who
      // is shown it, and that is ADMIN_EMAILS alone — not the LCP, not TM.
      author:
        r.anonymous && !viewer.isAdmin ? null : nameOf(r.author_id),
      authorAdminOnly: !!r.anonymous && !!viewer.isAdmin,
      canTellAuthor: !!r.author_id && !!byId.get(r.author_id)?.is_active,
      authorTold: !!r.author_told_at,
      aboutNames: (r.about ?? []).map((id: string) => nameOf(id)),
      sessionLabel: tp
        ? `${touchPointName(tp)} · ${cairoWhen(tp.starts_at)}`
        : null,
      message: r.message,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      status: (r.status === "done" || r.status === "archived"
        ? r.status
        : "new") as LcFeedbackRow["status"],
      resolution: r.resolution ?? null,
      resolvedBy: r.resolved_by ? nameOf(r.resolved_by) : null,
      resolvedAt: r.resolved_at ?? null,
      sharedWith: (r.shared_with ?? []).map((id: string) => nameOf(id)),
      created_at: r.created_at,
    };
  });
}

/** Recent audit-log rows (admin page). Actor joined for a readable name. */
/** What the console can narrow by. Every one of these is applied IN THE QUERY.
 *
 *  ⚠️ The old page fetched the newest 80 rows and grepped them in the BROWSER
 *  (admin-view.tsx), so "search" could not find anything older than the last 80
 *  actions — on a table of 14,000+ that is a search box that mostly lies. A log
 *  you cannot search is not an audit trail, it is a recent-activity widget. */
export interface AuditFilters {
  actorId?: string | null;
  action?: string | null;
  entity?: string | null;
  category?: string | null;
  outcome?: string | null;
  /** matches the summary, the action, the entity id and the details blob */
  q?: string | null;
  /** Cairo days, inclusive */
  from?: string | null;
  to?: string | null;
}

export interface AuditPage {
  rows: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/** The values the console's funnels may offer.
 *
 *  ⚠️ Built from the WHOLE table, never from the rows on screen. A funnel
 *  populated by the current page can only ever offer what happened to be on
 *  it — so filtering to "everything by Hana" would silently exclude Hana the
 *  moment she was not in the newest 60 actions. The same rule the accounts and
 *  sign-ups filters already follow.
 *
 *  Cached in module memory for a minute: it is four cheap DISTINCT-ish reads
 *  and the answer barely moves, but /admin is opened repeatedly while somebody
 *  is chasing one thing. NOT `unstable_cache` — `revalidatePath("/", "layout")`
 *  runs on ~94 write paths and would evict it continuously (the v33.46/v33.59
 *  lesson). */
let auditOptionsCache: { at: number; value: AuditFilterOptions } | null = null;

export interface AuditFilterOptions {
  actors: { value: string; label: string }[];
  actions: string[];
  entities: string[];
  categories: string[];
}

export async function auditFilterOptions(): Promise<AuditFilterOptions> {
  const now = Date.now();
  if (auditOptionsCache && now - auditOptionsCache.at < 60_000)
    return auditOptionsCache.value;

  // the action/entity/category vocabularies are small and bounded (102 actions
  // across 14k rows today), so a windowed scan of the recent past is both
  // cheaper and more useful than a full-table distinct: an action nobody has
  // taken in months is not worth offering.
  const { data } = await db()
    .from("audit_log")
    .select("action, entity, category, actor_id")
    .order("created_at", { ascending: false })
    .limit(4000);
  const rows = (data ?? []) as {
    action: string; entity: string; category: string | null; actor_id: string | null;
  }[];

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const actors: { value: string; label: string }[] = [];
  if (actorIds.length > 0) {
    const { data: ms } = await db()
      .from("members")
      .select("id, name")
      .in("id", actorIds);
    for (const m of (ms ?? []) as { id: string; name: string }[])
      actors.push({ value: m.id, label: m.name });
    actors.sort((a, b) => a.label.localeCompare(b.label));
  }

  const uniq = (xs: (string | null)[]) =>
    [...new Set(xs.filter(Boolean) as string[])].sort();

  const value: AuditFilterOptions = {
    actors,
    actions: uniq(rows.map((r) => r.action)),
    entities: uniq(rows.map((r) => r.entity)),
    // pre-0072 rows carry no category and were all plain data mutations
    categories: uniq(rows.map((r) => r.category ?? "data")),
  };
  auditOptionsCache = { at: now, value };
  return value;
}

export async function listRecentAudit(
  limit = 60,
  /** ADMIN_EMAILS only (v33.30): resolve the author behind an anonymous
   *  lc_feedback row, so a shout-out can be rewarded and a concern followed
   *  up. Everyone else with the logs page keeps seeing "system". */
  opts: { asAdmin?: boolean; filters?: AuditFilters; page?: number } = {}
): Promise<AuditEntry[]> {
  return (await listAuditPage(limit, opts)).rows;
}

/** The console reader: filtered, ordered and PAGED by Postgres. */
export async function listAuditPage(
  pageSize = 60,
  opts: { asAdmin?: boolean; filters?: AuditFilters; page?: number } = {}
): Promise<AuditPage> {
  const f = opts.filters ?? {};
  const page = Math.max(0, opts.page ?? 0);

  const build = () => {
    let q = db()
      .from("audit_log")
      .select(
        "id, action, entity, entity_id, details, created_at, change_set, undone_at, test_session_id, " +
          "changed, category, outcome, severity, summary, ip, " +
          "actor:members!actor_id(name), real_actor:members!real_actor_id(name)",
        { count: "exact" }
      );
    if (f.actorId) q = q.eq("actor_id", f.actorId);
    if (f.action) q = q.eq("action", f.action);
    if (f.entity) q = q.eq("entity", f.entity);
    if (f.category) q = q.eq("category", f.category);
    if (f.outcome) q = q.eq("outcome", f.outcome);
    // Cairo days → the instants that actually bound them. Half-open at the top
    // (the v33.49 lesson: a naive UTC range loses the first 2–3 hours of a day)
    // Cairo day bounds → UTC instants, half-open [start, end). A naive
    // "YYYY-MM-DDT00:00:00Z" is 2–3 hours out here and would quietly drop the
    // first evening of every range into the day before — the v33.49 lesson.
    // Same two helpers the directory window uses, rather than a third copy.
    if (f.from) q = q.gte("created_at", cairoToUtc(f.from, "00:00").toISOString());
    if (f.to) q = q.lt("created_at", cairoToUtc(nextDayIso(f.to), "00:00").toISOString());
    if (f.q && f.q.trim()) {
      // ⚠️ THE NEEDLE IS SCRUBBED, NOT ESCAPED. PostgREST's `or` takes a
      // comma-separated filter string, so a comma or a bracket in the search
      // box does not fail — it silently reinterprets the whole clause as extra
      // filters, which is the accidental version of the slug-lookup bug v33.15
      // spent a release on. `%` and `_` are LIKE wildcards and would widen the
      // match instead of narrowing it. All of them become spaces: a search box
      // that ignores punctuation is expected; one that quietly changes what it
      // searched for is not.
      const needle = f.q.trim().replace(/[%_,().*]/g, " ").trim();
      if (needle)
        q = q.or(
          [
            `summary.ilike.%${needle}%`,
            `action.ilike.%${needle}%`,
            `entity.ilike.%${needle}%`,
          ].join(",")
        );
    }
    return q.order("created_at", { ascending: false });
  };

  const from = page * pageSize;
  const { data, count } = await build().range(from, from + pageSize - 1);
  // pre-0072/0033 grace: fall back to the classic columns so the console still
  // renders on a database where the migration hasn't been run yet. The same
  // three-shape ladder logAudit itself walks (src/server/audit.ts) — code and
  // schema ship on two clocks here, because migrations are applied by hand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any[] | null = data;
  let total = count ?? null;
  if (!raw) {
    const { data: legacy, count: legacyCount } = await db()
      .from("audit_log")
      .select(
        "id, action, entity, entity_id, details, created_at, change_set, undone_at, test_session_id, actor:members!actor_id(name)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    raw = legacy;
    total = legacyCount ?? null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (raw ?? []) as any[];
  // how many journal rows each action can actually reverse — an entry with
  // none shows a disabled Undo and says why, instead of lying
  const { changeSetSizes } = await import("./sandbox");
  const sizes = await changeSetSizes(
    [...new Set(rows.map((r) => r.change_set).filter(Boolean))] as string[]
  );
  // WHO FILED THE ANONYMOUS ONE — for the break-glass admin alone. The audit
  // row carries no actor by design; this reads the feedback it points at.
  const anonAuthors = new Map<string, string>();
  if (opts.asAdmin) {
    const ids = rows
      .filter((r) => r.action === "lc_feedback" && !r.actor && r.details?.feedback_id)
      .map((r) => r.details.feedback_id as string);
    if (ids.length > 0) {
      const { data: fb } = await db()
        .from("lc_feedback")
        .select("id, author:members!author_id(name)")
        .in("id", [...new Set(ids)]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of ((fb ?? []) as any[])) {
        const a = Array.isArray(row.author) ? row.author[0] : row.author;
        if (a?.name) anonAuthors.set(row.id, a.name);
      }
    }
  }
  const anonAuthorFor = (r: { action: string; actor: unknown; details: { feedback_id?: string } | null }) =>
    r.action === "lc_feedback" && !r.actor && r.details?.feedback_id
      ? anonAuthors.get(r.details.feedback_id) ?? null
      : null;

  const one = (r: Record<string, any>) => {
    const real = Array.isArray(r.real_actor) ? r.real_actor[0] : r.real_actor;
    return {
      id: r.id,
      action: r.action,
      entity: r.entity,
      actor: r.actor ? r.actor.name : anonAuthorFor(r as never),
      actorAdminOnly: !r.actor && !!anonAuthorFor(r as never),
      realActor: real?.name ?? null,
      details: r.details ? JSON.stringify(r.details) : null,
      changed: r.changed ? JSON.stringify(r.changed) : null,
      // pre-0072 rows carry none of these; they were all a completed data
      // mutation by the named actor, which is exactly what the defaults say
      category: r.category ?? "data",
      outcome: r.outcome ?? "ok",
      severity: r.severity ?? "info",
      summary: r.summary ?? null,
      createdAt: r.created_at,
      changeSet: r.change_set ?? null,
      undoable: r.undone_at || !r.change_set ? 0 : (sizes.get(r.change_set) ?? 0),
      undoneAt: r.undone_at ?? null,
      inTestSession: !!r.test_session_id,
    };
  };
  return { rows: rows.map(one), total: total ?? rows.length, page, pageSize };
}

// ================================================================== OGX sign-ups (v25)

import {
  canEditSignupVpFields as _canEditSignupVpFields,
  canViewSignup as _canViewSignup,
  canWorkSignup as _canWorkSignup,
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
  assigned?: string;
  campaign?: string;
  /** CIC view only — narrow the queue to the second calls handed to ME */
  cicMine?: boolean;
  /** CIC view only — WHO MADE THE FIRST CALL, by member id (comma list).
   *  Ids and not the stored name, which is what the `assigned` funnel matches:
   *  the trackers hold two spellings of the same person ("Ahmed kadry" and
   *  "Ahmed Kadry", 7 rows each), so a name pick silently drops half of their
   *  work. See `cicFirstCallerOptions`. */
  firstCaller?: string;
  /** rows with a missing/unusable phone (null, empty or "deleted…") */
  /** "missing" = no usable number · "has" = a number exists. A comma list
   *  ("has,missing") is accepted and means "either" — see the reader. */
  phone?: string;
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
/** THE VALUES A COLUMN ACTUALLY HOLDS, across the WHOLE set (v33.15).
 *
 *  Column filters were built from the rows on screen, so with 20 rows a page
 *  the "Campaign" funnel offered whatever those twenty happened to contain and
 *  filtering by anything else was impossible. A filter has to know every value
 *  in the data, not every value in the viewport.
 *
 *  One cheap distinct read per column, cached for five minutes: these lists
 *  change when a tracker import lands, not between clicks.
 */
export async function signupFilterOptions(
  viewer: Viewer,
  fn: OgxFunction
): Promise<Record<string, string[]>> {
  // the B2C crew reads the same pool through their CIC queue (v33.29) — their
  // column funnels would otherwise be present but empty
  if (!_ogxLanes(viewer).includes(fn) && !b2cCicAccess(viewer)) return {};
  const COLUMNS = ["campaign", "person_status", "assigned_name", "country", "program"];
  const { unstable_cache } = await import("next/cache");
  const read = unstable_cache(
    async () => {
      const out: Record<string, string[]> = {};
      // CURRENT membership of this function — the Assigned filter must offer
      // the people who work the lane TODAY, not every name the trackers ever
      // held (ex-members and people who moved functions kept appearing there)
      const { data: crew } = await db()
        .from("members")
        .select("id, name, role, functions, sub_functions")
        .eq("is_active", true);
      const fnCrew = (
        (crew ?? []) as {
          id: string;
          name: string;
          role: string;
          functions: string[] | null;
          sub_functions: string[] | null;
        }[]
      ).filter(
        (m) =>
          m.role !== "LCP" &&
          [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes(fn)
      );
      const collapse = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const currentNames = new Set(fnCrew.map((m) => collapse(m.name)));
      // the trackers hold loose spellings ("A.Samir", first+last) that the
      // importer's matcher DOES resolve to current members — those stored
      // values must stay filterable, or filtering by the member's full name
      // would return nothing (the query matches assigned_name verbatim)
      const { matchMemberByName } = await import("@/lib/google/signups");
      const crewLite = fnCrew.map((m) => ({ id: m.id, name: m.name, is_active: true }));
      const belongsToCurrent = (v: string) =>
        currentNames.has(collapse(v)) || matchMemberByName(v, crewLite) !== null;
      for (const col of COLUMNS) {
        const { data } = await db()
          .from("signups")
          .select(col)
          .eq("fn", fn)
          .not(col, "is", null)
          .limit(5000);
        const seen = new Set<string>();
        for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
          const v = String(row[col] ?? "").trim();
          if (v) seen.add(v);
        }
        const values =
          col === "assigned_name"
            ? // keep the STORED casing (the filter queries eq/in on it), but
              // only names that belong to the lane's current membership
              [...seen].filter(belongsToCurrent)
            : [...seen];
        out[col] = values.sort((a, b) => a.localeCompare(b)).slice(0, 200);
      }
      return out;
    },
    ["signup-filter-options", fn],
    { revalidate: 300 }
  );
  return read();
}

/** THE CIC POOL, as a predicate (v34.11): held by a real member, the first
 *  call ANSWERED (Yes or No — either way it happened), no status yet. Read by
 *  the queue itself AND by the 1st-caller funnel's option list, so the funnel
 *  can never offer somebody with nothing in the queue. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cicPoolFilter<T extends { not: any; neq: any; is: any }>(q: T): T {
  return q
    .not("assigned_to", "is", null)
    .not("contact_status", "is", null)
    .neq("contact_status", "")
    .is("status", null);
}

/** WHO MADE THE FIRST CALL — the CIC queue's own funnel (v34.11).
 *
 *  The first assignee was already ON the queue (the "Assigned" column IS the
 *  first caller), but the only way to narrow by them was the name-string
 *  funnel every other view uses, and a stored name is a snapshot: the same
 *  person appears under two spellings, so picking one dropped the other half
 *  of their rows. This lists PEOPLE, by id, labelled with the member's CURRENT
 *  name — one option per human however many ways the tracker typed them.
 *
 *  Offered only to whoever sees the WHOLE queue. Below an MM the CIC view is
 *  just the second calls handed to you, and a funnel over other people's
 *  first callers would mostly return nothing.
 */
export async function cicFirstCallerOptions(
  viewer: Viewer,
  fn?: OgxFunction | null
): Promise<{ value: string; label: string }[]> {
  const fns = _ogxFunctions(viewer);
  const b2cOnly = fns.length === 0 && b2cCicAccess(viewer);
  if (fns.length === 0 && !b2cOnly) return [];
  if (!(b2cOnly ? seesB2cCicQueue(viewer) : seesCicQueue(viewer))) return [];
  const scope: OgxFunction[] = b2cOnly ? ["OGT", "OGV"] : fns;
  // B2C's queue spans BOTH sides until a side chip is pressed — the option
  // list has to span it too, or half the callers are unreachable
  const want = fn && scope.includes(fn) ? [fn] : scope;

  const { unstable_cache } = await import("next/cache");
  const read = unstable_cache(
    async () => {
      const { data } = await cicPoolFilter(
        db().from("signups").select("assigned_to, assigned_name").in("fn", want)
      ).limit(5000);
      const rows = (data ?? []) as {
        assigned_to: string | null;
        assigned_name: string | null;
      }[];
      const byId = new Map<string, string>();
      for (const r of rows) {
        if (!r.assigned_to) continue;
        if (!byId.get(r.assigned_to)) byId.set(r.assigned_to, (r.assigned_name ?? "").trim());
      }
      if (byId.size === 0) return [];
      const { data: people } = await db()
        .from("members")
        .select("id, name")
        .in("id", [...byId.keys()]);
      for (const m of (people ?? []) as { id: string; name: string | null }[]) {
        // the member's name today beats whatever spelling the sheet stored —
        // a caller who has since left keeps their snapshot rather than
        // vanishing from the funnel while their rows sit in the queue
        if (m.name?.trim()) byId.set(m.id, m.name.trim());
      }
      return [...byId.entries()]
        .map(([value, label]) => ({ value, label: label || "—" }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    ["cic-first-callers", want.join(",")],
    { revalidate: 300 }
  );
  return read();
}

/** MMs and above (the people who distribute) — TL/Coordinator/VP/Director/
 *  LCP/admin. Members are excluded (the CIC queue is a distribution job). */
/** A sign-up's edit history (v33.19) — newest first, capped. */
export async function listSignupLogs(
  viewer: Viewer,
  signupId: string
): Promise<import("@/lib/types").SignupLog[]> {
  const { data: row } = await db()
    .from("signups").select("*").eq("id", signupId).maybeSingle<SignupRow>();
  if (!row) return [];
  if (!_canViewSignup(viewer, row) && !seesB2cCicQueue(viewer)) {
    // a B2C caller reads the history of the sign-up handed to them
    if (!b2cCicAccess(viewer)) return [];
    const { data: myCall } = await db()
      .from("signup_cic_calls")
      .select("id")
      .eq("signup_id", signupId)
      .eq("side", "B2C")
      .eq("caller_id", viewer.id)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!myCall) return [];
  }
  const { data } = await db()
    .from("signup_logs")
    .select("id, signup_id, member_name, field, old_value, new_value, at")
    .eq("signup_id", signupId)
    .order("at", { ascending: false })
    .limit(50);
  return (data ?? []) as import("@/lib/types").SignupLog[];
}

export function seesCicQueue(v: Viewer): boolean {
  return (
    v.isAdmin ||
    ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(v.role)
  );
}

/** B2C's OWN CIC (v33.29): the B2C crew calls the same sign-up pool — people
 *  the OGX first call already reached — to SELL courses/events, never to move
 *  the OGX funnel. MMs and leaders hand the calls out; a plain B2C member
 *  only sees the ones handed to them. */
export function seesB2cCicQueue(v: Viewer): boolean {
  return (
    isB2C(v) &&
    (v.isAdmin ||
      ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(v.role))
  );
}

/** any B2C member — enough to see and record their OWN handed-out calls */
export function b2cCicAccess(v: Viewer): boolean {
  return isB2C(v);
}

/** THE B2C CIC DASHBOARD (v33.29): what the selling side is doing with the
 *  sign-up pool — handed out, called, interested, this month, per member. */
export interface B2cCicStats {
  assigned: number;
  called: number;
  interestedYes: number;
  thisMonth: number;
  openNow: number;
  byMember: { name: string; assigned: number; called: number; interested: number }[];
}

export async function b2cCicStats(viewer: Viewer): Promise<B2cCicStats | null> {
  if (!b2cCicAccess(viewer) && !_master(viewer)) return null;
  const { data } = await db()
    .from("signup_cic_calls")
    .select("caller_name, contact_status, interested, assigned_at")
    .eq("side", "B2C")
    .limit(5000);
  const rows = (data ?? []) as {
    caller_name: string; contact_status: string | null;
    interested: string | null; assigned_at: string;
  }[];
  const monthStart = monthOf().start;
  const byMember = new Map<string, { name: string; assigned: number; called: number; interested: number }>();
  for (const r of rows) {
    const m = byMember.get(r.caller_name) ?? { name: r.caller_name, assigned: 0, called: 0, interested: 0 };
    m.assigned += 1;
    if (r.contact_status) m.called += 1;
    if (/^y/i.test(r.interested ?? "")) m.interested += 1;
    byMember.set(r.caller_name, m);
  }
  return {
    assigned: rows.length,
    called: rows.filter((r) => r.contact_status).length,
    interestedYes: rows.filter((r) => /^y/i.test(r.interested ?? "")).length,
    thisMonth: rows.filter((r) => r.assigned_at >= monthStart).length,
    openNow: rows.filter((r) => !r.contact_status).length,
    byMember: [...byMember.values()].sort((a, b) => b.assigned - a.assigned).slice(0, 12),
  };
}

export function signupViewsFor(v: Viewer): string[] {
  // a pure-B2C viewer (no OGX access) enters /signups for ONE thing: the CIC
  // queue they sell into. No pool, no mine, no archive.
  if (_ogxFunctions(v).length === 0 && b2cCicAccess(v)) return ["cic"];
  const leader =
    v.isAdmin || ["LCP", "LCVP", "Director"].includes(v.role);
  // v33.32 — the function's own defaults: is the CIC second call in use here,
  // and has this floor been opened to the viewer's role?
  const ogxFns = _ogxFunctions(v);
  const cicOn = ogxFns.length === 0 || ogxFns.some((f) => _fnSetting(v, f).cicEnabled);
  const openFloor = ogxFns.some((f) => (v.openViewFns ?? []).includes(f));
  // THE POOL IS NOT A MEMBER'S VIEW (v33.10). Sign-ups are handed out by the
  // Team Leader — a member browsing the unclaimed pool picks the easy ones and
  // the distribution stops being anyone's decision. MMs and above still see
  // it, because assigning IS their job. A member lands on "My sign-ups".
  const seesPool = leader || ["Team Leader", "Coordinator"].includes(v.role);
  return [
    ...(seesPool ? ["unassigned"] : []),
    // v33.14 — "My team" is gone: since "mine" became what you ANSWER for
    // (a TL's own plus their team's), the two tabs showed the same rows.
    "mine",
    // CIC — Customer Interview Calls (v33.19): a SECOND caller verifies the
    // first contact and follows up. MMs+ see the queue; members see "My CIC"
    // (the ones handed to them as the second caller). Off when the function's
    // leader has no second-call step (v33.32).
    ...(cicOn ? ["cic"] : []),
    // 🤝 REFERRALS (v33.32.2) — their own tab. They behave like any sign-up,
    // but they are a handful among thousands of tracker rows and the people
    // who log them want to watch exactly those.
    "referral",
    ...(leader || openFloor ? ["all"] : []),
    "archived",
  ];
}

/** Paginated, scoped sign-ups list. Scope: leaders → their function(s); TL →
 *  own + team + the unassigned pool; members → own + unassigned. The
 *  "archived" view (Out of Process) is read-only browsing for the crew. */
/** A list row + what THIS viewer may do to it inline (v33.17) — mirrors
 *  getSignupDetail's canWork/canVp/canSetStatus, so the table can offer the
 *  same edits the dialog does without a round-trip per row. */
export type SignupListRow = SignupRow & {
  can_work?: boolean;
  can_set_status?: boolean;
  can_vp?: boolean;
  /** the sign-up's CIC call history (v33.29) — side-tagged, newest first */
  cic_calls?: SignupCicCall[];
  /** the whole comment thread (v33.32.2), oldest first — so the list can show
   *  it and take a new one without opening the sign-up */
  comments_all?: SignupComment[];
  /** v36 — THE B2C CALL THIS VIEWER STILL OWES ON THIS ROW, if any.
   *
   *  Set only when the viewer may record a B2C call that has not been recorded
   *  yet. It exists because tapping Call/WhatsApp opened the OGX contact form
   *  for EVERYONE, and a B2C caller is not the sign-up's owner — so pressing
   *  "Log it" returned a flat "You are not allowed to work this sign-up."
   *  They were being handed somebody else's form. With this the list can offer
   *  the B2C form instead, which is the one they can actually save.
   *
   *  ⚠️ Resolved on the SERVER, next to `can_work`, deliberately: the browser
   *  would have to reimplement "is this call mine, is it still open, am I a
   *  B2C MM" and would drift from `updateB2cCic`'s own gate the first time
   *  either changed. */
  my_open_b2c_call_id?: string | null;
};

export interface SignupCicCall {
  id: string;
  signup_id: string;
  side: "OGX" | "B2C";
  caller_id: string | null;
  caller_name: string;
  assigned_by_name: string | null;
  assigned_at: string;
  contact_status: string | null;
  interested: string | null;
  note: string | null;
  /** v35.1 — what actually happened on the call (B2C). `contact_status` is
   *  derived from it, so both are present and never disagree. */
  outcome: string | null;
  /** the appointment, when the outcome is "call back" */
  call_back_at: string | null;
  created_at: string;
}

export async function listSignupsPage(
  viewer: Viewer,
  filters: SignupFilters,
  page: number,
  pageSize = 100
): Promise<{ rows: SignupListRow[]; total: number; page: number; view: string }> {
  const fns = _ogxFunctions(viewer);
  // B2C RIDES IN ON THE CIC VIEW ONLY (v33.29): both OGX sides' queues, since
  // they sell to whoever answered — the fn chips still narrow to one side
  const b2cOnly = fns.length === 0 && b2cCicAccess(viewer);
  if (fns.length === 0 && !b2cOnly)
    return { rows: [], total: 0, page: 0, view: "unassigned" };
  const allowedViews = signupViewsFor(viewer);
  // DEFAULT TO YOUR OWN WORK (v33.15). The pool was the landing view, so
  // every MM and member opened on a list of hundreds of names that were not
  // theirs, and had to click away to find what they were actually doing.
  const view = allowedViews.includes(filters.view ?? "")
    ? filters.view!
    : allowedViews.includes("mine")
      ? "mine"
      : (allowedViews[0] ?? "mine");

  const scopeFns: OgxFunction[] = b2cOnly ? ["OGT", "OGV"] : fns;
  // a B2C member's "mine" = sign-ups whose OPEN B2C call is theirs; resolved
  // to ids before the query (the queue itself is small enough for .in())
  let myB2cSignupIds: string[] = [];
  if (b2cOnly && (!seesB2cCicQueue(viewer) || filters.cicMine)) {
    const { data: mine } = await db()
      .from("signup_cic_calls")
      .select("signup_id")
      .eq("side", "B2C")
      .eq("caller_id", viewer.id)
      .limit(1000);
    myB2cSignupIds = [...new Set((mine ?? []).map((r) => r.signup_id as string))];
  }
  const build = () => {
    let q = db().from("signups").select("*", { count: "exact" });
    // function scope
    const fn =
      filters.fn && scopeFns.includes(filters.fn as OgxFunction) ? [filters.fn] : scopeFns;
    q = q.in("fn", fn);
    // view scope
    // the CIC queue keeps ARCHIVED rows in view (v33.29, by request): a call
    // that ended in Out of Process is still a first call worth verifying
    if (view === "archived") q = q.eq("out_of_process", true);
    else if (view !== "cic") q = q.eq("out_of_process", false);
    if (view === "unassigned") q = q.is("assigned_to", null);
    else if (view === "referral") {
      // organic referrals only — scoped like "mine" for everyone who isn't a
      // leader, so a member watches the ones they logged or were handed
      q = q.eq("source", "referral");
      const leader = viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
      if (!leader) {
        const seesFloor = (viewer.openViewFns ?? []).some((f) => scopeFns.includes(f as OgxFunction));
        if (!seesFloor)
          q =
            viewer.role === "Team Leader"
              ? q.in("assigned_to", [viewer.id, ...viewer.teamMemberIds])
              : q.eq("assigned_to", viewer.id);
      }
    }
    else if (view === "cic") {
      // THE CIC POOL (rule tightened + widened in v33.22):
      //   · held by a REAL Sodio member (assigned_to, not a raw sheet name) —
      //     the journey is pool → assigned → first call → CIC, so a row still
      //     waiting for its FIRST call must never appear here;
      //   · Contacted ANSWERED — Yes or No. The first caller reached them or
      //     didn't; either way the call happened and is what gets verified.
      //     The old rule matched "y%" only, so every "No" sat in nobody's
      //     queue — the exact rows a second call exists for.
      //   · no status yet, and not out of process.
      q = cicPoolFilter(q);
      // a member below MM only ever sees their own second calls; an MM can
      // ask for the same view with the 🙋 Mine chip. For B2C both cases mean
      // "sign-ups whose open B2C call is mine" — resolved to ids up front.
      if (b2cOnly) {
        if (!seesB2cCicQueue(viewer) || filters.cicMine)
          q = q.in("id", myB2cSignupIds.length > 0 ? myB2cSignupIds : ["00000000-0000-0000-0000-000000000000"]);
      } else if (!seesCicQueue(viewer) || filters.cicMine)
        q = q.eq("cic_assigned_to", viewer.id);
    }
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
      // "none" = NOBODY HAS CALLED YET (v33.37) — null or an empty cell, the
      // rows still waiting for their first touch. Yes/No both mean a call
      // happened; this is the third state the funnel was missing.
      const picks = pickList(filters.contacted);
      const wantsNone = picks.includes("none");
      const yesNo = picks.filter((v) => v !== "none");
      const clauses = yesNo.map((v) => `contact_status.ilike.${ynPat(v)}`);
      if (wantsNone) clauses.push("contact_status.is.null", "contact_status.eq.");
      if (clauses.length === 1 && !wantsNone)
        q = q.ilike("contact_status", ynPat(yesNo[0]));
      else if (clauses.length > 0) q = q.or(clauses.join(","));
    }
    if (filters.country) q = q.ilike("country", `%${filters.country}%`);
    {
      const picks = pickList(filters.personStatus);
      if (picks.length === 1) q = q.eq("person_status", picks[0]);
      else if (picks.length > 1) q = q.in("person_status", picks);
    }
    // WHO HOLDS IT (v33.14) — "__none" is the unassigned pool, which is NULL
    // and therefore cannot be `in`-ed alongside names
    {
      const picks = pickList(filters.assigned);
      const wantsNone = picks.includes("__none");
      const names = picks.filter((p) => p !== "__none");
      if (wantsNone && names.length === 0) q = q.is("assigned_to", null);
      else if (wantsNone && names.length > 0)
        q = q.or(
          `assigned_name.is.null,assigned_name.in.(${names.map((n) => `"${n}"`).join(",")})`
        );
      else if (names.length === 1) q = q.eq("assigned_name", names[0]);
      else if (names.length > 1) q = q.in("assigned_name", names);
    }
    // WHO MADE THE FIRST CALL (v34.11) — the CIC funnel. By member id, so two
    // spellings of one person are one pick; a hand-typed value that isn't an
    // id is dropped rather than sent to the database.
    {
      const ids = pickList(filters.firstCaller).filter((v) => UUID_RE.test(v));
      if (ids.length === 1) q = q.eq("assigned_to", ids[0]);
      else if (ids.length > 1) q = q.in("assigned_to", ids);
    }
    {
      const picks = pickList(filters.campaign);
      if (picks.length === 1) q = q.eq("campaign", picks[0]);
      else if (picks.length > 1) q = q.in("campaign", picks);
    }
    // phone filter (v27, both directions): "missing" = null / empty / the
    // sheets' "deleted phone number" or "-" placeholders; "has" = a usable
    // number (the importer nulls digit-free phones since v33.15 — the
    // placeholder branches cover rows imported before that)
    // COMMA-AWARE like every other column funnel (v33.23): the funnel control
    // is multi-select, so it can emit "has,missing" — which means "either",
    // i.e. no filter at all. Reading it strictly (=== "has") made that case
    // fall through as `undefined` while the funnel still showed 2 picks
    // selected: a control that lies about what it is doing.
    {
      const picks = pickList(filters.phone).filter(
        (p) => p === "has" || p === "missing"
      );
      if (picks.length === 1 && picks[0] === "missing")
        q = q.or("phone.is.null,phone.eq.,phone.eq.-,phone.ilike.%deleted%");
      else if (picks.length === 1)
        q = q
          .not("phone", "is", null)
          .neq("phone", "")
          .neq("phone", "-")
          .not("phone", "ilike", "%deleted%");
    }
    if (filters.q) {
      const safe = filters.q.replaceAll(",", " ").replaceAll("(", "").replaceAll(")", "");
      q = q.or(`name.ilike.%${safe}%,ep_id.ilike.%${safe}%,phone.ilike.%${safe}%`);
    }
    // NEWEST HAND-OUT ON TOP (v33.58). Every list of assigned sign-ups opened
    // on `signed_up_at` — the day the person filled the form, which for OGT is
    // often months before anybody was given them (their newest tracker row is
    // dated 10 May). So a sign-up handed to you this morning landed wherever
    // its form date put it, frequently pages deep, and the one row you came
    // to the page for was the hardest to find. `assigned_at` is the date that
    // answers "what is new FOR ME", and it is what these views now open on.
    //
    // The pool is the exception and stays on the sign-up date: nothing there
    // has been assigned, so every `assigned_at` is null and the column would
    // rank nothing. Same for the CIC queue, which is ordered by the second
    // call, not the first hand-over.
    const poolLike = view === "unassigned" || view === "cic";
    const sortField =
      filters.sort && SIGNUP_SORTABLE.has(filters.sort)
        ? filters.sort
        : poolLike
          ? "signed_up_at"
          : "assigned_at";
    q = q.order(sortField, { ascending: filters.dir === "asc", nullsFirst: false });
    // a sign-up that predates the assigned_at column (or was claimed before it
    // was stamped) still needs a stable place — the form date decides it
    if (sortField !== "signed_up_at")
      q = q.order("signed_up_at", { ascending: false, nullsFirst: false });
    return q.order("id");
  };

  // inline-edit capability flags, same rules as getSignupDetail (v33.17)
  const withCaps = (rows: SignupRow[]): SignupListRow[] =>
    rows.map((r) => {
      const work = _canWorkSignup(viewer, r);
      const vp = _canEditSignupVpFields(viewer, r);
      return {
        ...r,
        can_work: work,
        can_vp: vp,
        can_set_status:
          vp ||
          ((viewer.role === "Team Leader" || viewer.role === "Coordinator") && work),
      };
    });

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
    return { rows: withCaps((res2.data ?? []) as SignupRow[]), total, page: lastPage, view };
  }
  let rows = withCaps((data ?? []) as SignupRow[]);
  // the CIC view shows WHO IS CALLING on each side — one query for the page
  if (view === "cic" && rows.length > 0) {
    const { data: calls } = await db()
      .from("signup_cic_calls")
      .select("id, signup_id, side, caller_id, caller_name, assigned_by_name, assigned_at, contact_status, interested, note, outcome, call_back_at, created_at")
      .in("signup_id", rows.map((r) => r.id))
      .order("created_at", { ascending: false });
    const byId = new Map<string, SignupCicCall[]>();
    for (const c of (calls ?? []) as SignupCicCall[]) {
      const list = byId.get(c.signup_id) ?? [];
      list.push(c);
      byId.set(c.signup_id, list);
    }
    // v36 — WHICH B2C CALL IS THIS VIEWER'S TO RECORD.
    //
    // ⚠️ It is resolved HERE and not in `withCaps` above, because withCaps runs
    // before this block and `cic_calls` is attached by it — a flag computed up
    // there would read an undefined list and be null on every row, which is
    // exactly the kind of silently-always-false gate that makes a feature look
    // implemented and behave as if it were not.
    //
    // Mirrors `updateB2cCic`'s own gate (the assigned caller, or any B2C MM),
    // so the form the list offers is always one the server will accept. "Open"
    // means nothing has been recorded yet — a call already marked answered, or
    // busy/dead, is finished business and must not reopen as a prompt.
    const b2cMm = seesB2cCicQueue(viewer);
    rows = rows.map((r) => {
      const calls = byId.get(r.id) ?? [];
      const mine = calls.find(
        (c) =>
          c.side === "B2C" &&
          !c.outcome &&
          !c.contact_status &&
          (c.caller_id === viewer.id || b2cMm)
      );
      return { ...r, cic_calls: calls, my_open_b2c_call_id: mine?.id ?? null };
    });
  }
  // COMMENTS ON THE LIST (v33.32.2) — the raising table has carried its
  // thread and a ➕ since v33.17; OGX had to open a sign-up to read or leave
  // one, which is why so much of the calling context lived in WhatsApp
  // instead. One query for the page, oldest first (the column reverses it).
  if (rows.length > 0) {
    const { data: comments } = await db()
      .from("signup_comments")
      .select("id, signup_id, author_name, author_class, body, created_at")
      .in("signup_id", rows.map((r) => r.id))
      .order("created_at");
    const byId = new Map<string, SignupComment[]>();
    for (const c of (comments ?? []) as SignupComment[]) {
      const list = byId.get(c.signup_id) ?? [];
      list.push(c);
      byId.set(c.signup_id, list);
    }
    rows = rows.map((r) => ({ ...r, comments_all: byId.get(r.id) ?? [] }));
  }
  return {
    rows,
    total,
    page: Math.floor(from / pageSize),
    view,
  };
}

export interface SignupDetail {
  signup: SignupRow;
  comments: SignupComment[];
  assignedLabel: string | null;
  canWork: boolean;
  canVp: boolean;
  /** may move the sign-up along the pipeline — MMs and above (v33.14) */
  canSetStatus: boolean;
  /** the B2C side of this row (v35.1): the caller it was handed to, or
   *  whoever runs the B2C queue. They may leave a B2C comment — their own
   *  class, which never reaches the OGX tracker's cells. */
  canB2c: boolean;
}

export async function getSignupDetail(
  viewer: Viewer,
  id: string
): Promise<SignupDetail | null> {
  const { data } = await db().from("signups").select("*").eq("id", id).maybeSingle<SignupRow>();
  if (!data) return null;
  if (!_canViewSignup(viewer, data)) {
    // a B2C caller opens the sign-up HANDED TO THEM — view only, like the
    // OGX second-caller clause (v33.19 ⑧); recording goes through its own gate
    if (!b2cCicAccess(viewer)) return null;
    const { data: myCall } = await db()
      .from("signup_cic_calls")
      .select("id")
      .eq("signup_id", id)
      .eq("side", "B2C")
      .eq("caller_id", viewer.id)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!myCall && !seesB2cCicQueue(viewer)) return null;
  }
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
  // the B2C side of this row — the same test the comment action re-runs
  let canB2c = false;
  if (b2cCicAccess(viewer)) {
    if (seesB2cCicQueue(viewer)) canB2c = true;
    else {
      const { data: mine } = await db()
        .from("signup_cic_calls")
        .select("id")
        .eq("signup_id", id)
        .eq("side", "B2C")
        .eq("caller_id", viewer.id)
        .limit(1);
      canB2c = (mine ?? []).length > 0;
    }
  }
  return {
    signup: data,
    canB2c,
    comments: (comments ?? []) as SignupComment[],
    assignedLabel: assigned.data
      ? assigned.data.name
      : data.assigned_name,
    canWork: canWorkSignup(viewer, data),
    canVp: _canEditSignupVpFields(viewer, data),
    // THE STATUS IS AN MM'S CALL (v33.14). Applied / Accepted / Approved is
    // the function's MOS, reported upward — a member records the conversation
    // (Contacted, Interested) and their MM confirms what it became.
    canSetStatus:
      _canEditSignupVpFields(viewer, data) ||
      ((viewer.role === "Team Leader" || viewer.role === "Coordinator") &&
        canWorkSignup(viewer, data)),
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

/** Who can be handed a CIC second call (v33.19).
 *
 *  Deliberately NOT `signupReassignTargets`: that list answers "who may OWN
 *  this sign-up", which a Team Leader scopes to their team and a Coordinator
 *  to themselves — so a Coordinator opening the CIC queue could only ever
 *  pick their own name. A verification call is a different job: the point is
 *  that a DIFFERENT person calls, so the pool is the whole function's crew
 *  (never the LCP). `assignCicCaller` re-checks the function and refuses the
 *  first assignee, so widening the picker grants nothing the server allows. */
/** WHO A B2C CALL CAN GO TO (v33.29) — the confirmed matrix: a TL hands to
 *  themself or their own team, a Coordinator to themself, LCVP/Director (and
 *  LCP-level) to any active B2C member. */
export async function b2cCicCallerTargets(
  viewer: Viewer
): Promise<{ id: string; label: string }[]> {
  if (!seesB2cCicQueue(viewer)) return [];
  const { data } = await db()
    .from("members")
    .select("id, name, role, functions, sub_functions")
    .eq("is_active", true)
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b2c = ((data ?? []) as any[]).filter(
    (m) =>
      m.role !== "LCP" &&
      [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes("B2C")
  );
  const lead = _master(viewer) || ["LCVP", "Director"].includes(viewer.role);
  const allowed = lead
    ? b2c
    : viewer.role === "Team Leader"
      ? b2c.filter((m) => m.id === viewer.id || viewer.teamMemberIds.includes(m.id))
      : b2c.filter((m) => m.id === viewer.id);
  return allowed.map((m) => ({ id: m.id, label: m.name }));
}

export async function cicCallerTargets(
  viewer: Viewer,
  fn: OgxFunction
): Promise<{ id: string; label: string }[]> {
  if (!_ogxFunctions(viewer).includes(fn)) return [];
  if (!seesCicQueue(viewer)) return [];
  const { data } = await db()
    .from("members")
    .select("id, name, role, functions, sub_functions")
    .eq("is_active", true)
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (data ?? []) as any[];
  return all
    .filter(
      (m) =>
        m.role !== "LCP" &&
        [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes(fn)
    )
    .map((m) => ({ id: m.id, label: m.name }));
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
  /** how many of the sign-ups in this snapshot are ORGANIC REFERRALS (v33.32)
   *  — they count in every number above; this says how much of it they are */
  referrals: number;
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
  /** THE FUNCTION'S OWN GOAL, from the VPs' planning sheet (v33.52).
   *  `plan` above is the MMs' filed plans added up — it is null until somebody
   *  files one, which is why an OGX lane could show no goal at all. This is
   *  the sheet's own numbers for the current sprint and month (plan_cells
   *  carries OGV / OGTa / OGTe, imported in v21 and never read until now). */
  lanePlan: {
    /** which window this card is about — monthly unless "This sprint" is on
     *  (v33.56). A VP's sprint numbers come from the planning sheet's own
     *  sprint cells; an MM never filed a sprint, so theirs is HALF the month
     *  they did file, and the card says so. */
    mode: "month" | "sprint";
    label: string;
    plan: { applicants: number; accepted: number; approvals: number };
    /** WHAT THE FUNCTION ACTUALLY DID THIS MONTH (v33.55) — a plan on its own
     *  is a wish; the card exists to be compared. Counted on the sign-ups
     *  WORKED this month (assigned_at, falling back to the sign-up's own
     *  date), the same rule the period report and the peak filter use. */
    achieved: { applicants: number; accepted: number; approvals: number };
    /** the viewer's OWN plan for this window, when they filed one */
    mine: { applicants: number; accepted: number; approvals: number } | null;
    mineAchieved: { applicants: number; accepted: number; approvals: number } | null;
  } | null;
  /** the viewer is an OGX MM who has NOT filed this month's plan — the card
   *  says so instead of showing nothing at all */
  needsOwnPlan: boolean;
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
  r: { contact_status: string | null; interested: string | null; status: string | null },
  /** CIC split (v33.19.2). A verified sign-up was called by TWO people, so
   *  both carry the sign-up and the contact; the OUTCOME (Applied → Approved)
   *  belongs to whoever carried it there — the second caller. `outcome:false`
   *  is the first assignee's line, `interested` overrides with the CIC's own
   *  answer on the second caller's line. */
  opts?: { outcome?: boolean; interested?: string | null }
) {
  s.signups += 1;
  if (_ogxYes(r.contact_status)) s.contacted += 1;
  const interested =
    opts && "interested" in opts ? (opts.interested ?? null) : r.interested;
  if (_ogxYes(interested)) s.interested += 1;
  if (opts?.outcome === false) return;
  // the ladder: Approved ⊂ Accepted ⊂ Applied
  if (r.status === "Applied" || r.status === "Accepted" || r.status === "Approved")
    s.applied += 1;
  if (r.status === "Accepted" || r.status === "Approved") s.accepted += 1;
  if (r.status === "Approved") s.approved += 1;
}

interface OgxDashSignup {
  /** which tracker tab it came from — 'referral' means we created it (v33.32) */
  source?: string | null;
  assigned_to: string | null;
  /** when it became someone's work — what the peak window is measured on */
  assigned_at: string | null;
  contact_status: string | null;
  interested: string | null;
  status: string | null;
  out_of_process: boolean;
  signed_up_at: string | null;
  /** CIC — the second caller who verified + followed up (v33.19) */
  cic_assigned_to: string | null;
  cic_contact_status: string | null;
  cic_interested: string | null;
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
          "assigned_to, assigned_at, contact_status, interested, status, out_of_process, signed_up_at, cic_assigned_to, cic_contact_status, cic_interested, source"
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
  let referrals = 0;
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

  for (const r of rows) {
    if (r.out_of_process) continue; // archived sign-ups leave every KPI
    // NOBODY'S = not in the funnel. The pool is a to-do list, not progress.
    if (!r.assigned_to) continue;
    // AND NOT SOMEONE WHO HAS LEFT THIS FUNCTION (v33.14). People move: a TL
    // who ran OGT and is now BD still held 240 OGT sign-ups, and every one of
    // them counted toward OGT's peak. Work belongs to the function whose
    // people are actually doing it — if the holder no longer works this
    // function, the row is waiting to be re-assigned, not progress.
    const holder = byId.get(r.assigned_to);
    if (!holder || !inFn(holder)) continue;
    // this peak only — assigned_at is when it became work.
    // v33.46 — this read the same field TWO DIFFERENT WAYS, four lines apart:
    // a raw .slice(0, 10) here, signupDayIso() in the explicit-range branch
    // below. signed_up_at is free sheet text and 14 rows are "M/D/YYYY", which
    // the slice hands back unchanged — and "8/13/2026" < "2026-08-01" is
    // FALSE as a string compare, so those rows sailed past the peak cutoff
    // whatever year they came from. One parser for one field.
    if (peakStart && !filters.from && !filters.to) {
      const day = signupDayIso(r.assigned_at ?? r.signed_up_at);
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

    // CIC — TWO PEOPLE CALLED THIS SIGN-UP (v33.19.2). Both carry the
    // sign-up and the contact (both spoke to them); the OUTCOME belongs to
    // the second caller, who took it to Applied/Accepted/Approved. The
    // FUNCTION TOTAL must still count the outcome exactly once, so it is
    // added on the first assignee's pass with the ladder intact.
    const cicId =
      r.cic_assigned_to && r.cic_assigned_to !== r.assigned_to ? r.cic_assigned_to : null;
    const cic = cicId ? byId.get(cicId) : undefined;
    const cicCounts = !!cic && inFn(cic);
    /** the first assignee's line loses the outcome once a second caller has it */
    const firstOpts = cicCounts ? { outcome: false } : undefined;
    /** the second caller's line: their own interested answer, and the outcome */
    const secondOpts = { interested: r.cic_interested };

    // KPI totals — the member filter ("My numbers") scopes these ONLY.
    // Unfiltered, the row is counted ONCE (no double-counting the function).
    if (!filters.member) addOgxRow(total, r);
    else if (r.assigned_to === filters.member) addOgxRow(total, r, firstOpts);
    else if (cicCounts && cicId === filters.member) addOgxRow(total, r, secondOpts);
    // organic referrals ride inside every number above — this is how many
    if (
      r.source === "referral" &&
      (!filters.member ||
        r.assigned_to === filters.member ||
        (cicCounts && cicId === filters.member))
    )
      referrals += 1;

    /** put a row on the two personal boards, by the holder's role */
    const credit = (
      who: MemberLiteRow,
      opts?: { outcome?: boolean; interested?: string | null }
    ) => {
      // TWO BOARDS (v33.13): members and MMs are doing different jobs and were
      // ranked against each other on one list, which flattered neither.
      if (who.role === "Member") addOgxRow(init(board, who.id, who.name), r, opts);
      // AN MM'S LINE IS THEIR OWN WORK (v33.42, by the LCP's request). It used
      // to roll their members' sign-ups up into it, so an MM's row answered a
      // question the TEAM board already answers — and hid how much they
      // personally carry. Their own rows, and nothing else.
      if (who.role === "Team Leader" || who.role === "Coordinator")
        addOgxRow(init(mmBoard, who.id, who.name), r, opts);
    };
    credit(holder, firstOpts);
    if (cicCounts && cic) credit(cic, secondOpts);

    if (tl)
      addOgxRow(
        init(byTeam, tl.id, teamLabel(tl.name)),
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
      "member_id, applicants, accepted, approvals, member:members!mm_plans_member_id_fkey(functions, sub_functions)"
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

  // ---- the FUNCTION's goal, from the planning sheet (v33.52) -------------
  // OGV maps 1:1; the OGT lane is OGTa + OGTe, exactly as the ICX IGT lane
  // sums IGTa + IGTe.
  let lanePlan: OgxDashboardData["lanePlan"] = null;
  {
    const planFns = fn === "OGV" ? ["OGV"] : ["OGTa", "OGTe"];
    const [cells, sprint] = [await listPlanCells(planFns), sprintOf()];
    // the bar decides (v33.56): "This sprint" on → the sprint, else the month
    const sprintMode = filters.from === sprint.start && filters.to === sprint.end;
    if (cells.length > 0) {
      const sum = (scope: string, keys: string[], metric: string) =>
        cells
          .filter((c) => c.scope === scope && keys.includes(c.period_start) && c.metric === metric)
          .reduce((acc, c) => acc + c.value, 0);
      const trio = (scope: string, keys: string[]) => ({
        applicants: sum(scope, keys, "applicants"),
        accepted: sum(scope, keys, "accepted"),
        approvals: sum(scope, keys, "approvals"),
      });
      const sprintPlan = trio("sprint", sprint.planKeys);
      const monthPlan = trio("month", month.planKeys);
      if (
        sprintPlan.applicants + sprintPlan.accepted + sprintPlan.approvals +
        monthPlan.applicants + monthPlan.accepted + monthPlan.approvals > 0
      ) {
        // ---- ACHIEVED, this month ---------------------------------------
        // "worked this month" = handed out this month (assigned_at), or the
        // sign-up's own date when nobody ever took it. The same rule as the
        // period report, so the two never disagree.
        const win = sprintMode ? sprint : month;
        const workedInWindow = (r: OgxDashSignup) => {
          const day =
            signupDayIso(r.assigned_at) ?? signupDayIso(r.signed_up_at) ?? null;
          return !!day && day >= win.start && day <= win.end;
        };
        const tally = (only?: string) => {
          const out = { applicants: 0, accepted: 0, approvals: 0 };
          for (const r of rows) {
            if (r.out_of_process) continue;
            if (only && r.assigned_to !== only) continue;
            if (!r.assigned_to) continue;
            if (!workedInWindow(r)) continue;
            if (["Applied", "Accepted", "Approved"].includes(r.status ?? ""))
              out.applicants += 1;
            if (["Accepted", "Approved"].includes(r.status ?? "")) out.accepted += 1;
            if (r.status === "Approved") out.approvals += 1;
          }
          return out;
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const own = ((planRows ?? []) as any[]).find((p) => p.member_id === viewer.id);
        // an MM files a MONTH; half of it is the sprint's share (rounded up)
        const halve = (n: number) => (sprintMode ? Math.ceil(n / 2) : n);
        lanePlan = {
          mode: sprintMode ? "sprint" : "month",
          label: win.label,
          plan: sprintMode ? sprintPlan : monthPlan,
          achieved: tally(),
          mine: own
            ? {
                applicants: halve(own.applicants ?? 0),
                accepted: halve(own.accepted ?? 0),
                approvals: halve(own.approvals ?? 0),
              }
            : null,
          mineAchieved: own ? tally(viewer.id) : null,
        };
      }
    }
  }

  // an OGX MM with no filed plan for this month gets told, not ignored
  const needsOwnPlan =
    (viewer.role === "Team Leader" || viewer.role === "Coordinator") &&
    _ogxFunctions(viewer).includes(fn) &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !((planRows ?? []) as any[]).some((p) => p.member_id === viewer.id);

  const fnMembers = members.filter((m) => inFn(m) && m.role !== "LCP");
  return {
    fn,
    total,
    referrals,
    board: [...board.values()].sort(rank),
    mmBoard: [...mmBoard.values()].sort(rank),
    byTeam: [...byTeam.values()].sort(rank),
    lanePlan,
    needsOwnPlan,
    plan,
    teamOptions: fnMembers
      .filter((m) => m.role === "Team Leader")
      .map((m) => ({
        id: m.id,
        label: teamLabel(m.name),
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
  product: string | null;
  source: string | null;
}

/** 🤝 A PARTNERSHIP with an LC (v33.38, 0059) — per PRODUCT, so the same LC
 *  can be a brand-new GT partnership while being an old GV one. 'pending' is a
 *  TARGET an MM/VP assigned ("go make this partnership"); 'done' means the
 *  WhatsApp group exists. */
export interface LcPartnershipInfo {
  id: string;
  product: IrProduct;
  status: "pending" | "done";
  assignedToId: string | null;
  assignedToName: string | null;
  madeByName: string | null;
  /** YYYY-MM-DD */
  partnershipDate: string | null;
  irName: string | null;
  /** WHERE ON THE ROAD IT IS (v35.1) — the furthest of what a human set and
   *  what the IR calls prove. null = nothing has happened yet. */
  stage: import("@/lib/partnership-stage").PartnershipStage | null;
  /** Sodio worked this out from the calls rather than a person setting it —
   *  the control says so, so nobody wonders why it moved on its own */
  stageAuto: boolean;
}

export interface PartnerLcDetail extends PartnerLc {
  calls: number;
  cvs: number;
  lastCallAt: string | null;
  /** WHICH PRODUCTS THIS LC WAS REACHED FOR (v33.23) — derived, never stored:
   *  an LC can be both (two already are), and a stored set would drift on
   *  every merge, rename and delete. [] = never reached. */
  products: IrProduct[];
  contacts: {
    name: string | null;
    role: string | null;
    email: string | null;
    /** with its country code — the booking collects it (v33.6) */
    phone: string | null;
    /** GV / GT — a hand-added IR carries their own tag; a booker inherits the
     *  product of the call they booked */
    product: IrProduct | null;
    /** they came in through the booking link rather than being typed in */
    fromBooking?: boolean;
    /** every IR has a row since v33.24, so this is always set — the name is
     *  kept because the UI keys notes and removal on it */
    manualId?: string | null;
  }[];
  /** 🤝 made partnerships + assigned targets, one per product (v33.38) */
  partnerships: LcPartnershipInfo[];
  /** which products have actual IR CALLS (not hand-added IRs) — a called
   *  product IS a working relationship, so no partnership is recorded on it
   *  (v33.39) */
  callProducts: IrProduct[];
  /** WHO WORKS THIS LC (v33.39) — derived, never stored: everyone who made a
   *  call with it, plus each caller's Team Leader. The registry filter. */
  assignedTo: { id: string; name: string }[];
  /** free-text notes on the LC or on one of its IRs (v33.23) */
  comments: PartnerLcComment[];
  /** calls + CVs + notes as one timeline, newest first (v33.24) */
  history: PartnerLcEvent[];
}

/** THE WHOLE STORY WITH ONE LC (v33.24) — every call, every CV, every note,
 *  newest first. Relationships with partner LCs outlive the term that built
 *  them, and "have we spoken to these people before?" was an unanswerable
 *  question spread across three tabs. */
export interface PartnerLcEvent {
  id: string;
  kind: "call" | "cv" | "note";
  at: string;
  title: string;
  detail: string | null;
  /** who did it, when we know */
  who: string | null;
  /** GV / GT, on the events that carry a product */
  product: IrProduct | null;
}

export interface PartnerLcComment {
  id: string;
  /** null = about the LC as a whole */
  contactId: string | null;
  body: string;
  author: string;
  authorId: string | null;
  createdAt: string;
}

export async function listPartnerLcDetails(viewer: Viewer): Promise<PartnerLcDetail[]> {
  if (!_hasConsiderationAccess(viewer)) return [];
  // Supabase caps one response at 1000 rows — page both whole-table reads on a
  // STABLE key (fetchAll re-runs the builder per page), then restore the
  // newest-first order the counts and the contacts loop rely on
  const [lcs, calls, cvRows, manual, commentRows, partnershipRows, memberRows] = await Promise.all([
    listPartnerLcs(viewer),
    fetchAll<{
      partner_lc_id: string | null;
      called_at: string;
      booker_name: string | null;
      booker_role: string | null;
      booker_email: string | null;
      booker_phone: string | null;
      status: string;
      product: string | null;
      member_id: string | null;
      member_name: string;
      notes: string | null;
      booker_note: string | null;
    }>(() =>
      db()
        .from("ir_calls")
        .select(
          "partner_lc_id, called_at, booker_name, booker_role, booker_email, booker_phone, status, product, member_id, member_name, notes, booker_note"
        )
        .order("id")
    ),
    fetchAll<{
      partner_lc_id: string | null;
      id: string;
      person_name: string | null;
      file_name: string;
      industry: string | null;
      uploader_name: string;
      created_at: string;
    }>(() =>
      db()
        .from("cvs")
        .select("id, partner_lc_id, person_name, file_name, industry, uploader_name, created_at")
        .order("id")
    ),
    // IRs added BY HAND (v33.9) — the ones who never booked a call themselves
    (async (): Promise<ManualLcContact[]> => {
      // pre-0041 grace: the table may not exist yet on a lagging database
      const { data } = await db()
        .from("partner_lc_contacts")
        .select("id, partner_lc_id, name, role, email, phone, product, source")
        .order("created_at");
      return (data ?? []) as ManualLcContact[];
    })().catch(() => [] as ManualLcContact[]),
    // notes the crew left on an LC or on one of its IRs (v33.23)
    (async () => {
      const { data } = await db()
        .from("partner_lc_comments")
        .select("id, partner_lc_id, contact_id, body, author_id, author_name, created_at")
        .order("created_at", { ascending: false })
        .limit(2000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[];
    })().catch(() => []),
    // 🤝 partnerships + targets (v33.38) — pre-0059 grace: fail to empty
    (async () => {
      const { data } = await db()
        .from("lc_partnerships")
        .select(
          "id, partner_lc_id, product, status, assigned_to, partnership_date, ir_name, stage, " +
            "assigned:members!lc_partnerships_assigned_to_fkey(name), " +
            "maker:members!lc_partnerships_made_by_fkey(name)"
        )
        .limit(5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[];
    })().catch(() => []),
    // the LC's derived assignees need each caller's Team Leader (v33.39)
    (async () => {
      const { data } = await db()
        .from("members")
        .select("id, name, role, stakeholder_id");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[];
    })().catch(() => []),
  ]);
  // THE STAGE IS DERIVED, NOT STORED WHOLE (v35.1): the human's half comes
  // from the row, the two call stages from the LC's own calls, and the card
  // shows whichever is further along. Computed here, where the calls are
  // already in hand — no extra query, and no chance of the queue and the card
  // disagreeing.
  const { effectiveStage, stageIsAutomatic } = await import("@/lib/partnership-stage");
  const callsByLc = new Map<string, { status: string; product: string | null }[]>();
  for (const c of calls) {
    if (!c.partner_lc_id) continue;
    const list = callsByLc.get(c.partner_lc_id) ?? [];
    list.push({ status: c.status, product: c.product });
    callsByLc.set(c.partner_lc_id, list);
  }
  const partnershipsByLc = new Map<string, LcPartnershipInfo[]>();
  for (const r of partnershipRows) {
    const list = partnershipsByLc.get(r.partner_lc_id) ?? [];
    const done = r.status === "done";
    const stageInput = {
      manual: r.stage ?? null,
      calls: callsByLc.get(r.partner_lc_id) ?? [],
      product: (r.product === "GT" ? "GT" : "GV") as "GV" | "GT",
      done,
    };
    list.push({
      id: r.id,
      product: r.product as IrProduct,
      status: done ? "done" : "pending",
      assignedToId: r.assigned_to ?? null,
      assignedToName: r.assigned?.name ?? null,
      madeByName: r.maker?.name ?? null,
      partnershipDate: r.partnership_date ?? null,
      irName: r.ir_name ?? null,
      stage: effectiveStage(stageInput),
      stageAuto: stageIsAutomatic(stageInput),
    });
    partnershipsByLc.set(r.partner_lc_id, list);
  }
  const manualByLc = new Map<string, ManualLcContact[]>();
  for (const c of manual) {
    const list = manualByLc.get(c.partner_lc_id) ?? [];
    list.push(c);
    manualByLc.set(c.partner_lc_id, list);
  }
  const commentsByLc = new Map<string, PartnerLcComment[]>();
  for (const c of commentRows) {
    const list = commentsByLc.get(c.partner_lc_id) ?? [];
    list.push({
      id: c.id,
      contactId: c.contact_id ?? null,
      body: c.body,
      author: c.author_name,
      authorId: c.author_id ?? null,
      createdAt: c.created_at,
    });
    commentsByLc.set(c.partner_lc_id, list);
  }
  calls.sort((a, b) => (a.called_at < b.called_at ? 1 : a.called_at > b.called_at ? -1 : 0));
  const memberById = new Map<string, { id: string; name: string; role: string; stakeholder_id: string | null }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (memberRows as any[]).map((m) => [m.id, m])
  );
  const cvCounts = new Map<string, number>();
  for (const c of cvRows) {
    if (c.partner_lc_id) cvCounts.set(c.partner_lc_id, (cvCounts.get(c.partner_lc_id) ?? 0) + 1);
  }
  // the timeline wants the member's own name on a CV, so `who` reads properly
  return lcs.map((lc) => {
    const mine = calls.filter((c) => c.partner_lc_id === lc.id && c.status !== "cancelled");
    // EVERY IR IS A ROW (v33.24). Bookers used to be synthesised from their
    // calls and capped at five, so most IRs had no id — which meant nothing
    // could be attached to them: no note, no product tag, no correction.
    // `bookIrCall` upserts a contact row now (0049 backfilled the existing
    // ones), so this is a plain read.
    const contacts: PartnerLcDetail["contacts"] = (manualByLc.get(lc.id) ?? []).map(
      (c) => ({
        name: c.name, role: c.role, email: c.email, phone: c.phone,
        product: (c.product as IrProduct | null) ?? null,
        fromBooking: c.source === "booking",
        manualId: c.id,
      })
    );
    // ---- the timeline: what has actually happened with this LC
    const lcNotes = commentsByLc.get(lc.id) ?? [];
    const history: PartnerLcEvent[] = [
      ...calls
        .filter((c) => c.partner_lc_id === lc.id)
        .map((c) => ({
          id: `call-${c.partner_lc_id}-${c.called_at}`,
          kind: "call" as const,
          at: c.called_at,
          // WHO IT WAS WITH, ON BOTH SIDES (v33.26). The log used to name the
          // IR and never the member who took the call, which is the first
          // thing anyone asks before picking the relationship back up.
          title:
            (c.status === "cancelled"
              ? "IR call cancelled"
              : c.status === "scheduled"
                ? "IR call scheduled"
                : "IR call") + (c.booker_name ? ` with ${c.booker_name}` : ""),
          detail:
            [
              c.booker_note ? `They asked about: ${c.booker_note}` : null,
              c.notes,
            ]
              .filter(Boolean)
              .join("\n") || null,
          // the Sodio member on our side of the call
          who: c.member_name || null,
          product: (c.product as IrProduct | null) ?? null,
        })),
      ...cvRows
        .filter((c) => c.partner_lc_id === lc.id)
        .map((c) => ({
          id: `cv-${c.id}`,
          kind: "cv" as const,
          at: c.created_at,
          title: `CV — ${c.person_name || c.file_name}`,
          detail: c.industry,
          who: c.uploader_name,
          product: null,
        })),
      ...lcNotes.map((n) => ({
        id: `note-${n.id}`,
        kind: "note" as const,
        at: n.createdAt,
        title: "Note",
        detail: n.body,
        who: n.author,
        product: null,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    // every product this LC was actually reached for, calls + hand-added IRs
    const products = [
      ...new Set(
        [
          ...mine.map((c) => c.product),
          ...(manualByLc.get(lc.id) ?? []).map((c) => c.product),
        ].filter((p): p is IrProduct => p === "GV" || p === "GT")
      ),
    ].sort();
    // ...and the products with actual CALLS — those ARE the relationship, so
    // the partnership buttons stand down on them (v33.39)
    const callProducts = [
      ...new Set(
        mine.map((c) => c.product).filter((p): p is IrProduct => p === "GV" || p === "GT")
      ),
    ].sort();
    // WHO WORKS THIS LC: its callers + each caller's Team Leader (a TL's own
    // calls assign the LC to them alone — they are their own team's leader)
    const assignedTo: { id: string; name: string }[] = [];
    {
      const seenIds = new Set<string>();
      for (const c of mine) {
        if (!c.member_id || seenIds.has(c.member_id)) continue;
        const m = memberById.get(c.member_id);
        if (!m) continue;
        seenIds.add(m.id);
        assignedTo.push({ id: m.id, name: m.name });
        const tl = m.role === "Team Leader" ? null
          : m.stakeholder_id ? memberById.get(m.stakeholder_id) : null;
        if (tl && tl.role === "Team Leader" && !seenIds.has(tl.id)) {
          seenIds.add(tl.id);
          assignedTo.push({ id: tl.id, name: tl.name });
        }
      }
    }
    return {
      ...lc,
      calls: mine.length,
      cvs: cvCounts.get(lc.id) ?? 0,
      lastCallAt: mine[0]?.called_at ?? null,
      products,
      callProducts,
      assignedTo,
      contacts,
      partnerships: (partnershipsByLc.get(lc.id) ?? []).sort((a, b) =>
        a.product.localeCompare(b.product)
      ),
      comments: lcNotes,
      history,
    };
  });
}

/** THE CONSIDERATION CREW (v33.38) — active members whose functions or
 *  sub-functions say Consideration, minus the leadership (a partnership TARGET
 *  is handed to a member or an MM, never up the ladder). The assign picker's
 *  pool; the action re-validates against the same list. */
export async function listConsiderationCrew(
  viewer: Viewer
): Promise<
  { id: string; name: string; role: string; managerId: string | null; fns: string[] }[]
> {
  if (!_hasConsiderationAccess(viewer)) return [];
  const { data } = await db()
    .from("members")
    .select("id, name, role, stakeholder_id, functions, sub_functions")
    .eq("is_active", true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter(
      (m) =>
        [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes("Consideration") &&
        ["Member", "Coordinator", "Team Leader"].includes(m.role)
    )
    .map((m) => ({
      id: m.id as string,
      name: m.name as string,
      role: m.role as string,
      managerId: (m.stakeholder_id as string | null) ?? null,
      // WHICH ICX FUNCTION THEY WORK (v35.1) — what "my function" means when
      // an MM hands out a target. Every consideration member carries exactly
      // one of IGV/IGT today; both columns are read because the LC files the
      // product under Function and the side under Sub Function.
      fns: [...(m.functions ?? []), ...(m.sub_functions ?? [])].filter(
        (f: string) => f === "IGV" || f === "IGT"
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** WHO A BOOKED IR CALL CAN BE HANDED TO (v33.58).
 *
 *  A call is a slot on ONE person's calendar, and life happens: an exam lands
 *  on the evening, someone leaves the function, an MM realises a teammate is
 *  the better fit for that LC. Until now the only exits were cancelling on
 *  the IR or quietly not showing up. This is the third: the same call, the
 *  same time, a different host.
 *
 *  The pool is the people who actually TAKE IR calls, by exactly the rule the
 *  module itself uses (`worksSide(v, "Consideration")` in rbac) applied to a
 *  plain membership row: anyone whose Sub Function says Consideration, plus
 *  the IGV/IGT LCVPs and Directors who own both sides of their product. Read
 *  ONCE and re-checked inside `reassignIrCall`, so the picker can never offer
 *  a name the action would refuse — the v33.19 CIC lesson. */
export async function irCallHandoverTargets(
  viewer: Viewer
): Promise<{ id: string; name: string; role: string }[]> {
  if (!_hasConsiderationAccess(viewer)) return [];
  const { data } = await db()
    .from("members")
    .select("id, name, role, functions, sub_functions")
    .eq("is_active", true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter((m) => {
      const subs: string[] = m.sub_functions ?? [];
      const fns: string[] = m.functions ?? [];
      if (subs.includes("Consideration")) return true;
      // the product's leadership owns both of its sides
      return (
        (m.role === "LCVP" || m.role === "Director") &&
        fns.some((f) => f === "IGV" || f === "IGT")
      );
    })
    // the LCP is never an operational host — the same rule every other
    // member picker in Sodio follows
    .filter((m) => m.role !== "LCP")
    .map((m) => ({ id: m.id as string, name: m.name as string, role: m.role as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  /** the IANA zone the IR booked in (v33.22) — null for pre-0047 bookings,
   *  where `bookerZoneFor` falls back to the LC's zone or country */
  booker_tz: string | null;
  /** GV or GT — decided when the call was booked (v33.23). Null = the host
   *  works both products (or neither); such a call shows on BOTH floors. */
  product: IrProduct | null;
  /** every time this call has MOVED (v33.28), oldest first */
  reschedules: { at: string; from: string; to: string; by: string; byName: string | null }[] | null;
  /** set by the bounce watcher (v33.29): the invite to booker_email came back
   *  undeliverable — the address doesn't exist. Cleared when it's fixed. */
  email_bounced_at: string | null;
  /** who the IR is (v29's mandatory pick) and what they want to talk about
   *  (v33.24's booking question) — both shown in the detail dialog */
  booker_role: string | null;
  booker_note: string | null;
}

/** THE PAST CALLS' FILTERS (v33.32) — the log is server-paged, so filtering
 *  it client-side would have narrowed the PAGE and called it the pool. Every
 *  one of these is applied in the query. */
export interface IrCallFilters {
  /** free text over the LC, the IR, the host and the notes */
  q?: string;
  /** "GV" / "GT" / "none" (untagged) — comma-joined for multi-select */
  product?: string;
  /** "completed" / "cancelled" */
  status?: string;
  /** host name snapshots (renames cascade, so these stay current) */
  member?: string;
  /** partner LC names */
  lc?: string;
  /** v33.40 — "notes" / "screenshot" / "cvpool" / "bounced": what the call
   *  carries, OR'd together like every multi-select funnel */
  has?: string;
  /** v33.40 — whitelisted column sort for the log */
  sort?: string;
  dir?: "asc" | "desc";
  /** Cairo days, matched against the call's own time */
  from?: string;
  to?: string;
}

/** What the log's column funnels offer — the values the WHOLE set holds, not
 *  the page in hand (the same rule as the sign-ups and CV funnels). */
export async function irCallFilterOptions(
  viewer: Viewer
): Promise<{ members: string[]; lcs: string[] }> {
  if (!_hasConsiderationAccess(viewer)) return { members: [], lcs: [] };
  const { unstable_cache } = await import("next/cache");
  const read = unstable_cache(
    async () => {
      const rows = await fetchAll<{ member_name: string | null; partner_lc_name: string | null }>(
        () =>
          db()
            .from("ir_calls")
            .select("member_name, partner_lc_name")
            .neq("status", "scheduled")
            .order("id")
      );
      const members = new Set<string>();
      const lcs = new Set<string>();
      for (const r of rows) {
        if (r.member_name?.trim()) members.add(r.member_name.trim());
        if (r.partner_lc_name?.trim()) lcs.add(r.partner_lc_name.trim());
      }
      const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b)).slice(0, 300);
      return { members: sorted(members), lcs: sorted(lcs) };
    },
    ["ir-call-filter-options"],
    { revalidate: 300 }
  );
  return read();
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
  range?: { fromIso: string; toIso: string },
  /** the log's own filters (v33.32) — never applied to the scheduled list,
   *  which is small, in hand, and has its own chips */
  filters: IrCallFilters = {}
): Promise<{ scheduled: IrCallRow[]; rows: IrCallRow[]; total: number; page: number }> {
  if (!_hasConsiderationAccess(viewer))
    return { scheduled: [], rows: [], total: 0, page: 0 };

  // IGV AND IGT CONSIDERATION ARE SEPARATE FLOORS (v33.15, corrected v33.23).
  //
  // They market different programmes to different LCs and were reading each
  // other's whole call log. The split USED to go by the owner's CURRENT
  // functions — which meant a member who works both products put their calls
  // on both floors, and a member who changed function retroactively moved
  // every call they had ever made. Since 0048 the call carries its own
  // `product`, so the floor is a fact about the call.
  //
  // An UNTAGGED call (a host who works both, or neither) stays visible to
  // everyone: null means "we don't know", never "hide it".
  const mine = considerationFunctions(viewer);
  const seesBoth =
    viewer.isAdmin || viewer.role === "LCP" || mine.length !== 1;
  const laneProduct: string | null = seesBoth ? null : mine[0] === "IGT" ? "GT" : "GV";

  const from = Math.max(0, page) * pageSize;
  let schedQ = db()
    .from("ir_calls")
    .select("*")
    .eq("status", "scheduled")
    .order("called_at", { ascending: true })
    .order("id");
  // v33.40 — click-to-sort on the log, whitelisted like every sorted table
  const IR_SORTS: Record<string, string> = {
    called_at: "called_at",
    lc: "partner_lc_name",
    member: "member_name",
    booker: "booker_name",
    status: "status",
    product: "product",
    booked_at: "booked_at",
  };
  const sortCol = IR_SORTS[filters.sort ?? ""] ?? "called_at";
  const sortAsc =
    filters.dir === "asc" ? true : filters.dir === "desc" ? false : sortCol === "called_at" ? false : true;
  let logQ = db()
    .from("ir_calls")
    .select("*", { count: "exact" })
    .neq("status", "scheduled")
    .order(sortCol, { ascending: sortAsc, nullsFirst: false })
    .order("id");
  if (range) {
    schedQ = schedQ.gte("called_at", range.fromIso).lte("called_at", range.toIso);
    logQ = logQ.gte("called_at", range.fromIso).lte("called_at", range.toIso);
  }
  if (laneProduct) {
    const own = `product.eq.${laneProduct},product.is.null`;
    schedQ = schedQ.or(own);
    logQ = logQ.or(own);
  }

  // ---- the log's own filters (v33.32). They narrow the QUERY, so they
  // filter the whole history and not the fifty rows on screen.
  if (!range) {
    const picks = (v?: string) =>
      (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const products = picks(filters.product);
    if (products.length > 0) {
      const known = products.filter((p) => p === "GV" || p === "GT");
      const wantsNone = products.includes("none");
      if (wantsNone && known.length === 0) logQ = logQ.is("product", null);
      else if (wantsNone)
        logQ = logQ.or(
          `product.is.null,product.in.(${known.map((p) => `"${p}"`).join(",")})`
        );
      else if (known.length > 0) logQ = logQ.in("product", known);
    }
    const statuses = picks(filters.status).filter(
      (s) => s === "completed" || s === "cancelled"
    );
    if (statuses.length > 0) logQ = logQ.in("status", statuses);
    const members = picks(filters.member);
    if (members.length > 0) logQ = logQ.in("member_name", members);
    const lcs = picks(filters.lc);
    if (lcs.length > 0) logQ = logQ.in("partner_lc_name", lcs);
    // WHAT THE CALL CARRIES (v33.40) — several picks OR together, and each
    // one spans a different column, so the clause is built by hand
    const has = picks(filters.has);
    if (has.length > 0) {
      const clauses: string[] = [];
      if (has.includes("notes")) clauses.push("notes.not.is.null");
      if (has.includes("screenshot")) clauses.push("screenshot_drive_id.not.is.null");
      if (has.includes("cvpool")) clauses.push("cv_pool_link.not.is.null");
      if (has.includes("bounced")) clauses.push("email_bounced_at.not.is.null");
      if (clauses.length === 1) logQ = logQ.or(clauses[0]);
      else if (clauses.length > 1) logQ = logQ.or(clauses.join(","));
    }
    if (filters.from || filters.to) {
      const { cairoToUtc } = await import("@/lib/time");
      if (filters.from)
        logQ = logQ.gte("called_at", cairoToUtc(filters.from, "00:00").toISOString());
      if (filters.to)
        logQ = logQ.lt(
          "called_at",
          new Date(cairoToUtc(filters.to, "00:00").getTime() + 24 * 60 * 60_000).toISOString()
        );
    }
    const q = (filters.q ?? "").trim().slice(0, 80);
    if (q) {
      // PostgREST's `or` is a comma-separated grammar and ilike takes LIKE
      // metacharacters — an unescaped comma, paren, % or _ would silently
      // rewrite the filter into something else
      const safe = q
        .replaceAll("\\", "")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_")
        .replaceAll(",", " ")
        .replaceAll("(", " ")
        .replaceAll(")", " ");
      logQ = logQ.or(
        [
          `partner_lc_name.ilike.%${safe}%`,
          `member_name.ilike.%${safe}%`,
          `booker_name.ilike.%${safe}%`,
          `notes.ilike.%${safe}%`,
          `demand.ilike.%${safe}%`,
        ].join(",")
      );
    }
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
export interface CvFilters {
  q?: string;
  /** partner LC id */
  lc?: string;
  /** comma list, matching the column funnel's multi-select */
  industry?: string;
  status?: string;
  uploader?: string;
  /** "has" | "missing" — a reachable number or not */
  phone?: string;
}

export async function listCvsPage(
  viewer: Viewer,
  filters: CvFilters,
  page = 0,
  pageSize = 50
): Promise<{ rows: CvRow[]; total: number; page: number }> {
  // v27: the CV pool is an IGT hunt — Consideration crew + IGT leaders only
  if (!_canSeeCvPool(viewer)) return { rows: [], total: 0, page: 0 };
  const build = () => {
    let q = db().from("cvs").select("*", { count: "exact" });
    if (filters.lc) q = q.eq("partner_lc_id", filters.lc);
    // COLUMN FUNNELS (v33.23) — the house rule: if it is a column, you filter
    // it from the column. All comma-aware, because the funnel is multi-select.
    {
      const picks = pickList(filters.industry);
      if (picks.length === 1) q = q.eq("industry", picks[0]);
      else if (picks.length > 1) q = q.in("industry", picks);
    }
    {
      const picks = pickList(filters.status);
      if (picks.length === 1) q = q.eq("extraction_status", picks[0]);
      else if (picks.length > 1) q = q.in("extraction_status", picks);
    }
    {
      const picks = pickList(filters.uploader);
      if (picks.length === 1) q = q.eq("uploader_name", picks[0]);
      else if (picks.length > 1) q = q.in("uploader_name", picks);
    }
    {
      const picks = pickList(filters.phone).filter((p) => p === "has" || p === "missing");
      if (picks.length === 1 && picks[0] === "missing")
        q = q.or("phone.is.null,phone.eq.");
      else if (picks.length === 1) q = q.not("phone", "is", null).neq("phone", "");
    }
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

/** The Violet Man's CV search (v26): the query is split into words and EVERY
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
  /** v33.37 — max scheduled calls per Cairo day; null = unlimited */
  max_per_day: number | null;
  /** v33.39 — per-weekday cap overrides, {"0": 1} = Sunday max 1 (JS dow) */
  max_per_day_overrides: Record<string, number> | null;
}

/** every column freeBookingSlots/getBookingPage need — one place to keep the
 *  selects in sync with the interface */
const BOOKING_SETTINGS_COLS =
  "member_id, slug, slot_minutes, availability, active, buffer_minutes, min_notice_minutes, max_advance_days, start_date, end_date, guests_can_invite, max_per_day, max_per_day_overrides";

/** Which control in the editor a booking issue points at. `dates` = the
 *  "Schedule starts / ends" pair, `hours` = the availability rows, `active` =
 *  the on/off switch. */
export type BookingIssueField = "active" | "dates" | "hours";

export interface BookingIssue {
  level: "blocked" | "warn";
  message: string;
  field?: BookingIssueField;
}

export interface MyIrBooking {
  settings: IrBookingSettings | null;
  suggestedSlug: string;
  /** WHY NOBODY CAN BOOK YOU (v33.44). A member set her hours, her schedule's
   *  END DATE had quietly passed, and her link offered nothing — with no way
   *  to tell that from "nobody wants a call". Anything that silently empties
   *  the grid is said out loud here.
   *
   *  v33.45 — each issue names the CONTROL that causes it, so the editor can
   *  print it next to that control instead of only in a banner at the top:
   *  a member reading "your schedule ENDED" three cards above the date field
   *  still has to go hunting for the fix. `field` is undefined for issues
   *  with no single control to blame (an empty grid is the sum of all of
   *  them). */
  issues: BookingIssue[];
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
  const settings = data
    ? { ...data, availability: sanitizeAvailability(data.availability) }
    : null;
  return {
    settings,
    suggestedSlug: data?.slug ?? suggested,
    issues: settings ? await bookingIssues(settings) : [],
  };
}

/** Everything that can make a saved booking link offer NOTHING, in the order
 *  a member would want to hear it. The last check is the honest one: ask the
 *  real slot builder and report an empty grid even when every setting looks
 *  individually fine. */
async function bookingIssues(s: IrBookingSettings): Promise<BookingIssue[]> {
  const out: BookingIssue[] = [];
  const today = _cairoYmd(new Date());
  if (!s.active)
    out.push({
      level: "blocked",
      field: "active",
      message: "Your link is switched OFF — nobody can book a call until you turn it back on.",
    });
  if (s.end_date && s.end_date < today)
    out.push({
      level: "blocked",
      field: "dates",
      message: `Your schedule ENDED on ${s.end_date} — the link is live but offers no dates. Clear the end date or push it forward.`,
    });
  if (s.start_date && s.start_date > today)
    out.push({
      level: "warn",
      field: "dates",
      message: `Your schedule starts on ${s.start_date} — nothing is bookable before then.`,
    });
  const rows = sanitizeAvailability(s.availability);
  if (rows.length === 0)
    out.push({
      level: "blocked",
      field: "hours",
      message: "You haven't added any hours yet — add at least one window below.",
    });
  else if (rows.every((r) => r.date && r.date < today))
    out.push({
      level: "blocked",
      field: "hours",
      message: "Every hour you set is on a date that has passed — add new ones.",
    });

  // the final word: what the PUBLIC page would actually show
  if (out.every((i) => i.level !== "blocked")) {
    try {
      const days = await freeBookingSlots(s);
      const slots = days.reduce((n, d) => n + d.slots.length, 0);
      if (slots === 0)
        out.push({
          level: "blocked",
          message:
            "Your link is live but has no free slot right now — every window is already booked, blocked by the daily cap, or too soon under your minimum notice.",
        });
    } catch {
      /* a diagnostic must never break the page it is diagnosing */
    }
  }
  return out;
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

export interface IrSlotRequest {
  id: string;
  lcName: string;
  country: string | null;
  bookerName: string;
  bookerRole: string | null;
  bookerEmail: string;
  bookerPhone: string | null;
  /** the instant asked for, ISO */
  requestedAt: string;
  /** Cairo label for the crew, and the IR's own clock when we know it */
  cairoLabel: string;
  theirLabel: string | null;
  minutes: number;
  note: string | null;
  hostId: string;
  hostName: string;
  createdAt: string;
}

/** PENDING "can we do another time?" ASKS (v34.5). Scoped the way every other
 *  IR read is: your own by default, the whole floor for a VP/Director/LCP —
 *  a lead has to be able to answer for somebody who is away. */
export async function listIrSlotRequests(viewer: Viewer): Promise<IrSlotRequest[]> {
  if (!_hasConsiderationAccess(viewer)) return [];
  let q = db()
    .from("ir_slot_requests")
    .select(
      "id, lc_name, country, booker_name, booker_role, booker_email, booker_phone, " +
        "requested_at, duration_minutes, note, member_id, created_at, " +
        "booker_tz, host:members!ir_slot_requests_member_id_fkey(name)"
    )
    .eq("status", "pending")
    .order("requested_at");
  // a lead answers for whoever is away; everyone else sees their own
  const isLead =
    viewer.isAdmin ||
    viewer.role === "LCP" ||
    ((viewer.role === "LCVP" || viewer.role === "Director") &&
      _hasConsiderationAccess(viewer));
  if (!isLead) q = q.eq("member_id", viewer.id);
  const { data, error } = await q;
  if (error) {
    console.error("[ir-requests] list failed:", error.message);
    return [];
  }
  const { whenLabelInZone } = await import("@/lib/timezones");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    lcName: r.lc_name,
    country: r.country,
    bookerName: r.booker_name,
    bookerRole: r.booker_role,
    bookerEmail: r.booker_email,
    bookerPhone: r.booker_phone,
    requestedAt: r.requested_at,
    cairoLabel: whenLabelInZone(r.requested_at, "Africa/Cairo"),
    theirLabel: r.booker_tz ? whenLabelInZone(r.requested_at, r.booker_tz) : null,
    minutes: r.duration_minutes,
    note: r.note,
    hostId: r.member_id,
    hostName: r.host?.name ?? "",
    createdAt: r.created_at,
  }));
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
  const { cairoToUtc, cairoWallClockExists } = await import("@/lib/time");
  const availability = sanitizeAvailability(s.availability);
  if (availability.length === 0) return [];
  const slotMin = Math.min(120, Math.max(10, s.slot_minutes || 30));
  const slotMs = slotMin * 60_000;
  // buffers up to 2 HOURS (v33.37) — an hour of prep between calls is a
  // legitimate way to work, not something to clamp away
  const bufferMs = Math.min(120, Math.max(0, s.buffer_minutes ?? 0)) * 60_000;
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

  // THE DAILY CAP (v33.37): a Cairo day already holding max_per_day scheduled
  // calls simply stops being offered. Counted from the same busy list the
  // overlap check uses, so the two can never disagree. v33.39: a WEEKDAY can
  // carry its own cap ("3 a day, but Sunday only 1") — an override wins over
  // the general number, and stands alone when there is no general cap at all.
  const maxPerDay =
    Number.isInteger(s.max_per_day) && (s.max_per_day as number) >= 1
      ? (s.max_per_day as number)
      : null;
  const dayOverrides: Record<string, number> = {};
  if (s.max_per_day_overrides && typeof s.max_per_day_overrides === "object") {
    for (const [k, v] of Object.entries(s.max_per_day_overrides)) {
      const dow = Number(k);
      const cap = Number(v);
      if (dow >= 0 && dow <= 6 && Number.isInteger(cap) && cap >= 1 && cap <= 10)
        dayOverrides[String(dow)] = cap;
    }
  }
  const capForDow = (dow: number): number | null =>
    dayOverrides[String(dow)] ?? maxPerDay;
  const bookedPerDay = new Map<string, number>();
  if (maxPerDay || Object.keys(dayOverrides).length > 0) {
    for (const b of busy) {
      const day = _cairoYmd(new Date(b.start));
      bookedPerDay.set(day, (bookedPerDay.get(day) ?? 0) + 1);
    }
  }

  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  // a window ENDING at 00:00 ("12 AM") runs to midnight — and 23:59, every
  // member's workaround while 00:00 was refused, means the same thing (v33.16:
  // a 22:00→23:59 window used to silently lose its 23:30 slot by one minute)
  const toEndMin = (t: string) => {
    const m = toMin(t);
    return m === 0 || m === 1439 ? 1440 : m;
  };
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
    // the day is FULL — the cap (this weekday's own, else the general one)
    // says no more calls here
    const dayCap = capForDow(dow);
    if (dayCap && (bookedPerDay.get(ymd) ?? 0) >= dayCap) continue;
    const seen = new Set<string>();
    const slots: BookingSlot[] = [];
    for (const w of windows) {
      const from = toMin(w.from);
      const to = toEndMin(w.to);
      // THE BUFFER RE-ANCHORS THE GRID AFTER A BOOKED CALL (v33.17, the
      // LCP's spec): with nothing booked the grid is contiguous — 6:00,
      // 6:30, 7:00. Once 6:00 is taken (30m slot, 10m buffer) the next
      // offered slot is 6:40, then 7:10 — the grid resumes AT the buffer's
      // edge instead of skipping to the next untouched gridline.
      const dayStartMs = cairoToUtc(ymd, "00:00").getTime();
      let m = from;
      let guard = 0;
      while (m + slotMin <= to && guard++ < 500) {
        const hh = Math.floor(m / 60);
        const mm = m % 60;
        const hhmm = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        const start = cairoToUtc(ymd, hhmm);
        const startMs = start.getTime();
        // buffer pads every existing call on BOTH sides
        const clash = busy.find(
          (b) =>
            startMs < b.start + b.ms + bufferMs &&
            b.start - bufferMs < startMs + slotMs
        );
        if (clash) {
          // everything until the call's end + buffer is unbookable — resume
          // the grid right there (never move backwards: a call's leading
          // buffer can clash with a slot that started BEFORE the call)
          const resumeMin = Math.ceil((clash.start + clash.ms + bufferMs - dayStartMs) / 60_000);
          m = Math.max(m + slotMin, resumeMin);
          continue;
        }
        // THE HOUR THAT ISN'T THERE (v33.24). On Egypt's spring-forward night
        // the clock jumps 00:00 → 01:00, so a slot labelled 12:30 AM would be
        // booked — and invited — for 1:30 AM. Offer only what exists.
        if (startMs >= notBefore && cairoWallClockExists(ymd, hhmm)) {
          const iso = start.toISOString();
          if (!seen.has(iso)) {
            seen.add(iso);
            slots.push({ iso, label: _slotLabel(hh, mm) });
          }
        }
        m += slotMin;
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

/** WHICH CLOCK THIS IR READS BY (v33.22), best evidence first:
 *   1. the zone recorded on the booking — what they were actually looking at;
 *   2. the zone their LC has used before;
 *   3. their LC's country, which pins most countries to one zone.
 *  Null when none of the three answers, and the caller then says Cairo time
 *  plainly rather than inventing a zone for them. */
export async function bookerZoneFor(
  bookerTz: string | null | undefined,
  partnerLcId: string | null | undefined
): Promise<string | null> {
  const { isValidZone, zoneForCountry } = await import("@/lib/timezones");
  if (isValidZone(bookerTz)) return String(bookerTz);
  if (!partnerLcId) return null;
  const { data: lc } = await db()
    .from("partner_lcs")
    .select("timezone, country")
    .eq("id", partnerLcId)
    .maybeSingle<{ timezone: string | null; country: string | null }>();
  if (isValidZone(lc?.timezone)) return String(lc!.timezone);
  return zoneForCountry(lc?.country ?? null);
}

/** Everything the PUBLIC /book/manage/<token> page renders: the booking's
 *  state + (while it's still scheduled) the member's CURRENT free slots for a
 *  reschedule — the call being moved doesn't block itself. Null for unknown
 *  tokens. */
export interface ManageBookingData {
  callId: string;
  memberName: string;
  partnerLc: string;
  status: "scheduled" | "completed" | "cancelled";
  /** Cairo label — the page RE-RENDERS everything in the IR's own zone, so
   *  this is only the server-side fallback before hydration (v33.22) */
  whenLabel: string;
  /** the UTC instant, so the client can draw it in any zone */
  startIso: string;
  /** the zone this booking was made in, when we know it — else the partner
   *  LC's zone, else the country's. Null = we genuinely don't know. */
  bookerTz: string | null;
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
      "id, member_id, member_name, partner_lc_name, called_at, status, duration_minutes, meet_link, cancel_reason, reschedule_requested_at, booker_tz, partner_lc_id"
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
      booker_tz: string | null;
      partner_lc_id: string | null;
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
    startIso: call.called_at,
    bookerTz: await bookerZoneFor(call.booker_tz, call.partner_lc_id),
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
  /** top current streaks on the board, with today's contact count each. The
   *  FUNCTION rides along (v33.26): on the joint OGX board a name alone says
   *  nothing about which side they're racing on. */
  topStreaks: {
    name: string;
    current: number;
    today: number;
    /** contacted today — false = alive only on the grace day (dies at midnight) */
    savedToday: boolean;
    fn: string | null;
  }[];
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

  let rows: {
    id: string; assigned_to: string | null; contacted_at: string; fn: string;
    source: string | null;
  }[];
  let contactLogs: { signup_id: string; member_id: string | null; at: string }[];
  let members: {
    id: string; name: string; role: string;
    functions: string[] | null; sub_functions: string[] | null; is_active: boolean;
  }[];
  try {
    // every CURRENTLY-contacted sign-up in the window — the streak's raw
    // material. `contact_status` is re-checked here, so an undone contact
    // simply isn't in the set.
    const [actRes, logRes, memRes] = await Promise.all([
      fetchAll<{
        id: string; assigned_to: string | null; contacted_at: string; fn: string;
        source: string | null;
      }>(() =>
        db()
          .from("signups")
          .select("id, assigned_to, contacted_at, fn, source")
          .in("fn", wanted)
          // the sheet writes "yes"/"YES" as freely as "Yes" — the streak must
          // read contacted the way the whole system does (v33.37)
          .ilike("contact_status", "y%")
          .not("contacted_at", "is", null)
          .not("assigned_to", "is", null)
          .gte("contacted_at", `${cutoff}T00:00:00`)
          .order("id")
      ),
      // WHO actually flipped it to contacted (v33.39) — the referral abuse:
      // a row logged by someone ELSE with Contacted=Yes pre-filled must not
      // save the assignee's flame. Pre-log rows fail to empty, which only
      // affects referral rows — all newer than the logs table.
      fetchAll<{ signup_id: string; member_id: string | null; at: string }>(() =>
        db()
          .from("signup_logs")
          .select("signup_id, member_id, at")
          .eq("field", "contacted")
          .ilike("new_value", "y%")
          .gte("at", `${cutoff}T00:00:00`)
          .order("id")
      ).catch(() => [] as { signup_id: string; member_id: string | null; at: string }[]),
      db()
        .from("members")
        .select("id, name, role, functions, sub_functions, is_active")
        .eq("is_active", true),
    ]);
    if (memRes.error) throw new Error(memRes.error.message);
    rows = actRes;
    contactLogs = logRes;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    members = (memRes.data ?? []) as any[];
  } catch (e) {
    // fail CLOSED — a transient error must hide the card, never render a
    // lying 0-day streak
    console.error("[streaks] stats fetch failed:", e);
    return null;
  }

  // signup → the members who personally logged a contact on it (first day each)
  const ownContactDay = new Map<string, Map<string, string>>();
  for (const l of contactLogs) {
    if (!l.member_id) continue;
    const per = ownContactDay.get(l.signup_id) ?? new Map<string, string>();
    const day = cairoDayIso(new Date(l.at));
    const prev = per.get(l.member_id);
    if (!prev || day < prev) per.set(l.member_id, day);
    ownContactDay.set(l.signup_id, per);
  }

  // member → the Cairo days they contacted on, and today's tally
  const byMember = new Map<string, { days: Set<string>; today: number }>();
  for (const r of rows) {
    if (!r.assigned_to) continue;
    let day: string;
    if (r.source === "referral") {
      // THE ABUSE FIX (v33.39): a referral arrives pre-contacted by whoever
      // LOGGED it. It saves the assignee's streak only when the assignee
      // themselves flipped the contact (their own log), on that day.
      const own = ownContactDay.get(r.id)?.get(r.assigned_to);
      if (!own) continue;
      day = own;
    } else {
      day = cairoDayIso(new Date(r.contacted_at));
    }
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
      const all = [...(m.functions ?? []), ...(m.sub_functions ?? [])];
      return {
        name: (m.name) as string,
        current: e ? currentStreak(e.days, today) : 0,
        today: e?.today ?? 0,
        // SAVED TILL TODAY vs ALIVE ON THE GRACE DAY (v33.37): both are
        // "active", but the board must say which is which — a 🔥 5 whose
        // owner hasn't contacted today reads as a lie by midnight
        savedToday: e?.days.has(today) ?? false,
        // ONLY ON THE JOINT BOARD (v33.27). On an OGV-only or OGT-only board
        // every row carries the same tag, which is noise: it answers a
        // question nobody is asking there.
        fn:
          scope === "OGX"
            ? ((all.find((f) => f === "OGT" || f === "OGV") ?? null) as string | null)
            : null,
      };
    })
    .filter((e) => e.current > 0)
    // THE STREAK IS THE RANK (v33.38, the Amr case): an alive streak holds
    // its place until midnight actually kills it — the ⏳ label carries the
    // at-risk signal, demoting the row would double-punish a streak that has
    // not been lost. savedToday only breaks ties.
    .sort(
      (a, b) =>
        b.current - a.current ||
        Number(b.savedToday) - Number(a.savedToday) ||
        b.today - a.today ||
        a.name.localeCompare(b.name)
    )
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
