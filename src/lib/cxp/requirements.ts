// =============================================================================
// CXP — THE REQUIREMENT CATALOGUE
//
// Migrated VERBATIM from the standalone auditing system's lib/requirements.ts.
// Every key, name, alias, sheet column and deadline rule is byte-identical on
// purpose: the keys are persisted in the requirement-status table and in Drive
// file names, and the aliases are what match manually-uploaded files. Renaming
// anything here orphans real documents.
//
// All documents are mandatory. Requirements are grouped by function -> stage.
// OGV/OGT and IGV/IGT share most documents but differ at Finish, so the config
// stays explicit per function rather than clever.
//
// Source of truth for the RULES: docs/ECB_LOGIC_SUMMARY.md in the auditing repo
// (a summary of ECB Egypt's "Mithra Auditing System" guide).
// =============================================================================

import {
  STAGE_BY_KEY,
  STAGE_DRIVE_FOLDER,
  type CxpFunction,
  type CxpRequirementDef,
  type CxpStageKey,
} from "./types";

export interface CxpRequirementGroup {
  stageKey: CxpStageKey;
  driveFolder: string;
  requirements: CxpRequirementDef[];
}

// --- Reusable requirement fragments -----------------------------------------

const passportId: CxpRequirementDef = {
  key: "passport_id",
  name: "Passport / National ID",
  criteria: "Valid passport or national ID document.",
  aliases: ["passport", "national id", "id", "passport/id", "nationalid"],
  sheetColumn: "Passport/ID",
};

const studentProof: CxpRequirementDef = {
  key: "student_proof",
  name: "Student ID / Graduate Certificate",
  criteria: "Proof of student status or graduation certificate.",
  aliases: [
    "student id",
    "graduate",
    "graduation",
    "student/graduate id proof",
    "student proof",
  ],
  sheetColumn: "Student/Graduate ID proof",
};

const realizationDocs = (): CxpRequirementDef[] => [
  {
    key: "passport",
    name: "Passport",
    criteria: "Passport used for travel.",
    aliases: ["passport"],
    sheetColumn: "Passport",
  },
  {
    key: "entry_stamp",
    name: "Entry Stamp Picture (with VISA or first passport page)",
    criteria: "Collect within 3 days of arrival.",
    aliases: ["entry stamp", "visa", "entry", "stamp", "arrival stamp"],
    sheetColumn: "Entry Stamp",
    deadlineRule: {
      type: "within_after_arrival_days",
      offsetDays: 3,
      note: "Within 3 days of arrival",
    },
  },
  {
    key: "flight_tickets",
    name: "Flight Tickets",
    criteria: "Collect at least 20 days before expected travel/realization date.",
    aliases: ["flight", "tickets", "flight tickets", "ticket"],
    sheetColumn: "Flight Tickets",
    deadlineRule: { type: "before_travel", offsetDays: 20, note: "Min 20 days before travel" },
  },
  {
    key: "health_insurance",
    name: "Health Insurance",
    criteria: "Collect at least 20 days before expected travel/realization date.",
    aliases: ["health", "insurance", "health insurance", "medical"],
    sheetColumn: "Health Insurance",
    deadlineRule: { type: "before_travel", offsetDays: 20, note: "Min 20 days before travel" },
  },
  {
    key: "comm_before_arrival",
    name: "Communication 15-10 days before travel",
    criteria: "Valid window: 15 to 10 days before arrival/travel.",
    aliases: [
      "10 days",
      "15 days",
      "before arrival",
      "communication (10 days before arrival)",
      "before travel",
    ],
    sheetColumn: "Communication (10 days before arrival)",
    deadlineRule: { type: "window_before_arrival", windowMinDays: 10, windowMaxDays: 15 },
  },
  {
    key: "comm_after_arrival",
    name: "Communication within 24 hours after arrival",
    criteria: "Within 24 hours after arrival.",
    aliases: [
      "24h",
      "24 hours",
      "after arrival",
      "communication (within 24h after arrival)",
    ],
    sheetColumn: "Communication (within 24h after arrival)",
    deadlineRule: { type: "after_arrival_hours", offsetHours: 24 },
  },
];

const completeSurvey: CxpRequirementDef = {
  key: "complete_survey",
  name: "Complete Survey",
  criteria: "Completed end-of-experience survey (per product rules).",
  aliases: ["survey", "complete survey", "feedback"],
  sheetColumn: "Complete Survey",
};

const returnStamp: CxpRequirementDef = {
  key: "return_stamp",
  name: "Return / Exit Stamp",
  criteria: "Exit/return stamp at end of experience (per product rules).",
  aliases: ["return stamp", "exit stamp", "exit", "return"],
  sheetColumn: "Exit Stamp",
};

const dwa: CxpRequirementDef = {
  key: "dwa",
  name: "Debrief With AIESEC (DwA)",
  criteria: "Debrief with AIESEC after experience (per product rules).",
  aliases: ["dwa", "debrief", "debrief with aiesec"],
  sheetColumn: "DwA",
};

const midComm: CxpRequirementDef = {
  key: "mid_comm",
  name: "Middle Duration Communication",
  criteria: "GV: start date + half of duration. ",
  aliases: ["middle", "mid", "middle duration communication", "mid comm"],
  sheetColumn: "Middle Duration Communication",
  deadlineRule: { type: "mid_duration" },
};

const lastWeekComm: CxpRequirementDef = {
  key: "last_week_comm",
  name: "End Duration / Last Week Communication",
  criteria: "End date - 7 days (last week of experience).",
  aliases: ["last week", "end duration", "last week communication", "end communication"],
  sheetColumn: "Last week Communication",
  deadlineRule: { type: "last_week", offsetDays: 7 },
};

const monthlyComm: CxpRequirementDef = {
  key: "monthly_comm",
  name: "Monthly Communication",
  criteria: "During the first 5 days of each month.",
  aliases: ["monthly", "monthly communication", "communication proof", "comm proof"],
  sheetColumn: "Communication  Proof",
  deadlineRule: { type: "monthly_first_days", offsetDays: 5 },
};

// =============================================================================
// OGX (OGV / OGT)
// =============================================================================

const OGX_APPROVAL: CxpRequirementDef[] = [
  passportId,
  studentProof,
  {
    key: "contract_an",
    name: "Contract + Acceptance Note + Meeting mail for signature",
    criteria: "Signed contract, acceptance note and the meeting mail for signature.",
    aliases: ["contract", "acceptance note", "an", "contract + an", "meeting mail"],
    sheetColumn: "Contract + AN",
  },
  {
    key: "expectations_mail",
    name: "Opportunity Expectations Mail",
    criteria: "Expectations mail/thread for the opportunity.",
    aliases: [
      "expectations",
      "expectation mail",
      "expectations mail",
      "opportunity expectations",
    ],
    sheetColumn: "Expectations Mail",
  },
];

const OGX_POST_APPROVAL: CxpRequirementDef[] = [
  {
    key: "pgs",
    name: "Personal Goal Settings (PGS)",
    criteria: "Due within 2 weeks of approval.",
    aliases: ["pgs", "personal goal", "goal settings"],
    sheetColumn: "PGS",
    deadlineRule: {
      type: "fixed_after_approval",
      offsetDays: 14,
      note: "Within 2 weeks post approval",
    },
  },
  {
    key: "lda",
    name: "Leadership Development Assessment (LDA)",
    criteria: "Due within 2 weeks of approval.",
    aliases: ["lda", "leadership", "leadership development"],
    sheetColumn: "LDA",
    deadlineRule: {
      type: "fixed_after_approval",
      offsetDays: 14,
      note: "Within 2 weeks post approval",
    },
  },
];

const OGX_REALIZATION: CxpRequirementDef[] = [
  ...realizationDocs(),
  {
    key: "ops_invitation",
    name: "Outgoing Preparation Seminar (OPS) Invitation",
    criteria: "No later than 7 days before travel date.",
    aliases: ["ops", "ops invitation", "preparation seminar", "outgoing preparation"],
    sheetColumn: "OPS Inviation",
    deadlineRule: {
      type: "before_travel",
      offsetDays: 7,
      note: "No later than 7 days before travel",
    },
  },
];

const OGV_FINISH: CxpRequirementDef[] = [
  midComm,
  lastWeekComm,
  completeSurvey,
  returnStamp,
  dwa,
];

// OGTa/e finish (shorter set per spec)
const OGT_FINISH: CxpRequirementDef[] = [returnStamp, completeSurvey, dwa];

const OGT_MONTHLY: CxpRequirementDef[] = [monthlyComm];

// =============================================================================
// ICX (IGV / IGT)
// =============================================================================

const ICX_APPROVAL: CxpRequirementDef[] = [
  passportId,
  {
    key: "expectations_mail",
    name: "Opportunity Expectations Mail / Mail Thread",
    criteria: "Expectations mail/thread for the opportunity.",
    aliases: ["expectations", "mail thread", "expectations mail", "thread"],
    sheetColumn: "MAIL THREAD",
  },
  {
    key: "op_mail",
    name: "Opportunity Provider Mail / OP Mail",
    criteria: "Mail from / with the opportunity provider.",
    aliases: ["op mail", "opportunity provider", "provider mail", "op"],
    sheetColumn: "OP Mail",
  },
];

const ICX_POST_APPROVAL: CxpRequirementDef[] = [
  {
    key: "lda",
    name: "Leadership Development Assessment (LDA)",
    criteria: "Due within 2 weeks of approval.",
    aliases: ["lda", "leadership", "leadership development"],
    sheetColumn: "LDA",
    deadlineRule: {
      type: "fixed_after_approval",
      offsetDays: 14,
      note: "Within 2 weeks post approval",
    },
  },
];

const ICX_REALIZATION: CxpRequirementDef[] = [
  ...realizationDocs(),
  {
    key: "ips_invitation",
    name: "Incoming Preparation Seminar (IPS) Invitation",
    criteria: "No later than 36 hours after arrival and before first day of work.",
    aliases: ["ips", "ips invitation", "incoming preparation", "preparation seminar"],
    sheetColumn: "IPS Inviation",
    deadlineRule: {
      type: "after_arrival_hours",
      offsetHours: 36,
      note: "Within 36h after arrival",
    },
  },
  {
    key: "accommodation",
    name: "Accommodation Allocation",
    criteria: "Confirmed accommodation allocation.",
    aliases: ["accommodation", "allocation", "housing", "accomodation"],
    sheetColumn: "Accommodation  Allocation",
  },
  {
    key: "fdw_alignment",
    name: "First Day of Work Alignment Space",
    criteria: "Alignment space for the first day of work.",
    aliases: ["first day", "fdw", "alignment", "aligment space", "first day of work"],
    sheetColumn: "Aligment  Space",
  },
];

const IGV_FINISH: CxpRequirementDef[] = [
  midComm,
  lastWeekComm,
  {
    key: "jd_form",
    name: "JD Form / Middle & End Alignment Spaces",
    criteria: "JD form plus middle and end alignment spaces.",
    aliases: ["jd", "jd form", "alignment", "middle & end", "job description"],
    sheetColumn: "JD Form (Middle & End)",
    deadlineRule: {
      type: "mid_duration",
      note: "Middle & end alignment spaces (mid-duration onward)",
    },
  },
  returnStamp,
  completeSurvey,
];

const IGT_FINISH: CxpRequirementDef[] = [
  returnStamp,
  completeSurvey,
  {
    key: "end_alignment",
    name: "End Duration Alignment Space",
    criteria: "End-of-duration alignment space.",
    aliases: ["end alignment", "end duration", "alignment space", "end as"],
    sheetColumn: "JD Form (Middle & End)",
    deadlineRule: {
      type: "last_week",
      offsetDays: 7,
      note: "End-duration alignment space (last week)",
    },
  },
];

const IGT_MONTHLY: CxpRequirementDef[] = [
  monthlyComm,
  {
    key: "salary_benefits",
    name: "Salary & Benefits Proof",
    criteria: "Proof of salary and benefits for the month.",
    aliases: ["salary", "benefits", "salary & benefits proof", "pay"],
    sheetColumn: "Salary &  Benefits Proof",
  },
];

// =============================================================================
// Master config: CxpFunction -> CxpRequirementGroup[]
// =============================================================================

function group(stageKey: CxpStageKey, reqs: CxpRequirementDef[]): CxpRequirementGroup {
  return { stageKey, driveFolder: STAGE_DRIVE_FOLDER[stageKey], requirements: reqs };
}

export const CXP_REQUIREMENTS: Record<CxpFunction, CxpRequirementGroup[]> = {
  OGV: [
    group("approval", OGX_APPROVAL),
    group("post_approval", OGX_POST_APPROVAL),
    group("realization", OGX_REALIZATION),
    group("finish", OGV_FINISH),
  ],
  OGT: [
    group("approval", OGX_APPROVAL),
    group("post_approval", OGX_POST_APPROVAL),
    group("realization", OGX_REALIZATION),
    group("monthly", OGT_MONTHLY),
    group("finish", OGT_FINISH),
  ],
  IGV: [
    group("approval", ICX_APPROVAL),
    group("post_approval", ICX_POST_APPROVAL),
    group("realization", ICX_REALIZATION),
    group("finish", IGV_FINISH),
  ],
  IGT: [
    group("approval", ICX_APPROVAL),
    group("post_approval", ICX_POST_APPROVAL),
    group("realization", ICX_REALIZATION),
    group("monthly", IGT_MONTHLY),
    group("finish", IGT_FINISH),
  ],
};

/** All requirement groups for a function. */
export function requirementsFor(fn: CxpFunction): CxpRequirementGroup[] {
  return CXP_REQUIREMENTS[fn] || [];
}

/** Requirements for one function + stage. */
export function requirementsForStage(
  fn: CxpFunction,
  stageKey: CxpStageKey
): CxpRequirementDef[] {
  const g = requirementsFor(fn).find((x) => x.stageKey === stageKey);
  return g?.requirements || [];
}

/** Flat list of every requirement for a function, across stages. */
export function allRequirements(
  fn: CxpFunction
): { stageKey: CxpStageKey; req: CxpRequirementDef }[] {
  return requirementsFor(fn).flatMap((g) =>
    g.requirements.map((req) => ({ stageKey: g.stageKey, req }))
  );
}

/** Look one up by (function, stage, key) — the shape the status table stores. */
export function findRequirement(
  fn: CxpFunction,
  stageKey: CxpStageKey,
  key: string
): CxpRequirementDef | null {
  return requirementsForStage(fn, stageKey).find((r) => r.key === key) ?? null;
}

export function stageLabel(stageKey: CxpStageKey): string {
  return STAGE_BY_KEY[stageKey];
}
