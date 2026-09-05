import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { exportAllSheets } from "@/lib/google/sheets";
import { markCronRun } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await exportAllSheets();
    // ⚠️ v36 — THE SIGN-UP MIRROR MOVED HERE FROM THE EDIT PATHS. Seven of
    // them each pushed their own row, three Google round trips for one
    // dropdown change, on a plan already past its CPU allowance (v33.59) — and
    // nobody reads the other end in real time, because the trackers are worked
    // in Sodio now. One batch per tab, on the hour, exactly as raising has
    // mirrored since v11.
    //
    // It does NOT fail the export: the raising mirror above is the older
    // contract and must not be lost to a sign-up tab that has been renamed.
    // The watermark only advances on success, so a bad hour re-tries rather
    // than dropping an edit.
    let signups: { pushed: number; missed: string[]; since: string | null } | null = null;
    let signupsError: string | null = null;
    try {
      const { exportDirtySignups } = await import("@/lib/google/signups");
      signups = await exportDirtySignups();
    } catch (e) {
      signupsError = e instanceof Error ? e.message : String(e);
      console.error("[sheets-export] signup mirror failed:", signupsError);
    }
    await markCronRun("sheets-export");
    return NextResponse.json({ ok: true, signups, signupsError });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "export failed" },
      { status: 500 }
    );
  }
}
