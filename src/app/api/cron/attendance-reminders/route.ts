import { NextRequest, NextResponse } from "next/server";
import { notifyMembers } from "@/server/notify";
import { cairoDayIso, markCronRun } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { attendanceDueEmail } from "@/lib/email/attendance-templates";
import { touchPointLabel } from "@/lib/types";
import { audienceLabel, cairoWhen, touchPointName } from "@/lib/touch-points";
import type { TouchPointRow } from "@/server/touch-points-read";
import {
  unrecordedTouchPoints,
  workWindowClosed,
} from "@/server/attendance-read";

export const dynamic = "force-dynamic";

/** How many days back an unrecorded touch point keeps nagging. */
const LOOKBACK_DAYS = 30;
/** After this many reminders the app starts asking on sight instead. */
const PROMPT_AFTER = 3;

interface MemberLike {
  id: string;
  name: string;
  email: string | null;
  role: string;
  team_name: string | null;
  functions: string[] | null;
  sub_functions: string[] | null;
}

const fnsOf = (m: MemberLike) => [...(m.functions ?? []), ...(m.sub_functions ?? [])];

/** WHO owes the record — the general rule:
 *  team point → its owner / the team's Team Leader ·
 *  function point → its owner + the function's VP & Directors ·
 *  LC point → the TM VP + TM's MMs. */
function responsibleFor(tp: TouchPointRow, members: MemberLike[]): MemberLike[] {
  const out = new Map<string, MemberLike>();
  const add = (m?: MemberLike | null) => {
    if (m && m.role !== "LCP") out.set(m.id, m); // the LCP never gets operational mail
  };
  const owner = tp.owner_id ? members.find((m) => m.id === tp.owner_id) : null;

  if (tp.scope === "lc") {
    for (const m of members)
      if (
        fnsOf(m).includes("TM") &&
        ["LCVP", "Director", "Team Leader", "Coordinator"].includes(m.role)
      )
        add(m);
  } else if (tp.scope === "function") {
    add(owner);
    for (const m of members)
      if (
        tp.function_key &&
        fnsOf(m).includes(tp.function_key) &&
        ["LCVP", "Director"].includes(m.role)
      )
        add(m);
  } else {
    add(owner);
    if (out.size === 0 && tp.team_name)
      for (const m of members)
        if (m.team_name === tp.team_name && m.role === "Team Leader") add(m);
    // still nobody (a team whose TL left) → the function's VP/Director inherits it
    if (out.size === 0 && tp.function_key)
      for (const m of members)
        if (fnsOf(m).includes(tp.function_key) && ["LCVP", "Director"].includes(m.role)) add(m);
  }
  return [...out.values()];
}

/** The ladder's last rung: an unmissable prompt on the responsible's next app
 *  open. Generic by design (kind + ref_id + title/body/link), so the next
 *  must-do action reuses the whole machine. */
async function ensurePrompt(
  memberId: string,
  tp: TouchPointRow,
  label: string,
  whenLabel: string
): Promise<boolean> {
  const { data: existing } = await db()
    .from("pending_prompts")
    .select("id")
    .eq("member_id", memberId)
    .eq("kind", "attendance")
    .eq("ref_id", tp.id)
    .eq("resolved", false)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (existing) return false;
  // working hours are already filled in — what's owed is the CONFIRMATION
  const auto = tp.kind === "working_hours";
  const { error } = await db().from("pending_prompts").insert({
    member_id: memberId,
    kind: "attendance",
    ref_id: tp.id,
    title: auto
      ? `You still owe a confirmation for ${label}`
      : `You still owe an attendance record for ${label}`,
    body: `${whenLabel} · ${audienceLabel(tp)}. ${PROMPT_AFTER} reminders have gone out — ${
      auto
        ? "review what Sodio filled in and confirm it"
        : "record who showed up"
    } and this stops.`,
    link: `/attendance?tp=${tp.id}`,
  });
  if (error) {
    console.error("[attendance-reminders] prompt insert failed:", error.message);
    return false;
  }
  return true;
}

/** ATTENDANCE REMINDERS (v29 · v29.3) — the general "you must act" ladder.
 *
 *  Nightly: every scheduled touch point that has started and is still
 *  unconfirmed gets one nudge per Cairo day at the responsible. WORKING HOURS
 *  are PRE-FILLED here first (the engine turns everyone's stamped work into
 *  attended/absent once the window closes) and then nag exactly like a meeting
 *  or an outing — the responsible reviews what the engine decided and confirms
 *  it, and only that confirmation stamps the point. After PROMPT_AFTER
 *  reminders a `pending_prompts` row is filed and the app asks on sight. */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const touchPoints = await unrecordedTouchPoints(LOOKBACK_DAYS);
  const { data: memberData, error: membersError } = await db()
    .from("members")
    .select("id, name, email, role, team_name, functions, sub_functions")
    .eq("is_active", true);
  if (membersError) {
    console.error("[attendance-reminders] members query failed:", membersError.message);
    return NextResponse.json({ ok: false, error: membersError.message }, { status: 500 });
  }
  const members = (memberData ?? []) as MemberLike[];

  const today = cairoDayIso();
  const computed: string[] = [];
  const nagged: string[] = [];
  const prompted: string[] = [];
  const errors: string[] = [];
  // v33.32 — each function's own defaults decide whether the pre-fill runs
  // and whether the reminder ladder chases its points at all
  const { allFunctionSettings } = await import("@/server/function-settings");
  const fnSettings = await allFunctionSettings();
  const settingOf = (key: string | null | undefined) =>
    (key && fnSettings[key]) || null;

  for (const tp of touchPoints) {
    const label = touchPointName(tp);
    const whenLabel = cairoWhen(tp.starts_at);
    const fnSetting = settingOf(tp.function_key);
    try {
      // ---- working hours: nothing is computed INTO the table any more ----
      // v33.42: the engine used to write attended/absent here, and those rows
      // counted everywhere while nobody had confirmed them. It is a helper, so
      // its verdicts now live in the SHEET (pre-selected, unsaved) and this
      // job only does what it always should have: chase the human.
      if (tp.kind === "working_hours" && !workWindowClosed(tp.starts_at)) continue;

      // ---- everything unconfirmed: one nudge per Cairo day ----
      if (fnSetting && fnSetting.attendanceReminders === false) continue;
      if (tp.attendance_reminded_on === today) continue;
      const owners = responsibleFor(tp, members);
      if (owners.length === 0) {
        errors.push(`${label} ${whenLabel}: nobody is responsible for recording it`);
        continue;
      }

      const already = tp.attendance_reminders ?? 0;
      if (already >= PROMPT_AFTER) {
        // the ladder is spent — the in-app prompt takes over from the inbox
        for (const o of owners)
          if (await ensurePrompt(o.id, tp, label, whenLabel)) prompted.push(`${o.name} → ${label}`);
        const { error: promptStampError } = await db()
          .from("touch_points")
          .update({ attendance_reminded_on: today })
          .eq("id", tp.id);
        if (promptStampError)
          errors.push(`${label} ${whenLabel}: stamp failed: ${promptStampError.message}`);
        continue;
      }

      const reminder = already + 1;
      // working hours arrive pre-filled — the ask is "review & confirm", not
      // "fill this in from scratch"
      const auto = tp.kind === "working_hours";
      await notifyMembers(
        owners.map((o) => o.id),
        "followup",
        reminder === 1
          ? auto
            ? `✨ Confirm attendance — ${label}`
            : `📝 Record attendance — ${label}`
          : `⏳ Reminder ${reminder}: attendance still ${auto ? "unconfirmed" : "missing"} — ${label}`,
        `${whenLabel} · ${audienceLabel(tp)}. ${
          auto
            ? "Sodio already filled it in from everyone's work — check it and confirm."
            : "Attended · Late · Absent — it takes a minute."
        }`,
        null,
        `/attendance?tp=${tp.id}`
      );

      const emails = owners.map((o) => o.email).filter((e): e is string => !!e);
      if (emails.length > 0) {
        const mail = attendanceDueEmail({
          label,
          whenLabel,
          audience: audienceLabel(tp),
          ownerName: tp.owner_name,
          reminder,
          touchPointId: tp.id,
        });
        // the bell has ALREADY gone out — a Gmail hiccup must never leave the
        // counter unstamped, or this same reminder re-sends every night and
        // the ladder never escalates to the in-app prompt
        try {
          await sendEmail({ to: [...new Set(emails)], ...mail });
        } catch (e) {
          errors.push(
            `${label} ${whenLabel}: reminder #${reminder} email failed: ${
              e instanceof Error ? e.message : e
            }`
          );
        }
      }

      const { error: stampError } = await db()
        .from("touch_points")
        .update({ attendance_reminders: reminder, attendance_reminded_on: today })
        .eq("id", tp.id);
      // an unstamped nag would re-fire on the next run — surface it instead
      if (stampError) throw new Error(`stamp failed: ${stampError.message}`);
      nagged.push(`${label} ${whenLabel} (#${reminder})`);

      if (reminder >= PROMPT_AFTER)
        for (const o of owners)
          if (await ensurePrompt(o.id, tp, label, whenLabel)) prompted.push(`${o.name} → ${label}`);
    } catch (e) {
      errors.push(`${label} ${whenLabel}: ${e instanceof Error ? e.message : e}`);
    }
  }

  await markCronRun("attendance-reminders");
  return NextResponse.json({ ok: true, computed, nagged, prompted, errors });
}
