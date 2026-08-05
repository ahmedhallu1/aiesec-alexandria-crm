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
  | "Director"
  /** v33 — the SYSTEM caretaker. Not an operational rank: it grants the admin
   *  TOOLS (Health & Logs, the test view), never other people's modules. */
  | "Admin";
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
  "LCP", "LCVP", "Team Leader", "Coordinator", "Member", "Director", "Admin",
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

/** Default Podio-update cadence — 14 days for EVERY function (v24.1;
 *  editable 1–90 per account). The feature exists on IGV/IGT/BD/B2C and is
 *  ON by default for new IGV/B2C/BD accounts. */
export const PODIO_UPDATE_DEFAULT_DAYS = 14;

/** The functions that show the "Podio — continuous update" card (v24).
 *  B2B keeps only the classic AMS request card. */
export const PODIO_UPDATE_FUNCTIONS: AccountFunction[] = ["IGV", "IGT", "BD", "B2C"];

/** Per-function default cadence — 14 days across the board (kept as a
 *  function so a future per-function default is a one-line change). */
export function podioDefaultDays(_fn: AccountFunction): number {
  return PODIO_UPDATE_DEFAULT_DAYS;
}

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
// ------------------------------------------------------------------ OGX (v25)

export type OgxFunction = "OGT" | "OGV";

/** VP-set sign-up statuses — "Approved" is the OGX MOS (accepted by the host
 *  entity, paid, contract signed, ready to start the travel process). */
export const SIGNUP_STATUSES = [
  "Parents Approval",
  "Applied",
  "Accepted",
  "Approved",
] as const;

/** A sign-up imported from the OGX tracker sheets (two-way synced). */
export interface SignupRow {
  id: string;
  fn: OgxFunction;
  batch: "new" | "old";
  source: string;
  ep_id: string;
  name: string;
  signed_up_at: string | null;
  phone: string | null;
  email: string | null;
  gender: string | null;
  dob: string | null;
  person_status: string | null;
  program: string | null;
  referral: string | null;
  grad_year: string | null;
  university: string | null;
  background: string | null;
  home_lc: string | null;
  campaign: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  contact_status: string | null;
  interested: string | null;
  country: string | null;
  sub_product: string | null;
  status: string | null;
  out_of_process: boolean;
  oop_reason: string | null;
  reasons_not_travel: string | null;
  assigned_at: string | null;
  contacted_at: string | null;
  last_edited_at: string | null;
  sodio_touched: boolean;
  created_at: string;
  updated_at: string;
}

export interface SignupComment {
  id: string;
  signup_id: string;
  author_id: string | null;
  author_name: string;
  author_class: "member" | "vp";
  body: string;
  created_at: string;
}

/** What actually came out of a COMPLETED visit (v33). Each one decides what
 *  happens next, which is why it's a pick-list and not a free-text box:
 *    Interested        → keep working it, a next step is required
 *    Not interested    → archives the account on the spot
 *    Sending proposal  → offers the proposal-email form right there
 *    Not ready yet     → requires the follow-up date
 *    Other             → free text, next step still required */
export const VISIT_RESULTS = [
  "Interested",
  "Not interested",
  "I will send the proposal",
  "Not ready yet",
  "Other",
] as const;
export type VisitResult = (typeof VISIT_RESULTS)[number];

export const OOP_REASONS = [
  "Not responding",
  "Financial issues",
  "Not Interested",
  "Backed out",
  "Other Plans",
  "Closed company",
  "No contact info",
  "Needs too technical background EPs",
  "Conflict of Values between AIESEC and organization",
  "Blacklisted",
] as const;

export interface Member {
  id: string;
  name: string;
  /** null = no AIESEC email yet (v24) — the member signs in with their PHONE
   *  in both login fields until the email lands and they Google-sign-in */
  email: string | null;
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
  /** v33.2 — this person holds the LC's Podio access, so they may set an
   *  account's Request State like an MM. A capability, not a rank. */
  has_podio?: boolean | null;
  /** v33.7 — when they disappeared from the Membership sheet. Set = they
   *  LEFT the LC, and they belong in the archive rather than among the
   *  actives. Cleared automatically if they reappear on the sheet. */
  left_at?: string | null;
}

/** Session key for members WITHOUT an AIESEC email (v24): their JWT "email"
 *  claim is a synthetic `phone+<digits>@sodio.local` that can never collide
 *  with a real mailbox. parse… returns the digits, or null for real emails. */
export function phoneSessionKey(phone: string): string {
  return `phone+${phone.replace(/\D/g, "")}@sodio.local`;
}
export function parsePhoneSessionKey(email: string): string | null {
  const m = /^phone\+(\d{7,15})@sodio\.local$/.exec(email);
  return m ? m[1] : null;
}

// ------------------------------------------------------ TM touch points (v29)

export const TOUCH_POINT_SCOPES = ["team", "function", "lc"] as const;
export type TouchPointScope = (typeof TOUCH_POINT_SCOPES)[number];

export const TOUCH_POINT_KINDS = ["meeting", "working_hours", "outing"] as const;
export type TouchPointKind = (typeof TOUCH_POINT_KINDS)[number];

export const ATTENDANCE_STATUSES = ["attended", "absent", "late"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** "Team working hours" · "Function meeting" · "LC outing" */
export function touchPointLabel(scope: TouchPointScope, kind: TouchPointKind): string {
  const s = scope === "lc" ? "LC" : scope === "function" ? "Function" : "Team";
  const k =
    kind === "working_hours" ? "working hours" : kind === "meeting" ? "meeting" : "outing";
  return `${s} ${k}`;
}

/** Support functions with no raising floor — never booked for, never invited. */
export const NO_WORKING_HOURS_FUNCTIONS = ["TM", "F&L", "CXP"];

/** AUTOMATIC working-hours attendance (v29): a member is "attended" when they
 *  did at least WORK_MIN_ACTIONS real work actions inside the session window,
 *  at least WORK_MIN_GAP_MINUTES apart — act-act spam doesn't pass, one call
 *  plus a comment a quarter of an hour later does. */
export const WORK_SESSION_HOURS = 4;
export const WORK_MIN_ACTIONS = 2;
export const WORK_MIN_GAP_MINUTES = 10;

/** A tagged phone number, email or link on an account ("CEO", "LinkedIn", …). */
export interface AccountContact {
  tag: string;
  kind: "phone" | "email" | "link";
  value: string;
}

/** Tag choices for phones ("Other" = free text). */
export const CONTACT_TAGS = [
  "Contact", "Whatsapp", "Hotline", "Manager", "HR", "CEO", "Owner", "Other",
] as const;

/** Which tags a PHONE may carry, given its shape (v33).
 *
 *  A hotline and a landline cannot receive WhatsApp — offering the tag invites
 *  a member to set it and then wonder why the WhatsApp button does nothing.
 *  A hotline is also never a person, so the people tags go too. */
export function phoneTagsFor(value: string): string[] {
  const v = cleanPhone(value ?? "");
  if (HOTLINE_RE.test(v)) return ["Hotline", "Contact", "Other"];
  // Egyptian landlines: +203… / +202… (or the local 03…/02… form)
  const landline = /^(\+?20)?[23]\d{7,8}$/.test(v);
  if (landline) return CONTACT_TAGS.filter((t) => t !== "Whatsapp" && t !== "Hotline");
  return CONTACT_TAGS.filter((t) => t !== "Hotline");
}

/** A hotline tags itself — there is nothing else it could be. */
export function guessPhoneTag(value: string): string | null {
  return HOTLINE_RE.test(cleanPhone(value ?? "")) ? "Hotline" : null;
}

/** Tag choices for emails — no Whatsapp here. */
export const EMAIL_TAGS = [
  "Contact", "Manager", "HR", "CEO", "Owner", "Other",
] as const;

/** Tag choices for links ("Other" = free text). */
export const LINK_TAGS = [
  "Website", "LinkedIn", "Instagram", "Facebook", "Other",
] as const;

/** The tag a fresh row of each kind starts with (its "untouched" default) —
 *  auto-tagging (below) only ever replaces a tag the member hasn't set. */
export const DEFAULT_CONTACT_TAG: Record<AccountContact["kind"], string> = {
  phone: "Contact",
  email: "Contact",
  link: "Website",
};

// ------------------------------------------------------------------ auto-tagging
// The system reads the value and tags it by itself: an Instagram page becomes
// "Instagram", ceo@company.com becomes "CEO". Both helpers are PURE, always
// conservative (they return null when they aren't sure, so the current tag
// stands) and never override a tag a human picked — the caller decides that.

/** Host → link tag. `wa.me` / `api.whatsapp.com` links are WhatsApp contacts,
 *  so they carry the phone list's "Whatsapp" tag (a custom tag on a link).
 *  Any other http(s) address falls back to "Website". */
export function guessLinkTag(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // tolerate a half-typed address (no scheme yet) — the member is still typing
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let host: string;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    host = url.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.includes(".")) return null; // "https://inst" — nothing to read yet
  if (host.includes("instagram")) return "Instagram";
  if (host.includes("linkedin") || host === "lnkd.in" || host.endsWith(".lnkd.in"))
    return "LinkedIn";
  if (host.includes("facebook") || host === "fb.com" || host.endsWith(".fb.com") || host === "fb.me")
    return "Facebook";
  if (host === "wa.me" || host.endsWith(".wa.me") || host.includes("whatsapp"))
    return "Whatsapp";
  // a real address of some other host: the company's own site
  return URL_RE.test(value) ? "Website" : null;
}

/** Local-part → email tag. Matched on WHOLE words of the address before the
 *  "@" (split on . _ - + digits), case-insensitively — "ceo@x.com",
 *  "hr.alex@x.com" and "sales-team@x.com" all read, "cecilia@x.com" doesn't. */
const EMAIL_TAG_RULES: { test: RegExp; tag: string }[] = [
  { test: /^(ceo|chairman|chairwoman|chairperson|president)$/, tag: "CEO" },
  { test: /^(owner|founder|cofounder|founders|proprietor)$/, tag: "Owner" },
  { test: /^(hr|humanresources|careers?|jobs?|hiring|recruit(ing|ment|ers?)?|talent)$/, tag: "HR" },
  { test: /^(manager|managers|managing|mgr|management|ops|operations?)$/, tag: "Manager" },
  {
    test: /^(info|contact|contactus|hello|hi|support|sales|help|inquiry|inquiries|enquiry|enquiries|customercare|care)$/,
    tag: "Contact",
  },
];

export function guessEmailTag(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const at = value.indexOf("@");
  if (at < 1) return null; // nothing typed before the "@" yet
  const words = value
    .slice(0, at)
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  for (const rule of EMAIL_TAG_RULES)
    if (words.some((w) => rule.test.test(w))) return rule.tag;
  return null; // unknown address → leave whatever tag is there
}

/** The tag the system would pick for this value, or null when it can't tell.
 *  Phones are never guessed — a number says nothing about who owns it. */
export function guessContactTag(kind: AccountContact["kind"], value: string): string | null {
  if (kind === "link") return guessLinkTag(value);
  if (kind === "email") return guessEmailTag(value);
  // a 5-digit hotline is unambiguous — nothing else has that shape
  return guessPhoneTag(value);
}

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
  /** the account must be refreshed on Podio every N days (v23 B2C; v24 all) */
  podio_update_every_days: number | null;
  /** continuous Podio updates active for this account (v24) */
  podio_update_enabled: boolean;
  /** when it was last marked "updated on Podio" */
  podio_updated_at: string | null;
  /** the week-later firmer reminder (once per cycle, v24) */
  podio_update_second_notified_at: string | null;
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
  /** EVERY live comment on the account, oldest first (v33) — attached by
   *  `listAccountsPage` so the Comment column can show the whole thread the
   *  way a sheet would, without opening the account. */
  comments_all?: { body: string; author: string | null; at: string }[];
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

/** Egyptian HOTLINE / short code — 5 digits starting with 1 (16123, 19016).
 *  Businesses print these instead of a landline, so a member copying the
 *  number off a shopfront or a website has nothing else to type (v33). They
 *  are national short codes: there is no country-code form, so they are stored
 *  exactly as dialled. */
export const HOTLINE_RE = /^1\d{4}$/;

/** Loose shape check (server safety net) — real validation is normalizePhone.
 *  Accepts a full number OR a hotline short code. */
export const PHONE_RE = /^(?:\+?\d{7,15}|1\d{4})$/;
export const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
export const URL_RE = /^https?:\/\/\S+\.\S+/i;

/** Reduces any pasted number to `+`? + digits.
 *
 *  Everything else is dropped: spaces of every width, dashes of every shape,
 *  brackets, dots, slashes — and, critically, the characters that are
 *  INVISIBLE on screen. A number copied out of an Arabic WhatsApp chat almost
 *  always carries a bidi mark (U+200E/U+200F); zero-width spaces, soft hyphens
 *  and BOMs ride along from Excel and PDFs the same way. Those used to survive
 *  cleanPhone, so the number LOOKED perfect and still failed validation, with
 *  nothing the member could see, select or delete — the error just never went
 *  away. What is on screen is now what gets validated. */
export function cleanPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  // a leading "+" is the only non-digit that carries meaning, so it survives —
  // but only if it really leads: an invisible mark must not hide it. "00…" is
  // left alone for normalizePhone to convert.
  const lead = raw.match(
    /[^\s\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/
  );
  return lead?.[0] === "+" ? `+${digits}` : digits;
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
  // a hotline is already canonical — never prefix it with +20, it isn't
  // dialable that way
  if (HOTLINE_RE.test(v)) return { ok: true, value: v };
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
      error:
        "Egyptian numbers: mobile 01[0/1/2/5]XXXXXXXX, landline 03XXXXXXX (02 for Cairo), or a 5-digit hotline like 16123.",
    };
  }
  if (/^\+\d{7,15}$/.test(v)) return { ok: true, value: v }; // other international
  return {
    ok: false,
    value: v,
    error:
      "Use an Egyptian number (01… mobile, 03… landline, or a 5-digit hotline like 16123) or a full international one starting with +.",
  };
}

/** URL slug for an account. ACTIVE names are unique across every function;
 *  an archived name may be reused by the other world (v23.2) — slug lookups
 *  prefer the active row, archived rows are linked by UUID. */
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
  // a hotline or a landline can't receive WhatsApp, so it must never become
  // the fallback — a dead WhatsApp button is worse than no button (v33)
  const waCapable = phones.filter((c) => {
    const v = cleanPhone(c.value);
    return !HOTLINE_RE.test(v) && !/^(\+?20)?[23]\d{7,8}$/.test(v);
  });
  const wa =
    waCapable.find((c) => c.tag.toLowerCase() === "whatsapp") ?? waCapable[0] ?? null;
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
