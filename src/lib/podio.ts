import "server-only";
import { db } from "@/lib/supabase";
import { PODIO_FORM_URL } from "@/lib/types";

/** Automatic "does this company already exist on Podio?" check.
 *
 *  WHAT THE MEMBER DOES BY HAND: open the national partners web-form, type the
 *  company into the "Check if your company exists?" field, and read the
 *  dropdown. If the name is there, the partner already belongs to another LC
 *  and must NOT be submitted again; if it isn't, they fill the form.
 *
 *  HOW THIS AUTOMATES IT: that field is a Podio app-reference field, and typing
 *  in it fires a LIVE search against the whole Companies app:
 *
 *      GET /webforms/<form>/<rev>/items_search?field_id=<id>&query=<q>&limit=50
 *
 *  It is public — no API key, no token, no cookie — and returns the same
 *  ordered list the member sees, best match first. We call the very same
 *  endpoint with the very same query, so our answer IS the dropdown's answer.
 *
 *  (v32 shipped a first version that parsed the ~300 <option> tags embedded in
 *  the form's HTML. That was wrong: those options are only the dropdown's
 *  initial page, so anything outside them — "Gateway", for one — came back as
 *  "not on Podio". The endpoint below has no such ceiling.)
 */

/** Field lookup: the reference field carrying the partner list. Discovered
 *  from the form so a Podio revision can't silently break the check; the
 *  known id is only the fallback. */
const FIELD_EXTERNAL_ID = "relationship-2";
const FIELD_ID_FALLBACK = "238040132";
const FIELD_CACHE_KEY = "podio:field-id";
const FIELD_TTL_MS = 24 * 60 * 60 * 1000;

/** Search results are cached briefly per query — the add-account dialog fires
 *  on a debounce while typing, and the same name is often re-checked. */
const QUERY_TTL_MS = 10 * 60 * 1000;
const queryCache = new Map<string, { at: number; titles: string[] }>();

export interface PodioCheck {
  /** exists  — an exact (case-insensitive) match: do NOT submit it again
   *  free    — Podio's own search returned no exact match
   *  unknown — Podio was unreachable; fall back to the manual link */
  status: "exists" | "free" | "unknown";
  /** the matched partner exactly as Podio spells it */
  match?: string;
  /** other results Podio returned for the same query — near-misses worth a
   *  glance before submitting a differently-spelled duplicate */
  similar: string[];
}

const UNKNOWN: PodioCheck = { status: "unknown", similar: [] };

/** Case/spacing are noise; everything else is significant. The user asked for
 *  an EXACT match, so "Gateway" must not match "Gateway Urban". */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** `https://podio.com/webforms/25879454/1936053` → its base for sub-paths. */
function formBase(): string | null {
  const m = /^(https?:\/\/[^\s]*\/webforms\/\d+\/\d+)/.exec(PODIO_FORM_URL ?? "");
  return m ? m[1] : null;
}

async function fetchText(url: string, ms = 8_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      // the form is public; identify ourselves rather than spoofing a browser
      headers: { "User-Agent": "Sodio-CRM/1.0 (AIESEC in Alexandria)" },
      signal: AbortSignal.timeout(ms),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error("[podio] fetch failed:", url, e);
    return null;
  }
}

/** The reference field's id, read out of the form's embedded config and cached
 *  for a day. Falls back to the known id so a parse change degrades to "still
 *  works" rather than "silently stops checking". */
async function fieldId(): Promise<string> {
  try {
    const { data } = await db()
      .from("app_settings")
      .select("value")
      .eq("key", FIELD_CACHE_KEY)
      .maybeSingle<{ value: { id: string; at: string } }>();
    if (data?.value?.id && Date.now() - new Date(data.value.at).getTime() < FIELD_TTL_MS)
      return data.value.id;
  } catch {
    /* cache miss is fine */
  }

  let id = FIELD_ID_FALLBACK;
  const html = PODIO_FORM_URL ? await fetchText(PODIO_FORM_URL) : null;
  if (html) {
    // the field config looks like: {"id":238040132,"field_id":238040132,
    //   "type":"app","external_id":"relationship-2",...}
    const m = new RegExp(
      `\\{"id":(\\d+),"field_id":\\d+,"type":"app","external_id":"${FIELD_EXTERNAL_ID}"`
    ).exec(html);
    if (m) id = m[1];
    else console.warn("[podio] field id not found in the form — using the fallback");
  }

  try {
    await db()
      .from("app_settings")
      .upsert(
        {
          key: FIELD_CACHE_KEY,
          value: { id, at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );
  } catch {
    /* caching is best-effort */
  }
  return id;
}

/** Asks Podio's own dropdown search for this name and returns the titles it
 *  offered, best match first — or null if Podio couldn't be reached. */
async function searchPodio(query: string): Promise<string[] | null> {
  const key = norm(query);
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < QUERY_TTL_MS) return hit.titles;

  const base = formBase();
  if (!base) return null;
  const url = `${base}/items_search?field_id=${encodeURIComponent(
    await fieldId()
  )}&query=${encodeURIComponent(query.trim())}&limit=50`;

  const body = await fetchText(url);
  if (body == null) return null;

  const titles = parseSearchResults(body);
  if (titles === null) return null;

  // keep the cache from growing without bound across a long-lived instance
  if (queryCache.size > 500) queryCache.clear();
  queryCache.set(key, { at: Date.now(), titles });
  return titles;
}

/** Pulls the partner titles out of Podio's items_search response.
 *
 *  Exported so it can be tested against real and hostile payloads: this parses
 *  a THIRD PARTY's JSON, so it must never throw into the request and must
 *  never turn a shape change into a confident "no match" (which would tell a
 *  member to submit a duplicate). Returns null when the body is unusable, so
 *  the caller can say "unknown" instead of "free".
 *
 *  Shape: [{ name, data: {...app...}, contents: [{ title, ... }] }] */
export function parseSearchResults(body: string): string[] | null {
  try {
    const parsed = JSON.parse(body) as { contents?: { title?: string }[] }[];
    if (!Array.isArray(parsed)) return null;
    const entry = parsed.find((e) => Array.isArray(e?.contents));
    // a well-formed response with no matches is an EMPTY list, not a failure
    if (!entry) return parsed.length > 0 ? [] : null;
    return (entry.contents ?? [])
      .map((c) => (typeof c?.title === "string" ? c.title : ""))
      .filter(Boolean);
  } catch (e) {
    console.error("[podio] could not parse the search response:", e);
    return null;
  }
}

export async function checkPodioCompany(name: string): Promise<PodioCheck> {
  const clean = (name ?? "").trim();
  if (clean.length < 2) return UNKNOWN;

  const titles = await searchPodio(clean);
  // Podio unreachable → say nothing rather than a confident "go ahead"
  if (titles == null) return UNKNOWN;

  const target = norm(clean);
  const exact = titles.find((t) => norm(t) === target);
  if (exact) return { status: "exists", match: exact, similar: [] };

  return {
    status: "free",
    // everything the search DID return for this query, minus exact repeats
    similar: [...new Set(titles)].slice(0, 5),
  };
}
