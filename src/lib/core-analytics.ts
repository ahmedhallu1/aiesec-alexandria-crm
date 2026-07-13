import "server-only";

/** CORE (core.aiesec.org.eg) — AIESEC Egypt's national analytics dashboard.
 *  Its pages are server-rendered and public, so The Blue Man can quote LIVE
 *  numbers: the national product rankings (who is #1 on core) and AIESEC in
 *  Alexandria's own funnel (sign-ups → applicants → approved → realized).
 *
 *  Fetches ride Next's data cache (revalidated every 15 min) and every parse
 *  is best-effort: when CORE is down the assistant simply says so. */

const CORE_URL = "https://core.aiesec.org.eg";
/** Alexandria's LC id on CORE (from the public LC menu). */
const ALEXANDRIA_LC_ID = 899;
const REVALIDATE_SECONDS = 900;

/** Strips a CORE page down to the readable text of its MAIN content (the nav
 *  is a ~500KB list of every entity on earth — the marker skips it). */
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

async function fetchCorePage(path: string, cap: number): Promise<string | null> {
  try {
    const res = await fetch(`${CORE_URL}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { "User-Agent": "Sodio-CRM (AIESEC in Alexandria)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = extractMainText(html, cap);
    return text.length > 100 ? text : null;
  } catch (e) {
    console.error(`[core] fetch ${path} failed:`, e);
    return null;
  }
}

/** Live CORE digest for the assistant context. */
export async function buildCoreContext(): Promise<string> {
  const [national, alexandria] = await Promise.all([
    fetchCorePage("/", 6000),
    fetchCorePage(`/analytics/lc/${ALEXANDRIA_LC_ID}/`, 5000),
  ]);

  if (!national && !alexandria)
    return "### CORE (AIESEC Egypt analytics)\nCORE (core.aiesec.org.eg) is unreachable right now — say the live numbers are temporarily unavailable and suggest opening https://core.aiesec.org.eg directly.";

  return `### CORE — AIESEC Egypt LIVE analytics (core.aiesec.org.eg, refreshed ≤15 min)
Numbers below are extracted from CORE's live pages. "(N)" after an LC name in a
ranking row is that LC's count; rows are ordered best-first, so the first LC
named on a product row is #1 in Egypt for that product/stage. iGV/iGTa/iGTe =
incoming (ICX, what Sodio raises for); oGV/oGTa/oGTe = outgoing.

${national ? `--- National dashboard (rankings & totals) ---\n${national}` : "National dashboard unavailable right now."}

${alexandria ? `--- AIESEC in Alexandria on CORE (LC ${ALEXANDRIA_LC_ID}) ---\n${alexandria}` : "Alexandria's CORE page unavailable right now."}`;
}
