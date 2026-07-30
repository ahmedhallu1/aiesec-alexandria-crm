import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import { hasOgxAccess, hasRaisingAccess } from "@/lib/rbac";

/** Accounts are the daily workspace — the home route lands there. OGX-only
 *  crews (v25) have no accounts: their home is the sign-ups pool. */
export default async function Home() {
  const viewer = await getViewer();
  if (!hasRaisingAccess(viewer) && hasOgxAccess(viewer)) redirect("/signups");
  redirect("/accounts");
}
