import "server-only";
import { db } from "@/lib/supabase";
import { canRunLcTools, type Viewer } from "@/lib/rbac";
import { currentTermFebYear, peakOf } from "@/lib/plan";
import {
  resolveHandover,
  termLabelOf,
  type Handover,
  type LcTermState,
} from "@/lib/lc-term";

/** THE LC SETTINGS' READS (v37.2) — for the LCP and the admins. */

async function setting<T>(key: string): Promise<T | null> {
  const { data } = await db().from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}

export interface LcOverview {
  currentTermLabel: string;
  currentPeakLabel: string;
  state: LcTermState | null;
  history: LcTermState[];
  handover: Handover;
  membershipSource: "sodio" | "sheet";
  members: { active: number; inactive: number };
  planning: {
    sheetId: string | null;
    sheetUrl: string | null;
    /** plan rows imported for the CURRENT term (0 = nothing yet) */
    cellsThisTerm: number;
    lastImportAt: string | null;
  };
}

export async function lcOverview(viewer: Viewer): Promise<LcOverview | null> {
  if (!canRunLcTools(viewer)) return null;
  const febYear = currentTermFebYear();
  const termStart = `${febYear}-02-01`;
  const termEnd = `${febYear + 1}-01-31`;
  const [state, history, handoverRaw, sourceRaw, sheetRaw, active, inactive, cells, lastCell] =
    await Promise.all([
      setting<LcTermState>("lc:term"),
      setting<LcTermState[]>("lc:term-history"),
      setting<unknown>("lc:handover"),
      setting<{ source?: string }>("membership:source"),
      setting<string | { id?: string }>("planning:sheet-id"),
      db().from("members").select("id", { count: "exact", head: true }).eq("is_active", true),
      db().from("members").select("id", { count: "exact", head: true }).eq("is_active", false),
      db()
        .from("plan_cells")
        .select("id", { count: "exact", head: true })
        .gte("period_start", termStart)
        .lte("period_start", termEnd),
      db()
        .from("plan_cells")
        .select("imported_at")
        .order("imported_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  const sheetId = typeof sheetRaw === "string" ? sheetRaw : (sheetRaw?.id ?? null);
  return {
    currentTermLabel: termLabelOf(febYear),
    currentPeakLabel: peakOf().label,
    state,
    history: Array.isArray(history) ? history.slice(-12).reverse() : [],
    handover: resolveHandover(handoverRaw),
    membershipSource: sourceRaw?.source === "sheet" ? "sheet" : "sodio",
    members: { active: active.count ?? 0, inactive: inactive.count ?? 0 },
    planning: {
      sheetId,
      sheetUrl: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}` : null,
      cellsThisTerm: cells.count ?? 0,
      lastImportAt: (lastCell.data as { imported_at?: string } | null)?.imported_at ?? null,
    },
  };
}

/** THE HANDOVER, FOR THE PEOPLE HANDED (v37.2): every leader — VP, Director,
 *  LCP, admin — reads the general note, the links, and the notes of the
 *  functions they hold (the LCP and admins read every function's). */
export async function handoverFor(viewer: Viewer): Promise<{
  handover: Handover;
  functions: string[];
  state: LcTermState | null;
} | null> {
  const leader =
    viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role) || canRunLcTools(viewer);
  if (!leader) return null;
  const [raw, state] = await Promise.all([setting<unknown>("lc:handover"), setting<LcTermState>("lc:term")]);
  const handover = resolveHandover(raw);
  const all = canRunLcTools(viewer) || viewer.role === "LCP";
  const mine = [...(viewer.functions ?? []), ...(viewer.sub_functions ?? [])];
  const functions = Object.keys(handover.perFunction).filter((f) => all || mine.includes(f));
  const empty = !handover.general && handover.links.length === 0 && functions.length === 0;
  if (empty) return null;
  return {
    handover: {
      ...handover,
      perFunction: Object.fromEntries(functions.map((f) => [f, handover.perFunction[f]])),
    },
    functions,
    state,
  };
}
