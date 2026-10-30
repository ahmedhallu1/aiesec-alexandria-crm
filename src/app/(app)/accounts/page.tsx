import { gateTab } from "@/server/tabs";
import {
  countUnassigned, getViewer, listAccountsPage, listManualArchived, listVisibleMembers,
  listReassignTargetsForViewer, listTeamFilterOptions, unreportedVisits,
} from "@/server/data";
import type { AccountFilters } from "@/server/data";
import {
  accountScope, allowedAccountFunctions, canManageArchive,
  canImportAccounts, canLogDirectVisit, canPurgeArchive,
  canSeeUnassigned, canSetRequestStateOnCreate, canViewArchive, icxFunctions,
} from "@/lib/rbac";
import { AccountsView } from "@/components/crm/accounts-view";
import { memberIsB2B, memberIsB2C } from "@/lib/types";
import { PAGE_SIZES, pageSizeOf, personalPageSize } from "@/lib/page-size";
import { accountFiltersFromParams } from "@/lib/filters-from-params";

export const metadata = { title: "Raising" };

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  await gateTab(viewer, "/accounts");
  const params = await searchParams;

  const allowedFns = allowedAccountFunctions(viewer);
  // the archive is LC-wide (v22.2) — everyone may browse it
  const archiveAllowed = canViewArchive();
  const archived = params.archived === "1" && archiveAllowed;
  const scope = accountScope(viewer);
  // WHO NEEDS THE RESPONSIBLE COLUMN (v33.21). "Does my scope contain someone
  // other than me" was the wrong question: a Coordinator's scope IS just
  // themselves, yet their list also carries every UNOWNED market-research row
  // (canSeeUnassigned) — so the column that says whose account this is went
  // missing exactly where "mine vs nobody's" is the thing to tell apart.
  const seesOthers =
    !(scope.kind === "members" && scope.ids.length <= 1) || canSeeUnassigned(viewer);
  // the B2B/BD leaders' Podio submission worklist

  const filters: AccountFilters = accountFiltersFromParams(params, { archiveAllowed });

  // the list is PAGINATED since the big market-research import (v22) — the
  // server returns one page + the total match count. Page size is the user's
  // pick (?size=30|50|100|200, default 100).
  const pageSize = pageSizeOf(params.size, personalPageSize(viewer));
  const requestedPage = Math.max(0, (Number(params.page) || 1) - 1);
  const [{ rows, total, page }, members, reassignTo, manualArchived] = await Promise.all([
    listAccountsPage(viewer, filters, requestedPage, pageSize),
    // narrow to the Function filter that is switched on, so the Responsible
    // list only offers people who can appear in THIS view
    listVisibleMembers(viewer, filters.fn ? { fn: filters.fn } : {}),
    listReassignTargetsForViewer(viewer),
    archived ? listManualArchived() : Promise.resolve([]),
  ]);
  // Responsible options: every visible member, plus "— Unassigned" — offered
  // to everyone who can SEE unowned accounts (canFilterUnassigned, so every
  // role above Member), and only when there actually ARE some to find.
  const unassignedCount = await countUnassigned(viewer, filters.fn);
  // VISITS THAT HAPPENED AND WERE NEVER REPORTED (v33.35) — the same warning
  // the IR floor got, scoped the same way: yours, your team's, your function's
  const overdueVisits = archived ? [] : await unreportedVisits(viewer);
  const respOptions = [
    ...(unassignedCount > 0
      ? [{ id: "none", label: `— Unassigned (${unassignedCount})` }]
      : []),
    ...members
      .filter((m) => m.role !== "LCP")
      .map((m) => ({ id: m.id, label: m.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  return (
    <AccountsView
      overdueVisits={overdueVisits}
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZES}
      manualArchived={manualArchived.map((b) => ({
        id: b.id,
        name: b.account_name,
        reason: b.comments,
        createdAt: b.created_at,
        addedBy: b.added_by_member?.name || null,
      }))}
      members={members.map((m) => ({
        id: m.id,
        label: m.name,
        functions: [
          ...(m.functions ?? []),
          // B2B/BD (and B2C) may live in sub-functions only — synthesize the
          // labels so either account kind finds the crew
          ...(memberIsB2B(m)
            ? ["B2B", "BD"].filter((f) => !(m.functions ?? []).includes(f))
            : []),
          ...(memberIsB2C(m) && !(m.functions ?? []).includes("B2C") ? ["B2C"] : []),
        ],
      }))}
      reassignTargets={reassignTo.map((m) => ({
        id: m.id,
        label: m.name,
        functions: [
          ...(m.functions ?? []),
          ...(memberIsB2B(m)
            ? ["B2B", "BD"].filter((f) => !(m.functions ?? []).includes(f))
            : []),
          ...(memberIsB2C(m) && !(m.functions ?? []).includes("B2C") ? ["B2C"] : []),
        ],
      }))}
      respOptions={respOptions}
      teamOptions={await listTeamFilterOptions(viewer, { fn: filters.fn })}
      viewer={{
        id: viewer.id,
        name: viewer.name,
        role: viewer.role,
        isAdmin: viewer.isAdmin,
        canAssignOthers:
          viewer.isAdmin || ["LCP", "LCVP", "Director", "Team Leader"].includes(viewer.role),
        canSetRequestState: canSetRequestStateOnCreate(viewer),
        canViewArchive: archiveAllowed,
        canManageArchive: canManageArchive(viewer),
        // v33.12 — MMs and above, matching who may work the archive at all.
        // It cascades and cannot be undone, so never a plain Member by
        // default; switchable since v38.4, and `bulkDeleteArchived` asks the
        // very same predicate.
        canRemoveArchived: canPurgeArchive(viewer),
        // v38.4 — both switchable from Settings → Rules
        canImport: canImportAccounts(viewer),
        canDirectVisit: canLogDirectVisit(viewer),
        allowedFns,
        showFnFilter: allowedFns.length > 1,
        // IGV-only viewers: every account is IGV, so the Product column is
        // dead weight — the list shows the PROJECT there instead
        igvOnly:
          !viewer.isAdmin && viewer.role !== "LCP" &&
          icxFunctions(viewer).length === 1 && icxFunctions(viewer)[0] === "IGV" &&
          !allowedFns.some((f) => f === "B2B" || f === "BD"),
        // same idea for the B2C crew: every account is B2C — show the TYPE
        b2cOnly:
          !viewer.isAdmin && viewer.role !== "LCP" &&
          allowedFns.length === 1 && allowedFns[0] === "B2C",
        // sub_product lives on IGT accounts only — offer the filter to people
        // who can actually SEE IGT accounts
        igtAccess:
          viewer.isAdmin || viewer.role === "LCP" || icxFunctions(viewer).includes("IGT"),
        seesOthers,
      }}
      filters={{
        q: params.q ?? "",
        fn: params.fn ?? "",
        product: params.product ?? "",
        lane: params.lane ?? "",
        project: params.project ?? "",
        stage: params.stage ?? "",
        lastStatus: params.lastStatus ?? "",
        resp: params.resp ?? "",
        team: params.team ?? "",
        sub: params.sub ?? "",
        industry: params.industry ?? "",
        type: params.type ?? "",
        proposal: params.proposal ?? "",
        deals: params.deals ?? "",
        podio: params.podio ?? "",
        sort: params.sort ?? "",
        dir: params.dir ?? "",
        flag: params.flag ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
        archived: archived ? "1" : "",
      }}
    />
  );
}
