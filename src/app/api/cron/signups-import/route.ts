import { NextRequest, NextResponse } from "next/server";
import { markCronRun } from "@/server/data";
import { env } from "@/lib/env";
import { importSignups } from "@/lib/google/signups";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** OGX sign-ups import (v25): every 15 min, pull the 4 tracker tabs (OGT
 *  New/Old SUs, OGV Old/Main) into the signups table. Rows already touched in
 *  Sodio keep their workflow fields (Sodio is authoritative after first edit);
 *  everything else tracks the sheet. */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const res = await importSignups();
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
