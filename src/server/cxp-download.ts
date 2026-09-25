import "server-only";
import { Readable } from "node:stream";
import { openCxpDriveFile } from "./cxp-drive";
import { epFolderName, fileExtension, safeName } from "@/lib/cxp/drive";
import { STAGE_BY_KEY, type CxpStageKey } from "@/lib/cxp/types";

/**
 * CXP DOWNLOADS — bytes out of Drive, through Sodio, to the person asking.
 *
 * THE OLD SYSTEM HAD A "DOWNLOAD ZIP" BUTTON; THE MIGRATION LOST IT. What
 * shipped instead built the ZIP, uploaded it back into Drive, and tried to
 * `window.open` the Drive link after an `await` — which popup blockers eat —
 * for leaders only. The ZIP itself was built from the EPs that still OWED
 * something, so it came out empty. And a document's "View" link pointed at a
 * Drive file most CXP members have no permission to open.
 *
 * Here the response IS the file. A streamed response is exempt from Vercel's
 * 4.5 MB body cap, so a ZIP of a whole week goes straight to the browser as a
 * plain download link: no popup, no Drive sharing, no copy left behind.
 *
 * Authorization is the ROUTE's job — nothing in this file knows who is asking.
 */

/** `Content-Disposition` that survives Arabic names and quotes. */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export interface ZipEntry {
  /** the folder inside the ZIP, e.g. "5583697_1331335 - Hager Ashraf" */
  folder: string;
  stageKey: CxpStageKey;
  requirementName: string;
  fileId: string;
}

/** "Approval - Passport / ID.pdf" — the stage and the requirement, with the
 *  real file's extension so the OS opens it with the right app. */
export function entryName(stageKey: CxpStageKey, requirementName: string, driveName: string): string {
  const ext = fileExtension(driveName);
  const base = safeName(`${STAGE_BY_KEY[stageKey]} - ${requirementName}`);
  return ext ? `${base}.${ext}` : base;
}

/** Make every path in the archive unique — two uploads for one requirement,
 *  or two EPs with the same folder name, must not overwrite each other. */
function uniquePath(used: Set<string>, path: string): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const [stem, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

/**
 * Stream a ZIP of Drive files, one at a time.
 *
 * STORED, NOT COMPRESSED: audit documents are photos and PDFs, which are
 * already compressed — deflating them again costs CPU (billed) for a file a
 * percent or two smaller.
 *
 * A file that cannot be read becomes a `_SKIPPED` note inside the ZIP instead
 * of failing the whole download — one dead Drive file must not cost the LC the
 * other forty on the morning of a deadline.
 */
export async function streamZip(opts: {
  root: string;
  entries: ZipEntry[];
  readme: string;
}): Promise<ReadableStream<Uint8Array>> {
  const { ZipArchive } = await import("archiver");
  const archive = new ZipArchive({ store: true });
  const used = new Set<string>();
  const root = safeName(opts.root);

  const add = (data: Buffer | string, name: string) =>
    new Promise<void>((resolve, reject) => {
      const onEntry = () => {
        archive.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        archive.off("entry", onEntry);
        reject(err);
      };
      archive.once("entry", onEntry);
      archive.once("error", onError);
      archive.append(data, { name });
    });

  void (async () => {
    try {
      await add(opts.readme, `${root}/_README.txt`);
      for (const e of opts.entries) {
        const folder = `${root}/${safeName(e.folder)}`;
        try {
          const file = await openCxpDriveFile(e.fileId);
          const data = await readAll(file.stream);
          await add(data, uniquePath(used, `${folder}/${entryName(e.stageKey, e.requirementName, file.name)}`));
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          await add(
            `Could not read "${e.requirementName}" from Drive (${why}).\nOpen the EP in Sodio and re-attach it.\n`,
            uniquePath(used, `${folder}/_SKIPPED - ${safeName(e.requirementName)}.txt`)
          );
        }
      }
      await archive.finalize();
    } catch (err) {
      archive.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
}

/** The folder name for one EP inside a ZIP — the LC's own Drive convention. */
export function zipEpFolder(epName: string, epOppId: string): string {
  return epFolderName(epName || epOppId, epOppId);
}

/** A plain-text cover sheet for a ZIP: what is inside, and — just as useful
 *  on a deadline morning — what is NOT. */
export function buildReadme(opts: {
  title: string;
  included: { ep: string; stage: CxpStageKey; requirement: string }[];
  flaggedOnly: { ep: string; stage: CxpStageKey; requirement: string }[];
  missing: { ep: string; stage: CxpStageKey; requirement: string; note?: string }[];
  generatedAt: string;
  by: string;
}): string {
  const line = (r: { ep: string; stage: CxpStageKey; requirement: string; note?: string }) =>
    `  - ${r.ep} · ${STAGE_BY_KEY[r.stage]} · ${r.requirement}${r.note ? ` (${r.note})` : ""}`;
  const block = (heading: string, rows: { ep: string; stage: CxpStageKey; requirement: string; note?: string }[]) =>
    rows.length ? [`${heading} (${rows.length})`, ...rows.map(line), ""] : [];
  return [
    opts.title,
    `Generated by Sodio on ${opts.generatedAt} for ${opts.by}.`,
    "",
    ...block("IN THIS ZIP", opts.included),
    ...block(
      "TICKED AS COLLECTED ON THE ECB SHEET, BUT NO FILE IN SODIO",
      opts.flaggedOnly
    ),
    ...block("STILL MISSING", opts.missing),
    opts.included.length === 0 ? "No documents with a file are collected yet.\n" : "",
  ].join("\n");
}
