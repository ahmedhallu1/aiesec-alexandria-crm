import { getViewer, listBlacklist } from "@/server/data";
import { canManageBlacklist } from "@/lib/rbac";
import { BlacklistView } from "@/components/crm/blacklist-view";

export const metadata = { title: "Blacklist" };

export default async function BlacklistPage() {
  const viewer = await getViewer();
  const entries = await listBlacklist();
  return (
    <BlacklistView
      entries={entries.map((e) => ({
        id: e.id,
        account_name: e.account_name,
        project: e.project,
        comments: e.comments,
        link: e.link,
        added_by: e.added_by_member?.name ?? null,
        created_at: e.created_at,
      }))}
      canManage={canManageBlacklist(viewer)}
    />
  );
}
