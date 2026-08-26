// =============================================================================
// CXP — WHO SEES WHAT
//
// The module is split in two along the exchange line: ICX (IGV + IGT, EPs we
// host) and OGX (OGV + OGT, EPs we send). Access is granted per SIDE, and then
// narrowed to a set of FUNCTIONS inside it.
//
// THE RULES (set by the LCP / CXP directors, 2026-08-26):
//
//   CXP tag           Function "CXP" + sub-function ICX and/or OGX. Grants that
//                     side, STRICTLY — a CXP+ICX person never sees OGX, however
//                     senior they are elsewhere. The tag grants access at ANY
//                     role, including a plain Member: being put on CXP IS the
//                     decision.
//   VP / Director     of a product function → BOTH functions of their own side.
//                     An IGV VP reads IGV and IGT. (They are still EMAILED
//                     about their own function only — see `cxpEmailFunctions`.)
//   MM                Team Leader / Coordinator → THEIR OWN FUNCTION ONLY. An
//                     IGV consideration TL reads IGV, never IGT. On the ICX
//                     side the MM must be on the CONSIDERATION floor, which is
//                     the crew that actually works submissions; on the OGX side
//                     every MM of the function qualifies.
//   Member            nothing, unless they carry the CXP tag above.
//   LCP / F&L / IM    everything — Sodio's existing `master()`, unchanged. F&L
//                     audits every function's commitments, so the whole
//                     function keeps LCP-level reach here as it does elsewhere.
//
// Everything below is a pure function of the Viewer the app already assembles.
// No new columns, no config table: the membership sheet's Function and Sub
// Function columns are the whole input.
// =============================================================================

import { master, type Viewer } from "@/lib/rbac";
import {
  CXP_FUNCTIONS,
  CXP_SIDES,
  SIDE_FUNCTIONS,
  sideOf,
  type CxpFunction,
  type CxpSide,
} from "./types";

/** Everything the membership sheet says about this person, in one list. */
const tags = (v: Viewer): string[] => [
  ...(v.functions ?? []),
  ...(v.sub_functions ?? []),
];

/** Does this person carry the CXP tag at all? */
export function hasCxpTag(v: Viewer): boolean {
  return tags(v).includes("CXP");
}

/** The sides a CXP-tagged person was put on.
 *
 *  Normally this is exactly what the Sub Function column says: ICX, OGX, or
 *  both. But the column is FREE-FORM and real rows leave it blank — the OGX
 *  CXP VP carries Function "OGT, CXP" and an empty Sub Function, and reading
 *  that strictly locked him out of the side he runs.
 *
 *  So when the tag names no side, fall back to the side of the product
 *  function(s) the person already works. That grants nothing new — they were
 *  on that side already — it just stops an unfilled cell from silently
 *  revoking a director's own floor. Someone carrying CXP with NO side and NO
 *  product function still gets nothing, which is the case the strictness was
 *  really for. */
export function taggedSides(v: Viewer): CxpSide[] {
  if (!hasCxpTag(v)) return [];
  const t = tags(v);
  const out: CxpSide[] = [];
  if (t.includes("ICX")) out.push("ICX");
  if (t.includes("OGX")) out.push("OGX");
  if (out.length > 0) return out;
  // no explicit side — infer it from the functions they hold
  const inferred = new Set(productFunctions(v).map(sideOf));
  return CXP_SIDES.filter((s) => inferred.has(s));
}

/** The product functions this person holds on the membership sheet. */
export function productFunctions(v: Viewer): CxpFunction[] {
  const t = tags(v);
  return CXP_FUNCTIONS.filter((f) => t.includes(f));
}

const isLead = (v: Viewer) => v.role === "LCVP" || v.role === "Director";
const isMm = (v: Viewer) => v.role === "Team Leader" || v.role === "Coordinator";

/** THE CONSIDERATION QUALIFIER (ICX only).
 *
 *  On the incoming side the submissions floor is Consideration — the crew that
 *  carries an EP from acceptance to realization. A raising MM of IGV works a
 *  different job and is not handed the audit trail. ("ICX" is Sodio's legacy
 *  catch-all for RAISING, so it deliberately does NOT qualify here.) */
const worksConsideration = (v: Viewer) =>
  (v.sub_functions ?? []).includes("Consideration");

/** Every function this viewer may READ in the CXP module. */
export function cxpFunctions(v: Viewer): CxpFunction[] {
  if (master(v)) return [...CXP_FUNCTIONS];

  const out = new Set<CxpFunction>();

  // 1) the CXP tag — a whole side, at any role
  for (const side of taggedSides(v)) {
    for (const fn of SIDE_FUNCTIONS[side]) out.add(fn);
  }

  // 2) inherited through a product function — MMs and up only
  const own = productFunctions(v);
  if (own.length > 0) {
    if (isLead(v)) {
      // a VP/Director reads BOTH functions of their own side
      for (const fn of own) {
        for (const sibling of SIDE_FUNCTIONS[sideOf(fn)]) out.add(sibling);
      }
    } else if (isMm(v)) {
      // an MM reads their own function, and nothing beside it
      for (const fn of own) {
        if (sideOf(fn) === "ICX" && !worksConsideration(v)) continue;
        out.add(fn);
      }
    }
    // a plain Member inherits nothing — only the CXP tag lets them in
  }

  return CXP_FUNCTIONS.filter((f) => out.has(f));
}

/** The sides this viewer may read — what the two sections / the side filter
 *  are built from. */
export function cxpSides(v: Viewer): CxpSide[] {
  const fns = cxpFunctions(v);
  const out: CxpSide[] = [];
  if (fns.some((f) => sideOf(f) === "ICX")) out.push("ICX");
  if (fns.some((f) => sideOf(f) === "OGX")) out.push("OGX");
  return out;
}

/** Is the CXP module visible to this person at all? */
export function hasCxpAccess(v: Viewer): boolean {
  return cxpFunctions(v).length > 0;
}

/** WHERE THE MODULE OPENS. Someone who reads both sides lands on their own —
 *  a VP of OGV opens on OGX, not on whichever side sorts first. */
export function cxpDefaultSide(v: Viewer): CxpSide | null {
  const sides = cxpSides(v);
  if (sides.length === 0) return null;
  const own = productFunctions(v);
  if (own.length > 0) {
    const ownSide = sideOf(own[0]);
    if (sides.includes(ownSide)) return ownSide;
  }
  // a pure CXP person opens on the side they were tagged with
  const tagged = taggedSides(v);
  if (tagged.length > 0 && sides.includes(tagged[0])) return tagged[0];
  return sides[0];
}

/** …and on their own FUNCTION inside it, when they have one. */
export function cxpDefaultFunction(v: Viewer): CxpFunction | null {
  const fns = cxpFunctions(v);
  if (fns.length === 0) return null;
  const own = productFunctions(v).filter((f) => fns.includes(f));
  if (own.length > 0) return own[0];
  const side = cxpDefaultSide(v);
  return side ? (fns.find((f) => sideOf(f) === side) ?? fns[0]) : fns[0];
}

/** May this viewer read this function's submissions? The single per-row gate
 *  every server query and every action must pass through. */
export function canViewCxpFunction(v: Viewer, fn: CxpFunction): boolean {
  return cxpFunctions(v).includes(fn);
}

/** WHO IS EMAILED ABOUT A FUNCTION, from this person's side of the question.
 *
 *  Deliberately NARROWER than `cxpFunctions`: a VP READS both functions of
 *  their side but is only MAILED about their own. Widening the read was about
 *  giving leaders context; widening the mail would double everyone's inbox for
 *  submissions that are not theirs to chase. */
export function cxpEmailFunctions(v: Viewer): CxpFunction[] {
  // the CXP directors answer for their whole side, so they are mailed on it
  const out = new Set<CxpFunction>();
  for (const side of taggedSides(v)) {
    for (const fn of SIDE_FUNCTIONS[side]) out.add(fn);
  }
  for (const fn of productFunctions(v)) {
    if (isLead(v) || isMm(v)) out.add(fn);
  }
  return CXP_FUNCTIONS.filter((f) => out.has(f));
}

/** May this viewer UPLOAD a document / mark a requirement?
 *
 *  Reading and doing are the same grant here — the module exists to collect
 *  documents, and someone who may see a missing passport is exactly the person
 *  who should be able to attach it. What nobody may do is reach into a
 *  function they cannot read, which `canViewCxpFunction` already decides. */
export function canEditCxpFunction(v: Viewer, fn: CxpFunction): boolean {
  return canViewCxpFunction(v, fn);
}

/** The admin edge of the module — regenerating weekly folders/ZIPs, forcing a
 *  sync, sending a reminder by hand. Leaders and the CXP directors, never a
 *  member who merely reads. */
export function canRunCxpOps(v: Viewer): boolean {
  if (master(v)) return true;
  if (!hasCxpAccess(v)) return false;
  return isLead(v) || (hasCxpTag(v) && v.role === "Director");
}
