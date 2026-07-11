import { FEEDBACK_INBOX_EMAILS, type Member } from "./types";

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
  | { kind: "functions"; fns: ("IGV" | "IGT")[] }
  | { kind: "members"; ids: string[] };

const master = (v: Viewer) => v.isAdmin || v.role === "LCP";

/** EB = LCP + LCVPs (Directors are explicitly NOT EB). */
export const isEb = (v: Viewer) => master(v) || v.role === "LCVP";

export function icxFunctions(v: Viewer): ("IGV" | "IGT")[] {
  return v.functions.filter((f): f is "IGV" | "IGT" => f === "IGV" || f === "IGT");
}

/** LCVPs and Directors carry function-level authority over their function(s). */
const isIcxLead = (v: Viewer) =>
  (v.role === "LCVP" || v.role === "Director") && icxFunctions(v).length > 0;

export function accountScope(v: Viewer): AccountScope {
  if (master(v)) return { kind: "all" };
  if (isIcxLead(v)) return { kind: "functions", fns: icxFunctions(v) };
  if (v.role === "Team Leader")
    return { kind: "members", ids: [v.id, ...v.teamMemberIds] };
  return { kind: "members", ids: [v.id] };
}

/** Whether the ICX Raising module is visible at all for this user. */
export function hasRaisingAccess(v: Viewer): boolean {
  if (master(v) || isIcxLead(v)) return true;
  return (
    icxFunctions(v).length > 0 &&
    v.sub_functions.some((s) => s === "Raising" || s === "ICX")
  );
}

/** Which functions this viewer may CREATE accounts for.
 *  IGV-only members cannot add IGT accounts and vice versa; both are allowed
 *  only for members holding both functions, LCVPs and the LCP. */
export function allowedAccountFunctions(v: Viewer): ("IGV" | "IGT")[] {
  if (master(v) || v.role === "LCVP") return ["IGV", "IGT"];
  return icxFunctions(v);
}

type AccountLike = { function: string; responsible_id: string };

export function canViewAccount(v: Viewer, a: AccountLike): boolean {
  const scope = accountScope(v);
  if (scope.kind === "all") return true;
  if (scope.kind === "functions") return scope.fns.includes(a.function as "IGV" | "IGT");
  return scope.ids.includes(a.responsible_id);
}

/** View and edit scopes are identical per the spec (everyone edits what they see,
 *  with field-level exceptions below). */
export const canEditAccount = canViewAccount;

/** Responsibility: Team Leaders choose between themselves and their members;
 *  LCVPs/Directors inside their function; LCP anywhere. Plain members never. */
export function canReassignAccount(v: Viewer, a: AccountLike): boolean {
  if (master(v)) return true;
  if (isIcxLead(v)) return icxFunctions(v).includes(a.function as "IGV" | "IGT");
  if (v.role === "Team Leader")
    return [v.id, ...v.teamMemberIds].includes(a.responsible_id);
  return false;
}

/** Who a given viewer may reassign an account to. */
export function reassignTargetScope(v: Viewer): AccountScope {
  if (master(v)) return { kind: "all" };
  if (isIcxLead(v)) return { kind: "functions", fns: icxFunctions(v) };
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
  if (master(v) || (isIcxLead(v) && icxFunctions(v).includes(a.function as "IGV" | "IGT")))
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
