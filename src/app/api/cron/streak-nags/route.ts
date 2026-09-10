import { NextRequest, NextResponse } from "next/server";
import { notifyMembers } from "@/server/notify";
import { cairoDayIso, markCronRun, streakEndingAt } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { streakNagEmail } from "@/lib/email/templates";
import { resolveMemberSettings, wants } from "@/lib/member-settings";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

interface MmRow {
  id: string;
  name: string;
  email: string | null;
  role: string;
  functions: string[] | null;
  sub_functions: string[] | null;
  /** date → "YYYY-MM-DD" via PostgREST */
  streak_reminded_on: string | null;
  /** their own preferences blob (0067) — the nag EMAIL is opt-out */
  settings: unknown;
}

/** OGV contact streaks (v27) — the end-of-day guardian, daily 17:00 UTC
 *  (19:00 Cairo): every active OGV MM whose streak (the run ending YESTERDAY,
 *  still alive until midnight) is ≥3 and who has NO activity stamp today gets
 *  the funny "save your streak!" email + bell — once per day
 *  (members.streak_reminded_on). One contact action saves it. */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = cairoDayIso();
  const yesterday = cairoDayIso(new Date(Date.now() - DAY_MS));

  // the streak game's audience: active OGV Team Leaders / Coordinators / Members
  const membersRes = await db()
    .from("members")
    .select("id, name, email, role, functions, sub_functions, streak_reminded_on, settings")
    .eq("is_active", true)
    .in("role", ["Team Leader", "Coordinator", "Member"]);
  if (membersRes.error) {
    console.error("[streak-nags] members query failed:", membersRes.error.message);
    return NextResponse.json({ ok: false, error: membersRes.error.message }, { status: 500 });
  }
  // v32.4: the streak covers ALL of OGX, not OGV alone.
  // v33.32: and only where that function's leader keeps the nag on — a
  // person in BOTH sides still gets it if EITHER side wants it sent.
  const { allFunctionSettings } = await import("@/server/function-settings");
  const fnSettings = await allFunctionSettings();
  const isOgxMm = (m: MmRow) =>
    [...(m.functions ?? []), ...(m.sub_functions ?? [])].some(
      (f) => (f === "OGT" || f === "OGV") && fnSettings[f]?.streakNags !== false
    );
  const mms = ((membersRes.data ?? []) as MmRow[]).filter(isOgxMm);
  if (mms.length === 0) {
    await markCronRun("streak-nags");
    return NextResponse.json({ ok: true, sent: [], errors: [] });
  }

  // their last ~60 activity days (a nag only needs the run ending yesterday)
  // — paged past Supabase's 1000-row response cap
  const cutoff = cairoDayIso(new Date(Date.now() - 400 * DAY_MS));
  const days = new Map<string, Set<string>>();
  {
    // DERIVED from the live sign-ups, exactly like the card (v32.4) — reading
    // the old activity stamps here would nag on streaks the card no longer
    // shows, because an undone contact still left a stamp behind
    const PAGE = 1000;
    for (let off = 0; off < 40000; off += PAGE) {
      const { data, error } = await db()
        .from("signups")
        .select("assigned_to, contacted_at")
        .in("assigned_to", mms.map((m) => m.id))
        // "yes"/"YES" count too — the same y% rule as the card (v33.37)
        .ilike("contact_status", "y%")
        .not("contacted_at", "is", null)
        .gte("contacted_at", `${cutoff}T00:00:00`)
        .order("id")
        .range(off, off + PAGE - 1);
      if (error) {
        console.error("[streak-nags] activity query failed:", error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      for (const r of (data ?? []) as { assigned_to: string; contacted_at: string }[]) {
        const set = days.get(r.assigned_to) ?? new Set<string>();
        set.add(cairoDayIso(new Date(r.contacted_at)));
        days.set(r.assigned_to, set);
      }
      if ((data ?? []).length < PAGE) break;
    }
  }

  const sent: string[] = [];
  const errors: string[] = [];

  for (const m of mms) {
    const mine = days.get(m.id);
    if (!mine || mine.has(today)) continue; // already saved today — no nag
    if (m.streak_reminded_on === today) continue; // already nagged today
    const streak = streakEndingAt(mine, yesterday); // alive until midnight
    if (streak < 3) continue;

    const name = m.name;
    try {
      await notifyMembers(
        [m.id],
        "info",
        `🔥 Your ${streak}-day streak ends at midnight!`,
        "One real contact saves it — reach a sign-up and mark it Contacted before midnight.",
        null,
        "/signups",
        "streak"
      );
      // both halves are the member's own choice since v36.2 — the bell above
      // carries the "streak" topic, and so does the email
      if (m.email && wants(resolveMemberSettings(m.settings), "streak", "email")) {
        const mail = streakNagEmail({
          firstName: name.split(" ")[0] || name,
          streak,
        });
        await sendEmail({ topic: "streak", to: [m.email], ...mail });
      }
      const { error: stampError } = await db()
        .from("members")
        .update({ streak_reminded_on: today })
        .eq("id", m.id);
      // an unstamped nag would re-send on a same-day retry — surface it instead
      if (stampError) throw new Error(`stamp failed: ${stampError.message}`);
      sent.push(`${name} (${streak})`);
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  await markCronRun("streak-nags");
  return NextResponse.json({ ok: true, sent, errors });
}
