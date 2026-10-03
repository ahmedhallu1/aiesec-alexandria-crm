// =============================================================================
// CXP — DRIVE NAMING, FILE MATCHING AND UPLOAD VALIDATION
//
// The pure half of the Drive layer: everything that decides WHAT a file is
// called, WHERE it belongs, and WHICH requirement it satisfies. No Google calls
// here, so all of it is unit-testable — the API side lives in
// src/server/cxp-drive.ts.
//
// THE FOLDER LAYOUT follows the LC's OWN convention, read off the two Drive
// trees the CXP directors pointed at ("AIESEC in Alexandria Internal Audit
// System" and "EPs Folder (DOCs)"). Both put the FUNCTION at the top level and
// one folder per EP under it — there is no "EP Files" level:
//
//   [Function] / [EP/OPP ID] - [EP Name] / {Approval, Post Approval,
//                                           Realization, Finish, Monthly …}
//   ECB Weekly Submissions / [Function] / [YYYY-MM-DD] / [EP/OPP ID] - [EP Name]
//   Generated ZIPs / [Function] / [YYYY-MM-DD]
//
// THE ID COMES FIRST. "5583697_1331335 - Hager Ashraf", not the other way
// round: that is what the existing folders are called, it sorts by EP rather
// than by first name, and two EPs genuinely do share a name.
//
// DOCUMENTS SIT LOOSE TOO. In the real tree most files are dropped straight
// into the EP folder and only some into a stage subfolder, so the scanner has
// to look in both — see `scanCxpDrive`.
//
// FUZZY MATCHING exists because half the documents never come through the
// website — someone drops a passport scan straight into the EP's Drive folder,
// and the system has to work out which requirement it satisfies from the file
// name alone. It is deliberately conservative: a weak match is flagged for a
// human rather than silently counted as a collected document, because a
// document wrongly marked collected is how an LC walks into an audit short.
// =============================================================================

import { CXP_REQUIREMENTS } from "./requirements";
import {
  STAGE_BY_KEY,
  STAGE_DRIVE_FOLDER,
  type CxpFunction,
  type CxpStageKey,
} from "./types";

/** The top-level folders under the CXP Drive root: the four product
 *  functions, plus the two generated trees. */
export const CXP_ROOT_SUBFOLDERS = [
  "IGV",
  "IGT",
  "OGV",
  "OGT",
  "ECB Weekly Submissions",
  "Generated ZIPs",
];

/** Extensions that have no business being an audit document. */
export const DANGEROUS_UPLOAD_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "cpl", "dll", "js", "jse", "jar", "msi", "msc",
  "ps1", "psm1", "reg", "scr", "sh", "vb", "vbe", "vbs", "wsf", "wsh", "app",
  "deb", "rpm", "dmg", "pkg", "apk", "lnk", "hta", "iso", "img",
  // active web content (v37.7): documents are served from Sodio's own origin
  "html", "htm", "xhtml", "xht", "shtml", "svg", "svgz", "xml", "mht", "mhtml",
]);

/** The MIME type a document is STORED with, decided by its extension — never
 *  by the uploader's browser (v37.7). /api/cxp/file streams documents from
 *  Sodio's own origin, so a claimed "text/html" would have rendered as a page
 *  there. Unknown types are plain bytes. */
const CXP_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
};

export function cxpMimeType(name: string): string {
  return CXP_MIME[fileExtension(name)] ?? "application/octet-stream";
}

/** A generous ceiling: an audit document is a photo or a PDF, not a video. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// ------------------------------------------------------------------ naming

/** Strip anything Drive or a filesystem would choke on. */
export function safeName(s: string): string {
  return String(s ?? "").replace(/[\\/:*?"<>|]/g, "_").trim();
}

/** Lowercased extension without the dot, or "". */
export function fileExtension(name: string): string {
  const base = String(name || "").split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase().trim();
}

export function isDangerousFile(name: string): boolean {
  return DANGEROUS_UPLOAD_EXTENSIONS.has(fileExtension(name));
}

/** Strip C0/C1 control chars, DEL, and the Unicode bidi overrides — the
 *  characters that let a file called "photo‮gnp.exe" render as
 *  "photoexe.png" in a listing. */
function stripUnsafeChars(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || cp === 0x7f) continue;
    if (cp >= 0x202a && cp <= 0x202e) continue; // bidi embedding / override
    if (cp >= 0x2066 && cp <= 0x2069) continue; // bidi isolates
    out += ch;
  }
  return out;
}

/** Make a user-supplied filename safe to store: drop any directory path,
 *  remove control/bidi characters, collapse whitespace, cap the length while
 *  keeping the extension. Never returns "". */
export function sanitizeFilename(name: string, maxLen = 200): string {
  const base = String(name || "").split(/[\\/]/).pop() || "";
  const cleaned = stripUnsafeChars(base).replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  if (cleaned.length <= maxLen) return cleaned;
  const ext = fileExtension(cleaned);
  if (!ext) return cleaned.slice(0, maxLen);
  const stem = cleaned.slice(0, cleaned.length - ext.length - 1);
  return `${stem.slice(0, Math.max(1, maxLen - ext.length - 1))}.${ext}`;
}

/** "5583697_1331335 - Hager Ashraf" — the LC's existing convention. */
export function epFolderName(epName: string, epOppId: string): string {
  return `${safeName(epOppId)} - ${safeName(epName)}`;
}

/** Parse "[EP/OPP ID] - [EP Name]" back to the id.
 *
 *  Splits on the FIRST " - " only, because EP names contain dashes
 *  ("Omar El-Deeb") far more often than ids do. */
export function parseEpFolderName(name: string): string | undefined {
  const raw = String(name ?? "");
  const at = raw.indexOf(" - ");
  if (at <= 0) return undefined;
  return raw.slice(0, at).trim() || undefined;
}

export function stageFolderName(stageKey: CxpStageKey): string {
  return STAGE_DRIVE_FOLDER[stageKey];
}

/** Reverse-map a stage folder name to its key. ORDER MATTERS: "post approval"
 *  contains "approval". */
export function stageKeyFromFolderName(folderName: string): CxpStageKey | undefined {
  const n = String(folderName ?? "").toLowerCase();
  if (n.includes("post approval")) return "post_approval";
  if (n.includes("approval")) return "approval";
  if (n.includes("realization")) return "realization";
  if (n.includes("finish")) return "finish";
  if (n.includes("monthly")) return "monthly";
  return undefined;
}

/** The stored filename convention, carried over verbatim so files uploaded by
 *  the old system and the new one sort together in a Drive listing. */
export function buildStoredFileName(
  epOppId: string,
  stageKey: CxpStageKey,
  requirementName: string,
  originalName: string,
  now: Date = new Date()
): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `_${p(now.getHours())}-${p(now.getMinutes())}`;
  return `${safeName(epOppId)} - ${safeName(STAGE_BY_KEY[stageKey])} - ${safeName(
    requirementName
  )} - ${stamp} - ${safeName(sanitizeFilename(originalName))}`;
}

export function weeklyFolderPath(fn: CxpFunction, deadline: string): string[] {
  return ["ECB Weekly Submissions", fn, deadline];
}

export function zipFolderPath(fn: CxpFunction, deadline: string): string[] {
  return ["Generated ZIPs", fn, deadline];
}

export function zipFileName(fn: CxpFunction, deadline: string): string {
  return `${fn} - ECB Submission - ${deadline}.zip`;
}

// -------------------------------------------------------------- matching

function normalizeForMatch(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "") // drop the extension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Anything at or below this is not trusted as an answer — the file is
 *  indexed but flagged for a human. */
export const MATCH_REVIEW_THRESHOLD = 0.6;

export interface RequirementMatch {
  requirementKey?: string;
  confidence: number;
}

/**
 * Score a filename against the requirements of one function + stage.
 *
 * Two signals, deliberately in this order:
 *   a SUBSTRING hit either way ("passport" in "amina passport scan") is strong,
 *   but only when the candidate is long enough to mean something — a two-letter
 *   alias like "id" matches half the words in English, so short ones score low;
 *   otherwise TOKEN OVERLAP, scaled by how much of the candidate was found.
 */
export function matchRequirement(
  fileName: string,
  fn: CxpFunction,
  stageKey: CxpStageKey
): RequirementMatch {
  const target = normalizeForMatch(fileName);
  if (!target) return { confidence: 0 };
  const group = CXP_REQUIREMENTS[fn]?.find((g) => g.stageKey === stageKey);
  if (!group) return { confidence: 0 };

  let best: RequirementMatch = { requirementKey: undefined, confidence: 0 };
  for (const req of group.requirements) {
    const candidates = [req.name, req.key.replace(/_/g, " "), ...req.aliases].map(
      normalizeForMatch
    );
    let score = 0;
    for (const cand of candidates) {
      if (!cand) continue;
      if (target.includes(cand) || cand.includes(target)) {
        score = Math.max(score, cand.length >= 4 ? 0.9 : 0.6);
      } else {
        const t = new Set(target.split(" "));
        const words = cand.split(" ").filter((w) => w.length > 2);
        const hits = words.filter((w) => t.has(w)).length;
        if (words.length) score = Math.max(score, (hits / words.length) * 0.7);
      }
    }
    if (score > best.confidence) best = { requirementKey: req.key, confidence: score };
  }
  return best;
}

export interface UploadCheck {
  ok: boolean;
  error?: string;
  storedName?: string;
}

/** Validate one website upload before it goes anywhere near Drive. */
export function checkUpload(opts: {
  fileName: string;
  size: number;
  epOppId: string;
  stageKey: CxpStageKey;
  requirementName: string;
  now?: Date;
}): UploadCheck {
  const name = sanitizeFilename(opts.fileName);
  if (isDangerousFile(name)) {
    return { ok: false, error: `"${name}" is an executable or script, not a document.` };
  }
  if (opts.size <= 0) return { ok: false, error: "The file is empty." };
  if (opts.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That file is ${(opts.size / 1024 / 1024).toFixed(1)} MB — the limit is ${
        MAX_UPLOAD_BYTES / 1024 / 1024
      } MB.`,
    };
  }
  return {
    ok: true,
    storedName: buildStoredFileName(
      opts.epOppId,
      opts.stageKey,
      opts.requirementName,
      name,
      opts.now
    ),
  };
}
