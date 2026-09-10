import { NextRequest, NextResponse } from "next/server";
import { cairoDayIso, markCronRun } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { touchPointFeedbackNudgeEmail } from "@/lib/email/templates";
import { cairoWhen, touchPointName } from "@/lib/touch-points";
import {
  tmLeadEmails, touchPointAudience, type TouchPointRow,
} from "@/server/touch-points-read";
import { notifyMembers } from "@/server/notify";

export const dynamic = "force-dynamic";

/** ASK FOR THE RATING, AT THE END OF THE DAY (v33.35, migration 0057).
 *
 *  v33.33 made session feedback a 1–5 star tap — four seconds of work that
 *  almost nobody did, because nobody was ever asked. This asks: every touch
 *  point that HAPPENED today gets one email in the evening to everyone who
 *  was in its audience, with TM and the booker on CC.
 *
 *  ONE email per touch point, audience on BCC (the v33.33 rule: a message
 *  that is identical for twenty people is one send, not twenty), and ONE
 *  time per touch point — `feedback_asked_at` is the stamp, because an inbox
 *  that asks twice for a four-second job is an inbox people filter.
 *
 *  Cancelled points are skipped: there was no session to rate. */

/** THE IN-APP RATING PROMPT FOR **LC** TOUCH POINTS (v34.7).
 *
 *  The evening email above asks everybody; this asks the LC-wide sessions
 *  again, in the app, SEVEN HOURS after the session itself — long enough that
 *  it is over and they have an opinion, close enough that they still remember
 *  it. LC scope only: a team meeting is its own crew's business, and blocking
 *  seventy people over one is how a prompt becomes something people click past.
 *
 *  It rides `pending_prompts`, so somebody who never opens Sodio that evening
 *  still meets it next time rather than the window passing in silence. The
 *  skip ladder is that table's `reminders` — see server/prompts.ts.
 *
 *  Runs inside this cron on purpose: Vercel is at its invocation ceiling and
 *  this needs no schedule of its own. The 7h mark is therefore a FLOOR, not an
 *  alarm — the prompt appears at the next run after it passes. */
async function fileLcRatingPrompts(): Promise<string[]> {
  const filed: string[] = [];
  const sevenHoursAgo = new Date(Date.now() - 7 * 3600_000).toISOString();
  // a generous floor so a failed run still catches yesterday's sessions
  const since = new Date(Date.now() - 4 * 24 * 3600_000).toISOString();
  const { data, error } = await db()
    .from("touch_points")
    .select("*")
    .eq("status", "scheduled")
    .eq("scope", "lc")
    .lte("starts_at", sevenHoursAgo)
    .gte("starts_at", since)
    .order("starts_at");
  if (error) {
    console.error("[tp-rating-prompt] query failed:", error.message);
    return filed;
  }

  for (const tp of (data ?? []) as TouchPointRow[]) {
    const audience = await touchPointAudience(tp);
    if (audience.length === 0) continue;

    // never ask twice: not somebody who already rated it, and not somebody
    // who already has (or had) a prompt for it — including one they skipped
    // for good, which is the whole point of the ladder
    const [{ data: rated }, { data: existing }] = await Promise.all([
      db().from("lc_feedback").select("author_id").eq("touch_point_id", tp.id),
      db().from("pending_prompts").select("member_id").eq("kind", "touchpoint_rating").eq("ref_id", tp.id),
    ]);
    const done = new Set<string>([
      ...((rated ?? []).map((r) => r.author_id as string).filter(Boolean)),
      ...((existing ?? []).map((r) => r.member_id as string)),
    ]);
    const targets = audience.filter((m) => !done.has(m.id));
    if (targets.length === 0) continue;

    const name = touchPointName(tp);
    const { error: insErr } = await db().from("pending_prompts").insert(
      targets.map((m) => ({
        member_id: m.id,
        kind: "touchpoint_rating",
        ref_id: tp.id,
        title: `How was ${name}?`,
        body: cairoWhen(tp.starts_at),
        link: null,
      }))
    );
    if (insErr) console.error("[tp-rating-prompt] insert failed:", insErr.message);
    else filed.push(`${name} → ${targets.length}`);
  }
  return filed;
}

export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = cairoDayIso();
  const nowIso = new Date().toISOString();
  // everything that started in the last 24h and hasn't been asked about. The
  // window is generous on purpose: a run that fails at 22:00 must still catch
  // yesterday's sessions tomorrow rather than losing them for good.
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const { data, error } = await db()
    .from("touch_points")
    .select("*")
    .eq("status", "scheduled")
    .is("feedback_asked_at", null)
    .lte("starts_at", nowIso)
    .gte("starts_at", since)
    .order("starts_at");
  if (error) {
    console.error("[tp-feedback] query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const points = (data ?? []) as TouchPointRow[];
  if (points.length === 0) {
    const prompts = await fileLcRatingPrompts();
    await markCronRun("touch-point-feedback");
    return NextResponse.json({ ok: true, asked: [], skipped: [], prompts });
  }

  const tmCc = await tmLeadEmails();
  const asked: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const tp of points) {
    const label = touchPointName(tp);
    const whenLabel = cairoWhen(tp.starts_at);
    try {
      const audience = await touchPointAudience(tp);
      // THE ASK GOES DOWN, NOT UP (v33.42, by the LCP's request). Rating a
      // session is the floor's job: members and MMs are asked, VPs/Directors
      // and the LCP are not chased for it — they can still open Feedback and
      // rate any touch point they were part of, and nothing stops them.
      const asked_ = audience.filter(
        (m) => !["LCVP", "Director", "LCP"].includes(m.role)
      );
      const to = asked_.map((m) => m.email).filter((e): e is string => !!e);
      // the booker hears about it too — it is their session being rated
      const owner = tp.owner_id
        ? (
            await db()
              .from("members")
              .select("email")
              .eq("id", tp.owner_id)
              .maybeSingle<{ email: string | null }>()
          ).data?.email ?? null
        : null;
      if (to.length === 0) {
        skipped.push(`${label} ${whenLabel}: nobody with an inbox`);
      } else {
        const mail = touchPointFeedbackNudgeEmail({
          label,
          whenLabel,
          ownerName: tp.owner_name,
          feedbackUrl: `${env.appUrl}/lc-feedback`,
        });
        // TM rides the CC for the LC's OWN sessions only (v33.42) — a team
        // meeting's rating is not TM's inbox to carry
        const cc = [
          ...new Set([...(tp.scope === "lc" ? tmCc : []), ...(owner ? [owner] : [])]),
        ];
        await sendEmail({
          topic: "touch_points",
          to: to.length === 1 ? [to[0]] : [],
          bcc: to.length === 1 ? undefined : to,
          cc: cc.length > 0 ? cc : undefined,
          subject: mail.subject,
          html: mail.html,
        });
        // a bell for the people who live in the app rather than the inbox
        await notifyMembers(
          asked_.map((m) => m.id),
          "info",
          `⭐ How was ${label}?`,
          "One tap, five stars — open Feedback, pick 'A touch point'. Four seconds, promise.",
          null,
          "/lc-feedback",
          "touch_points"
        );
        asked.push(`${label} ${whenLabel} → ${to.length}`);
      }
      // stamp EITHER WAY: a point with nobody to email is a point that never
      // needs asking again, and leaving it unstamped means retrying it hourly
      const { error: stampError } = await db()
        .from("touch_points")
        .update({ feedback_asked_at: new Date().toISOString() })
        .eq("id", tp.id);
      if (stampError) throw new Error(`stamp failed: ${stampError.message}`);
    } catch (e) {
      // NOT stamped — an unsent ask should be retried tomorrow, not lost
      errors.push(`${label} ${whenLabel}: ${e instanceof Error ? e.message : String(e)}`);
      console.error("[tp-feedback] failed:", e);
    }
  }

  const prompts = await fileLcRatingPrompts();
  await markCronRun("touch-point-feedback");
  console.log(
    `[tp-feedback] ${today}: asked ${asked.length}, skipped ${skipped.length}, ` +
      `rating prompts filed for ${prompts.length} LC session(s)`
  );
  return NextResponse.json({ ok: true, asked, skipped, errors, prompts });
}
