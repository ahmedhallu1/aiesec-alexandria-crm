import {
  countUnassigned, getViewer, listAccountsPage, listManualArchived, listVisibleMembers,
  listReassignTargetsForViewer, listTeamFilterOptions,
} from "@/server/data";
import type { AccountFilters } from "@/server/data";
import {
  accountScope, allowedAccountFunctions, canManageArchive,
  canSetRequestStateOnCreate, canViewArchive, icxFunctions,
} from "@/lib/rbac";
import { AccountsView } from "@/components/crm/accounts-view";
import { memberIsB2B, memberIsB2C, type Stage } from "@/lib/types";
import { PAGE_SIZES, pageSizeOf } from "@/lib/page-size";

export const metadata = { title: "Raising" };

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  const params = await searchParams;

  const allowedFns = allowedAccountFunctions(viewer);
  // the archive is LC-wide (v22.2) — everyone may browse it
  const archiveAllowed = canViewArchive();
  const archived = params.archived === "1" && archiveAllowed;
  const scope = accountScope(viewer);
  const seesOthers = !(scope.kind === "members" && scope.ids.length <= 1);
  // the B2B/BD leaders' Podio submission worklist

  const filters: AccountFilters = {
    q: params.q || undefined,
    fn:
      params.fn === "IGV" || params.fn === "IGT" || params.fn === "B2B" ||
      params.fn === "BD" || params.fn === "B2C"
        ? params.fn
        : undefined,
    // product/sub only apply to IGT rows — a lingering param after switching
    // the Function filter must not silently empty the list
    // MULTI-SELECT (v33.3): every column filter can carry several picks as a
    // comma list. Each pick is validated on its own, so one junk value in a
    // hand-edited URL drops itself instead of the whole filter.
    product: (!params.fn || params.fn === "IGT"
      ? keepCsv(params.product, ["GTa", "GTe"])
      : undefined) as AccountFilters["product"],
    project: params.project || undefined,
    stage: keepCsv(params.stage, undefined, (v) => v !== "Out of Process") as Stage | undefined,
    lastStatus: params.lastStatus || undefined,
    flag:
      params.flag === "needs_podio" || params.flag === "next_step_missing"
        ? params.flag
        : undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    subProduct: params.sub && (!params.fn || params.fn === "IGT") ? params.sub : undefined,
    sort: params.sort || undefined,
    dir: params.dir === "asc" ? "asc" : params.dir === "desc" ? "desc" : undefined,
    // the Responsible filter — "none" = unassigned (imported market research)
    responsibleId: params.resp || undefined,
    teamId: params.team || undefined,
    archived,
  };

  // the list is PAGINATED since the big market-research import (v22) — the
  // server returns one page + the total match count. Page size is the user's
  // pick (?size=30|50|100|200, default 100).
  const pageSize = pageSizeOf(params.size);
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
  // to VPs, Directors and the LCP only (distributing the unowned pool is the
  // leadership act; an MM meets those accounts inline in their own list), and
  // only when there actually ARE unowned accounts to find.
  const unassignedCount = await countUnassigned(viewer, filters.fn);
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
        // It cascades and cannot be undone, so never a plain Member.
        canRemoveArchived:
          viewer.isAdmin ||
          ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(viewer.role),
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
        project: params.project ?? "",
        stage: params.stage ?? "",
        lastStatus: params.lastStatus ?? "",
        resp: params.resp ?? "",
        team: params.team ?? "",
        sub: params.sub ?? "",
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

/** Keeps only the valid picks of a comma-joined filter value, so one bad
 *  entry in a hand-edited URL drops itself rather than the whole filter. */
function keepCsv(
  raw: string | undefined,
  allowed?: string[],
  extra?: (v: string) => boolean
): string | undefined {
  const kept = (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => (allowed ? allowed.includes(v) : true))
    .filter((v) => (extra ? extra(v) : true));
  return kept.length > 0 ? kept.join(",") : undefined;
}
