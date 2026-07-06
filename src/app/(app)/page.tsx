import { getViewer, getDashboard } from "@/server/data";
import { DashboardView } from "@/components/crm/dashboard-view";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fn?: string }>;
}) {
  const viewer = await getViewer();
  const { fn } = await searchParams;
  const filterFn = fn === "IGV" || fn === "IGT" ? fn : undefined;
  const data = await getDashboard(viewer, { fn: filterFn });

  const scopeLabel =
    viewer.isAdmin || viewer.role === "LCP"
      ? "Whole LC"
      : viewer.role === "VP"
        ? `${viewer.function} function`
        : viewer.role === "TL"
          ? viewer.team_name || "Your team"
          : "Your accounts";

  return (
    <DashboardView
      total={data.total}
      byFunction={data.byFunction}
      byTeam={data.byTeam}
      byMember={data.byMember}
      goals={data.goals}
      activeFn={filterFn ?? "all"}
      scopeLabel={scopeLabel}
      showFnFilter={viewer.isAdmin || viewer.role === "LCP"}
      showTeamDrill={viewer.role !== "Member" && viewer.role !== "Coordinator"}
    />
  );
}
