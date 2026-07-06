import type { Member } from "./types";

/** The RBAC engine. Every read is filtered through `accountScope` and every
 *  mutation is checked with a `can*` predicate — server-side, before any query.
 *
 *  LCP          absolute master access across the LC
 *  VP           master authority over their function (IGV or IGT)
 *  TL           own accounts + team accounts + exclusive reassignment inside the team
 *  Coordinator  own accounts only (no team management)
 *  Member       own accounts only
 *
 *  Admins (ADMIN_EMAILS, e.g. the IM director) are treated like LCP. */

export interface Viewer extends Member {
  isAdmin: boolean;
  /** ids of members whose stakeholder is this viewer (their direct team) */
  teamMemberIds: string[];
}

export type AccountScope =
  | { kind: "all" }
  | { kind: "function"; fn: "IGV" | "IGT" }
  | { kind: "members"; ids: string[] };

const master = (v: Viewer) => v.isAdmin || v.role === "LCP";
const isIcxVp = (v: Viewer) =>
  v.role === "VP" && (v.function === "IGV" || v.function === "IGT");

export function accountScope(v: Viewer): AccountScope {
  if (master(v)) return { kind: "all" };
  if (isIcxVp(v)) return { kind: "function", fn: v.function as "IGV" | "IGT" };
  if (v.role === "TL") return { kind: "members", ids: [v.id, ...v.teamMemberIds] };
  return { kind: "members", ids: [v.id] };
}

/** Whether the Raising module is visible at all for this user. */
export function hasRaisingAccess(v: Viewer): boolean {
  if (master(v) || isIcxVp(v)) return true;
  return (
    (v.function === "IGV" || v.function === "IGT") &&
    (v.sub_function === "Raising" || v.sub_function === "ICX")
  );
}

type AccountLike = { function: string; responsible_id: string };

export function canViewAccount(v: Viewer, a: AccountLike): boolean {
  const scope = accountScope(v);
  if (scope.kind === "all") return true;
  if (scope.kind === "function") return a.function === scope.fn;
  return scope.ids.includes(a.responsible_id);
}

/** View and edit scopes are identical per the spec (everyone edits what they see,
 *  with field-level exceptions below). */
export const canEditAccount = canViewAccount;

/** TLs may reassign inside their team; VPs inside their function; LCP anywhere. */
export function canReassignAccount(v: Viewer, a: AccountLike): boolean {
  if (master(v)) return true;
  if (isIcxVp(v)) return a.function === v.function;
  if (v.role === "TL")
    return [v.id, ...v.teamMemberIds].includes(a.responsible_id);
  return false;
}

/** Who a given viewer may reassign an account to. */
export function reassignTargetScope(v: Viewer): AccountScope {
  if (master(v)) return { kind: "all" };
  if (isIcxVp(v)) return { kind: "function", fn: v.function as "IGV" | "IGT" };
  if (v.role === "TL") return { kind: "members", ids: [v.id, ...v.teamMemberIds] };
  return { kind: "members", ids: [] };
}

export function canManageBlacklist(v: Viewer): boolean {
  return master(v) || v.role === "VP";
}

export function canEditTlComment(v: Viewer, a: AccountLike): boolean {
  if (master(v) || (isIcxVp(v) && a.function === v.function)) return true;
  return v.role === "TL" && [v.id, ...v.teamMemberIds].includes(a.responsible_id);
}

export function canEditVpComment(v: Viewer, a: AccountLike): boolean {
  return master(v) || (isIcxVp(v) && a.function === v.function);
}

/** Request State (Podio) is filled by TL / Coordinator / VP — not plain members. */
export function canEditRequestState(v: Viewer, a: AccountLike): boolean {
  if (master(v) || (isIcxVp(v) && a.function === v.function)) return true;
  if (v.role === "TL") return [v.id, ...v.teamMemberIds].includes(a.responsible_id);
  return v.role === "Coordinator" && a.responsible_id === v.id;
}

/** Members management + feedback inbox: LCP and admins. */
export function canManageMembership(v: Viewer): boolean {
  return master(v);
}
