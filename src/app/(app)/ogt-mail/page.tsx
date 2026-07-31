import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import { OgtMailView } from "@/components/crm/ogt-mail-view";

export const metadata = { title: "Expectation mail" };

/** "Home Entity Expectation Setting Mail" — OGT & OGV VPs/Directors (+ LCP
 *  and admin) compose the standardized pre-approval email to a hosting
 *  entity, review the exact email in-app, then SEND it from their own Gmail
 *  (or save it as a draft). OGT-only viewers get the OGT variant (Salary
 *  line), OGV-only the OGV variant (TN Fee line); both/LCP/admin pick. */
export default async function OgtMailPage() {
  const viewer = await getViewer();
  const ownPrograms = (["OGT", "OGV"] as const).filter(
    (f) => viewer.functions.includes(f) || viewer.sub_functions.includes(f)
  );
  const leader = viewer.role === "LCVP" || viewer.role === "Director";
  const allowed =
    viewer.isAdmin || viewer.role === "LCP" || (leader && ownPrograms.length > 0);
  if (!allowed) redirect("/");

  const programs: ("OGT" | "OGV")[] =
    viewer.isAdmin || viewer.role === "LCP" || ownPrograms.length === 0
      ? ["OGT", "OGV"]
      : [...ownPrograms];

  return <OgtMailView viewerId={viewer.id} hasGoogle={!!viewer.google_refresh_token} programs={programs} />;
}
