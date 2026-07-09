import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import { hasRaisingAccess, canManageMembership, canSeeFeedbackInbox } from "@/lib/rbac";
import { signOut } from "@/lib/auth";
import { AppShell } from "@/components/crm/app-shell";
import { ComingSoon } from "@/components/crm/coming-soon";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();

  // first login: confirm info + set a password before anything else
  if (!viewer.profile_completed_at) redirect("/welcome");

  const raising = hasRaisingAccess(viewer);

  return (
    <AppShell
      user={{
        name: viewer.nickname || viewer.name,
        email: viewer.email,
        role: viewer.role,
        functions: viewer.functions,
        photoUrl: viewer.photo_url,
        isAdmin: viewer.isAdmin,
      }}
      nav={{
        raising,
        membership: canManageMembership(viewer),
        feedbackInbox: canSeeFeedbackInbox(viewer),
      }}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      {raising ? children : <GatedContent viewerFunctions={viewer.functions}>{children}</GatedContent>}
    </AppShell>
  );
}

/** Members without a live module still reach their profile + feedback pages. */
function GatedContent({
  viewerFunctions,
  children,
}: {
  viewerFunctions: string[];
  children: React.ReactNode;
}) {
  return (
    <>
      <AllowedRoutes>{children}</AllowedRoutes>
      <ComingSoonSwitch functions={viewerFunctions} />
    </>
  );
}

// Server components can't read the pathname without opting the whole layout
// into dynamic rendering — the split below is handled client-side instead.
import { GateClient } from "@/components/crm/gate-client";

function AllowedRoutes({ children }: { children: React.ReactNode }) {
  return <GateClient mode="allowed">{children}</GateClient>;
}

function ComingSoonSwitch({ functions }: { functions: string[] }) {
  return (
    <GateClient mode="soon">
      <ComingSoon functions={functions} />
    </GateClient>
  );
}
