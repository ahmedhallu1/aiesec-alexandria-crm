import { getViewer } from "@/server/data";
import { hasRaisingAccess, canManageMembership, canManageBlacklist } from "@/lib/rbac";
import { signOut } from "@/lib/auth";
import { AppShell } from "@/components/crm/app-shell";
import { FeedbackWidget } from "@/components/crm/feedback-widget";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const raising = hasRaisingAccess(viewer);

  return (
    <AppShell
      user={{
        name: viewer.nickname || viewer.name,
        email: viewer.email,
        role: viewer.role,
        function: viewer.function,
        photoUrl: viewer.photo_url,
        isAdmin: viewer.isAdmin,
      }}
      nav={{
        raising,
        blacklist: raising,
        membership: canManageMembership(viewer),
        blacklistManage: canManageBlacklist(viewer),
      }}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      {raising ? (
        children
      ) : (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <div className="text-5xl">🚧</div>
          <h1 className="text-xl font-bold">Your module is coming soon</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            The CRM currently covers the ICX <b>Raising</b> process (IGV & IGT).
            Consideration and OGX modules are on the roadmap — you&apos;ll get an
            email the moment your workspace opens.
          </p>
        </div>
      )}
      <FeedbackWidget />
    </AppShell>
  );
}
