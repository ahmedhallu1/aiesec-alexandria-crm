// =============================================================================
// CXP — THE SUBTOOL PARSER
//
// Converts the ECB SubTool's raw OGX / ICX submission grids into rows.
// Migrated from the standalone auditing system with its behaviour intact.
//
// THE SHEET IS NOT A TABLE. It is a horizontal multi-section grid:
//
//   row index 3   section labels  (Approvals, Realizations, GV Finished, …)
//   row index 4   column headers  (EP/OPP ID, EP Name, Product, …)
//   row index 5+  data
//
// Sections sit SIDE BY SIDE, separated by blank spacer columns. Each is found
// by its label cell, then read BY HEADER NAME rather than by fixed column
// index — so the parser survives someone inserting a column in the live sheet,
// which is the single most common thing that happens to it.
//
// The date handling below looks paranoid because it is: the live SubTool has
// been observed emitting MM/dd/yyyy, dd/MM/yyyy AND yyyy-dd-MM in the same
// column. Getting this wrong silently shifts a deadline by a day, which is a
// violation and a fine — so an unparseable cell keeps its RAW string rather
// than guessing.
// =============================================================================

import { CXP_REQUIREMENTS } from "./requirements";
import {
  STAGE_BY_KEY,
  sideOf,
  type CxpFunction,
  type CxpSide,
  type CxpStageKey,
} from "./types";

const SECTION_ROW = 3; // 0-based
const HEADER_ROW = 4;
const DATA_START = 5;

/** The four tabs the sync reads. */
export const SUBTOOL_TABS = [
  "OGX Submissions",
  "ICX Submissions",
  "OGX Submissions Past Month",
  "ICX Submissions Past Month",
];

export type Grid = (string | null | undefined)[][];

export interface ParsedRow {
  epOppId: string;
  epName: string;
  product: string;
  function: CxpFunction;
  side: CxpSide;
  stageKey: CxpStageKey;
  status: string;
  approvalDate: string | null;
  startDate: string | null;
  endDate: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  hostLc: string | null;
  homeLc: string | null;
  ecbComment: string | null;
  submittedFlag: boolean | null;
  auditedFlag: boolean | null;
  excusedFlag: boolean | null;
  sheetFlags: Record<string, boolean>;
  sourceSheetName: string;
  sourceSectionName: string;
  sourceRowNumber: number;
  isPastMonth: boolean;
  confidenceScore: number;
  parsingWarnings: string[];
  needsReview: boolean;
  /** epOppId|function|stageKey */
  dedupeKey: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  warnings: string[];
  sectionsFound: string[];
}

function norm(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function cell(grid: Grid, r: number, c: number): string {
  const row = grid[r];
  if (!row) return "";
  const v = row[c];
  return v === null || v === undefined ? "" : String(v).trim();
}

function toBool(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "✓" || s === "done";
}

/** Clamp-and-validate a (year, month, day) triple into yyyy-MM-dd, or null. */
function buildIso(year: number, month: number, day: number): string | null {
  // SWAPPED MONTH/DAY (e.g. the source emitted yyyy-dd-MM like "2026-31-08"):
  // when the "month" cannot be a month but the "day" can, swap them.
  if (month > 12 && day <= 12) [month, day] = [day, month];
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Normalise a date-ish cell to yyyy-MM-dd, or null. Hardened against the
 * quirks actually seen in the live SubTool:
 *   "2026-31-08" (yyyy-dd-MM, swapped)         → 2026-08-31
 *   "31/08/2026", "31-08-2026", "31.08.2026"   → 2026-08-31
 *   "5/15/2026"  (MM/dd/yyyy — the real format) → 2026-05-15
 *   anything unparseable                        → null
 */
export function toIsoDateLoose(v?: string | null): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  // ISO-ish "2026-06-02", "2026-06-02 21:36:06", also with / or .
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // MONTH-FIRST is the SubTool's actual format — verified against raw cells
  // ("5/15/2026" = 15 May). If the first number cannot be a month, the value
  // was entered day-first, so swap.
  const md = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (md) {
    let month = Number(md[1]);
    let day = Number(md[2]);
    if (month > 12 && day <= 12) [month, day] = [day, month];
    return buildIso(Number(md[3]), month, day);
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    // LOCAL parts on purpose: toISOString() converts to UTC and would shift a
    // date parsed at local midnight back a day in Africa/Cairo (UTC+2/+3).
    return buildIso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return null;
}

/** The function a row belongs to: side + product family. */
export function mapFunction(side: CxpSide, product: string): CxpFunction {
  const isGt = (product || "").trim().toUpperCase().startsWith("GT");
  if (side === "OGX") return isGt ? "OGT" : "OGV";
  return isGt ? "IGT" : "IGV";
}

interface SectionDef {
  label: string;
  stageKey: CxpStageKey;
  productHint?: "GV" | "GT";
  startCol: number;
  endCol: number;
  headers: Record<string, number>;
}

function sectionToStage(
  label: string
): { stageKey: CxpStageKey; productHint?: "GV" | "GT" } | null {
  const l = norm(label);
  if (!l) return null;
  // ORDER MATTERS: "post approval" must be tested before "approval"
  if (l.includes("post approval")) return { stageKey: "post_approval" };
  if (l.startsWith("approval")) return { stageKey: "approval" };
  if (l.includes("realization")) return { stageKey: "realization" };
  if (l.includes("gv finished")) return { stageKey: "finish", productHint: "GV" };
  if (l.includes("gt finished")) return { stageKey: "finish", productHint: "GT" };
  if (l.includes("monthly")) return { stageKey: "monthly" };
  return null;
}

/** normalisedSheetColumn -> requirementKey, for one side + stage. */
function columnRequirementMap(side: CxpSide, stageKey: CxpStageKey): Record<string, string> {
  const fns: CxpFunction[] = side === "OGX" ? ["OGV", "OGT"] : ["IGV", "IGT"];
  const map: Record<string, string> = {};
  for (const fn of fns) {
    const g = CXP_REQUIREMENTS[fn].find((x) => x.stageKey === stageKey);
    if (!g) continue;
    for (const req of g.requirements) {
      if (req.sheetColumn) map[norm(req.sheetColumn)] = req.key;
    }
  }
  return map;
}

function detectSections(grid: Grid): SectionDef[] {
  const sectionRow = grid[SECTION_ROW] || [];
  const headerRow = grid[HEADER_ROW] || [];
  const maxCol = Math.max(sectionRow.length, headerRow.length);

  const starts: { col: number; label: string }[] = [];
  for (let c = 0; c < maxCol; c++) {
    const label = cell(grid, SECTION_ROW, c);
    if (label) starts.push({ col: c, label });
  }

  const sections: SectionDef[] = [];
  for (let i = 0; i < starts.length; i++) {
    const { col, label } = starts[i];
    const mapped = sectionToStage(label);
    if (!mapped) continue;
    const endCol = (i + 1 < starts.length ? starts[i + 1].col : maxCol) - 1;
    const headers: Record<string, number> = {};
    for (let c = col; c <= endCol; c++) {
      const h = norm(headerRow[c]);
      // FIRST header wins: a duplicated label inside one section must not
      // silently repoint to the later column
      if (h && !(h in headers)) headers[h] = c;
    }
    sections.push({ label, ...mapped, startCol: col, endCol, headers });
  }
  return sections;
}

function findHeaderCol(
  headers: Record<string, number>,
  candidates: string[]
): number | undefined {
  for (const cand of candidates) {
    const n = norm(cand);
    if (n in headers) return headers[n];
    for (const key of Object.keys(headers)) {
      if (key.includes(n)) return headers[key];
    }
  }
  return undefined;
}

/** Parse one submission grid (OGX or ICX, current or past month). */
export function parseSubmissionGrid(grid: Grid, sheetName: string): ParseResult {
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];
  if (!grid || grid.length < DATA_START) {
    return { rows, warnings: [`Sheet "${sheetName}" has no data rows.`], sectionsFound: [] };
  }

  const side: CxpSide = /ogx/i.test(sheetName) ? "OGX" : "ICX";
  const isPastMonth = /past/i.test(sheetName);

  const sections = detectSections(grid);
  if (sections.length === 0) {
    warnings.push(
      `No known sections detected in "${sheetName}". Check the sheet layout (rows 4-5).`
    );
  }

  for (const section of sections) {
    const colReqMap = columnRequirementMap(side, section.stageKey);
    const h = section.headers;

    const idCol = findHeaderCol(h, ["ep/opp id", "ep / opp id", "ep_op id", "ep opp id"]);
    const nameCol = findHeaderCol(h, ["ep name"]);
    const productCol = findHeaderCol(h, ["product"]);
    const statusCol = findHeaderCol(h, ["current status", "status"]);
    const approvalCol = findHeaderCol(h, ["approval"]);
    const slotStartCol = findHeaderCol(h, ["slot start", "realization"]);
    const slotEndCol = findHeaderCol(h, ["slot end", "experience end"]);
    const expEndCol = findHeaderCol(h, ["experience end"]);
    const flightCol = findHeaderCol(h, ["flight date"]);
    const departureCol = findHeaderCol(h, ["departure date"]);
    const lcCol = findHeaderCol(h, ["he lc", "se lc", "lc"]);
    const submittedCol = findHeaderCol(h, ["submitted", "submited"]);
    const auditedCol = findHeaderCol(h, ["audited"]);
    const excusedCol = findHeaderCol(h, ["excused"]);
    const commentCol = findHeaderCol(h, ["comment"]);

    if (idCol === undefined) {
      warnings.push(
        `Section "${section.label}" in ${sheetName}: no EP/OPP ID column found — skipped.`
      );
      continue;
    }

    for (let r = DATA_START; r < grid.length; r++) {
      const epOppId = cell(grid, r, idCol);
      if (!epOppId) continue; // a blank row inside this block

      const parsingWarnings: string[] = [];
      const epName = nameCol !== undefined ? cell(grid, r, nameCol) : "";
      let product = productCol !== undefined ? cell(grid, r, productCol) : "";
      if (!product && section.productHint) product = section.productHint;
      if (!product) {
        product = section.productHint || "GV";
        parsingWarnings.push("Product missing — inferred from section.");
      }

      const fn = mapFunction(side, product);
      const startRaw = slotStartCol !== undefined ? cell(grid, r, slotStartCol) : "";
      const endRaw =
        slotEndCol !== undefined
          ? cell(grid, r, slotEndCol)
          : expEndCol !== undefined
            ? cell(grid, r, expEndCol)
            : "";
      const arrivalRaw = flightCol !== undefined ? cell(grid, r, flightCol) : "";
      const departureRaw = departureCol !== undefined ? cell(grid, r, departureCol) : "";
      const lc = lcCol !== undefined ? cell(grid, r, lcCol) : "";
      const approvalRaw = approvalCol !== undefined ? cell(grid, r, approvalCol) : "";

      // per-requirement booleans inside THIS section
      const sheetFlags: Record<string, boolean> = {};
      for (const [normHeader, colIdx] of Object.entries(section.headers)) {
        const reqKey = colReqMap[normHeader];
        if (reqKey) sheetFlags[reqKey] = toBool(cell(grid, r, colIdx));
      }

      // CONFIDENCE — the parser's own doubt, surfaced as `needs_review` rather
      // than thrown away. A row it half-understood is worth a human's glance.
      let confidence = 1;
      if (!epName) {
        confidence -= 0.2;
        parsingWarnings.push("EP Name missing.");
      }
      if (section.stageKey === "realization" && !arrivalRaw && !startRaw) {
        confidence -= 0.15;
        parsingWarnings.push("No realization/arrival date for a realization record.");
      }
      if (isPastMonth) confidence -= 0.05;

      rows.push({
        epOppId,
        epName: epName || "(unknown)",
        product,
        function: fn,
        side,
        stageKey: section.stageKey,
        status: statusCol !== undefined ? cell(grid, r, statusCol) : "",
        // an unparseable date keeps its RAW text: the column is typed `date`
        // in Postgres, so the sync coerces and drops what it cannot read —
        // better a null with a warning than a confidently wrong deadline
        approvalDate: toIsoDateLoose(approvalRaw),
        startDate: toIsoDateLoose(startRaw),
        endDate: toIsoDateLoose(endRaw),
        arrivalDate: toIsoDateLoose(arrivalRaw),
        departureDate: toIsoDateLoose(departureRaw),
        hostLc: side === "OGX" ? lc || null : null,
        homeLc: side === "ICX" ? lc || null : null,
        ecbComment: commentCol !== undefined ? cell(grid, r, commentCol) || null : null,
        submittedFlag:
          submittedCol !== undefined ? toBool(cell(grid, r, submittedCol)) : null,
        auditedFlag: auditedCol !== undefined ? toBool(cell(grid, r, auditedCol)) : null,
        excusedFlag: excusedCol !== undefined ? toBool(cell(grid, r, excusedCol)) : null,
        sheetFlags,
        sourceSheetName: sheetName,
        sourceSectionName: section.label,
        sourceRowNumber: r + 1, // 1-based, so it matches what a human sees
        isPastMonth,
        confidenceScore: Math.max(0, Math.min(1, confidence)),
        parsingWarnings,
        needsReview: confidence < 0.7,
        dedupeKey: `${epOppId}|${fn}|${section.stageKey}`,
      });

      // a raw date the parser could not read is worth saying out loud once
      for (const [label, raw, parsed] of [
        ["approval", approvalRaw, toIsoDateLoose(approvalRaw)],
        ["start", startRaw, toIsoDateLoose(startRaw)],
        ["end", endRaw, toIsoDateLoose(endRaw)],
        ["arrival", arrivalRaw, toIsoDateLoose(arrivalRaw)],
      ] as [string, string, string | null][]) {
        if (raw && !parsed) {
          warnings.push(
            `${sheetName} row ${r + 1} (${epOppId}): unreadable ${label} date "${raw}".`
          );
        }
      }
    }
  }

  return {
    rows,
    warnings,
    sectionsFound: sections.map((s) => `${s.label} -> ${STAGE_BY_KEY[s.stageKey]}`),
  };
}

/** Parse several grids (OGX + ICX, current + past month). */
export function parseAllGrids(grids: { sheetName: string; grid: Grid }[]): ParseResult {
  const rows: ParsedRow[] = [];
  const warnings: string[] = [];
  const sectionsFound: string[] = [];
  for (const g of grids) {
    const res = parseSubmissionGrid(g.grid, g.sheetName);
    rows.push(...res.rows);
    warnings.push(...res.warnings);
    sectionsFound.push(...res.sectionsFound);
  }
  return { rows, warnings, sectionsFound };
}

/** Collapse rows that share a dedupe key — the SAME EP listed twice in one
 *  section. The most confident row wins; ties keep the first. */
export function deduplicate(rows: ParsedRow[]): {
  rows: ParsedRow[];
  duplicates: number;
} {
  const byKey = new Map<string, ParsedRow>();
  let duplicates = 0;
  for (const row of rows) {
    // current-month and past-month rows are DIFFERENT records, not duplicates
    const key = `${row.dedupeKey}|${row.isPastMonth ? "past" : "now"}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    duplicates++;
    if (row.confidenceScore > existing.confidenceScore) byKey.set(key, row);
    else {
      existing.needsReview = true;
      existing.parsingWarnings.push(
        `Duplicate row for this EP/stage (sheet row ${row.sourceRowNumber}).`
      );
    }
  }
  return { rows: [...byKey.values()], duplicates };
}

export { sideOf };
