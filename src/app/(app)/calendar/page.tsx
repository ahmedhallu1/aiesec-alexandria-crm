import { redirect } from "next/navigation";
import { getViewer, listFunctionVisits } from "@/server/data";
import { accountScope, hasRaisingAccess } from "@/lib/rbac";
import { CalendarView } from "@/components/crm/calendar-view";

export const metadata = { title: "Calendar" };

/** Function-wide visits calendar: everyone sees every visit of their
 *  function(s), color-coded per member. ?m=YYYY-MM picks the month. */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  if (!hasRaisingAccess(viewer)) redirect("/");
  const params = await searchParams;

  // "this month" in Cairo time — the server clock is UTC on Vercel
  const fallback = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.m ?? "") ? params.m! : fallback;

  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;

  const visits = await listFunctionVisits(viewer, from, to);
  // whose accounts this viewer may OPEN (chips outside this render unlinked)
  const scope = accountScope(viewer);
  return (
    <CalendarView
      visits={visits}
      month={month}
      viewerId={viewer.id}
      openableMemberIds={scope.kind === "members" ? scope.ids : null}
    />
  );
}
