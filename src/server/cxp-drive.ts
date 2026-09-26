import "server-only";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "@/lib/google/apis";
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
} from "@/lib/cxp/drive";
import { findRequirement } from "@/lib/cxp/requirements";
import { statusKey, weeklyItemsFor } from "@/lib/cxp/weekly";
import { submissionMonthOf } from "@/lib/cxp/deadlines";
import { STAGE_BY_KEY, type CxpEpRecord, type CxpFunction, type CxpStageKey } from "@/lib/cxp/types";

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

/** THE CXP DRIVE ROOT (v37.1 — a fresh start).
 *
 *  The LC decided NOT to carry the standalone auditing system's files over:
 *  CXP starts a new directory. Its id lives in `app_settings`
 *  (`cxp:drive-root`), so moving it again is a data change, not an env var
 *  and a redeploy. The folder belongs to the IM mailbox (the identity that
 *  stores the bytes) and is shared with the service account as writer, which
 *  creates the per-function and per-EP folders inside it.
 *
 *  `CXP_DRIVE_FOLDER_ID` is only a fallback now (it points at the Aug-26
 *  root, left untouched); with neither set, a root is created inside the CRM
 *  Drive folder. */
export const CXP_ROOT_SETTING = "cxp:drive-root";

async function cxpRoot(): Promise<string> {
  const { data } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", CXP_ROOT_SETTING)
    .maybeSingle();
  const stored =
    data?.value && typeof data.value === "object" && "id" in data.value
      ? String((data.value as { id: string }).id)
      : "";
  if (stored) return stored;
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
 *  Authorization is the CALLER's job (`resolveTarget` in cxp-actions) — this function has
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

  const { error: recordError } = await db()
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
  // the file is in Drive either way — but a lost write would show the
  // document as missing while it sits in the folder, so say so
  if (recordError) {
    throw new Error(
      `The file reached Drive but Sodio could not record it (${recordError.message}). Try again.`
    );
  }

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

// --------------------------------------------------------- reading a file

export interface OpenedCxpFile {
  /** the name the download should carry, extension included */
  name: string;
  mimeType: string;
  /** bytes, when Drive reported them (exports have no size up front) */
  size: number | null;
  stream: Readable;
}

const GOOGLE_NATIVE_EXPORT: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: "pdf" },
};

/**
 * Open one stored document for download, THROUGH SODIO.
 *
 * WHY NOT JUST LINK TO DRIVE: the file belongs to the IM mailbox, in a folder
 * that is not shared with every CXP member — so the old "View" link opened a
 * "You need access" page for most of the people the module is for. Sodio
 * already decided they may read this function; it fetches the bytes with its
 * own identity and hands them over.
 *
 * Both identities are tried: the service account (Editor on the CXP root, so
 * it reads what the mailbox wrote), then the mailbox (which can read a file a
 * member dropped in by hand and shared only with it). A Google Doc is exported
 * to PDF — `alt=media` refuses native files — and a shortcut is followed to its
 * target, which is what the weekly folder is made of.
 *
 * Authorization is the CALLER's job, exactly like `uploadCxpDocument`.
 */
export async function openCxpDriveFile(fileId: string): Promise<OpenedCxpFile> {
  const clients: drive_v3.Drive[] = [];
  try {
    clients.push(serviceDrive());
  } catch {
    // no service account configured — the mailbox may still manage
  }
  const mailbox = driveAsMailbox();
  if (mailbox) clients.push(mailbox);
  if (clients.length === 0) throw new Error("Google Drive is not configured.");

  let lastError: unknown = null;
  for (const drive of clients) {
    try {
      let meta = (
        await drive.files.get({
          fileId,
          fields: "id, name, mimeType, size, shortcutDetails",
          supportsAllDrives: true,
        })
      ).data;
      if (meta.mimeType === "application/vnd.google-apps.shortcut") {
        const target = meta.shortcutDetails?.targetId;
        if (!target) throw new Error("That shortcut points at nothing.");
        meta = (
          await drive.files.get({
            fileId: target,
            fields: "id, name, mimeType, size",
            supportsAllDrives: true,
          })
        ).data;
      }
      const id = meta.id!;
      const name = meta.name || "document";
      const native = meta.mimeType ? GOOGLE_NATIVE_EXPORT[meta.mimeType] : undefined;
      if (native) {
        const res = await drive.files.export(
          { fileId: id, mimeType: native.mime },
          { responseType: "stream" }
        );
        return {
          name: /\.pdf$/i.test(name) ? name : `${name}.${native.ext}`,
          mimeType: native.mime,
          size: null,
          stream: res.data as unknown as Readable,
        };
      }
      if (meta.mimeType?.startsWith("application/vnd.google-apps.")) {
        throw new Error(`"${name}" is a Google ${meta.mimeType.split(".").pop()} and cannot be downloaded.`);
      }
      const res = await drive.files.get(
        { fileId: id, alt: "media", supportsAllDrives: true },
        { responseType: "stream" }
      );
      return {
        name,
        mimeType: meta.mimeType || "application/octet-stream",
        size: meta.size ? Number(meta.size) : null,
        stream: res.data as unknown as Readable,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not read that file from Drive.");
}

/** Where an upload waits between the browser and Drive (migration 0083).
 *
 *  Vercel refuses any request body over 4.5 MB before Sodio ever sees it, so a
 *  phone photo or a scanned PDF could never reach the old one-step upload. The
 *  browser now PUTs the file straight into this private bucket, and the server
 *  moves it on to Drive and deletes it here. */
export const CXP_STAGING_BUCKET = "cxp-staging";

// ----------------------------------------------------------- weekly folder

export interface WeeklyFolderResult {
  folderId: string;
  folderUrl: string;
  epCount: number;
  fileCount: number;
}

/** The documents a function has COLLECTED for one weekly deadline, each with
 *  the Drive file behind it — what the weekly folder and the ZIP are made of.
 *
 *  THE BUG THIS REPLACES: both used `selectWeeklyEps`, which returns the EPs
 *  that still OWE something. So an EP whose documents were all in — exactly
 *  the EP you submit — was left out of its own week's ZIP, and only the
 *  representative stage of the rest was read. The ZIP came out empty or close
 *  to it. Now it is the collected half of the same week the board shows:
 *  current + overdue + always-owed, for the month that deadline belongs to. */
export async function collectedForWeek(
  fn: CxpFunction,
  deadline: string
): Promise<{
  files: { epOppId: string; epName: string; stageKey: CxpStageKey; requirementName: string; fileId: string }[];
  /** collected per the ECB sheet's own tick, with no file in Drive */
  flaggedOnly: { epName: string; epOppId: string; stageKey: CxpStageKey; requirementName: string }[];
  /** still owed at this deadline */
  missing: { epName: string; epOppId: string; stageKey: CxpStageKey; requirementName: string; bucket: string }[];
}> {
  const month = submissionMonthOf(deadline);
  const [{ data: records }, { data: statusRows }] = await Promise.all([
    db().from("cxp_ep_records").select("*").eq("function", fn).eq("submission_month", month),
    db()
      .from("cxp_requirement_status")
      .select("ep_opp_id, stage_key, requirement_key, uploaded, file_id")
      .eq("function", fn),
  ]);

  const statusMap: Record<string, { uploaded: boolean }> = {};
  const fileIds: Record<string, string | null> = {};
  for (const s of statusRows ?? []) {
    const k = statusKey(s.ep_opp_id, s.stage_key, s.requirement_key);
    statusMap[k] = { uploaded: s.uploaded };
    fileIds[k] = s.file_id;
  }

  const items = weeklyItemsFor((records ?? []) as CxpEpRecord[], statusMap, fn, deadline, new Date(), {
    state: "all",
    includePastMonth: true,
  });
  const files = [];
  const flaggedOnly = [];
  const missing = [];
  for (const i of items) {
    const base = {
      epOppId: i.epOppId,
      epName: i.epName,
      stageKey: i.stageKey,
      requirementName: i.requirementName,
    };
    if (!i.uploaded) {
      missing.push({ ...base, bucket: i.bucket });
      continue;
    }
    const fileId = fileIds[statusKey(i.epOppId, i.stageKey, i.requirementKey)];
    if (fileId) files.push({ ...base, fileId });
    else flaggedOnly.push(base);
  }
  return { files, flaggedOnly, missing };
}

/**
 * Build the week's submission folder: one sub-folder per EP, holding SHORTCUTS
 * to the documents already collected.
 *
 * Shortcuts, not copies, on purpose — the file stays in the EP's own folder, so
 * there is one copy of a passport in Drive rather than one per week.
 */
export async function buildWeeklyFolder(
  fn: CxpFunction,
  deadline: string
): Promise<WeeklyFolderResult> {
  const drive = serviceDrive();
  const folderId = await ensurePath(weeklyFolderPath(fn, deadline));
  const { files } = await collectedForWeek(fn, deadline);

  const byEp = new Map<string, typeof files>();
  for (const f of files) {
    const arr = byEp.get(f.epOppId) ?? [];
    arr.push(f);
    byEp.set(f.epOppId, arr);
  }

  let fileCount = 0;
  for (const epFiles of byEp.values()) {
    const epDir = await ensureFolder(
      epFolderName(epFiles[0].epName, epFiles[0].epOppId),
      folderId
    );
    const existing = new Set(
      (
        await drive.files.list({
          q: `'${epDir}' in parents and trashed = false`,
          fields: "files(name)",
          pageSize: 200,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        })
      ).data.files?.map((f) => f.name ?? "") ?? []
    );

    for (const f of epFiles) {
      const name = `${STAGE_BY_KEY[f.stageKey]} - ${f.requirementName}`.replace(
        /[\\/:*?"<>|]/g,
        "_"
      );
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
            shortcutDetails: { targetId: f.fileId },
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
    epCount: byEp.size,
    fileCount,
  };
}
