import { getViewer } from "@/server/data";
import { db } from "@/lib/supabase";
import { ProfileView } from "@/components/crm/profile-view";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const viewer = await getViewer();

  const stakeholder = viewer.stakeholder_id
    ? (
        await db()
          .from("members")
          .select("name, nickname")
          .eq("id", viewer.stakeholder_id)
          .maybeSingle<{ name: string; nickname: string | null }>()
      ).data
    : null;

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
      }}
    />
  );
}
