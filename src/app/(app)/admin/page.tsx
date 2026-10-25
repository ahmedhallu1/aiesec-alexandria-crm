import { redirect } from "next/navigation";
import { gateTab } from "@/server/tabs";
import { auditFilterOptions, getRealViewer, getSystemHealth, listAuditPage } from "@/server/data";
import { listApiKeys } from "@/server/api-keys";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { canUseAdminTools } from "@/lib/rbac";
import { AdminView } from "@/components/crm/admin-view";

export const metadata = { title: "Admin — Health & Logs" };

/** Admin-only system console: live health checks, table counts, cron
 *  last-run proxies, test mode, and the recent audit log. Gated server-side
 *  on the REAL session so it works mid-test-view. */
/** ⚠️ EVERY FILTER IS READ FROM THE URL AND APPLIED IN THE QUERY (v36). The
 *  page used to fetch the newest 80 rows and let the browser grep them, so the
 *  search box could not see past the last 80 actions. A filtered view is now a
 *  link, too — paste it to a colleague and they see the same thing. */
const AUDIT_PAGE_SIZE = 50;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await getRealViewer();
  await gateTab(viewer, "/admin", canUseAdminTools(viewer));
  // DEFENCE IN DEPTH (v38.3): the readers below carry no role check of their
  // own, and /admin is hide-only in Settings → Tabs (lib/tabs.ts) — this line
  // keeps it so even if that ever changes
  if (!canUseAdminTools(viewer)) redirect("/profile");

  const { cookies } = await import("next/headers");
  const showTestData = (await cookies()).get("sodio-test-mode")?.value === "1";

  const sp = await searchParams;
  const one = (k: string): string | null => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : null;
  };
  const auditPage = Math.max(0, Number.parseInt(one("apage") ?? "0", 10) || 0);
  const filters = {
    actorId: one("actor"),
    action: one("action"),
    entity: one("entity"),
    category: one("cat"),
    outcome: one("outcome"),
    q: one("q"),
    // a hand-typed date is validated by shape here; the reader turns it into a
    // real Cairo instant, and an unparseable one simply does not filter
    from: /^\d{4}-\d{2}-\d{2}$/.test(one("afrom") ?? "") ? one("afrom") : null,
    to: /^\d{4}-\d{2}-\d{2}$/.test(one("ato") ?? "") ? one("ato") : null,
  };

  const [health, auditData, auditOptions, { count: testCount }, lcRow, apiKeys] =
    await Promise.all([
    getSystemHealth().catch(() => null),
    // the anonymous-author resolution is ADMIN_EMAILS only, and it reads the
    // REAL viewer — a test view can never be used to unmask someone (v33.30)
    listAuditPage(AUDIT_PAGE_SIZE, { asAdmin: viewer.isAdmin, filters, page: auditPage })
      .catch(() => ({ rows: [], total: 0, page: 0, pageSize: AUDIT_PAGE_SIZE })),
    auditFilterOptions().catch(() => ({ actors: [], actions: [], entities: [], categories: [] })),
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
      audit={auditData.rows}
      auditTotal={auditData.total}
      auditPage={auditData.page}
      auditPageSize={auditData.pageSize}
      auditOptions={auditOptions}
      canUnmask={viewer.isAdmin}
      testMode={{ testAccounts: testCount ?? 0, showTestData }}
      lcSession={
        lcRow ? { id: lcRow.id, startedAt: lcRow.started_at, changes: lcChanges } : null
      }
      apiKeys={apiKeys}
      origin={env.appUrl}
    />
  );
}
