// =============================================================================
// CXP — WHO GETS THE SUBMISSION EMAIL
//
// THE RULE (set by the CXP directors, 2026-08-26):
//
//     the function's VP(s)  +  the CXP leadership of that function's SIDE
//
// and nobody else. One email per function, as before.
//
// WHY THIS IS DERIVED AND NOT A LIST OF NAMES. The old system read recipients
// from an external "official metadata sheet" mirrored into a Stakeholders
// Config tab, through a twelve-branch scope matcher whose ORDER was
// load-bearing in three places and whose token list carried the real sheet's
// misspellings ("CONSEDIRATION", "EXPERIANCE"). It also shipped a hardcoded
// seed containing two real, live addresses — so an empty tab meant mailing two
// people who had nothing to do with it.
//
// All of that is gone. Sodio already knows who every member is, what function
// they hold and what role they carry, because the membership sheet syncs into
// `members` every thirty minutes. Derive from that and a term handover fixes
// the recipients by itself: a new VP appears on the sheet and starts getting
// the mail, the outgoing one stops. Nothing to edit, nothing to redeploy.
//
// Worth stating plainly, because it is the failure mode: if a function has no
// VP on the sheet, that function's email has fewer recipients — it does NOT
// silently fall back to anyone. `missingRecipients` reports the gap so it shows
// up in the log instead of being discovered a month later.
// =============================================================================

import { SIDE_FUNCTIONS, sideOf, type CxpFunction, type CxpSide } from "./types";

/** The slice of a membership row this module needs. */
export interface RecipientMember {
  id: string;
  name: string;
  email: string | null;
  role: string;
  functions: string[] | null;
  sub_functions: string[] | null;
  is_active: boolean;
}

export interface CxpRecipient {
  id: string;
  name: string;
  email: string;
  /** why they are on this email — shown in the log so a surprise recipient can
   *  be explained without re-deriving it by hand */
  reason: "function-vp" | "cxp-lead";
}

export interface CxpRouting {
  function: CxpFunction;
  side: CxpSide;
  recipients: CxpRecipient[];
  /** matched the rule but has no usable address on the sheet */
  missingRecipients: { name: string; reason: string }[];
}

const LEAD_ROLES = ["LCVP", "Director"];

const tagsOf = (m: RecipientMember): string[] => [
  ...(m.functions ?? []),
  ...(m.sub_functions ?? []),
];

/** A usable address, or null. Deliberately strict — a malformed cell in the
 *  membership sheet must surface as "missing", not as a bounced send. */
export function validEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/** Is this person a VP / Director of the given product function? */
function isFunctionLead(m: RecipientMember, fn: CxpFunction): boolean {
  return LEAD_ROLES.includes(m.role) && tagsOf(m).includes(fn);
}

/** Is this person CXP leadership for the given side?
 *
 *  Both the CXP VP and the CXP Director qualify — the directors answer for a
 *  side day to day, and a VP above them belongs on the same mail. A CXP MEMBER
 *  does not: they can read the module, but the submission mail is addressed to
 *  whoever is accountable for the function passing its audit.
 *
 *  THE SIDE MAY BE IMPLIED. The Sub Function column is free-form and real rows
 *  leave it blank: the OGX CXP VP carries Function "OGT, CXP" and nothing in
 *  Sub Function. Reading that strictly dropped him off the OGV mail for a side
 *  he runs. So when CXP names no side, the side of the product function he
 *  holds is the answer — it widens nothing, because he was already on it.
 *  (Mirrors `taggedSides` in ./rbac.ts — change both together.) */
function isCxpLead(m: RecipientMember, side: CxpSide): boolean {
  if (!LEAD_ROLES.includes(m.role)) return false;
  const t = tagsOf(m);
  if (!t.includes("CXP")) return false;
  if (t.includes("ICX") || t.includes("OGX")) return t.includes(side);
  // no explicit side — infer from the product functions on the row
  return SIDE_FUNCTIONS[side].some((fn) => t.includes(fn));
}

/** Resolve the recipient list for ONE function. Pure — the caller supplies the
 *  membership, which makes this directly testable against real rows. */
export function routeForFunction(
  members: RecipientMember[],
  fn: CxpFunction
): CxpRouting {
  const side = sideOf(fn);
  const recipients: CxpRecipient[] = [];
  const missing: { name: string; reason: string }[] = [];
  const seen = new Set<string>();

  const add = (m: RecipientMember, reason: CxpRecipient["reason"]) => {
    if (seen.has(m.id)) return;
    const email = validEmail(m.email);
    if (!email) {
      missing.push({ name: m.name, reason });
      seen.add(m.id);
      return;
    }
    // two membership rows can share an address; the address is what matters
    if (recipients.some((r) => r.email === email)) return;
    seen.add(m.id);
    recipients.push({ id: m.id, name: m.name, email, reason });
  };

  for (const m of members) {
    if (!m.is_active) continue;
    if (isFunctionLead(m, fn)) add(m, "function-vp");
    else if (isCxpLead(m, side)) add(m, "cxp-lead");
  }

  // stable order: the function's own leadership first, then CXP, then by name.
  // A reader should be able to tell at a glance whose submission this is.
  recipients.sort(
    (a, b) =>
      (a.reason === b.reason ? 0 : a.reason === "function-vp" ? -1 : 1) ||
      a.name.localeCompare(b.name)
  );

  return { function: fn, side, recipients, missingRecipients: missing };
}

/** The routing for every function on one side — what a whole send run needs. */
export function routeForSide(
  members: RecipientMember[],
  side: CxpSide
): CxpRouting[] {
  return SIDE_FUNCTIONS[side].map((fn) => routeForFunction(members, fn));
}

/** The routing for all four functions. */
export function routeAll(members: RecipientMember[]): CxpRouting[] {
  return (["IGV", "IGT", "OGV", "OGT"] as CxpFunction[]).map((fn) =>
    routeForFunction(members, fn)
  );
}
