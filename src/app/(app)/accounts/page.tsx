import { getViewer, listAccounts, listVisibleMembers } from "@/server/data";
import type { AccountFilters } from "@/server/data";
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

  const filters: AccountFilters = {
    q: params.q || undefined,
    fn: params.fn === "IGV" || params.fn === "IGT" ? params.fn : undefined,
    project: params.project || undefined,
    product: params.product === "GTa" || params.product === "GTe" ? params.product : undefined,
    stage: (params.stage as Stage) || undefined,
    responsibleId: params.resp || undefined,
    flag:
      params.flag === "contact_limit" || params.flag === "next_step_missing"
        ? params.flag
        : undefined,
  };

  const [rows, members] = await Promise.all([
    listAccounts(viewer, filters),
    listVisibleMembers(viewer),
  ]);

  return (
    <AccountsView
      rows={rows}
      members={members.map((m) => ({
        id: m.id,
        label: m.nickname || m.name,
        function: m.function,
      }))}
      viewer={{
        id: viewer.id,
        role: viewer.role,
        isAdmin: viewer.isAdmin,
        function: viewer.function,
        canAssignOthers:
          viewer.isAdmin || ["LCP", "VP", "TL"].includes(viewer.role),
      }}
      filters={{
        q: params.q ?? "",
        fn: params.fn ?? "",
        project: params.project ?? "",
        product: params.product ?? "",
        stage: params.stage ?? "",
        resp: params.resp ?? "",
        flag: params.flag ?? "",
      }}
    />
  );
}
