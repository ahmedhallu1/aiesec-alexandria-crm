import {
  FEEDBACK_INBOX_EMAILS,
  type AccountFunction,
  type Member,
  type TouchPointScope,
} from "./types";
import { expandTouchPointFns } from "./touch-points";

/** The RBAC engine. Every read is filtered through `accountScope` and every
 *  mutation is checked with a `can*` predicate — server-side, before any query.
 *
 *  LCP          absolute master access across the LC
 *  LCVP         EB — master authority within their function(s)
 *  Director     responsible for a function (e.g. B2C, BD) but NOT EB:
 *               function-level account authority, no EB powers
 *  Team Leader  own accounts + team accounts + reassignment inside the team
 *  Coordinator  own accounts only (no team management)
 *  Member       own accounts only
 *
 *  Admins (ADMIN_EMAILS, e.g. the IM director) are treated like LCP.
 *  Members can hold multiple functions (multi-select in the Membership sheet). */

export interface Viewer extends Member {
  isAdmin: boolean;
  /** ids of members whose stakeholder is this viewer (their direct team) */
  teamMemberIds: string[];
  /** set when an admin is test-viewing as this member ("View as" on profile) */
  impersonated?: boolean;
  /** sandbox test view: mutations are journaled and undone on exit, and
   *  outbound side effects (emails/notifications/calendar) are suppressed */
  sandbox?: boolean;
  /** the open test_sessions row backing the sandbox journal */
  sandboxSession?: string | null;
  /** test data (is_test accounts) is VISIBLE to this viewer — true during any
   *  test view and when the admin flips "Show test data" on /admin */
  testMode?: boolean;
}

export type AccountScope =
  | { kind: "all" }
  | { kind: "functions"; fns: AccountFunction[] }
  | { kind: "members"; ids: string[] };

/** Absolute, whole-LC visibility.
 *
 *  A PURE admin — Role = "Admin" on the sheet, no operational rank — is the
 *  system's caretaker and sees everything, same as the LCP. Someone who is a
 *  caretaker ON TOP of a real job (Admin in their Sub Function while they run
 *  a function) is NOT master: they keep their own modules and get the admin
 *  TOOLS only, via `canUseAdminTools`. ADMIN_EMAILS stays master as the
 *  break-glass account. */
const master = (v: Viewer) =>
  v.isAdmin || v.role === "LCP" || v.role === "Admin";

/** The admin TOOLS — Health & Logs, the test view, the change journal (v33).
 *
 *  Deliberately NOT the same thing as `master`. Someone can be the system's
 *  caretaker without being handed every function's data: an LCVP who also
 *  keeps the system running still sees only THEIR modules, plus these tools.
 *  Full cross-LC visibility stays with the LCP and with ADMIN_EMAILS (the IM
 *  director), so marking someone Admin on the sheet can never quietly widen
 *  who reads the whole LC. */
export function canUseAdminTools(v: Viewer): boolean {
  return v.isAdmin || v.role === "Admin" || (v.sub_functions ?? []).includes("Admin");
}

/** EB = LCP + LCVPs (Directors are explicitly NOT EB). */
export const isEb = (v: Viewer) => master(v) || v.role === "LCVP";

/** B2B raises for the WHOLE ICX (usually bulk deals of 3+ opens): B2B members
 *  add accounts as product "B2B" and each deal splits its opens across
 *  IGV / IGTa / IGTe. */
export function isB2B(v: Viewer): boolean {
  // the function is "B2B & BD" — one membership today, may split in future
  // peaks; either name grants the whole-ICX raising access
  const hit = (list: string[]) => list.includes("B2B") || list.includes("BD");
  return hit(v.functions) || hit(v.sub_functions);
}

/** The BD crew specifically (v32.6). BD shares a membership with B2B but sells
 *  a DIFFERENT thing — a money partnership, not opens — so its numbers are its
 *  own lane, and unlike B2B (which raises FOR the product functions and is
 *  therefore shown to their VPs) the BD lane is for the BD crew and the
 *  LCP/admin only. */
export function isBd(v: Viewer): boolean {
  return v.functions.includes("BD") || v.sub_functions.includes("BD");
}

/** The B2C crew (v23): partner accounts for courses / events / student
 *  activities — its own module, isolated from the ICX raising lanes. */
export function isB2C(v: Viewer): boolean {
  return v.functions.includes("B2C") || v.sub_functions.includes("B2C");
}

/** The viewer's OWN ICX product families. B2B/BD people live in their own
 *  B2B lane — they do NOT follow the whole ICX (v15 isolation). */
export function icxFunctions(v: Viewer): ("IGV" | "IGT")[] {
  return v.functions.filter((f): f is "IGV" | "IGT" => f === "IGV" || f === "IGT");
}

/** ACCOUNT visibility for VPs/Directors:
 *  - a leader sees their own function's accounts (Director of B2B → B2B only)
 *  - IGV/IGT VPs & Directors ALSO see B2B accounts (B2B raises for them). */
export function scopeFunctions(v: Viewer): AccountFunction[] {
  const fns: AccountFunction[] = v.functions.filter(
    (f): f is "IGV" | "IGT" => f === "IGV" || f === "IGT"
  );
  // B2B & BD accounts raise for every leader's function — both labels visible
  if (fns.length > 0 || isB2B(v)) fns.push("B2B", "BD");
  // B2C is its own island: only the B2C crew's leaders see it (v23)
  if (isB2C(v)) fns.push("B2C");
  return [...new Set(fns)];
}

/** LCVPs and Directors carry function-level authority over their function(s). */
const isIcxLead = (v: Viewer) =>
  (v.role === "LCVP" || v.role === "Director") && scopeFunctions(v).length > 0;

export function accountScope(v: Viewer): AccountScope {
  if (master(v)) return { kind: "all" };
  if (isIcxLead(v)) return { kind: "functions", fns: scopeFunctions(v) };
  if (v.role === "Team Leader")
    return { kind: "members", ids: [v.id, ...v.teamMemberIds] };
  return { kind: "members", ids: [v.id] };
}

/** Who sees the /planning tab: LCP/admin + VPs & Directors of any planned
 *  function (IGV/IGT + the OGX pair — the sheet covers all six product lanes).
 *  OGX VPs lack raising access, so /planning must also ride the GateClient
 *  `extra` prefixes for them (like /members does for TM). */
export function canSeePlanning(v: Viewer): boolean {
  if (master(v)) return true;
  if (v.role !== "LCVP" && v.role !== "Director") return false;
  return v.functions.some((f) => ["IGV", "IGT", "OGV", "OGT"].includes(f));
}

/** Whether the ICX Raising module is visible at all for this user. */
export function hasRaisingAccess(v: Viewer): boolean {
  if (master(v) || isIcxLead(v) || isB2B(v) || isB2C(v)) return true;
  return (
    icxFunctions(v).length > 0 &&
    v.sub_functions.some((s) => s === "Raising" || s === "ICX")
  );
}

/** Which functions this viewer may CREATE accounts for.
 *  B2B people add accounts as B2B (not IGV/IGT); IGV-only members cannot add
 *  IGT accounts and vice versa. Leaders create inside their visibility scope. */
export function allowedAccountFunctions(v: Viewer): AccountFunction[] {
  if (master(v)) return ["IGV", "IGT", "B2B", "BD", "B2C"];
  if (v.role === "LCVP" || v.role === "Director") return scopeFunctions(v);
  const fns: AccountFunction[] = v.functions.filter(
    (f): f is "IGV" | "IGT" => f === "IGV" || f === "IGT"
  );
  // B2B & BD crew pick per account which label it carries; B2C is its own
  if (isB2B(v)) fns.push("B2B", "BD");
  if (isB2C(v)) fns.push("B2C");
  return [...new Set(fns)];
}

type AccountLike = {
  function: string;
  responsible_id: string | null;
  out_of_process?: boolean;
};

/** In-scope accounts, plus (v22.2) EVERY archived account: the archive is the
 *  LC-wide blacklist — every member may open a dead name read-only to see who
 *  burned it and why before wasting a call on it. */
export function canViewAccount(v: Viewer, a: AccountLike): boolean {
  if (a.out_of_process) return true;
  return canEditAccount(v, a);
}

/** An account NOBODY owns, in a function this viewer may work (v32.4).
 *
 *  The imported market research landed unassigned, and a member who researched
 *  one had no way in: they couldn't open it, edit it or take it — only a
 *  leader could hand it over. Nothing is being taken from anyone here, so
 *  anyone who may create accounts in that function may claim it. */
export function isClaimableAccount(v: Viewer, a: AccountLike): boolean {
  if (a.responsible_id != null || a.out_of_process) return false;
  // v32.6 — CROSS-FUNCTION. An unowned account isn't "another function's": it
  // is nobody's. Whoever researched it may take it even if it sits under a
  // function they don't work, and taking it MOVES it to theirs (see
  // `claimAccount`).
  return canSeeUnassigned(v);
}

/** Who sees the UNOWNED pool at all (v33.2).
 *
 *  The imported market research — ~1,300 names nobody has taken — is a
 *  DISTRIBUTION problem, and distribution is an MM's job upward. A plain
 *  Member works the accounts they were given; burying those among a thousand
 *  unowned ones is how a member's own list stops being a to-do list. So:
 *  Team Leaders, Coordinators, Directors, VPs and the LCP — never Members. */
export function canSeeUnassigned(v: Viewer): boolean {
  if (v.role === "Member") return false;
  return master(v) || allowedAccountFunctions(v).length > 0;
}

/** Who gets the explicit "— Unassigned" filter option.
 *
 *  The same people who can SEE unowned accounts (v33.4). It was briefly
 *  narrower — VPs and above — which left an MM looking at unowned rows in
 *  their own list with no way to isolate them. If you can work them, you can
 *  filter them; if you can't see them at all, the option would return
 *  nothing. */
export function canFilterUnassigned(v: Viewer): boolean {
  return canSeeUnassigned(v);
}

/** Which function an account lands in when this viewer claims it. Their own
 *  if the account is already in one they work; otherwise their first allowed
 *  function — the research is theirs now, so the account follows. */
export function claimTargetFunction(
  v: Viewer,
  a: AccountLike
): AccountFunction | null {
  const allowed = allowedAccountFunctions(v);
  if (allowed.length === 0) return null;
  return allowed.includes(a.function as AccountFunction)
    ? (a.function as AccountFunction)
    : allowed[0];
}

/** THE ARCHIVE IS WORKABLE BY MMs, IN EVERY FUNCTION (v33.8).
 *
 *  An archived account is nobody's live work — it was written off. When a
 *  member doing market research turns up fresh information about one, the
 *  useful thing is for their MM to act on it there and then: revive it, move
 *  it to the function that can actually sell to them, hand it to someone.
 *  Making that a VP-only errand is how a good lead dies waiting.
 *
 *  Deliberately MMs and up, not everyone: resurrecting a company another
 *  function deliberately burned should be someone's decision, not a click any
 *  member can make by accident. Live accounts stay strictly scoped — this
 *  applies to archived rows only. */
export function canWorkArchived(v: Viewer, a: AccountLike): boolean {
  if (!a.out_of_process) return false;
  if (master(v) || isIcxLead(v)) return true;
  return (
    (v.role === "Team Leader" || v.role === "Coordinator") &&
    allowedAccountFunctions(v).length > 0
  );
}

/** Edit stays SCOPED (own/team/function) — the archive being world-readable
 *  never makes it world-editable, EXCEPT for the MMs above. */
export function canEditAccount(v: Viewer, a: AccountLike): boolean {
  if (canWorkArchived(v, a)) return true;
  const scope = accountScope(v);
  if (scope.kind === "all") return true;
  if (scope.kind === "functions") return scope.fns.includes(a.function as AccountFunction);
  // an unowned account in your function is open to you — that's how a member
  // who researched it adds what they found and takes it
  if (isClaimableAccount(v, a)) return true;
  return a.responsible_id != null && scope.ids.includes(a.responsible_id);
}

/** Responsibility: Team Leaders choose between themselves and their members;
 *  LCVPs/Directors inside their function; LCP anywhere. Plain members never. */
export function canReassignAccount(v: Viewer, a: AccountLike): boolean {
  if (master(v)) return true;
  // an archived account can be handed to anyone by an MM (v33.8)
  if (canWorkArchived(v, a)) return true;
  if (isIcxLead(v)) return scopeFunctions(v).includes(a.function as AccountFunction);
  // taking an unowned account needs no authority over anyone
  if (isClaimableAccount(v, a)) return true;
  if (v.role === "Team Leader")
    return a.responsible_id != null && [v.id, ...v.teamMemberIds].includes(a.responsible_id);
  return false;
}

/** Who a given viewer may reassign an account to. */
export function reassignTargetScope(v: Viewer): AccountScope {
  if (master(v)) return { kind: "all" };
  if (isIcxLead(v)) return { kind: "functions", fns: scopeFunctions(v) };
  if (v.role === "Team Leader")
    return { kind: "members", ids: [v.id, ...v.teamMemberIds] };
  return { kind: "members", ids: [] };
}

/** The Archived tab is open to EVERYONE (v22.2) — the archive is the shared
 *  blacklist and members must be able to check a name before working it. */
export function canViewArchive(): boolean {
  return true;
}

/** Managing the archive (add/import names) stays with leaders. */
export function canManageArchive(v: Viewer): boolean {
  return master(v) || isIcxLead(v) || v.role === "Team Leader";
}

/** The TM (Talent Management) module: the whole-LC members directory with
 *  per-member KPIs/MOS and contact shortcuts. TM function + LCP + admin. */
export function hasTmAccess(v: Viewer): boolean {
  return (
    master(v) || v.functions.includes("TM") || v.sub_functions.includes("TM")
  );
}

/** TM's own crew — the people who run LC-wide touch points and own the
 *  attendance system end to end (VP/Director/TL/Coordinator of TM). */
export function isTmCore(v: Viewer): boolean {
  return (
    master(v) ||
    ((v.functions.includes("TM") || v.sub_functions.includes("TM")) &&
      ["LCVP", "Director", "Team Leader", "Coordinator"].includes(v.role))
  );
}

/** Which touch-point scopes THIS viewer may book (v29.3) — ONE scope per role,
 *  no overlap:
 *
 *    Team Leader   → team points ONLY (their own team; sibling teams of their
 *                    own function can be invited)
 *    LCVP/Director → function points ONLY (their own function; another
 *                    function can be invited). A VP does NOT book a team's
 *                    touch point — that is the Team Leader's call.
 *    TM core       → LC points ONLY. TM runs the LC's touch points; it does
 *                    not book for a function or for a team.
 *    LCP / admin   → everything, as always.
 *
 *  The order matters: a TM VP is TM core FIRST (lc), not an LCVP (function). */
export function bookableTouchPointScopes(v: Viewer): TouchPointScope[] {
  if (master(v)) return ["team", "function", "lc"];
  if (isTmCore(v)) return ["lc"];
  if (v.role === "LCVP" || v.role === "Director") return ["function"];
  if (v.role === "Team Leader") return ["team"];
  return [];
}

export function canBookTouchPoint(v: Viewer, scope: TouchPointScope): boolean {
  return bookableTouchPointScopes(v).includes(scope);
}

export interface TouchPointRef {
  scope: TouchPointScope;
  function_key: string | null;
  team_name: string | null;
  owner_id: string | null;
}

/** Edit / cancel a touch point: its owner, the function's VP/Director for a
 *  team or function point, TM core for LC points, LCP/admin always. */
export function canEditTouchPoint(v: Viewer, tp: TouchPointRef): boolean {
  if (master(v)) return true;
  if (tp.owner_id && tp.owner_id === v.id) return true;
  if (tp.scope === "lc") return isTmCore(v);
  const tpFns = expandTouchPointFns(tp.function_key ? [tp.function_key] : []);
  const inFn = [...v.functions, ...v.sub_functions].some((f) => tpFns.has(f));
  return (v.role === "LCVP" || v.role === "Director") && inFn;
}

/** Record / edit attendance. Team point → its Team Leader (+ the function's
 *  VP/Director, TM core). Function point → the VP/Director and its MMs (never
 *  their OWN row — see canEditOwnAttendanceRow), TM core. LC point → TM core
 *  only. */
export function canRecordAttendance(v: Viewer, tp: TouchPointRef): boolean {
  if (master(v) || isTmCore(v)) return true;
  if (tp.scope === "lc") return false;
  const tpFns = expandTouchPointFns(tp.function_key ? [tp.function_key] : []);
  const fnMatch = [...v.functions, ...v.sub_functions].some((f) => tpFns.has(f));
  if (tp.scope === "function")
    return fnMatch && ["LCVP", "Director", "Team Leader", "Coordinator"].includes(v.role);
  if (tp.owner_id === v.id) return true;
  return fnMatch && ["LCVP", "Director"].includes(v.role);
}

/** Nobody marks THEMSELF present on a point they only got edit rights to —
 *  the owner (and TM core) still can, so a TL can record their own team. */
export function canEditOwnAttendanceRow(v: Viewer, tp: TouchPointRef): boolean {
  return master(v) || isTmCore(v) || tp.owner_id === v.id;
}

/* The B2B/BD "Podio pending" worklist was RETIRED in v32.3 — the filter, the
   inline request-state select and "Ask to submit" are gone, and B2B/BD now
   behave exactly like every other function. `canRequestPodioSubmit` went with
   it; the account page's own Request State card still covers the real need. */

/** Request State (Podio) is filled by TL / Coordinator / VP — and by anyone
 *  the EB has tagged **has_podio** (v33.2).
 *
 *  Podio access is a real thing a person either holds or doesn't: some members
 *  do the LC's submissions themselves and were locked out of recording what
 *  came back, while a Coordinator with no Podio login could set a state they
 *  had no way to know. Tying the authority to the ACCESS rather than the rank
 *  is the honest model — it's the same move as Admin in v33. A tagged member
 *  still only touches accounts they can already edit. */
export function canEditRequestState(v: Viewer, a: AccountLike): boolean {
  if (master(v) || (isIcxLead(v) && scopeFunctions(v).includes(a.function as AccountFunction)))
    return true;
  if (v.role === "Team Leader")
    return a.responsible_id != null && [v.id, ...v.teamMemberIds].includes(a.responsible_id);
  if (v.role === "Coordinator" && a.responsible_id === v.id) return true;
  return hasPodioAccess(v) && a.responsible_id === v.id;
}

/** The membership tag itself: does this person hold the LC's Podio access?
 *  Only meaningful for the functions that submit partners at all. */
export function hasPodioAccess(v: {
  has_podio?: boolean | null;
  functions?: string[] | null;
  sub_functions?: string[] | null;
}): boolean {
  if (!v.has_podio) return false;
  const own = [...(v.functions ?? []), ...(v.sub_functions ?? [])];
  return ["IGV", "IGT", "B2B", "BD", "B2C"].some((f) => own.includes(f));
}

/** May this viewer set a Request State AS THEY CREATE an account? Same people
 *  who could set it afterwards — asking them to save, reopen and edit was
 *  busywork when they already know the answer (v33.2). */
export function canSetRequestStateOnCreate(v: Viewer): boolean {
  return (
    master(v) ||
    isIcxLead(v) ||
    v.role === "Team Leader" ||
    v.role === "Coordinator" ||
    hasPodioAccess(v)
  );
}

/** THE INCOMING (IGT) EXPECTATION MAIL (v33.3) — the IGT function's leaders
 *  only. It is the LC's formal promise to an incoming EP (visa, pickup,
 *  accommodation, departure support), so it is signed by whoever is
 *  accountable for those standards, not by whoever happens to be online. */
export function canUseIgtExpectationMail(v: Viewer): boolean {
  if (master(v)) return true;
  if (v.role !== "LCVP" && v.role !== "Director") return false;
  return icxFunctions(v).includes("IGT");
}

/** Numbered comments carry the author's label at the time of writing. */
export function commentLabel(v: Viewer): "Member" | "TL" | "VP" | "Director" | "LCP" | "Admin" {
  if (v.role === "LCP") return "LCP";
  if (v.isAdmin) return "Admin"; // the IM director is Admin, not the LCP
  if (v.role === "LCVP") return "VP";
  if (v.role === "Director") return "Director"; // a Director is NOT a VP
  if (v.role === "Team Leader") return "TL";
  return "Member";
}

/** Membership management: EB (LCP + LCVPs) and admins — NOT Directors. */
export function canManageMembership(v: Viewer): boolean {
  // TM's MMs too (v33.5): keeping the membership sheet true — who is active,
  // whose manager is whom, which team someone sits in — IS Talent Management's
  // job, and routing every correction through an LCVP made the register drift
  // between imports. TM's Team Leaders and Coordinators, not its members.
  const tmMm =
    hasTmAccess(v) && (v.role === "Team Leader" || v.role === "Coordinator");
  return isEb(v) || tmMm;
}

// ------------------------------------------------------------------ OGX (v25)

import type { OgxFunction } from "./types";
import type { SignupRow } from "./types";

/** Which OGX functions this viewer works: OGT / OGV (functions OR
 *  sub_functions; LCP + admin see both). */
export function ogxFunctions(v: Viewer): OgxFunction[] {
  if (v.isAdmin || v.role === "LCP") return ["OGT", "OGV"];
  const all = [...(v.functions ?? []), ...(v.sub_functions ?? [])];
  const out: OgxFunction[] = [];
  if (all.includes("OGT")) out.push("OGT");
  if (all.includes("OGV")) out.push("OGV");
  return out;
}

export function hasOgxAccess(v: Viewer): boolean {
  return ogxFunctions(v).length > 0;
}

/** OGX DASHBOARD lanes (v32). Same split as consideration: the LC-wide
 *  overseers read every OGX lane, but `ogxFunctions` — which gates the
 *  sign-ups module and every per-sign-up permission — stays with the OGX
 *  crews, so nobody gains the right to work a sign-up by overseeing it. */
export function ogxLanes(v: Viewer): OgxFunction[] {
  return seesEveryLane(v) ? ["OGT", "OGV"] : ogxFunctions(v);
}

/** OGX leaders (VP/Director of the sign-up's function + LCP/admin) own the
 *  VP-only fields: VP comments, Country, Sub Product, Status, Out of Process. */
export function canEditSignupVpFields(v: Viewer, s: { fn: OgxFunction }): boolean {
  if (v.isAdmin || v.role === "LCP") return true;
  return (
    (v.role === "LCVP" || v.role === "Director") && ogxFunctions(v).includes(s.fn)
  );
}

/** Member-level edits (contact status, interested, comments): the assigned
 *  member, their Team Leader, the function's VP/Director, LCP/admin. */
export function canWorkSignup(v: Viewer, s: SignupRow): boolean {
  if (!ogxFunctions(v).includes(s.fn)) return false;
  if (canEditSignupVpFields(v, s)) return true;
  if (s.assigned_to && s.assigned_to === v.id) return true;
  if (v.role === "Team Leader" && s.assigned_to && v.teamMemberIds.includes(s.assigned_to))
    return true;
  return false;
}

/** Viewing: leaders see the whole function; a TL their team; everyone their
 *  own + the UNASSIGNED pool (the main view — contact one, claim it). */
export function canViewSignup(v: Viewer, s: SignupRow): boolean {
  if (!ogxFunctions(v).includes(s.fn)) return false;
  if (canEditSignupVpFields(v, s)) return true;
  if (!s.assigned_to) return true;
  return canWorkSignup(v, s);
}

/** The LC-wide overseers (v32): the LCP/admin plus the TM and F&L leadership.
 *  TM reviews every member's performance and F&L every function's money, so
 *  BOTH sides of every function's dashboard are open to them — even though
 *  neither owns a raising or consideration module of their own. */
export function seesEveryLane(v: Viewer): boolean {
  if (master(v)) return true;
  if (v.role !== "LCVP" && v.role !== "Director") return false;
  return [...(v.functions ?? []), ...(v.sub_functions ?? [])].some(
    (f) => f === "TM" || f === "F&L"
  );
}

/** Which SIDE of a function a viewer works (v32).
 *
 *  A member / coordinator / team leader gets exactly the side their Sub
 *  Function column names — "Raising" people see the raising lanes,
 *  "Consideration" people the consideration lanes, and anyone carrying both
 *  labels sees both. An LCVP or Director owns their whole function, so they
 *  always get BOTH sides. ("ICX" is the legacy catch-all for raising.) */
function worksSide(v: Viewer, side: "Raising" | "Consideration"): boolean {
  // a leader owns both sides of the PRODUCT function they lead — being a B2C
  // or BD Director must never hand out IGV/IGT consideration
  if (
    (v.role === "LCVP" || v.role === "Director") &&
    icxFunctions(v).length > 0
  )
    return true;
  const subs = v.sub_functions ?? [];
  return side === "Raising"
    ? subs.includes("Raising") || subs.includes("ICX")
    : subs.includes("Consideration");
}

/** The product functions whose RAISING lanes this viewer follows. Nobody ever
 *  sees the other product's dashboard: an IGV person gets IGV lanes only. */
export function raisingFunctions(v: Viewer): ("IGV" | "IGT")[] {
  if (seesEveryLane(v)) return ["IGV", "IGT"];
  return worksSide(v, "Raising") ? icxFunctions(v) : [];
}

/** …and the CONSIDERATION lanes, by the same rule. Before v32 anyone carrying
 *  the Consideration label got BOTH products' lanes; now an IGV consideration
 *  member sees IGV Consideration and nothing of IGT. */
export function considerationFunctions(v: Viewer): ("IGV" | "IGT")[] {
  if (seesEveryLane(v)) return ["IGV", "IGT"];
  if (!worksSide(v, "Consideration")) return [];
  const fns = icxFunctions(v);
  // a consideration person the sheet attaches to NO product (empty Function
  // column) belongs to neither side, so "the other function" doesn't apply —
  // they keep both lanes rather than being locked out of their own module
  return fns.length > 0 ? fns : ["IGV", "IGT"];
}

/** The Consideration MODULE (v26): IR calls with partner LCs + the CV pool.
 *  Deliberately NOT `considerationFunctions().length > 0` — the TM and F&L
 *  leadership read every consideration DASHBOARD, but the module itself (and
 *  the partner-LC/CV working data behind it) stays with the people who
 *  actually run it. */
export function hasConsiderationAccess(v: Viewer): boolean {
  if (master(v)) return true;
  return worksSide(v, "Consideration");
}

/** The CV pool inside Consideration is an IGT hunt (v27): companies want
 *  talent, not volunteers. LCP/admin, the Consideration crew, and IGT
 *  LCVPs/Directors see it — an IGV-only VP gets just the IR-calls tab. */
export function canSeeCvPool(v: Viewer): boolean {
  if (master(v)) return true;
  // IGT ONLY (v32.8). Companies hiring through us want TALENT, not volunteers,
  // so the CV pool is an IGT instrument — an IGV consideration member has no
  // use for it and shouldn't be reading applicants' CVs. Every role inside IGT
  // gets it; a consideration person attached to no product keeps it too, since
  // they aren't "the IGV side" of anything.
  if (v.functions.includes("IGT")) return true;
  const consideration =
    v.functions.includes("Consideration") || v.sub_functions.includes("Consideration");
  return consideration && icxFunctions(v).length === 0;
}

/** The LC-PEOPLE concerns inbox (v32.8): the LCP and the TM leadership.
 *  A concern about a person is a people-management matter, so TM's VP/Director
 *  sees it, gets the email and the bell, and can work it — same as the LCP.
 *  Nobody else, ever: this is the private channel. */
export function canSeeLcConcerns(v: Viewer): boolean {
  if (v.isAdmin || v.role === "LCP") return true;
  return (
    (v.role === "LCVP" || v.role === "Director") &&
    [...(v.functions ?? []), ...(v.sub_functions ?? [])].includes("TM")
  );
}

/** Feedback inbox: ONLY the IM director (admin) and the IM coach. */
export function canSeeFeedbackInbox(v: Viewer): boolean {
  const email = (v.email ?? "").toLowerCase();
  return v.isAdmin || (FEEDBACK_INBOX_EMAILS as readonly string[]).includes(email);
}
