import { Readable } from "node:stream";
import { google } from "@/lib/google/apis";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { clients } from "./sheets";

/** Uploads to the system's Google Drive via the service account (v26 —
 *  Consideration module: IR-call screenshots land in a "CRM — IR Calls"
 *  subfolder of the CRM Drive folder).
 *
 *  TWO IDENTITIES, and the difference is not cosmetic (v33):
 *
 *  - FOLDERS are created by the service account (`clients()` from sheets.ts —
 *    Editor on the CRM folder). Folders cost no storage, so this works.
 *  - FILES are written as the IM MAILBOX, because a service account has no
 *    storage quota of its own: every `files.create` with bytes attached comes
 *    back "Service Accounts do not have storage quota", whoever owns the
 *    parent folder. The mailbox account has real space, and the file then
 *    belongs to the LC's own Google account rather than to a robot.
 *
 *  If the mailbox token predates the Drive scope we fall back to the service
 *  account, so nothing breaks — the upload just fails the way it used to,
 *  loudly enough to point at the fix.
 *
 *  Subfolder ids are cached in `app_settings` (e.g. key "drive:ir-calls") like
 *  the spreadsheet ids are. */

/** A Drive client authenticated as the IM mailbox — the identity that can
 *  actually STORE bytes. Null when no mailbox token is configured. */
export function driveAsMailbox() {
  if (!env.gmailRefreshToken || !env.googleClientId || !env.googleClientSecret)
    return null;
  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: env.gmailRefreshToken });
  return google.drive({ version: "v3", auth: oauth2 });
}

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
  publicRead = false,
}: {
  folderName: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  /** anyone-with-the-link viewer — screenshots yes, backups NEVER */
  publicRead?: boolean;
}): Promise<DriveUploadResult> {
  // the mailbox first — it owns storage; the service account cannot store bytes
  const drive = driveAsMailbox() ?? clients().drive;
  const create = async (folderId: string) =>
    drive.files.create({
      requestBody: { name: fileName.slice(0, 200), parents: [folderId] },
      media: { mimeType, body: Readable.from(data) },
      fields: "id, webViewLink",
      supportsAllDrives: true,
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
  // ANYONE WITH THE LINK CAN VIEW — OPT-IN ONLY (v33.29). Screenshots exist
  // to be looked at by whoever opens the call, and they used to inherit the
  // folder's EB-only sharing, so an MM hit "request access". BACKUPS use this
  // same helper and must never be public, hence the flag. Best-effort: a
  // permission failure must not fail the upload.
  if (publicRead && id) {
    try {
      await drive.permissions.create({
        fileId: id,
        requestBody: { type: "anyone", role: "reader" },
      });
    } catch (e) {
      console.error("[drive] public-read permission failed:", e);
    }
  }
  if (!id) throw new Error("Drive returned no file id.");
  return {
    id,
    webViewLink: res.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view`,
  };
}
