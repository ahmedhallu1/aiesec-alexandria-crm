import {
  canManageMembership, canOpenCalendar, canOpenPlanning, canSeeActivationBid,
  canSeeWarRoom, canUseMailboxTab, hasConsiderationAccess, hasOgxAccess,
  hasRaisingAccess, hasTmAccess, isB2C, isTmCore, seesEveryLane, type Viewer,
} from "@/lib/rbac";
import { hasCxpAccess } from "@/lib/cxp/rbac";
import { dashboardLaneViews } from "@/lib/dashboard-lanes";
import { homeRouteFor, tabVisible, type HomeNav, type TabOverride } from "@/lib/tabs";

/** THE CODE'S ANSWER PER MODULE (v38.3) — what the layout hands the sidebar
 *  and the gate, and what "/" ranks. One place, so the sidebar, the home
 *  redirect, the logo and the home picker can never disagree about which
 *  pages a person may open (each disagreement was a redirect loop). */
export function navFlagsFor(v: Viewer) {
  const raising = hasRaisingAccess(v);
  const tm = hasTmAccess(v);
  // the OGX workspace (v25): OGT/OGV crews live in /signups
  const ogx = hasOgxAccess(v);
  // the Consideration module (v26): IR calls + the CV pool
  const consideration = hasConsiderationAccess(v);
  return {
    raising,
    tm,
    ogx,
    consideration,
    // B2C CIC (v33.29): the B2C crew enters /signups for the CIC queue they
    // sell into — both OGX sides, read through their own gate server-side
    signups: ogx || isB2C(v),
    // the CXP module (v35): ECB submission tracking for all four product
    // functions, gated per SIDE — see src/lib/cxp/rbac.ts for the rules
    cxp: hasCxpAccess(v),
    membership: canManageMembership(v),
    // the tab AND the page: canSeePlanning alone also admits `master`
    // people with no planned function, whom the board has nothing for
    planning: canOpenPlanning(v),
    // OGT & OGV VPs/Directors (+ LCP/admin): the Expectation-Setting mail composer
    ogtMail:
      v.isAdmin ||
      v.role === "LCP" ||
      ((v.role === "LCVP" || v.role === "Director") &&
        ["OGT", "OGV"].some((f) => v.functions.includes(f) || v.sub_functions.includes(f))),
    // the calendar belongs to every module member (touch points, v29)
    calendar: canOpenCalendar(v),
    // /dashboard = anyone who owns at least one LANE there — raising (ICX /
    // B2B / B2C), OGX (v28) or Consideration (v29). Mirrors how
    // dashboard/page.tsx builds `views`, so the tab never leads someone to an
    // empty page. v32: the LC-wide overseers (TM & F&L leadership) read EVERY
    // lane; v33.17: TM core gained the TM lane.
    dashboard: raising || ogx || consideration || seesEveryLane(v) || isTmCore(v),
    // v33.24 — the Emails tab, module or not (rides the gate like /attendance)
    mailbox: canUseMailboxTab(v),
    // v36.8 — the Activate 26' bid: MMs and above, module or not
    activation: canSeeActivationBid(v),
    // v38 — the No Peace War Room: the F&L VP (+ LCP/admins) by code
    warRoom: canSeeWarRoom(v),
  };
}

export type NavFlags = ReturnType<typeof navFlagsFor>;

/** The EB opens on the Dashboard (v33.12). */
export const isEbHome = (v: Viewer) => v.isAdmin || v.role === "LCP" || v.role === "LCVP";

/** "/" for this person, under the LC's tab rules. */
export function homeFor(v: Viewer, overrides: Record<string, TabOverride>, flags: HomeNav = navFlagsFor(v)): string {
  return homeRouteFor(flags, overrides, { eb: isEbHome(v) });
}

/** THE PAGES A PERSON MAY PICK AS THEIR HOME (v37.2) — only ones they can
 *  actually open, in the order of the sidebar. Used by the settings picker
 *  AND by "/" before it honours a stored choice, so a module someone has
 *  since lost is never where they land. Each entry uses the SAME predicate
 *  as the page's own gate (v38.3); with `overrides`, a tab the LC's rules
 *  hide from them drops out too. */
export function homeOptionsFor(
  v: Viewer,
  overrides: Record<string, TabOverride> = {}
): { value: string; label: string }[] {
  const f = navFlagsFor(v);
  const out: { value: string; label: string }[] = [];
  const add = (ok: boolean, value: string, label: string) => {
    if (ok && tabVisible(ok, overrides[value])) out.push({ value, label });
  };
  add(f.dashboard && dashboardLaneViews(v).length > 0, "/dashboard", "Dashboard");
  add(f.raising, "/accounts", "Raising");
  // OGX only: the B2C crew reaches the CIC queue through Raising, and its
  // /signups gate (b2cCicAccess) is narrower than the sidebar's isB2C
  add(f.ogx, "/signups", "Sign-ups");
  add(f.consideration, "/consideration", "Consideration");
  add(f.cxp, "/cxp", "CXP");
  add(f.calendar, "/calendar", "Calendar");
  // attendance is every member's (v29), module or not
  add(true, "/attendance", "Attendance");
  add(f.tm, "/members", "Members");
  add(f.membership, "/membership", "Membership");
  add(f.planning, "/planning", "Planning");
  add(true, "/profile", "My profile");
  return out;
}
