import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import {
  canManageMembership, canSeePlanning, hasConsiderationAccess, hasOgxAccess,
  hasRaisingAccess, hasTmAccess,
} from "@/lib/rbac";

/** Home lands on the viewer's OWN workspace — nobody with a live module
 *  should ever meet the "coming soon" screen at "/" (v26). Priority:
 *  accounts (raising) → sign-ups (OGX) → consideration → TM directory →
 *  membership (EB) → planning → accounts (the module-less see Soon there). */
export default async function Home() {
  const viewer = await getViewer();
  // MY HOME (v37.2) — a person's own pick wins, but only while it is still a
  // page they may open (a module they have since left falls through)
  const { resolveMemberSettings } = await import("@/lib/member-settings");
  const { homeOptionsFor } = await import("@/lib/home-options");
  const home = resolveMemberSettings((viewer as { settings?: unknown }).settings).defaults.home;
  if (home && homeOptionsFor(viewer).some((o) => o.value === home)) redirect(home);
  // THE EB STEERS (v33.12) — the LCP and the LCVPs open on the Dashboard,
  // because the numbers are the first thing they came for. It has to be
  // checked BEFORE the module redirects, or an LCVP with raising access
  // lands in Raising like everyone else.
  if (viewer.isAdmin || viewer.role === "LCP" || viewer.role === "LCVP")
    redirect("/dashboard");
  if (hasRaisingAccess(viewer)) redirect("/accounts");
  if (hasOgxAccess(viewer)) redirect("/signups");
  if (hasConsiderationAccess(viewer)) redirect("/consideration");
  if (hasTmAccess(viewer)) redirect("/members");
  if (canManageMembership(viewer)) redirect("/membership");
  if (canSeePlanning(viewer)) redirect("/planning");
  redirect("/accounts");
}
