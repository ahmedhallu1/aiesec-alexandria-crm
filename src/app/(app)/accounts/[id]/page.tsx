import Link from "next/link";
import type { Metadata } from "next";
import { canViewAccount } from "@/lib/rbac";
import {
  findAccountRow, getAccount, getViewer, listFunctionMembers, listReassignTargets,
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
  // don't leak a test account's name in the tab title outside test mode
  if (account.is_test && !viewer.testMode) return { title: "Account" };
  return { title: account.name };
}

export default async function AccountPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ report?: string; open?: string }>;
}) {
  const viewer = await getViewer();
  const { id } = await params;
  const { report, open } = await searchParams;

  const result = await getAccount(viewer, id);
  // NOT A BARE 404 (v33.7). A raw "This page could not be found" made a
  // permission boundary look like a broken app — people assumed the account
  // had been deleted. The wording deliberately does NOT distinguish "no such
  // account" from "not yours": that is the same security property the 404
  // had, since confirming which one it is tells a URL-guesser the account
  // exists.
  if (!result) return <NoAccess />;
  const { account, attempts, visits, comments, deals } = result;

  const canEdit = canEditAccount(viewer, account);
  const [reassignTargets, functionMembers] = await Promise.all([
    canReassignAccount(viewer, account)
      ? listReassignTargets(viewer, account.function)
      : Promise.resolve([]),
    // the deal opens-split picker: everyone in the account's function
    canEdit ? listFunctionMembers(account.function) : Promise.resolve([]),
  ]);
  // the current responsible must always be present so the select shows them
  // (imported accounts can be UNASSIGNED — nothing to unshift then)
  if (
    account.responsible_id &&
    reassignTargets.length > 0 &&
    !reassignTargets.some((m) => m.id === account.responsible_id)
  ) {
    reassignTargets.unshift({
      id: account.responsible_id,
      name: account.responsible_name,
    } as (typeof reassignTargets)[number]);
  }

  return (
    <AccountDetailView
      viewerId={viewer.id}
      viewerName={viewer.name}
      account={account}
      attempts={attempts}
      visits={visits}
      comments={comments}
      deals={deals}
      functionMembers={functionMembers}
      caps={{
        edit: canEditAccount(viewer, account),
        reassign: canReassignAccount(viewer, account),
        requestState: canEditRequestState(viewer, account),
      }}
      reassignTargets={reassignTargets.map((m) => ({
        id: m.id,
        label: m.name,
      }))}
      autoReportVisitId={report ?? null}
      autoOpen={
        open === "contact" || open === "visit" || open === "deal" || open === "proposal"
          ? open
          : null
      }
    />
  );
}

/** Shown for a slug that is unknown OR outside the viewer's scope — the two
 *  are deliberately indistinguishable. */
function NoAccess() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-5xl">🔒</p>
      <h1 className="mt-4 text-xl font-bold">You can&apos;t open this account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Either it doesn&apos;t exist, or it belongs to a function or a team you don&apos;t
        work. If you think it should be yours, ask your MM or VP to reassign it —
        they can hand it over in one click.
      </p>
      <Link
        href="/accounts"
        className="mt-6 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        Back to Raising
      </Link>
    </div>
  );
}
