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
  if (hasRaisingAccess(viewer)) redirect("/accounts");
  if (hasOgxAccess(viewer)) redirect("/signups");
  if (hasConsiderationAccess(viewer)) redirect("/consideration");
  if (hasTmAccess(viewer)) redirect("/members");
  if (canManageMembership(viewer)) redirect("/membership");
  if (canSeePlanning(viewer)) redirect("/planning");
  redirect("/accounts");
}
