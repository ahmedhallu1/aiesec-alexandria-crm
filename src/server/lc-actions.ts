"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getViewer, logAudit } from "./data";
import { notifyMembers } from "./notify";
import { canManageMembership, canRunLcTools } from "@/lib/rbac";
import { currentTermFebYear, peakOf } from "@/lib/plan";
import {
  resolveHandover,
  spreadsheetIdFrom,
  termLabelOf,
  type Handover,
  type LcPeriodKind,
  type LcTermState,
} from "@/lib/lc-term";

/**
 * THE LC TOOLS — membership inside Sodio, the term's planning, the handover,
 * and starting a new peak or term (v37.2).
 *
 * Who: a plain membership UPDATE (add people, change roles) is the EB's, the
 * same people who edit membership today. Everything that resets the LC — a
 * restart that deactivates whoever isn't on the new list, where membership
 * lives, the planning sheet, starting a period — is the LCP's and the
 * admins' (`canRunLcTools`), as the LC decided.
 */

export type LcResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const refresh = () => {
  revalidatePath("/profile/settings");
  revalidatePath("/membership");
  revalidatePath("/planning");
  revalidatePath("/", "layout");
};

async function putSetting(key: string, value: unknown) {
  const { error } = await db()
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/** A grid from the browser — rows of cells, capped, every cell a string. */
function cleanGrid(grid: unknown, maxRows = 2000, maxCols = 40): string[][] {
  if (!Array.isArray(grid)) return [];
  return grid.slice(0, maxRows).map((r) =>
    Array.isArray(r) ? r.slice(0, maxCols).map((c) => (c == null ? "" : String(c).slice(0, 500))) : []
  );
}

// ------------------------------------------------------------ membership

/** WHAT AN UPLOAD WOULD DO — who is new, who changes (and how), who is left
 *  alone, which lines are refused and why, and (for a restart) who would be
 *  marked inactive. Nothing is written. */
export async function previewMembershipUpload(
  grid: unknown,
  mode: "update" | "restart"
): Promise<LcResult<Awaited<ReturnType<typeof import("@/lib/google/sheets").previewMembershipGrid>>>> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer)) return fail("Only the EB and admins can upload membership.");
  if (mode === "restart" && !canRunLcTools(viewer)) {
    return fail("Restarting the membership is the LCP's and the admins'.");
  }
  const rows = cleanGrid(grid);
  if (rows.length < 2) return fail("The file has no rows under the header.");
  const { previewMembershipGrid } = await import("@/lib/google/sheets");
  const data = await previewMembershipGrid(rows, { deactivateMissing: mode === "restart" });
  if (data.headerProblem) return fail(data.headerProblem);
  return { ok: true, data };
}

/** APPLY AN UPLOAD — the same import the Google Sheet used to feed, from the
 *  file. A restart marks everyone not on the list inactive (their history
 *  stays theirs). Then the sheet is rewritten as the mirror. */
export async function applyMembershipUpload(
  grid: unknown,
  mode: "update" | "restart"
): Promise<LcResult<{ rows: number; deactivated: number }>> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer)) return fail("Only the EB and admins can upload membership.");
  if (mode === "restart" && !canRunLcTools(viewer)) {
    return fail("Restarting the membership is the LCP's and the admins'.");
  }
  // a test view's journal can't undo a whole membership import
  if (viewer.impersonated) return fail("Membership uploads are off in a test view.");
  const rows = cleanGrid(grid);
  if (rows.length < 2) return fail("The file has no rows under the header.");

  const { applyMembershipGrid, mirrorMembershipToSheet, previewMembershipGrid } = await import(
    "@/lib/google/sheets"
  );
  const preview = await previewMembershipGrid(rows, { deactivateMissing: mode === "restart" });
  if (preview.headerProblem) return fail(preview.headerProblem);
  const valid = preview.lines.filter((l) => l.action !== "invalid").length;
  if (valid === 0) return fail("No line in the file could be read — nothing was changed.");
  // a restart from a file that lost most of the LC is almost certainly the
  // wrong file — refuse rather than deactivate the LC
  if (mode === "restart" && preview.leaving.length > Math.max(20, valid)) {
    return fail(
      `This would mark ${preview.leaving.length} people inactive while the file lists only ${valid}. ` +
        "That looks like the wrong file — check it, or use Update instead."
    );
  }

  const count = await applyMembershipGrid(rows, { deactivateMissing: mode === "restart" });
  await mirrorMembershipToSheet().catch((e) => console.error("[membership] mirror failed:", e));
  await logAudit(viewer.id, mode === "restart" ? "membership_restart" : "membership_upload", "system", null, {
    rows: count,
    new: preview.lines.filter((l) => l.action === "new").length,
    updated: preview.lines.filter((l) => l.action === "update").length,
    deactivated: preview.leaving.length,
  });
  refresh();
  return {
    ok: true,
    data: { rows: count, deactivated: mode === "restart" ? preview.leaving.length : 0 },
  };
}

/** Where membership lives: Sodio (the sheet mirrors it) or the sheet (two-way). */
export async function setMembershipSource(source: "sodio" | "sheet"): Promise<LcResult> {
  const viewer = await getViewer();
  if (!canRunLcTools(viewer)) return fail("The LCP and the admins only.");
  if (source !== "sodio" && source !== "sheet") return fail("Unknown source.");
  await putSetting("membership:source", { source });
  // switching TO Sodio: make the mirror true right away
  if (source === "sodio") {
    const { mirrorMembershipToSheet } = await import("@/lib/google/sheets");
    await mirrorMembershipToSheet().catch((e) => console.error("[membership] mirror failed:", e));
  }
  await logAudit(viewer.id, "membership_source", "system", null, { source });
  refresh();
  return { ok: true };
}

/** Rewrite the Membership sheet from Sodio, now. */
export async function mirrorMembershipNow(): Promise<LcResult<{ rows: number }>> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer)) return fail("The EB and admins only.");
  try {
    const { mirrorMembershipToSheet } = await import("@/lib/google/sheets");
    const rows = await mirrorMembershipToSheet();
    await logAudit(viewer.id, "membership_mirror", "system", null, { rows });
    return { ok: true, data: { rows } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not write the sheet.");
  }
}

// ------------------------------------------------------------ planning

/** Point Sodio at the term's planning sheet (a link or the id), and import
 *  it now. The sheet must be readable by the service account — Sodio says so
 *  plainly if it isn't. */
export async function linkPlanningSheet(input: string): Promise<LcResult<{ cells: number; skipped: string[] }>> {
  const viewer = await getViewer();
  if (!canRunLcTools(viewer)) return fail("The LCP and the admins only.");
  const id = spreadsheetIdFrom(input);
  if (!id) return fail("Paste the planning sheet's link (docs.google.com/spreadsheets/d/…).");

  const { clients, serviceAccountEmail } = await import("@/lib/google/sheets");
  try {
    await clients().sheets.spreadsheets.get({ spreadsheetId: id, fields: "spreadsheetId" });
  } catch {
    return fail(
      `Sodio can't open that sheet. Share it (Viewer) with ${serviceAccountEmail() ?? "Sodio's service account"} — or set it to "Anyone with the link" — and try again.`
    );
  }
  await putSetting("planning:sheet-id", id);
  const res = await importPlanning(undefined);
  await clearPlanningPending();
  await logAudit(viewer.id, "planning_linked", "system", null, { sheet: id, cells: res.cells });
  refresh();
  return { ok: true, data: res };
}

/** The planning workbook uploaded as a file (.xlsx exported from the planning
 *  tool) — read by exactly the same parser as the Google Sheet. */
export async function uploadPlanningWorkbook(
  tabs: Record<string, unknown>
): Promise<LcResult<{ cells: number; skipped: string[] }>> {
  const viewer = await getViewer();
  if (!canRunLcTools(viewer)) return fail("The LCP and the admins only.");
  if (!tabs || typeof tabs !== "object") return fail("No workbook was read.");
  const grids: Record<string, unknown[][]> = {};
  for (const [name, grid] of Object.entries(tabs).slice(0, 60)) {
    if (!Array.isArray(grid)) continue;
    grids[String(name).slice(0, 100)] = grid.slice(0, 120).map((r) =>
      Array.isArray(r) ? r.slice(0, 60).map((c) => (typeof c === "number" ? c : c == null ? "" : String(c).slice(0, 300))) : []
    );
  }
  const res = await importPlanning(grids);
  if (res.cells === 0) {
    return fail(
      "Nothing in that file looked like the planning tool's goal-setting tabs (🎯 iGV, 🎯 oGV …). " +
        (res.skipped[0] ? `First problem: ${res.skipped[0]}` : "")
    );
  }
  await clearPlanningPending();
  await logAudit(viewer.id, "planning_uploaded", "system", null, { cells: res.cells, skipped: res.skipped.length });
  refresh();
  return { ok: true, data: res };
}

async function importPlanning(grids: Record<string, unknown[][]> | undefined) {
  const { importPlanningSheet, importBdB2bPlanning } = await import("@/lib/google/sheets");
  const [lanes, bdB2b] = await Promise.all([
    importPlanningSheet(undefined, undefined, grids),
    importBdB2bPlanning(undefined, grids),
  ]);
  return { cells: lanes.cells + bdB2b.cells, skipped: [...lanes.skipped, ...bdB2b.skipped] };
}

async function clearPlanningPending() {
  const { data } = await db().from("app_settings").select("value").eq("key", "lc:term").maybeSingle();
  const state = data?.value as LcTermState | null;
  if (state?.planningPending) await putSetting("lc:term", { ...state, planningPending: false });
}

// ------------------------------------------------------------ handover

export async function saveHandover(input: Partial<Handover>): Promise<LcResult> {
  const viewer = await getViewer();
  if (!canRunLcTools(viewer)) return fail("The LCP and the admins only.");
  const clean = resolveHandover({
    ...input,
    updatedAt: new Date().toISOString(),
    updatedBy: viewer.name,
  });
  await putSetting("lc:handover", clean);
  await logAudit(viewer.id, "handover_saved", "system", null, {
    functions: Object.keys(clean.perFunction),
    links: clean.links.length,
  });
  refresh();
  return { ok: true };
}

export async function setHandoverChecklistItem(id: string, done: boolean): Promise<LcResult> {
  const viewer = await getViewer();
  if (!canRunLcTools(viewer)) return fail("The LCP and the admins only.");
  const { HANDOVER_CHECKLIST } = await import("@/lib/lc-term");
  if (!HANDOVER_CHECKLIST.some((c) => c.id === id)) return fail("Unknown item.");
  const { data } = await db().from("app_settings").select("value").eq("key", "lc:term").maybeSingle();
  const state = data?.value as LcTermState | null;
  if (!state) return fail("Start a peak or term first — the checklist belongs to one.");
  await putSetting("lc:term", { ...state, checklist: { ...(state.checklist ?? {}), [id]: !!done } });
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------ start a period

/**
 * STAMP A NEW PEAK OR TERM. The heavy steps (the membership restart, the
 * planning) each run on their own button, so every one of them can be seen,
 * previewed and repeated; this records that the LC moved on, keeps the
 * previous record in the history, resets the handover checklist, and tells
 * the EB to read the handover.
 *
 *   peak → keeps the planning (it is the term's)
 *   term → `planningPending` until a sheet is linked or a workbook uploaded
 */
export async function startLcPeriod(
  kind: LcPeriodKind,
  opts: { planningLater?: boolean } = {}
): Promise<LcResult> {
  const viewer = await getViewer();
  if (!canRunLcTools(viewer)) return fail("The LCP and the admins only.");
  if (kind !== "peak" && kind !== "term") return fail("Unknown period.");
  if (viewer.impersonated) return fail("Not from a test view.");

  const now = new Date();
  const febYear = currentTermFebYear(now);
  const { data: prev } = await db().from("app_settings").select("value").eq("key", "lc:term").maybeSingle();
  const { data: hist } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", "lc:term-history")
    .maybeSingle();
  const history = Array.isArray(hist?.value) ? (hist!.value as LcTermState[]) : [];
  if (prev?.value) history.push(prev.value as LcTermState);

  const state: LcTermState = {
    kind,
    termLabel: termLabelOf(febYear),
    peakLabel: peakOf(now).label,
    startedAt: now.toISOString(),
    startedBy: viewer.name,
    planningPending: kind === "term" ? !!opts.planningLater : false,
    checklist: {},
  };
  await putSetting("lc:term", state);
  await putSetting("lc:term-history", history.slice(-24));

  // the incoming EB reads the handover — a bell, pointing at it
  const { data: eb } = await db()
    .from("members")
    .select("id")
    .eq("is_active", true)
    .in("role", ["LCP", "LCVP", "Director"]);
  await notifyMembers(
    (eb ?? []).map((m) => m.id as string),
    "info",
    kind === "term" ? `🧭 Term ${state.termLabel} has started` : `🧭 A new peak has started — ${state.peakLabel}`,
    "Read the handover: what to know first, your function's notes, and the links you'll need.",
    viewer.id,
    "/profile/settings?tab=handover",
    "broadcasts"
  );
  await logAudit(viewer.id, kind === "term" ? "term_start" : "peak_start", "system", null, {
    term: state.termLabel,
    peak: state.peakLabel,
    planningPending: state.planningPending,
  });
  refresh();
  return { ok: true, message: kind === "term" ? `Term ${state.termLabel} started.` : "New peak started." };
}
