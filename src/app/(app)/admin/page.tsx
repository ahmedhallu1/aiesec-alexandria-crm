import { redirect } from "next/navigation";
import { getRealViewer, getSystemHealth, listRecentAudit } from "@/server/data";
import { db } from "@/lib/supabase";
import { AdminView } from "@/components/crm/admin-view";

export const metadata = { title: "Admin — Health & Logs" };

/** Admin-only system console: live health checks, table counts, cron
 *  last-run proxies, test mode, and the recent audit log. Gated server-side
 *  on the REAL session so it works mid-test-view. */
export default async function AdminPage() {
  const viewer = await getRealViewer();
  if (!viewer.isAdmin) redirect("/");

  const { cookies } = await import("next/headers");
  const showTestData = (await cookies()).get("sodio-test-mode")?.value === "1";

  const [health, audit, { count: testCount }] = await Promise.all([
    getSystemHealth().catch(() => null),
    listRecentAudit(80).catch(() => []),
    db().from("accounts").select("id", { count: "exact", head: true }).eq("is_test", true),
  ]);

  return (
    <AdminView
      health={health}
      audit={audit}
      testMode={{ testAccounts: testCount ?? 0, showTestData }}
    />
  );
}
