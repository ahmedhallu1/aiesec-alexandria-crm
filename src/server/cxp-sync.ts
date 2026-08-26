import "server-only";
import { google } from "googleapis";
import { db } from "@/lib/supabase";
import { env, requireEnv } from "@/lib/env";
import { parseAllGrids, deduplicate, SUBTOOL_TABS, type Grid } from "@/lib/cxp/parser";
import { cxpToday, submissionMonthOf, previousMonth } from "@/lib/cxp/deadlines";
import { requirementsForStage } from "@/lib/cxp/requirements";
import type { CxpFunction, CxpStageKey } from "@/lib/cxp/types";

/**
 * THE SUBTOOL SYNC — the ECB's sheet into Supabase.
 *
 * THE PIPELINE, WHICH IS LONGER THAN IT LOOKS (documented so the next person
 * does not "simplify" it into being broken):
 *
 *   the REAL SubTool  (1wi9QK…, readable only by AIESEC accounts)
 *        ↓  a Google Apps Script, hourly, running as an AIESEC user
 *   the MIRROR sheet  (1w4-Pg…, = CXP_SUBTOOL_SHEET_ID, readable by us)
 *        ↓  this function
 *   cxp_ep_records
 *
 * The middle hop exists because the service account CANNOT read the real
 * SubTool — AIESEC's sharing rules forbid it. That is not a workaround to be
 * removed; it is the only way in.
 *
 * IDEMPOTENT BY CONSTRUCTION: rows upsert onto
 * (ep_opp_id, function, stage_key, submission_month), so running the sync
 * twice changes nothing the second time.
 */

export interface SyncResult {
  ok: boolean;
  rows: number;
  duplicates: number;
  statusRows: number;
  removed: number;
  warnings: string[];
  sectionsFound: string[];
  month: string;
}

/** Read the four SubTool tabs off the mirror sheet, in parallel. */
async function readGrids(): Promise<{ grids: { sheetName: string; grid: Grid }[]; warnings: string[] }> {
  const sheetId = process.env.CXP_SUBTOOL_SHEET_ID ?? "";
  if (!sheetId) {
    return { grids: [], warnings: ["CXP_SUBTOOL_SHEET_ID is not set."] };
  }
  const missing = requireEnv("serviceAccountKeyBase64");
  if (missing) return { grids: [], warnings: [missing] };

  const key = JSON.parse(
    Buffer.from(env.serviceAccountKeyBase64, "base64").toString("utf-8")
  );
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const warnings: string[] = [];
  const grids: { sheetName: string; grid: Grid }[] = [];

  // parallel: sequential reads made this roughly four times slower
  const results = await Promise.all(
    SUBTOOL_TABS.map(async (sheetName) => {
      try {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: `'${sheetName}'`,
          // FORMATTED_VALUE, deliberately: the parser wants what a human sees
          // in the cell, not Sheets' underlying serial numbers
          valueRenderOption: "FORMATTED_VALUE",
        });
        return { sheetName, grid: (res.data.values ?? []) as Grid, error: null as string | null };
      } catch (err) {
        return {
          sheetName,
          grid: [] as Grid,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  for (const r of results) {
    if (r.error) warnings.push(`Could not read tab "${r.sheetName}": ${r.error}`);
    else if (r.grid.length > 0) grids.push({ sheetName: r.sheetName, grid: r.grid });
    else warnings.push(`Tab "${r.sheetName}" was empty.`);
  }
  return { grids, warnings };
}

export async function syncSubTool(): Promise<SyncResult> {
  const thisMonth = submissionMonthOf(cxpToday());
  const lastMonth = previousMonth(thisMonth);

  const { grids, warnings } = await readGrids();
  if (grids.length === 0) {
    return {
      ok: false,
      rows: 0,
      duplicates: 0,
      statusRows: 0,
      removed: 0,
      warnings: [...warnings, "No SubTool tabs could be read — nothing was changed."],
      sectionsFound: [],
      month: thisMonth,
    };
  }

  const parsed = parseAllGrids(grids);
  const { rows, duplicates } = deduplicate(parsed.rows);

  const records = rows.map((r) => ({
    ep_opp_id: r.epOppId,
    ep_name: r.epName,
    product: r.product,
    function: r.function,
    side: r.side,
    stage_key: r.stageKey,
    status: r.status,
    approval_date: r.approvalDate,
    start_date: r.startDate,
    end_date: r.endDate,
    arrival_date: r.arrivalDate,
    departure_date: r.departureDate,
    host_lc: r.hostLc,
    home_lc: r.homeLc,
    opportunity_name: null,
    ecb_comment: r.ecbComment,
    submitted_flag: r.submittedFlag,
    audited_flag: r.auditedFlag,
    excused_flag: r.excusedFlag,
    // THE MONTH COMES FROM THE TAB, because the sheet has no month column.
    // A "Past Month" tab row IS last month's submission.
    submission_month: r.isPastMonth ? lastMonth : thisMonth,
    is_past_month: r.isPastMonth,
    sheet_flags: r.sheetFlags,
    source_sheet_name: r.sourceSheetName,
    source_section_name: r.sourceSectionName,
    source_row_number: r.sourceRowNumber,
    confidence_score: r.confidenceScore,
    parsing_warnings: r.parsingWarnings,
    needs_review: r.needsReview,
    synced_at: new Date().toISOString(),
  }));

  // upsert in chunks — one 2,000-row statement is a good way to hit a timeout
  for (let i = 0; i < records.length; i += 250) {
    const { error } = await db()
      .from("cxp_ep_records")
      .upsert(records.slice(i, i + 250), {
        onConflict: "ep_opp_id,function,stage_key,submission_month",
      });
    if (error) throw new Error(`cxp_ep_records upsert failed: ${error.message}`);
  }

  // ROWS THAT LEFT THE SHEET. An EP removed from the SubTool is no longer part
  // of a submission, and leaving it behind would keep it on the weekly board
  // forever. Scoped to the two months we just read, so nothing older is touched.
  const liveKeys = new Set(
    records.map((r) => `${r.ep_opp_id}|${r.function}|${r.stage_key}|${r.submission_month}`)
  );
  const { data: existing } = await db()
    .from("cxp_ep_records")
    .select("id, ep_opp_id, function, stage_key, submission_month")
    .in("submission_month", [thisMonth, lastMonth]);

  const stale = (existing ?? []).filter(
    (e) =>
      !liveKeys.has(`${e.ep_opp_id}|${e.function}|${e.stage_key}|${e.submission_month}`)
  );
  if (stale.length > 0) {
    await db()
      .from("cxp_ep_records")
      .delete()
      .in("id", stale.map((s) => s.id));
  }

  const statusRows = await syncSheetFlags(rows);

  return {
    ok: true,
    rows: records.length,
    duplicates,
    statusRows,
    removed: stale.length,
    warnings: [...warnings, ...parsed.warnings],
    sectionsFound: [...new Set(parsed.sectionsFound)],
    month: thisMonth,
  };
}

/**
 * Fold the sheet's own tick-boxes into `cxp_requirement_status`.
 *
 * THE PRECEDENCE RULE, WHICH MATTERS: a real UPLOAD outranks a sheet flag.
 * Someone attaching a passport in Sodio is stronger evidence than an unticked
 * box in a spreadsheet nobody has got to yet, and the old system preserved
 * upload rows across syncs for exactly this reason. So rows whose source is an
 * upload are left alone; only 'Sheet Flag' rows are rewritten.
 */
async function syncSheetFlags(
  rows: { epOppId: string; function: CxpFunction; stageKey: CxpStageKey; sheetFlags: Record<string, boolean> }[]
): Promise<number> {
  const { data: existing } = await db()
    .from("cxp_requirement_status")
    .select("ep_opp_id, stage_key, requirement_key, source");

  const protectedKeys = new Set(
    (existing ?? [])
      .filter((e) => e.source === "Website Upload" || e.source === "Manual Drive Upload")
      .map((e) => `${e.ep_opp_id}|${e.stage_key}|${e.requirement_key}`)
  );

  const payload: {
    ep_opp_id: string;
    function: CxpFunction;
    stage_key: CxpStageKey;
    requirement_key: string;
    uploaded: boolean;
    source: "Sheet Flag";
    updated_at: string;
  }[] = [];

  const now = new Date().toISOString();
  for (const r of rows) {
    for (const req of requirementsForStage(r.function, r.stageKey)) {
      const key = `${r.epOppId}|${r.stageKey}|${req.key}`;
      if (protectedKeys.has(key)) continue;
      const ticked = Boolean(r.sheetFlags[req.key]);
      // only store a POSITIVE flag: an absent row already means "not collected",
      // and writing a false row per requirement per EP would triple the table
      // for no information
      if (!ticked) continue;
      payload.push({
        ep_opp_id: r.epOppId,
        function: r.function,
        stage_key: r.stageKey,
        requirement_key: req.key,
        uploaded: true,
        source: "Sheet Flag",
        updated_at: now,
      });
    }
  }

  for (let i = 0; i < payload.length; i += 250) {
    const { error } = await db()
      .from("cxp_requirement_status")
      .upsert(payload.slice(i, i + 250), {
        onConflict: "ep_opp_id,stage_key,requirement_key",
      });
    if (error) throw new Error(`cxp_requirement_status upsert failed: ${error.message}`);
  }

  // a box that was UNTICKED in the sheet since the last sync must stop counting
  const live = new Set(
    payload.map((p) => `${p.ep_opp_id}|${p.stage_key}|${p.requirement_key}`)
  );
  const revoked = (existing ?? []).filter(
    (e) =>
      e.source === "Sheet Flag" &&
      !live.has(`${e.ep_opp_id}|${e.stage_key}|${e.requirement_key}`)
  );
  if (revoked.length > 0) {
    for (const r of revoked) {
      await db()
        .from("cxp_requirement_status")
        .delete()
        .eq("ep_opp_id", r.ep_opp_id)
        .eq("stage_key", r.stage_key)
        .eq("requirement_key", r.requirement_key)
        .eq("source", "Sheet Flag");
    }
  }

  return payload.length;
}
