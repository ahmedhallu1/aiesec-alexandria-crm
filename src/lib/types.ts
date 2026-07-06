export type LcFunction = "IGV" | "IGT" | "OGV" | "OGT";
export type SubFunction = "Raising" | "Consideration" | "ICX" | "OGX";
export type MemberRole = "LCP" | "VP" | "TL" | "Coordinator" | "Member";
export type IgtProduct = "GTa" | "GTe";
export type ContactMethod = "Call" | "WhatsApp" | "Email";
export type ContactStatus =
  | "No Response"
  | "Responded"
  | "Interested"
  | "Not Interested"
  | "Wrong Contact";
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

export interface Member {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  phone: string | null;
  function: LcFunction | null;
  sub_function: SubFunction | null;
  role: MemberRole;
  stakeholder_email: string | null;
  stakeholder_id: string | null;
  team_name: string | null;
  is_active: boolean;
  google_refresh_token: string | null;
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
  tl_comment: string | null;
  vp_comment: string | null;
  final_comment: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountPipeline extends Account {
  responsible_name: string;
  responsible_nickname: string | null;
  responsible_email: string;
  responsible_stakeholder_id: string | null;
  responsible_function: LcFunction | null;
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
