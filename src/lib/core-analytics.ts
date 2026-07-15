import "server-only";

/** CORE (core.aiesec.org.eg) — AIESEC's analytics dashboard for the Egypt MC,
 *  but its rankings are GLOBAL (every LC in every country). Its pages are
 *  server-rendered and public, so The Blue Man can quote LIVE numbers:
 *   - GLOBAL top-performing LC rankings per product & stage (approvals /
 *     realized / completes) — this is where "who is #1 in OGV" for ANY country
 *     (Türkiye, Egypt, Tunisia…) comes from;
 *   - the Egypt national dashboard (totals + Egypt-only rankings);
 *   - AIESEC in Alexandria's own funnel.
 *
 *  Fetches ride Next's data cache (revalidated every 15 min) and every parse is
 *  best-effort: when CORE is down the assistant simply says so. */

const CORE_URL = "https://core.aiesec.org.eg";
/** Alexandria's LC id on CORE (from the public LC menu). */
const ALEXANDRIA_LC_ID = 899;
const REVALIDATE_SECONDS = 900;

async function fetchCore(path: string): Promise<string | null> {
  // hard timeout so a slow/hanging CORE never stalls the request that needs it
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${CORE_URL}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { "User-Agent": "Sodio-CRM (AIESEC in Alexandria)" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    console.error(`[core] fetch ${path} failed:`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Strips a CORE page down to the readable text of its MAIN content (the nav is
 *  a ~500KB list of every entity on earth — the marker skips it). */
function extractMainText(html: string, cap: number): string {
  // the homepage's content starts at .main-container, LC pages at .container-fluid
  let marker = html.search(/<div[^>]+class="[^"]*main-container[^"]*"/);
  if (marker < 0) marker = html.search(/<div[^>]+class="[^"]*container-fluid[^"]*"/);
  let raw = marker > 0 ? html.slice(marker) : html;
  raw = raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  const text = raw
    .replace(/<\/(tr|table|h\d|p|li|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.slice(0, cap);
}

// ------------------------------------------------------------------ global rankings

/** Tab-pane id → human label on the /top-performing-lcs/ page. Keys are the
 *  server-rendered pane ids (igt=IGTa, ige=IGTe, ogt=OGTa, oge=OGTe). */
const TOP_PANES: Record<string, string> = {
  total_approvals: "Total · Approvals", igv_approved: "IGV · Approvals",
  igt_approved: "IGTa · Approvals", ige_approved: "IGTe · Approvals",
  ogv_approved: "OGV · Approvals", ogt_approved: "OGTa · Approvals",
  oge_approved: "OGTe · Approvals",
  total_realized: "Total · Realized", igv_realized: "IGV · Realized",
  igt_realized: "IGTa · Realized", ige_realized: "IGTe · Realized",
  ogv_realized: "OGV · Realized", ogt_realized: "OGTa · Realized",
  oge_realized: "OGTe · Realized",
  total_completes: "Total · Completes", igv_completes: "IGV · Completes",
  igt_completes: "IGTa · Completes", ige_completes: "IGTe · Completes",
  ogv_completes: "OGV · Completes", ogt_completes: "OGTa · Completes",
  oge_completes: "OGTe · Completes",
};

/** Extracts the top-N ranking rows from one tab-pane segment. Rows read as
 *  "rank · LC name · (Country) - (Region) · value". */
function parseRankingRows(seg: string, topN: number): string[] {
  const flat = seg
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n");
  const toks = flat.split("\n").map((s) => s.trim()).filter(Boolean);
  const rows: string[] = [];
  let i = 0;
  while (i < toks.length && rows.length < topN) {
    if (/^\d+$/.test(toks[i])) {
      const rank = toks[i];
      const name = toks[i + 1] ?? "";
      const country = (toks[i + 2] ?? "").replace(/[()\-\s]+$/, "").replace(/^\(/, "");
      let j = i + 3;
      let val: string | null = null;
      while (j < Math.min(i + 7, toks.length)) {
        if (/^\d+$/.test(toks[j])) { val = toks[j]; break; }
        j++;
      }
      if (name && val && !/^\d+$/.test(name)) {
        rows.push(`${rank}. ${name} (${country}) — ${val}`);
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return rows;
}

/** GLOBAL top-performing LC rankings per product & stage (all countries). */
async function buildGlobalRankings(topN: number): Promise<string | null> {
  const html = await fetchCore("/top-performing-lcs/");
  if (!html) return null;
  // locate each pane in document order, then slice pane→next-pane
  const positions = Object.keys(TOP_PANES)
    .map((id) => ({ id, at: html.search(new RegExp(`id="${id}"`)) }))
    .filter((p) => p.at >= 0)
    .sort((a, b) => a.at - b.at);
  if (positions.length === 0) return null;

  const blocks: string[] = [];
  for (let k = 0; k < positions.length; k++) {
    const { id, at } = positions[k];
    const end = k + 1 < positions.length ? positions[k + 1].at : at + 9000;
    const rows = parseRankingRows(html.slice(at, end), topN);
    if (rows.length > 0) blocks.push(`${TOP_PANES[id]}:\n${rows.join("\n")}`);
  }
  return blocks.length ? blocks.join("\n\n") : null;
}

// ------------------------------------------------------------------ digest

/** Live CORE digest for the assistant context. */
export async function buildCoreContext(): Promise<string> {
  const [globalRankings, nationalHtml, alexandriaHtml] = await Promise.all([
    buildGlobalRankings(8),
    fetchCore("/"),
    fetchCore(`/analytics/lc/${ALEXANDRIA_LC_ID}/`),
  ]);
  const national = nationalHtml ? extractMainText(nationalHtml, 4500) : null;
  const alexandria = alexandriaHtml ? extractMainText(alexandriaHtml, 4000) : null;

  if (!globalRankings && !national && !alexandria)
    return "### CORE analytics\nCORE (core.aiesec.org.eg) is unreachable right now — say the live numbers are temporarily unavailable and suggest opening https://core.aiesec.org.eg directly.";

  return `### CORE — LIVE AIESEC analytics (core.aiesec.org.eg, refreshed ≤15 min)
CORE covers **every AIESEC LC in every country** (not just Egypt). Rows are
ordered best-first, so the first LC on a line is #1 GLOBALLY for that
product/stage; each LC shows its (Country) and its count. iGV/iGTa/iGTe =
incoming (ICX); oGV/oGTa/oGTe = outgoing. Use these to answer ranking questions
about ANY LC or country (e.g. top LCs in OGV in Türkiye = filter the OGV list to
Türkiye rows).

--- GLOBAL top-performing LCs (all countries, top 8 each) ---
${globalRankings ?? "Global rankings unavailable right now — use Google Search on core.aiesec.org.eg."}

--- Egypt national dashboard (Egypt totals + Egypt-only rankings) ---
${national ?? "National dashboard unavailable right now."}

--- AIESEC in Alexandria on CORE (our LC, id ${ALEXANDRIA_LC_ID}) ---
${alexandria ?? "Alexandria's CORE page unavailable right now."}`;
}
