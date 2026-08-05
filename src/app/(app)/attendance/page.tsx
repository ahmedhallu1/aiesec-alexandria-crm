import { getViewer } from "@/server/data";
import { isTmCore } from "@/lib/rbac";
import {
  ATTENDANCE_STATUSES,
  TOUCH_POINT_KINDS,
  touchPointLabel,
} from "@/lib/types";
import { audienceLabel, cairoWhen } from "@/lib/touch-points";
import {
  ATTENDANCE_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  listAttendanceHistory,
  listOpenAppeals,
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

  const filters = {
    from: DATE_RE.test(params.from ?? "") ? params.from! : "",
    to: DATE_RE.test(params.to ?? "") ? params.to! : "",
    kind: (TOUCH_POINT_KINDS as readonly string[]).includes(params.kind ?? "")
      ? params.kind!
      : "",
    status: (ATTENDANCE_STATUSES as readonly string[]).includes(params.status ?? "")
      ? params.status!
      : "",
  };
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = pageSizeOf(params.size);

  const [owedRows, history, appeals] = await Promise.all([
    touchPointsNeedingRecord(viewer),
    listAttendanceHistory(viewer, { ...filters, page, pageSize }),
    listOpenAppeals(viewer),
  ]);

  const owed = owedRows.map((tp) => ({
    id: tp.id,
    label: touchPointLabel(tp.scope, tp.kind),
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
