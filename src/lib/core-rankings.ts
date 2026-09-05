/** CORE's NATIONAL RANKINGS, READ AS STRUCTURE (v36).
 *
 *  The period reports have to say two different things about the same number,
 *  and only one of them was ever available: CORE's own top-10 board per
 *  programme ("who is #1 in Egypt for iGV"), **and** Alexandria's EXACT rank
 *  out of every Egyptian entity — because "outside the top 10" is not an
 *  answer anybody can act on, and on the Completed pane that is genuinely
 *  where she sits for iGV.
 *
 *  `core-analytics.ts` already fetches CORE, but it flattens the pages to
 *  TEXT for the Violet Man to read. Text is right for an assistant and wrong
 *  for an email: a report cannot say "#6 of 28" from a paragraph. So this is
 *  a second, structured reader over the same public HTML. Both are best-effort
 *  against a site nobody here controls.
 *
 *  TWO PAGES, AND BOTH ARE REQUIRED:
 *   - the homepage carries the "National Rankings Per Program" widget, whose
 *     `#approved` pane is CORE's own top 10 per programme, in CORE's order;
 *   - `/analytics/<egypt>/LC<term>/` carries `#signups-table`, every Egyptian
 *     entity on one row, which is the only place the exact rank and the
 *     denominator can come from.
 *  If either half cannot be read we return `null` and the report prints its
 *  "CORE was unreachable" line. A half-built section that quietly drops the
 *  exact rank is exactly the failure this feature exists to remove.
 *
 *  ⚠️ NOT `server-only`. There is nothing secret in here — CORE is a public,
 *  unauthenticated site — and the v34.6 lesson still stands: a client
 *  component that ever needs one of these VALUES (a preview of the report,
 *  say) cannot import it from a `server-only` module. Keep it importable.
 */

import { cairoToday } from "./types";

/** Egypt's country id on CORE, from its public entity menu. Stable.
 *  (Not to be confused with `core-analytics.ts`'s ALEXANDRIA_LC_ID = 899 —
 *  that is an LC id for a different endpoint entirely.) */
const EGYPT_COUNTRY_ID = 1609;

/** The fallback path, used only when the homepage's own nav link cannot be
 *  found. `LC26` is a TERM, not a constant: it becomes LC27 next term, and a
 *  hard-coded one would silently keep reporting last term's numbers. So the
 *  real URL is read out of the homepage every time, and this is the parachute. */
const EGYPT_TABLE_FALLBACK = `/analytics/${EGYPT_COUNTRY_ID}/LC26/`;

const CORE_URL = "https://core.aiesec.org.eg";

/** Our own entity name on CORE, matched EXACTLY. `AAST Alexandria` is a
 *  different LC that sits three rows away in the same table — a `includes`
 *  here would silently report their numbers as ours. */
const ALEXANDRIA = "Alexandria";

/** ~30 minutes. Module memory, deliberately NOT `unstable_cache` and NOT the
 *  fetch data cache: `refresh()` calls `revalidatePath("/", "layout")` on ~94
 *  write paths, which is Next's documented "revalidate ALL data" — a cache
 *  living there is evicted continuously and never hits (v33.59, v34.6). */
const CACHE_MS = 30 * 60 * 1000;

export type CoreProgram = "iGV" | "iGTa" | "iGTe" | "oGV" | "oGTa" | "oGTe" | "Total";

export const CORE_PROGRAMS: readonly CoreProgram[] = [
  "iGV", "iGTa", "iGTe", "oGV", "oGTa", "oGTe", "Total",
] as const;

export interface CoreBoardRow {
  /** CORE's own column on its board, 1–10. */
  rank: number;
  lc: string;
  approvals: number;
  isAlexandria: boolean;
}

export interface CoreProgramRanking {
  program: CoreProgram;
  /** CORE's own top 10, in CORE's order. Empty only if that row is missing. */
  top: CoreBoardRow[];
  alexandria: {
    /** Competition rank over every entity in the Egyptian table: one more
     *  than the number of entities strictly ahead. See `tiedWith`. */
    rank: number;
    of: number;
    approvals: number;
    inTop10: boolean;
    /** ADDITIVE (not in the original contract, safe to ignore): the other
     *  entities on exactly the same number. Non-empty means the rank is
     *  shared and should be printed as such. */
    tiedWith?: string[];
    /** ADDITIVE: where CORE's own board put her, when it put her on it at
     *  all. Differs from `rank` only on a tie — see the note on `rankIn`. */
    boardRank?: number | null;
  } | null;
}

export interface CoreRankings {
  asOf: string;
  programs: CoreProgramRanking[];
  termLabel: string;
}

// ------------------------------------------------------------------ text bits

/** CORE serves entity names HTML-escaped (`Luxor &amp; Aswan (Closed)`), and
 *  the exact-match rule above is worthless if one side is still escaped. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // last, or an escaped "&amp;lt;" would decode twice
    .replace(/&amp;/g, "&");
}

/** Cell text: tags out, entities out, whitespace collapsed. */
function cellText(html: string): string {
  return unescapeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** A count as CORE prints it. Returns null rather than 0 for "no number
 *  here" — a missing cell and a real zero are different facts. */
function num(s: string): number | null {
  const m = /-?\d[\d,]*/.exec(s);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** The rows of one `<table>`'s section, each as its raw inner HTML. */
function rowsOf(section: string): string[] {
  return [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
}

/** The cells of one row, with their attribute string (colspan/rowspan live
 *  there, and the header alignment below is built out of them). */
function cellsOf(row: string): { attrs: string; html: string }[] {
  return [...row.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map((m) => ({
    attrs: m[1], html: m[2],
  }));
}

function span(attrs: string, name: "colspan" | "rowspan"): number {
  const m = new RegExp(`${name}\\s*=\\s*"?(\\d+)`, "i").exec(attrs);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Slices `<table …>…</table>` starting at `from`. CORE never nests tables in
 *  these two widgets, so the first closing tag is the right one. */
function tableAt(html: string, from: number): string | null {
  if (from < 0) return null;
  const start = html.lastIndexOf("<table", from) >= 0 ? html.lastIndexOf("<table", from) : from;
  const end = html.indexOf("</table>", from);
  return end < 0 ? null : html.slice(Math.min(start, from), end);
}

// ------------------------------------------------- A. the homepage top-10 board

function programOf(label: string): CoreProgram | null {
  const k = label.toLowerCase().replace(/\s+/g, "");
  return (CORE_PROGRAMS.find((p) => p.toLowerCase() === k) ?? null) as CoreProgram | null;
}

/** CORE's own board, from the homepage's `#approved` pane.
 *
 *  Approvals ONLY, by decision: the report is about what the LC delivered,
 *  and mixing three stages into one section is how a reader stops trusting
 *  any of them. The pane is picked by id, so the two panes beside it
 *  (`#realized`, `#completed`) can never be read by mistake. */
function parseBoard(homeHtml: string): Map<CoreProgram, CoreBoardRow[]> | null {
  const paneAt = homeHtml.search(/id="approved"/i);
  if (paneAt < 0) return null;
  // the pane's own table opens immediately inside it (~70 characters in the
  // captured markup). Bounding the look-ahead is what stops a pane that ever
  // renders empty from silently handing us the NEXT pane's table — Realized
  // numbers printed under an "approvals" heading is the kind of wrong that
  // nobody catches by reading the email.
  const tableAtIdx = homeHtml.indexOf("table-national-rankings", paneAt);
  if (tableAtIdx < 0 || tableAtIdx - paneAt > 2000) return null;
  const table = tableAt(homeHtml, tableAtIdx);
  if (!table) return null;

  const body = table.slice(table.search(/<tbody[^>]*>/i));
  const out = new Map<CoreProgram, CoreBoardRow[]>();
  for (const row of rowsOf(body)) {
    const head = /<th[^>]*>([\s\S]*?)<\/th>/i.exec(row);
    const program = head ? programOf(cellText(head[1])) : null;
    if (!program) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const board: CoreBoardRow[] = [];
    cells.forEach((cell, i) => {
      // the name is the <h5>; the count is the "(57)" span AFTER it. Reading
      // the last "(…)" of the whole cell would eat a name like "MSA(Closed)".
      const name = /<h5[^>]*>([\s\S]*?)<\/h5>/i.exec(cell);
      const lc = name ? cellText(name[1]) : "";
      const tail = name ? cell.slice(cell.indexOf(name[0]) + name[0].length) : cell;
      const approvals = num(cellText(tail));
      if (!lc || approvals === null) return;
      board.push({ rank: i + 1, lc, approvals, isAlexandria: lc === ALEXANDRIA });
    });
    if (board.length > 0) out.set(program, board);
  }
  return out.size > 0 ? out : null;
}

// --------------------------------------------- B. the full Egyptian table

interface EgyptRow { entity: string; approvals: Partial<Record<CoreProgram, number>> }

/** `#signups-table`: every Egyptian entity, one row each.
 *
 *  ⚠️ THE COLUMN OFFSETS ARE DERIVED FROM THE HEADER, NEVER COUNTED. The
 *  header is two-level — a group row (SIGN UPs · APPLICANTS · ACCEPTED
 *  APPLICANTS · APPROVED · REALIZED · FINISHED · COMPLETED) over a
 *  programme row — and the first group is NOT the six programmes: it is
 *  `OGX · oGV · oGTa · oGTe`, four columns, sign-ups being an outgoing-only
 *  number. Every stage group after it then LEADS with its bold `Total` and
 *  the six programmes follow. Assume "seven columns of iGV…Total per group"
 *  and every index after the first group is wrong by one — silently, with
 *  plausible numbers. So: expand the group row's colspans, pair the result
 *  with the programme row position by position, and look up (APPROVED, iGV).
 *
 *  ⚠️ `(Closed)` ENTITIES STAY IN THE DENOMINATOR. CORE's own `#` column is
 *  numbered 1..N by its DataTables draw callback over every row it prints,
 *  closed ones included — so "of 28" is what anybody who opens the page and
 *  counts will see. Dropping them would give Sodio a denominator that
 *  disagrees with the page it cites, which is worse than a slightly generous
 *  one. They all sit on zero approvals, so they never move a rank. */
function parseEgyptTable(egHtml: string): EgyptRow[] | null {
  const table = tableAt(egHtml, egHtml.search(/<table[^>]+id="signups-table"/i));
  if (!table) return null;

  const headEnd = table.search(/<\/thead>/i);
  if (headEnd < 0) return null;
  const headRows = rowsOf(table.slice(0, headEnd));
  if (headRows.length < 2) return null;

  // Row 1: the cells that span BOTH header rows are the leading label columns
  // (# and Entity); everything else is a stage group with a colspan.
  const leading: string[] = [];
  const groupPerColumn: string[] = [];
  for (const c of cellsOf(headRows[0])) {
    if (span(c.attrs, "rowspan") > 1) { leading.push(cellText(c.html)); continue; }
    const label = cellText(c.html).toUpperCase();
    for (let i = 0; i < span(c.attrs, "colspan"); i++) groupPerColumn.push(label);
  }
  const entityCol = leading.findIndex((l) => /^(entity|lc|name)$/i.test(l));
  if (entityCol < 0) return null;

  const subs = cellsOf(headRows[1]).map((c) => cellText(c.html));
  if (subs.length !== groupPerColumn.length) return null;

  // (APPROVED, iGV) → the absolute cell index on a body row.
  const colFor = new Map<CoreProgram, number>();
  subs.forEach((sub, i) => {
    if (groupPerColumn[i] !== "APPROVED") return;
    const p = programOf(sub);
    if (p && !colFor.has(p)) colFor.set(p, leading.length + i);
  });
  if (colFor.size === 0) return null;

  const body = table.slice(table.search(/<tbody[^>]*>/i));
  const rows: EgyptRow[] = [];
  for (const row of rowsOf(body)) {
    const cells = cellsOf(row).map((c) => cellText(c.html));
    if (cells.length < leading.length + subs.length) continue;
    const entity = cells[entityCol];
    if (!entity) continue;
    const approvals: Partial<Record<CoreProgram, number>> = {};
    for (const [p, at] of colFor) {
      const v = num(cells[at]);
      if (v !== null) approvals[p] = v;
    }
    rows.push({ entity, approvals });
  }
  return rows.length > 0 ? rows : null;
}

/** Competition ranking ("1224"): one more than the number strictly ahead.
 *
 *  ⚠️ CORE'S OWN BOARD ORDINAL IS NOT ALWAYS REPRODUCIBLE FROM THE NUMBERS,
 *  and pretending otherwise would be the lie. On oGV, Zagazig and Alexandria
 *  are both on 53; CORE prints Zagazig 5th and Alexandria 6th, breaking the
 *  tie by something it does not publish (an entity id, most likely). Ranking
 *  by the numbers alone gives them BOTH 5th, which is the only thing the
 *  numbers actually say. So we report 5 and name the tie, and keep CORE's
 *  displayed column separately in `boardRank` — the two disagreeing IS the
 *  fact, and inventing a tiebreak to make them match would be worse. */
function rankIn(rows: EgyptRow[], program: CoreProgram, entity: string) {
  const mine = rows.find((r) => r.entity === entity);
  const approvals = mine?.approvals[program];
  if (mine === undefined || approvals === undefined) return null;
  const scored = rows.filter((r) => r.approvals[program] !== undefined);
  const ahead = scored.filter((r) => (r.approvals[program] as number) > approvals).length;
  const tiedWith = scored
    .filter((r) => r.entity !== entity && r.approvals[program] === approvals)
    .map((r) => r.entity);
  return { rank: ahead + 1, of: scored.length, approvals, tiedWith };
}

// ------------------------------------------------------------------ term label

/** "Term 26.27" — read off CORE's own nav link for Egypt, which is where the
 *  term lives (`/analytics/1609/LC26/` → "LC Term 26.27"). Derived rather
 *  than written down for the same reason the URL is: it rolls over. */
function parseTermLabel(...pages: string[]): string {
  for (const page of pages) {
    const m = new RegExp(
      `href="\\/analytics\\/${EGYPT_COUNTRY_ID}\\/LC\\d+\\/"[^>]*>([^<]*)<`, "i",
    ).exec(page ?? "");
    const term = m ? /Term\s+([\d.]+)/i.exec(cellText(m[1])) : null;
    if (term) return `Term ${term[1]} · to date`;
  }
  // the numbers are always term-to-date on CORE, so say so even when the
  // label itself is missing rather than dropping the qualifier
  return "Term to date";
}

/** The current term's Egyptian table path, read from the homepage's own nav. */
export function egyptTablePath(homeHtml: string): string {
  const m = new RegExp(`\\/analytics\\/${EGYPT_COUNTRY_ID}\\/LC\\d+\\/`, "i").exec(homeHtml);
  return m ? m[0] : EGYPT_TABLE_FALLBACK;
}

// ------------------------------------------------------------------ the reader

/** Both pages in, one structure out. `null` when either half is unreadable —
 *  never throws, whatever CORE serves. */
export function parseCoreRankings(
  homeHtml: string,
  egHtml: string,
  asOf: string = cairoToday(),
): CoreRankings | null {
  try {
    const board = parseBoard(homeHtml);
    const egypt = parseEgyptTable(egHtml);
    if (!board || !egypt) {
      console.error(
        `[core-rankings] unreadable: board=${board ? "ok" : "MISSING"} egypt=${egypt ? "ok" : "MISSING"}`,
      );
      return null;
    }

    const programs: CoreProgramRanking[] = CORE_PROGRAMS.map((program) => {
      const top = board.get(program) ?? [];
      const exact = rankIn(egypt, program, ALEXANDRIA);
      const onBoard = top.find((r) => r.isAlexandria) ?? null;
      return {
        program,
        top,
        alexandria: exact
          ? {
              rank: exact.rank,
              of: exact.of,
              approvals: exact.approvals,
              inTop10: onBoard !== null,
              tiedWith: exact.tiedWith,
              boardRank: onBoard ? onBoard.rank : null,
            }
          : null,
      };
    });

    return { asOf, programs, termLabel: parseTermLabel(egHtml, homeHtml) };
  } catch (e) {
    // CORE is somebody else's HTML — a shape we never anticipated must cost
    // the report its section, never the whole email.
    console.error("[core-rankings] parse failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

let cached: { at: number; value: CoreRankings } | null = null;

async function get(path: string): Promise<string | null> {
  // a hard timeout, so a hanging CORE never stalls the cron that needs it
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${CORE_URL}${path}`, {
      // module memory is the cache (see CACHE_MS) — Next's fetch cache would
      // be dropped by the same revalidatePath sweep we are avoiding
      cache: "no-store",
      headers: { "User-Agent": "Sodio-CRM (AIESEC in Alexandria)" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    console.error(`[core-rankings] fetch ${path} failed:`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The live board + exact ranks, cached ~30 minutes in module memory.
 *
 *  ⚠️ FAILURES ARE NOT CACHED. Holding a `null` for half an hour would turn
 *  one bad minute on CORE's side into a whole report cycle printing "CORE was
 *  unreachable" — the same reasoning that keeps `function-settings` from
 *  caching a failed read (v33.59). A retry costs two GETs on a public page. */
export async function fetchCoreRankings(): Promise<CoreRankings | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const homeHtml = await get("/");
  if (!homeHtml) return null;
  // the Egypt path carries the TERM, so it is read out of the homepage rather
  // than written down — two round trips, once every 30 minutes, on purpose
  const egHtml = await get(egyptTablePath(homeHtml));
  if (!egHtml) return null;

  const parsed = parseCoreRankings(homeHtml, egHtml);
  if (parsed) cached = { at: Date.now(), value: parsed };
  return parsed;
}

/** Test seam: drops the module-memory cache. */
export function __clearCoreRankingsCache(): void {
  cached = null;
}

/** Which CORE programmes a Sodio function is judged on.
 *
 *  IGT is iGTa + iGTe and OGT is oGTa + oGTe, because CORE splits Talent from
 *  Teacher and Sodio does not. B2B and BD get all three incoming rows: they
 *  raise for the WHOLE ICX, so their opens land in somebody else's lane by
 *  design (v9) and a single-programme section would credit them with a
 *  fraction of their own work. B2C has no CORE programme at all — it is the
 *  LC's own customer work, it never reaches EXPA, and the report omits the
 *  section rather than printing an empty one.
 *
 *  Anything else (TM, F&L, CXP, IM) gets `[]` for the same reason.
 *  A whole-LC report wants the `Total` row, which is not a function: read it
 *  straight off `rankings.programs`. */
const FUNCTION_PROGRAMS: Record<string, CoreProgram[]> = {
  IGV: ["iGV"],
  IGT: ["iGTa", "iGTe"],
  OGV: ["oGV"],
  OGT: ["oGTa", "oGTe"],
  B2B: ["iGV", "iGTa", "iGTe"],
  BD: ["iGV", "iGTa", "iGTe"],
  B2C: [],
};

export function rankingsForFunction(r: CoreRankings, fn: string): CoreProgramRanking[] {
  const wanted = FUNCTION_PROGRAMS[(fn ?? "").trim().toUpperCase()] ?? [];
  return wanted
    .map((p) => r.programs.find((x) => x.program === p))
    .filter((x): x is CoreProgramRanking => x !== undefined);
}
