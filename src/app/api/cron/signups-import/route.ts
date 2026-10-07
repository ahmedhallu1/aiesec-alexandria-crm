import { NextRequest, NextResponse } from "next/server";
import { markCronRun } from "@/server/data";
import { env } from "@/lib/env";
import { importSignups } from "@/lib/google/signups";

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

export const maxDuration = 300;

/** OGX sign-ups import (v25): every 15 min, pull the tracker tabs in SIGNUP_TABS (OGT
 *  New/Old SUs, OGV 26.2 Main/26.1 Main/26.1 Old) into the signups table. Rows already touched in
 *  Sodio keep their workflow fields (Sodio is authoritative after first edit);
 *  everything else tracks the sheet. */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && sleepingHours())
    return NextResponse.json({ ok: true, skipped: "night" });
  try {
    const res = await importSignups({ force });
    await markCronRun("signups-import");
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    console.error("[signups-import]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
