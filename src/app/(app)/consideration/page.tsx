import { redirect } from "next/navigation";
import { getViewer, listCvsPage, listIrCalls, listPartnerLcs } from "@/server/data";
import { hasConsiderationAccess } from "@/lib/rbac";
import { ConsiderationView } from "@/components/crm/consideration-view";

export const metadata = { title: "Consideration" };

/** THE CONSIDERATION MODULE (v26): International Relations calls with partner
 *  LCs abroad (screenshots on the system Drive) + the shared CV pool (private
 *  storage, Gemini-extracted fields, searchable — also by The Blue Man). */
export default async function ConsiderationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) redirect("/");
  const sp = await searchParams;

  const tab: "calls" | "cvs" = sp.tab === "cvs" ? "cvs" : "calls";
  const page = Math.max(0, (parseInt(sp.page ?? "1", 10) || 1) - 1);

  const [lcs, calls, cvs] = await Promise.all([
    listPartnerLcs(viewer),
    listIrCalls(viewer, tab === "calls" ? page : 0),
    listCvsPage(viewer, { q: sp.q }, tab === "cvs" ? page : 0),
  ]);

  return (
    <ConsiderationView
      tab={tab}
      lcs={lcs}
      calls={calls}
      cvs={cvs}
      q={sp.q ?? ""}
      viewer={{
        id: viewer.id,
        isVp: viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role),
      }}
    />
  );
}
