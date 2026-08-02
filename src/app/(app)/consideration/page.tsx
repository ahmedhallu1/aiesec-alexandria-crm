import { redirect } from "next/navigation";
import {
  getViewer, listCvsPage, listIrCalls, listPartnerLcDetails, myIrBooking,
} from "@/server/data";
import { canSeeCvPool, hasConsiderationAccess } from "@/lib/rbac";
import { env } from "@/lib/env";
import { ConsiderationView } from "@/components/crm/consideration-view";

export const metadata = { title: "Consideration" };

/** THE CONSIDERATION MODULE (v26): International Relations calls with partner
 *  LCs abroad (screenshots on the system Drive) + the shared CV pool (private
 *  storage, Gemini-extracted fields, searchable — also by The Blue Man).
 *  v27: each member's public BOOKING LINK (/book/<slug>) — booked calls land
 *  scheduled on top of the IR log with an in-call notes dialog; the CV pool
 *  is IGT-only (companies want talent — an IGV-only VP sees just IR calls). */
export default async function ConsiderationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) redirect("/");
  const sp = await searchParams;

  const showCvs = canSeeCvPool(viewer);
  const tab: "calls" | "cvs" = sp.tab === "cvs" && showCvs ? "cvs" : "calls";
  const page = Math.max(0, (parseInt(sp.page ?? "1", 10) || 1) - 1);

  const [lcs, calls, cvs, booking] = await Promise.all([
    listPartnerLcDetails(viewer),
    listIrCalls(viewer, tab === "calls" ? page : 0),
    showCvs
      ? listCvsPage(viewer, { q: sp.q }, tab === "cvs" ? page : 0)
      : Promise.resolve({ rows: [], total: 0, page: 0 }),
    myIrBooking(viewer),
  ]);

  return (
    <ConsiderationView
      tab={tab}
      lcs={lcs}
      calls={calls}
      cvs={cvs}
      q={sp.q ?? ""}
      booking={booking}
      origin={env.appUrl}
      viewer={{
        id: viewer.id,
        isVp: viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role),
        showCvs,
      }}
    />
  );
}
