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

/** Every function's resolved settings, defaults filled in. */
export async function allFunctionSettings(): Promise<
  Record<string, FunctionSettings & { updatedAt: string | null; updatedBy: string | null }>
> {
  const { unstable_cache } = await import("next/cache");
  const read = unstable_cache(
    async () => {
      const { data, error } = await db()
        .from("function_settings")
        .select("function_key, settings, updated_at, updated_by_name");
      // FAIL TO THE DEFAULTS, NEVER TO CHAOS: if this table can't be read the
      // system must behave exactly as it did before 0054, not lock everyone
      // out of their own accounts.
      const rows = error ? [] : ((data ?? []) as FunctionSettingsRow[]);
      const byFn = new Map(rows.map((r) => [r.function_key, r]));
      const out: Record<
        string,
        FunctionSettings & { updatedAt: string | null; updatedBy: string | null }
      > = {};
      for (const fn of SETTABLE_FUNCTIONS) {
        const row = byFn.get(fn);
        out[fn] = {
          ...resolveFunctionSettings(fn, row?.settings),
          updatedAt: row?.updated_at ?? null,
          updatedBy: row?.updated_by_name ?? null,
        };
      }
      return out;
    },
    ["all-function-settings"],
    { revalidate: 60, tags: [FUNCTION_SETTINGS_TAG] }
  );
  return read();
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
