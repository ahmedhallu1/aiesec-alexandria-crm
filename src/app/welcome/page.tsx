import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { getViewer } from "@/server/data";
import {
  hasRaisingAccess, hasOgxAccess, hasConsiderationAccess, hasTmAccess,
} from "@/lib/rbac";
import { ROLE_BLURBS } from "@/lib/types";
import { OnboardingForm } from "@/components/crm/onboarding-form";
import { ThemeToggle } from "@/components/crm/theme-toggle";
import { SodioMark } from "@/components/crm/sodio-mark";

export const metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const viewer = await getViewer();
  if (viewer.profile_completed_at) redirect("/");
  // the admin test view never onboards on someone's behalf
  if (viewer.impersonated) redirect("/");

  // name THEIR workspace — the raising role blurbs only fit raising members
  const blurb = hasRaisingAccess(viewer)
    ? ROLE_BLURBS[viewer.role] ?? ROLE_BLURBS.Member
    : hasOgxAccess(viewer)
      ? "Your OGX workspace is ready — the sign-ups pool, the funnel, and Approved as the finish line."
      : hasConsiderationAccess(viewer)
        ? "Your Consideration workspace is ready — IR calls with partner LCs and your personal booking link."
        : hasTmAccess(viewer)
          ? "Your Talent Management workspace is ready — the whole LC's directory, KPIs and contact shortcuts."
          : "Your Profile, the Help center and Feedback are live today — your function's workspace is on the way.";

  /** SIGN IN WITH THE PASSWORD YOU JUST CHOSE (v33.58).
   *
   *  Onboarding is the one moment a member INVENTS a password, and until now
   *  they were carried straight into the app on the Google session they
   *  arrived with — so the first time they were ever asked to type it was days
   *  later, cold, with no idea whether the thing in their head was the thing
   *  they saved. The standard every bank and password manager uses is to make
   *  the credential prove itself immediately: signing out and signing back in
   *  turns the password from something they typed once into something they
   *  have USED, which is what makes it stick, and it surfaces a wrong
   *  assumption while the person still remembers what they meant to type.
   *
   *  A server action, not next-auth/react: the app mounts no SessionProvider,
   *  and this is the same `signOut` the sidebar and /inactive already call. */
  async function signOutToLogin() {
    "use server";
    await signOut({ redirectTo: "/login?fresh=1" });
  }

  return (
    <main className="relative flex min-h-dvh items-start justify-center overflow-x-hidden bg-sidebar p-4 sm:items-center">
      <ThemeToggle className="absolute right-4 top-4 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      <div className="w-full min-w-0 max-w-xl rounded-2xl bg-card p-5 shadow-2xl sm:p-8">
        <div className="mb-6 text-center">
          <SodioMark px={40} className="brand-mark mx-auto mb-3 h-10 w-10" title="Sodio" />
          <h1 className="text-2xl font-bold">
            Welcome, {viewer.name.split(" ")[0]} 👋
          </h1>
          <p className="mt-1 text-sm font-medium text-primary">
            {blurb}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            First login — confirm your info and set your own password.
          </p>
        </div>

        <OnboardingForm
          signOutToLogin={signOutToLogin}
          member={{
            name: viewer.name,
            email: viewer.email ?? "",
            phone: viewer.phone ?? "",
            role: viewer.role,
            functions: viewer.functions,
            subFunctions: viewer.sub_functions,
            teamName: viewer.team_name,
            stakeholderName: viewer.stakeholder_name,
          }}
        />
      </div>
    </main>
  );
}
