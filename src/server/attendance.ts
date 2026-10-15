"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import {
  canEditAttendanceRowOf,
  canEditOwnAttendanceRow,
  canRecordAttendance,
  isTmCore,
} from "@/lib/rbac";
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
} from "@/lib/types";
import { audienceLabel, cairoWhen, touchPointName } from "@/lib/touch-points";
import { getViewer, logAudit } from "./data";
import {
  recordUndo, recordUndoMany, sandboxSuppressed, snapshotForUndo, snapshotManyForUndo,
} from "./sandbox";
import { notifyTouchPointAudience } from "./tm-notify";
import { sendEmail } from "@/lib/google/gmail";
import {
  getTouchPoint, memberInTouchPointAudience, tmFunctionEmails, touchPointAudience,
} from "./touch-points-read";
import {
  listAttendanceFor,
  openPendingPrompt,
  resolveAttendancePrompts,
  workWindowClosed,
  workingHoursVerdicts,
  WORKING_HOURS_RULE,
  type AppealRow,
  type AttendanceRow,
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
  /** v33.42 — the ENGINE's proposal, held in memory and not saved anywhere.
   *  It fills the control so the reviewer confirms rather than types; nothing
   *  counts until they press Confirm. */
  suggested: boolean;
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
  // THE ENGINE SUGGESTS, IT NEVER RECORDS (v33.42, by the LCP's request).
  //
  // It used to WRITE attended/absent rows — on the nightly cron and again when
  // the sheet was opened — and those rows counted in every history and stat
  // while no human had confirmed a thing. "Automatic attendance" should mean a
  // filled-in form waiting for a person, not a record. So the verdicts now
  // ride the sheet in memory: the control comes pre-selected, and pressing
  // Confirm (`saveAttendance`) is still the only thing that writes anything.
  //
  // A function whose leader turned the pre-fill off gets an empty sheet, as
  // before — they record by hand.
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
  const engineSuggests =
    isWorkingHours && autoAllowed && workWindowClosed(tp.starts_at) && !viewer.sandbox;
  const suggestFrom = engineSuggests
    ? new Map(verdicts.map((v) => [v.memberId, v]))
    : null;
  const byMember = new Map(existing.map((r) => [r.member_id, r]));
  const verdictBy = new Map(verdicts.map((v) => [v.memberId, v]));

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
        // saved row first; else the engine's proposal, which is NOT saved
        const proposed = row ? null : suggestFrom?.get(m.id)?.status ?? null;
        return {
          memberId: m.id,
          name: m.name,
          role: m.role,
          team: m.team_name,
          status: row?.status ?? proposed,
          excused: row?.excused ?? false,
          excuse: row?.excuse ?? null,
          automatic: row?.automatic ?? false,
          suggested: !row && !!proposed,
          // your own row on a point you may only edit — and, since v33.40,
          // any row of a member outside your function: authority follows
          // the member, so a cross-function sheet locks the other slices
          locked: !canEditAttendanceRowOf(viewer, tp, { id: m.id, functions: m.functions }),
          workHint: v
            ? `${v.actions} action${v.actions === 1 ? "" : "s"}${v.actions >= 2 ? ` · ${v.spanMinutes} min apart` : ""}`
            : null,
        };
      }),
    },
  };
}

/** TELL THEM BEFORE, NOT AFTER (v33.43).
 *
 *  Attendance could only be argued with once it had been recorded — the appeal
 *  is a post-mortem. Someone who KNOWS on Tuesday that Thursday is impossible
 *  had nowhere to say so, so they either turned up or vanished. Now anyone in
 *  an upcoming touch point's audience can file it themselves: it emails the TM
 *  function while the room can still be planned, and lands on the sheet as
 *  late/absent + EXCUSED, which whoever records the session can still change.
 *
 *  Deliberately not a leader's tool — a VP filing an excuse for somebody else
 *  is just recording attendance early, and that already has a screen. */
export async function excuseMyAttendance(
  touchPointId: string,
  input: { status: "absent" | "late"; excuse: string }
): Promise<Result> {
  const viewer = await getViewer();
  const tp = await getTouchPoint(touchPointId);
  if (!tp) return fail("That touch point no longer exists.");
  if (tp.status !== "scheduled") return fail("This touch point is cancelled.");
  if (input.status !== "absent" && input.status !== "late")
    return fail("Say whether you'll be late or can't come at all.");
  const excuse = clean(input.excuse, 500);
  if (!excuse || excuse.length < 3) return fail("Add a short reason — that's the whole point.");

  // it has to be YOUR touch point, and it has to still be ahead of you: an
  // excuse for a session that already happened is what the appeal is for
  const { data: me } = await db()
    .from("members")
    .select("id, name, email, role, functions, sub_functions, team_name, stakeholder_id")
    .eq("id", viewer.id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!me || !memberInTouchPointAudience(me as any, tp))
    return fail("You're not in this touch point's audience.");
  if (new Date(tp.starts_at).getTime() <= Date.now())
    return fail(
      "This one has already started — if the record is wrong once it's taken, appeal it instead."
    );
  if (tp.attendance_recorded_at)
    return fail("Attendance is already recorded for this one — appeal it instead.");

  const now = new Date().toISOString();
  const { data: existing } = await db()
    .from("touch_point_attendance")
    .select("id")
    .eq("touch_point_id", touchPointId)
    .eq("member_id", viewer.id)
    .maybeSingle<{ id: string }>();
  if (existing) await snapshotForUndo("touch_point_attendance", existing.id);

  const { error } = await db().from("touch_point_attendance").upsert(
    {
      touch_point_id: touchPointId,
      member_id: viewer.id,
      status: input.status,
      excused: true,
      excuse,
      automatic: false,
      recorded_by: viewer.id,
      recorded_at: now,
    },
    { onConflict: "touch_point_id,member_id" }
  );
  if (error) return fail(error.message);

  const label = touchPointName(tp);
  const whenLabel = cairoWhen(tp.starts_at);
  // TM hears it by email; the person who will record the session gets a bell
  if (!(await sandboxSuppressed("touch-point excuse email"))) {
    try {
      const to = await tmFunctionEmails();
      if (to.length > 0) {
        const { touchPointExcuseEmail } = await import("@/lib/email/touchpoint-templates");
        const mail = touchPointExcuseEmail({
          memberName: viewer.name,
          label,
          whenLabel,
          audience: audienceLabel(tp),
          status: input.status,
          excuse,
        });
        await sendEmail({
          topic: "attendance",
          to: [to[0]],
          bcc: to.length > 1 ? to.slice(1) : undefined,
          subject: mail.subject,
          html: mail.html,
        });
      }
    } catch (e) {
      console.error("[attendance] excuse email failed:", e);
    }
  }
  if (tp.owner_id && tp.owner_id !== viewer.id)
    await notifyTouchPointAudience(
      viewer.id,
      [tp.owner_id],
      "info",
      `${input.status === "late" ? "⏰" : "🙏"} ${viewer.name} — ${label}`,
      `${input.status === "late" ? "Will arrive late" : "Can't come"}: ${excuse}`,
      viewer.id,
      "/attendance"
    );

  await logAudit(viewer.id, "attendance_excuse", "touch_point", touchPointId, {
    status: input.status,
  });
  refresh();
  return { ok: true };
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
  const audienceById = new Map(audience.map((m) => [m.id, m]));
  const existing = await listAttendanceFor(touchPointId);
  const byMember = new Map(existing.map((r) => [r.member_id, r]));

  const now = new Date().toISOString();
  let unchanged = 0;
  // (v37.7) one entry per member (the last wins): a duplicate conflict key
  // makes the single upsert fail with a raw "cannot affect row a second time"
  const lastPerMember = new Map<string, AttendanceInputRow>();
  for (const r of rows ?? []) if (r && typeof r.memberId === "string") lastPerMember.set(r.memberId, r);
  const payload = [...lastPerMember.values()]
    // AUTHORITY FOLLOWS THE MEMBER (v33.40): each row must belong to the
    // audience AND to a function the recorder leads — the own-row rule
    // (nobody marks themself, v33.19.2) lives inside the same predicate.
    // Out-of-reach rows are left exactly as they were, like own rows before.
    .filter((r) => {
      if (!r) return false;
      const m = audienceById.get(r.memberId);
      return !!m && canEditAttendanceRowOf(viewer, tp, { id: m.id, functions: m.functions });
    })
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
    // (v37.13: one read + one journal insert for the whole audience, not two
    // round trips per person)
    await snapshotManyForUndo(
      "touch_point_attendance",
      payload.flatMap((p) => {
        const prior = byMember.get(p.member_id);
        return prior ? [prior.id] : [];
      })
    );

    const { data: saved, error } = await db()
      .from("touch_point_attendance")
      .upsert(payload, { onConflict: "touch_point_id,member_id" })
      .select("id, member_id");
    if (error) {
      if (error.message.includes("touch_point_attendance"))
        return fail("Attendance needs migration 0031 — run it in the Supabase SQL editor.");
      return fail(error.message);
    }
    await recordUndoMany(
      "touch_point_attendance",
      ((saved ?? []) as { id: string; member_id: string }[])
        .filter((s) => !byMember.has(s.member_id))
        .map((s) => ({ rowId: s.id, op: "insert" as const }))
    );
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
        topic: "attendance",
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
  // (v37.7) nobody marks themself (v33.19.2) — and nobody closes their OWN
  // appeal either: a recorder who appealed their own row waits for TM
  if (appeal.member_id === viewer.id && !canEditOwnAttendanceRow(viewer, tp))
    return fail("TM reviews your own appeal — you can't close it yourself.", "forbidden");

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
