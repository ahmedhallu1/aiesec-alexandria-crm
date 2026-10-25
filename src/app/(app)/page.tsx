import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import {
  canManageMembership, canSeePlanning, hasConsiderationAccess, hasOgxAccess,
  hasRaisingAccess, hasTmAccess,
} from "@/lib/rbac";
import { tabOverridesForViewer } from "@/server/tabs";
import { tabVisible } from "@/lib/tabs";

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
  // v38 — a tab the LCP/admins hid from this person is never "home", and one
  // they opened to them can be (src/lib/tabs.ts)
  const ov = await tabOverridesForViewer(viewer);
  // the module order only ever LOSES a hidden tab here — a tab opened to
  // somebody by a rule is a place they may go, not where they live
  const open = (href: string, builtIn: boolean) => builtIn && tabVisible(builtIn, ov[href]);
  if (home && homeOptionsFor(viewer).some((o) => o.value === home) && ov[home] !== "hide") redirect(home);
  // THE EB STEERS (v33.12) — the LCP and the LCVPs open on the Dashboard,
  // because the numbers are the first thing they came for. It has to be
  // checked BEFORE the module redirects, or an LCVP with raising access
  // lands in Raising like everyone else.
  const eb = viewer.isAdmin || viewer.role === "LCP" || viewer.role === "LCVP";
  const order: [string, boolean][] = [
    ["/dashboard", eb],
    ["/accounts", hasRaisingAccess(viewer)],
    ["/signups", hasOgxAccess(viewer)],
    ["/consideration", hasConsiderationAccess(viewer)],
    ["/members", hasTmAccess(viewer)],
    ["/membership", canManageMembership(viewer)],
    ["/planning", canSeePlanning(viewer)],
  ];
  const first = order.find(([href, builtIn]) => open(href, builtIn));
  if (first) redirect(first[0]);
  // a tab opened to them by a rule, before the module-less fallback
  const granted = Object.keys(ov).find((h) => ov[h] === "show");
  if (granted) redirect(granted);
  redirect(ov["/accounts"] === "hide" ? "/profile" : "/accounts");
}
