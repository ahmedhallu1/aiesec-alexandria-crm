import { redirect } from "next/navigation";
import { getViewer, getSystemHealth, listRecentAudit } from "@/server/data";
import { AdminView } from "@/components/crm/admin-view";

export const metadata = { title: "Admin — Health & Logs" };

/** Admin-only system console: live health checks, table counts, cron
 *  last-run proxies, and the recent audit log. Gated server-side. */
export default async function AdminPage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) redirect("/");

  const [health, audit] = await Promise.all([
    getSystemHealth().catch(() => null),
    listRecentAudit(80).catch(() => []),
  ]);

  return <AdminView health={health} audit={audit} />;
}
