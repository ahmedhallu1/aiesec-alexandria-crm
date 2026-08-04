import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { markCronRun } from "@/server/data";
import { runBackup } from "@/server/backup";

export const dynamic = "force-dynamic";
// a full dump of every table takes longer than the default budget
export const maxDuration = 300;

/** NIGHTLY BACKUP (v33).
 *
 *  Supabase's free tier has no automated backups at all, so this is the only
 *  thing standing between a lost database and losing the LC's entire year.
 *  Dumps every table, gzipped, into the private `backups` bucket (30 days)
 *  and emails an off-site copy to the IM mailbox.
 *
 *  Scheduled in pg_cron at 02:00 UTC (04:00 Cairo) — quiet hours, and after
 *  the day's work has landed. */
export async function GET(req: NextRequest) {
  // same gate as every other cron: ?key=<CRON_SECRET>
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret)
    return NextResponse.json({ ok: false }, { status: 401 });

  try {
    const res = await runBackup();
    await markCronRun("backup");
    console.log(
      `[backup] ${res.rows} rows across ${res.tables} tables → ${res.fileName}` +
        (res.pruned ? ` · pruned ${res.pruned} old` : "") +
        (res.failed.length ? ` · ${res.failed.length} table(s) failed` : "")
    );
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[backup] FAILED:", message);
    // a failed backup must be loud — this is the one job whose silence is
    // indistinguishable from success until the day you need it
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
