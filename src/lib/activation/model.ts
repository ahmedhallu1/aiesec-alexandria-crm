/**
 * THE ACTIVATE 26' BID PLAN (v36.7) — the data model, pure and client-safe.
 *
 * The LC is bidding to host Activate 26', AIESEC in Egypt's national
 * conference. The plan lived in two Google Sheets (six tabs); this page merges
 * them into one show, editable like a sheet by every Sodio member and readable
 * by anyone with the public link.
 *
 * A SECTION is one act of the page (the hero, the timeline, a table). Its ROWS
 * are sheet rows; a row's cells live in `data`, keyed by column key. Nothing in
 * here touches the database — the server (src/server/activation*.ts) and the
 * board (src/components/activation) both build on it, and tests pin it.
 */

export const ACTIVATION_PUBLIC_PATH = "/activate26";
export const ACTIVATION_APP_PATH = "/activation";

export const COLUMN_TYPES = ["text", "longtext", "number", "date", "select", "checkbox"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface Column {
  key: string;
  label: string;
  type: ColumnType;
  /** select: the allowed values */
  options?: string[];
  /** select: what to SHOW for a value (e.g. lane key → lane name) */
  labels?: Record<string, string>;
  hidden?: boolean;
}

export interface Lane {
  key: string;
  label: string;
  color: string;
}

export type SectionKind = "hero" | "timeline" | "table";
export const TABLE_VIEWS = ["checkpoints", "roles", "people", "runbook", "checklist", "plain"] as const;
export type TableView = (typeof TABLE_VIEWS)[number];

export interface HeroContent {
  eyebrow: string;
  title: string;
  tagline: string;
  intro: string;
  /** the day the bid result is announced — day one of the road */
  bidDay: string;
  /** Day 0 of the conference */
  day0: string;
  /** Day 0 … Day N-1 */
  showDays: number;
  venue: string;
}

export interface SectionConfig {
  act?: string;
  emoji?: string;
  view?: TableView;
  columns?: Column[];
  lanes?: Lane[];
  start?: string;
  end?: string;
  hero?: HeroContent;
  capacity?: number;
  dayNotes?: Record<string, string>;
  /** people view: show individual names on the PUBLIC page (off by default) */
  namesPublic?: boolean;
}

export interface ActivationSection {
  id: string;
  position: number;
  kind: SectionKind;
  title: string;
  subtitle: string;
  config: SectionConfig;
  hidden_public: boolean;
  updated_at: string;
  updated_by_name: string | null;
}

export type CellValue = string | number | boolean | null;

export interface ActivationRow {
  id: string;
  section_id: string;
  position: number;
  data: Record<string, CellValue>;
  updated_at: string;
  updated_by_name?: string | null;
  deleted_at?: string | null;
}

export interface ActivationPlan {
  sections: ActivationSection[];
  rows: ActivationRow[];
  /** server time of this snapshot — the "changed since" cursor for polling */
  syncedAt: string;
  publicView: boolean;
}

export interface ActivationDelta {
  sections: ActivationSection[];
  rows: ActivationRow[];
  syncedAt: string;
}

// ------------------------------------------------------------------ limits
export const LIMITS = {
  text: 500,
  longtext: 5000,
  select: 120,
  title: 160,
  subtitle: 400,
  columns: 30,
  lanes: 12,
  rowsPerSection: 2000,
  pasteCells: 1500,
} as const;

// ------------------------------------------------------------------ timeline
export const TIMELINE_KINDS = ["task", "milestone", "show"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];
export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  task: "Task",
  milestone: "Whole-OC milestone",
  show: "Show day",
};

/** The timeline's columns are fixed (the Gantt reads them); only the lanes are
 *  the LC's to name. `original` is the sheet's date before the v36.7 fit. */
export function timelineColumns(lanes: Lane[]): Column[] {
  return [
    { key: "title", label: "What", type: "text" },
    {
      key: "lane",
      label: "Team",
      type: "select",
      options: lanes.map((l) => l.key),
      labels: Object.fromEntries(lanes.map((l) => [l.key, l.label])),
    },
    { key: "start", label: "Starts", type: "date" },
    { key: "end", label: "Ends", type: "date" },
    {
      key: "kind",
      label: "Kind",
      type: "select",
      options: [...TIMELINE_KINDS],
      labels: TIMELINE_KIND_LABEL,
    },
    { key: "notes", label: "Notes", type: "longtext" },
    { key: "done", label: "Done", type: "checkbox" },
  ];
}

export function sectionColumns(section: ActivationSection): Column[] {
  if (section.kind === "timeline") return timelineColumns(section.config.lanes ?? []);
  return section.config.columns ?? [];
}

// ------------------------------------------------------------------ dates
const DAY_MS = 86_400_000;

/** A calendar date (YYYY-MM-DD) as a whole-day number, timezone-free. */
export function isoToDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS);
}

export function dayToIso(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

export const addDays = (iso: string, n: number): string => dayToIso(isoToDay(iso) + n);
export const daysBetween = (a: string, b: string): number => isoToDay(b) - isoToDay(a);

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (y < 2020 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtDay(iso: string): string {
  if (!isIsoDate(iso)) return "—";
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
export function monthOf(iso: string): string {
  return MONTHS[Number(iso.split("-")[1]) - 1] ?? "";
}
export function weekdayOf(iso: string): string {
  return WEEKDAYS[new Date(isoToDay(iso) * DAY_MS).getUTCDay()];
}
export function fmtSpan(start: string, end: string): string {
  if (!isIsoDate(start)) return "—";
  if (!isIsoDate(end) || end === start) return `${weekdayOf(start)} ${fmtDay(start)}`;
  return `${fmtDay(start)} → ${fmtDay(end)}`;
}

/** Today in Cairo, as YYYY-MM-DD. */
export function cairoTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A span kept inside [min, max] and never backwards. */
export function clampSpan(start: string, end: string, min: string, max: string): [string, string] {
  let s = isoToDay(start);
  let e = Math.max(s, isoToDay(end));
  const lo = isoToDay(min);
  const hi = isoToDay(max);
  const len = e - s;
  if (s < lo) { s = lo; e = s + len; }
  if (e > hi) { e = hi; s = Math.max(lo, e - len); }
  return [dayToIso(s), dayToIso(Math.max(s, e))];
}

// ------------------------------------------------------------------ packing
export interface Span {
  id: string;
  start: string;
  end: string;
}

/** Greedy interval packing: items that overlap in time go on different
 *  tracks, so no bar is ever drawn on top of another. */
export function packTracks<T extends Span>(items: T[]): { item: T; track: number }[] {
  const sorted = [...items].sort(
    (a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.id.localeCompare(b.id)
  );
  const trackEnds: number[] = [];
  return sorted.map((item) => {
    const s = isoToDay(item.start);
    const e = Math.max(s, isoToDay(item.end));
    let track = trackEnds.findIndex((end) => end < s);
    if (track === -1) {
      track = trackEnds.length;
      trackEnds.push(e);
    } else trackEnds[track] = e;
    return { item, track };
  });
}

// ------------------------------------------------------------------ ordering
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 1024;
  if (before == null) return (after as number) - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}

export function sortRows<T extends { position: number; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function rowsOf(plan: Pick<ActivationPlan, "rows">, sectionId: string): ActivationRow[] {
  return sortRows(plan.rows.filter((r) => r.section_id === sectionId && !r.deleted_at));
}

// ------------------------------------------------------------------ columns
export function columnKey(label: string, existing: string[]): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "column";
  let key = base;
  let n = 2;
  while (existing.includes(key)) key = `${base}_${n++}`;
  return key;
}

/** Check one cell against its column. Invalid input is refused with a reason,
 *  never silently coerced into something the member didn't type. */
export function sanitizeCell(
  col: Column | undefined,
  value: unknown
): { ok: true; value: CellValue } | { ok: false; error: string } {
  if (!col) return { ok: false, error: "That column doesn't exist any more." };
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: col.type === "checkbox" ? false : col.type === "number" ? null : "" };
  }
  switch (col.type) {
    case "checkbox": {
      if (typeof value === "boolean") return { ok: true, value };
      const s = String(value).trim().toLowerCase();
      if (["true", "yes", "y", "1", "✓", "x", "done"].includes(s)) return { ok: true, value: true };
      if (["false", "no", "n", "0", ""].includes(s)) return { ok: true, value: false };
      return { ok: false, error: `"${String(value)}" isn't a yes/no.` };
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `"${String(value)}" isn't a number.` };
    }
    case "date": {
      const s = String(value).trim();
      return isIsoDate(s) ? { ok: true, value: s } : { ok: false, error: `"${s}" isn't a date (YYYY-MM-DD).` };
    }
    case "select": {
      const s = String(value).trim();
      if (s.length > LIMITS.select) return { ok: false, error: "That value is too long." };
      if (col.options?.length && !col.options.includes(s)) {
        // match by label too (a pasted "Marketing" for lane key "marketing")
        const byLabel = Object.entries(col.labels ?? {}).find(
          ([, label]) => label.toLowerCase() === s.toLowerCase()
        );
        const byCase = col.options.find((o) => o.toLowerCase() === s.toLowerCase());
        if (byLabel) return { ok: true, value: byLabel[0] };
        if (byCase) return { ok: true, value: byCase };
        return { ok: false, error: `"${s}" isn't one of: ${col.options.map((o) => col.labels?.[o] ?? o).join(", ")}.` };
      }
      return { ok: true, value: s };
    }
    case "longtext": {
      const s = String(value);
      return s.length > LIMITS.longtext ? { ok: false, error: "That text is too long." } : { ok: true, value: s };
    }
    default: {
      const s = String(value);
      return s.length > LIMITS.text ? { ok: false, error: "That text is too long." } : { ok: true, value: s };
    }
  }
}

/** Text a cell shows / copies. */
export function cellText(col: Column, value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (col.type === "checkbox") return value ? "✓" : "";
  if (col.type === "select") return col.labels?.[String(value)] ?? String(value);
  return String(value);
}

// ------------------------------------------------------------------ paste
/** Tab-separated text as copied from Google Sheets / Excel — quoted cells may
 *  hold tabs, newlines and doubled quotes. Trailing empty line dropped. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { quoted = true; i++; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** Cells as Sheets expects them when copied out of the page. */
export function toTsv(matrix: string[][]): string {
  return matrix
    .map((r) => r.map((c) => (/[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join("\t"))
    .join("\n");
}

// ------------------------------------------------------------------ public view
/** What a visitor WITHOUT a Sodio account may see: no hidden sections, no
 *  editor names, no pre-fit dates — and, unless the LC turned it on, no
 *  individual names on the casting list (its numbers still show). */
export function publicPlan(plan: ActivationPlan): ActivationPlan {
  const sections = plan.sections
    .filter((s) => !s.hidden_public)
    .map((s) => ({ ...s, updated_by_name: null }));
  const visible = new Map(sections.map((s) => [s.id, s]));
  const rows = plan.rows
    .filter((r) => visible.has(r.section_id) && !r.deleted_at)
    .map((r) => {
      const s = visible.get(r.section_id)!;
      const data = { ...r.data };
      delete data.original;
      if (s.config.view === "people" && !s.config.namesPublic) {
        delete data.name;
        delete data.experience;
      }
      return { ...r, data, updated_by_name: null };
    });
  return { ...plan, sections, rows, publicView: true };
}

/** Fold a "changed since" poll into the board — except rows the member is
 *  saving right now, which would otherwise flicker back to the old value. */
export function mergeDelta(
  plan: ActivationPlan,
  delta: ActivationDelta,
  protect: ReadonlySet<string> = new Set()
): ActivationPlan {
  const sections = new Map(plan.sections.map((s) => [s.id, s]));
  for (const s of delta.sections) if (!protect.has(s.id)) sections.set(s.id, s);
  const rows = new Map(plan.rows.map((r) => [r.id, r]));
  for (const r of delta.rows) {
    if (protect.has(r.id)) continue;
    if (r.deleted_at) rows.delete(r.id);
    else rows.set(r.id, r);
  }
  return {
    ...plan,
    sections: [...sections.values()].sort((a, b) => a.position - b.position),
    rows: [...rows.values()],
    syncedAt: delta.syncedAt,
  };
}
