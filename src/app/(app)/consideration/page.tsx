import { gateTab } from "@/server/tabs";
import {
  getViewer, irCallFilterOptions, irCallHandoverTargets, listConsiderationCrew,
  listCvsPage, listIrCalls, listIrSlotRequests,
  listPartnerLcDetails,
  myIrBooking,
} from "@/server/data";
import {
  canAssignPartnershipToOthers, canHandOverIrCalls, canManagePartnerLcs,
  canRecordPastIrCall, canSeeCvPool,
  canUseIgtExpectationMail, fnSetting, hasConsiderationAccess, icxFunctions, reachIds,
} from "@/lib/rbac";
import { env } from "@/lib/env";
import {
  approvalBoards, approvalCreditTargets, approvalFormOptions, approvalLanes,
  approvalSuggestions, listIcxApprovals,
} from "@/server/icx-approvals";
import { ConsiderationView } from "@/components/crm/consideration-view";
import { PAGE_SIZES, pageSizeOf, personalPageSize } from "@/lib/page-size";

export const metadata = { title: "Consideration" };

/** THE CONSIDERATION MODULE (v26): International Relations calls with partner
 *  LCs abroad (screenshots on the system Drive) + the shared CV pool (private
 *  storage, Gemini-extracted fields, searchable — also by The Violet Man).
 *  v27: each member's public BOOKING LINK (/book/<slug>) — booked calls land
 *  scheduled on top of the IR log with an in-call notes dialog; the CV pool
 *  is IGT-only (companies want talent — an IGV-only VP sees just IR calls). */
export default async function ConsiderationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  await gateTab(viewer, "/consideration", hasConsiderationAccess(viewer));
  const sp = await searchParams;

  const showCvs = canSeeCvPool(viewer);
  // the incoming-EP expectation mail is the IGT leadership's to send (v33.3)
  const showExpectation = canUseIgtExpectationMail(viewer);
  const tab: "calls" | "cvs" | "expectation" | "lcs" | "approvals" =
    sp.tab === "cvs" && showCvs
      ? "cvs"
      : sp.tab === "expectation" && showExpectation
        ? "expectation"
        : sp.tab === "lcs"
          ? "lcs"
          : sp.tab === "approvals"
            ? "approvals"
            : "calls";
  const page = Math.max(0, (parseInt(sp.page ?? "1", 10) || 1) - 1);
  // rows per page is the member's own choice (v31) — whitelisted here
  const pageSize = pageSizeOf(sp.size, personalPageSize(viewer));

  // the call log's filters (v33.32) — server-side, so they filter the whole
  // history rather than the page in hand
  const callFilters = {
    q: sp.callq,
    product: sp.callproduct,
    status: sp.callstatus,
    member: sp.callmember,
    lc: sp.calllc,
    has: sp.callhas,
    sort: sp.callsort,
    dir: (sp.calldir === "asc" ? "asc" : sp.calldir === "desc" ? "desc" : undefined) as
      | "asc"
      | "desc"
      | undefined,
    from: sp.callfrom,
    to: sp.callto,
  };

  // 🤝 PARTNERSHIP TARGETS — who the viewer may hand one to. WIDENED in
  // v35.1: an MM reaches their whole ICX FUNCTION rather than their own team
  // (an LC is approached by whoever is free, and an IGV MM could not hand an
  // IGV target to an IGV member on another team), and a MEMBER may take one
  // themselves — setting your own target and walking the road to it is the
  // point of the process. The picker below must offer exactly what
  // `resolvePartnershipTarget` allows: never more, never less.
  const canAssignPartnerships = hasConsiderationAccess(viewer);
  const isLead =
    viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);

  // 🤝 HAND-OVER (v33.58) — the same MM-and-above gate as partnership targets:
  // a Member holds their calls, an MM redistributes them, because it moves a
  // commitment off one person's calendar onto another's. The rule lives in
  // rbac.ts since v38.4 so Settings → Rules can change it without a deploy,
  // and `reassignIrCall` asks the very same predicate.
  const canHandOverCalls = canHandOverIrCalls(viewer);
  const [lcs, calls, cvs, booking, callOptions, crewAll, handoverTargets, slotRequests] = await Promise.all([
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
    canAssignPartnerships ? listConsiderationCrew(viewer) : Promise.resolve([]),
    canHandOverCalls ? irCallHandoverTargets(viewer) : Promise.resolve([]),
    listIrSlotRequests(viewer),
  ]);
  // 🏆 APPROVALS (v37) — read only on their own tab: nobody on the calls tab
  // pays for the SubTool comparison or the account list
  const approvals =
    tab === "approvals"
      ? await Promise.all([
          listIcxApprovals(viewer),
          approvalSuggestions(viewer),
          approvalBoards(viewer),
          approvalCreditTargets(viewer),
          approvalFormOptions(viewer),
        ]).then(([rows, suggestions, boards, creditTargets, options]) => ({
          rows,
          suggestions,
          boards,
          creditTargets,
          options,
          lanes: approvalLanes(viewer),
        }))
      : null;
  // cross-team targets are the FUNCTION's call (v33.39, function defaults)
  const crossTeam = icxFunctions(viewer).some(
    (fn) => fnSetting(viewer, fn).partnershipCrossTeam
  );
  const myFns = icxFunctions(viewer);
  const isMm = ["Team Leader", "Coordinator"].includes(viewer.role);
  const partnershipTargets = isLead
    ? crewAll
    : isMm
      ? crossTeam
        ? crewAll
        : crewAll.filter(
            (m) => m.id === viewer.id || m.fns.some((f) => myFns.includes(f as (typeof myFns)[number]))
          )
      : // a Member takes one themselves and nothing else
        crewAll.filter((m) => m.id === viewer.id);
  // the record form's product defaults to the member's own side
  const icx = icxFunctions(viewer);
  const defaultProduct: "GV" | "GT" | null =
    icx.length === 1 ? (icx[0] === "IGV" ? "GV" : "GT") : null;

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
      partnershipTargets={partnershipTargets.map((m) => ({
        id: m.id, name: m.name, role: m.role,
      }))}
      handoverTargets={handoverTargets}
      slotRequests={slotRequests}
      approvals={approvals}
      viewer={{
        id: viewer.id,
        isVp: viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role),
        // a Team Leader answers for their team's calls too (v33.33)
        teamIds: reachIds(viewer),
        showCvs,
        showExpectation,
        // removing a partner LC is an MM-and-up act: it is the shared
        // registry every call and CV hangs off (switchable since v38.4)
        canManageLcs: canManagePartnerLcs(viewer),
        canAssignPartnerships,
        // MM AND ABOVE — the acts that touch SOMEBODY ELSE's target: handing
        // one out, clearing it, moving it along. Taking one yourself needs
        // only `canAssignPartnerships` (v35.1).
        canTargetOthers: canAssignPartnershipToOthers(viewer),
        canHandOverCalls,
        canRecordManual: canRecordPastIrCall(viewer),
        defaultProduct,
      }}
    />
  );
}
