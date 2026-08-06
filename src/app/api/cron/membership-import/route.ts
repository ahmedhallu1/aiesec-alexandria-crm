import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { importMembership } from "@/lib/google/sheets";
import { markCronRun } from "@/server/data";

export const dynamic = "force-dynamic";

/** THE LC SLEEPS (v33.19). Nobody edits a tracker at 3am, but the imports ran
 *  all night anyway — a third of every day's hosting CPU spent re-reading
 *  sheets nobody touched. 01:00–07:00 Cairo is off; a manual `&force=1` run
 *  still works whenever it's needed. */
function cairoHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23",
    }).format(new Date())
  );
}
function sleepingHours(): boolean {
  const h = cairoHour();
  return h >= 1 && h < 7;
}


export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && sleepingHours())
    return NextResponse.json({ ok: true, skipped: "night" });
  try {
    const imported = await importMembership({ force });
    await markCronRun("membership-import");
    return NextResponse.json({ imported });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "import failed" },
      { status: 500 }
    );
  }
}
