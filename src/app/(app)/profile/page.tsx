import { getRealViewer, getViewer, profilePeople, teamsForViewer } from "@/server/data";
import { db } from "@/lib/supabase";
import { ProfileView } from "@/components/crm/profile-view";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const viewer = await getViewer();

  // the View-As card belongs to the REAL admin, even mid-test-view —
  // that's how they switch member or find their way back
  const real = await getRealViewer();
  let viewAs: { activeId: string | null; members: { id: string; label: string; role: string }[] } | null = null;
  if (real.isAdmin) {
    const { data } = await db()
      .from("members")
      .select("id, name, nickname, role")
      .eq("is_active", true)
      .neq("id", real.id)
      .order("name");
    viewAs = {
      activeId: viewer.impersonated ? viewer.id : null,
      members: (data ?? []).map((m) => ({
        id: m.id,
        label: m.nickname || m.name,
        role: m.role,
      })),
    };
  }

  const [stakeholderRow, teams, people] = await Promise.all([
    viewer.stakeholder_id
      ? db()
          .from("members")
          .select("name, nickname")
          .eq("id", viewer.stakeholder_id)
          .maybeSingle<{ name: string; nickname: string | null }>()
      : Promise.resolve({ data: null }),
    teamsForViewer(viewer).catch(() => []),
    profilePeople(viewer).catch(() => null),
  ]);
  const stakeholder = stakeholderRow.data;

  return (
    <ProfileView
      member={{
        name: viewer.name,
        nickname: viewer.nickname ?? "",
        email: viewer.email,
        phone: viewer.phone ?? "",
        role: viewer.role,
        functions: viewer.functions,
        subFunctions: viewer.sub_functions,
        teamName: viewer.team_name,
        stakeholderName:
          stakeholder?.nickname || stakeholder?.name || viewer.stakeholder_name,
        photoUrl: viewer.avatar_url || viewer.photo_url,
        avatarUrl: viewer.avatar_url,
        googlePhotoUrl: viewer.photo_url,
        isAdmin: viewer.isAdmin,
        hasPassword: !!viewer.password_hash,
        teams,
      }}
      people={people}
      viewAs={viewAs}
    />
  );
}
