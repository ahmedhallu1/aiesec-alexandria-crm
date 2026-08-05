import { redirect } from "next/navigation";
import { getViewer, needsMmPlan } from "@/server/data";
import { peakForPlanning } from "@/lib/plan";
import { MmPlanForm } from "@/components/crm/mm-plan-form";
import { ThemeToggle } from "@/components/crm/theme-toggle";
import { SkipPlanButton } from "@/components/crm/skip-plan-button";

export const metadata = { title: "Your plan" };

export default async function MmPlanPage() {
  const viewer = await getViewer();
  // the admin test view never plans on someone's behalf
  if (viewer.impersonated) redirect("/");
  if (!viewer.profile_completed_at) redirect("/welcome");
  const needed = await needsMmPlan(viewer);
  if (!needed) redirect("/");

  const peak = peakForPlanning();
  const nickname = viewer.name.split(" ")[0];

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
            One last thing, {nickname} — your plan 🎯
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fill your 6 monthly numbers (applicants · accepted · approvals) for
            the {peak.label}. They become YOUR goals — your VP sees them on the
            Planning board and in the period reports.
          </p>
        </div>

        <MmPlanForm months={peak.months} peakLabel={peak.label} />
        <SkipPlanButton />
      </div>
    </main>
  );
}
