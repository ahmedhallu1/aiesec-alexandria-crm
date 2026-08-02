import { redirect } from "next/navigation";
import {
  cairoDayIso, clampDirectoryWindow, getViewer, listMembersDirectory,
} from "@/server/data";
import { hasTmAccess } from "@/lib/rbac";
import { monthOf, sprintOf } from "@/lib/plan";
import { MembersView } from "@/components/crm/members-view";

export const metadata = { title: "Members" };

/** The TM (Talent Management) module — v1: the whole-LC members directory
 *  with per-member info, KPIs/MOS and contact shortcuts. More coming later.
 *
 *  v29.4 — ?from/?to scope every KPI to a date window. The chips' ranges are
 *  computed HERE (Cairo calendar, via plan.ts) so the month/sprint a member
 *  sees never depends on their device's timezone. */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  if (!hasTmAccess(viewer)) redirect("/");
  const params = await searchParams;
  // clamped server-side: a hand-typed ?from=2099-01-01 can't widen the window
  const range = clampDirectoryWindow({ from: params.from, to: params.to });
  const members = await listMembersDirectory(viewer, range);

  // the chips end TODAY, not at the period's calendar end: the future can't
  // hold work, and an un-clamped end date would never match the clamped window
  // that comes back in the URL (the chip would never light up)
  const today = cairoDayIso();
  const month = monthOf();
  const sprint = sprintOf();
  const soFar = (end: string) => (end > today ? today : end);
  return (
    <MembersView
      members={members}
      filters={{ from: range.from ?? "", to: range.to ?? "" }}
      ranges={{
        month: { from: month.start, to: soFar(month.end), label: month.label },
        sprint: { from: sprint.start, to: soFar(sprint.end), label: sprint.label },
        today,
      }}
    />
  );
}
