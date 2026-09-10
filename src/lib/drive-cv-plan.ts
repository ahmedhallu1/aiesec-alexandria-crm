/** THE PURE HALF OF THE DRIVE CV IMPORT (v36.4) — parsing a folder link,
 *  deciding what could be a CV, reading the AI's verdict, and the rules that
 *  stand in when the AI can't be reached. No Drive, no network: the tests pin
 *  it, and the client can import the types. */

export const CV_INDUSTRY_LIST = [
  "Marketing", "IT/Software", "Engineering", "Education", "Healthcare",
  "Law", "Finance", "Business", "Design", "Other",
] as const;

export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  /** folder names from the scanned root down to the file's own folder */
  path: string[];
}

export interface DriveCvPlanItem {
  fileId: string;
  name: string;
  /** "oGTa / IT / Nour Chehida.pdf" */
  path: string;
  mimeType: string;
  size: number | null;
  person: string | null;
  product: "GTa" | "GTe" | null;
  industry: string | null;
}

export interface DriveCvPlan {
  rootId: string;
  root: string;
  lcGuess: string | null;
  cvs: DriveCvPlanItem[];
  skipped: { fileId: string; name: string; path: string; reason: string }[];
  truncated: boolean;
  /** false when the rules stood in for the AI */
  aiUsed: boolean;
}

/** The folder id out of any link shape Drive hands out. */
export function driveFolderIdFrom(raw: string): string | null {
  const s = (raw ?? "").trim();
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Worth a look as a CV at all — documents and scans, never videos. */
export function mightBeCv(e: { mimeType: string }): boolean {
  const m = e.mimeType;
  return (
    m === "application/pdf" ||
    m.startsWith("image/") ||
    m === "application/vnd.google-apps.document" ||
    m === DOCX ||
    m === "application/msword"
  );
}

export function skipReasonForType(mime: string): string {
  if (mime.startsWith("video/")) return "a video";
  if (mime.startsWith("audio/")) return "an audio file";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "a spreadsheet";
  if (mime.includes("presentation")) return "slides";
  if (mime.includes("zip") || mime.includes("compressed")) return "an archive";
  return "not a document";
}

type Verdict = {
  isCv: boolean;
  person: string | null;
  product: "GTa" | "GTe" | null;
  industry: string | null;
  reason: string | null;
};

const snapIndustry = (raw: unknown): string | null => {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = raw.toLowerCase().replace(/[^a-z]/g, "");
  return CV_INDUSTRY_LIST.find((i) => i.toLowerCase().replace(/[^a-z]/g, "") === n) ?? null;
};

const snapProduct = (raw: unknown): "GTa" | "GTe" | null =>
  raw === "GTa" || raw === "GTe" ? raw : null;

const clean = (raw: unknown, max = 120): string | null =>
  typeof raw === "string" && raw.trim() ? raw.trim().slice(0, max) : null;

/** The AI's JSON → one verdict per document, in order. Anything it left out
 *  or garbled becomes "not a CV" — importing a stranger's transcript into the
 *  pool is the worse mistake. Null when the reply is unusable. */
export function parseClassification(
  raw: string,
  count: number
): { lcGuess: string | null; items: Verdict[] } | null {
  let parsed: { lc_guess?: unknown; items?: unknown };
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.items)) return null;
  const items: Verdict[] = Array.from({ length: count }, () => ({
    isCv: false, person: null, product: null, industry: null, reason: "the AI skipped it",
  }));
  for (const it of parsed.items as Record<string, unknown>[]) {
    const n = typeof it?.n === "number" ? it.n : Number(it?.n);
    if (!Number.isInteger(n) || n < 0 || n >= count) continue;
    items[n] = {
      isCv: it.is_cv === true,
      person: clean(it.person),
      product: snapProduct(it.product),
      industry: snapIndustry(it.industry),
      reason: clean(it.reason, 80),
    };
  }
  return { lcGuess: clean(parsed.lc_guess, 80), items };
}

const NOT_A_CV =
  /(video|tefl|tesol|ielts|toefl|delf|certificat|transcript|relev[ée]|notes? de|policy|polic[yi]|needs|opportunit|cover ?letter|motivation|untitled|passport|diploma|dipl[ôo]me|recommendation|form\b)/i;

const PRODUCT_OF = (segments: string[]): "GTa" | "GTe" | null => {
  const s = segments.join(" / ").toLowerCase();
  if (/\bo?gte\b|teacher|teaching/.test(s)) return "GTe";
  if (/\bo?gta\b|global talent/.test(s)) return "GTa";
  return null;
};

const SECTOR_WORDS: [RegExp, string][] = [
  [/\b(it|software|tech|computer|data|dev)/i, "IT/Software"],
  [/financ|account|bank|audit/i, "Finance"],
  [/marketing|sales|media/i, "Marketing"],
  [/engineer/i, "Engineering"],
  [/educat|teach/i, "Education"],
  [/health|medic|pharma|nurs/i, "Healthcare"],
  [/\blaw|legal/i, "Law"],
  [/design|architect/i, "Design"],
  [/business|management|hr\b|human/i, "Business"],
];

const tidyName = (raw: string): string | null => {
  const s = raw
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(cv|resume|résumé|updated|final|english|new|copy|\(\d+\))\b/gi, " ")
    .replace(/'s\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length < 3 || /\d{4,}/.test(s)) return null;
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
};

/** The stand-in when the AI can't be reached: a document is a CV unless its
 *  name says otherwise; a person's folder names the person; the path names
 *  the programme and the sector. Coarser than the AI, never a failure. */
export function classifyByRules(
  root: string,
  docs: DriveEntry[]
): { lcGuess: string | null; items: Verdict[] } {
  const programmeOrSector = (seg: string) =>
    PRODUCT_OF([seg]) !== null || SECTOR_WORDS.some(([re]) => re.test(seg)) || /^other$/i.test(seg);
  const items = docs.map((d): Verdict => {
    if (NOT_A_CV.test(d.name))
      return { isCv: false, person: null, product: null, industry: null, reason: "not a CV (by its name)" };
    const own = d.path[d.path.length - 1];
    const personFolder = own && !programmeOrSector(own) ? own : null;
    const sector = [...d.path].reverse().map((seg) => SECTOR_WORDS.find(([re]) => re.test(seg))?.[1]).find(Boolean) ?? null;
    return {
      isCv: true,
      person: tidyName(personFolder ?? d.name),
      product: PRODUCT_OF([root, ...d.path]),
      industry: sector,
      reason: null,
    };
  });
  const m = /@\s*(?:in\s+)?([\p{L} .'-]{3,40})$/iu.exec(root);
  return { lcGuess: m ? m[1].trim() : null, items };
}
