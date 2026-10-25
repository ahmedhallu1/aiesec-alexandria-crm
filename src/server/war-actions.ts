"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/server/data";
import { db } from "@/lib/supabase";
import { logAudit, diffFields } from "@/server/audit";
import { canSeeWarRoom } from "@/lib/rbac";
import { bustTabRules, publicPageLive, tabAllows } from "@/server/tabs";
import { broadcast } from "@/server/realtime";
import { warSnapshot, loadWarSettings } from "@/server/war";
import {
  BONUS, LIMITS, WAR_PUBLIC_PATH, WAR_ROOM_PATH, WAR_SLUG, inWarWindow, isIsoDate, resolveWarSettings,
  warSettingsProblem, type WarSettings,
} from "@/lib/war/model";
import { cairoToday } from "@/lib/types";

/** WRITES for the No Peace war (v38).
 *
 *  WHO: whoever the War Room tab is open to — the F&L VP, the LCP and the
 *  admins by code (`canSeeWarRoom`), plus anyone the LCP/admins add from
 *  Settings → Tabs (the same `tabAllows` the page uses, so the tab and the
 *  right to edit can never disagree). Never from a test view: the entry would
 *  be credited to the impersonated member.
 *
 *  EVERY write ends in `publish()`: the new public snapshot is broadcast to
 *  every open /no-peace page, which is what makes the numbers move "instantly"
 *  — unless the public page is switched off, when nothing is pushed. */

type Res<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function editor() {
  const viewer = await getViewer();
  if (!(await tabAllows(viewer, WAR_ROOM_PATH, canSeeWarRoom(viewer))))
    return { viewer, error: "The War Room is open to the F&L VP and whoever the LC adds in Settings → Tabs." };
  if (viewer.impersonated)
    return { viewer, error: "Exit the test view to log points — they'd be credited to someone else." };
  return { viewer, error: null as string | null };
}

async function publish() {
  revalidatePath(WAR_ROOM_PATH);
  revalidatePath(WAR_PUBLIC_PATH);
  try {
    // a fresh read of the rules (not this instance's 30 s memo): a board taken
    // down a moment ago must not keep receiving the standings
    bustTabRules();
    if (!(await publicPageLive(WAR_ROOM_PATH))) return;
    broadcast(WAR_SLUG, "snapshot", await warSnapshot());
  } catch (e) {
    console.error("[war] snapshot for broadcast failed:", e instanceof Error ? e.message : e);
  }
}

export interface LogInput {
  memberIds: string[];
  kind: string;
  qty?: number;
  points?: number;
  note?: string;
  occurredOn?: string;
}

/** Log one achievement (or a bonus) for one or many people at once — the
 *  checkpoint case: "+5 attendance" for twenty people in one go. */
export async function logWarEntries(input: LogInput): Promise<Res<{ count: number; ids: string[] }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const { settings } = await loadWarSettings();
  const ids = [...new Set((input.memberIds ?? []).filter((x) => UUID.test(x)))];
  if (ids.length === 0) return fail("Pick at least one person.");
  if (ids.length > LIMITS.batch) return fail(`At most ${LIMITS.batch} people at once.`);

  const isBonus = input.kind === BONUS;
  if (!isBonus && !settings.pointTypes.some((t) => t.key === input.kind)) return fail("Pick what they achieved.");
  const qty = Math.round(Number(input.qty ?? 1));
  if (!isBonus && (!Number.isFinite(qty) || qty < 1 || qty > LIMITS.qty)) return fail(`Quantity must be 1–${LIMITS.qty}.`);
  const points = Math.round(Number(input.points));
  if (isBonus && (!Number.isFinite(points) || points === 0 || Math.abs(points) > LIMITS.bonus))
    return fail(`Bonus points must be between -${LIMITS.bonus} and ${LIMITS.bonus}, and not 0.`);
  const note = (input.note ?? "").trim().slice(0, LIMITS.note) || null;
  const day = input.occurredOn || cairoToday();
  if (!isIsoDate(day)) return fail("The date isn't valid.");
  if (!inWarWindow(day, settings)) return fail("That date is outside the war.");

  // only people who exist — the FK would refuse anyway, this says it nicely
  const { data: found } = await db().from("members").select("id").in("id", ids);
  if ((found ?? []).length !== ids.length) return fail("Someone in the list isn't a member any more.");

  const rows = ids.map((member_id) => ({
    campaign: WAR_SLUG,
    member_id,
    kind: input.kind,
    qty: isBonus ? 1 : qty,
    points: isBonus ? points : null,
    note,
    occurred_on: day,
    created_by: viewer.id,
  }));
  const { data: made, error: dbError } = await db().from("war_entries").insert(rows).select("id");
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "war_log", "war_entries", null, {
    kind: input.kind, qty: isBonus ? 1 : qty, points: isBonus ? points : null, people: ids.length, note,
  });
  await publish();
  return { ok: true, data: { count: ids.length, ids: (made ?? []).map((m) => m.id as string) } };
}

/** Fix an entry in place: quantity, bonus points, comment, date. */
export async function updateWarEntry(
  id: string,
  patch: { qty?: number; points?: number; note?: string | null; occurredOn?: string }
): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if (!UUID.test(id)) return fail("Unknown entry.");
  const { data: cur } = await db()
    .from("war_entries")
    .select("kind, member_id, qty, points, note, occurred_on")
    .eq("id", id)
    .eq("campaign", WAR_SLUG)
    .maybeSingle();
  if (!cur) return fail("That entry is gone.");
  const upd: Record<string, unknown> = {};
  if (patch.qty !== undefined && cur.kind !== BONUS) {
    const q = Math.round(Number(patch.qty));
    if (!Number.isFinite(q) || q < 1 || q > LIMITS.qty) return fail(`Quantity must be 1–${LIMITS.qty}.`);
    upd.qty = q;
  }
  if (patch.points !== undefined && cur.kind === BONUS) {
    const p = Math.round(Number(patch.points));
    if (!Number.isFinite(p) || p === 0 || Math.abs(p) > LIMITS.bonus) return fail("Bonus points can't be 0 or that large.");
    upd.points = p;
  }
  if (patch.note !== undefined) upd.note = (patch.note ?? "").trim().slice(0, LIMITS.note) || null;
  if (patch.occurredOn !== undefined) {
    if (!isIsoDate(patch.occurredOn)) return fail("The date isn't valid.");
    // the same window as logging — but only for a date that actually moves,
    // so fixing a typo on an old entry never trips over a changed war window
    if (patch.occurredOn !== cur.occurred_on) {
      const { settings } = await loadWarSettings();
      if (!inWarWindow(patch.occurredOn, settings)) return fail("That date is outside the war.");
    }
    upd.occurred_on = patch.occurredOn;
  }
  if (Object.keys(upd).length === 0) return fail("Nothing to change.");
  const { error: dbError } = await db().from("war_entries").update(upd).eq("id", id);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "war_entry_edit", "war_entries", id, { ...upd, member_id: cur.member_id }, {
    changed: diffFields(cur as Record<string, unknown>, upd),
  });
  await publish();
  return { ok: true };
}

/** Delete (soft — Undo brings it back) one or many entries. */
export async function deleteWarEntries(ids: string[]): Promise<Res<{ count: number }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const clean = [...new Set((ids ?? []).filter((x) => UUID.test(x)))].slice(0, 500);
  if (clean.length === 0) return fail("Nothing selected.");
  const { error: dbError } = await db()
    .from("war_entries")
    .update({ deleted_at: new Date().toISOString(), deleted_by: viewer.id })
    .in("id", clean)
    .eq("campaign", WAR_SLUG)
    .is("deleted_at", null);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "war_entry_delete", "war_entries", null, { ids: clean });
  await publish();
  return { ok: true, data: { count: clean.length } };
}

export async function restoreWarEntries(ids: string[]): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const clean = [...new Set((ids ?? []).filter((x) => UUID.test(x)))].slice(0, 500);
  if (clean.length === 0) return fail("Nothing selected.");
  // an entry whose type was removed meanwhile would come back scoring 0 and
  // then block every point-table save — refuse it, by name
  const [{ settings }, { data: kinds, error: readError }] = await Promise.all([
    loadWarSettings(),
    db().from("war_entries").select("kind").in("id", clean).eq("campaign", WAR_SLUG),
  ]);
  if (readError) return fail("Couldn't check those entries — try again.");
  const valid = new Set([BONUS, ...settings.pointTypes.map((t) => t.key)]);
  const stale = [...new Set((kinds ?? []).map((k) => k.kind as string).filter((k) => !valid.has(k)))];
  if (stale.length)
    return fail(`Can't restore entries of a removed point type (${stale.join(", ")}). Add the type back first.`);
  const { error: dbError } = await db()
    .from("war_entries")
    .update({ deleted_at: null, deleted_by: null })
    .in("id", clean)
    .eq("campaign", WAR_SLUG);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "war_entry_restore", "war_entries", null, { ids: clean });
  await publish();
  return { ok: true };
}

/** Save the campaign's settings — the point table, rewards, rules, dates,
 *  who competes, what the page shows. Merged over the stored value and
 *  resolved, so a form only ever changes what it sends. A point type that
 *  still has entries can't be removed (its entries would silently score 0).
 *
 *  Returns the settings AS STORED, so the form can show what the server
 *  actually kept (trimmed text, normalised keys, the name lists de-duplicated). */
export async function saveWarSettings(patch: Record<string, unknown>): Promise<Res<{ settings: WarSettings }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return fail("Nothing to save.");
  const { data: row, error: readError } = await db()
    .from("war_campaigns")
    .select("name, settings")
    .eq("slug", WAR_SLUG)
    .maybeSingle();
  // a failed read would merge the patch over NOTHING and reset every other
  // setting to its default — refuse instead
  if (readError) return fail("Couldn't read the current settings — try again.");
  const stored = row?.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>) : {};
  const problem = warSettingsProblem(patch, stored);
  if (problem) return fail(problem);
  const merged = resolveWarSettings({ ...stored, ...patch }, row?.name);
  if ("pointTypes" in patch) {
    // only the keys THIS save removes — an orphan left by an earlier removal
    // (or a restore) must not block every later save of the table
    const before = new Map(resolveWarSettings(stored, row?.name).pointTypes.map((t) => [t.key, t.label]));
    const after = new Set(merged.pointTypes.map((t) => t.key));
    const removed = [...before.keys()].filter((k) => !after.has(k));
    if (removed.length) {
      // keys are [a-z0-9_] by construction, safe inside the in-list
      const { data: orphans, error: orphanError } = await db()
        .from("war_entries")
        .select("kind")
        .eq("campaign", WAR_SLUG)
        .is("deleted_at", null)
        .in("kind", removed)
        .limit(50);
      // fail CLOSED: a removal we couldn't check could zero someone's points
      if (orphanError) return fail("Couldn't check entries — try again.");
      const gone = [...new Set((orphans ?? []).map((o) => before.get(o.kind as string) ?? (o.kind as string)))];
      if (gone.length) return fail(`Can't remove a type that already has points logged (${gone.join(", ")}). Set its points instead, or delete its entries first.`);
    }
  }
  const { error: dbError } = await db()
    .from("war_campaigns")
    .upsert(
      { slug: WAR_SLUG, name: merged.name, settings: merged, updated_by: viewer.id, updated_at: new Date().toISOString() },
      { onConflict: "slug" }
    );
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "war_settings", "war_campaigns", null, { keys: Object.keys(patch) });
  await publish();
  return { ok: true, data: { settings: merged } };
}
