import "server-only";

import { db } from "@/lib/supabase";
import { touchPointAudience, type TouchPointRow } from "./touch-points-read";

/** RSVP attendance (v32.9), moved out of touch-points.ts in v37.7: that file is
 *  "use server", so these two exports were public endpoints that take no
 *  viewer. They are server-only now. NOT wired into any cron (unchanged). */

/** Pulls the Yes/No people gave on a VIRTUAL touch point's calendar invite and
 *  writes it as PROVISIONAL attendance.
 *
 *  Google already asks everyone Yes/No/Maybe on the invite, so that is the
 *  signal — no second email nobody answers. The rules that matter:
 *    · accepted → attended, declined → absent; Maybe and no answer are left
 *      alone, because "didn't click" is not evidence of anything;
 *    · a HUMAN mark always wins — rows whose source is 'manual' are never
 *      touched, exactly like the working-hours engine;
 *    · this is a PROPOSAL. It does not stamp `attendance_recorded_at`; the
 *      responsible still confirms at the end of the day as normal. */
export async function syncTouchPointRsvps(
  touchPointId: string
): Promise<{ updated: number } | null> {
  const { data: tp } = await db()
    .from("touch_points")
    .select("*")
    .eq("id", touchPointId)
    .maybeSingle<TouchPointRow & { calendar_event_id: string | null; virtual: boolean }>();
  if (!tp || !tp.virtual || !tp.calendar_event_id || tp.status === "cancelled") return null;

  const { data: owner } = await db()
    .from("members")
    .select("google_refresh_token")
    .eq("id", tp.owner_id ?? "")
    .maybeSingle<{ google_refresh_token: string | null }>();

  const { readEventRsvps } = await import("@/lib/google/calendar");
  const rsvps = await readEventRsvps(owner?.google_refresh_token ?? null, tp.calendar_event_id);
  if (!rsvps || rsvps.size === 0) return { updated: 0 };

  const audience = await touchPointAudience(tp);
  const { data: existing } = await db()
    .from("touch_point_attendance")
    .select("member_id, source")
    .eq("touch_point_id", tp.id);
  const humanEdited = new Set(
    ((existing ?? []) as { member_id: string; source: string }[])
      .filter((r) => r.source === "manual")
      .map((r) => r.member_id)
  );

  let updated = 0;
  for (const m of audience) {
    const answer = m.email ? rsvps.get(m.email.toLowerCase()) : undefined;
    if (!answer) continue; // Maybe / no answer → undecided, never an absence
    if (humanEdited.has(m.id)) continue; // a person's judgement beats a click
    const { error } = await db().from("touch_point_attendance").upsert(
      {
        touch_point_id: tp.id,
        member_id: m.id,
        status: answer === "yes" ? "attended" : "absent",
        source: "rsvp",
        note: answer === "yes" ? "Accepted the invite" : "Declined the invite",
      },
      { onConflict: "touch_point_id,member_id" }
    );
    if (!error) updated += 1;
  }
  await db()
    .from("touch_points")
    .update({ rsvp_synced_at: new Date().toISOString() })
    .eq("id", tp.id);
  return { updated };
}

/** Every virtual touch point that has already started and hasn't been
 *  confirmed yet — what the attendance cron refreshes. */
export async function syncDueRsvps(): Promise<number> {
  const { data } = await db()
    .from("touch_points")
    .select("id")
    .eq("virtual", true)
    .eq("status", "scheduled")
    .is("attendance_recorded_at", null)
    .not("calendar_event_id", "is", null)
    .lte("starts_at", new Date().toISOString())
    .gte("starts_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  let total = 0;
  for (const r of (data ?? []) as { id: string }[]) {
    const res = await syncTouchPointRsvps(r.id).catch(() => null);
    total += res?.updated ?? 0;
  }
  return total;
}

