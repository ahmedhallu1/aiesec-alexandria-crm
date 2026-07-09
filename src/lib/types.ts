export type LcFunction = "IGV" | "IGT" | "OGV" | "OGT" | "CXP" | "B2C" | "F&L";
export type MemberRole =
  | "LCP"
  | "LCVP"
  | "Team Leader"
  | "Coordinator"
  | "Member"
  | "Director";
export type IgtProduct = "GTa" | "GTe";
export type ContactMethod = "Call" | "WhatsApp" | "Email";
export type ContactStatus =
  | "No Response"
  | "Responded"
  | "Interested"
  | "Not Interested"
  | "Wrong Contact"
  | "Call Scheduled";
export type RequestState = "Checking" | "Approved" | "Rejected";
export type Stage =
  | "Lead"
  | "Contacted"
  | "Visit Scheduled"
  | "Visit Done"
  | "Deal Done"
  | "Out of Process";

export const STAGES: Stage[] = [
  "Lead",
  "Contacted",
  "Visit Scheduled",
  "Visit Done",
  "Deal Done",
  "Out of Process",
];

// The final Membership sheet lists (mirror the sheet's dropdown validations)
export const MEMBER_ROLES: MemberRole[] = [
  "LCP", "LCVP", "Team Leader", "Coordinator", "Member", "Director",
];
export const LC_FUNCTIONS: LcFunction[] = [
  "IGT", "IGV", "OGV", "OGT", "CXP", "B2C", "F&L",
];
export const SUB_FUNCTIONS = [
  "Raising", "Consideration", "ICX", "OGX", "CXP", "B2C", "Finance", "BD", "B2B",
] as const;
export type SubFunction = (typeof SUB_FUNCTIONS)[number];

/** The functions whose CRM modules exist today. */
export const ICX_FUNCTIONS = ["IGV", "IGT"] as const;

export const IGV_PROJECTS = [
  "Skill Up!",
  "Scale Up",
  "Rooted",
  "Heartbeat",
  "Fingerprint",
  "Global Classroom",
  "Greenleaders",
  "Youth 4 Impact",
] as const;

// Curated pick-lists (from the LC raising sheets) — "Other" allows free text.
export const ACCOUNT_TYPES = [
  "Startup",
  "Company",
  "Course Center",
  "Institute",
  "School",
  "Nursery",
  "Hospital/Clinic",
  "Marketing Agency",
  "NGO",
  "Factory",
  "Other",
] as const;

export const INDUSTRIES = [
  "Education",
  "Architecture",
  "Engineering",
  "Marketing",
  "IT / Software",
  "Real Estate",
  "Medical / Veterinary",
  "Law",
  "Finance",
  "Farming / Agriculture",
  "Tourism / Hospitality",
  "Arts / Music",
  "Other",
] as const;

export const IGT_SUB_PRODUCTS = [
  "Engineering",
  "Marketing",
  "IT",
  "Finance",
  "Business Administration",
  "Education",
  "Other",
] as const;

export type CommentLabel = "Member" | "TL" | "VP" | "LCP";

export interface Member {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  phone: string | null;
  functions: string[];
  sub_functions: string[];
  role: MemberRole;
  stakeholder_name: string | null;
  stakeholder_id: string | null;
  team_name: string | null;
  is_active: boolean;
  google_refresh_token: string | null;
  password_hash: string | null;
  profile_completed_at: string | null;
  first_login_at: string | null;
  photo_url: string | null;
}

export interface Account {
  id: string;
  function: "IGV" | "IGT";
  name: string;
  normalized_name: string;
  product: IgtProduct | null;
  sub_product: string | null;
  project: string | null;
  account_type: string | null;
  industry: string | null;
  package_plan: string | null;
  proposal_sent: boolean;
  phone: string | null;
  email: string | null;
  social_link: string | null;
  website: string | null;
  podio_link: string | null;
  requested_podio: boolean;
  request_state: RequestState | null;
  responsible_id: string;
  next_step: string | null;
  next_step_date: string | null;
  next_step_time: string | null;
  slot_raised: boolean;
  slot_raised_at: string | null;
  slots_count: number;
  out_of_process: boolean;
  oop_reason: string | null;
  oop_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountPipeline extends Account {
  responsible_name: string;
  responsible_nickname: string | null;
  responsible_email: string;
  responsible_stakeholder_id: string | null;
  responsible_functions: string[];
  attempts: number;
  no_response_attempts: number;
  last_contact_at: string | null;
  visit_id: string | null;
  visit_date: string | null;
  visit_time: string | null;
  visit_done: boolean | null;
  visit_comment: string | null;
  stage: Stage;
  contact_limit_reached: boolean;
  next_step_missing: boolean;
}

export interface ContactAttempt {
  id: string;
  account_id: string;
  member_id: string;
  method: ContactMethod;
  status: ContactStatus;
  comment: string | null;
  created_at: string;
}

export interface Visit {
  id: string;
  account_id: string;
  member_id: string;
  visit_date: string;
  visit_time: string;
  calendar_event_id: string | null;
  done: boolean | null;
  visit_comment: string | null;
  next_step: string | null;
  followup_prompt_sent_at: string | null;
  report_sent_at: string | null;
}

export interface AccountComment {
  id: string;
  account_id: string;
  member_id: string | null;
  author_label: CommentLabel;
  body: string;
  created_at: string;
}

export interface BlacklistEntry {
  id: string;
  account_name: string;
  normalized_name: string;
  project: string | null;
  comments: string | null;
  podio_link: string | null;
  link: string | null;
  added_by: string | null;
  created_at: string;
}

/** Normalization mirror of the SQL generated column (lower, trim, collapse spaces). */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ------------------------------------------------------------------ validation

/** Phone: digits only (optional leading +), 8–15 digits. */
export const PHONE_RE = /^\+?\d{8,15}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const URL_RE = /^https?:\/\/\S+\.\S+/i;

export function cleanPhone(raw: string): string {
  return raw.replace(/[\s\-().]/g, "");
}

// ------------------------------------------------------------------ function colors
// Official AIESEC product colors (logos.aiesec.org): GV #F85A40 · GTa teal #0CB9C1
export const FUNCTION_COLORS: Record<string, { bg: string; text: string }> = {
  IGV: { bg: "bg-gv/15", text: "text-gv" },
  OGV: { bg: "bg-gv/15", text: "text-gv" },
  IGT: { bg: "bg-gt/15", text: "text-gt" },
  OGT: { bg: "bg-gt/15", text: "text-gt" },
};

/** The IM director — receives "fix my info" requests from members. */
export const ADMIN_EMAIL = "ahmedhallul@aiesec.net";

/** Feedback goes ONLY to the IM director (admin) and the IM coach — every
 *  submission is emailed to them and only they can open the inbox. */
export const FEEDBACK_INBOX_EMAILS = [
  "ahmedhallul@aiesec.net",
  "omareldeeb123@aiesec.net",
] as const;
