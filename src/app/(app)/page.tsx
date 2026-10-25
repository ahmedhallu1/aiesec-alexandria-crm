import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import { tabOverridesForViewer } from "@/server/tabs";
import { homeFor, homeOptionsFor } from "@/lib/home-options";

/** Home lands on the viewer's OWN workspace — nobody with a live module
 *  should ever meet the "coming soon" screen at "/" (v26). The order lives in
 *  `homeRouteFor` (src/lib/tabs.ts) since v38.3, shared with the logo and the
 *  gate's bounce, so the three can never point at different places. */
export default async function Home() {
  const viewer = await getViewer();
  // v38 — a tab the LCP/admins hid from this person is never "home", and one
  // they opened to them can be (src/lib/tabs.ts)
  const ov = await tabOverridesForViewer(viewer);
  // MY HOME (v37.2) — a person's own pick wins, but only while it is still a
  // page they may open: a module they have since left, or a tab the LC's
  // rules now hide from them, falls through (homeOptionsFor checks both)
  const { resolveMemberSettings } = await import("@/lib/member-settings");
  const home = resolveMemberSettings((viewer as { settings?: unknown }).settings).defaults.home;
  if (home && homeOptionsFor(viewer, ov).some((o) => o.value === home)) redirect(home);
  redirect(homeFor(viewer, ov));
}
