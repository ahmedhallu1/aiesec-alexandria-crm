"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/supabase";
import {
  canEditOwnAttendanceRow,
  canRecordAttendance,
  isTmCore,
} from "@/lib/rbac";
import {
  ATTENDANCE_STATUSES,
  touchPointLabel,
  type AttendanceStatus,
} from "@/lib/types";
import { audienceLabel, cairoWhen, touchPointName } from "@/lib/touch-points";
import { getViewer, logAudit } from "./data";
import { recordUndo, sandboxSuppressed, snapshotForUndo } from "./sandbox";
import { notifyTouchPointAudience } from "./tm-notify";
import { sendEmail } from "@/lib/google/gmail";
import { getTouchPoint, touchPointAudience } from "./touch-points-read";
import {
  listAttendanceFor,
  openPendingPrompt,
  resolveAttendancePrompts,
  runWorkingHoursAttendance,
  workWindowClosed,
  workingHoursVerdicts,
  WORKING_HOURS_RULE,
  type AppealRow,
  type AttendanceRow,
  type ComputeResult,
  type PendingPromptRow,
} from "./attendance-read";

/** ATTENDANCE actions (v29 · confirmation added in v29.3).
 *
 *  Meetings and outings are recorded by a human (`saveAttendance`); WORKING
 *  HOURS are PRE-FILLED from the work every member already does — every
 *  meaningful action stamps `work_activity` through `stampWork`, and the
 *  engine in `attendance-read.ts` turns those stamps into attended/absent.
 *  The pre-fill is a proposal, not a record: the responsible must still open
 *  the sheet and CONFIRM it (`saveAttendance`, the only stamper of
 *  `attendance_recorded_at`) or the nightly reminder ladder keeps asking. */

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; code?: string };

const fail = (error: string, code?: string): Result<never> => ({ ok: false, error, code });
const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function refresh() {
  revalidatePath("/", "layout");
}

// ================================================================== work stamps

/** Every meaningful piece of work stamps one `work_activity` row — the raw
 *  material of AUTOMATIC working-hours attendance. Fire-and-forget: wrapped in
 *  `after()` so Vercel can't freeze the lambda over a floating promise, and
 *  never allowed to break the action that earned it.
 *
 *  Call it as the LAST line of an action's success path:
 *      await stampWork(viewer.id, "contact");
 *  (the await only covers the sandbox check — the insert runs after the
 *  response, so it costs the member nothing). */
export async function stampWork(viewerId: string, kind: string): Promise<void> {
  if (!viewerId) return;
  // a sandbox test view must never fabricate someone's working hours
  if (await sandboxSuppressed(`work stamp (${kind})`)) return;
  after(async () => {
    try {
      const { error } = await db()
        .from("work_activity")
        .insert({ member_id: viewerId, kind: String(kind).slice(0, 40) });
      if (error) console.error("[attendance] work stamp failed:", error.message);
    } catch (e) {
      console.error("[attendance] work stamp failed:", e);
    }
  });
}

// ================================================================== the recording sheet

export interface AttendanceSheetRow {
  memberId: string;
  name: string;
  role: string;
  team: string | null;
  status: AttendanceStatus | null;
  excused: boolean;
  excuse: string | null;
  automatic: boolean;
  /** the viewer's own row on a point they only got edit rights to */
  locked: boolean;
  /** working hours: what the engine saw ("3 actions · 47 min apart") */
  workHint: string | null;
}

export interface AttendanceSheet {
  id: string;
  label: string;
  kind: string;
  whenLabel: string;
  audience: string;
  scope: string;
  ownerName: string;
  note: string | null;
  recordedAt: string | null;
  isWorkingHours: boolean;
  windowClosed: boolean;
  rule: string;
  rows: AttendanceSheetRow[];
}

/** Everything the recording dialog needs: the exact audience, whatever is
 *  already recorded, and (for working hours) what the engine measured. */
export async function loadAttendanceSheet(
  touchPointId: string
): Promise<Result<AttendanceSheet>> {
  const viewer = await getViewer();
  const tp = await getTouchPoint(touchPointId);
  if (!tp) return fail("That touch point no longer exists.");
  if (!canRecordAttendance(viewer, tp))
    return fail("Recording this one's attendance is above your access.", "forbidden");

  const isWorkingHours = tp.kind === "working_hours";
  const [audience, existing, verdicts] = await Promise.all([
    touchPointAudience(tp),
    listAttendanceFor(touchPointId),
    isWorkingHours ? workingHoursVerdicts(tp) : Promise.resolve([]),
  ]);
  let rowsForSheet = existing;
  // AUTO PRE-FILL ON OPEN (v33.17): a finished working-hours session used to
  // sit empty until the reviewer clicked "Recompute" (or the nightly cron
  // got there first). Opening the sheet IS the request to compute — run the
  // engine when the window has closed and no pre-fill exists yet. Guards:
  // never after a human confirmed (attendance_recorded_at — rows they left
  // auto would otherwise be rewritable), never in a sandbox, never twice.
  // v33.32 — and only if the point's own function still wants the pre-fill.
  // A leader who turned it off means "we record these by hand".
  const autoAllowed = await (async () => {
    if (!isWorkingHours) return false;
    try {
      const { allFunctionSettings } = await import("./function-settings");
      const all = await allFunctionSettings();
      const key = tp.function_key ?? "";
      return !key || all[key]?.workingHoursAuto !== false;
    } catch {
      return true;
    }
  })();
  if (
    isWorkingHours &&
    autoAllowed &&
    tp.status === "scheduled" &&
    !tp.attendance_recorded_at &&
    workWindowClosed(tp.starts_at) &&
    !viewer.sandbox &&
    !existing.some((r) => r.automatic)
  ) {
    try {
      await runWorkingHoursAttendance(tp.id);
      rowsForSheet = await listAttendanceFor(touchPointId);
    } catch (e) {
      console.error("[attendance] auto pre-fill failed:", e);
    }
  }
  const byMember = new Map(rowsForSheet.map((r) => [r.member_id, r]));
  const verdictBy = new Map(verdicts.map((v) => [v.memberId, v]));
  const canOwn = canEditOwnAttendanceRow(viewer, tp);

  return {
    ok: true,
    data: {
      id: tp.id,
      label: touchPointName(tp),
      kind: tp.kind,
      whenLabel: cairoWhen(tp.starts_at),
      audience: audienceLabel(tp),
      scope: tp.scope,
      ownerName: tp.owner_name,
      note: tp.note,
      recordedAt: tp.attendance_recorded_at,
      isWorkingHours,
      windowClosed: workWindowClosed(tp.starts_at),
      rule: WORKING_HOURS_RULE,
      rows: audience.map((m) => {
        const row = byMember.get(m.id);
        const v = verdictBy.get(m.id);
        return {
          memberId: m.id,
          name: m.name,
          role: m.role,
          team: m.team_name,
          status: row?.status ?? null,
          excused: row?.excused ?? false,
          excuse: row?.excuse ?? null,
          automatic: row?.automatic ?? false,
          locked: m.id === viewer.id && !canOwn,
          workHint: v
            ? `${v.actions} action${v.actions === 1 ? "" : "s"}${v.actions >= 2 ? ` · ${v.spanMinutes} min apart` : ""}`
            : null,
        };
      }),
    },
  };
}

export interface AttendanceInputRow {
  memberId: string;
  status: AttendanceStatus;
  excused?: boolean;
  excuse?: string | null;
}

/** Record (or correct) attendance — and, for WORKING HOURS, the human
 *  CONFIRMATION of what the engine pre-filled (v29.3): this is the only path
 *  that stamps `attendance_recorded_at`, whether the responsible changed a row
 *  or simply agreed with all of them. Editable later by exactly the same
 *  people — the predicate is the single gate. */
export async function saveAttendance(
  touchPointId: string,
  rows: AttendanceInputRow[]
): Promise<Result<{ saved: number; confirmed: boolean }>> {
  const viewer = await getViewer();
  const tp = await getTouchPoint(touchPointId);
  if (!tp) return fail("That touch point no longer exists.");
  if (!canRecordAttendance(viewer, tp))
    return fail("Recording this one's attendance is above your access.", "forbidden");
  if (tp.status !== "scheduled")
    return fail("This touch point is cancelled — there is nothing to record.");
  // working hours are EVIDENCE-based: confirming them before the session has
  // even finished would let anyone mark a whole team present in advance AND
  // permanently lock the engine out of every row it touched
  if (tp.kind === "working_hours" && !workWindowClosed(tp.starts_at))
    return fail(
      "This session is still running — it gets pre-filled and can be confirmed once its window closes."
    );

  const audience = await touchPointAudience(tp);
  const allowed = new Set(audience.map((m) => m.id));
  const canOwn = canEditOwnAttendanceRow(viewer, tp);
  const existing = await listAttendanceFor(touchPointId);
  const byMember = new Map(existing.map((r) => [r.member_id, r]));

  const now = new Date().toISOString();
  let unchanged = 0;
  const payload = (rows ?? [])
    .filter((r) => r && allowed.has(r.memberId))
    // nobody marks THEMSELF present on a point they only got edit rights to:
    // the row is left exactly as it was
    .filter((r) => canOwn || r.memberId !== viewer.id)
    .filter((r) => (ATTENDANCE_STATUSES as readonly string[]).includes(r.status))
    .map((r) => {
      // an excuse only means anything when someone wasn't there on time
      const excusable = r.status === "absent" || r.status === "late";
      const excused = excusable ? !!r.excused : false;
      const excuse = excusable ? clean(r.excuse, 500) || null : null;
      // an UNTOUCHED automatic row stays the engine's: re-saving it verbatim
      // (opening the sheet to fix one person re-sends everybody) would hand it
      // to a human and make "Recompute" a permanent no-op
      const prior = byMember.get(r.memberId);
      if (
        prior?.automatic && !prior.recorded_by &&
        prior.status === r.status && !prior.excused && !excused
      ) {
        unchanged += 1;
        return null;
      }
      return {
        touch_point_id: touchPointId,
        member_id: r.memberId,
        status: r.status,
        excused,
        excuse,
        automatic: false,
        recorded_by: viewer.id,
        recorded_at: now,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  // a PURE REVIEW of the engine's pre-filled rows writes nothing — but it is
  // still the human confirmation working hours now require, so it must fall
  // through to the stamp below instead of returning early
  if (payload.length === 0 && unchanged === 0)
    return fail("Set at least one person's attendance first.");

  if (payload.length > 0) {
    // journal the rows that already existed, so a sandbox exit can restore them
    for (const p of payload) {
      const prior = byMember.get(p.member_id);
      if (prior) await snapshotForUndo("touch_point_attendance", prior.id);
    }

    const { data: saved, error } = await db()
      .from("touch_point_attendance")
      .upsert(payload, { onConflict: "touch_point_id,member_id" })
      .select("id, member_id");
    if (error) {
      if (error.message.includes("touch_point_attendance"))
        return fail("Attendance needs migration 0031 — run it in the Supabase SQL editor.");
      return fail(error.message);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of ((saved ?? []) as any[]))
      if (!byMember.has(s.member_id)) await recordUndo("touch_point_attendance", s.id, "insert");
  }

  // A ONE-PERSON manual fix must not pass for a confirmation: a working-hours
  // point counts as reviewed only when EVERY person in the audience has a row.
  // Read them back rather than counting what this save touched — the engine
  // pre-filled most of them, and the recorder's OWN row may be locked to them.
  const covered =
    tp.kind === "working_hours"
      ? new Set((await listAttendanceFor(touchPointId)).map((r) => r.member_id))
      : null;
  const coversAudience = !covered || audience.every((m) => covered.has(m.id));
  if (!tp.attendance_recorded_at && coversAudience) {
    await snapshotForUndo("touch_points", touchPointId);
    const { error: stampError } = await db()
      .from("touch_points")
      .update({ attendance_recorded_at: now })
      .eq("id", touchPointId);
    // an unstamped record would keep nagging the recorder every night
    if (stampError) return fail(`Saved, but the touch point could not be stamped: ${stampError.message}`);
  }
  const confirmed = !!tp.attendance_recorded_at || coversAudience;
  // the "you still owe a record" prompt lifts on CONFIRMATION only — a partial
  // working-hours edit leaves the ladder exactly where it was
  if (confirmed) await resolveAttendancePrompts(touchPointId);
  await logAudit(viewer.id, "attendance_record", "touch_point", touchPointId, {
    rows: payload.length,
    confirmed,
  });
  refresh();
  return { ok: true, data: { saved: payload.length, confirmed } };
}

/** The "Recompute" button — the same engine the nightly cron runs, behind the
 *  recording predicate. Idempotent, human-edited rows survive it, and it does
 *  NOT confirm anything: the responsible still presses Confirm afterwards. */
export async function computeWorkingHoursAttendance(
  touchPointId: string
): Promise<Result<ComputeResult>> {
  const viewer = await getViewer();
  const tp = await getTouchPoint(touchPointId);
  if (!tp) return fail("That touch point no longer exists.");
  if (!canRecordAttendance(viewer, tp))
    return fail("Recording this one's attendance is above your access.", "forbidden");
  if (viewer.sandbox)
    return fail("Recomputing working hours is disabled in the sandbox test view.");

  const res = await runWorkingHoursAttendance(touchPointId);
  if (!res.ok) return fail(res.error ?? "The session could not be computed.");
  await logAudit(viewer.id, "attendance_auto", "touch_point", touchPointId, {
    attended: res.attended,
    absent: res.absent,
  });
  refresh();
  return { ok: true, data: res };
}

// ================================================================== appeals

/** Active TM people — CC'd on every appeal so nothing is settled in private. */
async function tmCcEmails(): Promise<string[]> {
  const { data } = await db()
    .from("members")
    .select("email, role, functions, sub_functions")
    .eq("is_active", true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter(
      (m) =>
        m.email &&
        m.role !== "LCP" && // the LCP never receives operational mail
        [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes("TM")
    )
    .map((m) => m.email as string);
}

/** "I think this is wrong" — on their OWN row only. Goes to whoever recorded
 *  it (the touch point's owner when the engine did), TM on CC. */
export async function appealAttendance(
  attendanceId: string,
  message: string
): Promise<Result> {
  const viewer = await getViewer();
  const { data: row } = await db()
    .from("touch_point_attendance")
    .select("*")
    .eq("id", attendanceId)
    .maybeSingle<AttendanceRow>();
  if (!row) return fail("That attendance record no longer exists.");
  if (row.member_id !== viewer.id)
    return fail("You can only appeal your OWN attendance.", "forbidden");

  const text = clean(message, 1000);
  if (text.length < 5)
    return fail("Say what actually happened — a line or two is enough.");

  // NOTHING TO APPEAL WHEN YOU WERE MARKED PRESENT (v33.19.2) — an appeal is
  // "this record is wrong about me", and "attended" is the record everyone
  // wants. Late/absent are the ones worth contesting.
  if (row.status === "attended")
    return fail("You're marked attended — there's nothing to appeal 🙂");

  const tp = await getTouchPoint(row.touch_point_id);
  if (!tp) return fail("That touch point no longer exists.");

  // one open appeal per row — the client hides the button, the server means it
  const { data: pending } = await db()
    .from("attendance_appeals")
    .select("id")
    .eq("attendance_id", attendanceId)
    .eq("resolved", false)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (pending)
    return fail("You already appealed this one — it's still being reviewed.");

  const { data: created, error } = await db()
    .from("attendance_appeals")
    .insert({ attendance_id: attendanceId, member_id: viewer.id, message: text })
    .select("id")
    .single<{ id: string }>();
  if (error || !created) {
    if (error?.message.includes("attendance_appeals"))
      return fail("Appeals need migration 0031 — run it in the Supabase SQL editor.");
    return fail(error?.message ?? "The appeal could not be filed — try again.");
  }
  await recordUndo("attendance_appeals", created.id, "insert");

  // the engine's rows have no recorder — the touch point's owner answers them
  const targetId = row.recorded_by ?? tp.owner_id;
  const label = touchPointName(tp);
  const whenLabel = cairoWhen(tp.starts_at);
  if (targetId) {
    // sandbox: the tester gets the bell, the real recorder is left alone
    await notifyTouchPointAudience(
      viewer.id,
      [targetId],
      "info",
      `🙋 Attendance appeal — ${viewer.name}`,
      `${label} · ${whenLabel} — recorded as "${row.status}". ${text}`,
      viewer.id,
      `/attendance?tp=${tp.id}`
    );
  }

  // …and a TEST appeal must never land in a real inbox (the recorder's or TM's)
  if (!(await sandboxSuppressed("attendance appeal email"))) {
    const { data: target } = targetId
      ? await db().from("members").select("email").eq("id", targetId).maybeSingle<{ email: string | null }>()
      : { data: null };
    const to = target?.email ? [target.email] : [];
    const cc = (await tmCcEmails()).filter((e) => !to.includes(e) && e !== viewer.email);
    const recipients = to.length > 0 ? to : cc;
    if (recipients.length > 0) {
      const { attendanceAppealEmail } = await import("@/lib/email/attendance-templates");
      const mail = attendanceAppealEmail({
        memberName: viewer.name,
        label,
        whenLabel,
        status: row.status,
        automatic: row.automatic,
        message: text,
        touchPointId: tp.id,
      });
      await sendEmail({
        to: recipients,
        cc: to.length > 0 ? cc : [],
        ...mail,
      }).catch((e) => console.error("[attendance] appeal email failed:", e));
    }
  }

  await logAudit(viewer.id, "attendance_appeal", "touch_point", tp.id, { status: row.status });
  refresh();
  return { ok: true };
}

/** The recorder (or TM core) closes an appeal — after fixing the row or after
 *  explaining it. */
export async function resolveAppeal(appealId: string): Promise<Result> {
  const viewer = await getViewer();
  const { data: appeal } = await db()
    .from("attendance_appeals")
    .select("*")
    .eq("id", appealId)
    .maybeSingle<AppealRow>();
  if (!appeal) return fail("That appeal no longer exists.");
  if (appeal.resolved) return { ok: true };

  const { data: row } = await db()
    .from("touch_point_attendance")
    .select("*")
    .eq("id", appeal.attendance_id)
    .maybeSingle<AttendanceRow>();
  const tp = row ? await getTouchPoint(row.touch_point_id) : null;
  if (!row || !tp) return fail("That attendance record no longer exists.");
  if (!canRecordAttendance(viewer, tp) && !isTmCore(viewer))
    return fail("Only the recorder or TM can close an appeal.", "forbidden");

  await snapshotForUndo("attendance_appeals", appealId);
  const { error } = await db()
    .from("attendance_appeals")
    .update({ resolved: true })
    .eq("id", appealId);
  if (error) return fail(error.message);

  // sandbox: the member who appealed hears nothing from a test view
  await notifyTouchPointAudience(
    viewer.id,
    [appeal.member_id],
    "info",
    "✅ Your attendance appeal was reviewed",
    `${touchPointName(tp)} · ${cairoWhen(tp.starts_at)} — check the record on /attendance.`,
    viewer.id,
    `/attendance?tp=${tp.id}`
  );
  await logAudit(viewer.id, "attendance_appeal_resolve", "touch_point", tp.id);
  refresh();
  return { ok: true };
}

// ================================================================== the pending prompt

/** The blocking "you still owe us something" prompt (the AppShell asks on
 *  every app open). Generic — any future must-do action reuses it. */
export async function getMyPendingPrompt(): Promise<PendingPromptRow | null> {
  try {
    const viewer = await getViewer();
    return await openPendingPrompt(viewer.id);
  } catch {
    // no session yet (or mid-sign-out) — nothing to prompt about
    return null;
  }
}
