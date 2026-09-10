/** MY SETTINGS (v34.8) — the shape, the defaults, and the searchable index.
 *
 *  Sodio had per-FUNCTION defaults (v33.32) and no per-PERSON ones, so
 *  everything a member might reasonably want to change about their own
 *  experience lived in four different places or nowhere at all: the phone on
 *  the profile card, the theme in the sidebar footer, the mobile list style in
 *  a segmented control above the accounts table — and the email volume
 *  nowhere, because there was no way to opt out of anything.
 *
 *  THE RULE THIS FILE IS BUILT ON, and it is the same one the function
 *  defaults were built on: **a dead toggle is worse than no toggle**. Every
 *  switch below is read by real code on a real send path. Nothing here is
 *  aspirational.
 *
 *  THE SECOND RULE, which matters more: **some emails are not the member's to
 *  turn off.** A visit follow-up prompt, an attendance must-do, a Podio
 *  refresh coming due, a password reset, a booking confirmation to an IR
 *  abroad — those are accountability and commitments to other people, not
 *  preferences. They are listed on the screen as permanently on, with the
 *  reason, rather than quietly omitted: a settings page that hides what it
 *  cannot change teaches people it is incomplete.
 *
 *  Pure — no DB, no server imports — so the reader, the card and the tests
 *  agree on one source of truth.
 */

// ══════════════════════════════════════════════ emails & notifications

/** WHAT A MESSAGE IS ABOUT (v36.2).
 *
 *  v34.8 shipped five switches and a rule that everything else was always on.
 *  The floor asked for the opposite — "turn on/off any emails/notifications or
 *  both" — so every message Sodio sends a MEMBER carries one of these topics,
 *  and each topic has two switches: EMAIL (their inbox) and BELL (the in-app
 *  notification, which since v35 is also what reaches their phone).
 *
 *  The filter lives in ONE place per channel — `notifyMembers` for the bell,
 *  `sendEmail` for the inbox — so a caller only names its topic. A message
 *  with NO topic is always delivered; that is kept for the two that are not
 *  preferences: a password reset and the welcome. Mail to people OUTSIDE the
 *  LC (an IR booking a call) is never filtered — they have no settings.
 *
 *  `tests/member-settings.test.ts` checks that every topic here is named by a
 *  real send, so a switch can never be added that nothing obeys. */
export type NotifyTopic =
  | "accounts_assigned" | "visit_mine" | "visit_announcements" | "visit_followups"
  | "visit_results" | "next_steps" | "podio"
  | "signups_assigned" | "cic_calls" | "streak"
  | "ir_calls" | "partnerships"
  | "touch_points" | "attendance" | "pdp" | "calendar_items" | "cxp"
  | "shoutouts" | "feedback" | "period_reports" | "broadcasts";

/** EMAIL = the inbox. BELL = the in-app notification AND the phone push, which
 *  is the same message delivered to the device. */
export type NotifyChannel = "email" | "bell";
export const NOTIFY_CHANNELS: readonly NotifyChannel[] = ["email", "bell"];

/** Which rows are worth showing this person — see `SettingsContext`. */
export type SettingNeed =
  | "ogx" | "leadsFunction" | "hasPassword" | "raising" | "consideration" | "signups" | "cxp";

export type NotifyGroup = "raising" | "signups" | "consideration" | "team" | "feedback" | "reports";

export const NOTIFY_GROUP_LABEL: Record<NotifyGroup, string> = {
  raising: "Accounts & visits",
  signups: "Sign-ups",
  consideration: "IR calls & partnerships",
  team: "Touch points & your team",
  feedback: "Feedback",
  reports: "Reports & announcements",
};

export interface NotifyTopicMeta {
  id: NotifyTopic;
  group: NotifyGroup;
  label: string;
  description: string;
  keywords: string[];
  /** the channels this topic actually sends on — a switch for a channel it
   *  never uses would be a dead toggle */
  channels: readonly NotifyChannel[];
  needs?: SettingNeed;
}

const BOTH: readonly NotifyChannel[] = ["email", "bell"];

export const NOTIFY_TOPICS: readonly NotifyTopicMeta[] = [
  {
    id: "accounts_assigned", group: "raising", label: "Accounts handed to me",
    description: "When a leader assigns you accounts.",
    keywords: ["assigned", "handed", "accounts", "حسابات"], channels: BOTH, needs: "raising",
  },
  {
    id: "visit_mine", group: "raising", label: "My visits",
    description: "A visit booked on one of your accounts. The email carries the calendar invite — with it off (and no Google sign-in) the visit won't reach your calendar.",
    keywords: ["visit", "invite", "calendar", "زيارة"], channels: BOTH, needs: "raising",
  },
  {
    id: "visit_announcements", group: "raising", label: "“A visit was booked” — the crew",
    description: "The heads-up when anyone in your function books a visit — the busiest message in Sodio. Your own visits are the row above.",
    keywords: ["visit", "announcement", "booked", "noise", "spam", "زيارة", "كتير"], channels: BOTH, needs: "raising",
  },
  {
    id: "visit_followups", group: "raising", label: "Report-your-visit reminders",
    description: "Two hours after a visit (“how did it go?”) and again a week later if it is still unreported. Team Leaders get their members' ones too.",
    keywords: ["follow up", "followup", "report", "visit", "reminder"], channels: BOTH, needs: "raising",
  },
  {
    id: "visit_results", group: "raising", label: "Visit results from my team",
    description: "When somebody you lead reports how a visit went.",
    keywords: ["visit", "report", "result", "team", "leader"], channels: ["email"], needs: "raising",
  },
  {
    id: "next_steps", group: "raising", label: "Next-step reminders",
    description: "On the day of an account's next step — an hour before it when it has a time, at 9:00 when it only has a date.",
    keywords: ["next step", "reminder", "due", "follow up", "تذكير"], channels: BOTH, needs: "raising",
  },
  {
    id: "podio", group: "raising", label: "Podio updates due",
    description: "When accounts you hold need their Podio entry refreshed.",
    keywords: ["podio", "update", "refresh"], channels: BOTH, needs: "raising",
  },
  {
    id: "signups_assigned", group: "signups", label: "Sign-ups handed to me",
    description: "Sign-ups assigned to you, and referrals somebody put on you.",
    keywords: ["signups", "sign-ups", "assigned", "referral", "ogx"], channels: BOTH, needs: "signups",
  },
  {
    id: "cic_calls", group: "signups", label: "CIC & B2C calls to make",
    description: "A customer-interview or B2C call handed to you, and a call-back coming due.",
    keywords: ["cic", "b2c", "call", "call back", "callback"], channels: ["bell"], needs: "signups",
  },
  {
    id: "streak", group: "signups", label: "Streak reminder",
    description: "🔥 The evening nudge when your contacting streak is about to end.",
    keywords: ["streak", "nag", "reminder", "ستريك"], channels: BOTH, needs: "ogx",
  },
  {
    id: "ir_calls", group: "consideration", label: "IR calls",
    description: "A call booked, moved, cancelled or handed to you, a time an IR asked for, and an IR's email bouncing.",
    keywords: ["ir", "call", "booked", "cancelled", "moved", "bounce", "consideration"], channels: BOTH, needs: "consideration",
  },
  {
    id: "partnerships", group: "consideration", label: "Partnerships & targets",
    description: "A partnership target set for you or moved along, and a partnership that counts for you.",
    keywords: ["partnership", "target", "lc", "whatsapp"], channels: ["bell"], needs: "consideration",
  },
  {
    id: "touch_points", group: "team", label: "Touch points",
    description: "Invitations, changes and cancellations — and the ⭐ “how was it?” afterwards.",
    keywords: ["touch point", "event", "meeting", "invite", "rating"], channels: BOTH,
  },
  {
    id: "attendance", group: "team", label: "Attendance",
    description: "Recording or confirming attendance, and the excuses and appeals that reach the people who handle them.",
    keywords: ["attendance", "excuse", "appeal", "حضور"], channels: BOTH,
  },
  {
    id: "pdp", group: "team", label: "PDPs & O2Os",
    description: "Your development plan being filed, and the plans you still owe your people.",
    keywords: ["pdp", "o2o", "development", "plan"], channels: BOTH,
  },
  {
    id: "calendar_items", group: "team", label: "Things added to my calendar",
    description: "When somebody adds an item to your Sodio calendar or removes one.",
    keywords: ["calendar", "added", "removed", "item"], channels: ["bell"],
  },
  {
    id: "cxp", group: "team", label: "CXP reminders & digest",
    description: "The CXP module's weekly reminders and its daily document digest.",
    keywords: ["cxp", "digest", "documents", "ep"], channels: ["email"], needs: "cxp",
  },
  {
    id: "shoutouts", group: "feedback", label: "Shout-outs",
    description: "🎉 When somebody appreciates you on the Feedback page.",
    keywords: ["shoutout", "shout out", "appreciation", "praise", "شكر"], channels: BOTH,
  },
  {
    id: "feedback", group: "feedback", label: "Feedback & concerns",
    description: "Concerns and ratings for the people who handle them, feedback shared with you, and word that yours was handled.",
    keywords: ["feedback", "concern", "inbox", "rating", "bug"], channels: BOTH,
  },
  {
    id: "period_reports", group: "reports", label: "Sprint & month reports",
    description: "The report your function gets when a sprint or a month closes — totals, plan vs achieved, every person's numbers.",
    keywords: ["report", "sprint", "month", "period", "waterfall", "تقرير"], channels: BOTH,
  },
  {
    id: "broadcasts", group: "reports", label: "Announcements from leaders",
    description: "Broadcasts sent to your function or to the whole LC.",
    keywords: ["announcement", "broadcast", "news"], channels: BOTH,
  },
];

/** Words anybody looking for a switch types — every notification row answers
 *  to them, in both languages. */
const NOTIFY_WORDS = [
  "email", "notification", "bell", "phone", "too many", "many", "stop", "less",
  "mute", "quiet", "unsubscribe", "spam", "ايميل", "اشعار", "اشعارات",
];

const TOPIC_IDS = new Set<string>(NOTIFY_TOPICS.map((t) => t.id));
export const isNotifyTopic = (x: unknown): x is NotifyTopic =>
  typeof x === "string" && TOPIC_IDS.has(x);

export type NotifyPrefs = Record<NotifyTopic, Record<NotifyChannel, boolean>>;

export interface MemberSettings {
  /** per topic, per channel — ON unless the member switched it off */
  notify: NotifyPrefs;
}

/** Everything ON: exactly what shipped before any of this existed, so a member
 *  who never opens the panel cannot tell it was added. A fresh object each
 *  call — the result is mutated by `resolveMemberSettings`. */
export function defaultMemberSettings(): MemberSettings {
  const notify = {} as NotifyPrefs;
  for (const t of NOTIFY_TOPICS) notify[t.id] = { email: true, bell: true };
  return { notify };
}

export const MEMBER_SETTINGS_DEFAULTS: MemberSettings = defaultMemberSettings();

/** THE v34.8 SWITCHES, read into their topics. Members who turned one of these
 *  off before v36.2 keep it off; the key is dropped the next time they save. */
export const LEGACY_SETTING_KEYS: Record<string, [NotifyTopic, NotifyChannel]> = {
  emailVisitAnnouncements: ["visit_announcements", "email"],
  bellVisitAnnouncements: ["visit_announcements", "bell"],
  emailPeriodReports: ["period_reports", "email"],
  emailShoutouts: ["shoutouts", "email"],
  emailStreakNag: ["streak", "email"],
};

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** Fill the defaults in around whatever the row actually carries. A stored
 *  blob only ever overrides a switch it really has, so adding a topic later
 *  cannot change what an existing member receives. */
export function resolveMemberSettings(raw: unknown): MemberSettings {
  const stored = isObj(raw) ? raw : {};
  const out = defaultMemberSettings();
  // v34.8 first, so a v36.2 value for the same switch wins
  for (const [key, [topic, channel]] of Object.entries(LEGACY_SETTING_KEYS)) {
    if (typeof stored[key] === "boolean") out.notify[topic][channel] = stored[key] as boolean;
  }
  const notify = isObj(stored.notify) ? stored.notify : {};
  for (const t of NOTIFY_TOPICS) {
    const row = notify[t.id];
    if (!isObj(row)) continue;
    for (const c of NOTIFY_CHANNELS) {
      if (typeof row[c] === "boolean") out.notify[t.id][c] = row[c] as boolean;
    }
  }
  return out;
}

/** Does this member still want `topic` on `channel`? Missing settings mean
 *  YES — see the fail-open note in `server/member-settings.ts`. */
export function wants(
  s: MemberSettings | undefined,
  topic: NotifyTopic,
  channel: NotifyChannel
): boolean {
  return s?.notify[topic]?.[channel] !== false;
}

/** The blob to write back after one switch — or, with `"all"`, every topic
 *  that uses that channel. A MERGE: keys this file doesn't know survive, and
 *  the v34.8 keys are folded in and dropped. */
export function withNotifyPref(
  raw: unknown,
  topic: NotifyTopic | "all",
  channel: NotifyChannel,
  value: boolean
): Record<string, unknown> {
  const stored: Record<string, unknown> = isObj(raw) ? { ...raw } : {};
  const resolved = resolveMemberSettings(stored);
  for (const t of NOTIFY_TOPICS) {
    const hit = topic === "all" ? t.channels.includes(channel) : t.id === topic;
    if (hit) resolved.notify[t.id][channel] = value;
  }
  for (const k of Object.keys(LEGACY_SETTING_KEYS)) delete stored[k];
  return { ...stored, notify: resolved.notify };
}

// ══════════════════════════════════════════════ the searchable index

export type SettingSection =
  | "account" | "notifications" | "appearance" | "function" | "help";

export const SECTION_META: Record<
  SettingSection,
  { label: string; icon: string; blurb: string }
> = {
  account: { label: "Account", icon: "👤", blurb: "Who you are and how you sign in." },
  notifications: {
    label: "Emails & notifications",
    icon: "🔔",
    blurb: "For each kind of message: your inbox, the app (and your phone), both, or neither.",
  },
  appearance: { label: "Appearance", icon: "🎨", blurb: "How Sodio looks on this device." },
  function: { label: "My function", icon: "🏛️", blurb: "Defaults for the crew you lead." },
  help: { label: "Help & support", icon: "🆘", blurb: "When something is wrong." },
};

export interface SettingEntry {
  /** stable id — used by the URL (?s=) so a setting can be linked to */
  id: string;
  section: SettingSection;
  label: string;
  description: string;
  /** extra search terms, English and Arabic — the search is what makes a
   *  long settings page usable, and half this LC types in Arabic */
  keywords: string[];
  kind:
    /** one topic — an Email switch and an App switch, for the channels it uses */
    | { type: "notify"; topic: NotifyTopic }
    /** a browser preference, not an account one — say so on the row */
    | { type: "localChoice"; storageKey: string; options: { value: string; label: string }[]; fallback: string }
    | { type: "theme" }
    /** it already lives somewhere — take them there rather than build a
     *  second control over the same field */
    | { type: "jump"; target: string; cta: string }
    | { type: "external"; href: string; cta: string }
    /** the browser's own notification permission + this device's push
     *  subscription — a capability, not a stored preference (v35) */
    | { type: "push" }
    /** something that cannot be turned off, listed with the reason */
    | { type: "locked"; reason: string };
  /** hidden unless this holds — module-specific rows shouldn't clutter
   *  somebody else's panel */
  needs?: SettingNeed;
  /** the sub-heading a notification row sits under */
  group?: NotifyGroup;
}

export const SETTINGS_INDEX: readonly SettingEntry[] = [
  // ───────────────────────────────────────────── account
  {
    id: "name",
    section: "account",
    label: "Your name",
    description:
      "Comes from the Membership sheet, so it matches every board and email. Ask the IM team to change it.",
    keywords: ["name", "rename", "spelling", "اسم", "الاسم"],
    kind: { type: "jump", target: "profile-info", cta: "See my info" },
  },
  {
    id: "aiesec-email",
    section: "account",
    label: "AIESEC email",
    description:
      "Your identity: it is what you sign in with and what the Membership sheet carries. Only the IM team can change it.",
    keywords: ["email", "aiesec.net", "sign in", "login", "ايميل", "بريد"],
    kind: { type: "jump", target: "profile-info", cta: "See my info" },
  },
  {
    id: "phone",
    section: "account",
    label: "Phone number",
    description:
      "Used for sign-in, the WhatsApp buttons other members see, and your email signature. Egyptian numbers are normalised for you.",
    keywords: ["phone", "mobile", "whatsapp", "number", "تليفون", "رقم", "موبايل"],
    kind: { type: "jump", target: "profile-info", cta: "Edit my phone" },
  },
  {
    id: "backup-email",
    section: "account",
    label: "Backup Gmail",
    description:
      "A personal address used ONLY until your @aiesec.net arrives — password resets and IR-call invites reach you there. Never a sign-in.",
    keywords: ["backup", "gmail", "personal", "reset", "password", "ايميل احتياطي"],
    kind: { type: "jump", target: "profile-info", cta: "Set my backup email" },
  },
  {
    id: "password",
    section: "account",
    label: "Password",
    description: "Change the password you sign in with.",
    keywords: ["password", "change password", "security", "كلمة السر", "الباسورد"],
    kind: { type: "jump", target: "profile-password", cta: "Change it" },
  },
  {
    id: "avatar",
    section: "account",
    label: "Profile picture",
    description:
      "Pick a character, build your own, or upload a photo. It shows in the sidebar and beside your name.",
    keywords: ["avatar", "picture", "photo", "profile", "صورة"],
    kind: { type: "jump", target: "profile-avatar", cta: "Change my picture" },
  },

  // ───────────────────────────────────────────── emails & notifications (v36.2)
  // one row per topic — see NOTIFY_TOPICS for what each covers
  ...NOTIFY_TOPICS.map(
    (t): SettingEntry => ({
      id: `notify-${t.id}`,
      section: "notifications",
      group: t.group,
      label: t.label,
      description: t.description,
      keywords: [...t.keywords, ...NOTIFY_WORDS],
      kind: { type: "notify", topic: t.id },
      ...(t.needs ? { needs: t.needs } : {}),
    })
  ),
  {
    id: "push-device",
    section: "notifications",
    label: "Notifications on this phone or laptop",
    description:
      "The App switches above, delivered to this device — so an account handed to you or a reminder reaches you without Sodio being open. Each device is separate; the Android app uses this exact switch.",
    keywords: [
      "push", "notification", "phone", "mobile", "android", "app", "alerts",
      "اشعارات", "تنبيهات", "موبايل",
    ],
    kind: { type: "push" },
  },
  {
    id: "notify-always-on",
    section: "notifications",
    label: "Password resets and your welcome — always on",
    description:
      "A fresh password you asked for, and the one welcome when you first sign in. They are how you get into Sodio, not news about it, so they can't be switched off.",
    keywords: ["password", "reset", "welcome", "cannot turn off", ...NOTIFY_WORDS],
    kind: { type: "locked", reason: "They are how you get into Sodio." },
  },

  // ───────────────────────────────────────────── appearance
  {
    id: "theme",
    section: "appearance",
    label: "Light or dark",
    description: "Follows your device by default. Saved in this browser.",
    keywords: ["theme", "dark", "light", "mode", "ثيم", "دارك"],
    kind: { type: "theme" },
  },
  {
    id: "accounts-mobile-view",
    section: "appearance",
    label: "How the accounts list looks on a phone",
    description:
      "Cards is roomy, Compact is one line per account, Table is the full grid. Saved in this browser.",
    keywords: ["accounts", "mobile", "cards", "compact", "table", "list", "phone"],
    kind: {
      type: "localChoice",
      storageKey: "sodio-accounts-mobile-view",
      options: [
        { value: "cards", label: "Cards" },
        { value: "compact", label: "Compact" },
        { value: "table", label: "Table" },
      ],
      fallback: "cards",
    },
  },
  {
    id: "tab-order",
    section: "appearance",
    label: "Sidebar tab order",
    description:
      "Drag your tabs into the order you actually use them, from “Arrange tabs” at the bottom of the sidebar. Saved in this browser.",
    keywords: ["sidebar", "tabs", "order", "arrange", "nav", "ترتيب"],
    kind: { type: "locked", reason: "It lives at the foot of the sidebar — “Arrange tabs”." },
  },

  // ───────────────────────────────────────────── function defaults
  {
    id: "function-defaults",
    section: "function",
    label: "Defaults for the function you lead",
    description:
      "Podio cadence for new accounts, who may see the whole function, OGX claiming and referrals, TM's working-hours rules. These apply to everyone in the function, not just you.",
    keywords: ["function", "defaults", "podio", "cadence", "vp", "director", "settings"],
    kind: { type: "jump", target: "profile-function-defaults", cta: "Open function defaults" },
    needs: "leadsFunction",
  },

  // ───────────────────────────────────────────── help
  {
    id: "help-centre",
    section: "help",
    label: "Help centre",
    description: "How everything works, searchable, in English and Arabic.",
    keywords: ["help", "how to", "guide", "playbook", "مساعدة"],
    kind: { type: "external", href: "/help", cta: "Open Help" },
  },
  {
    id: "report-problem",
    section: "help",
    label: "Report a problem with Sodio",
    description: "A bug, something confusing, or an idea. It reaches the IM team with the page you were on.",
    keywords: ["bug", "problem", "broken", "feedback", "report", "مشكلة", "بلاغ"],
    kind: { type: "jump", target: "profile-feedback", cta: "Report it" },
  },
  {
    id: "wrong-info",
    section: "help",
    label: "Something about me is wrong",
    description:
      "Name, role, function, team or email — those come from the Membership sheet. Message the IM director and it's fixed at the source.",
    keywords: ["wrong", "role", "function", "team", "membership", "غلط", "خطأ"],
    kind: { type: "jump", target: "profile-info", cta: "See my info" },
  },
];

/** Context deciding which rows are worth showing this person. */
export interface SettingsContext {
  ogx: boolean;
  leadsFunction: boolean;
  hasPassword: boolean;
  /** works accounts (ICX raising, B2B/BD, B2C) */
  raising: boolean;
  /** IR calls and partner LCs */
  consideration: boolean;
  /** OGX sign-ups, or the B2C callers who work them */
  signups: boolean;
  cxp: boolean;
}

export function visibleSettings(ctx: SettingsContext): SettingEntry[] {
  return SETTINGS_INDEX.filter((e) => {
    if (!e.needs) return true;
    return ctx[e.needs];
  });
}

/** SEARCH — diacritic- and hamza-folded, so either Arabic spelling finds the
 *  row (the same normalisation the Help centre uses, and the reason it works
 *  for half this LC). */
export function foldSearch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟ]/g, "")
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rank by where the match landed: a title hit beats a keyword hit beats a
 *  body hit. Every word must match SOMEWHERE, so "visit email" finds the
 *  visit-announcement email and not every row mentioning email. */
export function searchSettings(
  entries: readonly SettingEntry[],
  query: string
): SettingEntry[] {
  const words = foldSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...entries];

  const scored: { e: SettingEntry; score: number }[] = [];
  for (const e of entries) {
    const label = foldSearch(e.label);
    const keys = foldSearch(e.keywords.join(" "));
    const body = foldSearch(`${e.description} ${SECTION_META[e.section].label}`);
    let score = 0;
    let all = true;
    for (const w of words) {
      // `includes` is a substring test, so "email" finds "emails" but NOT the
      // other way round — and people type the plural. Try the singular stem
      // too, or the Email section would be unfindable by the word "emails".
      const hit = (hay: string) => hay.includes(w) || (w.length > 3 && w.endsWith("s") && hay.includes(w.slice(0, -1)));
      if (hit(label)) score += 6;
      else if (hit(keys)) score += 3;
      else if (hit(body)) score += 1;
      else { all = false; break; }
    }
    if (all) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.e);
}
