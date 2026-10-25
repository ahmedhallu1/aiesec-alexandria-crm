"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/server/data";
import { db } from "@/lib/supabase";
import { logAudit } from "@/server/audit";
import { loadActivationDelta, loadActivationPlan } from "@/server/activation";
import {
  ACTIVATION_PUBLIC_PATH,
  COLUMN_TYPES,
  LIMITS,
  TABLE_VIEWS,
  daysBetween,
  newSectionId,
  isIsoDate,
  sanitizeCell,
  sectionColumns,
  type ActivationDelta,
  type ActivationPlan,
  type ActivationSection,
  type CellValue,
  type Column,
  type HeroContent,
  type Lane,
  type SectionConfig,
} from "@/lib/activation/model";
import { CORE_SECTION_IDS } from "@/lib/activation/seed";
import { canSeeActivationBid } from "@/lib/rbac";
import { ACTIVATION_TAB } from "@/lib/tabs";
import { tabAllows } from "@/server/tabs";

/** WRITES for the Activate 26' bid page (v36.7).
 *
 *  WHO: whoever the bid TAB is open to — MMs and above by code (v36.8), plus
 *  or minus whoever Settings → Tabs names (v38.3: the actions ask the same
 *  `tabAllows` as the page, so a tab shown to someone is a plan they can
 *  edit, and a tab hidden or retired closes the edits too). A visitor
 *  without a session never reaches these: `getViewer` sends them to /login,
 *  and the public page renders the board read-only. An admin's TEST VIEW may
 *  not edit, because the edit would be credited to the member being
 *  impersonated.
 *
 *  HOW: a cell edit merges ONE key into the row in a single statement
 *  (`activation_set_cells`), so two people typing in different cells of the
 *  same row never overwrite each other. Every value is checked against its
 *  column (lib/activation/model.ts `sanitizeCell`) — the client checks too,
 *  but the server is the one that has to be right. */

type Res<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTION_ID = /^[a-z0-9][a-z0-9_-]{0,48}$/;
const HEX = /^#[0-9a-f]{6}$/i;

const MM_ONLY = "The bid plan isn't open to you — the public page is open to everyone.";

/** The bid tab's rule for this person: the code's MM+ answer, with the LC's
 *  tab rule on top — exactly what the page asks. */
const mayUseBid = async (viewer: Awaited<ReturnType<typeof getViewer>>) =>
  tabAllows(viewer, ACTIVATION_TAB, canSeeActivationBid(viewer));

async function editor() {
  const viewer = await getViewer();
  if (!(await mayUseBid(viewer))) return { viewer, error: MM_ONLY };
  if (viewer.impersonated)
    return { viewer, error: "Exit the test view to edit the bid plan — the edit would be credited to someone else." };
  return { viewer, error: null as string | null };
}

/** The public page is cached for a minute; an edit refreshes it. */
function touchPublic() {
  revalidatePath(ACTIVATION_PUBLIC_PATH);
}

async function loadSection(id: string): Promise<ActivationSection | null> {
  if (!SECTION_ID.test(id)) return null;
  const { data } = await db()
    .from("activation_sections")
    .select("id, position, kind, title, subtitle, config, hidden_public, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return { ...(data as Omit<ActivationSection, "updated_by_name">), config: data.config ?? {}, updated_by_name: null };
}

function cleanPatch(
  section: ActivationSection,
  patch: Record<string, unknown>
): { ok: true; value: Record<string, CellValue> } | { ok: false; error: string } {
  if (!patch || typeof patch !== "object") return fail("Nothing to save.");
  const entries = Object.entries(patch);
  if (entries.length === 0) return fail("Nothing to save.");
  if (entries.length > 40) return fail("Too many cells at once.");
  const cols = sectionColumns(section);
  const out: Record<string, CellValue> = {};
  for (const [key, raw] of entries) {
    const col = cols.find((c) => c.key === key);
    const res = sanitizeCell(col, raw);
    if (!res.ok) return fail(col ? `${col.label}: ${res.error}` : res.error);
    out[key] = res.value;
  }
  if (section.kind === "timeline") {
    const s = out.start, e = out.end;
    if (typeof s === "string" && typeof e === "string" && s && e && e < s)
      return fail("It can't end before it starts.");
    if ("start" in out && !out.start) return fail("Starts: every item needs a start date.");
  }
  return { ok: true, value: out };
}

// ------------------------------------------------------------------ rows

export async function setActivationCells(
  rowId: string,
  patch: Record<string, unknown>
): Promise<Res<{ updated_at: string }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if (!UUID.test(rowId)) return fail("Unknown row.");
  const { data: row } = await db()
    .from("activation_rows")
    .select("id, section_id, deleted_at")
    .eq("id", rowId)
    .maybeSingle<{ id: string; section_id: string; deleted_at: string | null }>();
  if (!row || row.deleted_at) return fail("Someone else deleted that row — it's gone from the plan.");
  const section = await loadSection(row.section_id);
  if (!section) return fail("That part of the plan no longer exists.");
  const clean = cleanPatch(section, patch);
  if (!clean.ok) return clean;
  const { data, error: rpcErr } = await db().rpc("activation_set_cells", {
    p_row: rowId,
    p_patch: clean.value,
    p_member: viewer.id,
  });
  if (rpcErr) return fail(rpcErr.message);
  touchPublic();
  return { ok: true, data: { updated_at: String(data ?? new Date().toISOString()) } };
}

export async function addActivationRow(
  sectionId: string,
  row: { id: string; position: number; data: Record<string, unknown> }
): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const section = await loadSection(sectionId);
  if (!section || section.kind === "hero") return fail("That part of the plan can't hold rows.");
  if (!row || !UUID.test(row.id) || !Number.isFinite(row.position)) return fail("Couldn't add that row.");
  const { count } = await db()
    .from("activation_rows")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId)
    .is("deleted_at", null);
  if ((count ?? 0) >= LIMITS.rowsPerSection) return fail("This section is full.");
  const data: Record<string, CellValue> = {};
  if (row.data && Object.keys(row.data).length > 0) {
    const clean = cleanPatch(section, row.data);
    if (!clean.ok) return clean;
    Object.assign(data, clean.value);
  }
  const { error: insErr } = await db().from("activation_rows").insert({
    id: row.id,
    section_id: sectionId,
    position: row.position,
    data,
    updated_by: viewer.id,
  });
  if (insErr) return fail(insErr.message);
  touchPublic();
  return { ok: true };
}

/** A pasted block from Google Sheets: updates to existing rows + new rows,
 *  in one go. Each cell is still checked against its column. */
export async function pasteActivationCells(
  sectionId: string,
  updates: { rowId: string; patch: Record<string, unknown> }[],
  newRows: { id: string; position: number; data: Record<string, unknown> }[]
): Promise<Res<{ applied: number }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const section = await loadSection(sectionId);
  if (!section || section.kind === "hero") return fail("You can't paste here.");
  const cells =
    (updates ?? []).reduce((n, u) => n + Object.keys(u.patch ?? {}).length, 0) +
    (newRows ?? []).reduce((n, r) => n + Object.keys(r.data ?? {}).length, 0);
  if (cells > LIMITS.pasteCells) return fail(`That's ${cells} cells — paste at most ${LIMITS.pasteCells} at a time.`);

  const ids = (updates ?? []).map((u) => u.rowId).filter((id) => UUID.test(id));
  const { data: owned } = ids.length
    ? await db().from("activation_rows").select("id").eq("section_id", sectionId).is("deleted_at", null).in("id", ids)
    : { data: [] as { id: string }[] };
  const ownedIds = new Set((owned ?? []).map((r: { id: string }) => r.id));

  let applied = 0;
  for (const u of updates ?? []) {
    if (!ownedIds.has(u.rowId)) continue;
    const clean = cleanPatch(section, u.patch);
    if (!clean.ok) return fail(clean.error);
    const { error: rpcErr } = await db().rpc("activation_set_cells", {
      p_row: u.rowId,
      p_patch: clean.value,
      p_member: viewer.id,
    });
    if (rpcErr) return fail(rpcErr.message);
    applied += Object.keys(clean.value).length;
  }
  if (newRows?.length) {
    const inserts = [];
    for (const r of newRows) {
      if (!UUID.test(r.id) || !Number.isFinite(r.position)) return fail("Couldn't add the pasted rows.");
      const clean = Object.keys(r.data ?? {}).length ? cleanPatch(section, r.data) : { ok: true as const, value: {} };
      if (!clean.ok) return fail(clean.error);
      inserts.push({ id: r.id, section_id: sectionId, position: r.position, data: clean.value, updated_by: viewer.id });
      applied += Object.keys(clean.value).length;
    }
    const { error: insErr } = await db().from("activation_rows").insert(inserts);
    if (insErr) return fail(insErr.message);
  }
  await logAudit(viewer.id, "activation_paste", "activation", null, {
    section: sectionId,
    cells: applied,
    new_rows: newRows?.length ?? 0,
  });
  touchPublic();
  return { ok: true, data: { applied } };
}

async function setDeleted(rowId: string, deleted: boolean): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if (!UUID.test(rowId)) return fail("Unknown row.");
  const now = new Date().toISOString();
  const { data, error: upErr } = await db()
    .from("activation_rows")
    .update({ deleted_at: deleted ? now : null, updated_at: now, updated_by: viewer.id })
    .eq("id", rowId)
    .select("id, section_id");
  if (upErr) return fail(upErr.message);
  if (!data?.length) return fail("That row no longer exists.");
  await logAudit(viewer.id, deleted ? "activation_row_delete" : "activation_row_restore", "activation", null, {
    section: data[0].section_id,
    row: rowId,
  });
  touchPublic();
  return { ok: true };
}

export async function deleteActivationRow(rowId: string): Promise<Res> {
  return setDeleted(rowId, true);
}
export async function restoreActivationRow(rowId: string): Promise<Res> {
  return setDeleted(rowId, false);
}

/** Several rows at once (v36.8) — the sheet's row selection. Soft-deleted
 *  like a single row, so a restore brings every one of them back. */
export async function deleteActivationRows(rowIds: string[], restore = false): Promise<Res<{ count: number }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const ids = [...new Set((rowIds ?? []).filter((id) => UUID.test(id)))];
  if (ids.length === 0) return fail("Pick the rows first.");
  if (ids.length > 500) return fail("At most 500 rows at a time.");
  const now = new Date().toISOString();
  const { data, error: upErr } = await db()
    .from("activation_rows")
    .update({ deleted_at: restore ? null : now, updated_at: now, updated_by: viewer.id })
    .in("id", ids)
    .select("id, section_id");
  if (upErr) return fail(upErr.message);
  await logAudit(viewer.id, restore ? "activation_rows_restore" : "activation_rows_delete", "activation", null, {
    section: data?.[0]?.section_id ?? null,
    rows: data?.length ?? 0,
  });
  touchPublic();
  return { ok: true, data: { count: data?.length ?? 0 } };
}

export async function moveActivationRow(rowId: string, position: number): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if (!UUID.test(rowId) || !Number.isFinite(position)) return fail("Couldn't move that row.");
  const { error: upErr } = await db()
    .from("activation_rows")
    .update({ position, updated_at: new Date().toISOString(), updated_by: viewer.id })
    .eq("id", rowId)
    .is("deleted_at", null);
  if (upErr) return fail(upErr.message);
  touchPublic();
  return { ok: true };
}

// ------------------------------------------------------------------ sections

function cleanColumns(cols: unknown): { ok: true; value: Column[] } | { ok: false; error: string } {
  if (!Array.isArray(cols)) return fail("Columns are missing.");
  if (cols.length === 0) return fail("Keep at least one column.");
  if (cols.length > LIMITS.columns) return fail(`At most ${LIMITS.columns} columns.`);
  const seen = new Set<string>();
  const out: Column[] = [];
  for (const c of cols as Column[]) {
    const key = String(c?.key ?? "");
    if (!/^[a-z0-9_]{1,48}$/.test(key) || seen.has(key)) return fail("A column key is invalid or repeated.");
    seen.add(key);
    const label = String(c.label ?? "").trim().slice(0, 60);
    if (!label) return fail("Every column needs a name.");
    if (!(COLUMN_TYPES as readonly string[]).includes(c.type)) return fail(`"${label}" has an unknown type.`);
    const col: Column = { key, label, type: c.type };
    if (c.type === "select") {
      const opts = (Array.isArray(c.options) ? c.options : [])
        .map((o) => String(o).trim().slice(0, LIMITS.select))
        .filter(Boolean);
      col.options = [...new Set(opts)].slice(0, 60);
      if (c.labels && typeof c.labels === "object") col.labels = c.labels;
    }
    if (c.hidden) col.hidden = true;
    out.push(col);
  }
  return { ok: true, value: out };
}

function cleanLanes(lanes: unknown): { ok: true; value: Lane[] } | { ok: false; error: string } {
  if (!Array.isArray(lanes) || lanes.length === 0) return fail("Keep at least one team lane.");
  if (lanes.length > LIMITS.lanes) return fail(`At most ${LIMITS.lanes} lanes.`);
  const seen = new Set<string>();
  const out: Lane[] = [];
  for (const l of lanes as Lane[]) {
    const key = String(l?.key ?? "");
    if (!/^[a-z0-9_]{1,40}$/.test(key) || seen.has(key)) return fail("A lane key is invalid or repeated.");
    seen.add(key);
    const label = String(l.label ?? "").trim().slice(0, 40);
    if (!label) return fail("Every lane needs a name.");
    if (!HEX.test(String(l.color))) return fail(`"${label}" needs a colour like #e63946.`);
    out.push({ key, label, color: String(l.color) });
  }
  return { ok: true, value: out };
}

function cleanHero(h: unknown): { ok: true; value: HeroContent } | { ok: false; error: string } {
  const x = (h ?? {}) as Partial<HeroContent>;
  const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
  if (!isIsoDate(x.bidDay) || !isIsoDate(x.day0)) return fail("The bid day and Day 0 need real dates.");
  if (x.day0 < x.bidDay) return fail("Day 0 can't come before the bid result.");
  const showDays = Number(x.showDays);
  if (!Number.isInteger(showDays) || showDays < 1 || showDays > 10) return fail("The show lasts 1–10 days.");
  return {
    ok: true,
    value: {
      eyebrow: str(x.eyebrow, 120),
      title: str(x.title, LIMITS.title) || "Activate 26'",
      tagline: str(x.tagline, 300),
      intro: str(x.intro, 2000),
      bidDay: x.bidDay,
      day0: x.day0,
      showDays,
      venue: str(x.venue, 160),
    },
  };
}

export async function updateActivationSection(
  sectionId: string,
  patch: { title?: string; subtitle?: string; hidden_public?: boolean; config?: Partial<SectionConfig> }
): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const section = await loadSection(sectionId);
  if (!section) return fail("That part of the plan no longer exists.");
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = String(patch.title).trim().slice(0, LIMITS.title);
    if (!t) return fail("A section needs a title.");
    update.title = t;
  }
  if (patch.subtitle !== undefined) update.subtitle = String(patch.subtitle).slice(0, LIMITS.subtitle);
  if (patch.hidden_public !== undefined) update.hidden_public = !!patch.hidden_public;

  if (patch.config) {
    const c = patch.config;
    const next: SectionConfig = { ...section.config };
    if (c.act !== undefined) next.act = String(c.act).slice(0, 30);
    if (c.emoji !== undefined) next.emoji = String(c.emoji).slice(0, 8);
    if (c.view !== undefined) {
      if (!(TABLE_VIEWS as readonly string[]).includes(c.view)) return fail("Unknown view.");
      next.view = c.view;
    }
    if (c.columns !== undefined) {
      if (section.kind !== "table") return fail("Only tables have editable columns.");
      const cols = cleanColumns(c.columns);
      if (!cols.ok) return cols;
      next.columns = cols.value;
    }
    if (c.lanes !== undefined) {
      if (section.kind !== "timeline") return fail("Only the timeline has lanes.");
      const lanes = cleanLanes(c.lanes);
      if (!lanes.ok) return lanes;
      // a lane that still has items can't vanish — they would have nowhere to go
      const keep = new Set(lanes.value.map((l) => l.key));
      const { data: used } = await db()
        .from("activation_rows")
        .select("data")
        .eq("section_id", sectionId)
        .is("deleted_at", null);
      const orphan = (used ?? []).find(
        (r: { data: Record<string, CellValue> | null }) => r.data?.lane && !keep.has(String(r.data.lane))
      );
      if (orphan) return fail("That lane still has items — move them to another team first.");
      next.lanes = lanes.value;
    }
    if (c.start !== undefined || c.end !== undefined) {
      const start = c.start ?? section.config.start;
      const end = c.end ?? section.config.end;
      if (!isIsoDate(start) || !isIsoDate(end)) return fail("The timeline needs real start and end dates.");
      if (end < start) return fail("The timeline can't end before it starts.");
      if (daysBetween(start, end) > 400) return fail("Keep the timeline under 400 days.");
      next.start = start;
      next.end = end;
    }
    if (c.hero !== undefined) {
      const hero = cleanHero(c.hero);
      if (!hero.ok) return hero;
      next.hero = hero.value;
    }
    if (c.capacity !== undefined) {
      const n = Number(c.capacity);
      if (!Number.isInteger(n) || n < 0 || n > 100000) return fail("Capacity is a whole number.");
      next.capacity = n;
    }
    if (c.dayNotes !== undefined) {
      next.dayNotes = Object.fromEntries(
        Object.entries(c.dayNotes ?? {})
          .slice(0, 12)
          .map(([k, v]) => [String(k).slice(0, 20), String(v).slice(0, 200)])
      );
    }
    if (c.namesPublic !== undefined) next.namesPublic = !!c.namesPublic;
    if (c.listTitle !== undefined) next.listTitle = String(c.listTitle).trim().slice(0, 60) || "Mapping";
    update.config = next;
  }
  if (Object.keys(update).length === 0) return { ok: true };
  update.updated_at = new Date().toISOString();
  update.updated_by = viewer.id;
  const { error: upErr } = await db().from("activation_sections").update(update).eq("id", sectionId);
  if (upErr) return fail(upErr.message);
  await logAudit(viewer.id, "activation_section_update", "activation", null, {
    section: sectionId,
    fields: Object.keys(patch),
  });
  touchPublic();
  return { ok: true };
}

export async function addActivationSection(title: string): Promise<Res<{ id: string }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const t = String(title ?? "").trim().slice(0, LIMITS.title);
  if (!t) return fail("Give the new section a title.");
  const { data: all, error: readErr } = await db().from("activation_sections").select("id, position");
  if (readErr) return fail(readErr.message);
  const list = (all ?? []) as { id: string; position: number }[];
  const id = newSectionId(t, list.map((s) => s.id));
  const position = Math.max(0, ...list.map((s) => s.position)) + 1;
  const { error: insErr } = await db().from("activation_sections").insert({
    id,
    position,
    kind: "table",
    title: t,
    subtitle: "",
    config: {
      act: "Encore",
      emoji: "✨",
      view: "plain",
      columns: [
        { key: "item", label: "Item", type: "text" },
        { key: "owner", label: "Owner", type: "text" },
        { key: "notes", label: "Notes", type: "longtext" },
      ],
    },
    updated_by: viewer.id,
  });
  if (insErr) return fail(insErr.message);
  await logAudit(viewer.id, "activation_section_add", "activation", null, { section: id, title: t });
  touchPublic();
  return { ok: true, data: { id } };
}

export async function deleteActivationSection(sectionId: string): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if ((CORE_SECTION_IDS as readonly string[]).includes(sectionId))
    return fail("This is part of the original plan — hide it from the public page instead of deleting it.");
  const section = await loadSection(sectionId);
  if (!section) return fail("That section no longer exists.");
  const { error: delErr } = await db().from("activation_sections").delete().eq("id", sectionId);
  if (delErr) return fail(delErr.message);
  await logAudit(viewer.id, "activation_section_delete", "activation", null, {
    section: sectionId,
    title: section.title,
  });
  touchPublic();
  return { ok: true };
}

export async function moveActivationSection(sectionId: string, direction: -1 | 1): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const { data } = await db().from("activation_sections").select("id, position, kind").order("position");
  const list = ((data ?? []) as { id: string; position: number; kind: string }[]).filter((s) => s.kind !== "hero");
  const i = list.findIndex((s) => s.id === sectionId);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= list.length) return { ok: true };
  const now = new Date().toISOString();
  const [a, b] = [list[i], list[j]];
  const r1 = await db().from("activation_sections").update({ position: b.position, updated_at: now, updated_by: viewer.id }).eq("id", a.id);
  const r2 = await db().from("activation_sections").update({ position: a.position, updated_at: now, updated_by: viewer.id }).eq("id", b.id);
  if (r1.error || r2.error) return fail((r1.error ?? r2.error)!.message);
  touchPublic();
  return { ok: true };
}

// ------------------------------------------------------------------ reads

/** What changed since the board's last sync — polled while someone edits. */
export async function getActivationDelta(since: string): Promise<Res<ActivationDelta>> {
  const viewer = await getViewer();
  if (!(await mayUseBid(viewer))) return fail(MM_ONLY);
  if (typeof since !== "string" || Number.isNaN(Date.parse(since))) return fail("Bad cursor.");
  try {
    return { ok: true, data: await loadActivationDelta(since) };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't refresh.");
  }
}

/** The whole plan again — the recovery path after a save was refused. */
export async function getActivationPlan(): Promise<Res<ActivationPlan>> {
  const viewer = await getViewer();
  if (!(await mayUseBid(viewer))) return fail(MM_ONLY);
  try {
    return { ok: true, data: await loadActivationPlan({ publicView: false }) };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't load the plan.");
  }
}
