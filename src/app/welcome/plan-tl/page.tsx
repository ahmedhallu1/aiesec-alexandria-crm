import { redirect } from "next/navigation";
import { getViewer, needsTlPlan } from "@/server/data";
import { peakForPlanning } from "@/lib/plan";
import { TlPlanForm } from "@/components/crm/tl-plan-form";
import { ThemeToggle } from "@/components/crm/theme-toggle";

export const metadata = { title: "Your team plan" };

export default async function TlPlanPage() {
  const viewer = await getViewer();
  // the admin test view never plans on someone's behalf
  if (viewer.impersonated) redirect("/");
  if (!viewer.profile_completed_at) redirect("/welcome");
  const needed = await needsTlPlan(viewer);
  if (!needed) redirect("/");

  const peak = peakForPlanning();
  const nickname = viewer.nickname || viewer.name.split(" ")[0];
  const isTl = viewer.role === "Team Leader";

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-sidebar p-4">
      <ThemeToggle className="absolute right-4 top-4 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      <div className="w-full max-w-xl rounded-2xl bg-card p-8 shadow-2xl">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-blue.png" alt="AIESEC" className="mx-auto mb-3 h-8 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-white.png" alt="AIESEC" className="mx-auto mb-3 hidden h-8 w-auto dark:block" />
          <h1 className="text-2xl font-bold">
            One last thing, {nickname} — your {isTl ? "team's " : ""}plan 🎯
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How many opens will {isTl ? "your team" : "you"} raise in each month
            of the {peak.label}? This IS {isTl ? "your team's" : "your"} goal —
            the dashboard tracks it live, your VP sees it on the Planning board,
            and you can update it any time from your profile.
          </p>
        </div>

        <TlPlanForm months={peak.months} peakLabel={peak.label} mode="welcome" />
      </div>
    </main>
  );
}
