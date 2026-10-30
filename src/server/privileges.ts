import "server-only";

/** READING THE RULE OVERRIDES (v38.4) — see src/lib/privileges.ts for what a
 *  rule means.
 *
 *  EVERY request that builds a Viewer reads this, because the predicates in
 *  rbac.ts are synchronous and have to be handed their answer up front. So
 *  the table — at most one row per switchable rule, ~17 — lives in module
 *  memory for 60 seconds, exactly like the function defaults
 *  (server/function-settings.ts explains at length why module memory and not
 *  `unstable_cache`: `refresh()` calls revalidatePath("/", "layout"), which
 *  drops every unstable_cache entry, so that cache never hit).
 *
 *  FAILS TO THE CODE. If the table cannot be read, the resolver returns no
 *  rules at all and the app behaves exactly as it did before 0089 — the
 *  built-in RBAC answer for everyone, nobody locked out and nobody handed
 *  anything. A failed read is never memoised, so the next request tries
 *  again instead of serving a blank for a minute.
 */

import { db } from "@/lib/supabase";
import {
  privilegeFromRow, privilegeOverridesFor,
  type PrivilegeOverride, type PrivilegeRule, type PrivilegeWho,
} from "@/lib/privileges";

const TTL_MS = 60_000;
let memo: { at: number; rules: PrivilegeRule[] } | null = null;

/** Forget the cached rules — called after a save, so the LCP who just
 *  flipped a switch is never served the value they changed. Another
 *  instance can lag by up to the TTL. */
export function bustPrivilegeRules(): void {
  memo = null;
}

async function loadRules(): Promise<{ rules: PrivilegeRule[]; ok: boolean }> {
  if (memo && Date.now() - memo.at < TTL_MS) return { rules: memo.rules, ok: true };
  try {
    const { data, error } = await db()
      .from("privilege_rules")
      .select("key, base, allow_to, deny_from, note, updated_at, updater:members!updated_by(name)");
    if (error) throw new Error(error.message);
    const rules = (data ?? []).map((row) => {
      const r = row as Record<string, unknown> & { updater?: { name?: string } | null };
      return privilegeFromRow({ ...r, updated_by_name: r.updater?.name ?? null });
    });
    memo = { at: Date.now(), rules };
    return { rules, ok: true };
  } catch (e) {
    console.error("[privileges] read failed:", e instanceof Error ? e.message : e);
    return { rules: [], ok: false };
  }
}

export async function privilegeRules(): Promise<PrivilegeRule[]> {
  return (await loadRules()).rules;
}

/** This person's overrides, resolved once and carried on the Viewer. In a
 *  test view it is the impersonated member's — that is the point of one. */
export async function privilegeOverridesForMember(
  who: PrivilegeWho
): Promise<Record<string, PrivilegeOverride>> {
  return privilegeOverridesFor(await privilegeRules(), who);
}

export interface PrivilegePickPerson {
  id: string;
  name: string;
  role: string;
  functions: string[];
  active: boolean;
}

/** What Settings → Rules needs: every rule plus the people a rule can name
 *  (inactive members included, so a rule naming one still reads by name). */
export async function privilegeManagerData(): Promise<{
  rules: PrivilegeRule[];
  people: PrivilegePickPerson[];
}> {
  bustPrivilegeRules(); // the manager always reads the table, never a stale copy
  const [rules, { data }] = await Promise.all([
    privilegeRules(),
    db().from("members").select("id, name, role, functions, sub_functions, is_active").order("name"),
  ]);
  const people = (data ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    role: m.role as string,
    functions: [
      ...new Set([...((m.functions as string[]) ?? []), ...((m.sub_functions as string[]) ?? [])]),
    ],
    active: m.is_active !== false,
  }));
  return { rules, people };
}
