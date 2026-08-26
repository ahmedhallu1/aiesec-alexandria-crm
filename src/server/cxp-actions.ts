"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getViewer } from "./data";
import { assertCanEditCxp } from "./cxp";
import { buildWeeklyFolder, generateWeeklyZip, uploadCxpDocument } from "./cxp-drive";
import { canRunCxpOps, canViewCxpFunction } from "@/lib/cxp/rbac";
import { checkUpload } from "@/lib/cxp/drive";
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

/** Attach a collected document to an EP's requirement. */
export async function uploadCxpFile(formData: FormData): Promise<ActionResult> {
  const epOppId = String(formData.get("epOppId") ?? "");
  const stageKey = String(formData.get("stageKey") ?? "") as CxpStageKey;
  const requirementKey = String(formData.get("requirementKey") ?? "");
  const file = formData.get("file");

  if (!(file instanceof File)) return { ok: false, message: "No file was attached." };
  if (!epOppId || !stageKey || !requirementKey) {
    return { ok: false, message: "Missing EP, stage or requirement." };
  }

  // THE EP DECIDES THE FUNCTION, not the caller. Accepting a function from the
  // form would let someone name one they are allowed to edit and attach a file
  // to an EP in one they are not.
  const { data: record } = await db()
    .from("cxp_ep_records")
    .select("*")
    .eq("ep_opp_id", epOppId)
    .eq("stage_key", stageKey)
    .limit(1)
    .maybeSingle<CxpEpRecord>();
  if (!record) return { ok: false, message: "That EP stage does not exist." };

  const viewer = await getViewer();
  if (!canViewCxpFunction(viewer, record.function)) {
    return { ok: false, message: `You do not have access to ${record.function}.` };
  }
  await assertCanEditCxp(record.function);

  const req = findRequirement(record.function, stageKey, requirementKey);
  if (!req) return { ok: false, message: "Unknown requirement." };

  const check = checkUpload({
    fileName: file.name,
    size: file.size,
    epOppId,
    stageKey,
    requirementName: req.name,
  });
  if (!check.ok) return { ok: false, message: check.error ?? "That file was rejected." };

  try {
    const res = await uploadCxpDocument({
      epName: record.ep_name,
      epOppId,
      fn: record.function,
      stageKey,
      requirementKey,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      data: Buffer.from(await file.arrayBuffer()),
      uploadedBy: viewer.id,
    });
    revalidatePath(`/cxp/ep/${encodeURIComponent(epOppId)}`);
    revalidatePath("/cxp");
    revalidatePath("/cxp/weekly");
    return { ok: true, message: `${req.name} attached.`, url: res.fileUrl };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "The upload failed.",
    };
  }
}

/** Remove a document's record. The FILE stays in Drive on purpose — this
 *  marks the requirement outstanding again, it does not destroy evidence. */
export async function clearCxpRequirement(
  epOppId: string,
  stageKey: CxpStageKey,
  requirementKey: string
): Promise<ActionResult> {
  const { data: record } = await db()
    .from("cxp_ep_records")
    .select("function")
    .eq("ep_opp_id", epOppId)
    .eq("stage_key", stageKey)
    .limit(1)
    .maybeSingle<{ function: CxpFunction }>();
  if (!record) return { ok: false, message: "That EP stage does not exist." };
  await assertCanEditCxp(record.function);

  await db()
    .from("cxp_requirement_status")
    .delete()
    .eq("ep_opp_id", epOppId)
    .eq("stage_key", stageKey)
    .eq("requirement_key", requirementKey);

  revalidatePath(`/cxp/ep/${encodeURIComponent(epOppId)}`);
  return { ok: true, message: "Marked as not collected. The file is still in Drive." };
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

/** Bundle the week into a ZIP. Falls back to the folder on failure — see
 *  `generateWeeklyZip`, which never throws. */
export async function buildCxpWeeklyZip(
  fn: CxpFunction,
  deadline: string
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canRunCxpOps(viewer) || !canViewCxpFunction(viewer, fn)) {
    return { ok: false, message: "Not authorized." };
  }
  const r = await generateWeeklyZip(fn, deadline);
  if (!r.ok) {
    return {
      ok: false,
      message: `ZIP failed (${r.error ?? "unknown"}). Use the weekly Drive folder instead.`,
    };
  }
  revalidatePath("/cxp/weekly");
  return {
    ok: true,
    message: `${r.includedFileCount} document(s), ${(
      (r.bytes ?? 0) / 1024 / 1024
    ).toFixed(1)} MB.`,
    url: r.url,
  };
}
