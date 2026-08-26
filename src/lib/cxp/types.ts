// =============================================================================
// CXP — domain types (migrated from the standalone Internal Auditing System).
//
// The old app had no database: these types described rows parsed out of the ECB
// SubTool Google Sheet and held in memory. Here they describe Supabase tables,
// so the field names deliberately match the migration's columns.
//
// NOTHING in this file may drift from the ECB rules without a product decision:
// the requirement catalogue, the stages and the deadline rule types ARE the
// business logic the LC is audited against.
// =============================================================================

/** The four product lines. */
export type CxpFunction = "IGV" | "IGT" | "OGV" | "OGT";

export const CXP_FUNCTIONS: CxpFunction[] = ["IGV", "IGT", "OGV", "OGT"];

/** Which side of exchange a function belongs to. The CXP module is split in
 *  two along this line, and so is every access rule (see `rbac.ts`). */
export type CxpSide = "ICX" | "OGX";

export const CXP_SIDES: CxpSide[] = ["ICX", "OGX"];

/** ICX = incoming (we host), OGX = outgoing (we send). */
export const SIDE_FUNCTIONS: Record<CxpSide, CxpFunction[]> = {
  ICX: ["IGV", "IGT"],
  OGX: ["OGV", "OGT"],
};

export function sideOf(fn: CxpFunction): CxpSide {
  return fn === "IGV" || fn === "IGT" ? "ICX" : "OGX";
}

/** Normalised lifecycle stage. */
export type CxpStage =
  | "Approval"
  | "Post Approval / Pre-Realization"
  | "Realization"
  | "Finish"
  | "Monthly Communication";

/** Canonical short keys — used in keys, folders and configs. */
export type CxpStageKey =
  | "approval"
  | "post_approval"
  | "realization"
  | "finish"
  | "monthly";

export const CXP_STAGE_KEYS: CxpStageKey[] = [
  "approval",
  "post_approval",
  "realization",
  "finish",
  "monthly",
];

export const STAGE_BY_KEY: Record<CxpStageKey, CxpStage> = {
  approval: "Approval",
  post_approval: "Post Approval / Pre-Realization",
  realization: "Realization",
  finish: "Finish",
  monthly: "Monthly Communication",
};

/** The sub-folder each stage's documents live in, inside the EP's Drive folder.
 *  Kept identical to the old system so existing Drive folders keep resolving. */
export const STAGE_DRIVE_FOLDER: Record<CxpStageKey, string> = {
  approval: "Approval",
  post_approval: "Post Approval",
  realization: "Realization",
  finish: "Finish",
  monthly: "Monthly Communication",
};

// ----------------------------------------------------------------- deadlines

/** Deadline rule descriptor. Interpreted by `deadlines.ts`.
 *
 *  These eight rule types cover every timeline in the ECB guide. Adding a
 *  ninth means the guide changed — check `docs/ECB_LOGIC_SUMMARY.md` first. */
export interface CxpDeadlineRule {
  type:
    | "fixed_after_approval" // approvalDate + offsetDays
    | "before_travel" // arrivalDate - offsetDays
    | "after_arrival_hours" // arrivalDate + offsetHours
    | "within_after_arrival_days" // arrivalDate + offsetDays
    | "mid_duration" // startDate + round(duration/2)
    | "last_week" // endDate - offsetDays
    | "monthly_first_days" // first N days of month
    | "window_before_arrival" // arrivalDate - [maxDays..minDays]
    | "none";
  offsetDays?: number;
  offsetHours?: number;
  windowMinDays?: number;
  windowMaxDays?: number;
  note?: string;
}

/** A required document definition (configuration-driven). */
export interface CxpRequirementDef {
  /** stable machine key, e.g. "passport_id" — persisted, never rename */
  key: string;
  name: string;
  criteria: string;
  deadlineRule?: CxpDeadlineRule;
  /** alternate names used to fuzzy-match manually uploaded Drive files */
  aliases: string[];
  /** the SubTool column header this maps to, when the sheet tracks a flag */
  sheetColumn?: string;
}

/** A computed deadline / action window for one EP + requirement. */
export interface CxpComputedDeadline {
  epOppId: string;
  function: CxpFunction;
  stageKey: CxpStageKey;
  requirementKey: string;
  requirementName: string;
  /** the hard due date (end of window) if known */
  dueDate: string | null;
  /** window start (the action can begin) if applicable */
  windowStart: string | null;
  windowEnd: string | null;
  /** when to remind: one day before the action / window start */
  reminderDate: string | null;
  note?: string;
  /** which input date drove the calculation — shown in the UI so a wrong
   *  deadline can be traced back to the sheet cell that caused it */
  basedOn?: string;
}

// -------------------------------------------------------------------- the EP

/** One EP occurrence in one stage — the core row (`cxp_ep_records`).
 *
 *  Keyed by `epOppId | function | stageKey`: the same EP appears once per
 *  stage, which is how the SubTool models it and how the LC reads it. */
export interface CxpEpRecord {
  id: string;
  ep_name: string;
  ep_opp_id: string;
  /** raw product string from the sheet, e.g. "GV", "GTa", "GTe" */
  product: string;
  function: CxpFunction;
  side: CxpSide;
  stage_key: CxpStageKey;
  /** raw "Current Status" from the sheet, e.g. approved / realized */
  status: string;
  approval_date: string | null;
  start_date: string | null;
  end_date: string | null;
  /** the flight date — anchors every travel/arrival deadline */
  arrival_date: string | null;
  departure_date: string | null;
  host_lc: string | null;
  home_lc: string | null;
  opportunity_name: string | null;
  /** the ECB's own comment on this row — what needs correcting */
  ecb_comment: string | null;
  submitted_flag: boolean | null;
  audited_flag: boolean | null;
  excused_flag: boolean | null;
  /** WHICH MONTH'S SUBMISSION THIS ROW BELONGS TO (yyyy-MM-01).
   *
   *  The SubTool splits current vs past month by TAB, not by column, so this
   *  is derived at sync time from the source tab name. It is what the EP list
   *  filters on: current month by default, last month's incomplete behind the
   *  toggle. */
  submission_month: string;
  /** true when this row came from an "…Past month" tab */
  is_past_month: boolean;
  /** per-requirement booleans as read from the sheet, keyed by requirement key */
  sheet_flags: Record<string, boolean>;
  source_sheet_name: string;
  source_section_name: string;
  source_row_number: number;
  /** 0..1 — the parser's confidence that this row was read correctly */
  confidence_score: number;
  parsing_warnings: string[];
  /** flagged by the de-dup / confidence layer for a human to look at */
  needs_review: boolean;
  synced_at: string;
}

/** Per-EP requirement status (`cxp_requirement_status`). */
export interface CxpRequirementStatus {
  id: string;
  ep_opp_id: string;
  function: CxpFunction;
  stage_key: CxpStageKey;
  requirement_key: string;
  uploaded: boolean;
  source: "Website Upload" | "Manual Drive Upload" | "Sheet Flag" | null;
  file_url: string | null;
  file_id: string | null;
  updated_at: string;
}

/** A weekly ECB deadline: the 6th / 13th / 20th / 27th. */
export interface CxpWeeklyDeadline {
  /** ISO date (yyyy-MM-dd) */
  date: string;
  dayOfMonth: 6 | 13 | 20 | 27;
}

/** One missing document at one weekly deadline (`cxp_weekly_missing`).
 *
 *  THIS TABLE IS THE PER-WEEK HISTORY. The old app wrote it on every reminder
 *  run and then never read it back, which is why its week selector had nothing
 *  to show. Here it is the source for past weeks. */
export interface CxpWeeklyMissing {
  id: string;
  function: CxpFunction;
  /** the weekly deadline this snapshot was taken for */
  deadline_date: string;
  ep_opp_id: string;
  ep_name: string;
  stage_key: CxpStageKey;
  requirement_key: string;
  requirement_name: string;
  uploaded: boolean;
  /** "current" = missing when the snapshot ran; "carry-over" = still missing
   *  from the previous deadline */
  origin: "current" | "carry-over";
  updated_at: string;
}

/** Aggregated per-EP view used by the tables. */
export interface CxpEpSummary {
  epOppId: string;
  epName: string;
  product: string;
  function: CxpFunction;
  side: CxpSide;
  stage: CxpStage;
  stageKey: CxpStageKey;
  status: string;
  startDate: string | null;
  endDate: string | null;
  uploadedCount: number;
  totalCount: number;
  missingCount: number;
  needsReview: boolean;
  /** the ECB's comment on this row, when there is one */
  comment: string | null;
  submissionMonth: string;
  isPastMonth: boolean;
}
