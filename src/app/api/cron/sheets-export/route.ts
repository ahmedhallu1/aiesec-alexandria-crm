import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { exportAllSheets } from "@/lib/google/sheets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await exportAllSheets();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "export failed" },
      { status: 500 }
    );
  }
}
