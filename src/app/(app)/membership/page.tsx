import { redirect } from "next/navigation";
import { getViewer, listAllMembers, listTeamsRegistry } from "@/server/data";
import { canManageMembership } from "@/lib/rbac";
import { MembershipView } from "@/components/crm/membership-view";

export const metadata = { title: "Membership" };

export default async function MembershipPage() {
  const viewer = await getViewer();
  if (!canManageMembership(viewer)) redirect("/");
  const [members, teams] = await Promise.all([listAllMembers(), listTeamsRegistry()]);

  return (
    <MembershipView
      teams={teams}
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
        first_login_at: m.first_login_at,
        has_password: !!m.password_hash,
      }))}
    />
  );
}
