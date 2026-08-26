import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runWeeklyReminders } from "@/server/cxp-reminders";
import { markCronRun } from "@/server/data";
import type { CxpFunction } from "@/lib/cxp/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** THE ECB SUBMISSION REMINDER (v35).
 *
 *  Runs daily and sends NOTHING unless tomorrow is a deadline (6/13/20/27) —
 *  the same gate the standalone system used, so the cadence people are used to
 *  is unchanged. Must run AFTER /api/cron/cxp-sync.
 *
 *  `?dry=1` resolves recipients and composes the mail without sending, whatever
 *  the mode. `?force=1` bypasses the deadline gate and the already-sent guard —
 *  for a deliberate manual send, never for the schedule. */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  try {
    const result = await runWeeklyReminders({
      force: sp.get("force") === "1",
      dryRun: sp.get("dry") === "1",
      deadline: sp.get("deadline"),
      only: (sp.get("function") as CxpFunction | null) ?? null,
    });
    await markCronRun("cxp-reminders").catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
