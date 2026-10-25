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
 *  A tab shown to someone the code would refuse OPENS the page for them, but
 *  the data inside still follows their role — the manager says so.
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
}

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
  { href: "/planning", label: "Planning", builtIn: "VPs, Directors, the LCP and admins" },
  { href: "/members", label: "Talent Management", builtIn: "TM, the LCP and admins" },
  { href: "/membership", label: "Membership", builtIn: "The EB (LCP + LCVPs) and admins" },
  { href: "/activation", label: "Activate 26' Bid", builtIn: "MMs and above", publicHref: "/activate26" },
  { href: "/war-room", label: "War Room", builtIn: "The F&L VP, the LCP and admins", publicHref: "/no-peace" },
  { href: "/attendance", label: "Attendance", builtIn: "Everyone" },
  { href: "/pdp", label: "PDP & O2O", builtIn: "Everyone the TM process touches" },
  { href: "/emails", label: "Emails", builtIn: "MMs and above" },
  { href: "/help", label: "Help", builtIn: "Everyone" },
  { href: "/lc-feedback", label: "LC Feedback", builtIn: "Everyone" },
  { href: "/admin", label: "Health & Logs", builtIn: "Admins" },
];

export const TAB_HREFS = new Set(TAB_REGISTRY.map((t) => t.href));

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
  if (rule.hide.members.includes(who.id)) return "hide";
  if (rule.show.members.includes(who.id)) return "show";
  if (inGroups(rule.hide, who)) return "hide";
  if (inGroups(rule.show, who)) return "show";
  if (rule.base === "everyone") return "show";
  if (rule.base === "nobody") return "hide";
  return null;
}

/** Apply an override to the code's own answer. */
export function tabVisible(builtIn: boolean, override: TabOverride | null | undefined): boolean {
  return override === "show" ? true : override === "hide" ? false : builtIn;
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
  parts.push(rule.base === "everyone" ? "Everyone" : rule.base === "nobody" ? "Nobody" : "As the code says");
  const who = (a: TabAudience) =>
    [
      ...a.roles,
      ...a.functions,
      ...a.members.map((id) => names.get(id) ?? "a former member"),
    ];
  const plus = who(rule.show);
  const minus = who(rule.hide);
  if (plus.length) parts.push(`+ ${plus.slice(0, 4).join(", ")}${plus.length > 4 ? ` +${plus.length - 4}` : ""}`);
  if (minus.length) parts.push(`− ${minus.slice(0, 4).join(", ")}${minus.length > 4 ? ` +${minus.length - 4}` : ""}`);
  if (rule.visibleFrom && now < Date.parse(rule.visibleFrom)) parts.push("opens later");
  if (rule.removeAt) parts.push("has a remove date");
  return parts.join(" · ");
}
