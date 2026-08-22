import { redirect } from "next/navigation";
import { getRealViewer, getSystemHealth, listRecentAudit } from "@/server/data";
import { listApiKeys } from "@/server/api-keys";
import { db } from "@/lib/supabase";
import { canUseAdminTools } from "@/lib/rbac";
import { AdminView } from "@/components/crm/admin-view";

export const metadata = { title: "Admin — Health & Logs" };

/** Admin-only system console: live health checks, table counts, cron
 *  last-run proxies, test mode, and the recent audit log. Gated server-side
 *  on the REAL session so it works mid-test-view. */
export default async function AdminPage() {
  const viewer = await getRealViewer();
  if (!canUseAdminTools(viewer)) redirect("/");

  const { cookies } = await import("next/headers");
  const showTestData = (await cookies()).get("sodio-test-mode")?.value === "1";

  const [health, audit, { count: testCount }, lcRow, apiKeys] = await Promise.all([
    getSystemHealth().catch(() => null),
    // the anonymous-author resolution is ADMIN_EMAILS only, and it reads the
    // REAL viewer — a test view can never be used to unmask someone (v33.30)
    listRecentAudit(80, { asAdmin: viewer.isAdmin }).catch(() => []),
    db().from("accounts").select("id", { count: "exact", head: true }).eq("is_test", true),
    // the OPEN LC-wide testing session, if one is running (v32)
    Promise.resolve(
      db()
        .from("test_sessions")
        .select("id, started_at")
        .eq("kind", "lc")
        .is("ended_at", null)
        .maybeSingle<{ id: string; started_at: string }>()
    )
      .then((r) => r.data)
      .catch(() => null),
    listApiKeys().catch(() => []),
  ]);

  // how much that session would roll back — shown on the stop button
  const lcChanges = lcRow
    ? ((
        await db()
          .from("test_undo")
          .select("id", { count: "exact", head: true })
          .eq("session_id", lcRow.id)
      ).count ?? 0)
    : 0;

  return (
    <AdminView
      health={health}
      audit={audit}
      testMode={{ testAccounts: testCount ?? 0, showTestData }}
      lcSession={
        lcRow ? { id: lcRow.id, startedAt: lcRow.started_at, changes: lcChanges } : null
      }
      apiKeys={apiKeys}
    />
  );
}
