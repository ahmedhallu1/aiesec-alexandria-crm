import "server-only";
import { db } from "@/lib/supabase";
import { getViewer } from "./data";
import {
  canRunCxpOps,
  cxpDefaultFunction,
  cxpDefaultSide,
  cxpFunctions,
  cxpSides,
  hasCxpAccess,
} from "@/lib/cxp/rbac";
import {
  cxpToday,
  previousMonth,
  recentWeeklyDeadlines,
  submissionMonthOf,
  upcomingWeeklyDeadlines,
} from "@/lib/cxp/deadlines";
import { requirementsForStage } from "@/lib/cxp/requirements";
import { collectedForWeek } from "./cxp-drive";
import { selectWeeklyEps, summarize, type WeeklyEp, type WeeklySummary } from "@/lib/cxp/weekly";
import {
  CXP_FUNCTIONS,
  SIDE_FUNCTIONS,
  STAGE_BY_KEY,
  sideOf,
  type CxpEpRecord,
  type CxpEpSummary,
  type CxpFunction,
  type CxpSide,
  type CxpWeeklyDeadline,
} from "@/lib/cxp/types";

/**
 * THE CXP SERVER LAYER.
 *
 * Every export here resolves the viewer FIRST and narrows the query to the
 * functions they may read. No caller passes a function list in — a page that
 * forgets to filter still cannot leak another side's submissions, because the
 * filter is applied here and not by the caller.
 */

/** The functions this request may read, or [] — the single gate. */
async function scope(): Promise<{ fns: CxpFunction[]; sides: CxpSide[] }> {
  const viewer = await getViewer();
  return { fns: cxpFunctions(viewer), sides: cxpSides(viewer) };
}

export async function cxpAccess(): Promise<{
  allowed: boolean;
  functions: CxpFunction[];
  sides: CxpSide[];
  defaultSide: CxpSide | null;
  defaultFunction: CxpFunction | null;
  /** may this viewer build/regenerate the weekly folder + ZIP? */
  canOps: boolean;
}> {
  const viewer = await getViewer();
  return {
    allowed: hasCxpAccess(viewer),
    functions: cxpFunctions(viewer),
    sides: cxpSides(viewer),
    defaultSide: cxpDefaultSide(viewer),
    defaultFunction: cxpDefaultFunction(viewer),
    canOps: canRunCxpOps(viewer),
  };
}

/** Narrow a requested function list to what the viewer may actually read.
 *  An empty request means "everything I'm allowed", never "everything". */
function narrow(allowed: CxpFunction[], requested?: CxpFunction[] | null): CxpFunction[] {
  if (!requested || requested.length === 0) return allowed;
  return requested.filter((f) => allowed.includes(f));
}

// ------------------------------------------------------------------ EP list

export interface EpListOptions {
  /** which side's section is open */
  side?: CxpSide | null;
  /** narrower still — one function inside the side */
  functions?: CxpFunction[] | null;
  /** THE MONTH TOGGLE.
   *
   *  "current"  the default: this month's submissions.
   *  "previous" last month's rows that are still INCOMPLETE — the old
   *             system's past-month view, kept intact but moved behind a
   *             button instead of being mixed into the default list. */
  scope?: "current" | "previous";
  search?: string | null;
}

export interface EpListResult {
  rows: CxpEpSummary[];
  month: string;
  /** how many incomplete rows last month has — the toggle's badge, so nobody
   *  has to click it to discover there is nothing there */
  previousIncompleteCount: number;
}

export async function listEps(opts: EpListOptions = {}): Promise<EpListResult> {
  const { fns } = await scope();
  if (fns.length === 0) {
    return { rows: [], month: submissionMonthOf(cxpToday()), previousIncompleteCount: 0 };
  }

  const sideFns = opts.side ? SIDE_FUNCTIONS[opts.side] : CXP_FUNCTIONS;
  const target = narrow(
    fns.filter((f) => sideFns.includes(f)),
    opts.functions
  );
  if (target.length === 0) {
    return { rows: [], month: submissionMonthOf(cxpToday()), previousIncompleteCount: 0 };
  }

  const thisMonth = submissionMonthOf(cxpToday());
  const lastMonth = previousMonth(thisMonth);
  const wanted = opts.scope === "previous" ? lastMonth : thisMonth;

  let q = db()
    .from("cxp_ep_records")
    .select("*")
    .in("function", target)
    .eq("submission_month", wanted);

  if (opts.search) {
    const s = opts.search.replace(/[%,]/g, " ").trim();
    if (s) q = q.or(`ep_name.ilike.%${s}%,ep_opp_id.ilike.%${s}%`);
  }

  const [{ data }, statusMap, prevCount] = await Promise.all([
    q.order("ep_name"),
    loadStatusMap(target),
    countPreviousIncomplete(target, lastMonth),
  ]);

  const records = (data ?? []) as CxpEpRecord[];
  let rows = records.map((r) => summarizeRecord(r, statusMap));

  // LAST MONTH SHOWS ONLY WHAT IS STILL INCOMPLETE. A finished EP from last
  // month is not work — the whole point of the toggle is the leftovers.
  if (opts.scope === "previous") rows = rows.filter((r) => r.missingCount > 0);

  return { rows, month: wanted, previousIncompleteCount: prevCount };
}

/** Roll one stored row up into the shape the table renders. */
function summarizeRecord(
  r: CxpEpRecord,
  statusMap: Record<string, { uploaded: boolean }>
): CxpEpSummary {
  const reqs = requirementsForStage(r.function, r.stage_key);
  let uploaded = 0;
  for (const req of reqs) {
    const s = statusMap[`${r.ep_opp_id}|${r.stage_key}|${req.key}`];
    if (s ? s.uploaded : Boolean(r.sheet_flags?.[req.key])) uploaded++;
  }
  return {
    epOppId: r.ep_opp_id,
    epName: r.ep_name,
    product: r.product,
    function: r.function,
    side: r.side ?? sideOf(r.function),
    stage: STAGE_BY_KEY[r.stage_key],
    stageKey: r.stage_key,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    uploadedCount: uploaded,
    totalCount: reqs.length,
    missingCount: reqs.length - uploaded,
    needsReview: r.needs_review,
    comment: r.ecb_comment,
    submissionMonth: r.submission_month,
    isPastMonth: r.is_past_month,
  };
}

async function loadStatusMap(
  fns: CxpFunction[]
): Promise<Record<string, { uploaded: boolean }>> {
  const { data } = await db()
    .from("cxp_requirement_status")
    .select("ep_opp_id, stage_key, requirement_key, uploaded")
    .in("function", fns);
  const map: Record<string, { uploaded: boolean }> = {};
  for (const s of data ?? []) {
    map[`${s.ep_opp_id}|${s.stage_key}|${s.requirement_key}`] = { uploaded: s.uploaded };
  }
  return map;
}

/** How many of LAST month's rows still owe something — the toggle's badge. */
async function countPreviousIncomplete(
  fns: CxpFunction[],
  month: string
): Promise<number> {
  const { data } = await db()
    .from("cxp_ep_records")
    .select("*")
    .in("function", fns)
    .eq("submission_month", month);
  const records = (data ?? []) as CxpEpRecord[];
  if (records.length === 0) return 0;
  const statusMap = await loadStatusMap(fns);
  return records.filter((r) => summarizeRecord(r, statusMap).missingCount > 0).length;
}

// -------------------------------------------------------------- one EP page

export async function getEp(epOppId: string): Promise<{
  records: CxpEpRecord[];
  statusMap: Record<string, { uploaded: boolean; file_url: string | null }>;
} | null> {
  const { fns } = await scope();
  if (fns.length === 0) return null;

  const { data } = await db()
    .from("cxp_ep_records")
    .select("*")
    .eq("ep_opp_id", epOppId)
    .in("function", fns);

  const records = (data ?? []) as CxpEpRecord[];
  if (records.length === 0) return null;

  const { data: statuses } = await db()
    .from("cxp_requirement_status")
    .select("ep_opp_id, stage_key, requirement_key, uploaded, file_url")
    .eq("ep_opp_id", epOppId);

  const statusMap: Record<string, { uploaded: boolean; file_url: string | null }> = {};
  for (const s of statuses ?? []) {
    statusMap[`${s.ep_opp_id}|${s.stage_key}|${s.requirement_key}`] = {
      uploaded: s.uploaded,
      file_url: s.file_url,
    };
  }
  return { records, statusMap };
}

// ------------------------------------------------------------ weekly board

export interface WeeklyBoardData {
  deadlines: CxpWeeklyDeadline[];
  selected: string;
  /** true when the selected deadline is in the past — the board then reads
   *  STORED history instead of deriving from today's due dates */
  isPast: boolean;
  summaries: WeeklySummary[];
  eps: Record<string, WeeklyEp[]>;
  /** how many collected documents WITH A FILE each function's ZIP holds for
   *  this deadline — so the download button can say so before it is pressed */
  zipFiles: Record<string, number>;
}

/** THE WEEK SELECTOR'S DATA — the thing the old app never wired up.
 *
 *  `selected` is a real input here: it reaches `selectWeeklyEps`, which filters
 *  on it, so two deadlines genuinely produce two different boards.
 *
 *  Past weeks are read from `cxp_weekly_missing`, which records what was
 *  actually outstanding at that deadline. Deriving them from today's due dates
 *  would be a lie — it would show what is missing NOW, dated to a week that has
 *  already been audited. */
export async function weeklyBoard(opts: {
  side?: CxpSide | null;
  selected?: string | null;
}): Promise<WeeklyBoardData | null> {
  const viewer = await getViewer();
  const fns = cxpFunctions(viewer);
  if (fns.length === 0) return null;

  const today = cxpToday();
  const deadlines = [...recentWeeklyDeadlines(today, 2), ...upcomingWeeklyDeadlines(today, 4)];

  const side = opts.side ?? cxpDefaultSide(viewer);
  const target = fns.filter((f) => (side ? SIDE_FUNCTIONS[side].includes(f) : true));

  // default to the NEXT deadline — the one the LC is working toward
  const fallback = upcomingWeeklyDeadlines(today, 1)[0].date;
  const requested = opts.selected ?? fallback;
  // never trust a URL param: only a deadline the board actually offers
  const selected = deadlines.some((d) => d.date === requested) ? requested : fallback;
  const isPast = selected < today;

  const zipFiles: Record<string, number> = {};
  await Promise.all(
    target.map(async (fn) => {
      try {
        zipFiles[fn] = (await collectedForWeek(fn, selected)).files.length;
      } catch {
        zipFiles[fn] = 0;
      }
    })
  );

  if (isPast) return { ...(await pastWeek(target, selected, deadlines, selected)), zipFiles };

  const [{ data }, statusMap] = await Promise.all([
    db().from("cxp_ep_records").select("*").in("function", target).eq("is_past_month", false),
    loadStatusMap(target),
  ]);
  const records = (data ?? []) as CxpEpRecord[];

  const summaries: WeeklySummary[] = [];
  const eps: Record<string, WeeklyEp[]> = {};
  for (const fn of target) {
    summaries.push(summarize(records, statusMap, fn, selected));
    eps[fn] = selectWeeklyEps(records, statusMap, fn, selected);
  }
  return { deadlines, selected, isPast: false, summaries, eps, zipFiles };
}

/** A week that has already happened, read from the stored snapshot. */
async function pastWeek(
  fns: CxpFunction[],
  deadline: string,
  deadlines: CxpWeeklyDeadline[],
  selected: string
): Promise<Omit<WeeklyBoardData, "zipFiles">> {
  const { data } = await db()
    .from("cxp_weekly_missing")
    .select("*")
    .in("function", fns)
    .eq("deadline_date", deadline);

  const rows = data ?? [];
  const summaries: WeeklySummary[] = [];
  const eps: Record<string, WeeklyEp[]> = {};

  for (const fn of fns) {
    const mine = rows.filter((r) => r.function === fn);
    const byEp = new Map<string, typeof mine>();
    for (const r of mine) {
      const arr = byEp.get(r.ep_opp_id) ?? [];
      arr.push(r);
      byEp.set(r.ep_opp_id, arr);
    }
    eps[fn] = [...byEp.entries()]
      .map(([epOppId, items]) => ({
        epOppId,
        epName: items[0].ep_name,
        product: "",
        stageKey: items[0].stage_key,
        stage: STAGE_BY_KEY[items[0].stage_key as keyof typeof STAGE_BY_KEY] ?? "",
        needsReview: false,
        items: items.map((i) => ({
          function: fn,
          epOppId: i.ep_opp_id,
          epName: i.ep_name,
          stageKey: i.stage_key,
          requirementKey: i.requirement_key,
          requirementName: i.requirement_name,
          dueDate: null,
          bucket: i.origin === "carry-over" ? ("overdue" as const) : ("current" as const),
          uploaded: i.uploaded,
        })),
        missingCount: items.length,
      }))
      .sort((a, b) => a.epName.localeCompare(b.epName));

    summaries.push({
      function: fn,
      deadline,
      epCount: eps[fn].length,
      missingCount: mine.length,
      needsReview: 0,
      currentCount: mine.filter((r) => r.origin === "current").length,
      overdueCount: mine.filter((r) => r.origin === "carry-over").length,
      ongoingCount: 0,
    });
  }
  return { deadlines, selected, isPast: true, summaries, eps };
}
