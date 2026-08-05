import { redirect } from "next/navigation";
import {
  getViewer, listCvsPage, listIrCalls, listPartnerLcDetails, myIrBooking,
} from "@/server/data";
import { canSeeCvPool, canUseIgtExpectationMail, hasConsiderationAccess } from "@/lib/rbac";
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
  // the incoming-EP expectation mail is the IGT leadership's to send (v33.3)
  const showExpectation = canUseIgtExpectationMail(viewer);
  const tab: "calls" | "cvs" | "expectation" | "lcs" =
    sp.tab === "cvs" && showCvs
      ? "cvs"
      : sp.tab === "expectation" && showExpectation
        ? "expectation"
        : sp.tab === "lcs"
          ? "lcs"
          : "calls";
  const page = Math.max(0, (parseInt(sp.page ?? "1", 10) || 1) - 1);
  // rows per page is the member's own choice (v31) — whitelisted here
  const PAGE_SIZE_OPTIONS = [30, 50, 100, 200];
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(sp.size)) ? Number(sp.size) : 50;

  const [lcs, calls, cvs, booking] = await Promise.all([
    listPartnerLcDetails(viewer),
    listIrCalls(viewer, tab === "calls" ? page : 0, pageSize),
    showCvs
      ? listCvsPage(viewer, { q: sp.q }, tab === "cvs" ? page : 0, pageSize)
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
      highlightLc={sp.lc ?? null}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      booking={booking}
      origin={env.appUrl}
      viewer={{
        id: viewer.id,
        isVp: viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role),
        showCvs,
        showExpectation,
      }}
    />
  );
}
