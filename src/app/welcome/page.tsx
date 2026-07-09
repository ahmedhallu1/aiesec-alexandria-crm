import { redirect } from "next/navigation";
import { getViewer } from "@/server/data";
import { OnboardingForm } from "@/components/crm/onboarding-form";
import { ThemeToggle } from "@/components/crm/theme-toggle";

export const metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const viewer = await getViewer();
  if (viewer.profile_completed_at) redirect("/");

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-sidebar p-4">
      <ThemeToggle className="absolute right-4 top-4 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      <div className="w-full max-w-xl rounded-2xl bg-card p-8 shadow-2xl">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-blue.png" alt="AIESEC" className="mx-auto mb-3 h-8 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-white.png" alt="AIESEC" className="mx-auto mb-3 hidden h-8 w-auto dark:block" />
          <h1 className="text-2xl font-bold">
            Welcome, {viewer.nickname || viewer.name.split(" ")[0]} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            First login — confirm your info and set your own password.
          </p>
        </div>

        <OnboardingForm
          member={{
            name: viewer.name,
            nickname: viewer.nickname ?? "",
            email: viewer.email,
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
