import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import { OgtMailView } from "@/components/crm/ogt-mail-view";

export const metadata = { title: "OGT mail" };

/** OGT "Home Entity Expectation Setting Mail" — OGT VPs/Directors (+ LCP and
 *  admin) compose the standardized pre-approval email to a hosting entity;
 *  submitting drops a ready-to-review DRAFT in their own Gmail. */
export default async function OgtMailPage() {
  const viewer = await getViewer();
  const allowed =
    viewer.isAdmin ||
    viewer.role === "LCP" ||
    ((viewer.role === "LCVP" || viewer.role === "Director") && viewer.functions.includes("OGT"));
  if (!allowed) redirect("/");

  return <OgtMailView hasGoogle={!!viewer.google_refresh_token} />;
}
