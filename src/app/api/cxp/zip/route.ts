import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { getViewer, logAudit } from "@/server/data";
import { collectedForWeek } from "@/server/cxp-drive";
import {
  buildReadme,
  contentDisposition,
  streamZip,
  zipEpFolder,
  type ZipEntry,
} from "@/server/cxp-download";
import { cxpFunctions } from "@/lib/cxp/rbac";
import { requirementsForStage } from "@/lib/cxp/requirements";
import { zipFileName } from "@/lib/cxp/drive";
import { fmtDateTime } from "@/lib/types";
import {
  CXP_FUNCTIONS,
  CXP_STAGE_KEYS,
  type CxpEpRecord,
  type CxpFunction,
} from "@/lib/cxp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a week's documents are fetched from Drive one by one — give it the full window
export const maxDuration = 300;

const WEEKLY_DAYS = new Set(["06", "13", "20", "27"]);

/**
 * GET /api/cxp/zip?fn=IGV&deadline=2026-09-27   — a week's submission
 * GET /api/cxp/zip?ep=<EP/OPP ID>               — one EP's whole file
 *
 * DOWNLOADING IS READING. Anyone who may read a function's submissions may
 * download them — the same rule as the old system's button, which every CXP
 * member had. Building the Drive folder of shortcuts stays a leaders' job,
 * because that one writes to Drive.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const viewer = await getViewer();
  const allowed = cxpFunctions(viewer);
  const notFound = () => new NextResponse("Not found.", { status: 404 });
  const generatedAt = fmtDateTime(new Date().toISOString());

  const ep = (url.searchParams.get("ep") ?? "").trim();
  if (ep) {
    const { data } = await db()
      .from("cxp_ep_records")
      .select("*")
      .eq("ep_opp_id", ep)
      .in("function", allowed.length ? allowed : ["__none__"]);
    const records = (data ?? []) as CxpEpRecord[];
    if (records.length === 0) return notFound();

    const { data: statuses } = await db()
      .from("cxp_requirement_status")
      .select("stage_key, requirement_key, uploaded, file_id")
      .eq("ep_opp_id", ep);
    const byKey = new Map(
      (statuses ?? []).map((s) => [`${s.stage_key}|${s.requirement_key}`, s])
    );

    const epName = records[0].ep_name || ep;
    const folder = zipEpFolder(epName, ep);
    const entries: ZipEntry[] = [];
    const included: { ep: string; stage: CxpEpRecord["stage_key"]; requirement: string }[] = [];
    const flaggedOnly: typeof included = [];
    const missing: typeof included = [];
    // one row per stage — several months can repeat a stage; read each once
    const stages = [...new Map(records.map((r) => [r.stage_key, r])).values()].sort(
      (a, b) => CXP_STAGE_KEYS.indexOf(a.stage_key) - CXP_STAGE_KEYS.indexOf(b.stage_key)
    );
    for (const r of stages) {
      for (const q of requirementsForStage(r.function, r.stage_key)) {
        const s = byKey.get(`${r.stage_key}|${q.key}`);
        const row = { ep: epName, stage: r.stage_key, requirement: q.name };
        if (s?.uploaded && s.file_id) {
          entries.push({ folder, stageKey: r.stage_key, requirementName: q.name, fileId: s.file_id });
          included.push(row);
        } else if (s ? s.uploaded : r.sheet_flags?.[q.key]) {
          flaggedOnly.push(row);
        } else {
          missing.push(row);
        }
      }
    }

    await logAudit(viewer.id, "cxp_zip", "cxp_document", null, { ep, files: entries.length });
    const body = await streamZip({
      root: folder,
      entries,
      readme: buildReadme({
        title: `${epName} (${ep}) — every collected document`,
        included,
        flaggedOnly,
        missing,
        generatedAt,
        by: viewer.name,
      }),
    });
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition("attachment", `${folder}.zip`),
        "Cache-Control": "private, no-store",
      },
    });
  }

  const fn = (url.searchParams.get("fn") ?? "") as CxpFunction;
  const deadline = url.searchParams.get("deadline") ?? "";
  if (
    !CXP_FUNCTIONS.includes(fn) ||
    !allowed.includes(fn) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
    !WEEKLY_DAYS.has(deadline.slice(8))
  ) {
    return notFound();
  }

  const week = await collectedForWeek(fn, deadline);
  const epLabel = (name: string, id: string) => name || id;
  await logAudit(viewer.id, "cxp_zip", "cxp_document", null, {
    function: fn,
    deadline,
    files: week.files.length,
  });
  const body = await streamZip({
    root: `${fn} - ECB Submission - ${deadline}`,
    entries: week.files.map((f) => ({
      folder: zipEpFolder(f.epName, f.epOppId),
      stageKey: f.stageKey,
      requirementName: f.requirementName,
      fileId: f.fileId,
    })),
    readme: buildReadme({
      title: `${fn} — ECB weekly submission, deadline ${deadline}`,
      included: week.files.map((f) => ({
        ep: epLabel(f.epName, f.epOppId),
        stage: f.stageKey,
        requirement: f.requirementName,
      })),
      flaggedOnly: week.flaggedOnly.map((f) => ({
        ep: epLabel(f.epName, f.epOppId),
        stage: f.stageKey,
        requirement: f.requirementName,
      })),
      missing: week.missing.map((f) => ({
        ep: epLabel(f.epName, f.epOppId),
        stage: f.stageKey,
        requirement: f.requirementName,
        note: f.bucket === "overdue" ? "overdue" : f.bucket === "ongoing" ? "always owed" : "due this week",
      })),
      generatedAt,
      by: viewer.name,
    }),
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition("attachment", zipFileName(fn, deadline)),
      "Cache-Control": "private, no-store",
    },
  });
}
