// =============================================================================
// CXP — THE WEEKLY SUBMISSION MODEL
//
// THE BUG THIS FILE EXISTS TO FIX (found 2026-08-26):
//
//   The old app rendered a row of week chips and let you click them, and
//   nothing changed. It was not a wiring fault — `selectWeeklyEPs(records, fn)`
//   had NO deadline parameter and the page took no searchParams, so there was
//   no filter for the selected week to flow into. The per-week filter had
//   never been written. Folder and ZIP generation used the deadline purely as
//   a folder NAME, so every week's ZIP held a byte-identical file set.
//
// THE SOURCE HAS NO WEEK COLUMN. The ECB SubTool splits current vs past by TAB
// (month granularity), so week membership has to be DERIVED. Every requirement
// already has a computed due date, and that is what a week means:
//
//   current   due inside (previous deadline, this deadline]  — owed THIS week
//   overdue   due on or before the previous deadline, still missing
//   ongoing   no deadline rule at all (passport, contract…) — owed continuously
//   upcoming  due after this deadline — NOT part of this week
//
// So a week's submission = current + overdue + ongoing. Dated items move
// between weeks, which is what makes the selector do something; undated ones
// are always owed and are never hidden behind a week boundary.
//
// For weeks already PAST, `cxp_weekly_missing` holds what was actually missing
// at the time — real history, written on every reminder run. The old app wrote
// that table and never read it back.
// =============================================================================

import { computeDeadlinesForRecord, previousWeeklyDeadline, toIsoDate } from "./deadlines";
import { requirementsForStage } from "./requirements";
import {
  STAGE_BY_KEY,
  type CxpEpRecord,
  type CxpFunction,
  type CxpRequirementStatus,
  type CxpStageKey,
} from "./types";

/** Which bucket a requirement falls into for a given weekly deadline. */
export type WeekBucket = "current" | "overdue" | "ongoing" | "upcoming";

/** Stage ordering — the "most advanced stage wins" rule for picking the row
 *  that represents an EP across its several stage rows. */
const STAGE_ORDER: Record<CxpStageKey, number> = {
  approval: 1,
  post_approval: 2,
  realization: 3,
  monthly: 4,
  finish: 5,
};

export interface WeeklyItem {
  function: CxpFunction;
  epOppId: string;
  epName: string;
  stageKey: CxpStageKey;
  requirementKey: string;
  requirementName: string;
  /** the computed due date, when the requirement has a deadline rule */
  dueDate: string | null;
  bucket: WeekBucket;
  uploaded: boolean;
}

export interface WeeklyEp {
  epOppId: string;
  epName: string;
  product: string;
  stageKey: CxpStageKey;
  stage: string;
  needsReview: boolean;
  /** what this EP owes at the selected deadline */
  items: WeeklyItem[];
  missingCount: number;
}

/** The key a requirement status is stored under. */
export function statusKey(
  epOppId: string,
  stageKey: CxpStageKey,
  requirementKey: string
): string {
  return `${epOppId}|${stageKey}|${requirementKey}`;
}

/** Has this requirement been satisfied? An explicit upload wins; otherwise the
 *  sheet's own flag is the answer. (Same precedence as the old app.) */
export function isUploaded(
  rec: CxpEpRecord,
  reqKey: string,
  statusMap: Record<string, Pick<CxpRequirementStatus, "uploaded">>
): boolean {
  const s = statusMap[statusKey(rec.ep_opp_id, rec.stage_key, reqKey)];
  if (s) return s.uploaded;
  return Boolean(rec.sheet_flags?.[reqKey]);
}

/** Which bucket a due date falls into, relative to one weekly deadline. */
export function bucketFor(dueDate: string | null, deadline: string): WeekBucket {
  if (!dueDate) return "ongoing";
  const prev = previousWeeklyDeadline(deadline);
  if (dueDate > deadline) return "upcoming";
  if (dueDate > prev) return "current";
  return "overdue";
}

/** Every requirement a function owes at ONE weekly deadline.
 *
 *  `deadline` is the parameter the old `selectWeeklyEPs` was missing — it is
 *  what makes two different weeks produce two different answers. */
export function weeklyItemsFor(
  records: CxpEpRecord[],
  statusMap: Record<string, Pick<CxpRequirementStatus, "uploaded">>,
  fn: CxpFunction,
  deadline: string,
  now: Date = new Date()
): WeeklyItem[] {
  const out: WeeklyItem[] = [];
  // PAST-MONTH ROWS ARE NOT PART OF A WEEKLY SUBMISSION. They live behind the
  // EP list's "last month" toggle; the weekly board is about what is owed now.
  for (const rec of records.filter((r) => r.function === fn && !r.is_past_month)) {
    const dues = new Map(
      computeDeadlinesForRecord(
        {
          epOppId: rec.ep_opp_id,
          function: rec.function,
          stageKey: rec.stage_key,
          approvalDate: toIsoDate(rec.approval_date),
          startDate: toIsoDate(rec.start_date),
          endDate: toIsoDate(rec.end_date),
          arrivalDate: toIsoDate(rec.arrival_date),
          product: rec.product ?? "",
        },
        now
      ).map((d) => [d.requirementKey, d.dueDate] as const)
    );

    for (const req of requirementsForStage(fn, rec.stage_key)) {
      const uploaded = isUploaded(rec, req.key, statusMap);
      if (uploaded) continue;
      const dueDate = dues.get(req.key) ?? null;
      const bucket = bucketFor(dueDate, deadline);
      // not owed yet at this deadline
      if (bucket === "upcoming") continue;
      out.push({
        function: fn,
        epOppId: rec.ep_opp_id,
        epName: rec.ep_name,
        stageKey: rec.stage_key,
        requirementKey: req.key,
        requirementName: req.name,
        dueDate,
        bucket,
        uploaded: false,
      });
    }
  }
  return dedupeItems(out);
}

/** Collapse duplicates (an EP can appear in several source rows) — latest wins
 *  and the result is stably ordered so two renders never disagree. */
export function dedupeItems(items: WeeklyItem[]): WeeklyItem[] {
  const byKey = new Map<string, WeeklyItem>();
  for (const i of items) {
    byKey.set(`${i.epOppId}|${i.stageKey}|${i.requirementKey}`, i);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.epName}|${a.stageKey}|${a.requirementName}`.localeCompare(
      `${b.epName}|${b.stageKey}|${b.requirementName}`
    )
  );
}

/** The EPs that belong to a function's submission AT ONE DEADLINE, each with
 *  what it owes. An EP with nothing owed that week is not in the list. */
export function selectWeeklyEps(
  records: CxpEpRecord[],
  statusMap: Record<string, Pick<CxpRequirementStatus, "uploaded">>,
  fn: CxpFunction,
  deadline: string,
  now: Date = new Date()
): WeeklyEp[] {
  const items = weeklyItemsFor(records, statusMap, fn, deadline, now);
  const byEp = new Map<string, WeeklyItem[]>();
  for (const i of items) {
    const arr = byEp.get(i.epOppId) ?? [];
    arr.push(i);
    byEp.set(i.epOppId, arr);
  }

  const recsByEp = new Map<string, CxpEpRecord[]>();
  for (const r of records.filter((r) => r.function === fn && !r.is_past_month)) {
    const arr = recsByEp.get(r.ep_opp_id) ?? [];
    arr.push(r);
    recsByEp.set(r.ep_opp_id, arr);
  }

  const out: WeeklyEp[] = [];
  for (const [epOppId, epItems] of byEp.entries()) {
    const recs = recsByEp.get(epOppId) ?? [];
    if (recs.length === 0) continue;
    // the most advanced stage is the representative row
    const rep = [...recs].sort(
      (a, b) => (STAGE_ORDER[b.stage_key] || 0) - (STAGE_ORDER[a.stage_key] || 0)
    )[0];
    out.push({
      epOppId,
      epName: rep.ep_name,
      product: rep.product,
      stageKey: rep.stage_key,
      stage: STAGE_BY_KEY[rep.stage_key],
      needsReview: recs.some((r) => r.needs_review),
      items: epItems,
      missingCount: epItems.length,
    });
  }
  return out.sort((a, b) => a.epName.localeCompare(b.epName));
}

export interface WeeklySummary {
  function: CxpFunction;
  deadline: string;
  epCount: number;
  missingCount: number;
  needsReview: number;
  /** the split that makes a week legible: what is newly due vs still owed */
  currentCount: number;
  overdueCount: number;
  ongoingCount: number;
}

/** The numbers on a function's card, FOR THE SELECTED WEEK.
 *
 *  In the old app `epCount` and `missingCount` were computed over different
 *  record sets — one filtered out past-month rows and the other didn't — so
 *  every card overstated "docs missing" against its own EP count. Both now
 *  come from the same selection. */
export function summarize(
  records: CxpEpRecord[],
  statusMap: Record<string, Pick<CxpRequirementStatus, "uploaded">>,
  fn: CxpFunction,
  deadline: string,
  now: Date = new Date()
): WeeklySummary {
  const eps = selectWeeklyEps(records, statusMap, fn, deadline, now);
  const items = eps.flatMap((e) => e.items);
  return {
    function: fn,
    deadline,
    epCount: eps.length,
    missingCount: items.length,
    needsReview: eps.filter((e) => e.needsReview).length,
    currentCount: items.filter((i) => i.bucket === "current").length,
    overdueCount: items.filter((i) => i.bucket === "overdue").length,
    ongoingCount: items.filter((i) => i.bucket === "ongoing").length,
  };
}
