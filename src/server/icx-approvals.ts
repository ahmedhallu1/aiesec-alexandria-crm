import "server-only";
import { db } from "@/lib/supabase";
import { considerationFunctions, hasConsiderationAccess, icxFunctions, reachIds, type Viewer } from "@/lib/rbac";
import { accountSlug, cairoToday, normalizeLcName } from "@/lib/types";
import {
  expaKey,
  isAlreadyLogged,
  laneApprovals,
  mosCountFor,
  planFnsOfLane,
  productFromRaw,
  type ApprovalFunction,
  type ApprovalPlanSource,
  type ApprovalProduct,
  type ApprovalSource,
  type LaneApprovalRow,
  type LaneApprovals,
} from "@/lib/icx-approvals";
import { monthOf, peakOf, sprintOf } from "@/lib/plan";

/** EVERY ROW A QUERY MATCHES (v37.14). `.limit(5000)` and `.limit(10000)` read
 *  like room to grow, but the API answers at most 1000 rows per request
 *  whatever the limit says — so the boards, the MOS and the "already logged"
 *  check would all have stopped counting at the 1000th approval, silently.
 *  Paged here (not via data.ts's fetchAll, which this file only reaches by
 *  dynamic import). The builder must carry a stable order. */
async function readAll<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any,
  max = 20_000
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let off = 0; off < max; off += 1000) {
    const { data, error } = await build().range(off, Math.min(off + 1000, max) - 1);
    if (error) return { data: out, error };
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return { data: out, error: null };
}

/**
 * ICX APPROVALS — the reads (v37).
 *
 * Who reads: the consideration lanes the viewer may see
 * (`considerationFunctions` — the crew, their VPs/Directors, TM/F&L leadership
 * and the LCP). Who WRITES is narrower and lives in the actions file.
 */

export interface IcxApprovalRow {
  id: string;
  product: ApprovalProduct;
  function: ApprovalFunction;
  ep_name: string;
  expa_id: string | null;
  approved_on: string;
  partner_lc_id: string | null;
  partner_lc_name: string | null;
  country: string | null;
  source: ApprovalSource;
  ir_call_id: string | null;
  cv_id: string | null;
  account_id: string | null;
  account_name: string | null;
  account_slug: string | null;
  opportunity: string | null;
  ep_email: string | null;
  ep_phone: string | null;
  notes: string | null;
  made_by: string | null;
  made_by_name: string;
  logged_by: string | null;
  logged_by_name: string | null;
  from_subtool: boolean;
  created_at: string;
  /** may this viewer edit / delete it — computed here, re-checked in the action */
  canEdit: boolean;
}

/** The lanes this viewer reads approvals in. */
export function approvalLanes(viewer: Viewer): ApprovalFunction[] {
  return considerationFunctions(viewer);
}

const isLead = (v: Viewer) =>
  v.isAdmin ||
  v.role === "LCP" ||
  ((v.role === "LCVP" || v.role === "Director") && hasConsiderationAccess(v));

/** THE EDIT RULE: whoever logged it, whoever it is credited to, the Team
 *  Leader it rolls up to, and the function's leadership. */
export function canEditApproval(
  viewer: Viewer,
  row: { function: ApprovalFunction; made_by: string | null; logged_by: string | null }
): boolean {
  if (!considerationFunctions(viewer).includes(row.function)) return false;
  if (row.logged_by === viewer.id || row.made_by === viewer.id) return true;
  if (row.made_by && reachIds(viewer).includes(row.made_by)) return true;
  return isLead(viewer) && hasConsiderationAccess(viewer);
}

export interface ApprovalFilters {
  fn?: string | null;
  from?: string | null;
  to?: string | null;
  /** a member id — approvals credited to them */
  member?: string | null;
  source?: string | null;
  q?: string | null;
}

export async function listIcxApprovals(
  viewer: Viewer,
  filters: ApprovalFilters = {}
): Promise<IcxApprovalRow[]> {
  const lanes = approvalLanes(viewer);
  if (lanes.length === 0) return [];
  const fns = filters.fn && lanes.includes(filters.fn as ApprovalFunction)
    ? [filters.fn as ApprovalFunction]
    : lanes;

  let q = db()
    .from("icx_approvals")
    .select(
      "*, account:accounts(name), maker:members!icx_approvals_made_by_fkey(name), logger:members!icx_approvals_logged_by_fkey(name)"
    )
    .in("function", fns)
    .order("approved_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) q = q.gte("approved_on", filters.from);
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) q = q.lte("approved_on", filters.to);
  if (filters.member) q = q.eq("made_by", filters.member);
  if (filters.source) q = q.in("source", filters.source.split(",").filter(Boolean));
  const s = (filters.q ?? "").replace(/[%,()]/g, " ").trim();
  if (s) {
    q = q.or(
      `ep_name.ilike.%${s}%,expa_id.ilike.%${s}%,partner_lc_name.ilike.%${s}%,opportunity.ilike.%${s}%,made_by_name.ilike.%${s}%`
    );
  }
  const { data, error } = await q;
  if (error) {
    // before 0083 the table does not exist — an empty tab, not a crash
    if (error.code === "42P01" || /icx_approvals/.test(error.message)) return [];
    throw new Error(error.message);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => {
    const row = {
      id: r.id,
      product: r.product,
      function: r.function,
      ep_name: r.ep_name,
      expa_id: r.expa_id,
      approved_on: r.approved_on,
      partner_lc_id: r.partner_lc_id,
      partner_lc_name: r.partner_lc_name,
      country: r.country,
      source: r.source,
      ir_call_id: r.ir_call_id,
      cv_id: r.cv_id,
      account_id: r.account_id,
      account_name: r.account?.name ?? null,
      account_slug: r.account?.name ? accountSlug(r.account.name) : null,
      opportunity: r.opportunity,
      ep_email: r.ep_email,
      ep_phone: r.ep_phone,
      notes: r.notes,
      made_by: r.made_by,
      // the member's name TODAY (renames), the snapshot when they have left
      made_by_name: r.maker?.name ?? r.made_by_name ?? "—",
      logged_by: r.logged_by,
      logged_by_name: r.logger?.name ?? null,
      from_subtool: !!r.from_subtool,
      created_at: r.created_at,
    } as Omit<IcxApprovalRow, "canEdit">;
    return { ...row, canEdit: canEditApproval(viewer, row) };
  });
}

// ------------------------------------------------------ SubTool suggestions

export interface ApprovalSuggestion {
  epOppId: string;
  epName: string;
  product: ApprovalProduct | null;
  function: ApprovalFunction;
  approvalDate: string;
  /** the sending LC as the SubTool spells it */
  homeLc: string | null;
  /** …and the registry LC it matches, when one does */
  partnerLcId: string | null;
  status: string;
}

/**
 * THE ECB SUBTOOL ALREADY KNOWS EVERY ICX APPROVAL — so Sodio offers the
 * ones nobody has logged yet, prefilled, instead of making someone type a
 * name, an id, a date and an LC the sheet already holds. The one thing the
 * sheet cannot say is WHO made it; that is the claim.
 *
 * Window: the last 150 days. Older approvals belong to a peak that has been
 * reported and closed; offering them forever would bury this month's.
 */
export async function approvalSuggestions(viewer: Viewer): Promise<ApprovalSuggestion[]> {
  const lanes = approvalLanes(viewer);
  if (lanes.length === 0) return [];
  const today = cairoToday();
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 150);
  const sinceDay = since.toISOString().slice(0, 10);

  const [{ data: recs }, { data: logged }, { data: lcs }] = await Promise.all([
    db()
      .from("cxp_ep_records")
      .select("ep_opp_id, ep_name, product, function, approval_date, home_lc, status, submission_month")
      .in("function", lanes)
      .not("approval_date", "is", null)
      .gte("approval_date", sinceDay)
      .order("submission_month", { ascending: false }),
    readAll<{ expa_id: string | null }>(() => db().from("icx_approvals").select("expa_id").order("id")),
    db().from("partner_lcs").select("id, name"),
  ]);

  const loggedIds = (logged ?? []).map((l) => l.expa_id as string | null);
  const lcByKey = new Map(
    (lcs ?? []).map((l) => [normalizeLcName(l.name as string), l.id as string])
  );

  const out = new Map<string, ApprovalSuggestion>();
  for (const r of recs ?? []) {
    const id = String(r.ep_opp_id ?? "").trim();
    if (!id || out.has(expaKey(id)!)) continue;
    if (isAlreadyLogged(id, loggedIds)) continue;
    const fn = r.function as ApprovalFunction;
    out.set(expaKey(id)!, {
      epOppId: id,
      epName: r.ep_name || id,
      product: productFromRaw(r.product, fn),
      function: fn,
      approvalDate: String(r.approval_date).slice(0, 10),
      homeLc: r.home_lc ?? null,
      partnerLcId: r.home_lc ? (lcByKey.get(normalizeLcName(r.home_lc)) ?? null) : null,
      status: r.status ?? "",
    });
  }
  return [...out.values()].sort((a, b) => b.approvalDate.localeCompare(a.approvalDate));
}

// ------------------------------------------------------------ who gets credit

export interface CreditTarget {
  id: string;
  name: string;
  role: string;
}

/**
 * WHO AN APPROVAL MAY BE CREDITED TO — the partnership-target rule (v35.1),
 * because it answers the same question ("whose win is this?"):
 *
 *   Member            themself, nobody else
 *   MM (TL / Coord.)  themself + the consideration crew of their own ICX
 *                     function (the whole crew when the function opens it)
 *   VP / Director /   the whole consideration crew
 *   LCP / admin
 *
 * The viewer can always credit themself — a VP who closed one personally
 * logs it as theirs.
 */
export async function approvalCreditTargets(viewer: Viewer): Promise<CreditTarget[]> {
  if (!hasConsiderationAccess(viewer)) return [];
  const { listConsiderationCrew } = await import("./data");
  const crew = await listConsiderationCrew(viewer);
  const self: CreditTarget = { id: viewer.id, name: viewer.name, role: viewer.role };
  const withSelf = (list: CreditTarget[]) =>
    [self, ...list.filter((m) => m.id !== viewer.id)];

  if (isLead(viewer)) return withSelf(crew);
  if (viewer.role === "Team Leader" || viewer.role === "Coordinator") {
    const myFns = icxFunctions(viewer);
    let open = false;
    const { functionSettingsFor } = await import("./function-settings");
    for (const fn of myFns) {
      if ((await functionSettingsFor(fn)).partnershipCrossTeam) open = true;
    }
    return withSelf(
      open ? crew : crew.filter((m) => m.fns.some((f) => myFns.includes(f as "IGV" | "IGT")))
    );
  }
  return [self];
}

/** Records an approval can point at: recent IR calls and CVs, and the
 *  raising accounts of the viewer's ICX functions — the form's pickers. */
export async function approvalFormOptions(viewer: Viewer): Promise<{
  irCalls: { id: string; label: string; lcId: string | null; product: string | null }[];
  cvs: { id: string; label: string }[];
  accounts: { id: string; name: string; function: string }[];
}> {
  const lanes = approvalLanes(viewer);
  if (lanes.length === 0) return { irCalls: [], cvs: [], accounts: [] };
  // (v37.7) the account picker is searched in the browser, so it needs EVERY
  // open account — .limit(3000) was capped at 1000 by PostgREST (paged now)
  const { fetchAll } = await import("./data");
  const accountsP = fetchAll<{ id: string; name: string; function: string }>(() =>
    db()
      .from("accounts")
      .select("id, name, function")
      .in("function", [...lanes, "B2B", "BD"])
      .eq("out_of_process", false)
      .eq("is_test", false)
      .order("name")
      .order("id")
  ).catch((e) => {
    console.error("[approvals] account picker read failed:", e?.message ?? e);
    return [] as { id: string; name: string; function: string }[];
  });
  const [{ data: calls }, { data: cvs }, accounts] = await Promise.all([
    db()
      .from("ir_calls")
      .select("id, called_at, partner_lc_id, partner_lc_name, booker_name, member_name, product, status")
      .neq("status", "cancelled")
      .order("called_at", { ascending: false })
      .limit(300),
    db()
      .from("cvs")
      .select("id, person_name, file_name, partner_lc_name, created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    accountsP,
  ]);
  return {
    irCalls: (calls ?? []).map((c) => ({
      id: c.id as string,
      label: `${String(c.called_at).slice(0, 10)} · ${c.partner_lc_name ?? "—"}${
        c.booker_name ? ` · ${c.booker_name}` : ""
      } (${c.member_name ?? "—"})`,
      lcId: (c.partner_lc_id as string | null) ?? null,
      product: (c.product as string | null) ?? null,
    })),
    cvs: (cvs ?? []).map((c) => ({
      id: c.id as string,
      label: `${c.person_name || c.file_name || "CV"}${c.partner_lc_name ? ` · ${c.partner_lc_name}` : ""}`,
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      function: a.function,
    })),
  };
}


/** The approvals board per lane the viewer reads — the Approvals tab's
 *  header. Unfiltered: the month (or sprint) and the peak, exactly as the
 *  dashboard lane shows them with an empty filter bar. */
export async function approvalBoards(
  viewer: Viewer
): Promise<Partial<Record<ApprovalFunction, LaneApprovals>>> {
  const lanes = approvalLanes(viewer);
  if (lanes.length === 0) return {};
  const { listPlanCells, cairoDayIso } = await import("./data");
  const [{ data: rows }, { data: members }, cells] = await Promise.all([
    readAll<LaneApprovalRow>(() =>
      db()
        .from("icx_approvals")
        .select("function, approved_on, product, made_by, made_by_name, partner_lc_name, source")
        .in("function", lanes)
        .order("id")
    ),
    db().from("members").select("id, name, role, stakeholder_id"),
    listPlanCells(lanes.flatMap(planFnsOfLane)),
  ]);
  const now = new Date();
  const month = monthOf(now);
  const sprint = sprintOf(now);
  const peak = peakOf(now);
  const creditMembers = (members ?? []).map((m) => ({
    id: m.id as string,
    name: (m.name as string) ?? "—",
    role: m.role as string,
    managerId: (m.stakeholder_id as string | null) ?? null,
  }));
  const out: Partial<Record<ApprovalFunction, LaneApprovals>> = {};
  for (const fn of lanes) {
    const planFns: string[] = planFnsOfLane(fn);
    out[fn] = laneApprovals({
      rows: ((rows ?? []) as (LaneApprovalRow & { function: string })[]).filter(
        (r) => r.function === fn
      ),
      members: creditMembers,
      plan: await approvalPlanSourceFor(viewer, cells.filter((c) => planFns.includes(c.fn))),
      month,
      sprint,
      peak,
      sprintMode: false,
      today: cairoDayIso(now),
    });
  }
  return out;
}

export type ApprovalLaneActual = { IGV: number; IGTa: number; IGTe: number };

/** ACHIEVED APPROVALS per planning product (IGV · IGTa · IGTe) in each of the
 *  given windows — the /planning page's "achieved" beside the sheet's plan.
 *  One read, bucketed in memory. */
export async function approvalsByWindow<K extends string>(
  windows: Record<K, { start: string; end: string }>
): Promise<Record<K, ApprovalLaneActual>> {
  const keys = Object.keys(windows) as K[];
  const out = Object.fromEntries(
    keys.map((k) => [k, { IGV: 0, IGTa: 0, IGTe: 0 }])
  ) as Record<K, ApprovalLaneActual>;
  if (keys.length === 0) return out;
  const from = keys.map((k) => windows[k].start).sort()[0];
  const to = keys.map((k) => windows[k].end).sort().slice(-1)[0];
  const { data, error } = await readAll<{ product: string; approved_on: string }>(() =>
    db()
      .from("icx_approvals")
      .select("product, approved_on")
      .gte("approved_on", from)
      .lte("approved_on", to)
      .order("id")
  );
  if (error) return out;
  for (const r of data ?? []) {
    const lane = r.product === "GV" ? "IGV" : r.product === "GTa" ? "IGTa" : "IGTe";
    for (const k of keys) {
      const w = windows[k];
      if (r.approved_on >= w.start && r.approved_on <= w.end) out[k][lane] += 1;
    }
  }
  return out;
}

/** An MM's approvals MOS per month: their own, plus — for a Team Leader —
 *  everyone reporting to them (the credit rule, `mosCountFor`). Keyed by
 *  member id → "yyyy-mm" → count. Only members passed in are computed. */
export async function approvalMosByMonth(
  memberIds: string[]
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (memberIds.length === 0) return out;
  const [{ data: rows, error }, { data: members }] = await Promise.all([
    readAll<{ approved_on: string; made_by: string | null; made_by_name: string }>(() =>
      db().from("icx_approvals").select("approved_on, made_by, made_by_name").order("id")
    ),
    db().from("members").select("id, name, role, stakeholder_id"),
  ]);
  if (error) return out;
  const creditMembers = (members ?? []).map((m) => ({
    id: m.id as string,
    name: (m.name as string) ?? "",
    role: m.role as string,
    managerId: (m.stakeholder_id as string | null) ?? null,
  }));
  const byMonth = new Map<string, { approved_on: string; made_by: string | null; made_by_name: string }[]>();
  for (const r of rows ?? []) {
    const key = String(r.approved_on).slice(0, 7);
    const arr = byMonth.get(key) ?? [];
    arr.push(r as { approved_on: string; made_by: string | null; made_by_name: string });
    byMonth.set(key, arr);
  }
  for (const id of memberIds) {
    const perMonth = new Map<string, number>();
    for (const [key, list] of byMonth) {
      const n = mosCountFor(id, list, creditMembers);
      if (n > 0) perMonth.set(key, n);
    }
    out.set(id, perMonth);
  }
  return out;
}

/** Is this viewer held to the FUNCTION's planning sheet? The exact gate the
 *  raising lane plan uses (`viewerIsPlanLeader` in getDashboard). */
export function isApprovalPlanLeader(v: Viewer): boolean {
  return v.isAdmin || ["LCP", "LCVP", "Director"].includes(v.role);
}

/** WHICH PLAN THIS VIEWER SEES (v37.1): leaders the sheet, an MM the plan
 *  they filed on their profile, a Member none — see `ApprovalPlanSource`. */
export async function approvalPlanSourceFor(
  viewer: Viewer,
  cells: import("@/lib/icx-approvals").PlanCellLike[]
): Promise<ApprovalPlanSource> {
  if (isApprovalPlanLeader(viewer)) return { kind: "sheet", cells };
  if (viewer.role !== "Team Leader" && viewer.role !== "Coordinator") return { kind: "none" };
  const { data } = await db()
    .from("mm_plans")
    .select("month, approvals")
    .eq("member_id", viewer.id);
  const monthly: Record<string, number> = {};
  for (const r of data ?? []) {
    if (r.approvals == null) continue;
    monthly[`${String(r.month).slice(0, 7)}-01`] = Number(r.approvals) || 0;
  }
  return { kind: "mine", memberId: viewer.id, monthly };
}
