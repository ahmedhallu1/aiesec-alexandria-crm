import {
  considerationFunctions, accountScope, icxFunctions, isB2B, isB2C,
  isBd, isTmCore, ogxLanes, raisingFunctions, seesEveryLane, type Viewer,
} from "@/lib/rbac";

/** EVERY DASHBOARD LANE THIS VIEWER MAY OPEN, in the order the chips show
 *  them (moved out of the dashboard page in v37.2 so the dashboard EXPORT
 *  offers exactly the same lanes — never one the page would refuse).
 *
 *  v32 — every lane is named for the SIDE it shows, and each side is gated
 *  on the work the viewer actually does:
 *    Member / Coordinator / Team Leader → the side(s) their Sub Function
 *      column names (Raising, Consideration, or both)
 *    LCVP / Director  → both sides of THEIR product function
 *    nobody           → the other product's lanes
 *    LCP/admin + the TM and F&L leadership → everything */
export function dashboardLaneViews(viewer: Viewer): { key: string; label: string }[] {
  const scope = accountScope(viewer);
  const master = scope.kind === "all";
  const raisingFns = raisingFunctions(viewer);
  const consFns = considerationFunctions(viewer);
  const overseer = seesEveryLane(viewer);
  const views: { key: string; label: string }[] = [];
  if (raisingFns.includes("IGV") && raisingFns.includes("IGT"))
    views.push({ key: "all", label: "All ICX" });
  if (raisingFns.includes("IGV")) views.push({ key: "IGV", label: "IGV Raising" });
  if (consFns.includes("IGV"))
    views.push({ key: "CONS_IGV", label: "IGV Consideration" });
  if (raisingFns.includes("IGT")) {
    views.push(
      { key: "IGT", label: "IGT Raising" },
      { key: "IGTa", label: "IGTa Raising" },
      { key: "IGTe", label: "IGTe Raising" }
    );
  }
  if (consFns.includes("IGT"))
    views.push({ key: "CONS_IGT", label: "IGT Consideration" });
  if (
    master ||
    overseer ||
    isB2B(viewer) ||
    // B2B raises FOR the product functions, so their leaders follow it too
    ((viewer.role === "LCVP" || viewer.role === "Director") &&
      icxFunctions(viewer).length > 0)
  ) {
    views.push({ key: "B2B", label: "B2B" });
  }
  // BD is its own lane and its own audience (v32.6): B2B raises opens FOR the
  // product functions, so their VPs follow it — BD sells partnerships, which
  // is the BD crew's business and nobody else's.
  if (master || overseer || isBd(viewer)) {
    views.push({ key: "BD", label: "BD" });
  }
  // B2C is its own module (v23): its crew, the LCP/admin and the overseers
  if (master || overseer || isB2C(viewer)) {
    views.push({ key: "B2C", label: "B2C" });
  }
  // OGX (v28): OGT / OGV sign-up funnel lanes. `ogxLanes` adds the overseers
  // WITHOUT granting them the sign-ups module itself.
  const ogxFns = ogxLanes(viewer);
  // v36 — ALL OGX, the counterpart of All ICX. OGT and OGV have been separate
  // lanes since v28 with no way to see them together, so nobody could answer
  // "how is OGX doing" without adding two screens up by hand. Offered only
  // when the viewer actually has both sides — a one-sided "All" is just the
  // side, with a label that overstates it.
  if (ogxFns.length > 1) views.push({ key: "OGX", label: "All OGX" });
  for (const f of ogxFns) views.push({ key: f, label: f });
  // TM (v33.17): the LC through TM's eyes — attendance, plan compliance,
  // plan-vs-actual. TM core only (the people who run touch points + records).
  if (isTmCore(viewer)) views.push({ key: "TM", label: "TM" });

  return views;
}
