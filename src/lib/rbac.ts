import { FEEDBACK_INBOX_EMAILS, type AccountFunction, type Member } from "./types";

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
}

export type AccountScope =
  | { kind: "all" }
  | { kind: "functions"; fns: AccountFunction[] }
  | { kind: "members"; ids: string[] };

const master = (v: Viewer) => v.isAdmin || v.role === "LCP";

/** EB = LCP + LCVPs (Directors are explicitly NOT EB). */
export const isEb = (v: Viewer) => master(v) || v.role === "LCVP";

/** B2B raises for the WHOLE ICX (usually bulk deals of 3+ opens): B2B members
 *  add accounts as product "B2B" and each deal splits its opens across
 *  IGV / IGTa / IGTe. */
export function isB2B(v: Viewer): boolean {
  return v.functions.includes("B2B") || v.sub_functions.includes("B2B");
}

/** Dashboard-lane functions: B2B feeds the whole ICX, so B2B people follow
 *  both product families' numbers. */
export function icxFunctions(v: Viewer): ("IGV" | "IGT")[] {
  if (isB2B(v)) return ["IGV", "IGT"];
  return v.functions.filter((f): f is "IGV" | "IGT" => f === "IGV" || f === "IGT");
}

/** ACCOUNT visibility for VPs/Directors:
 *  - a leader sees their own function's accounts (Director of B2B → B2B only)
 *  - IGV/IGT VPs & Directors ALSO see B2B accounts (B2B raises for them). */
export function scopeFunctions(v: Viewer): AccountFunction[] {
  const fns: AccountFunction[] = v.functions.filter(
    (f): f is "IGV" | "IGT" => f === "IGV" || f === "IGT"
  );
  if (fns.length > 0 || isB2B(v)) fns.push("B2B");
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

/** Whether the ICX Raising module is visible at all for this user. */
export function hasRaisingAccess(v: Viewer): boolean {
  if (master(v) || isIcxLead(v) || isB2B(v)) return true;
  return (
    icxFunctions(v).length > 0 &&
    v.sub_functions.some((s) => s === "Raising" || s === "ICX")
  );
}

/** Which functions this viewer may CREATE accounts for.
 *  B2B people add accounts as B2B (not IGV/IGT); IGV-only members cannot add
 *  IGT accounts and vice versa. Leaders create inside their visibility scope. */
export function allowedAccountFunctions(v: Viewer): AccountFunction[] {
  if (master(v)) return ["IGV", "IGT", "B2B"];
  if (v.role === "LCVP" || v.role === "Director") return scopeFunctions(v);
  if (isB2B(v)) return ["B2B"];
  return v.functions.filter((f): f is "IGV" | "IGT" => f === "IGV" || f === "IGT");
}

type AccountLike = { function: string; responsible_id: string };

export function canViewAccount(v: Viewer, a: AccountLike): boolean {
  const scope = accountScope(v);
  if (scope.kind === "all") return true;
  if (scope.kind === "functions") return scope.fns.includes(a.function as AccountFunction);
  return scope.ids.includes(a.responsible_id);
}

/** View and edit scopes are identical per the spec (everyone edits what they see,
 *  with field-level exceptions below). */
export const canEditAccount = canViewAccount;

/** Responsibility: Team Leaders choose between themselves and their members;
 *  LCVPs/Directors inside their function; LCP anywhere. Plain members never. */
export function canReassignAccount(v: Viewer, a: AccountLike): boolean {
  if (master(v)) return true;
  if (isIcxLead(v)) return scopeFunctions(v).includes(a.function as AccountFunction);
  if (v.role === "Team Leader")
    return [v.id, ...v.teamMemberIds].includes(a.responsible_id);
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

/** Out-of-process accounts are archived, not shown; leaders can review them. */
export function canViewArchive(v: Viewer): boolean {
  return master(v) || isIcxLead(v) || v.role === "Team Leader";
}

/** Request State (Podio) is filled by TL / Coordinator / VP — not plain members. */
export function canEditRequestState(v: Viewer, a: AccountLike): boolean {
  if (master(v) || (isIcxLead(v) && scopeFunctions(v).includes(a.function as AccountFunction)))
    return true;
  if (v.role === "Team Leader")
    return [v.id, ...v.teamMemberIds].includes(a.responsible_id);
  return v.role === "Coordinator" && a.responsible_id === v.id;
}

/** Numbered comments carry the author's label at the time of writing. */
export function commentLabel(v: Viewer): "Member" | "TL" | "VP" | "LCP" | "Admin" {
  if (v.role === "LCP") return "LCP";
  if (v.isAdmin) return "Admin"; // the IM director is Admin, not the LCP
  if (v.role === "LCVP" || v.role === "Director") return "VP";
  if (v.role === "Team Leader") return "TL";
  return "Member";
}

/** Membership management: EB (LCP + LCVPs) and admins — NOT Directors. */
export function canManageMembership(v: Viewer): boolean {
  return isEb(v);
}

/** Feedback inbox: ONLY the IM director (admin) and the IM coach. */
export function canSeeFeedbackInbox(v: Viewer): boolean {
  const email = v.email.toLowerCase();
  return v.isAdmin || (FEEDBACK_INBOX_EMAILS as readonly string[]).includes(email);
}
