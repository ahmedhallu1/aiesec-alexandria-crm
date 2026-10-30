/** THE RULE MANAGER (v38.4) — pure, client-safe.
 *
 *  Settings → Tabs decides WHICH PAGES a person can open. This decides WHAT
 *  THEY MAY DO once they are on one. Both work the same way and for the same
 *  reason: every rule in Sodio is written in code (rbac.ts), and until now
 *  changing one — "let Members bring an account back from the archive" —
 *  meant an edit, a commit and a deploy, for a decision the LCP is perfectly
 *  able to make on a Tuesday.
 *
 *  Each privilege below names ONE predicate in `rbac.ts`. Its built-in
 *  answer stands until a `privilege_rules` row overrides it:
 *
 *    - base: "as the code says" / "everyone" / "nobody";
 *    - allow: roles, functions or named people who get it anyway;
 *    - deny:  roles, functions or named people who never do.
 *
 *  PRECEDENCE, first match wins (identical to the tab manager, deliberately:
 *  two permission screens that resolve differently is a trap):
 *    1. this PERSON is named → their side (deny beats allow)
 *    2. their ROLE or FUNCTION is named → that side (deny beats allow)
 *    3. the base: everyone → yes · nobody → no · default → the code
 *
 *  WHAT AN OVERRIDE CANNOT DO. A privilege widens one decision, never the
 *  scope behind it: a Member granted `archive.revive` may revive accounts,
 *  but still only the ones the archive already shows them, and granting
 *  `account.reassign` lets someone hand on an account they can already edit,
 *  not reach into another team's. Every rule's `what` line says exactly what
 *  saying yes hands over, and the manager prints it before you save.
 */

import { cleanAudience, type TabAudience } from "./tabs";

export type PrivilegeBase = "default" | "everyone" | "nobody";
/** the same {members, roles, functions} shape the tab rules use */
export type PrivilegeAudience = TabAudience;

export interface PrivilegeRule {
  key: string;
  base: PrivilegeBase;
  allow: PrivilegeAudience;
  deny: PrivilegeAudience;
  note: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface PrivilegeDef {
  key: string;
  /** the card's heading, in the LC's own words */
  label: string;
  /** which screen this is about — the manager groups by it */
  group: "Archive" | "Accounts" | "Deals & Podio" | "Consideration" | "Across the LC";
  /** who gets it when no rule is set, in words */
  builtIn: string;
  /** what saying yes actually hands a person — printed under the switch */
  what: string;
  /** rules that can take something away but should be widened with care */
  caution?: string;
}

/** EVERY SWITCHABLE RULE. A predicate that is not in this list is not
 *  switchable — adding one means a row here AND the `priv()` call in
 *  rbac.ts, which `tests/privileges.test.ts` pins. */
export const PRIVILEGE_REGISTRY: PrivilegeDef[] = [
  // ----------------------------------------------------------- the archive
  {
    key: "archive.revive",
    label: "Bring an account back from the archive",
    group: "Archive",
    builtIn: "Team Leaders and Coordinators, their Directors/VPs, the LCP and admins",
    what: "They can revive an archived account and work it — the archive is already readable by the whole LC, so this is the decision to reopen one, not permission to see it.",
    caution:
      "An archived account becomes editable to whoever may revive it, whichever function burned it.",
  },
  {
    key: "archive.manage",
    label: "Add or import names into the archive",
    group: "Archive",
    builtIn: "Team Leaders and above",
    what: "They can blacklist a name that was burned before the CRM existed, one at a time or from a file, and VPs can lift an entry.",
  },
  {
    key: "archive.purge",
    label: "Delete archived accounts for good",
    group: "Archive",
    builtIn: "Team Leaders and Coordinators and above",
    what: "They can permanently remove archived accounts, which frees the names to be added again. It cascades through contacts, visits and deals and cannot be undone.",
    caution: "There is no undo, and the sandbox refuses it outright.",
  },
  // -------------------------------------------------------------- accounts
  {
    key: "account.claim",
    label: "Take an unowned account from the pool",
    group: "Accounts",
    builtIn: "Anyone who raises for the account's function",
    what: "They can claim a researched account that nobody owns and make the research theirs.",
  },
  {
    key: "account.reassign",
    label: "Hand an account to somebody else",
    group: "Accounts",
    builtIn: "Team Leaders and Coordinators (their own and their people's), VPs/Directors in their function, the LCP",
    what: "They can change an account's Responsible — only on accounts they can already edit. It never reaches into another team's rows.",
  },
  {
    key: "account.deleteWorked",
    label: "Delete an account that has history",
    group: "Accounts",
    builtIn: "VPs, Directors, the LCP and admins",
    what: "Deleting an EMPTY account is already anyone's to do. This is the one with contacts, visits or deals on it — the delete takes those with it, for good.",
    caution: "There is no undo, and the sandbox refuses it outright.",
  },
  {
    key: "account.import",
    label: "Import accounts from a file",
    group: "Accounts",
    builtIn: "Everyone who can add accounts",
    what: "They can open /accounts/import and add up to 500 rows at once. Every row still passes the same checks a manual add does.",
  },
  {
    key: "visit.direct",
    label: "Log a direct (walk-in) visit",
    group: "Accounts",
    builtIn: "Everyone who can add accounts",
    what: "They can record a visit they already made at the door — it writes the research, the contact and the visit in one act.",
  },
  // -------------------------------------------------------- deals & Podio
  {
    key: "deal.cancelOthers",
    label: "Cancel somebody else's deal",
    group: "Deals & Podio",
    builtIn: "VPs, Directors and the LCP (a member may always cancel their own)",
    what: "They can cancel a recorded deal that belongs to another member. The opens come off the lane and off that person's numbers.",
  },
  {
    key: "deal.split",
    label: "Split a deal's opens across members",
    group: "Deals & Podio",
    builtIn: "Everyone who can record a deal",
    what: "The Record-deal popup offers the split switch, which decides whose numbers the opens land on.",
  },
  {
    key: "podio.stateOnCreate",
    label: "Set the Podio state while adding an account",
    group: "Deals & Podio",
    builtIn: "The function's MMs, Directors/VPs, the LCP and admins",
    what: "The add-account form offers Checking / Approved instead of leaving the account for the Podio worklist.",
  },
  // --------------------------------------------------------- consideration
  {
    key: "ir.manageTeamCalls",
    label: "Work an IR call hosted by one of your people",
    group: "Consideration",
    builtIn: "Team Leaders and Coordinators, over the people their MM access reaches",
    what: "They can fill the notes, request a reschedule, fix a bounced IR email and cancel a call hosted by someone they manage. Deleting a log is never included — that stays with the host and the VPs.",
  },
  {
    key: "ir.handover",
    label: "Hand a booked IR call to another host",
    group: "Consideration",
    builtIn: "Team Leaders and Coordinators and above",
    what: "They can move a booked call to a different host, keeping the time. The new host's calendar is checked for a clash and the IR is told.",
  },
  {
    key: "ir.recordManual",
    label: "Record a past IR call by hand",
    group: "Consideration",
    builtIn: "Everyone in the consideration module",
    what: "They can log a call that was never booked through Sodio, which is what the module's numbers are built from.",
  },
  {
    key: "lc.manage",
    label: "Add or remove a partner LC",
    group: "Consideration",
    builtIn: "Team Leaders and Coordinators and above",
    what: "They can edit the shared partner-LC registry every call, CV and partnership hangs off.",
  },
  {
    key: "partnership.assignOthers",
    label: "Hand a partnership target to somebody else",
    group: "Consideration",
    builtIn: "Team Leaders and Coordinators and above",
    what: "They can give out, clear and move another person's 🎯 target. Taking one yourself needs nothing — that is everyone's.",
  },
  // --------------------------------------------------------- across the LC
  {
    key: "account.unownedPool",
    label: "See the unowned research pool",
    group: "Across the LC",
    builtIn: "Team Leaders and Coordinators, the IGV/IGT/B2B/BD VPs and Directors, the LCP",
    what: "They see the imported market research nobody owns — the “— Unassigned” filter and the pool rows — and can take one. Distribution is an MM's job by default; this is the switch that makes it everyone's.",
    caution:
      "A Member's own list is their to-do list. Hundreds of unowned rows mixed into it is what this default exists to prevent.",
  },
];

export const PRIVILEGE_KEYS = new Set(PRIVILEGE_REGISTRY.map((p) => p.key));

export const PRIVILEGE_GROUPS: PrivilegeDef["group"][] = [
  "Archive",
  "Accounts",
  "Deals & Podio",
  "Consideration",
  "Across the LC",
];

/** The person a rule is checked against — the same shape the tab rules use. */
export interface PrivilegeWho {
  id: string;
  role: string;
  functions: string[];
  sub_functions: string[];
}

export type PrivilegeOverride = "allow" | "deny";

const EMPTY: PrivilegeAudience = { members: [], roles: [], functions: [] };

/** A DB row (snake_case) → a PrivilegeRule. Unknown shapes fall to safe
 *  values, and an unknown key keeps its row so nothing is silently dropped
 *  when a rule is renamed (the resolver ignores it). */
export function privilegeFromRow(row: Record<string, unknown>): PrivilegeRule {
  const base = row.base === "everyone" || row.base === "nobody" ? row.base : "default";
  return {
    key: String(row.key ?? ""),
    base,
    allow: cleanAudience(row.allow_to),
    deny: cleanAudience(row.deny_from),
    note:
      typeof row.note === "string" && row.note.trim() ? row.note.trim().slice(0, 300) : null,
    updatedAt:
      typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at))
        ? new Date(row.updated_at).toISOString()
        : null,
    updatedBy: typeof row.updated_by_name === "string" ? row.updated_by_name : null,
  };
}

function inGroups(a: PrivilegeAudience, who: PrivilegeWho): boolean {
  if (a.roles.includes(who.role)) return true;
  return a.functions.some((f) => who.functions.includes(f) || who.sub_functions.includes(f));
}

/** What the rule says for this person: allow, deny, or null = the code's own
 *  answer. An unknown key never resolves — a rule for a privilege that no
 *  longer exists cannot change anything. */
export function privilegeOverride(
  rule: PrivilegeRule | undefined,
  who: PrivilegeWho
): PrivilegeOverride | null {
  if (!rule || !PRIVILEGE_KEYS.has(rule.key)) return null;
  if (rule.deny.members.includes(who.id)) return "deny";
  if (rule.allow.members.includes(who.id)) return "allow";
  if (inGroups(rule.deny, who)) return "deny";
  if (inGroups(rule.allow, who)) return "allow";
  if (rule.base === "everyone") return "allow";
  if (rule.base === "nobody") return "deny";
  return null;
}

/** Apply an override to the code's own answer. */
export function privilegeAllowed(
  builtIn: boolean,
  override: PrivilegeOverride | null | undefined
): boolean {
  return override === "allow" ? true : override === "deny" ? false : builtIn;
}

/** Every override for one person — resolved once per request and carried on
 *  the Viewer, so the sync predicates in rbac.ts can read it. */
export function privilegeOverridesFor(
  rules: PrivilegeRule[],
  who: PrivilegeWho
): Record<string, PrivilegeOverride> {
  const out: Record<string, PrivilegeOverride> = {};
  for (const r of rules) {
    const o = privilegeOverride(r, who);
    if (o) out[r.key] = o;
  }
  return out;
}

/** Has this rule been changed from the code's own answer at all? */
export function privilegeIsDefault(rule: PrivilegeRule | undefined): boolean {
  if (!rule) return true;
  return (
    rule.base === "default" &&
    rule.allow.members.length === 0 &&
    rule.allow.roles.length === 0 &&
    rule.allow.functions.length === 0 &&
    rule.deny.members.length === 0 &&
    rule.deny.roles.length === 0 &&
    rule.deny.functions.length === 0
  );
}

/** One line, in words, for the manager's list. */
export function describePrivilege(
  rule: PrivilegeRule | undefined,
  names: Map<string, string>
): string {
  if (privilegeIsDefault(rule)) return "As the code says";
  const r = rule!;
  const parts: string[] = [
    r.base === "everyone" ? "Everyone" : r.base === "nobody" ? "Nobody" : "As the code says",
  ];
  const who = (a: PrivilegeAudience) => [
    ...a.roles,
    ...a.functions,
    ...a.members.map((id) => names.get(id) ?? "a former member"),
  ];
  const plus = who(r.allow);
  const minus = who(r.deny);
  if (plus.length)
    parts.push(`+ ${plus.slice(0, 4).join(", ")}${plus.length > 4 ? ` +${plus.length - 4}` : ""}`);
  if (minus.length)
    parts.push(`− ${minus.slice(0, 4).join(", ")}${minus.length > 4 ? ` +${minus.length - 4}` : ""}`);
  return parts.join(" · ");
}

export { EMPTY as EMPTY_PRIVILEGE_AUDIENCE };
