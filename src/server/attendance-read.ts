import { db } from "@/lib/supabase";
import { canRecordAttendance, isTmCore, type Viewer } from "@/lib/rbac";
import {
  touchPointLabel,
  WORK_MIN_ACTIONS,
  WORK_MIN_GAP_MINUTES,
  WORK_SESSION_HOURS,
  type AttendanceStatus,
  type TouchPointKind,
  type TouchPointScope,
} from "@/lib/types";
import { audienceLabel } from "@/lib/touch-points";
import { cairoToUtc } from "@/lib/time";
import {
  getTouchPoint,
  touchPointAudience,
  type TouchPointRow,
} from "./touch-points-read";

/** ATTENDANCE core (v29) — plain module, NOT "use server".
 *
 *  Everything here is callable from anywhere on the server: the page, the
 *  actions AND the cron route (which has no session, so it can never call a
 *  server action that starts with `getViewer()`). The working-hours engine
 *  lives here for exactly that reason — the cron PRE-FILLS closed sessions
 *  (a human still confirms them) and the "Recompute" button reaches the same
 *  code through an authorised wrapper in `attendance.ts`. */

// ------------------------------------------------------------------ types

export interface AttendanceRow {
  id: string;
  touch_point_id: string;
  member_id: string;
  status: AttendanceStatus;
  excused: boolean;
  excuse: string | null;
  automatic: boolean;
  recorded_by: string | null;
  recorded_at: string;
}

export interface AppealRow {
  id: string;
  attendance_id: string;
  member_id: string;
  message: string;
  resolved: boolean;
  created_at: string;
}

/** One row of the /attendance history table. */
export interface AttendanceHistoryRow {
  id: string;
  status: AttendanceStatus;
  excused: boolean;
  excuse: string | null;
  automatic: boolean;
  recordedAt: string;
  memberId: string;
  memberName: string;
  /** the viewer's OWN row — the only one they may appeal */
  mine: boolean;
  /** the viewer may open this touch point's recording sheet */
  canRecord: boolean;
  touchPointId: string;
  label: string;
  kind: TouchPointKind;
  scope: TouchPointScope;
  startsAt: string;
  audience: string;
  ownerName: string;
  appeal: { id: string; message: string; resolved: boolean } | null;
}

export interface AttendanceFilters {
  /** rows per page — one of PAGE_SIZE_OPTIONS (v31) */
  pageSize?: number;
  /** YYYY-MM-DD, inclusive, on the touch point's START */
  from?: string;
  to?: string;
  kind?: string;
  status?: string;
  page?: number;
}

export interface AttendanceTotals {
  total: number;
  attended: number;
  late: number;
  absent: number;
  excused: number;
  /** attended ÷ total, 0–100, rounded */
  rate: number;
}

export const ATTENDANCE_PAGE_SIZE = 50;
/** the rows-per-page choices every paginated table offers (v31) */
export const PAGE_SIZE_OPTIONS = [30, 50, 100, 200];

/** How far back the history and the "needs recording" list look. The LC books
 *  a few hundred touch points a term — this keeps every query bounded. */
const HISTORY_TOUCH_POINT_CAP = 500;
const OWED_LOOKBACK_DAYS = 60;

// ------------------------------------------------------------------ the working-hours rule

/** The grace period before a working-hours session opens: arriving five
 *  minutes early still counts as being there. */
export const WORK_GRACE_MINUTES = 15;

/** The rule, in one plain sentence — printed in the UI so nobody guesses. */
export const WORKING_HOURS_RULE =
  `You are marked present automatically when you do at least ${WORK_MIN_ACTIONS} real work actions ` +
  `(an account added or edited, a contact, a visit, a deal, a comment, a sign-up ` +
  `or an IR call) inside the ` +
  `${WORK_SESSION_HOURS}-hour session — from ${WORK_GRACE_MINUTES} minutes before it starts — ` +
  `with at least ${WORK_MIN_GAP_MINUTES} minutes between your first and your last one. ` +
  `Whoever runs the session still reviews it and confirms — nothing is final before that.`;

/** The window a working-hours session is judged over. */
export function workWindow(startsAt: string): { from: string; to: string } {
  const start = new Date(startsAt).getTime();
  return {
    from: new Date(start - WORK_GRACE_MINUTES * 60_000).toISOString(),
    to: new Date(start + WORK_SESSION_HOURS * 3_600_000).toISOString(),
  };
}

/** True once the window has closed — only then may the engine judge it. */
export function workWindowClosed(startsAt: string, now = new Date()): boolean {
  return now.getTime() >= new Date(workWindow(startsAt).to).getTime();
}

// ------------------------------------------------------------------ reads

export async function listAttendanceFor(touchPointId: string): Promise<AttendanceRow[]> {
  const { data, error } = await db()
    .from("touch_point_attendance")
    .select("*")
    .eq("touch_point_id", touchPointId);
  if (error) {
    console.error("[attendance] rows query failed:", error.message);
    return [];
  }
  return (data ?? []) as AttendanceRow[];
}

const fnsOf = (m: { functions?: string[] | null; sub_functions?: string[] | null }) => [
  ...(m.functions ?? []),
  ...(m.sub_functions ?? []),
];

/** Whose attendance this viewer may READ.
 *  member/coordinator → themselves · Team Leader → their team ·
 *  VP/Director → their whole function · TM core + LCP/admin → `null` = the LC. */
export async function attendanceMemberScope(v: Viewer): Promise<string[] | null> {
  if (v.isAdmin || v.role === "LCP" || isTmCore(v)) return null;
  if (v.role === "LCVP" || v.role === "Director") {
    const mine = fnsOf(v);
    if (mine.length === 0) return [v.id];
    const { data } = await db()
      .from("members")
      .select("id, functions, sub_functions")
      .eq("is_active", true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = ((data ?? []) as any[])
      .filter((m) => fnsOf(m).some((f) => mine.includes(f)))
      .map((m) => m.id as string);
    return [...new Set([v.id, ...ids])];
  }
  if (v.role === "Team Leader") return [...new Set([v.id, ...v.teamMemberIds])];
  return [v.id];
}

/** Chunked `.in()` — a 500-uuid filter would blow past PostgREST's URL limit. */
async function inChunks<T>(
  ids: string[],
  size: number,
  run: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await run(ids.slice(i, i + size))));
  return out;
}

/** The touch points this viewer OWES an attendance record for — started, still
 *  scheduled, nothing recorded. The deep-link target of every reminder. */
export async function touchPointsNeedingRecord(viewer: Viewer): Promise<TouchPointRow[]> {
  const since = new Date(Date.now() - OWED_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await db()
    .from("touch_points")
    .select("*")
    .eq("status", "scheduled")
    .is("attendance_recorded_at", null)
    .lte("starts_at", new Date().toISOString())
    .gte("starts_at", since)
    .order("starts_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[attendance] owed query failed:", error.message);
    return [];
  }
  return ((data ?? []) as TouchPointRow[]).filter((tp) => canRecordAttendance(viewer, tp));
}

/** The nag-ladder bookkeeping columns live on `touch_points` but aren't part
 *  of the calendar's row type — the cron needs them. */
export type OwedTouchPoint = TouchPointRow & {
  attendance_reminders: number;
  attendance_reminded_on: string | null;
};

/** Every touch point that is still waiting on a record, LC-wide — the cron's
 *  work list (no viewer, no filtering). */
export async function unrecordedTouchPoints(lookbackDays = 30): Promise<OwedTouchPoint[]> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const { data, error } = await db()
    .from("touch_points")
    .select("*")
    .eq("status", "scheduled")
    .is("attendance_recorded_at", null)
    .lte("starts_at", new Date().toISOString())
    .gte("starts_at", since)
    .order("starts_at");
  if (error) {
    console.error("[attendance] unrecorded query failed:", error.message);
    return [];
  }
  return (data ?? []) as OwedTouchPoint[];
}

/** The paginated history: one row per person per touch point, newest first. */
export async function listAttendanceHistory(
  viewer: Viewer,
  filters: AttendanceFilters
): Promise<{ rows: AttendanceHistoryRow[]; total: number; page: number; totals: AttendanceTotals }> {
  const page = Math.max(0, (filters.page ?? 1) - 1);
  // rows-per-page is the member's own choice (v31) — whitelisted by the page
  const pageSize = PAGE_SIZE_OPTIONS.includes(filters.pageSize ?? 0)
    ? (filters.pageSize as number)
    : ATTENDANCE_PAGE_SIZE;
  const empty = {
    rows: [],
    total: 0,
    page,
    totals: { total: 0, attended: 0, late: 0, absent: 0, excused: 0, rate: 0 },
  };

  // 1. the touch points in range (the history is ordered by when they HAPPENED)
  let tpq = db().from("touch_points").select("*").order("starts_at", { ascending: false });
  // the pickers are CAIRO calendar days — a UTC midnight would push the
  // 00:00–02:59 band of every day into the day before
  if (filters.from) tpq = tpq.gte("starts_at", cairoToUtc(filters.from, "00:00").toISOString());
  if (filters.to) {
    const next = new Date(`${filters.to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    // `lt` the NEXT Cairo midnight, so a DST hour is never dropped or doubled
    tpq = tpq.lt("starts_at", cairoToUtc(next.toISOString().slice(0, 10), "00:00").toISOString());
  }
  if (filters.kind) tpq = tpq.eq("kind", filters.kind);
  const { data: tpData, error: tpError } = await tpq.limit(HISTORY_TOUCH_POINT_CAP);
  if (tpError) {
    console.error("[attendance] history touch points failed:", tpError.message);
    return empty;
  }
  const touchPoints = (tpData ?? []) as TouchPointRow[];
  if (touchPoints.length === 0) return empty;
  const byTp = new Map(touchPoints.map((t) => [t.id, t]));

  // 2. the attendance rows on them, inside the viewer's read scope
  const scope = await attendanceMemberScope(viewer);
  if (scope && scope.length === 0) return empty;
  const rows = await inChunks<AttendanceRow>(
    touchPoints.map((t) => t.id),
    80,
    async (chunk) => {
      let q = db().from("touch_point_attendance").select("*").in("touch_point_id", chunk);
      if (scope) q = q.in("member_id", scope);
      if (filters.status) q = q.eq("status", filters.status);
      const { data, error } = await q;
      if (error) {
        console.error("[attendance] history rows failed:", error.message);
        return [];
      }
      return (data ?? []) as AttendanceRow[];
    }
  );
  if (rows.length === 0) return { ...empty, totals: totalsOf([]) };

  // newest touch point first, then a stable name order inside it
  rows.sort((a, b) => {
    const ta = byTp.get(a.touch_point_id)?.starts_at ?? "";
    const tb = byTp.get(b.touch_point_id)?.starts_at ?? "";
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.member_id < b.member_id ? -1 : 1;
  });

  const totals = totalsOf(rows);
  const slice = rows.slice(page * pageSize, (page + 1) * pageSize);

  // 3. names + appeals for the visible page only
  const memberIds = [...new Set(slice.map((r) => r.member_id))];
  const names = await memberNames(memberIds);
  const appeals = await appealsForAttendance(slice.map((r) => r.id));

  const out: AttendanceHistoryRow[] = slice.map((r) => {
    const tp = byTp.get(r.touch_point_id)!;
    const appeal = appeals.get(r.id);
    return {
      id: r.id,
      status: r.status,
      excused: r.excused,
      excuse: r.excuse,
      automatic: r.automatic,
      recordedAt: r.recorded_at,
      memberId: r.member_id,
      memberName: names.get(r.member_id) ?? "—",
      mine: r.member_id === viewer.id,
      canRecord: canRecordAttendance(viewer, tp),
      touchPointId: tp.id,
      label: touchPointLabel(tp.scope, tp.kind),
      kind: tp.kind,
      scope: tp.scope,
      startsAt: tp.starts_at,
      audience: audienceLabel(tp),
      ownerName: tp.owner_name,
      appeal: appeal ? { id: appeal.id, message: appeal.message, resolved: appeal.resolved } : null,
    };
  });
  return { rows: out, total: rows.length, page, totals };
}

function totalsOf(rows: AttendanceRow[]): AttendanceTotals {
  const attended = rows.filter((r) => r.status === "attended").length;
  const late = rows.filter((r) => r.status === "late").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const excused = rows.filter((r) => r.excused).length;
  return {
    total: rows.length,
    attended,
    late,
    absent,
    excused,
    rate: rows.length === 0 ? 0 : Math.round((attended / rows.length) * 100),
  };
}

export async function memberNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await inChunks<{ id: string; name: string; nickname: string | null }>(
    ids,
    100,
    async (chunk) => {
      const { data } = await db().from("members").select("id, name").in("id", chunk);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[];
    }
  );
  for (const m of rows) map.set(m.id, m.name);
  return map;
}

async function appealsForAttendance(attendanceIds: string[]): Promise<Map<string, AppealRow>> {
  const map = new Map<string, AppealRow>();
  if (attendanceIds.length === 0) return map;
  const rows = await inChunks<AppealRow>(attendanceIds, 80, async (chunk) => {
    const { data } = await db()
      .from("attendance_appeals")
      .select("*")
      .in("attendance_id", chunk)
      .order("created_at", { ascending: false });
    return (data ?? []) as AppealRow[];
  });
  // newest appeal per row wins
  for (const a of rows) if (!map.has(a.attendance_id)) map.set(a.attendance_id, a);
  return map;
}

/** Open appeals this viewer is expected to answer (TM core sees them all). */
export interface OpenAppeal {
  id: string;
  message: string;
  createdAt: string;
  memberName: string;
  status: AttendanceStatus;
  label: string;
  startsAt: string;
  touchPointId: string;
}

export async function listOpenAppeals(viewer: Viewer): Promise<OpenAppeal[]> {
  const { data, error } = await db()
    .from("attendance_appeals")
    .select("*")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[attendance] appeals query failed:", error.message);
    return [];
  }
  const appeals = (data ?? []) as AppealRow[];
  if (appeals.length === 0) return [];

  const rows = await inChunks<AttendanceRow>(
    [...new Set(appeals.map((a) => a.attendance_id))],
    80,
    async (chunk) => {
      const { data: d } = await db().from("touch_point_attendance").select("*").in("id", chunk);
      return (d ?? []) as AttendanceRow[];
    }
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tps = await inChunks<TouchPointRow>(
    [...new Set(rows.map((r) => r.touch_point_id))],
    80,
    async (chunk) => {
      const { data: d } = await db().from("touch_points").select("*").in("id", chunk);
      return (d ?? []) as TouchPointRow[];
    }
  );
  const tpById = new Map(tps.map((t) => [t.id, t]));
  const names = await memberNames([...new Set(appeals.map((a) => a.member_id))]);

  return appeals
    .map((a) => {
      const row = byId.get(a.attendance_id);
      const tp = row ? tpById.get(row.touch_point_id) : null;
      if (!row || !tp) return null;
      if (!canRecordAttendance(viewer, tp)) return null;
      return {
        id: a.id,
        message: a.message,
        createdAt: a.created_at,
        memberName: names.get(a.member_id) ?? "—",
        status: row.status,
        label: touchPointLabel(tp.scope, tp.kind),
        startsAt: tp.starts_at,
        touchPointId: tp.id,
      };
    })
    .filter((x): x is OpenAppeal => x !== null);
}

// ------------------------------------------------------------------ the working-hours engine

export interface WorkVerdict {
  memberId: string;
  status: AttendanceStatus;
  actions: number;
  spanMinutes: number;
}

/** Judges every person in the audience from their stamped work activity.
 *  Pure read — the caller decides what to write. */
export async function workingHoursVerdicts(tp: TouchPointRow): Promise<WorkVerdict[]> {
  const audience = await touchPointAudience(tp);
  if (audience.length === 0) return [];
  const { from, to } = workWindow(tp.starts_at);

  const acts = await inChunks<{ member_id: string; at: string }>(
    audience.map((m) => m.id),
    100,
    async (chunk) => {
      const { data, error } = await db()
        .from("work_activity")
        .select("member_id, at")
        .in("member_id", chunk)
        .gte("at", from)
        .lte("at", to)
        .order("at");
      if (error) {
        console.error("[attendance] work activity query failed:", error.message);
        return [];
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []) as any[];
    }
  );

  const byMember = new Map<string, number[]>();
  for (const a of acts) {
    const t = new Date(a.at).getTime();
    const list = byMember.get(a.member_id);
    if (list) list.push(t);
    else byMember.set(a.member_id, [t]);
  }

  return audience.map((m) => {
    const times = (byMember.get(m.id) ?? []).sort((a, b) => a - b);
    const spanMinutes =
      times.length < 2 ? 0 : Math.round((times[times.length - 1] - times[0]) / 60_000);
    const attended = times.length >= WORK_MIN_ACTIONS && spanMinutes >= WORK_MIN_GAP_MINUTES;
    return {
      memberId: m.id,
      status: (attended ? "attended" : "absent") as AttendanceStatus,
      actions: times.length,
      spanMinutes,
    };
  });
}

export interface ComputeResult {
  ok: boolean;
  error?: string;
  written: number;
  attended: number;
  absent: number;
  /** rows a human already owns — never touched */
  skipped: number;
}

/** AUTOMATIC working-hours attendance — the PRE-FILL, not the record (v29.3).
 *
 *  It writes everyone's attended/absent row from their stamped work activity,
 *  and that is ALL it does: `attendance_recorded_at` (= "a human confirmed
 *  this") is deliberately left alone, so the responsible still has to open the
 *  sheet, review what the engine decided and press Confirm — which is what
 *  stamps it, through `saveAttendance`. Until then the point keeps showing up
 *  in "Needs recording" and the reminder ladder keeps nagging, exactly like a
 *  meeting or an outing.
 *
 *  Idempotent, and it NEVER overwrites a row a human recorded or edited
 *  (`automatic = false` or `recorded_by` set). Called by the nightly cron once
 *  a window has closed, and by the "Recompute" button through
 *  `computeWorkingHoursAttendance` in `attendance.ts`. */
export async function runWorkingHoursAttendance(touchPointId: string): Promise<ComputeResult> {
  const zero: ComputeResult = { ok: false, written: 0, attended: 0, absent: 0, skipped: 0 };
  const tp = await getTouchPoint(touchPointId);
  if (!tp) return { ...zero, error: "That touch point no longer exists." };
  if (tp.kind !== "working_hours")
    return { ...zero, error: "Only working hours are recorded automatically." };
  if (tp.status !== "scheduled")
    return { ...zero, error: "This touch point is cancelled — nothing to record." };
  if (!workWindowClosed(tp.starts_at))
    return {
      ...zero,
      error: `The session is still open — it can be computed ${WORK_SESSION_HOURS} hours after it starts.`,
    };

  const [verdicts, existing] = await Promise.all([
    workingHoursVerdicts(tp),
    listAttendanceFor(touchPointId),
  ]);
  if (verdicts.length === 0)
    return { ...zero, error: "Nobody is in this touch point's audience yet." };

  const byMember = new Map(existing.map((r) => [r.member_id, r]));
  const writable = verdicts.filter((v) => {
    const row = byMember.get(v.memberId);
    // a human owns this row — the engine keeps its hands off
    return !row || (row.automatic && !row.recorded_by);
  });
  const skipped = verdicts.length - writable.length;

  if (writable.length > 0) {
    const { error } = await db()
      .from("touch_point_attendance")
      .upsert(
        writable.map((v) => ({
          touch_point_id: touchPointId,
          member_id: v.memberId,
          status: v.status,
          excused: false,
          excuse: null,
          automatic: true,
          recorded_by: null,
          recorded_at: new Date().toISOString(),
        })),
        { onConflict: "touch_point_id,member_id" }
      );
    if (error) {
      console.error("[attendance] automatic write failed:", error.message);
      return { ...zero, error: error.message };
    }
  }

  // NO `attendance_recorded_at` stamp and NO prompt resolving here: the rows
  // are a proposal until the responsible confirms them in the sheet.

  return {
    ok: true,
    written: writable.length,
    attended: writable.filter((v) => v.status === "attended").length,
    absent: writable.filter((v) => v.status === "absent").length,
    skipped,
  };
}

// ------------------------------------------------------------------ the pending-prompt ladder

export interface PendingPromptRow {
  id: string;
  kind: string;
  ref_id: string | null;
  title: string;
  body: string | null;
  link: string | null;
}

/** The oldest unresolved must-do prompt for this member (the blocking dialog
 *  the AppShell mounts). Generic on purpose — kind + ref_id + title/body/link
 *  means any future "you still owe us X" reuses the whole ladder. */
export async function openPendingPrompt(memberId: string): Promise<PendingPromptRow | null> {
  // the OLDEST prompt masks every later one, so a stranded row would hide
  // every genuine future prompt — self-heal past anything unrecordable
  for (let guard = 0; guard < 5; guard += 1) {
    const { data, error } = await db()
      .from("pending_prompts")
      .select("id, kind, ref_id, title, body, link")
      .eq("member_id", memberId)
      .eq("resolved", false)
      .order("created_at")
      .limit(1)
      .maybeSingle<PendingPromptRow>();
    if (error) {
      console.error("[attendance] pending prompt query failed:", error.message);
      return null;
    }
    const row = data ?? null;
    if (!row) return null;
    if (row.kind === "attendance" && row.ref_id) {
      const tp = await getTouchPoint(row.ref_id);
      // cancelled (or gone) → nothing can ever be recorded for it
      if (!tp || tp.status !== "scheduled") {
        await resolveAttendancePrompts(row.ref_id);
        continue;
      }
    }
    return row;
  }
  return null;
}

/** The record landed → every prompt about it is done. */
export async function resolveAttendancePrompts(touchPointId: string): Promise<void> {
  const { error } = await db()
    .from("pending_prompts")
    .update({ resolved: true })
    .eq("kind", "attendance")
    .eq("ref_id", touchPointId)
    .eq("resolved", false);
  if (error) console.error("[attendance] prompt resolve failed:", error.message);
}
