import "server-only";

/** READS for Alex vs MUST (v38.5) — the in-app editor (/lc-race), the public
 *  board (/alex-vs-must) and MUST's private slots desk. Model and rules:
 *  src/lib/race/model.ts.
 *
 *  THE OBSERVER (`observeCore`) is what turns CORE into readings: it reads both
 *  LCs' approved counts (Next's 15-minute data cache, unless asked fresh) and
 *  stores a reading only when a number CHANGED. It runs when the public board
 *  renders, when the editor asks, and on the hourly sheets-export cron — so
 *  "who got there first" is never more than an hour out even if nobody is
 *  looking. A change is pushed live to the race board AND the No Peace board
 *  (its Activate APD goal counts the same approvals). */

import { db } from "@/lib/supabase";
import { keepAlive } from "@/server/background";
import { broadcast } from "@/server/realtime";
import { bustTabRules, publicPageLive } from "@/server/tabs";
import { coreLcApproved } from "@/lib/core-analytics";
import {
  PROGRAMS, RACE_EDITOR_PATH, RACE_SLUG, SIDES, buildRaceSnapshot, raceClock, resolveRaceSettings, sumPrograms,
  type CoreReading, type ProgramCounts, type RaceDeal, type RaceEntry, type RaceReading, type RaceSettings,
  type RaceSnapshot, type Side,
} from "@/lib/race/model";

export async function loadRaceSettings(): Promise<{
  settings: RaceSettings;
  stored: Record<string, unknown> | null;
  ok: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}> {
  const { data, error } = await db()
    .from("war_campaigns")
    .select("settings, updated_at, updater:members!updated_by(name)")
    .eq("slug", RACE_SLUG)
    .maybeSingle();
  const row = data as { settings?: unknown; updated_at?: string; updater?: { name?: string } | null } | null;
  const stored = row?.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>) : null;
  return {
    settings: resolveRaceSettings(stored),
    stored,
    ok: !error,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updater?.name ?? null,
  };
}

export interface RaceReadingRow extends RaceReading {
  created_by_name: string | null;
}

/** Every reading, oldest first. A reading is stored only on a CHANGE, so a
 *  month of racing is a few hundred rows; paged anyway (Supabase caps 1000). */
export async function loadRaceReadings(): Promise<RaceReadingRow[]> {
  const out: RaceReadingRow[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db()
      .from("race_readings")
      .select("id, side, total, programs, source, at, maker:members!created_by(name)")
      .eq("campaign", RACE_SLUG)
      .order("at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const row = r as Record<string, unknown> & { maker?: { name?: string } | null };
      out.push({
        id: row.id as string,
        side: row.side as Side,
        total: row.total as number,
        programs: (row.programs as Partial<ProgramCounts>) ?? {},
        source: row.source === "manual" ? "manual" : "core",
        at: row.at as string,
        created_by_name: row.maker?.name ?? null,
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export interface RaceEntryRow extends RaceEntry {
  note: string | null;
  source: "link" | "editor";
  created_by_name: string | null;
  deleted_at: string | null;
}

export async function loadRaceEntries(opts: { withDeleted?: boolean; side?: Side } = {}): Promise<RaceEntryRow[]> {
  let q = db()
    .from("race_entries")
    .select("id, side, qty, note, occurred_on, source, created_at, deleted_at, maker:members!created_by(name)")
    .eq("campaign", RACE_SLUG)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (!opts.withDeleted) q = q.is("deleted_at", null);
  if (opts.side) q = q.eq("side", opts.side);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown> & { maker?: { name?: string } | null };
    return {
      id: row.id as string,
      side: row.side as Side,
      qty: row.qty as number,
      note: (row.note as string | null) ?? null,
      occurred_on: row.occurred_on as string,
      source: row.source === "editor" ? "editor" : "link",
      created_at: row.created_at as string,
      created_by_name: row.maker?.name ?? null,
      deleted_at: (row.deleted_at as string | null) ?? null,
    };
  });
}

/** Alexandria's slots: Sodio's own deals recorded inside the race (test
 *  accounts never count). A cancelled deal is deleted, so it simply leaves. */
export async function loadRaceDeals(s: RaceSettings): Promise<RaceDeal[]> {
  const c = raceClock(s);
  const out: RaceDeal[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await db()
      .from("deals")
      .select("id, created_at, slots_igv, slots_igta, slots_igte, account:accounts(is_test)")
      .gte("created_at", new Date(c.start).toISOString())
      .lte("created_at", new Date(c.deadline).toISOString())
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) {
      const row = d as Record<string, unknown> & { account?: { is_test?: boolean } | null };
      if (row.account?.is_test) continue;
      out.push({
        id: row.id as string,
        created_at: row.created_at as string,
        igv: (row.slots_igv as number) ?? 0,
        igta: (row.slots_igta as number) ?? 0,
        igte: (row.slots_igte as number) ?? 0,
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

const sameReading = (a: RaceReading | undefined, b: CoreReading) =>
  !!a && a.total === b.total && PROGRAMS.every((k) => (a.programs[k] ?? -1) === b.programs[k]);

export interface Observation {
  /** a new reading was stored for at least one side */
  changed: boolean;
  /** what CORE said this time (null = unreachable or switched off) */
  core: Record<Side, CoreReading | null>;
}

/** Read CORE for both LCs and store a reading wherever the number moved.
 *  Never after the deadline (the board freezes there). Never throws — a CORE
 *  outage must not take the page that asked down with it. */
export async function observeCore(
  opts: { fresh?: boolean; settings?: RaceSettings; readings?: RaceReading[] } = {}
): Promise<Observation> {
  const core: Record<Side, CoreReading | null> = { home: null, rival: null };
  try {
    const settings = opts.settings ?? (await loadRaceSettings()).settings;
    if (Date.now() > raceClock(settings).deadline) return { changed: false, core };
    const [home, rival, readings] = await Promise.all([
      settings.home.coreOn ? coreLcApproved(settings.home.coreId, { fresh: opts.fresh }) : Promise.resolve(null),
      settings.rival.coreOn ? coreLcApproved(settings.rival.coreId, { fresh: opts.fresh }) : Promise.resolve(null),
      opts.readings ? Promise.resolve(opts.readings) : loadRaceReadings(),
    ]);
    core.home = home;
    core.rival = rival;
    const rows: Record<string, unknown>[] = [];
    for (const side of SIDES) {
      const now = core[side];
      if (!now) continue;
      const last = [...readings].reverse().find((r) => r.side === side);
      if (sameReading(last, now)) continue;
      rows.push({ campaign: RACE_SLUG, side, total: now.total, programs: now.programs, source: "core" });
    }
    if (rows.length === 0) return { changed: false, core };
    const { error } = await db().from("race_readings").insert(rows);
    if (error) {
      console.error("[race] storing a CORE reading failed:", error.message);
      return { changed: false, core };
    }
    publishRace({ alsoWar: rows.some((r) => r.side === "home") });
    return { changed: true, core };
  } catch (e) {
    console.error("[race] observing CORE failed:", e instanceof Error ? e.message : e);
    return { changed: false, core };
  }
}

/** The public snapshot. `observe` first asks CORE (the public page does). */
export async function raceSnapshot(opts: { observe?: boolean } = {}): Promise<RaceSnapshot> {
  const at = new Date().toISOString();
  const { settings } = await loadRaceSettings();
  let readings = await loadRaceReadings();
  if (opts.observe) {
    const o = await observeCore({ settings, readings });
    if (o.changed) readings = await loadRaceReadings();
  }
  const [entries, deals] = await Promise.all([loadRaceEntries(), loadRaceDeals(settings)]);
  return buildRaceSnapshot({ settings, readings, entries, deals, at });
}

/** Push the new board to every open /alex-vs-must page (and, when Alexandria's
 *  approvals moved, the No Peace board too). Fire-and-forget; nothing is sent
 *  while the public page is switched off. */
export function publishRace(opts: { alsoWar?: boolean } = {}): void {
  keepAlive(
    (async () => {
      try {
        bustTabRules();
        if (await publicPageLive(RACE_EDITOR_PATH)) broadcast(RACE_SLUG, "snapshot", await raceSnapshot());
        if (opts.alsoWar) {
          const { broadcastWar } = await import("@/server/war");
          await broadcastWar();
        }
      } catch (e) {
        console.error("[race] snapshot for broadcast failed:", e instanceof Error ? e.message : e);
      }
    })()
  );
}

/** Alexandria's approvals since the race opened — the No Peace board's
 *  "150 APDs by Activate" counts exactly this (the LC chose one number for
 *  both). Null when nothing has been read yet. */
export async function homeApprovalsSinceStart(): Promise<{ value: number; total: number; readAt: string } | null> {
  const { settings } = await loadRaceSettings();
  const deadline = new Date(raceClock(settings).deadline).toISOString();
  const { data } = await db()
    .from("race_readings")
    .select("total, at")
    .eq("campaign", RACE_SLUG)
    .eq("side", "home")
    .lte("at", deadline)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle<{ total: number; at: string }>();
  if (!data) return null;
  return { value: Math.max(0, data.total - sumPrograms(settings.home.baseline)), total: data.total, readAt: data.at };
}

/** MUST's link: the stored token, compared in constant time. */
export async function rivalTokenOk(token: string): Promise<{ ok: boolean; settings: RaceSettings }> {
  const { settings } = await loadRaceSettings();
  const want = settings.rivalToken;
  if (!want || typeof token !== "string" || token.length !== want.length) return { ok: false, settings };
  const { timingSafeEqual } = await import("node:crypto");
  return { ok: timingSafeEqual(Buffer.from(token), Buffer.from(want)), settings };
}
