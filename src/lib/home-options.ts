import {
  canManageMembership, canSeePlanning, hasConsiderationAccess, hasOgxAccess,
  hasRaisingAccess, hasTmAccess, type Viewer,
} from "@/lib/rbac";
import { hasCxpAccess } from "@/lib/cxp/rbac";
import { dashboardLaneViews } from "@/lib/dashboard-lanes";

/** THE PAGES A PERSON MAY PICK AS THEIR HOME (v37.2) — only ones they can
 *  actually open, in the order of the sidebar. Used by the settings picker
 *  AND by "/" before it honours a stored choice, so a module someone has
 *  since lost is never where they land. */
export function homeOptionsFor(v: Viewer): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const add = (ok: boolean, value: string, label: string) => {
    if (ok) out.push({ value, label });
  };
  const anyModule =
    hasRaisingAccess(v) || hasOgxAccess(v) || hasConsiderationAccess(v) || hasTmAccess(v) ||
    hasCxpAccess(v) || canManageMembership(v);
  add(dashboardLaneViews(v).length > 0, "/dashboard", "Dashboard");
  add(hasRaisingAccess(v), "/accounts", "Raising");
  add(hasOgxAccess(v), "/signups", "Sign-ups");
  add(hasConsiderationAccess(v), "/consideration", "Consideration");
  add(hasCxpAccess(v), "/cxp", "CXP");
  add(anyModule, "/calendar", "Calendar");
  add(anyModule, "/attendance", "Attendance");
  add(hasTmAccess(v), "/members", "Members");
  add(canManageMembership(v), "/membership", "Membership");
  add(canSeePlanning(v), "/planning", "Planning");
  add(true, "/profile", "My profile");
  return out;
}
