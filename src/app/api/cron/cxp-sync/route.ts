import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { syncSubTool } from "@/server/cxp-sync";
import { markCronRun } from "@/server/data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** THE SUBTOOL SYNC (v35) — reads the mirrored ECB SubTool tabs into
 *  cxp_ep_records. Hourly, and it must run BEFORE the reminder job so the
 *  missing-document counts in the email are current. */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncSubTool();
    await markCronRun("cxp-sync").catch(() => {});
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
