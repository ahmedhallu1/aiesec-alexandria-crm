"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { getViewer } from "@/server/data";
import { db } from "@/lib/supabase";
import { logAudit } from "@/server/audit";
import { canSeeLcRace } from "@/lib/rbac";
import { tabAllows } from "@/server/tabs";
import { clientIp, underHourlyLimit } from "@/server/rate-limit";
import { loadRaceSettings, observeCore, publishRace, rivalTokenOk } from "@/server/race";
import { coreLcApproved } from "@/lib/core-analytics";
import { cairoToday } from "@/lib/types";
import { isIsoDate } from "@/lib/war/model";
import {
  RACE_EDITOR_PATH, RACE_LIMITS, RACE_PUBLIC_PATH, RACE_SLUG, RIVAL_GRACE_MS, raceClock, raceSettingsProblem,
  resolveRaceSettings,
  type CoreReading, type ProgramCounts, type RaceSettings, type Side,
} from "@/lib/race/model";

/** WRITES for Alex vs MUST (v38.5).
 *
 *  THE EDITOR (/lc-race): whoever the tab is open to — the EB and the admins
 *  by code (`canSeeLcRace`), plus anyone the LCP/admins add in Settings → Tabs
 *  (the same `tabAllows` the page asks). Never from a test view.
 *
 *  MUST'S DESK (/alex-vs-must/must/<token>): no login. Every call carries the
 *  token and is checked against the stored one in constant time, then
 *  throttled per network. It can add MUST's slots and take back what it added
 *  — nothing else, never Alexandria's side and never an editor's entry.
 *
 *  Every write re-renders both pages and pushes the board live. */

type Res<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isSide = (v: unknown): v is Side => v === "home" || v === "rival";

async function editor() {
  const viewer = await getViewer();
  if (!(await tabAllows(viewer, RACE_EDITOR_PATH, canSeeLcRace(viewer))))
    return { viewer, error: "Alex vs MUST is managed by the EB and whoever the LC adds in Settings → Tabs." };
  if (viewer.impersonated) return { viewer, error: "Exit the test view first — this would be done as someone else." };
  return { viewer, error: null as string | null };
}

function changed(opts: { alsoWar?: boolean } = {}) {
  revalidatePath(RACE_EDITOR_PATH);
  revalidatePath(RACE_PUBLIC_PATH);
  publishRace(opts);
}

async function writeSettings(viewer: { id: string }, patch: Record<string, unknown>): Promise<Res<{ settings: RaceSettings }>> {
  const { stored, ok } = await loadRaceSettings();
  // a failed read would merge the patch over NOTHING and reset the rest
  if (!ok) return fail("Couldn't read the current settings — try again.");
  const problem = raceSettingsProblem(patch, stored ?? {});
  if (problem) return fail(problem);
  const merged = resolveRaceSettings({ ...(stored ?? {}), ...patch });
  const { error } = await db()
    .from("war_campaigns")
    .upsert(
      { slug: RACE_SLUG, name: "Alex vs MUST", settings: merged, updated_by: viewer.id, updated_at: new Date().toISOString() },
      { onConflict: "slug" }
    );
  if (error) return fail(error.message);
  return { ok: true, data: { settings: merged } };
}

/** Save any part of the settings — goals, dates, names, colours, start
 *  counts, what the page shows. The link itself has its own action. */
export async function saveRaceSettings(patch: Record<string, unknown>): Promise<Res<{ settings: RaceSettings }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return fail("Nothing to save.");
  const { rivalToken: _t, ...clean } = patch;
  void _t;
  const res = await writeSettings(viewer, clean);
  if (!res.ok) return res;
  await logAudit(viewer.id, "race_settings", "war_campaigns", null, { keys: Object.keys(clean) });
  // a moved baseline moves Alexandria's APD count on the No Peace board too
  changed({ alsoWar: "home" in clean || "startDate" in clean || "deadlineDate" in clean || "deadlineTime" in clean });
  return res;
}

/** Make (or remake) MUST's private link. A remade link kills the old one at
 *  once — the way to shut out a link that went too far. */
export async function renewRivalLink(): Promise<Res<{ token: string }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const token = randomBytes(24).toString("base64url");
  const res = await writeSettings(viewer, { rivalToken: token });
  if (!res.ok) return res;
  await logAudit(viewer.id, "race_link_renewed", "war_campaigns", null, {});
  revalidatePath(RACE_EDITOR_PATH);
  return { ok: true, data: { token } };
}

/** Read both LCs on CORE right now (no cache) and store whatever moved. */
export async function readCoreNow(): Promise<Res<{ core: Record<Side, CoreReading | null>; changed: boolean }>> {
  const { error } = await editor();
  if (error) return fail(error);
  const o = await observeCore({ fresh: true });
  revalidatePath(RACE_EDITOR_PATH);
  revalidatePath(RACE_PUBLIC_PATH);
  if (!o.core.home && !o.core.rival) return fail("CORE didn't answer (or both LCs are switched off) — try again in a minute.");
  return { ok: true, data: o };
}

/** Restart the count: today's CORE numbers become the start counts. */
export async function takeCoreBaseline(sides: Side[]): Promise<Res<{ settings: RaceSettings }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const which = [...new Set((sides ?? []).filter(isSide))];
  if (which.length === 0) return fail("Pick an LC.");
  const { settings } = await loadRaceSettings();
  const patch: Record<string, unknown> = {};
  for (const side of which) {
    const got = await coreLcApproved(settings[side].coreId, { fresh: true });
    if (!got) return fail(`CORE didn't answer for ${settings[side].name} — try again in a minute.`);
    patch[side] = { ...settings[side], baseline: got.programs };
  }
  const res = await writeSettings(viewer, patch);
  if (!res.ok) return res;
  await logAudit(viewer.id, "race_baseline", "war_campaigns", null, { sides: which });
  changed({ alsoWar: which.includes("home") });
  return res;
}

/** A reading typed by hand — for when CORE is wrong or down. It stands until
 *  CORE's own number changes again (switch CORE off for that LC to keep it). */
export async function addRaceReading(side: Side, total: number): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if (!isSide(side)) return fail("Pick an LC.");
  const n = Math.round(Number(total));
  if (!Number.isFinite(n) || n < 0 || n > RACE_LIMITS.baseline) return fail("The total must be a whole number (0 or more).");
  const { settings } = await loadRaceSettings();
  if (Date.now() > raceClock(settings).deadline) return fail("The race is over — readings after the deadline don't count.");
  // the programs stay as the last reading had them, so the breakdown doesn't jump to zero
  const { data: last } = await db()
    .from("race_readings")
    .select("programs")
    .eq("campaign", RACE_SLUG)
    .eq("side", side)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle<{ programs: Partial<ProgramCounts> }>();
  const programs: ProgramCounts = { ...settings[side].baseline, ...(last?.programs ?? {}) };
  const { error: dbError } = await db()
    .from("race_readings")
    .insert({ campaign: RACE_SLUG, side, total: n, programs, source: "manual", created_by: viewer.id });
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "race_reading", "race_readings", null, { side, total: n });
  changed({ alsoWar: side === "home" });
  return { ok: true };
}

/** Remove a wrong reading (by hand or from CORE). */
export async function deleteRaceReading(id: string): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if (!UUID.test(id)) return fail("Unknown reading.");
  const { data: row } = await db().from("race_readings").select("side, total, source").eq("id", id).eq("campaign", RACE_SLUG).maybeSingle();
  if (!row) return fail("That reading is already gone.");
  const { error: dbError } = await db().from("race_readings").delete().eq("id", id);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "race_reading_delete", "race_readings", id, row as Record<string, unknown>);
  changed({ alsoWar: (row as { side: string }).side === "home" });
  return { ok: true };
}

function entryProblem(s: RaceSettings, qty: number, day: string): string | null {
  if (!Number.isInteger(qty) || qty < 1 || qty > RACE_LIMITS.qty) return `Slots must be a whole number from 1 to ${RACE_LIMITS.qty}.`;
  if (!isIsoDate(day)) return "The date isn't valid.";
  if (day < s.startDate) return "That date is before the race started.";
  if (day > s.deadlineDate) return "That date is after the deadline.";
  if (day > cairoToday()) return "That date is in the future.";
  return null;
}

/** The editor adds slots for either LC (Alexandria's raised outside Sodio, or
 *  MUST's on their behalf). */
export async function addRaceEntry(input: { side: Side; qty: number; note?: string; occurredOn?: string }): Promise<Res> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  if (!isSide(input.side)) return fail("Pick an LC.");
  const { settings } = await loadRaceSettings();
  const qty = Math.round(Number(input.qty));
  const day = input.occurredOn || cairoToday();
  const problem = entryProblem(settings, qty, day);
  if (problem) return fail(problem);
  const note = (input.note ?? "").trim().slice(0, RACE_LIMITS.note) || null;
  const { error: dbError } = await db()
    .from("race_entries")
    .insert({ campaign: RACE_SLUG, side: input.side, qty, note, occurred_on: day, source: "editor", created_by: viewer.id });
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "race_entry", "race_entries", null, { side: input.side, qty, note });
  changed();
  return { ok: true };
}

export async function setRaceEntriesDeleted(ids: string[], deleted: boolean): Promise<Res<{ count: number }>> {
  const { viewer, error } = await editor();
  if (error) return fail(error);
  const clean = [...new Set((ids ?? []).filter((x) => UUID.test(x)))].slice(0, 500);
  if (clean.length === 0) return fail("Nothing picked.");
  const { error: dbError } = await db()
    .from("race_entries")
    .update(deleted ? { deleted_at: new Date().toISOString(), deleted_by: viewer.id } : { deleted_at: null, deleted_by: null })
    .eq("campaign", RACE_SLUG)
    .in("id", clean);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, deleted ? "race_entry_delete" : "race_entry_restore", "race_entries", null, { ids: clean });
  changed();
  return { ok: true, data: { count: clean.length } };
}

// ------------------------------------------------------------------ MUST's desk (no login)

async function desk(token: string): Promise<{ settings: RaceSettings; error: string | null }> {
  const { ok, settings } = await rivalTokenOk(token);
  if (!ok) return { settings, error: "This link isn't valid any more — ask Alexandria for the new one." };
  if (!(await underHourlyLimit("racerl", await clientIp(), 80)))
    return { settings, error: "That's a lot of changes in one hour — try again a little later." };
  return { settings, error: null };
}

/** MUST logs its own slots. */
export async function logRivalSlots(token: string, input: { qty: number; note?: string; occurredOn?: string }): Promise<Res> {
  const { settings, error } = await desk(token);
  if (error) return fail(error);
  if (!settings.rivalCanLog) return fail("Logging is paused for now — ask Alexandria.");
  if (Date.now() > raceClock(settings).deadline + RIVAL_GRACE_MS) return fail("The race is over — the board is final.");
  const qty = Math.round(Number(input?.qty));
  const day = input?.occurredOn || cairoToday();
  const problem = entryProblem(settings, qty, day);
  if (problem) return fail(problem);
  const note = (input?.note ?? "").trim().slice(0, RACE_LIMITS.note) || null;
  const { error: dbError } = await db()
    .from("race_entries")
    .insert({ campaign: RACE_SLUG, side: "rival", qty, note, occurred_on: day, source: "link" });
  if (dbError) return fail("Couldn't save — try again.");
  revalidatePath(RACE_EDITOR_PATH);
  revalidatePath(RACE_PUBLIC_PATH);
  publishRace();
  return { ok: true };
}

/** MUST takes back one of ITS OWN entries (logged through the link). */
export async function removeRivalEntry(token: string, id: string): Promise<Res> {
  const { settings, error } = await desk(token);
  if (error) return fail(error);
  if (Date.now() > raceClock(settings).deadline + RIVAL_GRACE_MS) return fail("The race is over — the board is final.");
  if (!UUID.test(id)) return fail("Unknown entry.");
  const { data, error: dbError } = await db()
    .from("race_entries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("campaign", RACE_SLUG)
    .eq("id", id)
    .eq("side", "rival")
    .eq("source", "link")
    .is("deleted_at", null)
    .select("id");
  if (dbError) return fail("Couldn't remove it — try again.");
  if ((data ?? []).length === 0) return fail("That entry is already gone (or was added by Alexandria).");
  revalidatePath(RACE_EDITOR_PATH);
  revalidatePath(RACE_PUBLIC_PATH);
  publishRace();
  return { ok: true };
}
