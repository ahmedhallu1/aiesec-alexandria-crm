import { redirect } from "next/navigation";
import { getViewer, listAllMembers, listFunctionVisits, listIrCalls } from "@/server/data";
import {
  accountScope,
  bookableTouchPointScopes,
  canCreateCalendarItems,
  canEditTouchPoint,
  hasConsiderationAccess,
  hasOgxAccess,
  hasRaisingAccess,
  hasTmAccess,
  isTmCore,
} from "@/lib/rbac";
import {
  invitableTeams, listTouchPoints, memberInTouchPointAudience, ownTeamName,
} from "@/server/touch-points-read";
import { assignableForItems, listCalendarItems } from "@/server/calendar-items";
import { LC_FUNCTIONS, NO_WORKING_HOURS_FUNCTIONS, touchPointLabel } from "@/lib/types";
import { audienceLabel, expandTouchPointFns } from "@/lib/touch-points";
import { cairoToUtc } from "@/lib/time";
import { CalendarView } from "@/components/crm/calendar-view";

export const metadata = { title: "Calendar" };

const cairoParts = (iso: string) => {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  // 12h, for every DISPLAY surface (v33.18)
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit", hour12: true,
  });
  // 24h, for the date/time inputs of the manage form
  const time24 = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).format(d);
  return { date, time, time24 };
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
  // the grid is CAIRO days — a UTC-midnight window is 2–3h out of step and
  // drops (or mis-files) anything starting in the 00:00–02:59 band
  const nextFirst =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const fromIso = cairoToUtc(from, "00:00").toISOString();
  const toIso = new Date(cairoToUtc(nextFirst, "00:00").getTime() - 1).toISOString();

  const canAddItems = canCreateCalendarItems(viewer);
  const [visits, touchPointRows, irCallsRaw, itemRows, assignables, allMembers] =
    await Promise.all([
      raising ? listFunctionVisits(viewer, from, to) : Promise.resolve([]),
      listTouchPoints(viewer, { from: fromIso, to: toIso }),
      // the month, NOT page 0 of the whole log (which caps at 50 rows)
      consideration
        ? listIrCalls(viewer, 0, 50, { fromIso, toIso })
        : Promise.resolve({ scheduled: [], rows: [] }),
      listCalendarItems(viewer, fromIso, toIso),
      canAddItems ? assignableForItems(viewer) : Promise.resolve([]),
      listAllMembers(),
    ]);

  // "MY FUNCTION" (v33.19): who counts as a colleague — every ACTIVE member
  // sharing at least one function with the viewer. B2B and BD are one crew, so
  // the sets are expanded before they're compared.
  const myFnSet = expandTouchPointFns([
    ...(viewer.functions ?? []),
    ...(viewer.sub_functions ?? []),
  ]);
  const memberFnIds = allMembers
    .filter(
      (m) =>
        m.is_active &&
        [...(m.functions ?? []), ...(m.sub_functions ?? [])].some((f) => myFnSet.has(f))
    )
    .map((m) => m.id);

  const touchPoints = touchPointRows
    .map((t) => {
      const { date, time, time24 } = cairoParts(t.starts_at);
      return {
        id: t.id,
        label: touchPointLabel(t.scope, t.kind),
        date,
        time,
        timeValue: time24,
        note: t.note,
        scope: t.scope,
        ownerName: t.owner_name,
        audience: audienceLabel(t),
        cancelled: t.status === "cancelled",
        recorded: !!t.attendance_recorded_at,
        canEdit: canEditTouchPoint(viewer, t),
        // "only mine": is the viewer actually IN this point's audience (they
        // may merely SEE other teams' points inside their function)
        mine: memberInTouchPointAudience(viewer, t),
      };
    })
    // a DST edge could still hand back a row dated outside the grid's cells
    .filter((t) => t.date >= from && t.date <= to);

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
        memberId: (c.member_id as string | null) ?? null,
        status: c.status as string,
      };
    })
    .filter((c) => c.date >= from && c.date <= to);

  const items = itemRows
    .map((r) => {
      const { date, time } = cairoParts(r.starts_at);
      const end = r.ends_at ? cairoParts(r.ends_at) : null;
      return {
        id: r.id,
        title: r.title,
        date,
        time,
        endTime: end?.time ?? null,
        note: r.note,
        ownerName: r.owner_name,
        assigneeNames: r.assignee_names ?? [],
        canDelete: r.owner_id === viewer.id || accountScope(viewer).kind === "all",
      };
    })
    .filter((r) => r.date >= from && r.date <= to);

  // what this viewer may book — and who they may pull in
  const scopes = bookableTouchPointScopes(viewer);
  // B2B and BD are ONE crew: two picker entries for one function would let a
  // default pick silently exclude half the members from the audience
  const ownFns = [
    ...new Set(
      [...viewer.functions, ...viewer.sub_functions]
        .filter((f) => (LC_FUNCTIONS as string[]).includes(f))
        .map((f) => (f === "BD" ? "B2B" : f))
    ),
  ];
  const ownExpanded = expandTouchPointFns(ownFns);
  const primaryFn = ownFns[0] ?? "";
  // THE VIEWER'S OWN TEAM, resolved (v33.6). `viewer.team_name` is the whole
  // comma-list from the membership sheet — "Suits, شماريخ" is the B2B
  // function-leaders team and the LB, not anybody's team — so the picker was
  // offering that string as if it were a team name.
  const myTeamName = await ownTeamName(viewer);
  const [siblingTeams, allTeams] = await Promise.all([
    primaryFn ? invitableTeams(primaryFn, myTeamName) : Promise.resolve([]),
    primaryFn ? invitableTeams(primaryFn, null) : Promise.resolve([]),
  ]);
  const otherFunctions = (LC_FUNCTIONS as string[]).filter(
    (f) => !ownExpanded.has(f) && f !== "BD" && !NO_WORKING_HOURS_FUNCTIONS.includes(f)
  );
  // ONLY a function-wide booker picks someone else's team — a Team Leader
  // books for their OWN team (the server refuses anything else)
  const picksAnyTeam = viewer.isAdmin || viewer.role === "LCP";

  const scope = accountScope(viewer);
  // `booking` travels as plain DATA, not a rendered element: the calendar
  // opens that same dialog from a day cell with the day already filled in.
  return (
    <CalendarView
      visits={visits}
      touchPoints={touchPoints}
      irCalls={irCalls}
      items={items}
      canAddItems={canAddItems}
      assignables={assignables}
      month={month}
      viewerId={viewer.id}
      teamMemberIds={viewer.teamMemberIds}
      viewerRole={viewer.role}
      memberFnIds={memberFnIds}
      openableMemberIds={scope.kind === "members" ? scope.ids : null}
      showFunction={scope.kind === "all" || isTmCore(viewer)}
      booking={
        scopes.length > 0
          ? {
              scopes,
              functions: ownFns,
              teams: picksAnyTeam ? allTeams : [myTeamName],
              myTeam: myTeamName,
              siblingTeams,
              otherFunctions,
            }
          : null
      }
    />
  );
}
