"use server";

import { isSafeStorageKey } from "@/lib/storage-key";
import { cxpMimeType } from "@/lib/cxp/drive";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getViewer, logAudit } from "./data";
import { buildWeeklyFolder, CXP_STAGING_BUCKET, uploadCxpDocument } from "./cxp-drive";
import { canEditCxpFunction, canRunCxpOps, canViewCxpFunction } from "@/lib/cxp/rbac";
import { checkUpload, sanitizeFilename } from "@/lib/cxp/drive";
import { findRequirement } from "@/lib/cxp/requirements";
import type { CxpEpRecord, CxpFunction, CxpStageKey } from "@/lib/cxp/types";

/**
 * THE CXP ACTIONS.
 *
 * Every one of these re-resolves the viewer and re-checks authorization
 * server-side. The client's own gating is a courtesy — a hidden button is not
 * a permission, and nothing here trusts the arguments it was handed.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
  url?: string;
}

/** Resolve and authorize one EP stage + requirement for a write. Every write
 *  path goes through here, so none of them can drift on what is checked.
 *
 *  THE EP DECIDES THE FUNCTION, not the caller. Accepting a function from the
 *  client would let someone name one they are allowed to edit and attach a file
 *  to an EP in one they are not. */
async function resolveTarget(
  epOppId: string,
  stageKey: CxpStageKey,
  requirementKey: string
): Promise<
  | { ok: true; record: CxpEpRecord; reqName: string; viewer: Awaited<ReturnType<typeof getViewer>> }
  | { ok: false; message: string }
> {
  if (!epOppId || !stageKey || !requirementKey) {
    return { ok: false, message: "Missing EP, stage or requirement." };
  }
  const { data: record } = await db()
    .from("cxp_ep_records")
    .select("*")
    .eq("ep_opp_id", epOppId)
    .eq("stage_key", stageKey)
    .order("submission_month", { ascending: false })
    .limit(1)
    .maybeSingle<CxpEpRecord>();
  if (!record) return { ok: false, message: "That EP stage does not exist." };

  const viewer = await getViewer();
  if (!canEditCxpFunction(viewer, record.function)) {
    return { ok: false, message: `You do not have access to ${record.function}.` };
  }
  const req = findRequirement(record.function, stageKey, requirementKey);
  if (!req) return { ok: false, message: "Unknown requirement." };
  return { ok: true, record, reqName: req.name, viewer };
}

const refreshCxp = (epOppId: string) => {
  revalidatePath(`/cxp/ep/${encodeURIComponent(epOppId)}`);
  revalidatePath("/cxp");
  revalidatePath("/cxp/weekly");
};

/**
 * STEP 1 OF AN UPLOAD — a signed URL the browser PUTs the file to.
 *
 * THE BUG THIS REPLACES: the file used to ride inside the server action's own
 * request. Vercel refuses any request body over 4.5 MB before Sodio sees it,
 * so a phone photo or a scanned passport PDF — most real documents — died
 * with no message at all, while the page promised a 25 MB limit. Only three
 * documents were ever attached, all small PDFs. The bytes now go straight to a
 * private Supabase bucket, the same way contracts and CVs have for months.
 */
export async function requestCxpUpload(input: {
  epOppId: string;
  stageKey: CxpStageKey;
  requirementKey: string;
  fileName: string;
  size: number;
}): Promise<ActionResult & { path?: string; signedUrl?: string }> {
  const t = await resolveTarget(input.epOppId, input.stageKey, input.requirementKey);
  if (!t.ok) return t;
  // a file in Drive can't be rolled back when the test view ends
  if (t.viewer.sandbox) {
    return {
      ok: false,
      message: "Uploads are off in the sandbox test view — a file in Drive can't be undone on exit.",
    };
  }
  const check = checkUpload({
    fileName: input.fileName,
    size: input.size,
    epOppId: input.epOppId,
    stageKey: input.stageKey,
    requirementName: t.reqName,
  });
  if (!check.ok) return { ok: false, message: check.error ?? "That file was rejected." };

  const safe = sanitizeFilename(input.fileName).replace(/[^\w.\- ()]+/g, "_").slice(-80);
  const path = `${Date.now()}-${crypto.randomUUID()}-${safe}`;
  const { data, error } = await db().storage.from(CXP_STAGING_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return {
      ok: false,
      message: error?.message?.toLowerCase().includes("bucket")
        ? "The cxp-staging storage bucket is missing — run migration 0083."
        : (error?.message ?? "Could not prepare the upload — try again."),
    };
  }
  return { ok: true, message: "ready", path: data.path, signedUrl: data.signedUrl };
}

/** STEP 2 — the browser has PUT the file; move it into the EP's Drive folder,
 *  record it, and drop the staged copy. */
export async function confirmCxpUpload(input: {
  epOppId: string;
  stageKey: CxpStageKey;
  requirementKey: string;
  path: string;
  fileName: string;
  mimeType: string;
}): Promise<ActionResult> {
  const t = await resolveTarget(input.epOppId, input.stageKey, input.requirementKey);
  if (!t.ok) return t;
  if (t.viewer.sandbox) {
    return { ok: false, message: "Uploads are off in the sandbox test view." };
  }
  // only paths shaped like the ones requestCxpUpload issues
  if (!/^\d{10,}-[0-9a-f][0-9a-f-]{30,40}-/.test(input.path ?? "") || !isSafeStorageKey(input.path)) {
    return { ok: false, message: "Nothing was uploaded." };
  }

  const bucket = db().storage.from(CXP_STAGING_BUCKET);
  const { data: blob, error: dlError } = await bucket.download(input.path);
  if (dlError || !blob) {
    return { ok: false, message: "The file never arrived — check your connection and try again." };
  }
  const check = checkUpload({
    fileName: input.fileName,
    size: blob.size,
    epOppId: input.epOppId,
    stageKey: input.stageKey,
    requirementName: t.reqName,
  });
  if (!check.ok) {
    await bucket.remove([input.path]);
    return { ok: false, message: check.error ?? "That file was rejected." };
  }

  try {
    const res = await uploadCxpDocument({
      epName: t.record.ep_name,
      epOppId: input.epOppId,
      fn: t.record.function,
      stageKey: input.stageKey,
      requirementKey: input.requirementKey,
      fileName: input.fileName,
      // from the extension, never the browser's claim: /api/cxp/file serves
      // documents from Sodio's own origin (v37.7)
      mimeType: cxpMimeType(input.fileName),
      data: Buffer.from(await blob.arrayBuffer()),
      uploadedBy: t.viewer.id,
    });
    await logAudit(t.viewer.id, "cxp_upload", "cxp_document", null, {
      ep: input.epOppId,
      function: t.record.function,
      stage: input.stageKey,
      requirement: input.requirementKey,
      file: input.fileName,
    });
    refreshCxp(input.epOppId);
    return { ok: true, message: `${t.reqName} attached.`, url: res.fileUrl };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "The upload to Drive failed.",
    };
  } finally {
    // the staged copy has done its job whether Drive took it or not
    await bucket.remove([input.path]).catch(() => undefined);
    await sweepStaging().catch(() => undefined);
  }
}

/** Uploads abandoned between the two steps (tab closed after the PUT) would
 *  otherwise sit in the bucket forever. Anything older than a day goes. */
async function sweepStaging(): Promise<void> {
  const bucket = db().storage.from(CXP_STAGING_BUCKET);
  const { data } = await bucket.list("", { limit: 100, sortBy: { column: "created_at", order: "asc" } });
  const cutoff = Date.now() - 24 * 60 * 60_000;
  const old = (data ?? [])
    .filter((o) => {
      const at = Number(o.name.split("-")[0]);
      return Number.isFinite(at) && at < cutoff;
    })
    .map((o) => o.name);
  if (old.length > 0) await bucket.remove(old);
}

/** Mark a requirement as NOT collected — the undo for a wrong attachment.
 *  The FILE stays in Drive on purpose: this marks the requirement outstanding
 *  again, it does not destroy evidence. */
export async function clearCxpRequirement(
  epOppId: string,
  stageKey: CxpStageKey,
  requirementKey: string
): Promise<ActionResult> {
  const t = await resolveTarget(epOppId, stageKey, requirementKey);
  if (!t.ok) return t;

  const { error } = await db()
    .from("cxp_requirement_status")
    .delete()
    .eq("ep_opp_id", epOppId)
    .eq("stage_key", stageKey)
    .eq("requirement_key", requirementKey);
  if (error) return { ok: false, message: error.message };

  await logAudit(t.viewer.id, "cxp_clear", "cxp_document", null, {
    ep: epOppId,
    function: t.record.function,
    stage: stageKey,
    requirement: requirementKey,
  });
  refreshCxp(epOppId);
  // a sheet tick can still count it as collected; say which is true now
  const flagged = Boolean(t.record.sheet_flags?.[requirementKey]);
  return {
    ok: true,
    message: flagged
      ? "Removed. The ECB sheet still ticks it as collected, so it keeps counting until the sheet is unticked. The file is still in Drive."
      : "Marked as not collected. The file is still in Drive.",
  };
}

/** Build (or refresh) the week's Drive folder of shortcuts. */
export async function buildCxpWeeklyFolder(
  fn: CxpFunction,
  deadline: string
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canRunCxpOps(viewer) || !canViewCxpFunction(viewer, fn)) {
    return { ok: false, message: "Not authorized." };
  }
  try {
    const r = await buildWeeklyFolder(fn, deadline);
    revalidatePath("/cxp/weekly");
    return {
      ok: true,
      message: `${fn} · ${deadline}: ${r.epCount} EP folder(s), ${r.fileCount} document(s).`,
      url: r.folderUrl,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not build the folder.",
    };
  }
}
