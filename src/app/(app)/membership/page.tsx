import { redirect } from "next/navigation";
import { getViewer, listAllMembers } from "@/server/data";
import { canManageMembership } from "@/lib/rbac";
import { MembershipView } from "@/components/crm/membership-view";

export const metadata = { title: "Membership" };

export default async function MembershipPage() {
  const viewer = await getViewer();
  if (!canManageMembership(viewer)) redirect("/");
  const members = await listAllMembers();

  return (
    <MembershipView
      members={members.map((m) => ({
        id: m.id,
        name: m.name,
        nickname: m.nickname,
        email: m.email,
        phone: m.phone,
        function: m.function,
        sub_function: m.sub_function,
        role: m.role,
        stakeholder_email: m.stakeholder_email,
        team_name: m.team_name,
        is_active: m.is_active,
        first_login_at: m.first_login_at,
      }))}
    />
  );
}
