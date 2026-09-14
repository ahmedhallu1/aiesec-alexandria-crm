import "server-only";
import { db } from "@/lib/supabase";
import { seedPlan } from "@/lib/activation/seed";
import {
  publicPlan,
  type ActivationDelta,
  type ActivationPlan,
  type ActivationRow,
  type ActivationSection,
  type CellValue,
  type SectionConfig,
} from "@/lib/activation/model";

/** Reads for the Activate 26' bid page (v36.7). Writes live in
 *  activation-actions.ts; the shape and the rules in lib/activation/model.ts. */

interface SectionDb {
  id: string;
  position: number;
  kind: ActivationSection["kind"];
  title: string;
  subtitle: string;
  config: SectionConfig | null;
  hidden_public: boolean;
  updated_at: string;
  updated_by: string | null;
}
interface RowDb {
  id: string;
  section_id: string;
  position: number;
  data: Record<string, CellValue> | null;
  updated_at: string;
  updated_by: string | null;
  deleted_at: string | null;
}

const SECTION_COLS = "id, position, kind, title, subtitle, config, hidden_public, updated_at, updated_by";
const ROW_COLS = "id, section_id, position, data, updated_at, updated_by, deleted_at";

// once per warm server instance — after the first successful check there is
// nothing left to seed, and the check is not worth a query on every view
let seeded = false;

/** The first ever visit writes the merged sheets in (lib/activation/seed.ts).
 *  Idempotent: the seed carries fixed ids and inserts ignore duplicates, so two
 *  visitors racing on an empty database write it once. */
export async function ensureActivationSeeded(): Promise<void> {
  if (seeded) return;
  const [s, r] = await Promise.all([
    db().from("activation_sections").select("id", { count: "exact", head: true }),
    db().from("activation_rows").select("id", { count: "exact", head: true }),
  ]);
  if (s.error) throw new Error(`[activation] ${s.error.message}`);
  if (r.error) throw new Error(`[activation] ${r.error.message}`);
  if ((s.count ?? 0) === 0 || (r.count ?? 0) === 0) {
    const { sections, rows } = seedPlan();
    const ins = await db()
      .from("activation_sections")
      .upsert(sections, { onConflict: "id", ignoreDuplicates: true });
    if (ins.error) throw new Error(`[activation] seed sections: ${ins.error.message}`);
    for (let i = 0; i < rows.length; i += 500) {
      const res = await db()
        .from("activation_rows")
        .upsert(rows.slice(i, i + 500), { onConflict: "id", ignoreDuplicates: true });
      if (res.error) throw new Error(`[activation] seed rows: ${res.error.message}`);
    }
  }
  seeded = true;
}

async function namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const { data } = await db().from("members").select("id, name").in("id", unique);
  return new Map((data ?? []).map((m: { id: string; name: string }) => [m.id, m.name]));
}

async function readRows(filter: { active: true } | { since: string }): Promise<RowDb[]> {
  const out: RowDb[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    let q = db()
      .from("activation_rows")
      .select(ROW_COLS)
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    q = "active" in filter ? q.is("deleted_at", null) : q.gt("updated_at", filter.since);
    const { data, error } = await q;
    if (error) throw new Error(`[activation] rows: ${error.message}`);
    out.push(...((data ?? []) as RowDb[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function toSection(s: SectionDb, names: Map<string, string>): ActivationSection {
  return {
    id: s.id,
    position: s.position,
    kind: s.kind,
    title: s.title,
    subtitle: s.subtitle,
    config: s.config ?? {},
    hidden_public: s.hidden_public,
    updated_at: s.updated_at,
    updated_by_name: s.updated_by ? names.get(s.updated_by) ?? null : null,
  };
}
function toRow(r: RowDb, names: Map<string, string>): ActivationRow {
  return {
    id: r.id,
    section_id: r.section_id,
    position: r.position,
    data: r.data ?? {},
    updated_at: r.updated_at,
    updated_by_name: r.updated_by ? names.get(r.updated_by) ?? null : null,
    deleted_at: r.deleted_at,
  };
}

/** A cursor a few seconds in the past: the app server's clock and the
 *  database's `now()` are not the same clock, and re-sending a row that was
 *  already merged is harmless where missing one is not. */
const cursor = () => new Date(Date.now() - 5000).toISOString();

export async function loadActivationPlan(opts: { publicView: boolean }): Promise<ActivationPlan> {
  await ensureActivationSeeded();
  const syncedAt = cursor();
  const [sec, rows] = await Promise.all([
    db().from("activation_sections").select(SECTION_COLS).order("position", { ascending: true }),
    readRows({ active: true }),
  ]);
  if (sec.error) throw new Error(`[activation] sections: ${sec.error.message}`);
  const sections = (sec.data ?? []) as SectionDb[];
  const names = opts.publicView
    ? new Map<string, string>()
    : await namesFor([...sections.map((s) => s.updated_by), ...rows.map((r) => r.updated_by)]);
  const plan: ActivationPlan = {
    sections: sections.map((s) => toSection(s, names)),
    rows: rows.map((r) => toRow(r, names)),
    syncedAt,
    publicView: false,
  };
  return opts.publicView ? publicPlan(plan) : plan;
}

/** Everything changed since `since` — deletions included, so the other
 *  editors' screens drop a row someone removed. */
export async function loadActivationDelta(since: string): Promise<ActivationDelta> {
  const syncedAt = cursor();
  const [sec, rows] = await Promise.all([
    db().from("activation_sections").select(SECTION_COLS).gt("updated_at", since),
    readRows({ since }),
  ]);
  if (sec.error) throw new Error(`[activation] delta: ${sec.error.message}`);
  const sections = (sec.data ?? []) as SectionDb[];
  const names = await namesFor([...sections.map((s) => s.updated_by), ...rows.map((r) => r.updated_by)]);
  return {
    sections: sections.map((s) => toSection(s, names)),
    rows: rows.map((r) => toRow(r, names)),
    syncedAt,
  };
}
