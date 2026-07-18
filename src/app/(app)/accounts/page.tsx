import {
  getViewer, listAccounts, listManualArchived, listVisibleMembers,
  listReassignTargetsForViewer,
} from "@/server/data";
import type { AccountFilters } from "@/server/data";
import {
  accountScope, allowedAccountFunctions, canRequestPodioSubmit, canViewArchive,
} from "@/lib/rbac";
import { AccountsView } from "@/components/crm/accounts-view";
import { memberIsB2B, type Stage } from "@/lib/types";

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
  // the B2B/BD leaders' Podio submission worklist
  const podioAllowed = canRequestPodioSubmit(viewer);
  const podioPending = params.podio === "1" && podioAllowed && !archived;

  const filters: AccountFilters = {
    q: params.q || undefined,
    fn:
      params.fn === "IGV" || params.fn === "IGT" || params.fn === "B2B" || params.fn === "BD"
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
    podioPending,
  };

  // the Responsible filter is applied AFTER the query so its dropdown only
  // offers members who actually have accounts in the current view
  const [allRows, members, reassignTo, manualArchived] = await Promise.all([
    listAccounts(viewer, filters),
    listVisibleMembers(viewer),
    listReassignTargetsForViewer(viewer),
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
          // B2B/BD may live in sub-functions only (one function, two names) —
          // synthesize BOTH labels so either account kind finds the crew
          ...(memberIsB2B(m)
            ? ["B2B", "BD"].filter((f) => !(m.functions ?? []).includes(f))
            : []),
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
        flag: params.flag ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
        archived: archived ? "1" : "",
        podio: podioPending ? "1" : "",
      }}
    />
  );
}
