import {
  getRealViewer, getViewer, listViewAsTargets, mmPlanForProfile, profilePeople,
  teamsForViewer, tlPlanForProfile,
} from "@/server/data";
import { canUseAdminTools } from "@/lib/rbac";
import { db } from "@/lib/supabase";
import { ProfileView } from "@/components/crm/profile-view";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const viewer = await getViewer();

  // the View-As card belongs to the REAL admin, even mid-test-view —
  // that's how they switch member or find their way back
  const real = await getRealViewer();
  let viewAs: {
    activeId: string | null;
    members: { id: string; label: string; role: string; functions: string }[];
  } | null = null;
  // v33.2: the test view follows the admin CAPABILITY, like the Health page —
  // "Admin" in the Role or Sub Function column, not just ADMIN_EMAILS. The
  // server action was already gated on canUseAdminTools; only this picker
  // still asked for the env list, so a capability-admin had the tools but no
  // way to reach them.
  if (canUseAdminTools(real)) {
    viewAs = {
      activeId: viewer.impersonated ? viewer.id : null,
      members: (await listViewAsTargets()).filter((m) => m.id !== real.id),
    };
  }

  // FUNCTION DEFAULTS (v33.32) — a leader's own functions, with what each one
  // currently resolves to. Empty for everyone who leads nothing, so the card
  // simply doesn't render.
  const { allFunctionSettings, manageableFunctions } = await import(
    "@/server/function-settings"
  );
  const myFns = manageableFunctions(viewer);
  const fnSettings =
    myFns.length > 0
      ? await allFunctionSettings().then((all) =>
          myFns.map((fn) => ({ fn, ...all[fn] }))
        )
      : [];

  const [stakeholderRow, teams, people, tlPlan, mmPlan] = await Promise.all([
    viewer.stakeholder_id
      ? db()
          .from("members")
          .select("name")
          .eq("id", viewer.stakeholder_id)
          .maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
    teamsForViewer(viewer).catch(() => []),
    profilePeople(viewer).catch(() => null),
    tlPlanForProfile(viewer).catch(() => null),
    mmPlanForProfile(viewer).catch(() => null),
  ]);
  const stakeholder = stakeholderRow.data;

  return (
    <ProfileView
      member={{
        name: viewer.name,
        email: viewer.email ?? "",
        phone: viewer.phone ?? "",
        role: viewer.role,
        functions: viewer.functions,
        subFunctions: viewer.sub_functions,
        teamName: viewer.team_name,
        stakeholderName:
          stakeholder?.name || viewer.stakeholder_name,
        photoUrl: viewer.avatar_url || viewer.photo_url,
        avatarUrl: viewer.avatar_url,
        googlePhotoUrl: viewer.photo_url,
        isAdmin: viewer.isAdmin,
        hasPassword: !!viewer.password_hash,
        teams,
        fallbackEmail: viewer.fallback_email ?? null,
      }}
      people={people}
      tlPlan={tlPlan}
      mmPlan={mmPlan}
      viewAs={viewAs}
      fnSettings={fnSettings}
    />
  );
}
