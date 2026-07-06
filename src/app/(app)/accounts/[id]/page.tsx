import { notFound } from "next/navigation";
import { getAccount, getViewer, listReassignTargets } from "@/server/data";
import {
  canEditAccount, canEditRequestState, canEditTlComment, canEditVpComment, canReassignAccount,
} from "@/lib/rbac";
import { AccountDetailView } from "@/components/crm/account-detail-view";

export default async function AccountPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ report?: string }>;
}) {
  const viewer = await getViewer();
  const { id } = await params;
  const { report } = await searchParams;

  const result = await getAccount(viewer, id);
  if (!result) notFound();
  const { account, attempts, visits } = result;

  const reassignTargets = canReassignAccount(viewer, account)
    ? await listReassignTargets(viewer, account.function)
    : [];

  return (
    <AccountDetailView
      account={account}
      attempts={attempts}
      visits={visits}
      caps={{
        edit: canEditAccount(viewer, account),
        reassign: canReassignAccount(viewer, account),
        tlComment: canEditTlComment(viewer, account),
        vpComment: canEditVpComment(viewer, account),
        requestState: canEditRequestState(viewer, account),
      }}
      reassignTargets={reassignTargets.map((m) => ({
        id: m.id,
        label: m.nickname || m.name,
        function: m.function,
      }))}
      autoReportVisitId={report ?? null}
    />
  );
}
