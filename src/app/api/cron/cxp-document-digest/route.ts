import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runDailyDigest } from "@/server/cxp-digest";
import { markCronRun } from "@/server/data";
import type { CxpFunction } from "@/lib/cxp/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** THE DAILY DOCUMENT DIGEST (v35.1) — the branded replacement for the old
 *  system's per-document Google Calendar notifications. Runs daily; sends one
 *  email per function that has something due today, to the same audience the
 *  submission reminder uses. Gated by the same 1 September cutover as every
 *  other CXP email — see src/server/cxp-reminders.ts `resolveEmailMode`.
 *  Must run AFTER /api/cron/cxp-sync so the data is current. */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  try {
    const result = await runDailyDigest({
      only: (sp.get("function") as CxpFunction | null) ?? null,
      force: sp.get("force") === "1",
    });
    await markCronRun("cxp-document-digest").catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
