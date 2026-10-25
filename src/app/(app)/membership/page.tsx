import { redirect } from "next/navigation";
import { gateTab } from "@/server/tabs";
import { getViewer, listAllMembers, listTeamsRegistry } from "@/server/data";
import { canManageMembership, canRunLcTools } from "@/lib/rbac";
import { MembershipView } from "@/components/crm/membership-view";

export const metadata = { title: "Membership" };

export default async function MembershipPage() {
  const viewer = await getViewer();
  await gateTab(viewer, "/membership", canManageMembership(viewer));
  // DEFENCE IN DEPTH (v38.3): listAllMembers hands over every member's phone
  // and email with no role check of its own, and /membership is hide-only in
  // Settings → Tabs (lib/tabs.ts) — this line keeps it so even if that changes
  if (!canManageMembership(viewer)) redirect("/profile");
  const { membershipSource } = await import("@/lib/google/sheets");
  const [members, teams, source] = await Promise.all([
    listAllMembers(),
    listTeamsRegistry(),
    membershipSource(),
  ]);

  return (
    <MembershipView
      teams={teams}
      source={source}
      canRestart={canRunLcTools(viewer)}
      members={members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        phone: m.phone,
        functions: m.functions ?? [],
        sub_functions: m.sub_functions ?? [],
        role: m.role,
        stakeholder_name: m.stakeholder_name,
        team_name: m.team_name,
        is_active: m.is_active,
        has_podio: m.has_podio ?? false,
        fallback_email: m.fallback_email ?? null,
        prank_until: m.prank_until ?? null,
        first_login_at: m.first_login_at,
        has_password: !!m.password_hash,
      }))}
    />
  );
}
