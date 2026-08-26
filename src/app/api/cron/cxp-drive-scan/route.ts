import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { scanCxpDrive } from "@/server/cxp-drive";
import { markCronRun } from "@/server/data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** THE MANUAL-DROP SCAN (v35). Half the LC's documents are dropped straight
 *  into an EP's Drive folder rather than uploaded through the app; this walks
 *  those folders and matches filenames to requirements. Runs after the sync,
 *  which is what tells it which EPs exist. */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await scanCxpDrive();
    await markCronRun("cxp-drive-scan").catch(() => {});
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
