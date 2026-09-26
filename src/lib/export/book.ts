// =============================================================================
// DATA EXPORT — the file side (v37.2). Pure and browser-safe.
//
// The server builds a BOOK (named sheets of rows) from the same scoped reads
// the pages use; the browser turns it into Excel or CSV. Nothing here decides
// who may read what — that is the server's job, before a row is ever built.
// =============================================================================

export type ExportCell = string | number | boolean | null;

export interface ExportSheet {
  /** the tab name in Excel, and the CSV file's suffix */
  name: string;
  columns: string[];
  rows: ExportCell[][];
}

export interface ExportBook {
  /** without an extension — "Sodio accounts 2026-09-26" */
  fileName: string;
  sheets: ExportSheet[];
}

/** Excel refuses tab names over 31 characters or with []:*?/\ in them. */
export function safeSheetName(name: string, used: Set<string> = new Set()): string {
  let base = String(name || "Sheet").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let n = 2;
  let out = base;
  while (used.has(out.toLowerCase())) {
    const suffix = ` (${n++})`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(out.toLowerCase());
  base = out;
  return base;
}

/** A filesystem-safe file name. */
export function safeFileName(name: string): string {
  return String(name || "export").replace(/[\\/:*?"<>|]+/g, "-").trim() || "export";
}

/** One cell, CSV-quoted. A leading = + - @ is prefixed with ' so a spreadsheet
 *  never runs an exported value as a formula (CSV injection). */
function csvCell(v: ExportCell): string {
  if (v == null) return "";
  let s = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A sheet as CSV text, with a BOM so Excel reads Arabic names correctly. */
export function toCsv(sheet: ExportSheet): string {
  const lines = [sheet.columns, ...sheet.rows].map((r) => r.map(csvCell).join(","));
  return "\uFEFF" + lines.join("\r\n");
}
