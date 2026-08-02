import {
  getViewer, listAccountsPage, listManualArchived, listVisibleMembers,
  listReassignTargetsForViewer,
} from "@/server/data";
import type { AccountFilters } from "@/server/data";
import {
  accountScope, allowedAccountFunctions, canManageArchive, canRequestPodioSubmit,
  canViewArchive, icxFunctions,
} from "@/lib/rbac";
import { AccountsView } from "@/components/crm/accounts-view";
import { memberIsB2B, memberIsB2C, type Stage } from "@/lib/types";

export const metadata = { title: "Accounts" };

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
  const podioAllowed = canRequestPodioSubmit(viewer);
  const podioPending = params.podio === "1" && podioAllowed && !archived;

  const filters: AccountFilters = {
    q: params.q || undefined,
    fn:
      params.fn === "IGV" || params.fn === "IGT" || params.fn === "B2B" ||
      params.fn === "BD" || params.fn === "B2C"
        ? params.fn
        : undefined,
    // product/sub only apply to IGT rows — a lingering param after switching
    // the Function filter must not silently empty the list
    product:
      (params.product === "GTa" || params.product === "GTe") &&
      (!params.fn || params.fn === "IGT")
        ? params.product
        : undefined,
    project: params.project || undefined,
    stage: params.stage && params.stage !== "Out of Process" ? (params.stage as Stage) : undefined,
    lastStatus: params.lastStatus || undefined,
    flag:
      params.flag === "contact_limit" || params.flag === "next_step_missing"
        ? params.flag
        : undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    subProduct: params.sub && (!params.fn || params.fn === "IGT") ? params.sub : undefined,
    sort: params.sort || undefined,
    dir: params.dir === "asc" ? "asc" : params.dir === "desc" ? "desc" : undefined,
    // the Responsible filter — "none" = unassigned (imported market research)
    responsibleId: params.resp || undefined,
    archived,
    podioPending,
  };

  // the list is PAGINATED since the big market-research import (v22) — the
  // server returns one page + the total match count. Page size is the user's
  // pick (?size=30|50|100|200, default 100).
  const SIZE_OPTIONS = [30, 50, 100, 200];
  const pageSize = SIZE_OPTIONS.includes(Number(params.size)) ? Number(params.size) : 100;
  const requestedPage = Math.max(0, (Number(params.page) || 1) - 1);
  const [{ rows, total, page }, members, reassignTo, manualArchived] = await Promise.all([
    listAccountsPage(viewer, filters, requestedPage, pageSize),
    // narrow to the Function filter that is switched on, so the Responsible
    // list only offers people who can appear in THIS view
    listVisibleMembers(viewer, filters.fn ? { fn: filters.fn } : {}),
    listReassignTargetsForViewer(viewer),
    archived ? listManualArchived() : Promise.resolve([]),
  ]);
  // Responsible options: every visible member (+ Unassigned — only for scopes
  // that can actually SEE ownerless accounts, i.e. function-wide and LCP;
  // member/TL scopes filter by responsible ids and never match NULL)
  const respOptions = [
    ...(scope.kind !== "members" ? [{ id: "none", label: "— Unassigned" }] : []),
    ...members
      .filter((m) => m.role !== "LCP")
      .map((m) => ({ id: m.id, label: m.nickname || m.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  return (
    <AccountsView
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      pageSizeOptions={SIZE_OPTIONS}
      manualArchived={manualArchived.map((b) => ({
        id: b.id,
        name: b.account_name,
        reason: b.comments,
        createdAt: b.created_at,
        addedBy: b.added_by_member?.nickname || b.added_by_member?.name || null,
      }))}
      members={members.map((m) => ({
        id: m.id,
        label: m.nickname || m.name,
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
        label: m.nickname || m.name,
        functions: [
          ...(m.functions ?? []),
          ...(memberIsB2B(m)
            ? ["B2B", "BD"].filter((f) => !(m.functions ?? []).includes(f))
            : []),
          ...(memberIsB2C(m) && !(m.functions ?? []).includes("B2C") ? ["B2C"] : []),
        ],
      }))}
      respOptions={respOptions}
      viewer={{
        id: viewer.id,
        name: viewer.nickname || viewer.name,
        role: viewer.role,
        isAdmin: viewer.isAdmin,
        canAssignOthers:
          viewer.isAdmin || ["LCP", "LCVP", "Director", "Team Leader"].includes(viewer.role),
        canViewArchive: archiveAllowed,
        canManageArchive: canManageArchive(viewer),
        canRemoveArchived:
          viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role),
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
        canPodioSubmit: podioAllowed,
      }}
      filters={{
        q: params.q ?? "",
        fn: params.fn ?? "",
        product: params.product ?? "",
        project: params.project ?? "",
        stage: params.stage ?? "",
        lastStatus: params.lastStatus ?? "",
        resp: params.resp ?? "",
        sub: params.sub ?? "",
        sort: params.sort ?? "",
        dir: params.dir ?? "",
        flag: params.flag ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
        archived: archived ? "1" : "",
        podio: podioPending ? "1" : "",
      }}
    />
  );
}
