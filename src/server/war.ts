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
 *  entries stay on record; they just don't rank).
 *
 *  Avatars come from a second, https-only read: an uploaded avatar is a data:
 *  URI of up to ~25 KB, and pulling ~100 of those on every public view and
 *  every live push only for `publicAvatar` to throw them away is the waste.
 *  `publicAvatar` stays the guard (it also caps the length). */
export async function loadWarPeople(): Promise<WarPerson[]> {
  const [{ data, error }, { data: pics }] = await Promise.all([
    db().from("members").select("id, name, role, functions, sub_functions, is_active").order("name"),
    db().from("members").select("id, avatar_url").like("avatar_url", "https://%"),
  ]);
  if (error) throw new Error(error.message);
  // a failed avatar read only costs the faces — initials instead
  const avatar = new Map((pics ?? []).map((m) => [m.id as string, m.avatar_url as string]));
  return (data ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    role: m.role as string,
    functions: (m.functions as string[]) ?? [],
    sub_functions: (m.sub_functions as string[]) ?? [],
    is_active: m.is_active !== false,
    avatar_url: avatar.get(m.id as string) ?? null,
  }));
}

export interface WarEntryRow extends WarEntry {
  created_by: string | null;
  created_by_name: string | null;
  deleted_at: string | null;
}

/** Live entries (and, for the editor, the recently deleted ones for undo),
 *  newest first. */
export async function loadWarEntries(opts: { withDeleted?: boolean } = {}): Promise<WarEntryRow[]> {
  const out = new Map<string, WarEntryRow>();
  // a month of logging is hundreds of rows, not thousands — page anyway so
  // Supabase's 1000-row cap can never silently drop points. KEYSET paging on
  // (created_at, id), oldest first: an entry logged mid-read lands after the
  // cursor instead of shifting an offset (which double-counted or skipped a
  // row at the page edge). The Map is the belt to that brace.
  let after: { at: string; id: string } | null = null;
  for (let page = 0; page < 20; page++) {
    let q = db()
      .from("war_entries")
      .select("id, member_id, kind, qty, points, note, occurred_on, created_at, created_by, deleted_at, maker:members!created_by(name)")
      .eq("campaign", WAR_SLUG)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1000);
    if (!opts.withDeleted) q = q.is("deleted_at", null);
    // quoted: a timestamp carries ":" and "+", which the or() grammar reserves
    if (after) q = q.or(`created_at.gt."${after.at}",and(created_at.eq."${after.at}",id.gt.${after.id})`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const row = r as Record<string, unknown> & { maker?: { name?: string } | null };
      out.set(row.id as string, {
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
    if (rows.length < 1000) break;
    const last = rows[rows.length - 1] as { created_at: string; id: string };
    after = { at: last.created_at, id: last.id };
  }
  return [...out.values()].reverse();
}

/** The public snapshot — what /no-peace renders and every live push carries. */
export async function warSnapshot(): Promise<WarSnapshot> {
  // stamped BEFORE the reads: a later `at` must never carry older data
  const at = new Date().toISOString();
  const [{ settings }, people, entries] = await Promise.all([
    loadWarSettings(),
    loadWarPeople(),
    loadWarEntries(),
  ]);
  return buildSnapshot(people, entries, settings, undefined, at);
}
