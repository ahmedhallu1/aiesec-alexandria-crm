/** THE TAB MANAGER (v38) — pure, client-safe.
 *
 *  Every sidebar tab has a BUILT-IN rule written in code (rbac.ts decides who
 *  gets Raising, who gets Planning…). The LCP and the admins can now lay a
 *  rule ON TOP of that from Settings → Tabs, without a deploy:
 *
 *    - rename it, or move it in the LC's default order;
 *    - start from "as the code says", "everyone" or "nobody";
 *    - show it to, or hide it from, chosen people / roles / functions;
 *    - only show it from a date, and remove it on a date (the Activate bid
 *      tab is the case that asked for this: useful for a month, then dead);
 *    - retire it now ("delete" — code cannot be deleted from a screen, so a
 *      retired tab is gone for everyone until somebody restores it);
 *    - take its PUBLIC twin down too (/activate26, /no-peace).
 *
 *  A hidden tab is not only gone from the sidebar: every page asks
 *  `tabAllows` (src/server/tabs.ts) and sends a viewer it is hidden from home.
 *  A tab shown to someone the code would refuse OPENS the page for them; what
 *  that gives them is per tab (`TabDef.shown`, which the manager prints) —
 *  the data modules still read by role, the War Room and the bid hand over
 *  the editor (that is how the LC grants them).
 *
 *  HIDE-ONLY TABS (v38.3, `widen: false`): Health & Logs and Membership show
 *  logs, API keys and every member's phone and email with no role check of
 *  their own behind the page gate, so a rule may take them AWAY but never
 *  hand them out — `tabOverride` ignores a show audience and an "everyone"
 *  base there, which also neutralises any such row already saved.
 *
 *  PRECEDENCE, first match wins:
 *    1. retired, past its remove date, or before its show date → hidden
 *    2. this PERSON is named → their side (hide beats show)
 *    3. their ROLE or FUNCTION is named → that side (hide beats show)
 *    4. the base: everyone → shown · nobody → hidden · default → the code */

export type TabBase = "default" | "everyone" | "nobody";

export interface TabAudience {
  members: string[];
  roles: string[];
  functions: string[];
}

export interface TabRule {
  href: string;
  label: string | null;
  position: number | null;
  base: TabBase;
  show: TabAudience;
  hide: TabAudience;
  visibleFrom: string | null;
  removeAt: string | null;
  retiredAt: string | null;
  publicOff: boolean;
  publicWithTab: boolean;
  note: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface TabDef {
  href: string;
  label: string;
  /** who gets it when no rule is set — shown in the manager, in words */
  builtIn: string;
  /** a public, no-login twin page that can be taken down with the tab */
  publicHref?: string;
  /** false = HIDE-ONLY: no rule can show it to anyone the code refuses */
  widen?: false;
  /** what "show it to" actually gives a person the code would refuse — the
   *  manager prints it, so the LCP knows before saving */
  shown?: string;
}

/** What showing a data module to someone hands them, when a tab says nothing
 *  of its own. */
export const SHOWN_DEFAULT = "Opens the page for them, but the data inside still follows their role, so it can look empty.";

/** Every tab, in the sidebar's default order. The shell, the layout and the
 *  manager all read THIS list — a new tab is added here or it cannot be
 *  managed. */
export const TAB_REGISTRY: TabDef[] = [
  { href: "/accounts", label: "Raising", builtIn: "Raising crews (IGV, IGT, B2B/BD, B2C) and leadership" },
  { href: "/dashboard", label: "Dashboard", builtIn: "Anyone who owns a lane, plus TM and F&L leadership" },
  { href: "/calendar", label: "Calendar", builtIn: "Everyone in a live module" },
  { href: "/signups", label: "Sign-ups", builtIn: "OGV & OGT crews, and B2C for the CIC queue" },
  { href: "/consideration", label: "Consideration", builtIn: "ICX consideration crews" },
  { href: "/cxp", label: "CXP", builtIn: "CXP and the product functions, per side" },
  {
    href: "/planning", label: "Planning", builtIn: "VPs, Directors, the LCP and admins",
    // the page narrows itself for a person the code refuses (planning/page.tsx)
    shown: "Opens the board on their own function's plan; of the MM plans, they see only their own.",
  },
  { href: "/members", label: "Talent Management", builtIn: "TM, the LCP and admins" },
  {
    href: "/membership", label: "Membership", builtIn: "The EB (LCP + LCVPs) and admins", widen: false,
    shown: "Can only be hidden: the page lists every member's phone and email and edits them.",
  },
  {
    href: "/activation", label: "Activate 26' Bid", builtIn: "MMs and above", publicHref: "/activate26",
    shown: "They can read AND edit the bid plan, like an MM.",
  },
  {
    href: "/war-room", label: "War Room", builtIn: "The F&L VP, the LCP and admins", publicHref: "/no-peace",
    shown: "They can log, edit and delete war points and change the war's settings.",
  },
  { href: "/attendance", label: "Attendance", builtIn: "Everyone" },
  { href: "/pdp", label: "PDP & O2O", builtIn: "Everyone the TM process touches" },
  { href: "/emails", label: "Emails", builtIn: "Everyone (the starting letters follow the role)" },
  { href: "/help", label: "Help", builtIn: "Everyone" },
  { href: "/lc-feedback", label: "LC Feedback", builtIn: "Everyone" },
  {
    href: "/admin", label: "Health & Logs", builtIn: "Admins", widen: false,
    shown: "Can only be hidden: the page shows the audit log, API keys and system health.",
  },
];

export const TAB_HREFS = new Set(TAB_REGISTRY.map((t) => t.href));

/** The bid tab's path — shared by its page and its actions, so the two ask
 *  the same rule. */
export const ACTIVATION_TAB = "/activation";

/** May a rule SHOW this tab to someone the code refuses? (see HIDE-ONLY) */
export function tabCanWiden(href: string): boolean {
  return TAB_REGISTRY.find((t) => t.href === href)?.widen !== false;
}

/** The person a rule is checked against. */
export interface TabWho {
  id: string;
  role: string;
  functions: string[];
  sub_functions: string[];
}

export type TabOverride = "show" | "hide";

const EMPTY: TabAudience = { members: [], roles: [], functions: [] };

const strList = (v: unknown, max = 400): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))].slice(0, max)
    : [];

export function cleanAudience(raw: unknown): TabAudience {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const r = raw as Record<string, unknown>;
  return { members: strList(r.members), roles: strList(r.roles, 20), functions: strList(r.functions, 40) };
}

const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** A DB row (snake_case) → a TabRule. Unknown shapes fall to safe values. */
export function ruleFromRow(row: Record<string, unknown>): TabRule {
  const base = row.base === "everyone" || row.base === "nobody" ? row.base : "default";
  return {
    href: String(row.href ?? ""),
    label: typeof row.label === "string" && row.label.trim() ? row.label.trim().slice(0, 40) : null,
    position: typeof row.position === "number" && Number.isFinite(row.position) ? row.position : null,
    base,
    show: cleanAudience(row.show_to),
    hide: cleanAudience(row.hide_from),
    visibleFrom: isoOrNull(row.visible_from),
    removeAt: isoOrNull(row.remove_at),
    retiredAt: isoOrNull(row.retired_at),
    publicOff: row.public_off === true,
    publicWithTab: row.public_with_tab === true,
    note: typeof row.note === "string" && row.note.trim() ? row.note.trim().slice(0, 300) : null,
    updatedAt: isoOrNull(row.updated_at),
    updatedBy: typeof row.updated_by_name === "string" ? row.updated_by_name : null,
  };
}

/** Gone for everyone right now: retired, past its remove date, or not yet
 *  at its show date. */
export function tabIsDown(rule: TabRule, now: number = Date.now()): boolean {
  if (rule.retiredAt) return true;
  if (rule.removeAt && now >= Date.parse(rule.removeAt)) return true;
  if (rule.visibleFrom && now < Date.parse(rule.visibleFrom)) return true;
  return false;
}

/** Retired, or its remove date has passed (NOT "not open yet"). */
export function tabIsGone(rule: TabRule, now: number = Date.now()): boolean {
  return !!rule.retiredAt || (!!rule.removeAt && now >= Date.parse(rule.removeAt));
}

function inGroups(a: TabAudience, who: TabWho): boolean {
  if (a.roles.includes(who.role)) return true;
  return a.functions.some((f) => who.functions.includes(f) || who.sub_functions.includes(f));
}

/** What the rule says for this person: show, hide, or null = the code's rule. */
export function tabOverride(
  rule: TabRule | undefined,
  who: TabWho,
  now: number = Date.now()
): TabOverride | null {
  if (!rule) return null;
  if (tabIsDown(rule, now)) return "hide";
  // a hide-only tab reads as if its show side had never been written
  const r: TabRule = tabCanWiden(rule.href)
    ? rule
    : { ...rule, show: EMPTY, base: rule.base === "everyone" ? "default" : rule.base };
  if (r.hide.members.includes(who.id)) return "hide";
  if (r.show.members.includes(who.id)) return "show";
  if (inGroups(r.hide, who)) return "hide";
  if (inGroups(r.show, who)) return "show";
  if (r.base === "everyone") return "show";
  if (r.base === "nobody") return "hide";
  return null;
}

/** Apply an override to the code's own answer. */
export function tabVisible(builtIn: boolean, override: TabOverride | null | undefined): boolean {
  return override === "show" ? true : override === "hide" ? false : builtIn;
}

/** The code's answer per module, as the layout computes it
 *  (`navFlagsFor` in lib/home-options.ts). */
export interface HomeNav {
  raising: boolean;
  dashboard: boolean;
  signups: boolean;
  consideration: boolean;
  cxp: boolean;
  tm: boolean;
  membership: boolean;
  planning: boolean;
  calendar: boolean;
}

/** WHERE HOME IS (v38.3) — "/" and the logo both land here, and the gate
 *  bounces an off-limits route here. ONE answer for all three, because three
 *  lists drifting apart is what left a member whose module tab was hidden on
 *  a blank page (the gate bounced to "/", "/" sent them to /accounts, which
 *  the gate bounced again).
 *
 *  Every candidate must be a page the code opens for them AND no rule hides
 *  (a rule can only take a module away here — a tab opened by a rule is a
 *  place they may go, not where they live; it comes after, in sidebar order).
 *  The last resort is a page every member keeps — never /accounts, which a
 *  non-raiser cannot open. */
export function homeRouteFor(
  nav: HomeNav,
  overrides: Record<string, TabOverride>,
  opts: { eb: boolean }
): string {
  const order: [string, boolean][] = [
    // THE EB STEERS (v33.12): the LCP and the LCVPs open on the numbers —
    // when they own a lane there at all
    ["/dashboard", opts.eb && nav.dashboard],
    ["/accounts", nav.raising],
    ["/signups", nav.signups],
    ["/consideration", nav.consideration],
    ["/cxp", nav.cxp],
    ["/members", nav.tm],
    ["/membership", nav.membership],
    ["/planning", nav.planning],
    ["/dashboard", nav.dashboard],
    ["/calendar", nav.calendar],
  ];
  const own = order.find(([href, builtIn]) => builtIn && tabVisible(builtIn, overrides[href]));
  if (own) return own[0];
  const granted = TAB_REGISTRY.find((t) => overrides[t.href] === "show");
  if (granted) return granted.href;
  return overrides["/attendance"] === "hide" ? "/profile" : "/attendance";
}

/** Every override for one person — what the layout hands the sidebar. Only
 *  tabs WITH a rule appear. */
export function tabOverridesFor(
  rules: TabRule[],
  who: TabWho,
  now: number = Date.now()
): Record<string, TabOverride> {
  const out: Record<string, TabOverride> = {};
  for (const r of rules) {
    const o = tabOverride(r, who, now);
    if (o) out[r.href] = o;
  }
  return out;
}

/** Is the public twin of this tab live? Off when switched off, or when it is
 *  set to follow the tab and the tab is retired / past its remove date. */
export function publicTwinLive(rule: TabRule | undefined, now: number = Date.now()): boolean {
  if (!rule) return true;
  if (rule.publicOff) return false;
  if (rule.publicWithTab && tabIsGone(rule, now)) return false;
  return true;
}

/** Does `pathname` belong to `href` (the tab itself or a page under it)? */
export function pathInTab(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** One line, in words, for the manager's list. */
export function describeRule(rule: TabRule | undefined, names: Map<string, string>, now = Date.now()): string {
  if (!rule) return "As the code says";
  if (rule.retiredAt) return "Retired — hidden from everyone";
  if (rule.removeAt && now >= Date.parse(rule.removeAt)) return "Removed (its remove date has passed)";
  const parts: string[] = [];
  // a hide-only tab ignores its show side, so the line does too
  const widen = tabCanWiden(rule.href);
  const base = !widen && rule.base === "everyone" ? "default" : rule.base;
  parts.push(base === "everyone" ? "Everyone" : base === "nobody" ? "Nobody" : "As the code says");
  const who = (a: TabAudience) =>
    [
      ...a.roles,
      ...a.functions,
      ...a.members.map((id) => names.get(id) ?? "a former member"),
    ];
  const plus = widen ? who(rule.show) : [];
  const minus = who(rule.hide);
  if (plus.length) parts.push(`+ ${plus.slice(0, 4).join(", ")}${plus.length > 4 ? ` +${plus.length - 4}` : ""}`);
  if (minus.length) parts.push(`− ${minus.slice(0, 4).join(", ")}${minus.length > 4 ? ` +${minus.length - 4}` : ""}`);
  if (rule.visibleFrom && now < Date.parse(rule.visibleFrom)) parts.push("opens later");
  if (rule.removeAt) parts.push("has a remove date");
  return parts.join(" · ");
}
