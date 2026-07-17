import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { importMembership } from "@/lib/google/sheets";
import { markCronRun } from "@/server/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const imported = await importMembership();
    await markCronRun("membership-import");
    return NextResponse.json({ imported });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "import failed" },
      { status: 500 }
    );
  }
}
