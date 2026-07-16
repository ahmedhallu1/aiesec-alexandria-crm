import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { canViewAccount } from "@/lib/rbac";
import {
  findAccountRow, getAccount, getViewer, listReassignTargets,
} from "@/server/data";
import {
  canEditAccount, canEditRequestState, canReassignAccount,
} from "@/lib/rbac";
import { AccountDetailView } from "@/components/crm/account-detail-view";

/** Dynamic tab title = the account name — but ONLY for viewers allowed to see
 *  it (an unauthorized member never learns the name behind a guessed URL). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // getViewer (not the raw session) so the admin test view is honored here
  // too — the tab title obeys the impersonated member's scope
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return { title: "Account" };
  const account = await findAccountRow(id);
  if (!account || !canViewAccount(viewer, account)) return { title: "Account" };
  return { title: account.name };
}

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
  const { account, attempts, visits, comments, deals } = result;

  const reassignTargets = canReassignAccount(viewer, account)
    ? await listReassignTargets(viewer, account.function)
    : [];
  // the current responsible must always be present so the select shows them
  if (
    reassignTargets.length > 0 &&
    !reassignTargets.some((m) => m.id === account.responsible_id)
  ) {
    reassignTargets.unshift({
      id: account.responsible_id,
      name: account.responsible_name,
      nickname: account.responsible_nickname,
    } as (typeof reassignTargets)[number]);
  }

  return (
    <AccountDetailView
      account={account}
      attempts={attempts}
      visits={visits}
      comments={comments}
      deals={deals}
      caps={{
        edit: canEditAccount(viewer, account),
        reassign: canReassignAccount(viewer, account),
        requestState: canEditRequestState(viewer, account),
      }}
      reassignTargets={reassignTargets.map((m) => ({
        id: m.id,
        label: m.nickname || m.name,
      }))}
      autoReportVisitId={report ?? null}
    />
  );
}
