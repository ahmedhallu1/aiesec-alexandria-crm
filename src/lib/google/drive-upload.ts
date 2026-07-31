import { Readable } from "node:stream";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { clients } from "./sheets";

/** Uploads to the system's Google Drive via the service account (v26 —
 *  Consideration module: IR-call screenshots land in a "CRM — IR Calls"
 *  subfolder of the CRM Drive folder).
 *
 *  The service account reuses `clients()` from sheets.ts (full `drive` scope,
 *  Editor on the CRM folder). Subfolder ids are cached in `app_settings`
 *  (e.g. key "drive:ir-calls") like the spreadsheet ids are. */

/** "CRM — IR Calls" → "drive:ir-calls" (matches the ensureSpreadsheet style). */
function folderCacheKey(folderName: string): string {
  const slug = folderName
    .toLowerCase()
    .replace(/^crm\s*[—–-]*\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `drive:${slug || "folder"}`;
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Finds (or creates) a named subfolder inside the CRM Drive folder and
 *  caches its id in app_settings. */
async function ensureDriveFolder(folderName: string): Promise<string> {
  const cacheKey = folderCacheKey(folderName);
  const { data: cached } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", cacheKey)
    .maybeSingle();
  if (cached?.value && typeof cached.value === "object" && "id" in cached.value) {
    return (cached.value as { id: string }).id;
  }

  const { drive } = clients();
  const list = await drive.files.list({
    q: `'${env.driveFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 100,
  });
  let id =
    (list.data.files ?? []).find((f) => normTitle(f.name ?? "") === normTitle(folderName))
      ?.id ?? null;

  if (!id) {
    // folders take no storage quota — the service account can create them
    const created = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [env.driveFolderId],
      },
      fields: "id",
    });
    id = created.data.id!;
  }

  await db()
    .from("app_settings")
    .upsert({ key: cacheKey, value: { id }, updated_at: new Date().toISOString() });
  return id;
}

export interface DriveUploadResult {
  id: string;
  webViewLink: string;
}

/** Uploads bytes as a file into a named subfolder of the CRM Drive folder.
 *  Throws on failure — callers treat the upload as best-effort. */
export async function uploadToDriveFolder({
  folderName,
  fileName,
  mimeType,
  data,
}: {
  folderName: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}): Promise<DriveUploadResult> {
  const { drive } = clients();
  const create = async (folderId: string) =>
    drive.files.create({
      requestBody: { name: fileName.slice(0, 200), parents: [folderId] },
      media: { mimeType, body: Readable.from(data) },
      fields: "id, webViewLink",
    });

  let res;
  try {
    res = await create(await ensureDriveFolder(folderName));
  } catch (e) {
    // a cached folder id can go stale (folder trashed/deleted by hand) —
    // drop the cache, re-resolve/recreate the folder, retry ONCE
    console.warn(`[drive] upload failed, re-resolving "${folderName}":`, e instanceof Error ? e.message : e);
    await db().from("app_settings").delete().eq("key", folderCacheKey(folderName));
    res = await create(await ensureDriveFolder(folderName));
  }
  const id = res.data.id;
  if (!id) throw new Error("Drive returned no file id.");
  return {
    id,
    webViewLink: res.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view`,
  };
}
