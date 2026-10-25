import "server-only";

/** READING THE TAB RULES (v38) — see src/lib/tabs.ts for what a rule means.
 *
 *  The layout reads these on EVERY page view (to build the sidebar) and each
 *  page asks once more (to refuse a hidden tab), so the table — one row per
 *  tab somebody has touched, ~17 at most — lives in module memory for 30
 *  seconds, exactly like the function defaults (server/function-settings.ts
 *  explains why module memory and not `unstable_cache`). A save busts it, so
 *  the admin who changed a rule sees it at once; another instance can lag by
 *  up to the TTL. Remove/show DATES are evaluated against the clock on every
 *  request, so a timed removal is exact to the request, not to the cache. */

import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import type { Viewer } from "@/lib/rbac";
import {
  publicTwinLive, ruleFromRow, tabOverride, tabOverridesFor, tabVisible,
  type TabOverride, type TabRule,
} from "@/lib/tabs";

const TTL_MS = 30_000;
let memo: { at: number; rules: TabRule[] } | null = null;

export function bustTabRules(): void {
  memo = null;
}

/** Every rule. FAILS OPEN TO THE CODE: if the table can't be read, the app
 *  behaves exactly as it did before 0087 — no rules, nobody locked out. */
export async function tabRules(): Promise<TabRule[]> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.rules;
  const { data, error } = await db()
    .from("tab_rules")
    .select(
      "href, label, position, base, show_to, hide_from, visible_from, remove_at, retired_at, public_off, public_with_tab, note, updated_at, updater:members!updated_by(name)"
    );
  if (error) {
    console.error("[tabs] read failed:", error.message);
    return [];
  }
  const rules = (data ?? []).map((row) => {
    const r = row as Record<string, unknown> & { updater?: { name?: string } | null };
    return ruleFromRow({ ...r, updated_by_name: r.updater?.name ?? null });
  });
  memo = { at: Date.now(), rules };
  return rules;
}

export async function tabRule(href: string): Promise<TabRule | undefined> {
  return (await tabRules()).find((r) => r.href === href);
}

/** This viewer's overrides, for the sidebar and the gate. In a test view the
 *  impersonated member's — that is the point of a test view. */
export async function tabOverridesForViewer(v: Viewer): Promise<Record<string, TabOverride>> {
  return tabOverridesFor(await tabRules(), v);
}

/** THE PAGE GATE. `builtIn` is the page's own code rule; the tab rule can
 *  open it or close it. Every tab's page calls this before reading data. */
export async function tabAllows(v: Viewer, href: string, builtIn: boolean): Promise<boolean> {
  return tabVisible(builtIn, tabOverride(await tabRule(href), v));
}

/** Is a tab's public twin (/activate26, /no-peace) live? */
export async function publicPageLive(tabHref: string): Promise<boolean> {
  return publicTwinLive(await tabRule(tabHref));
}

export interface TabPickPerson {
  id: string;
  name: string;
  role: string;
  functions: string[];
  active: boolean;
}

/** What Settings → Tabs needs: every rule plus the people a rule can name
 *  (inactive members included, so a rule naming one still reads by name). */
export async function tabManagerData(): Promise<{ rules: TabRule[]; people: TabPickPerson[] }> {
  bustTabRules(); // the manager always reads the table, never a stale copy
  const [rules, { data }] = await Promise.all([
    tabRules(),
    db().from("members").select("id, name, role, functions, sub_functions, is_active").order("name"),
  ]);
  const people = (data ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    role: m.role as string,
    functions: [...new Set([...((m.functions as string[]) ?? []), ...((m.sub_functions as string[]) ?? [])])],
    active: m.is_active !== false,
  }));
  return { rules, people };
}

/** Only the HIDE side — for pages with no code rule of their own to widen
 *  (Raising for the module-less renders "Soon"; Help is everyone's). */
export async function tabHidden(v: Viewer, href: string): Promise<boolean> {
  return tabOverride(await tabRule(href), v) === "hide";
}

/** The one-line page gate: the page's own code rule in, the tab rule on top,
 *  away to `elsewhere` when the answer is no. Pages with no code rule of
 *  their own pass `true` — then only a "hide" rule can close them. */
export async function gateTab(v: Viewer, href: string, builtIn = true, elsewhere = "/"): Promise<void> {
  if (!(await tabAllows(v, href, builtIn))) redirect(elsewhere);
}
