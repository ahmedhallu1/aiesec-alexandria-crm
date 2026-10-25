import "server-only";

/** READS for the No Peace war (v38) — the War Room editor and the public
 *  page. Model and rules: src/lib/war/model.ts. */

import { db } from "@/lib/supabase";
import {
  WAR_SLUG, buildSnapshot, resolveWarSettings,
  type WarEntry, type WarPerson, type WarSettings, type WarSnapshot,
} from "@/lib/war/model";

export async function loadWarSettings(): Promise<{ settings: WarSettings; updatedAt: string | null; updatedBy: string | null }> {
  const { data } = await db()
    .from("war_campaigns")
    .select("name, settings, updated_at, updater:members!updated_by(name)")
    .eq("slug", WAR_SLUG)
    .maybeSingle();
  const row = data as { name?: string; settings?: unknown; updated_at?: string; updater?: { name?: string } | null } | null;
  return {
    settings: resolveWarSettings(row?.settings, row?.name),
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updater?.name ?? null,
  };
}

/** Everyone the race could name — active or not (an inactive member's
 *  entries stay on record; they just don't rank). */
export async function loadWarPeople(): Promise<WarPerson[]> {
  const { data, error } = await db()
    .from("members")
    .select("id, name, role, functions, sub_functions, is_active, avatar_url")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    role: m.role as string,
    functions: (m.functions as string[]) ?? [],
    sub_functions: (m.sub_functions as string[]) ?? [],
    is_active: m.is_active !== false,
    avatar_url: (m.avatar_url as string | null) ?? null,
  }));
}

export interface WarEntryRow extends WarEntry {
  created_by: string | null;
  created_by_name: string | null;
  deleted_at: string | null;
}

/** Live entries (and, for the editor, the recently deleted ones for undo). */
export async function loadWarEntries(opts: { withDeleted?: boolean } = {}): Promise<WarEntryRow[]> {
  const out: WarEntryRow[] = [];
  // a month of logging is hundreds of rows, not thousands — page anyway so
  // Supabase's 1000-row cap can never silently drop points
  for (let from = 0; from < 20000; from += 1000) {
    let q = db()
      .from("war_entries")
      .select("id, member_id, kind, qty, points, note, occurred_on, created_at, created_by, deleted_at, maker:members!created_by(name)")
      .eq("campaign", WAR_SLUG)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + 999);
    if (!opts.withDeleted) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const row = r as Record<string, unknown> & { maker?: { name?: string } | null };
      out.push({
        id: row.id as string,
        member_id: row.member_id as string,
        kind: row.kind as string,
        qty: row.qty as number,
        points: (row.points as number | null) ?? null,
        note: (row.note as string | null) ?? null,
        occurred_on: row.occurred_on as string,
        created_at: row.created_at as string,
        created_by: (row.created_by as string | null) ?? null,
        created_by_name: row.maker?.name ?? null,
        deleted_at: (row.deleted_at as string | null) ?? null,
      });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** The public snapshot — what /no-peace renders and every live push carries. */
export async function warSnapshot(): Promise<WarSnapshot> {
  const [{ settings }, people, entries] = await Promise.all([
    loadWarSettings(),
    loadWarPeople(),
    loadWarEntries(),
  ]);
  return buildSnapshot(people, entries, settings);
}
