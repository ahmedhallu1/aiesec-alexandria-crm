import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { getViewer, logAudit } from "@/server/data";
import { tabAllows } from "@/server/tabs";
import { openCxpDriveFile } from "@/server/cxp-drive";
import { contentDisposition } from "@/server/cxp-download";
import { canViewCxpFunction, hasCxpAccess } from "@/lib/cxp/rbac";
import { findRequirement } from "@/lib/cxp/requirements";
import { CXP_STAGE_KEYS, type CxpFunction, type CxpStageKey } from "@/lib/cxp/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const INLINE_SAFE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * GET /api/cxp/file?ep=<EP/OPP ID>&stage=<key>&req=<key>[&dl=1]
 *
 * ONE COLLECTED DOCUMENT, streamed through Sodio. `dl=1` downloads it; without
 * it the browser shows it in the tab (a PDF or photo opens right there).
 *
 * The EP's own row decides the function, and the viewer must be able to read
 * that function — the same gate as the EP page. "Not yours" and "not there"
 * are the same 404, so an EP id can't be probed.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ep = (url.searchParams.get("ep") ?? "").trim();
  const stage = (url.searchParams.get("stage") ?? "") as CxpStageKey;
  const reqKey = (url.searchParams.get("req") ?? "").trim();
  const download = url.searchParams.get("dl") === "1";
  const notFound = () => new NextResponse("Not found.", { status: 404 });

  if (!ep || !CXP_STAGE_KEYS.includes(stage) || !reqKey) return notFound();

  const viewer = await getViewer();
  // the CXP tab's rule (Settings → Tabs) closes the downloads too (v38.3) —
  // a hidden module must not stay reachable by URL; the per-function check
  // below still decides WHICH files
  if (!(await tabAllows(viewer, "/cxp", hasCxpAccess(viewer)))) return notFound();
  const { data: record } = await db()
    .from("cxp_ep_records")
    .select("function, ep_name")
    .eq("ep_opp_id", ep)
    .eq("stage_key", stage)
    .limit(1)
    .maybeSingle<{ function: CxpFunction; ep_name: string }>();
  if (!record || !canViewCxpFunction(viewer, record.function)) return notFound();

  const { data: status } = await db()
    .from("cxp_requirement_status")
    .select("file_id, uploaded")
    .eq("ep_opp_id", ep)
    .eq("stage_key", stage)
    .eq("requirement_key", reqKey)
    .maybeSingle<{ file_id: string | null; uploaded: boolean }>();
  if (!status?.uploaded || !status.file_id) return notFound();

  try {
    const file = await openCxpDriveFile(status.file_id);
    await logAudit(viewer.id, "cxp_download", "cxp_document", null, {
      ep,
      function: record.function,
      stage,
      requirement: reqKey,
    });
    const requirement = findRequirement(record.function, stage, reqKey);
    // a readable name in the Downloads folder, not the long stored one
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
    const niceName = `${record.ep_name || ep} - ${requirement?.name ?? reqKey}${ext}`.replace(
      /[\\/:*?"<>|]/g,
      "_"
    );
    // INLINE ONLY FOR TYPES A BROWSER SHOWS INERTLY (v37.7). The stored type
    // came from the uploader and this route serves from Sodio's own origin:
    // an uploaded HTML or SVG shown inline ran as a Sodio page with the
    // viewer's session. Anything else downloads as plain bytes.
    const inlineOk = !download && INLINE_SAFE_TYPES.has((file.mimeType || "").toLowerCase());
    const headers: Record<string, string> = {
      "Content-Type": inlineOk ? file.mimeType : "application/octet-stream",
      "Content-Disposition": contentDisposition(inlineOk ? "inline" : "attachment", niceName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (file.size) headers["Content-Length"] = String(file.size);
    return new NextResponse(Readable.toWeb(file.stream) as unknown as ReadableStream, { headers });
  } catch (err) {
    const why = err instanceof Error ? err.message : "Drive refused the file.";
    return new NextResponse(`Could not read that document from Drive: ${why}`, { status: 502 });
  }
}
