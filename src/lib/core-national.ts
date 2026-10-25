/** CORE's "National Rankings Per Program" (v38) — pure, tested.
 *
 *  core.aiesec.org.eg's home page carries one table per stage (panes
 *  #approved / #realized / #completed). Each row is a program (iGV, iGTa,
 *  iGTe, oGV, oGTa, oGTe, Total) and its cells are the TOP TEN Egyptian LCs in
 *  order, "<h5>LC name</h5> … (count)". Alexandria's place is its position in
 *  that row; when it is not in the top ten CORE simply doesn't say, and
 *  neither do we (rank = null → "outside the top 10"). */

import type { NationalStanding, NationalCell } from "./war/model";

export const CORE_STAGES = [
  { stage: "approved", label: "Approved" },
  { stage: "realized", label: "Realized" },
  { stage: "completed", label: "Completed" },
] as const;

const decode = (t: string) =>
  t.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

export interface NationalRow {
  program: string;
  lcs: { lc: string; count: number }[];
}

/** One stage's table → its program rows. */
export function parseStageTable(html: string): NationalRow[] {
  const body = html.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? html;
  const rows: NationalRow[] = [];
  for (const tr of body.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const program = decode(tr.match(/<th[^>]*>([\s\S]*?)<\/th>/i)?.[1]?.replace(/<[^>]+>/g, "") ?? "");
    if (!program) continue;
    const lcs: NationalRow["lcs"] = [];
    for (const td of tr.match(/<td[\s\S]*?<\/td>/gi) ?? []) {
      const lc = decode(td.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i)?.[1]?.replace(/<[^>]+>/g, "") ?? "");
      const count = Number(td.match(/\((\d+)\)/)?.[1] ?? NaN);
      if (lc) lcs.push({ lc, count: Number.isFinite(count) ? count : 0 });
    }
    rows.push({ program, lcs });
  }
  return rows;
}

/** The whole home page → Alexandria's (or `lc`'s) place in every program of
 *  every stage. Null when the section can't be found at all. */
export function parseNationalStanding(html: string, lc = "Alexandria"): NationalStanding | null {
  const at = html.indexOf("National Rankings Per Program");
  if (at < 0) return null;
  const section = html.slice(at);
  const stages: NationalStanding["stages"] = [];
  for (const { stage, label } of CORE_STAGES) {
    const start = section.search(new RegExp(`id="${stage}"`));
    if (start < 0) continue;
    const rest = section.slice(start);
    const end = rest.search(/<\/table>/i);
    const rows = parseStageTable(end > 0 ? rest.slice(0, end) : rest.slice(0, 40000));
    if (rows.length === 0) continue;
    const want = lc.toLowerCase();
    const cells: NationalCell[] = rows.map((r) => {
      const i = r.lcs.findIndex((x) => x.lc.toLowerCase() === want);
      return {
        program: r.program,
        rank: i >= 0 ? i + 1 : null,
        count: i >= 0 ? r.lcs[i].count : null,
        leader: r.lcs[0] ?? null,
        listed: r.lcs.length,
      };
    });
    stages.push({ stage, label, cells });
  }
  return stages.length ? { stages, fetchedAt: new Date().toISOString() } : null;
}
