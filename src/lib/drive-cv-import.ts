import "server-only";
import { driveAsMailbox } from "@/lib/google/drive-upload";
import { env } from "@/lib/env";
import { CV_INDUSTRIES } from "@/lib/cv-extract";
import {
  classifyByRules, driveFolderIdFrom, mightBeCv, parseClassification, skipReasonForType,
  type DriveCvPlan, type DriveEntry,
} from "@/lib/drive-cv-plan";

export { driveFolderIdFrom };

/** IMPORTING ANOTHER LC'S CV POOL FROM GOOGLE DRIVE (v36.4).
 *
 *  Partner LCs keep their pools as Drive folders, and no two are laid out the
 *  same way. The two the floor sent as examples:
 *    · by programme (oGTe / oGTa), then by sector (Finance, IT, Marketing),
 *      with loose CVs AND one folder per person holding a CV, a video and a
 *      "needs" note;
 *    · by programme (GTe / GTa) with per-person folders of CV + TEFL/TESOL
 *      certificate, and 33 loose files of which some are transcripts and a
 *      policy document, not CVs at all.
 *  So the tree is read in full and the AI decides, file by file, what is a CV,
 *  whose it is, which programme and which sector — and a plain set of rules
 *  stands in when the AI can't be reached, so an import never simply fails.
 *
 *  ⚠️ THE MAILBOX CAN READ SODIO'S OWN DRIVE — backups, CXP documents, IR
 *  screenshots. Files are fetched with the LC mailbox's access, so nothing it
 *  OWNS may ever come through here, the CRM folder is refused outright, and a
 *  file is only imported after walking its parents up to the scanned root. */

const FOLDER = "application/vnd.google-apps.folder";
const GOOGLE_DOC = "application/vnd.google-apps.document";

export const DRIVE_SCAN_MAX_FILES = 400;
export const DRIVE_CV_MAX_BYTES = 25 * 1024 * 1024;

function mailbox() {
  const drive = driveAsMailbox();
  if (!drive) throw new DriveImportError("The LC mailbox isn't connected to Google Drive — ask the IM team.");
  return drive;
}

export class DriveImportError extends Error {}

/** Translate Drive's refusals into the one sentence a member can act on. */
function driveError(e: unknown): never {
  const status = (e as { code?: number; status?: number })?.code ?? (e as { status?: number })?.status;
  if (status === 404 || status === 403)
    throw new DriveImportError(
      `Sodio can't open that folder. Ask the LC to share it with ${env.gmailSender || "the LC mailbox"} (or with "anyone with the link"), then scan again.`
    );
  if (e instanceof DriveImportError) throw e;
  throw new DriveImportError(`Google Drive refused: ${e instanceof Error ? e.message : String(e)}`);
}

const ownedByMailbox = (owners?: { emailAddress?: string | null }[] | null) =>
  (owners ?? []).some(
    (o) => (o.emailAddress ?? "").toLowerCase() === (env.gmailSender ?? "").toLowerCase()
  );

/** The folder must be somebody else's pool — never the LC's own Drive. */
async function assertForeignFolder(folderId: string): Promise<string> {
  const drive = mailbox();
  const meta = await drive.files
    .get({ fileId: folderId, fields: "id, name, mimeType, owners(emailAddress)", supportsAllDrives: true })
    .catch(driveError);
  if (meta.data.mimeType !== FOLDER)
    throw new DriveImportError("That link is a file, not a folder — paste the folder's link.");
  if (folderId === env.driveFolderId || ownedByMailbox(meta.data.owners))
    throw new DriveImportError("That folder is the LC's own Drive, not a partner's CV pool.");
  return meta.data.name ?? "Drive folder";
}

/** Every document under the folder, breadth-first, with the folder path it
 *  sits in. Bounded — a pool is tens of CVs, not a whole Drive. */
export async function listDriveTree(
  folderId: string
): Promise<{ root: string; entries: DriveEntry[]; truncated: boolean }> {
  const root = await assertForeignFolder(folderId);
  const drive = mailbox();
  const entries: DriveEntry[] = [];
  let truncated = false;
  const queue: { id: string; path: string[] }[] = [{ id: folderId, path: [] }];
  let visited = 0;
  while (queue.length > 0) {
    const { id, path } = queue.shift()!;
    if (++visited > 200) {
      truncated = true;
      break;
    }
    let pageToken: string | undefined;
    do {
      const res = await drive.files
        .list({
          q: `'${id}' in parents and trashed = false`,
          fields: "nextPageToken, files(id, name, mimeType, size, owners(emailAddress))",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        })
        .catch(driveError);
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name || !f.mimeType) continue;
        if (f.mimeType === FOLDER) {
          if (path.length < 6) queue.push({ id: f.id, path: [...path, f.name] });
          continue;
        }
        if (ownedByMailbox(f.owners)) continue; // never the LC's own files
        if (entries.length >= DRIVE_SCAN_MAX_FILES) {
          truncated = true;
          continue;
        }
        entries.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size ? Number(f.size) : null,
          path,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return { root, entries, truncated };
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const PROMPT = (root: string, lines: string) => `A partner AIESEC LC shared its CV pool as a Google Drive folder named "${root}". Every LC lays its folder out differently: by programme (oGTa / GTa = Global Talent, oGTe / GTe = Global Teacher), by sector (IT, Finance, Marketing…), one folder per person holding their CV plus a video, certificates (TEFL, TESOL, IELTS) or notes — or everything loose.

Below is every document, one per line: n | folder path | file name | type.

For EACH line decide:
- is_cv: true ONLY for a person's CV / resume. Not videos, certificates, transcripts ("relevé de notes"), policies, cover letters, "needs" / "opportunity" notes, forms or untitled documents. If one person has several CV files, keep the best one (English, newest, "updated") and mark the others is_cv false with reason "another copy of <name>'s CV".
- person: the person's full name from the file or folder name — tidy capitalisation, no "CV" / "resume" / "updated" / extensions — or null.
- product: "GTa" or "GTe" when the path says so (oGTa / GTa / Global Talent → GTa; oGTe / GTe / Teacher / Teaching → GTe), else null.
- industry: the sector folder mapped to EXACTLY one of: ${CV_INDUSTRIES.join(", ")} — or null when the path doesn't say.
- reason: when is_cv is false, 2–6 words why.

Also lc_guess: the partner LC's name when the root folder name reveals it (e.g. "CV POOL oGT @ in Agadir" → "Agadir"), else null.

Return ONLY this JSON: {"lc_guess": string|null, "items": [{"n": number, "is_cv": boolean, "person": string|null, "product": "GTa"|"GTe"|null, "industry": string|null, "reason": string|null}]}

${lines}`;

async function classifyWithAi(root: string, docs: DriveEntry[]) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const lines = docs
    .map((d, n) => `${n} | ${d.path.join(" / ") || "(top)"} | ${d.name} | ${d.mimeType.split("/").pop()}`)
    .join("\n");
  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT(root, lines) }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      console.error("[drive-cv] Gemini error", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return null;
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return parseClassification(raw, docs.length);
  } catch (e) {
    console.error("[drive-cv] classification failed:", e);
    return null;
  }
}

/** Scan a folder and decide what to import — nothing is copied yet. */
export async function planDriveCvImport(folderId: string): Promise<DriveCvPlan> {
  const { root, entries, truncated } = await listDriveTree(folderId);
  const docs = entries.filter(mightBeCv);
  const skipped = entries
    .filter((e) => !mightBeCv(e))
    .map((e) => ({ fileId: e.id, name: e.name, path: e.path.join(" / "), reason: skipReasonForType(e.mimeType) }));

  // one AI call per 150 documents — a pool is usually one call
  const verdicts: ReturnType<typeof classifyByRules>["items"] = [];
  let lcGuess: string | null = null;
  let aiUsed = true;
  for (let i = 0; i < docs.length; i += 150) {
    const chunk = docs.slice(i, i + 150);
    const ai = await classifyWithAi(root, chunk);
    const result = ai ?? classifyByRules(root, chunk);
    if (!ai) aiUsed = false;
    lcGuess = lcGuess ?? result.lcGuess;
    verdicts.push(...result.items);
  }

  const cvs: DriveCvPlan["cvs"] = [];
  docs.forEach((d, n) => {
    const v = verdicts[n];
    const path = [...d.path, d.name].join(" / ");
    if (!v?.isCv) {
      skipped.push({ fileId: d.id, name: d.name, path: d.path.join(" / "), reason: v?.reason || "not a CV" });
      return;
    }
    if (d.size != null && d.size > DRIVE_CV_MAX_BYTES) {
      skipped.push({ fileId: d.id, name: d.name, path: d.path.join(" / "), reason: "over 25 MB" });
      return;
    }
    cvs.push({
      fileId: d.id,
      name: d.name,
      path,
      mimeType: d.mimeType,
      size: d.size,
      person: v.person,
      product: v.product,
      industry: v.industry,
    });
  });

  return { rootId: folderId, root, lcGuess, cvs, skipped, truncated, aiUsed };
}

/** Walk a file's parents up to the scanned root. Refuses anything the LC
 *  mailbox owns, and anything that isn't inside that folder. */
export async function assertFileInFolder(fileId: string, rootId: string): Promise<void> {
  await assertForeignFolder(rootId);
  const drive = mailbox();
  let current = fileId;
  for (let depth = 0; depth < 8; depth++) {
    const meta = await drive.files
      .get({ fileId: current, fields: "id, parents, owners(emailAddress)", supportsAllDrives: true })
      .catch(driveError);
    if (depth === 0 && ownedByMailbox(meta.data.owners))
      throw new DriveImportError("That file belongs to the LC's own Drive.");
    const parents = meta.data.parents ?? [];
    if (parents.includes(rootId)) return;
    if (parents.length === 0) break;
    current = parents[0];
  }
  throw new DriveImportError("That file isn't inside the folder you scanned.");
}

/** The file's bytes — a Google Doc is exported as PDF so the AI can read it. */
export async function downloadDriveFile(e: {
  fileId: string;
  mimeType: string;
  name: string;
}): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
  const drive = mailbox();
  if (e.mimeType === GOOGLE_DOC) {
    const res = await drive.files
      .export({ fileId: e.fileId, mimeType: "application/pdf" }, { responseType: "arraybuffer" })
      .catch(driveError);
    return {
      data: Buffer.from(res.data as ArrayBuffer),
      mimeType: "application/pdf",
      fileName: `${e.name}.pdf`,
    };
  }
  const res = await drive.files
    .get({ fileId: e.fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" })
    .catch(driveError);
  return { data: Buffer.from(res.data as ArrayBuffer), mimeType: e.mimeType, fileName: e.name };
}
