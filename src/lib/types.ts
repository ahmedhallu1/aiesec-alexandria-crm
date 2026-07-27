export type LcFunction =
  | "IGV" | "IGT" | "OGV" | "OGT" | "CXP" | "B2C" | "F&L" | "B2B" | "BD" | "TM";
/** What an ACCOUNT can be raised as. B2B raises for the whole ICX: B2B
 *  accounts live in their own product and split each deal's opens across
 *  IGV / IGTa / IGTe. B2C (v23) is its own module: partner accounts for
 *  courses/events/student activities — deals carry no details. */
export type AccountFunction = "IGV" | "IGT" | "B2B" | "BD" | "B2C";
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
  | "Visit Scheduled"
  /** legacy value — no longer offered in the UI */
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
  "IGT", "IGV", "OGV", "OGT", "CXP", "B2C", "F&L", "B2B", "BD", "TM",
];
export const SUB_FUNCTIONS = [
  "Raising", "Consideration", "ICX", "OGX", "CXP", "B2C", "Finance", "BD", "B2B",
] as const;
export type SubFunction = (typeof SUB_FUNCTIONS)[number];

/** The functions whose CRM modules exist today. */
export const ICX_FUNCTIONS = ["IGV", "IGT"] as const;

/** B2B & BD are ONE function (same membership today, may split in future
 *  peaks) — EITHER name in functions or sub-functions grants the whole-ICX
 *  raising access. Use this everywhere instead of inline "B2B" checks. */
export function memberIsB2B(m: {
  functions?: string[] | null;
  sub_functions?: string[] | null;
}): boolean {
  return ["B2B", "BD"].some(
    (f) => (m.functions ?? []).includes(f) || (m.sub_functions ?? []).includes(f)
  );
}

/** B2C crew (v23) — the B2C label in functions or sub-functions. */
export function memberIsB2C(m: {
  functions?: string[] | null;
  sub_functions?: string[] | null;
}): boolean {
  return (m.functions ?? []).includes("B2C") || (m.sub_functions ?? []).includes("B2C");
}

/** B2C account types (v23) — B2C accounts carry ONE of these instead of the
 *  account-type/industry pair (stored in the account_type column). */
export const B2C_TYPES = ["Courses", "Events", "Student activities"] as const;

/** The contract Google Form B2C fills BEFORE marking a deal signed. */
export const B2C_CONTRACT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSd4hhlgs53U2dHxQDaQXJv_sr3lxJd-FXzxrrQColD2uXVp4A/viewform";

/** Default Podio-update cadence for B2C accounts (days) — editable per
 *  account. 10 days per the B2C Director's process. */
export const B2C_DEFAULT_UPDATE_DAYS = 10;

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

// Industry = the business DOMAIN. Account type = WHAT the business is —
// the two lists never overlap. Multi-select, "Other" = free text.
export const INDUSTRIES = [
  "Software",
  "Marketing",
  "Engineering",
  "Architecture",
  "Education",
  "Healthcare",
  "Law",
  "Finance",
  "Real Estate",
  "Tourism",
  "Other",
] as const;

export const IGT_SUB_PRODUCTS = [
  "Software",
  "Marketing",
  "Engineering",
  "Architecture",
  "Nursery",
  "Course Center",
  "School",
  "Other",
] as const;

export type CommentLabel = "Member" | "TL" | "VP" | "Director" | "LCP" | "Admin";

/** Curated Out-of-Process reasons ("Other" opens a free-text field; imported
 *  sheets may carry any other value and it is kept as-is). */
export const OOP_REASONS = [
  "Not responding",
  "Financial issues",
  "Not Interested",
  "Backed out",
  "Other Plans",
  "Needs too technical background EPs",
  "Conflict of Values between AIESEC and organization",
  "Blacklisted",
] as const;

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
  temp_password_hash: string | null;
  profile_completed_at: string | null;
  first_login_at: string | null;
  photo_url: string | null;
  /** chosen fun avatar — wins over the Google photo when set */
  avatar_url: string | null;
}

/** A tagged phone number, email or link on an account ("CEO", "LinkedIn", …). */
export interface AccountContact {
  tag: string;
  kind: "phone" | "email" | "link";
  value: string;
}

/** Tag choices for phones ("Other" = free text). */
export const CONTACT_TAGS = [
  "Contact", "Whatsapp", "Manager", "HR", "CEO", "Owner", "Other",
] as const;

/** Tag choices for emails — no Whatsapp here. */
export const EMAIL_TAGS = [
  "Contact", "Manager", "HR", "CEO", "Owner", "Other",
] as const;

/** Tag choices for links ("Other" = free text). */
export const LINK_TAGS = [
  "Website", "LinkedIn", "Instagram", "Facebook", "Other",
] as const;

export interface Account {
  id: string;
  function: AccountFunction;
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
  /** running opens per product (deals carry the split; B2B mixes all three) */
  slots_igv_count: number;
  slots_igta_count: number;
  slots_igte_count: number;
  next_step_event_id: string | null;
  /** a B2B/BD leader asked the owner to submit this account on Podio — the
   *  account pins to the top of the owner's list until requested/stated */
  podio_submit_requested_at: string | null;
  /** B2C only (v23): the account must be refreshed on Podio every N days */
  podio_update_every_days: number | null;
  /** B2C only: when it was last marked "updated on Podio" */
  podio_updated_at: string | null;
  /** B2C only: the last time the due-date reminder fired (once per cycle) */
  podio_update_notified_at: string | null;
  out_of_process: boolean;
  oop_reason: string | null;
  oop_at: string | null;
  /** number of separate deals signed (one account can close many deals) */
  deals_count: number;
  contacts: AccountContact[];
  /** seeded test account (admin test mode) — hidden outside test mode (v21) */
  is_test: boolean;
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
  last_contact_status: ContactStatus | null;
  last_contact_method: ContactMethod | null;
  last_deal_at: string | null;
  last_deal_slots: number | null;
  last_deal_note: string | null;
  visit_id: string | null;
  visit_date: string | null;
  visit_time: string | null;
  visit_done: boolean | null;
  visit_comment: string | null;
  stage: Stage;
  contact_limit_reached: boolean;
  next_step_missing: boolean;
  /** latest pinned comment — surfaced as a 📌 on the accounts list */
  pinned_comment: string | null;
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

/** One signed deal — an account can close several over time (3 slots today,
 *  6 more next month = 2 deals · 9 slots). Opens are split per product:
 *  IGV accounts → all IGV; IGT accounts → IGTa + IGTe; B2B → any mix. */
/** One uploaded contract file on a deal (private "contracts" Storage bucket). */
export interface DealContract {
  path: string;
  name: string;
  type: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string | null;
}

export interface Deal {
  id: string;
  account_id: string;
  member_id: string | null;
  slots: number;
  slots_igv: number;
  slots_igta: number;
  slots_igte: number;
  /** BD deals' MOS: the deal's money amount in EGP (0 for open-based deals) */
  amount: number;
  /** BD deals: other non-monetary benefits of the deal */
  benefits: string | null;
  note: string | null;
  contracts: DealContract[] | null;
  created_at: string;
}

/** Opens-per-product split of one deal. */
export interface DealBreakdown {
  igv: number;
  igta: number;
  igte: number;
}

export interface AccountComment {
  id: string;
  account_id: string;
  member_id: string | null;
  author_label: CommentLabel;
  body: string;
  pinned: boolean;
  archived: boolean;
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

/** Loose shape check (server safety net) — real validation is normalizePhone. */
export const PHONE_RE = /^\+?\d{7,15}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const URL_RE = /^https?:\/\/\S+\.\S+/i;

export function cleanPhone(raw: string): string {
  return raw.replace(/[\s\-().]/g, "");
}

export interface PhoneCheck {
  ok: boolean;
  /** canonical value, e.g. +201099019374 or +2034831234 */
  value: string;
  error?: string;
}

/** Cleans & normalizes numbers to a canonical format.
 *  Egyptian mobile:   +201[0/1/2/5] + 8 digits
 *  Egyptian landline: +203 + 7 digits (Alexandria) or +202 + 7–8 digits (Cairo)
 *  Anything else must be full international: +<7–15 digits>. */
export function normalizePhone(raw: string): PhoneCheck {
  let v = cleanPhone(raw);
  if (!v) return { ok: false, value: "", error: "Empty number." };
  if (v.startsWith("00")) v = `+${v.slice(2)}`;

  // pull out the Egyptian national part when we can recognize it
  let nat: string | null = null;
  if (v.startsWith("+20")) nat = v.slice(3);
  else if (/^20\d{8,}$/.test(v)) nat = v.slice(2);
  else if (v.startsWith("0")) nat = v.slice(1);
  else if (/^1[0125]\d{8}$/.test(v) || /^[23]\d{7,8}$/.test(v)) nat = v;

  if (nat !== null) {
    if (/^1[0125]\d{8}$/.test(nat)) return { ok: true, value: `+20${nat}` }; // mobile
    if (/^3\d{7}$/.test(nat)) return { ok: true, value: `+20${nat}` }; // Alexandria landline
    if (/^2\d{7,8}$/.test(nat)) return { ok: true, value: `+20${nat}` }; // Cairo landline
    return {
      ok: false,
      value: v,
      error: "Egyptian numbers: mobile 01[0/1/2/5]XXXXXXXX or landline 03XXXXXXX (02 for Cairo).",
    };
  }
  if (/^\+\d{7,15}$/.test(v)) return { ok: true, value: v }; // other international
  return {
    ok: false,
    value: v,
    error: "Use an Egyptian number (01… mobile, 03… landline) or a full international one starting with +.",
  };
}

/** URL slug for an account — names are unique across all ICX, so the slug is too. */
export function accountSlug(name: string): string {
  return encodeURIComponent(normalizeName(name).replace(/\s+/g, "-"));
}

/** Quick-action targets from an account's tagged contacts.
 *  WhatsApp uses the number tagged "Whatsapp" (falls back to the first phone);
 *  Call uses the first non-Whatsapp phone (falls back to any phone). */
export function quickActions(contacts: AccountContact[] | null | undefined): {
  whatsapp: string | null;
  call: string | null;
  email: string | null;
  links: AccountContact[];
} {
  const list = contacts ?? [];
  const phones = list.filter((c) => c.kind === "phone" && c.value);
  const wa = phones.find((c) => c.tag.toLowerCase() === "whatsapp") ?? phones[0] ?? null;
  const call =
    phones.find((c) => c.tag.toLowerCase() !== "whatsapp") ?? phones[0] ?? null;
  const email = list.find((c) => c.kind === "email" && c.value) ?? null;
  return {
    whatsapp: wa ? wa.value.replace(/\D/g, "") : null,
    call: call ? call.value : null,
    email: email ? email.value : null,
    links: list.filter((c) => c.kind === "link" && c.value),
  };
}

// ------------------------------------------------------------------ function colors
// Official AIESEC product colors (logos.aiesec.org):
// GV #F85A40 · GTa (Global Talent) teal #0CB9C1 · GTe (Global Teacher) orange #F48924
export const FUNCTION_COLORS: Record<string, { bg: string; text: string }> = {
  IGV: { bg: "bg-gv/15", text: "text-gv" },
  OGV: { bg: "bg-gv/15", text: "text-gv" },
  IGT: { bg: "bg-gt/15", text: "text-gt" },
  OGT: { bg: "bg-gt/15", text: "text-gt" },
  IGTa: { bg: "bg-gt/15", text: "text-gt" },
  IGTe: { bg: "bg-gte/15", text: "text-gte" },
  B2B: { bg: "bg-primary/15", text: "text-primary" },
  BD: { bg: "bg-chart-4/15", text: "text-chart-4" },
  B2C: { bg: "bg-fuchsia-500/15", text: "text-fuchsia-600 dark:text-fuchsia-400" },
};

/** Product-level badge next to an account name: IGV / IGTa / IGTe / B2B. */
export function productBadge(fn: AccountFunction, product: IgtProduct | null): {
  label: string;
  bg: string;
  text: string;
} {
  const key = fn === "IGT" ? (product ? `I${product}` : "IGT") : fn;
  const c = FUNCTION_COLORS[key] ?? FUNCTION_COLORS.IGT;
  return { label: key, ...c };
}

// ------------------------------------------------------------------ timestamps
// Every action is logged to the minute — these keep the formatting consistent.

/** "13 Jul 2026, 2:05 PM" (12-hour, in the viewer's local time). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

/** "2:05 PM" from an ISO timestamp (12-hour). */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** How each role experiences the CRM — used by the welcome page, welcome
 *  email and the first-run tour. */
export const ROLE_BLURBS: Record<string, string> = {
  LCP: "You lead the LC — the whole picture, every function and every team, is yours to watch (operations stay with your VPs).",
  LCVP: "You own your function — its accounts, goals, members and results are under your command.",
  Director: "You are responsible for your function's operations — full authority over its accounts and pipeline.",
  "Team Leader": "You lead your team — assign accounts, set the team goal and keep everyone moving.",
  Coordinator: "You run your own accounts — log every contact, keep next steps set, and close deals.",
  Member: "Your accounts, contacts and visits live here — log everything, keep a next step on every account, and raise those slots.",
};

/** The IM director — receives "fix my info" requests from members. */
export const ADMIN_EMAIL = "ahmedhallul@aiesec.net";

/** The national Podio "partners" web-form ("Check if your company exists?").
 *  The Add-account flow links here so members verify the name isn't already
 *  taken by another LC before adding it. Overridable via NEXT_PUBLIC_PODIO_FORM_URL. */
export const PODIO_FORM_URL =
  process.env.NEXT_PUBLIC_PODIO_FORM_URL ?? "https://podio.com/webforms/25879454/1936053";

/** The Podio check link. Podio web-forms have their OWN live "does this company
 *  exist?" search field, so we just open the form (no query prefill). */
export function podioCheckUrl(_name: string): string | null {
  return PODIO_FORM_URL || null;
}

/** Feedback goes ONLY to the IM director (admin) and the IM coach — every
 *  submission is emailed to them and only they can open the inbox. */
export const FEEDBACK_INBOX_EMAILS = [
  "ahmedhallul@aiesec.net",
  "omareldeeb123@aiesec.net",
] as const;

/** System-feedback categories — the list adapts to the feedback type (v21). */
export const FEEDBACK_CATEGORIES: Record<"Bug" | "Enhancement" | "Other", readonly string[]> = {
  Bug: [
    "Doesn't work / button dead",
    "Wrong data / numbers",
    "UI looks broken",
    "Responsiveness / mobile",
    "Slow / laggy",
    "Login / access",
    "Emails / notifications",
    "Other",
  ],
  Enhancement: [
    "New feature",
    "UX / easier flow",
    "Design / looks",
    "Mobile experience",
    "Automation / integration",
    "Performance",
    "Other",
  ],
  Other: ["Question", "Appreciation", "Idea", "Other"],
} as const;
