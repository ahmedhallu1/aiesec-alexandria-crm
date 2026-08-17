import { getViewer } from "@/server/data";
import { isTmCore } from "@/lib/rbac";
import {
  ATTENDANCE_STATUSES,
  TOUCH_POINT_KINDS,
  touchPointLabel,
} from "@/lib/types";
import { audienceLabel, cairoWhen, touchPointName } from "@/lib/touch-points";
import {
  ATTENDANCE_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  listAttendanceHistory,
  listOpenAppeals,
  recordableTouchPoints,
  touchPointsNeedingRecord,
  workWindowClosed,
} from "@/server/attendance-read";
import { AttendanceView } from "@/components/crm/attendance-view";
import { pageSizeOf } from "@/lib/page-size";

export const metadata = { title: "Attendance" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /attendance (v29) — open to EVERY member.
 *  Your own history always; your team's if you lead one; your function's as a
 *  VP/Director; the whole LC for TM core and the LCP. The "Needs recording"
 *  lane at the top is what the reminder ladder deep-links into. */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await getViewer();
  const params = await searchParams;

  // THE FUNNELS ARE MULTI-SELECT, so these arrive as comma lists ("meeting,
  // outing") — v33.52. Validating the whole string against the pick-list made
  // `.includes()` false for every multi-pick and silently dropped the filter,
  // so the funnel showed two ticks and the table showed everything.
  const cleanList = (raw: string | undefined, allowed: readonly string[]) =>
    (raw ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => allowed.includes(v))
      .join(",");
  const filters = {
    from: DATE_RE.test(params.from ?? "") ? params.from! : "",
    to: DATE_RE.test(params.to ?? "") ? params.to! : "",
    kind: cleanList(params.kind, TOUCH_POINT_KINDS as readonly string[]),
    status: cleanList(params.status, ATTENDANCE_STATUSES as readonly string[]),
    // v33.27 — the one question a 70-person LC session actually raises
    member: (params.member ?? "").slice(0, 120),
    // v33.52 — "how did IGV show up on Thursday?"
    fn: (params.fn ?? "").slice(0, 120),
  };
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = pageSizeOf(params.size);

  const [owedRows, history, appeals, pickable] = await Promise.all([
    touchPointsNeedingRecord(viewer),
    listAttendanceHistory(viewer, { ...filters, page, pageSize }),
    listOpenAppeals(viewer),
    recordableTouchPoints(viewer),
  ]);

  // THE PICKER (v33.19.2): choose a session and open its sheet — the chase
  // list only ever showed the UNRECORDED ones, so revisiting a session you
  // already recorded meant hunting through the history table.
  const pickableTouchPoints = pickable.map((tp) => ({
    id: tp.id,
    label: touchPointName(tp),
    whenLabel: cairoWhen(tp.starts_at),
    audience: audienceLabel(tp),
    recorded: !!tp.attendance_recorded_at,
  }));

  const owed = owedRows.map((tp) => ({
    id: tp.id,
    label: touchPointName(tp),
    kind: tp.kind as string,
    whenLabel: cairoWhen(tp.starts_at),
    audience: audienceLabel(tp),
    ownerName: tp.owner_name,
    isWorkingHours: tp.kind === "working_hours",
    windowClosed: workWindowClosed(tp.starts_at),
  }));

  const scopeLabel =
    viewer.isAdmin || viewer.role === "LCP" || isTmCore(viewer)
      ? "the whole LC"
      : viewer.role === "LCVP" || viewer.role === "Director"
        ? "your function"
        : viewer.role === "Team Leader"
          ? "you and your team"
          : "your own record";

  return (
    <AttendanceView
      owed={owed}
      pickable={pickableTouchPoints}
      history={history.rows}
      total={history.total}
      page={history.page}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      totals={history.totals}
      appeals={appeals}
      filters={filters}
      scopeLabel={scopeLabel}
      openTouchPointId={UUID_RE.test(params.tp ?? "") ? params.tp! : null}
    />
  );
}
