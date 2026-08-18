import "server-only";

/** READING THE FUNCTION DEFAULTS (v33.32).
 *
 *  Every request that builds a Viewer needs these (they decide what a Member
 *  can see), so the whole table — eight rows at most — is read once and
 *  cached for a minute. Settings change when a VP opens their profile, not
 *  between clicks; `saveFunctionSettings` busts the tag so a change is visible
 *  immediately to the person who made it.
 */

import { db } from "@/lib/supabase";
import {
  resolveFunctionSettings, SETTABLE_FUNCTIONS,
  type FunctionSettings, type SettableFunction,
} from "@/lib/function-settings";

export const FUNCTION_SETTINGS_TAG = "function-settings";

export interface FunctionSettingsRow {
  function_key: string;
  settings: unknown;
  updated_at: string | null;
  updated_by_name: string | null;
}

type ResolvedSettings = Record<
  string,
  FunctionSettings & { updatedAt: string | null; updatedBy: string | null }
>;

/** WHY THIS IS MODULE MEMORY AND NOT `unstable_cache` ANY MORE (v33.59).
 *
 *  This is the single most-read thing in the system: EVERY request that builds
 *  a Viewer reads it, because it decides what a Member is allowed to see. It
 *  was wrapped in `unstable_cache`, and `refresh()` — called from ~94 write
 *  paths — calls `revalidatePath("/", "layout")`, which Next documents under
 *  "Revalidating all data": it drops every `unstable_cache` entry, this one
 *  included. So with forty members working, the entry was being evicted
 *  continuously and the cache never hit: a table read on essentially every
 *  page view of every member, all month. Exactly the fault v33.46 found and
 *  fixed for the dashboard, in a much hotter path.
 *
 *  Plain module memory is out of `revalidatePath`'s reach. Eight rows, sixty
 *  seconds, per instance — and `saveFunctionSettings` busts it so the leader
 *  who just flipped a switch is never served the value they changed.
 *
 *  THE COST, stated plainly: an instance that did not serve the change can be
 *  up to `TTL_MS` behind on it. These are function DEFAULTS — a VP changes one
 *  every few weeks — so a minute of skew is invisible, and the `updateTag`
 *  call in `saveFunctionSettings` still handles the case that matters (the
 *  person making the change). */
const TTL_MS = 60_000;
let memo: { at: number; value: ResolvedSettings } | null = null;

/** Forget the cached settings map — called after a write. */
export function bustFunctionSettings(): void {
  memo = null;
}

async function readFunctionSettings(): Promise<{ ok: boolean; value: ResolvedSettings }> {
  const { data, error } = await db()
    .from("function_settings")
    .select("function_key, settings, updated_at, updated_by_name");
  // FAIL TO THE DEFAULTS, NEVER TO CHAOS: if this table can't be read the
  // system must behave exactly as it did before 0054, not lock everyone
  // out of their own accounts.
  const rows = error ? [] : ((data ?? []) as FunctionSettingsRow[]);
  const byFn = new Map(rows.map((r) => [r.function_key, r]));
  const out: ResolvedSettings = {};
  for (const fn of SETTABLE_FUNCTIONS) {
    const row = byFn.get(fn);
    out[fn] = {
      ...resolveFunctionSettings(fn, row?.settings),
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by_name ?? null,
    };
  }
  return { ok: !error, value: out };
}

/** Every function's resolved settings, defaults filled in. */
export async function allFunctionSettings(): Promise<ResolvedSettings> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.value;
  const { ok, value } = await readFunctionSettings();
  // A FAILED READ IS NEVER CACHED. The read above resolves to the DEFAULTS
  // when the table can't be reached — the right answer for one request, and
  // the wrong one to hold for a minute: it would close every opened function
  // to its own members over a single blip.
  if (ok) memo = { at: Date.now(), value };
  return value;
}

export async function functionSettingsFor(fn: string): Promise<FunctionSettings> {
  const all = await allFunctionSettings();
  return all[fn] ?? resolveFunctionSettings(fn, null);
}

/** Which functions a viewer may CONFIGURE: their own, if they lead one.
 *  B2B and BD are one crew with two labels, so a leader of either gets both
 *  (the same rule `isB2B` encodes everywhere else). */
export function manageableFunctions(v: {
  role: string;
  isAdmin?: boolean;
  functions?: string[] | null;
  sub_functions?: string[] | null;
}): SettableFunction[] {
  const master = v.isAdmin || v.role === "LCP";
  if (master) return [...SETTABLE_FUNCTIONS];
  if (v.role !== "LCVP" && v.role !== "Director") return [];
  const mine = new Set([...(v.functions ?? []), ...(v.sub_functions ?? [])]);
  if (mine.has("B2B") || mine.has("BD")) {
    mine.add("B2B");
    mine.add("BD");
  }
  return SETTABLE_FUNCTIONS.filter((f) => mine.has(f));
}
