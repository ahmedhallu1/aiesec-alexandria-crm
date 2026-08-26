import "server-only";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { db } from "@/lib/supabase";
import { env, requireEnv } from "@/lib/env";
import { driveAsMailbox } from "@/lib/google/drive-upload";
import {
  buildStoredFileName,
  epFolderName,
  MATCH_REVIEW_THRESHOLD,
  matchRequirement,
  parseEpFolderName,
  stageFolderName,
  stageKeyFromFolderName,
  weeklyFolderPath,
  zipFileName,
  zipFolderPath,
} from "@/lib/cxp/drive";
import { findRequirement, requirementsForStage } from "@/lib/cxp/requirements";
import { selectWeeklyEps } from "@/lib/cxp/weekly";
import type { CxpEpRecord, CxpFunction, CxpStageKey } from "@/lib/cxp/types";

/**
 * THE CXP DRIVE LAYER.
 *
 * TWO IDENTITIES, AND THE DIFFERENCE MATTERS. Folders take no storage quota, so
 * the SERVICE ACCOUNT can create them. Files do, and a service account has no
 * quota of its own — so bytes must be written by the MAILBOX (the OAuth
 * identity). Sodio already solved this in drive-upload.ts; the same rule is
 * followed here.
 */

function serviceDrive(): drive_v3.Drive {
  const missing = requireEnv("serviceAccountKeyBase64", "driveFolderId");
  if (missing) throw new Error(missing);
  const key = JSON.parse(
    Buffer.from(env.serviceAccountKeyBase64, "base64").toString("utf-8")
  );
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

/** THE CXP DRIVE ROOT.
 *
 *  `CXP_DRIVE_FOLDER_ID` POINTS AT THE EXISTING TREE. The standalone auditing
 *  system kept its own Drive root (GOOGLE_DRIVE_ROOT_FOLDER_ID) holding every
 *  EP folder and every document the LC has collected. Creating a fresh root
 *  here would orphan all of it — the drive index would scan an empty folder and
 *  conclude nothing had ever been submitted.
 *
 *  So: set CXP_DRIVE_FOLDER_ID to the OLD system's root and the module picks up
 *  the existing "EP Files", "ECB Weekly Submissions" and "Generated ZIPs"
 *  folders exactly where they are. Unset, it falls back to a subfolder of the
 *  CRM Drive folder — the right behaviour for a fresh install, and the wrong
 *  one for this migration. */
async function cxpRoot(): Promise<string> {
  const explicit = process.env.CXP_DRIVE_FOLDER_ID ?? "";
  if (explicit) return explicit;
  return ensureFolder("CXP — ECB Submissions", env.driveFolderId);
}

const escapeQ = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Find or create one folder by name inside a parent. Cached in app_settings
 *  because this is called once per EP per sync and Drive list calls are slow. */
async function ensureFolder(name: string, parentId: string): Promise<string> {
  const cacheKey = `cxp:drive:${parentId}:${name}`;
  const { data: cached } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", cacheKey)
    .maybeSingle();
  if (cached?.value && typeof cached.value === "object" && "id" in cached.value) {
    return (cached.value as { id: string }).id;
  }

  const drive = serviceDrive();
  const list = await drive.files.list({
    q:
      `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' ` +
      `and name = '${escapeQ(name)}' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  let id = list.data.files?.[0]?.id ?? null;
  if (!id) {
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    id = created.data.id!;
  }

  await db()
    .from("app_settings")
    .upsert({ key: cacheKey, value: { id }, updated_at: new Date().toISOString() });
  return id;
}

/** Walk (creating as needed) a folder path under the CXP root. */
async function ensurePath(path: string[]): Promise<string> {
  let parent = await cxpRoot();
  for (const segment of path) parent = await ensureFolder(segment, parent);
  return parent;
}

/** [Function] / [EP/OPP ID] - [EP Name] / [Stage] — the LC's own layout. */
export async function ensureEpStageFolder(
  fn: CxpFunction,
  epName: string,
  epOppId: string,
  stageKey: CxpStageKey
): Promise<string> {
  return ensurePath([fn, epFolderName(epName, epOppId), stageFolderName(stageKey)]);
}

// ------------------------------------------------------------------ upload

export interface CxpUploadResult {
  fileId: string;
  fileUrl: string;
  storedName: string;
}

/** Put one collected document into its EP's stage folder and record it.
 *
 *  Authorization is the CALLER's job (`assertCanEditCxp`) — this function has
 *  no viewer and must never be exposed directly to a route. */
export async function uploadCxpDocument(opts: {
  epName: string;
  epOppId: string;
  fn: CxpFunction;
  stageKey: CxpStageKey;
  requirementKey: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  uploadedBy?: string | null;
}): Promise<CxpUploadResult> {
  const req = findRequirement(opts.fn, opts.stageKey, opts.requirementKey);
  if (!req) {
    throw new Error(
      `Unknown requirement ${opts.requirementKey} for ${opts.fn}/${opts.stageKey}.`
    );
  }

  const folderId = await ensureEpStageFolder(
    opts.fn,
    opts.epName,
    opts.epOppId,
    opts.stageKey
  );
  const storedName = buildStoredFileName(
    opts.epOppId,
    opts.stageKey,
    req.name,
    opts.fileName
  );

  // BYTES NEED THE MAILBOX: a service account has no storage quota of its own
  const drive = driveAsMailbox() ?? serviceDrive();
  const res = await drive.files.create({
    requestBody: { name: storedName, parents: [folderId] },
    media: {
      mimeType: opts.mimeType || "application/octet-stream",
      body: Readable.from(opts.data),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  const fileId = res.data.id;
  if (!fileId) throw new Error("Drive returned no file id.");
  const fileUrl = res.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;

  await db()
    .from("cxp_requirement_status")
    .upsert(
      {
        ep_opp_id: opts.epOppId,
        function: opts.fn,
        stage_key: opts.stageKey,
        requirement_key: opts.requirementKey,
        uploaded: true,
        source: "Website Upload",
        file_url: fileUrl,
        file_id: fileId,
        uploaded_by: opts.uploadedBy ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ep_opp_id,stage_key,requirement_key" }
    );

  return { fileId, fileUrl, storedName };
}

// ------------------------------------------------------------- drive index

export interface DriveIndexResult {
  scanned: number;
  matched: number;
  needsReview: number;
  epFoldersSeen: number;
}

/**
 * THE MANUAL-DROP SCAN.
 *
 * Half the LC's documents never touch the website — somebody drops a passport
 * photo straight into the EP's Drive folder. This walks EP Files, matches each
 * filename to a requirement, and records the confident ones as collected.
 *
 * A WEAK MATCH IS NOT A COLLECTED DOCUMENT. Anything at or under the review
 * threshold is counted and reported but never written as satisfied: marking a
 * requirement complete on a guess is exactly how an LC arrives at an audit
 * short of a document it believed it had.
 *
 * Website uploads are never overwritten — they are stronger evidence.
 */
export async function scanCxpDrive(): Promise<DriveIndexResult> {
  const drive = serviceDrive();

  const { data: records } = await db()
    .from("cxp_ep_records")
    .select("ep_opp_id, ep_name, function, stage_key");
  const byEp = new Map<string, { fn: CxpFunction; stages: Set<CxpStageKey> }>();
  for (const r of (records ?? []) as CxpEpRecord[]) {
    const e = byEp.get(r.ep_opp_id) ?? { fn: r.function, stages: new Set<CxpStageKey>() };
    e.stages.add(r.stage_key);
    byEp.set(r.ep_opp_id, e);
  }

  const { data: existing } = await db()
    .from("cxp_requirement_status")
    .select("ep_opp_id, stage_key, requirement_key, source");
  const isWebUpload = new Set(
    (existing ?? [])
      .filter((e) => e.source === "Website Upload")
      .map((e) => `${e.ep_opp_id}|${e.stage_key}|${e.requirement_key}`)
  );

  const listChildren = async (parentId: string) => {
    const out: { id: string; name: string; mimeType: string }[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, mimeType)",
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      out.push(
        ...(res.data.files ?? []).map((f) => ({
          id: f.id!,
          name: f.name ?? "",
          mimeType: f.mimeType ?? "",
        }))
      );
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  };

  const FOLDER = "application/vnd.google-apps.folder";
  const rows: {
    ep_opp_id: string;
    function: CxpFunction;
    stage_key: CxpStageKey;
    requirement_key: string;
    uploaded: boolean;
    source: "Manual Drive Upload";
    file_url: string;
    file_id: string;
    updated_at: string;
  }[] = [];

  let scanned = 0;
  let needsReview = 0;
  let epFoldersSeen = 0;
  const now = new Date().toISOString();

  /** Try one file against ONE stage, and keep it if the match is confident. */
  const consider = (
    file: { id: string; name: string },
    epOppId: string,
    fn: CxpFunction,
    stageKey: CxpStageKey
  ): boolean => {
    const m = matchRequirement(file.name, fn, stageKey);
    if (!m.requirementKey || m.confidence <= MATCH_REVIEW_THRESHOLD) return false;
    const key = `${epOppId}|${stageKey}|${m.requirementKey}`;
    if (isWebUpload.has(key)) return true; // a real upload outranks a guess
    rows.push({
      ep_opp_id: epOppId,
      function: fn,
      stage_key: stageKey,
      requirement_key: m.requirementKey,
      uploaded: true,
      source: "Manual Drive Upload",
      file_url: `https://drive.google.com/file/d/${file.id}/view`,
      file_id: file.id,
      updated_at: now,
    });
    return true;
  };

  // ONE PASS PER FUNCTION FOLDER — that is where the EP folders live
  for (const fn of ["IGV", "IGT", "OGV", "OGT"] as CxpFunction[]) {
    const fnFolder = await ensurePath([fn]);

    for (const epFolder of await listChildren(fnFolder)) {
      if (epFolder.mimeType !== FOLDER) continue;
      const epOppId = parseEpFolderName(epFolder.name);
      if (!epOppId) continue;
      const known = byEp.get(epOppId);
      if (!known) continue; // a folder for an EP no longer in the SubTool
      epFoldersSeen++;

      const children = await listChildren(epFolder.id);

      // (a) LOOSE FILES. In the real tree most documents sit straight in the
      //     EP folder with no stage folder at all, so the stage is unknown —
      //     try each stage this EP actually has and take the first confident
      //     hit. Without this the scanner would miss the majority of them.
      for (const file of children) {
        if (file.mimeType === FOLDER) continue;
        scanned++;
        let hit = false;
        for (const stageKey of known.stages) {
          if (consider(file, epOppId, known.fn, stageKey)) {
            hit = true;
            break;
          }
        }
        if (!hit) needsReview++;
      }

      // (b) STAGE SUBFOLDERS, where the stage is explicit and the match can be
      //     tighter. Any other subfolder ("Communications", "Health insurance")
      //     is walked as if its files were loose.
      for (const sub of children) {
        if (sub.mimeType !== FOLDER) continue;
        const named = stageKeyFromFolderName(sub.name);
        for (const file of await listChildren(sub.id)) {
          if (file.mimeType === FOLDER) continue;
          scanned++;
          const stages = named ? [named] : [...known.stages];
          let hit = false;
          for (const stageKey of stages) {
            // a topical folder name ("Health insurance") is often a better
            // clue than the file inside it ("IMG-20260607.jpg")
            const probe = named ? file.name : `${sub.name} ${file.name}`;
            if (consider({ id: file.id, name: probe }, epOppId, known.fn, stageKey)) {
              hit = true;
              break;
            }
          }
          if (!hit) needsReview++;
        }
      }
    }
  }

  for (let i = 0; i < rows.length; i += 250) {
    await db()
      .from("cxp_requirement_status")
      .upsert(rows.slice(i, i + 250), {
        onConflict: "ep_opp_id,stage_key,requirement_key",
      });
  }

  return { scanned, matched: rows.length, needsReview, epFoldersSeen };
}

// ----------------------------------------------------- weekly folder + ZIP

export interface WeeklyFolderResult {
  folderId: string;
  folderUrl: string;
  epCount: number;
  fileCount: number;
}

/**
 * Build the week's submission folder: one sub-folder per EP, holding SHORTCUTS
 * to the documents already collected.
 *
 * Shortcuts, not copies, on purpose — the file stays in the EP's own folder, so
 * there is one copy of a passport in Drive rather than one per week.
 *
 * THE DEADLINE IS A REAL INPUT HERE. In the old system it was only ever the
 * folder's NAME: every week's folder held an identical file set because the
 * selection ignored it. `selectWeeklyEps` now filters on it, so week A and
 * week B genuinely differ.
 */
export async function buildWeeklyFolder(
  fn: CxpFunction,
  deadline: string
): Promise<WeeklyFolderResult> {
  const drive = serviceDrive();
  const folderId = await ensurePath(weeklyFolderPath(fn, deadline));

  const [{ data: records }, statusRows] = await Promise.all([
    db().from("cxp_ep_records").select("*").eq("function", fn).eq("is_past_month", false),
    db()
      .from("cxp_requirement_status")
      .select("ep_opp_id, stage_key, requirement_key, uploaded, file_id")
      .eq("function", fn),
  ]);

  const statusMap: Record<string, { uploaded: boolean }> = {};
  const fileIds: Record<string, string | null> = {};
  for (const s of statusRows.data ?? []) {
    const k = `${s.ep_opp_id}|${s.stage_key}|${s.requirement_key}`;
    statusMap[k] = { uploaded: s.uploaded };
    fileIds[k] = s.file_id;
  }

  const eps = selectWeeklyEps((records ?? []) as CxpEpRecord[], statusMap, fn, deadline);

  // the EPs in this week's submission, and for each the documents we DO have
  let fileCount = 0;
  for (const ep of eps) {
    const epDir = await ensureFolder(epFolderName(ep.epName, ep.epOppId), folderId);
    const existing = new Set(
      (
        await drive.files.list({
          q: `'${epDir}' in parents and trashed = false`,
          fields: "files(name)",
          pageSize: 200,
          supportsAllDrives: true,
        })
      ).data.files?.map((f) => f.name ?? "") ?? []
    );

    for (const req of requirementsForStage(fn, ep.stageKey)) {
      const key = `${ep.epOppId}|${ep.stageKey}|${req.key}`;
      const fileId = fileIds[key];
      if (!statusMap[key]?.uploaded || !fileId) continue;
      const name = `${req.name}`.replace(/[\\/:*?"<>|]/g, "_");
      if (existing.has(name)) {
        fileCount++;
        continue; // idempotent: regenerating must not duplicate shortcuts
      }
      try {
        await drive.files.create({
          requestBody: {
            name,
            mimeType: "application/vnd.google-apps.shortcut",
            parents: [epDir],
            shortcutDetails: { targetId: fileId },
          },
          fields: "id",
          supportsAllDrives: true,
        });
        fileCount++;
      } catch {
        // a single dead target must not abort the whole week's folder
      }
    }
  }

  return {
    folderId,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    epCount: eps.length,
    fileCount,
  };
}

export interface ZipResult {
  ok: boolean;
  fileId?: string;
  url?: string;
  includedFileCount: number;
  bytes?: number;
  error?: string;
}

/**
 * Bundle the week's collected documents into one ZIP for handing to ECB.
 *
 * Deliberately best-effort: it downloads every file into memory, which is fine
 * for a normal week (a few dozen photos and PDFs) and will not be fine forever.
 * On any failure the caller falls back to the weekly Drive FOLDER link, which
 * is the primary mechanism and always exists — the ZIP is a convenience.
 */
export async function generateWeeklyZip(
  fn: CxpFunction,
  deadline: string
): Promise<ZipResult> {
  try {
    const { ZipArchive } = await import("archiver");
    const drive = serviceDrive();

    const [{ data: records }, statusRows] = await Promise.all([
      db().from("cxp_ep_records").select("*").eq("function", fn).eq("is_past_month", false),
      db()
        .from("cxp_requirement_status")
        .select("ep_opp_id, stage_key, requirement_key, uploaded, file_id")
        .eq("function", fn),
    ]);

    const statusMap: Record<string, { uploaded: boolean }> = {};
    const fileIds: Record<string, string | null> = {};
    for (const s of statusRows.data ?? []) {
      const k = `${s.ep_opp_id}|${s.stage_key}|${s.requirement_key}`;
      statusMap[k] = { uploaded: s.uploaded };
      fileIds[k] = s.file_id;
    }

    const eps = selectWeeklyEps((records ?? []) as CxpEpRecord[], statusMap, fn, deadline);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<void>((resolve, reject) => {
      archive.on("end", () => resolve());
      archive.on("error", reject);
    });

    let includedFileCount = 0;
    for (const ep of eps) {
      const dir = epFolderName(ep.epName, ep.epOppId);
      for (const req of requirementsForStage(fn, ep.stageKey)) {
        const key = `${ep.epOppId}|${ep.stageKey}|${req.key}`;
        const fileId = fileIds[key];
        if (!statusMap[key]?.uploaded || !fileId) continue;
        try {
          const res = await drive.files.get(
            { fileId, alt: "media", supportsAllDrives: true },
            { responseType: "arraybuffer" }
          );
          archive.append(Buffer.from(res.data as ArrayBuffer), {
            name: `${dir}/${req.name.replace(/[\\/:*?"<>|]/g, "_")}`,
          });
          includedFileCount++;
        } catch {
          // skip a file we cannot read rather than failing the bundle
        }
      }
    }

    await archive.finalize();
    await done;
    const buffer = Buffer.concat(chunks);

    const folderId = await ensurePath(zipFolderPath(fn, deadline));
    const uploader = driveAsMailbox() ?? drive;
    const created = await uploader.files.create({
      requestBody: { name: zipFileName(fn, deadline), parents: [folderId] },
      media: { mimeType: "application/zip", body: Readable.from(buffer) },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });

    return {
      ok: true,
      fileId: created.data.id ?? undefined,
      url:
        created.data.webViewLink ??
        `https://drive.google.com/file/d/${created.data.id}/view`,
      includedFileCount,
      bytes: buffer.byteLength,
    };
  } catch (err) {
    return {
      ok: false,
      includedFileCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
