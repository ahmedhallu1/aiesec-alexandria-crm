import { redirect } from "next/navigation";
import { getViewer, listViewAsTargets } from "@/server/data";
import {
  hasRaisingAccess, hasTmAccess, canManageMembership, canSeeFeedbackInbox,
} from "@/lib/rbac";
import { signOut } from "@/lib/auth";
import { AppShell } from "@/components/crm/app-shell";
import { ComingSoon } from "@/components/crm/coming-soon";
import { GateClient } from "@/components/crm/gate-client";
import { Tour } from "@/components/crm/tour";
import { ViewAsBanner } from "@/components/crm/view-as-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();

  // first login: confirm info + set a password before anything else
  // (skipped in the admin's test view — never onboard on someone's behalf)
  if (!viewer.profile_completed_at && !viewer.impersonated) redirect("/welcome");

  const raising = hasRaisingAccess(viewer);
  const tm = hasTmAccess(viewer);
  const membership = canManageMembership(viewer);
  // routes a non-raising member still gets: their TM module, and the
  // membership editor for EB members of other functions (e.g. an OGX LCVP)
  const extraRoutes = [
    ...(tm ? ["/members"] : []),
    ...(membership ? ["/membership"] : []),
  ];

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
        membership,
        feedbackInbox: canSeeFeedbackInbox(viewer),
      }}
      signOutAction={async () => {
        "use server";
        // a lingering test view must never survive into the next sign-in
        const { cookies } = await import("next/headers");
        const { VIEW_AS_COOKIE } = await import("@/server/data");
        (await cookies()).delete(VIEW_AS_COOKIE);
        await signOut({ redirectTo: "/login" });
      }}
    >
      {raising ? (
        children
      ) : (
        <>
          <GateClient mode="allowed" extra={extraRoutes}>
            {children}
          </GateClient>
          <GateClient mode="soon" extra={extraRoutes}>
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
      {viewer.impersonated ? (
        <ViewAsBanner activeId={viewer.id} targets={await listViewAsTargets()} />
      ) : null}
    </AppShell>
  );
}
