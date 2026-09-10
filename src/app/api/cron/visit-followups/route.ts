import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runVisitFollowups } from "@/server/cron/visit-followups";

export const dynamic = "force-dynamic";

/** The Vercel trigger for the visit reminders. The job itself lives in
 *  `@/server/cron/visit-followups` so GitHub Actions can run it for free —
 *  see `scripts/run-cron.mjs`. Keep this route working even after the
 *  schedule moves: it is the manual "run it now" handle, and the health page
 *  still reads the stamp the job writes. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    // `?passes=reminders` is the Supabase pg_cron call (v36.2): it arrives
    // only when `visit_followups_due()` says something is due, and runs the
    // reminder passes alone — the mailbox bounce scan stays on GitHub, so a
    // quiet quarter-hour costs Vercel nothing and a busy one costs little.
    const remindersOnly = req.nextUrl.searchParams.get("passes") === "reminders";
    return NextResponse.json(await runVisitFollowups({ bounces: !remindersOnly }));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "visit follow-ups failed" },
      { status: 500 }
    );
  }
}
