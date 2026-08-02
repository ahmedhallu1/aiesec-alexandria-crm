import { redirect } from "next/navigation";
import { getViewer, listFunctionVisits, listIrCalls } from "@/server/data";
import {
  accountScope,
  bookableTouchPointScopes,
  hasConsiderationAccess,
  hasOgxAccess,
  hasRaisingAccess,
  hasTmAccess,
  isTmCore,
} from "@/lib/rbac";
import { invitableTeams, listTouchPoints } from "@/server/touch-points-read";
import { LC_FUNCTIONS, NO_WORKING_HOURS_FUNCTIONS, touchPointLabel } from "@/lib/types";
import { audienceLabel } from "@/lib/touch-points";
import { CalendarView } from "@/components/crm/calendar-view";
import { TouchPointDialog } from "@/components/crm/touch-point-dialog";

export const metadata = { title: "Calendar" };

const cairoParts = (iso: string) => {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit",
  });
  return { date, time };
};

/** The LC's one calendar (v29): TM touch points, raising visits and
 *  consideration IR calls — each viewer sees exactly what they're part of. */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  const raising = hasRaisingAccess(viewer);
  const consideration = hasConsiderationAccess(viewer);
  // every module member has a calendar now — touch points concern everyone
  if (!raising && !consideration && !hasOgxAccess(viewer) && !hasTmAccess(viewer))
    redirect("/");
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

  const [visits, touchPointRows, irCallsRaw] = await Promise.all([
    raising ? listFunctionVisits(viewer, from, to) : Promise.resolve([]),
    listTouchPoints(viewer, {
      from: `${from}T00:00:00.000Z`,
      to: `${to}T23:59:59.999Z`,
    }),
    consideration ? listIrCalls(viewer, 0) : Promise.resolve({ scheduled: [], rows: [] }),
  ]);

  const touchPoints = touchPointRows.map((t) => {
    const { date, time } = cairoParts(t.starts_at);
    return {
      id: t.id,
      label: touchPointLabel(t.scope, t.kind),
      date,
      time,
      note: t.note,
      ownerName: t.owner_name,
      audience: audienceLabel(t),
      cancelled: t.status === "cancelled",
      recorded: !!t.attendance_recorded_at,
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCalls = [...((irCallsRaw as any).scheduled ?? []), ...((irCallsRaw as any).rows ?? [])];
  const irCalls = allCalls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((c: any) => {
      const { date, time } = cairoParts(c.called_at);
      return {
        id: c.id as string,
        date,
        time,
        partnerLc: c.partner_lc_name as string,
        memberName: c.member_name as string,
        status: c.status as string,
      };
    })
    .filter((c) => c.date >= from && c.date <= to);

  // what this viewer may book — and who they may pull in
  const scopes = bookableTouchPointScopes(viewer);
  const ownFns = [...new Set([...viewer.functions, ...viewer.sub_functions])].filter((f) =>
    (LC_FUNCTIONS as string[]).includes(f)
  );
  const primaryFn = ownFns[0] ?? "";
  const [siblingTeams, allTeams] = await Promise.all([
    primaryFn ? invitableTeams(primaryFn, viewer.team_name) : Promise.resolve([]),
    primaryFn ? invitableTeams(primaryFn, null) : Promise.resolve([]),
  ]);
  const otherFunctions = (LC_FUNCTIONS as string[]).filter(
    (f) => !ownFns.includes(f) && !NO_WORKING_HOURS_FUNCTIONS.includes(f)
  );

  const scope = accountScope(viewer);
  return (
    <CalendarView
      visits={visits}
      touchPoints={touchPoints}
      irCalls={irCalls}
      month={month}
      viewerId={viewer.id}
      openableMemberIds={scope.kind === "members" ? scope.ids : null}
      showFunction={scope.kind === "all" || isTmCore(viewer)}
      bookSlot={
        scopes.length > 0 ? (
          <TouchPointDialog
            scopes={scopes}
            functions={ownFns}
            teams={allTeams}
            myTeam={viewer.team_name}
            siblingTeams={siblingTeams}
            otherFunctions={otherFunctions}
          />
        ) : null
      }
    />
  );
}
