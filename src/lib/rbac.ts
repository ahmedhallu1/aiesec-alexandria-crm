import {
  FEEDBACK_INBOX_EMAILS,
  type AccountFunction,
  type Member,
  type TouchPointScope,
  LC_FUNCTIONS,
} from "./types";
import { expandTouchPointFns } from "./touch-points";
import { functionDefaults, type FunctionSettings } from "./function-settings";

/** A function's defaults as this request resolved them — falling back to the
 *  built-in behaviour, so a viewer assembled before v33.32 (or in a test)
 *  behaves exactly as it used to. */
export function fnSetting(v: Viewer, fn: string): FunctionSettings {
  return v.fnSettings?.[fn] ?? functionDefaults(fn);
}

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
  /** WHOSE WORK THIS MM REACHES, as their VP set it (v37.4, Settings → My
   *  function → MM access). Undefined = nothing set → the role rule
   *  (`reachIds` below). Never read this directly — ask `reachIds`. */
  reachMemberIds?: string[];
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
  /** FUNCTIONS THIS VIEWER MAY READ IN FULL (v33.32, migration 0054).
   *
   *  A function's LCVP/Director can open their floor to a role — "my Members
   *  may see every account in IGV" — from the Function defaults card. It is a
   *  READ widening only: `canEditAccount` is untouched, so ownership, the
   *  inline editors and every mutation stay exactly as scoped as before.
   *  Resolved once per request in getViewer; empty for everyone by default. */
  openViewFns?: string[];
  /** every function's resolved defaults (v33.32) — read once per request so
   *  the sync predicates below can consult them without touching the DB */
  fnSettings?: Record<string, FunctionSettings>;
}

export type AccountScope =
  | { kind: "all" }
  | { kind: "functions"; fns: AccountFunction[] }
  | { kind: "members"; ids: string[] };

/** LEADS INFORMATION MANAGEMENT — the function that owns this system (v33.22).
 *
 *  Whole-LC access follows the JOB, not the person: whoever leads IM keeps
 *  Sodio running, which means reading every function's data to diagnose it.
 *  A future IM director inherits it by appearing on the membership sheet —
 *  no env var to change, no redeploy. */
const leadsIm = (v: Viewer) =>
  (v.role === "Director" || v.role === "LCVP") &&
  [...(v.functions ?? []), ...(v.sub_functions ?? [])].includes("IM");

/** Absolute, whole-LC visibility.
 *
 *  ROLE = "Admin" IS NOT THIS (v33.22, by the IM director's own call). An
 *  admin is the system's caretaker — Health, the logs, the change journal —
 *  and that is a capability, not a rank: it must not quietly hand someone
 *  every function's accounts, sign-ups and people-feedback. Full access is
 *  the IM LEADER's (`leadsIm`), plus the LCP, plus ADMIN_EMAILS as the
 *  break-glass account.
 *
 *  F&L (v33.16, by the LCP's request): the Finance & Legality crew audits
 *  every function's money and commitments, so the whole F&L FUNCTION gets
 *  LCP-level access — every module, every lane, every account. Two things
 *  deliberately do NOT follow: the admin tools (canUseAdminTools) and F&L
 *  people stay un-assignable as account responsibles (ACCOUNT_WORLD_FNS) —
 *  they see everything, they own nothing. */
export const master = (v: Viewer) =>
  v.isAdmin || v.role === "LCP" || leadsIm(v) ||
  (v.functions ?? []).includes("F&L");

/** THE EMAILS TAB (v33.24) — MMs and above. Writing to a partner or another
 *  entity on the LC's behalf is a responsibility that comes with the job;
 *  a first-week member has no letters to send yet. */
export function canUseMailboxTab(v: Viewer): boolean {
  // EVERY MEMBER WRITES (v33.41). It opened to MMs and above because writing
  // on behalf of the LC felt like an MM's job — but a member reaching their
  // own partner, EP or LC was then doing it from a blank Gmail with no
  // signature, which is exactly what this tab exists to stop. The letter goes
  // out from their OWN Gmail either way, so nobody gains reach they didn't
  // already have; what they gain is the LC's stationery. Which STARTING
  // POINTS they see is a separate question — `templatesFor` answers it.
  void v;
  return true;
}

/** The admin TOOLS — Health & Logs, the test view, the change journal (v33).
 *
 *  Deliberately NOT the same thing as `master`. Someone can be the system's
 *  caretaker without being handed every function's data: an LCVP who also
 *  keeps the system running still sees only THEIR modules, plus these tools;
 *  and since v33.22 a pure Role = "Admin" is exactly that — the tools and
 *  nothing else. Sub-function "Admin" still counts, for the membership sheets
 *  that carried it before the Sub Function column was emptied outside ICX. */
export function canUseAdminTools(v: Viewer): boolean {
  return v.isAdmin || v.role === "Admin" || (v.sub_functions ?? []).includes("Admin");
}

/** THE LC TOOLS (v37.2) — starting a new term or peak, restarting the
 *  membership, pointing Sodio at the term's planning, where membership lives.
 *  The LCP and the admins, as the LC decided — nobody else, not even the EB. */
export function canRunLcTools(v: Viewer): boolean {
  return v.isAdmin || v.role === "LCP" || canUseAdminTools(v);
}

/** THE ACTIVATE 26' BID (v36.8) — MMs and above: Coordinators, Team Leaders,
 *  Directors, LCVPs and the LCP (plus the admin). A plain Member neither sees
 *  the tab nor edits the plan; the public copy at /activate26 stays open to
 *  anyone with the link, members included. */
export function canSeeActivationBid(v: Viewer): boolean {
  return master(v) || v.role !== "Member";
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

/** THE PEOPLE WHOSE WORK AN MM REACHES (v37.4).
 *
 *  The role rule, unless the function's VP set something for this MM in
 *  Settings → My function → MM access: a Team Leader reaches their direct
 *  team, a Coordinator nobody but themself — and the VP can widen either to
 *  the whole function, or narrow a Team Leader to "only themself" (the
 *  LC's way of turning a TL into a Coordinator without touching the sheet).
 *
 *  Every ACCESS check that used to read `v.role === "Team Leader" &&
 *  v.teamMemberIds` reads this instead. Structural things — the team card,
 *  the team plan, the team leaderboard, attendance and PDP — still follow the
 *  Manager column, because who reports to whom did not change. */
export function reachIds(v: Viewer): string[] {
  if (v.role !== "Team Leader" && v.role !== "Coordinator") return [];
  return v.reachMemberIds ?? (v.role === "Team Leader" ? v.teamMemberIds : []);
}

/** Does this MM act over OTHER people's work at all? A Team Leader holds the
 *  seat even with nobody in reach (they still hand the pool to themself); a
 *  Coordinator only once their VP has given them people. */
export function actsOverOthers(v: Viewer): boolean {
  return v.role === "Team Leader" || reachIds(v).length > 0;
}

export function accountScope(v: Viewer): AccountScope {
  if (master(v)) return { kind: "all" };
  if (isIcxLead(v)) return { kind: "functions", fns: scopeFunctions(v) };
  if (v.role === "Team Leader" || v.role === "Coordinator")
    return { kind: "members", ids: [v.id, ...reachIds(v)] };
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
  /** NULL = THE UNOWNED RESEARCH POOL (v36) — see `Account.function`.
   *
   *  A row nobody has claimed belongs to no crew, so every FUNCTION test
   *  below is false on it, deliberately: there is no function to match. What
   *  keeps the pool reachable is `isClaimableAccount`, which asks a different
   *  question ("is this nobody's, and may you create accounts at all?"), and
   *  every predicate that must reach the pool routes through it rather than
   *  through a function comparison. */
  function: string | null;
  responsible_id: string | null;
  out_of_process?: boolean;
  /** the two fields the Podio worklist turns on (v33.13) */
  requested_podio?: boolean | null;
  request_state?: string | null;
};

/** In-scope accounts, plus (v22.2) EVERY archived account: the archive is the
 *  LC-wide blacklist — every member may open a dead name read-only to see who
 *  burned it and why before wasting a call on it. */
export function canViewAccount(v: Viewer, a: AccountLike): boolean {
  if (a.out_of_process) return true;
  // an MM working the Podio queue may OPEN a row from it — read plus the one
  // field the queue exists for, never edit or ownership (v33.13)
  if (canCheckPodio(v, a)) return true;
  // the function's leader opened their floor to this viewer's role (v33.32) —
  // READ ONLY: canEditAccount below is the only thing that grants a change.
  // An unowned row has no function, so no leader has opened it to anybody:
  // it is reached through the claim path or not at all.
  if (a.function != null && (v.openViewFns ?? []).includes(a.function)) return true;
  return canEditAccount(v, a);
}

/** The functions a viewer may READ beyond their own scope (v33.32) — used by
 *  the list query, which has to widen the same way the per-row check does. */
export function openViewFunctions(v: Viewer): AccountFunction[] {
  const scope = accountScope(v);
  // leaders already read whole functions; this only ever widens a member's
  if (scope.kind !== "members") return [];
  return (v.openViewFns ?? []).filter((f): f is AccountFunction =>
    ["IGV", "IGT", "B2B", "BD", "B2C"].includes(f)
  );
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
  //
  // v33.37 — AND MEMBERS TOO. Hiding the unowned POOL from Members is about
  // distribution (canSeeUnassigned still excludes them); claiming ONE account
  // they personally researched takes nothing from anyone. Before this, the
  // add-form told a Member "open it and hit Take it" about an account they
  // could neither open nor take.
  return master(v) || allowedAccountFunctions(v).length > 0;
}

/** AN MM — a Team Leader or a Coordinator (v36).
 *
 *  The product owner's ruling, verbatim: a Coordinator *"exists on the report
 *  as MM too but with no team, can't book touch points."* So the two questions
 *  that used to be one are now two: `isMm` is about RANK — the middle
 *  management layer, the people a VP hands work to and reads a report about —
 *  and `leadsTeam` below is about whether anybody reports to you. A
 *  Coordinator is the first and never the second: they are an MM who works
 *  alone.
 *
 *  Everything that counts MMs (reports, drills, the planning cohort, the PDP
 *  cascade) asks THIS, so a Coordinator stops falling through the gap between
 *  "not a Team Leader" and "not a plain Member". */
export function memberIsMm(m: Pick<Member, "role">): boolean {
  return m.role === "Team Leader" || m.role === "Coordinator";
}

export function isMm(v: Viewer): boolean {
  return memberIsMm(v);
}

/** …AND WHO ACTUALLY LEADS A TEAM. A Coordinator NEVER does (v36).
 *
 *  Team card, team rollup, team leaderboard row, team goal, team touch point:
 *  all of them need people, and a Coordinator has none — production confirms
 *  it, all four of them carry zero direct reports. Asking `isMm` for those
 *  would put an empty team on their dashboard and an empty row on everyone
 *  else's board.
 *
 *  It is deliberately about the SEAT, not the headcount: a Team Leader whose
 *  team is empty this week (two of the fourteen, today) still leads a team and
 *  still files a team plan. "Is the team empty?" is a different question, and
 *  `teamMemberIds.length` is where it is asked. */
export function leadsTeam(v: Viewer): boolean {
  return v.role === "Team Leader";
}

/** THE CREWS WHO SHARE THE UNOWNED RESEARCH POOL (v36).
 *
 *  Market research is done for the ICX floor: IGV and IGT raise from it, and
 *  B2B/BD raise from the same names for the whole ICX. B2C does NOT — its
 *  accounts are courses, events and student activities, a different world with
 *  its own name space (v23.2), and there has never been an unowned B2C row.
 *  A consideration-only member is out too: they work partner LCs, not
 *  companies. */
export function worksIcxRaisingOrB2b(v: Viewer): boolean {
  if (isB2B(v)) return true;
  if (icxFunctions(v).length === 0) return false;
  // a leader owns both sides of the product function they lead; below the EB
  // the Sub Function column says which side you work ("ICX" is the legacy
  // catch-all for raising)
  if (v.role === "LCVP" || v.role === "Director") return true;
  return v.sub_functions.some((sf) => sf === "Raising" || sf === "ICX");
}

/** WHO SEES THE UNOWNED POOL AT ALL (v33.2, re-drawn v36).
 *
 *  The imported market research — names nobody has taken — is a DISTRIBUTION
 *  problem, and distribution is an MM's job upward. A plain Member works the
 *  accounts they were given; burying those among hundreds of unowned ones is
 *  how a member's own list stops being a to-do list. So: MMs (Team Leaders
 *  AND Coordinators), the VPs and Directors of IGV/IGT/B2B/BD, and the LCP.
 *  Never Members.
 *
 *  v36 narrows one thing: the pool now carries NO FUNCTION at all, so "may
 *  you create accounts somewhere?" stopped being the right question — it let
 *  a B2C leader into a queue of ICX research they will never work. The gate is
 *  the crew that owns the research (`worksIcxRaisingOrB2b`). Nothing is lost:
 *  in production every unowned active account is ICX research (229 of them),
 *  and B2C has never had one. */
export function canSeeUnownedPool(v: Viewer): boolean {
  if (master(v)) return true;
  if (!worksIcxRaisingOrB2b(v)) return false;
  return isMm(v) || v.role === "LCVP" || v.role === "Director";
}

/** The name the rest of the app has called it by since v33.2. ONE rule, not
 *  two that can drift: whoever may see the pool sees it everywhere. */
export function canSeeUnassigned(v: Viewer): boolean {
  return canSeeUnownedPool(v);
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
  // THE POOL CARRIES NO FUNCTION (v36), so there is nothing to keep and the
  // fall-through below is the rule ask #9 asked for in as many words:
  // claiming an unowned name STAMPS THE CLAIMER'S function on it. The
  // `includes` test only ever fires for an account that already had one.
  return a.function != null && allowed.includes(a.function as AccountFunction)
    ? (a.function as AccountFunction)
    : preferB2bOverBd(allowed)[0];
}

/** B2B BEFORE BD (v36.2). Somebody who works BOTH files an unowned account
 *  under B2B — the floor's rule, in their words: "when an unassigned account
 *  is assigned to a B2B and BD user, make it B2B, not BD." Nothing else about
 *  the order moves: an IGV member who also does B2B still lands in IGV first.
 *
 *  It had to be written down because the membership sheet lists these two in
 *  either order ("BD, B2B" for three of the eight), and the hand-out path took
 *  the FIRST one — which is how 50 pool accounts handed to one person on
 *  2026-09-01 all came out BD. */
export function preferB2bOverBd<F extends string>(fns: readonly F[]): F[] {
  const out = [...fns];
  const b2b = out.indexOf("B2B" as F);
  const bd = out.indexOf("BD" as F);
  if (bd !== -1 && b2b > bd) {
    out.splice(b2b, 1);
    out.splice(bd, 0, "B2B" as F);
  }
  return out;
}

/** The raising functions a member actually works, in the order their
 *  membership row lists them (the sheet's own order — their primary function
 *  first), except that B2B always comes before BD. `sub_functions` is
 *  included because B2B, BD and B2C routinely live there and nowhere else.
 *  The account a hand-out moves lands in the FIRST of these. */
export function raisingFunctionsOf(m: {
  functions: string[] | null;
  sub_functions: string[] | null;
}): AccountFunction[] {
  const seen = new Set<string>();
  return preferB2bOverBd(
    [...(m.functions ?? []), ...(m.sub_functions ?? [])].filter(
      (f): f is AccountFunction =>
        ["IGV", "IGT", "B2B", "BD", "B2C"].includes(f) && !seen.has(f) && !!seen.add(f)
    )
  );
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
  // AN UNOWNED ACCOUNT IS OPEN TO WHOEVER MAY WORK IT — checked FIRST (v36).
  // It used to sit below the "functions" branch, which returned outright, so
  // once the pool stopped carrying a function (0073) a VP or Director would
  // have been locked out of the very rows they are meant to distribute: their
  // scope is a list of functions and an unowned row matches none of them.
  // Hoisting it widens nothing — `isClaimableAccount` is false the moment a
  // row has a responsible, so every OWNED account still takes the old path.
  if (isClaimableAccount(v, a)) return true;
  if (scope.kind === "functions")
    return a.function != null && scope.fns.includes(a.function as AccountFunction);
  return a.responsible_id != null && scope.ids.includes(a.responsible_id);
}

/** THE ICX SIBLING (v34.10).
 *
 *  IGV and IGT sell to the SAME door. A raiser walks into a language school
 *  as IGT, the enabler says no to a teacher and yes to a volunteer, and the
 *  open that gets signed is an IGV one — raised by an IGT member, on an
 *  account labelled IGT. Until now the CRM had no way to say that: the
 *  account could only be flipped by someone who works both functions, which
 *  the member on the call is not, so the open was either recorded against the
 *  wrong programme or lost.
 *
 *  So an ICX raiser may move their OWN account between IGV and IGT. Nothing
 *  is taken from anyone (`canEditAccount` still gates it, and the account
 *  keeps its responsible), and nothing is created either — this deliberately
 *  does NOT widen `allowedAccountFunctions`, so an IGT member still cannot
 *  ADD an IGV account out of nowhere. It only lets an account they already
 *  own follow what the enabler actually bought. */
const ICX_SIBLINGS: AccountFunction[] = ["IGV", "IGT"];

/** Which functions this viewer may RELABEL an account between (v33.19).
 *
 *  The B2B↔BD flip (v33.15) was the first case of a general rule: whoever
 *  may EDIT an account and works BOTH its current function and the target
 *  may move it — "I work IGV and IGT" is the same situation as the B2B/BD
 *  crew's two labels. LCP-level viewers (incl. F&L) span all five. v34.10
 *  adds the ICX sibling above: an IGV or IGT account may always cross to the
 *  other one, by whoever owns it. Archived rows move through revive/reassign
 *  instead. Returns [] when no move is possible; otherwise the full set the
 *  picker should offer (incl. the current function, so the select renders its
 *  value). */
export function accountFnTargets(v: Viewer, a: AccountLike): AccountFunction[] {
  if (a.out_of_process) return [];
  // NOTHING TO RELABEL ON AN UNOWNED ROW (v36): it has no function yet, and
  // the act that gives it one is claiming it (`claimTargetFunction`), not a
  // picker. Offering a "move it to…" control on a name nobody holds would be
  // a second, quieter way of assigning it.
  if (a.function == null) return [];
  if (!canEditAccount(v, a)) return [];
  const allowed = allowedAccountFunctions(v);
  // THE MOVE MUST BE REVERSIBLE. An IGT member who pushed an account to IGV
  // no longer holds its current function, and the plain `allowed.includes`
  // gate would strand it there — so an ICX raiser keeps the pair on any ICX
  // row they own, whichever side of it the row is sitting on today.
  const worksIcx = allowed.some((f) => ICX_SIBLINGS.includes(f));
  const icxRow = ICX_SIBLINGS.includes(a.function as AccountFunction);
  const crossable = icxRow && worksIcx;
  if (!crossable && !allowed.includes(a.function as AccountFunction)) return [];
  const targets = crossable
    ? [...new Set([...allowed, ...ICX_SIBLINGS])]
    : allowed;
  return targets.length >= 2 ? targets : [];
}

/** The function an open may be RAISED FOR on this account (v34.10) — the
 *  account's own, plus its ICX sibling. B2B and BD already mix all three
 *  products in one deal, so they need no widening; B2C carries no opens. */
export function openTargetFunctions(a: { function: string | null }): AccountFunction[] {
  // an unowned account raises nothing: `recordDeal` refuses one outright
  // ("assign it first"), so there is no product to offer (v36)
  if (a.function == null) return [];
  return ICX_SIBLINGS.includes(a.function as AccountFunction)
    ? [...ICX_SIBLINGS]
    : [a.function as AccountFunction];
}

/** Responsibility: Team Leaders choose between themselves and their members;
 *  LCVPs/Directors inside their function; LCP anywhere. Plain members never. */
export function canReassignAccount(v: Viewer, a: AccountLike): boolean {
  if (master(v)) return true;
  // an archived account can be handed to anyone by an MM (v33.8)
  if (canWorkArchived(v, a)) return true;
  // taking an unowned account needs no authority over anyone — and it is
  // checked BEFORE the leader branch (v36), which returns outright and would
  // otherwise answer "no" for every function-less pool row
  if (isClaimableAccount(v, a)) return true;
  if (isIcxLead(v))
    return a.function != null && scopeFunctions(v).includes(a.function as AccountFunction);
  if (actsOverOthers(v))
    return a.responsible_id != null && [v.id, ...reachIds(v)].includes(a.responsible_id);
  return false;
}

/** Who a given viewer may reassign an account TO (v33.13).
 *
 *  ANYONE. The hard question — "is this account yours to move?" — is already
 *  answered by `canReassignAccount`, which holds an MM to their own and their
 *  team's rows. Once you have established that it IS theirs, restricting where
 *  it can go only produced dead ends: a company that wants a teacher belongs
 *  with IGT, and routing that through two VPs is how it stops happening.
 *
 *  The pairing is the point: you may give away only what is yours, but you may
 *  give it to whoever should have it. Nobody can TAKE an account from someone
 *  else, because that is the other predicate's job. */
export function reassignTargetScope(v: Viewer): AccountScope {
  if (master(v) || isIcxLead(v)) return { kind: "all" };
  if (v.role === "Team Leader" || v.role === "Coordinator") return { kind: "all" };
  return { kind: "members", ids: [] };
}

/** THE PODIO WORKLIST GRANT (v33.13).
 *
 *  Checking whether a company is already on Podio is one person's errand done
 *  for the whole function, so the worklist spans it — but opening a row out of
 *  it used to hit "you can't open this account", because the account belongs
 *  to another team.
 *
 *  This grants exactly enough and no more: an MM of the account's own function
 *  may open it and record what Podio said, WHILE it still needs checking. The
 *  moment a state is set the grant lapses on its own, so it can never become a
 *  standing back door into another team's accounts — and it never carries the
 *  right to edit the account or change its owner. */
export function canCheckPodio(v: Viewer, a: AccountLike): boolean {
  if (a.out_of_process) return false;
  // already answered → nothing left to check → no grant
  if (a.requested_podio || a.request_state) return false;
  const mm =
    master(v) ||
    isIcxLead(v) ||
    v.role === "Team Leader" ||
    v.role === "Coordinator";
  if (!mm) return false;
  // AND NEVER AN UNOWNED ROW (v36). It is the same call v34.1 made for the
  // Podio-check signal on the accounts list: nobody is going to submit a name
  // nobody has been given, so the queue skips the pool rather than filling it
  // with 229 names that need a responsible first.
  if (a.function == null) return false;
  return allowedAccountFunctions(v).includes(a.function as AccountFunction);
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
 *    Coordinator   → NOTHING. See below — this is a decision, not a gap.
 *    LCP / admin   → everything, as always.
 *
 *  The order matters: a TM VP is TM core FIRST (lc), not an LCVP (function). */
export function bookableTouchPointScopes(v: Viewer): TouchPointScope[] {
  if (master(v)) return ["team", "function", "lc"];
  if (isTmCore(v)) return ["lc"];
  if (v.role === "LCVP" || v.role === "Director") return ["function"];
  if (v.role === "Team Leader") return ["team"];
  // A COORDINATOR BOOKS NOTHING, AND THAT IS DELIBERATE (v36, the product
  // owner's own words: "exists on the report as MM too but with no team,
  // can't book touch points"). They are an MM by RANK — `isMm` is true for
  // them and every report counts them as one — but a touch point is a room
  // full of your people, and a Coordinator works alone: `leadsTeam` is false,
  // there is no team to invite, no audience to derive and nobody to mark
  // present. Do not "fix" this by adding "team" here; the empty list IS the
  // answer, and the team-binding branch in server/touch-points.ts can never
  // resolve a team for them anyway.
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
  /** the OTHER functions on the sheet (v33.40) — their people are in the
   *  audience, so their own leaders belong on the recording side too */
  invited_functions?: string[] | null;
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
  // AN INVITED FUNCTION RECORDS ITS OWN PEOPLE (v33.40): a cross-function
  // touch point puts several functions on one sheet, and the booking
  // function's leader was the only one who could fill it — including rows of
  // people they don't lead. The invited functions' own MMs and VPs/Directors
  // belong on the recording side; WHICH rows each may set is the per-row
  // check (`canEditAttendanceRowOf`), so nobody reaches past their people.
  const tpFns = expandTouchPointFns([
    ...(tp.function_key ? [tp.function_key] : []),
    ...(tp.invited_functions ?? []),
  ]);
  const fnMatch = [...v.functions, ...v.sub_functions].some((f) => tpFns.has(f));
  if (tp.scope === "function")
    return fnMatch && ["LCVP", "Director", "Team Leader", "Coordinator"].includes(v.role);
  if (tp.owner_id === v.id) return true;
  // a team point that invited sibling teams / functions: their MMs record
  // their own people (the per-row check keeps them inside their slice)
  return fnMatch && ["LCVP", "Director", "Team Leader", "Coordinator"].includes(v.role);
}

/** WHO MAY SET THIS PARTICULAR ROW (v33.40). Authority follows the MEMBER,
 *  not the sheet: a recorder sets rows of people in THEIR OWN function(s) —
 *  the booking function's crew never fills the invited function's rows, and
 *  the invited function's own MMs/VPs fill exactly theirs. TM core and the
 *  LCP/admin keep the whole sheet; nobody marks themself (below). */
export function canEditAttendanceRowOf(
  v: Viewer,
  tp: TouchPointRef,
  member: { id: string; functions: string[] }
): boolean {
  if (member.id === v.id) return canEditOwnAttendanceRow(v, tp);
  if (master(v) || isTmCore(v)) return true;
  if (!canRecordAttendance(v, tp)) return false;
  // REAL FUNCTIONS ONLY: audience rows merge functions + sub-functions, and a
  // shared sub-function label ("Raising") must not read as shared authority —
  // an IGT VP is not the leader of an IGV raiser they happen to rhyme with
  const real = (fns: string[]) =>
    fns.filter((f) => (LC_FUNCTIONS as readonly string[]).includes(f));
  const mFns = expandTouchPointFns(real(member.functions));
  return real([...v.functions, ...v.sub_functions]).some((f) => mFns.has(f));
}

/** NOBODY MARKS THEMSELF (v33.19.2, by the LCP's request).
 *
 *  A Team Leader records their team but not their own row; a VP records their
 *  function but not their own; the LC's sessions — and everyone's own row —
 *  belong to TM (and the LCP/admin). Owning the touch point is no longer an
 *  exception: booking a session you attend is exactly the case where marking
 *  yourself present is worth nothing to anyone reading it. */
export function canEditOwnAttendanceRow(v: Viewer, tp: TouchPointRef): boolean {
  void tp;
  return master(v) || isTmCore(v);
}

// ------------------------------------------------------------ O2O / PDP (v36)

/** THE PEOPLE WHO RUN THE PDP PROCESS — TM's own crew, the LCP, and the
 *  break-glass admin.
 *
 *  Deliberately NOT `isTmCore`, which folds `master()` in and would therefore
 *  hand every PDP in the LC to the whole F&L function. F&L's LCP-level access
 *  (v33.16) is about money and commitments; a PDP is a private conversation
 *  between a person and their leader about what they are bad at. That is the
 *  same line the concerns inbox drew when F&L's LCVP was removed from it in
 *  v33.31, and it is drawn here for the same reason. */
const runsPdpProcess = (v: Viewer) =>
  v.isAdmin ||
  v.role === "LCP" ||
  ((v.functions.includes("TM") || v.sub_functions.includes("TM")) &&
    ["LCVP", "Director", "Team Leader", "Coordinator"].includes(v.role));

/** MAY THIS VIEWER FILE A PDP FOR THIS MEMBER? (v36)
 *
 *  The cascade is the whole design: a VP files for their MMs, and those MMs
 *  then file for their own members. So the rule is the MANAGER LINK — the
 *  person named in your Manager cell is the person who sits down with you —
 *  plus TM and the LCP, who own the process and have to be able to unstick it
 *  when a leader has left mid-cycle.
 *
 *  ⚠️ NOT FOR YOURSELF, whatever your rank. A PDP is a conversation someone
 *  else holds with you and writes down; a self-filed one is a to-do list with
 *  a formal name, and it would let a leader tick their own box while the
 *  people under them wait. */
export function canFilePdpFor(v: Viewer, m: Member): boolean {
  if (v.id === m.id) return false;
  if (runsPdpProcess(v)) return true;
  return m.stakeholder_id != null && m.stakeholder_id === v.id;
}

/** MAY THIS VIEWER READ THIS PDP? (v36)
 *
 *  The member it is about · the leader who filed it · that member's manager
 *  (normally the same person, but a re-parenting mid-cycle must not orphan
 *  the plan) · THAT leader's manager, because a VP coaches their MMs on the
 *  coaching they are doing · TM's crew · the LCP.
 *
 *  ⚠️ DELIBERATELY NARROWER THAN `hasTmAccess`. That gate opens the members
 *  DIRECTORY — names, teams, KPIs — to everyone in TM, which is right for a
 *  directory and wrong for this: a PDP carries someone's own account of what
 *  they are struggling with. Reading it is TM's leadership's job, not every
 *  TM member's.
 *
 *  Takes ids rather than rows because the caller already has them from the
 *  query it just ran — a predicate that needed two more member fetches per
 *  row would be paid for on every list. */
export function canReadPdp(
  v: Viewer,
  subjectId: string,
  authorId: string,
  subjectManagerId: string | null,
  authorManagerId: string | null
): boolean {
  if (v.id === subjectId) return true;
  if (v.id === authorId) return true;
  if (subjectManagerId != null && v.id === subjectManagerId) return true;
  if (authorManagerId != null && v.id === authorManagerId) return true;
  return runsPdpProcess(v);
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
  if (canCheckPodio(v, a)) return true; // the worklist grant (v33.13)
  if (
    master(v) ||
    (isIcxLead(v) &&
      a.function != null &&
      scopeFunctions(v).includes(a.function as AccountFunction))
  )
    return true;
  if (actsOverOthers(v))
    return a.responsible_id != null && [v.id, ...reachIds(v)].includes(a.responsible_id);
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
 *  sub_functions; LCP-level viewers — incl. F&L since v33.16 — see both). */
export function ogxFunctions(v: Viewer): OgxFunction[] {
  if (master(v)) return ["OGT", "OGV"];
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

/** CUSTOM calendar items (v33.16, widened v33.29) — Google-Calendar-style
 *  slots/tasks with an explicit assignee list. Everyone creates them now:
 *  a Member/Coordinator for THEMSELVES + THEIR OWN TEAM (teammates and the
 *  TL), a TL for their team, an LCVP/Director for their function(s),
 *  LCP-level for anyone. The server validates the assignee list either way. */
/** WHO CAN SEE A CUSTOM CALENDAR ITEM (v33.31). The owner and any explicit
 *  assignees always see it; this is the group ADDED on top:
 *
 *    Member / Coordinator / TL   self · team · function
 *    LCVP / Director             self · function        (their team IS the function)
 *    LCP-level                   self · EB · LC         (+ function, if they hold one)
 *    TM (any role)               self · function · LC   (TM's remit is the whole LC)
 *
 *  Built from the person's actual position rather than a role table, so
 *  someone who is both (a TM Team Leader, the IM Director) gets the union
 *  instead of whichever row was checked first. */
export type CalendarItemScope = "self" | "team" | "function" | "eb" | "lc";

export function calendarItemScopes(v: Viewer): CalendarItemScope[] {
  const out: CalendarItemScope[] = ["self"];
  const fns = [...(v.functions ?? []), ...(v.sub_functions ?? [])];
  // a team is something only the roles BELOW the EB sit inside
  if (["Member", "Coordinator", "Team Leader"].includes(v.role)) out.push("team");
  // no function, nothing to share with a function
  if (fns.length > 0) out.push("function");
  if (master(v)) out.push("eb", "lc");
  // TM answers for the whole LC's people, so an LC-wide slot is theirs to book
  else if (fns.includes("TM")) out.push("lc");
  return out;
}

export function canCreateCalendarItems(v: Viewer): boolean {
  void v;
  return true;
}

/** OGX leaders (VP/Director of the sign-up's function + LCP/admin) own the
 *  VP-only fields: VP comments, Country, Sub Product, Status, Out of Process. */
export function canEditSignupVpFields(v: Viewer, s: { fn: OgxFunction }): boolean {
  if (master(v)) return true;
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
  if (s.assigned_to && reachIds(v).includes(s.assigned_to)) return true;
  return false;
}

/** Viewing: leaders see the whole function; a TL their team; everyone their
 *  own + the UNASSIGNED pool (the main view — contact one, claim it). */
export function canViewSignup(v: Viewer, s: SignupRow): boolean {
  if (!ogxFunctions(v).includes(s.fn)) return false;
  if (canEditSignupVpFields(v, s)) return true;
  if (!s.assigned_to) return true;
  // the CIC SECOND CALLER must be able to open the row they were handed
  // (v33.19 review): the sign-up stays the first assignee's, so canWorkSignup
  // is false for them — they could see it in the queue and not open it.
  // View only: recording still goes through updateCicContact's own gate.
  if (s.cic_assigned_to && s.cic_assigned_to === v.id) return true;
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
  // the IM director (break-glass — they maintain the inbox itself) and the LCP
  if (v.isAdmin || v.role === "LCP" || leadsIm(v)) return true;
  const fns = [...(v.functions ?? []), ...(v.sub_functions ?? [])];
  // TM owns people (v33.22 — the whole function, not only its leadership:
  // handling a concern is TM's daily work, not an executive act)
  if (fns.includes("TM")) return true;
  // F&L's LCVP was here for the legality side and was REMOVED in v33.31 by
  // the LCP: a concern about a person is TM's and the LCP's to handle, and
  // every extra reader is one more person an anonymous author didn't expect.
  return false;
}

/** Feedback inbox: ONLY the IM director (admin) and the IM coach. */
export function canSeeFeedbackInbox(v: Viewer): boolean {
  const email = (v.email ?? "").toLowerCase();
  return v.isAdmin || (FEEDBACK_INBOX_EMAILS as readonly string[]).includes(email);
}
