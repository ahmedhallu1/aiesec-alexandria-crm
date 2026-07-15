import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import {
  hasRaisingAccess, hasTmAccess, canManageMembership, canSeeFeedbackInbox,
} from "@/lib/rbac";
import { signOut } from "@/lib/auth";
import { AppShell } from "@/components/crm/app-shell";
import { ComingSoon } from "@/components/crm/coming-soon";
import { GateClient } from "@/components/crm/gate-client";
import { Tour } from "@/components/crm/tour";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();

  // first login: confirm info + set a password before anything else
  if (!viewer.profile_completed_at) redirect("/welcome");

  const raising = hasRaisingAccess(viewer);
  const tm = hasTmAccess(viewer);

  return (
    <AppShell
      user={{
        name: viewer.nickname || viewer.name,
        email: viewer.email,
        role: viewer.role,
        functions: viewer.functions,
        photoUrl: viewer.avatar_url || viewer.photo_url,
        isAdmin: viewer.isAdmin,
      }}
      nav={{
        raising,
        tm,
        membership: canManageMembership(viewer),
        feedbackInbox: canSeeFeedbackInbox(viewer),
      }}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      {raising ? (
        children
      ) : (
        <>
          {/* TM people get their module (+playbook) even without raising */}
          <GateClient mode="allowed" extra={tm ? ["/members", "/playbook"] : []}>
            {children}
          </GateClient>
          <GateClient mode="soon" extra={tm ? ["/members", "/playbook"] : []}>
            <ComingSoon functions={viewer.functions} />
          </GateClient>
        </>
      )}
      <Tour
        email={viewer.email}
        role={viewer.isAdmin && viewer.role !== "LCP" ? "LCP" : viewer.role}
        functions={viewer.functions}
        hasModule={raising || tm}
      />
    </AppShell>
  );
}
