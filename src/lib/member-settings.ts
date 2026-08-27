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

export interface MemberSettings {
  // ---------------- email
  /** the function-wide "📢 new visit booked" FYI. Not your own visits, not
   *  your team's follow-up prompts — the crew-wide heads-up, which is the
   *  single highest-volume email in the system (521 in one week, v33.42). */
  emailVisitAnnouncements: boolean;
  /** the sprint / month period report for your function */
  emailPeriodReports: boolean;
  /** 🎉 "someone appreciated you" — the bell still fires either way */
  emailShoutouts: boolean;
  /** the evening 🔥 streak nag (OGX). The bell still fires. */
  emailStreakNag: boolean;

  // ---------------- in-app bell
  /** the same crew-wide visit fan-out, on the bell side */
  bellVisitAnnouncements: boolean;
}

export const MEMBER_SETTINGS_DEFAULTS: MemberSettings = {
  // every default is EXACTLY what shipped before this existed: a member who
  // never opens the panel must not be able to tell it was added
  emailVisitAnnouncements: true,
  emailPeriodReports: true,
  emailShoutouts: true,
  emailStreakNag: true,
  bellVisitAnnouncements: true,
};

export type MemberSettingKey = keyof MemberSettings;

/** Fill the defaults in around whatever the row actually carries. A stored
 *  blob only ever overrides a key it really has, so adding a setting later
 *  cannot change the behaviour of an existing member. */
export function resolveMemberSettings(raw: unknown): MemberSettings {
  const stored = (raw ?? {}) as Partial<Record<string, unknown>>;
  const out = { ...MEMBER_SETTINGS_DEFAULTS };
  for (const k of Object.keys(MEMBER_SETTINGS_DEFAULTS) as MemberSettingKey[]) {
    if (typeof stored[k] === "boolean") out[k] = stored[k] as boolean;
  }
  return out;
}

// ══════════════════════════════════════════════ the searchable index

export type SettingSection =
  | "account" | "email" | "notifications" | "appearance" | "function" | "help";

export const SECTION_META: Record<
  SettingSection,
  { label: string; icon: string; blurb: string }
> = {
  account: { label: "Account", icon: "👤", blurb: "Who you are and how you sign in." },
  email: { label: "Email", icon: "✉️", blurb: "What lands in your inbox." },
  notifications: { label: "Notifications", icon: "🔔", blurb: "What lands on the bell." },
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
    | { type: "toggle"; key: MemberSettingKey }
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
  needs?: "ogx" | "leadsFunction" | "hasPassword";
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

  // ───────────────────────────────────────────── email
  {
    id: "email-visit-announcements",
    section: "email",
    label: "“A visit was booked” emails",
    description:
      "The crew-wide heads-up when anyone in your function books a visit. Turning it off does NOT touch your own visits, your calendar invites, or the follow-up asking you to report one.",
    keywords: [
      "visit", "announcement", "booked", "noise", "too many", "many", "stop",
      "less", "mute", "quiet", "unsubscribe", "spam", "زيارة", "ايميل", "كتير",
    ],
    kind: { type: "toggle", key: "emailVisitAnnouncements" },
  },
  {
    id: "email-period-reports",
    section: "email",
    label: "Sprint & month reports",
    description:
      "The waterfall report your function gets when a sprint or a month closes — totals, plan vs achieved, every person's numbers.",
    keywords: [
      "report", "sprint", "month", "period", "waterfall", "too many", "many",
      "stop", "less", "mute", "quiet", "unsubscribe", "تقرير",
    ],
    kind: { type: "toggle", key: "emailPeriodReports" },
  },
  {
    id: "email-shoutouts",
    section: "email",
    label: "Shout-out emails",
    description:
      "🎉 when somebody appreciates you on the Feedback page. The bell still tells you either way — this is only the email.",
    keywords: [
      "shoutout", "shout out", "appreciation", "feedback", "praise", "too many",
      "many", "stop", "less", "mute", "quiet", "unsubscribe", "شكر",
    ],
    kind: { type: "toggle", key: "emailShoutouts" },
  },
  {
    id: "email-streak-nag",
    section: "email",
    label: "Streak reminder email",
    description:
      "🔥 the evening nudge when your contacting streak is about to end. The bell still fires — this is only the email.",
    keywords: [
      "streak", "nag", "reminder", "signups", "ogx", "too many", "many", "stop",
      "less", "mute", "quiet", "unsubscribe", "ستريك",
    ],
    kind: { type: "toggle", key: "emailStreakNag" },
    needs: "ogx",
  },
  {
    id: "email-must-dos",
    section: "email",
    label: "Follow-ups, attendance and Podio — always on",
    description:
      "Reporting a visit you booked, recording attendance, refreshing an account on Podio, a password reset, a booking confirmation to an IR abroad. These are commitments to other people, not preferences, so nobody can switch them off — including you.",
    keywords: [
      "follow up", "followup", "attendance", "podio", "reminder", "must do",
      "cannot turn off", "unsubscribe", "spam", "too many", "many", "stop",
      "less", "mute", "quiet",
    ],
    kind: {
      type: "locked",
      reason: "Somebody else is waiting on each of these.",
    },
  },

  // ───────────────────────────────────────────── bell
  {
    id: "bell-visit-announcements",
    section: "notifications",
    label: "“A visit was booked” on the bell",
    description:
      "The same crew-wide heads-up, in the notifications panel. Your own visits always appear.",
    keywords: ["bell", "notification", "visit", "announcement", "اشعار"],
    kind: { type: "toggle", key: "bellVisitAnnouncements" },
  },
  {
    id: "push-device",
    section: "notifications",
    label: "Notifications on this phone or laptop",
    description:
      "The same bell, delivered to the device — so an account handed to you, a visit booked or a prompt waiting reaches you without Sodio being open. Turn it on wherever you want to be reached; each device is separate. The Android app uses this exact switch.",
    keywords: [
      "push", "notification", "phone", "mobile", "android", "app", "alerts",
      "اشعارات", "تنبيهات", "موبايل",
    ],
    kind: { type: "push" },
  },
  {
    id: "bell-everything-else",
    section: "notifications",
    label: "Everything else on the bell stays on",
    description:
      "An account handed to you, a deal, a touch point you're invited to, a bounced IR email, a prompt waiting for you. The bell is where Sodio reaches you when something is actually yours to do.",
    keywords: ["bell", "notifications", "cannot turn off", "اشعارات"],
    kind: { type: "locked", reason: "This is how work reaches you." },
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
