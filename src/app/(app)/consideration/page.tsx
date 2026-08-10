import { redirect } from "next/navigation";
import {
  getViewer, irCallFilterOptions, listCvsPage, listIrCalls, listPartnerLcDetails,
  myIrBooking,
} from "@/server/data";
import { canSeeCvPool, canUseIgtExpectationMail, hasConsiderationAccess } from "@/lib/rbac";
import { env } from "@/lib/env";
import { ConsiderationView } from "@/components/crm/consideration-view";
import { PAGE_SIZES, pageSizeOf } from "@/lib/page-size";

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
  const pageSize = pageSizeOf(sp.size);

  // the call log's filters (v33.32) — server-side, so they filter the whole
  // history rather than the page in hand
  const callFilters = {
    q: sp.callq,
    product: sp.callproduct,
    status: sp.callstatus,
    member: sp.callmember,
    lc: sp.calllc,
    from: sp.callfrom,
    to: sp.callto,
  };

  const [lcs, calls, cvs, booking, callOptions] = await Promise.all([
    listPartnerLcDetails(viewer),
    listIrCalls(viewer, tab === "calls" ? page : 0, pageSize, undefined, callFilters),
    showCvs
      ? listCvsPage(
          viewer,
          {
            q: sp.q,
            // the CV tab's own LC filter — ?lc= is already the "jump to this
            // LC" anchor on the registry tab, so this one is namespaced
            lc: sp.cvlc,
            industry: sp.industry,
            status: sp.status,
            uploader: sp.uploader,
            phone: sp.cvphone,
          },
          tab === "cvs" ? page : 0,
          pageSize
        )
      : Promise.resolve({ rows: [], total: 0, page: 0 }),
    myIrBooking(viewer),
    irCallFilterOptions(viewer),
  ]);

  return (
    <ConsiderationView
      tab={tab}
      lcs={lcs}
      calls={calls}
      cvs={cvs}
      callFilters={callFilters}
      callOptions={callOptions}
      q={sp.q ?? ""}
      highlightLc={sp.lc ?? null}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZES}
      booking={booking}
      origin={env.appUrl}
      viewer={{
        id: viewer.id,
        isVp: viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role),
        // a Team Leader answers for their team's calls too (v33.33)
        teamIds: viewer.role === "Team Leader" ? viewer.teamMemberIds : [],
        showCvs,
        showExpectation,
        // removing a partner LC is an MM-and-up act: it is the shared
        // registry every call and CV hangs off
        canManageLcs:
          viewer.isAdmin ||
          ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(viewer.role),
      }}
    />
  );
}
