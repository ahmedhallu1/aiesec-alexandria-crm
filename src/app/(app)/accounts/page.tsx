import {
  getViewer, listAccounts, listManualArchived, listVisibleMembers,
} from "@/server/data";
import type { AccountFilters } from "@/server/data";
import { accountScope, allowedAccountFunctions, canViewArchive } from "@/lib/rbac";
import { AccountsView } from "@/components/crm/accounts-view";
import type { Stage } from "@/lib/types";

export const metadata = { title: "Accounts" };

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  const params = await searchParams;

  const allowedFns = allowedAccountFunctions(viewer);
  const archiveAllowed = canViewArchive(viewer);
  const archived = params.archived === "1" && archiveAllowed;
  const scope = accountScope(viewer);
  const seesOthers = !(scope.kind === "members" && scope.ids.length <= 1);

  const filters: AccountFilters = {
    q: params.q || undefined,
    fn:
      params.fn === "IGV" || params.fn === "IGT" || params.fn === "B2B"
        ? params.fn
        : undefined,
    product: params.product === "GTa" || params.product === "GTe" ? params.product : undefined,
    project: params.project || undefined,
    stage: params.stage && params.stage !== "Out of Process" ? (params.stage as Stage) : undefined,
    lastStatus: params.lastStatus || undefined,
    flag:
      params.flag === "contact_limit" || params.flag === "next_step_missing"
        ? params.flag
        : undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    archived,
  };

  // the Responsible filter is applied AFTER the query so its dropdown only
  // offers members who actually have accounts in the current view
  const [allRows, members, manualArchived] = await Promise.all([
    listAccounts(viewer, filters),
    listVisibleMembers(viewer),
    archived ? listManualArchived() : Promise.resolve([]),
  ]);
  const rows = params.resp
    ? allRows.filter((r) => r.responsible_id === params.resp)
    : allRows;
  const respOptions = [
    ...new Map(
      allRows.map((r) => [
        r.responsible_id,
        { id: r.responsible_id, label: r.responsible_nickname || r.responsible_name },
      ])
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <AccountsView
      rows={rows}
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
          // B2B may live in sub-functions only
          ...((m.sub_functions ?? []).includes("B2B") ? ["B2B"] : []),
        ],
      }))}
      respOptions={respOptions}
      viewer={{
        id: viewer.id,
        role: viewer.role,
        isAdmin: viewer.isAdmin,
        canAssignOthers:
          viewer.isAdmin || ["LCP", "LCVP", "Director", "Team Leader"].includes(viewer.role),
        canViewArchive: archiveAllowed,
        canRemoveArchived:
          viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role),
        allowedFns,
        showFnFilter: allowedFns.length > 1,
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
        flag: params.flag ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
        archived: archived ? "1" : "",
      }}
    />
  );
}
