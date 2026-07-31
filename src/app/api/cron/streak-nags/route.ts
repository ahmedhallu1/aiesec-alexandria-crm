import { NextRequest, NextResponse } from "next/server";
import { notifyMembers } from "@/server/notify";
import { cairoDayIso, isOgvMm, markCronRun, streakEndingAt } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { streakNagEmail } from "@/lib/email/templates";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

interface MmRow {
  id: string;
  name: string;
  nickname: string | null;
  email: string | null;
  role: string;
  functions: string[] | null;
  sub_functions: string[] | null;
  /** date → "YYYY-MM-DD" via PostgREST */
  streak_reminded_on: string | null;
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
    .select("id, name, nickname, email, role, functions, sub_functions, streak_reminded_on")
    .eq("is_active", true)
    .in("role", ["Team Leader", "Coordinator", "Member"]);
  if (membersRes.error) {
    console.error("[streak-nags] members query failed:", membersRes.error.message);
    return NextResponse.json({ ok: false, error: membersRes.error.message }, { status: 500 });
  }
  const mms = ((membersRes.data ?? []) as MmRow[]).filter(isOgvMm);
  if (mms.length === 0) {
    await markCronRun("streak-nags");
    return NextResponse.json({ ok: true, sent: [], errors: [] });
  }

  // their last ~60 activity days (a nag only needs the run ending yesterday)
  // — paged past Supabase's 1000-row response cap
  const cutoff = cairoDayIso(new Date(Date.now() - 400 * DAY_MS));
  const days = new Map<string, Set<string>>();
  {
    const PAGE = 1000;
    for (let off = 0; off < 20000; off += PAGE) {
      const { data, error } = await db()
        .from("signup_activity")
        .select("member_id, day")
        .in("member_id", mms.map((m) => m.id))
        .gte("day", cutoff)
        .order("member_id")
        .order("day")
        .range(off, off + PAGE - 1);
      if (error) {
        console.error("[streak-nags] activity query failed:", error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      for (const r of (data ?? []) as { member_id: string; day: string }[]) {
        const set = days.get(r.member_id) ?? new Set<string>();
        set.add(String(r.day).slice(0, 10));
        days.set(r.member_id, set);
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

    const name = m.nickname || m.name;
    try {
      await notifyMembers(
        [m.id],
        "info",
        `🔥 Your ${streak}-day streak ends at midnight!`,
        "One sign-up contact saves it — claim one, update Contacted/Interested, or drop a comment.",
        null,
        "/signups"
      );
      if (m.email) {
        const mail = streakNagEmail({
          firstName: name.split(" ")[0] || name,
          streak,
        });
        await sendEmail({ to: [m.email], ...mail });
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
