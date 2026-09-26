import { NextResponse, type NextRequest } from "next/server";
import { getViewer, logAudit } from "@/server/data";
import { EXPORTS } from "@/server/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/export?kind=<id>&<the page's own filter params>
 *
 * Returns the export as a JSON book (named sheets of rows); the browser turns
 * it into Excel or CSV. STREAMED on purpose: a plain response over 4.5 MB is
 * refused by Vercel, and a big accounts or sign-ups export can pass that — a
 * streamed body is exempt.
 *
 * Who may export what is decided in `src/server/exports.ts`, and every export
 * reads through the page's own scoped reader, so a file never holds a row the
 * person could not already see.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const def = EXPORTS.find((e) => e.id === kind);
  const viewer = await getViewer();
  if (!def || !def.available(viewer)) {
    return NextResponse.json({ error: "That export isn't available to you." }, { status: 404 });
  }
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    if (k !== "kind") params[k] = v;
  });

  let book;
  try {
    book = await def.build(viewer, params);
  } catch (err) {
    console.error(`[export] ${kind} failed:`, err);
    return NextResponse.json({ error: "The export failed — try again." }, { status: 500 });
  }

  const rows = book.sheets.reduce((n, s) => n + s.rows.length, 0);
  await logAudit(viewer.id, "data_export", "export", null, {
    kind,
    rows,
    sheets: book.sheets.map((s) => s.name),
    filters: params,
  });

  const json = JSON.stringify(book);
  const enc = new TextEncoder();
  const CHUNK = 64 * 1024;
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= json.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(json.slice(i, i + CHUNK)));
      i += CHUNK;
    },
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
