import "server-only";
import { db } from "@/lib/supabase";
import { PODIO_FORM_URL } from "@/lib/types";

/** Automatic "does this company already exist on Podio?" check (v32).
 *
 *  WHAT THE MEMBER DOES BY HAND TODAY: open the national partners web-form,
 *  type the company into the "Check if your company exists?" field, and read
 *  the dropdown. If the name is there, the partner already belongs to another
 *  LC and must NOT be submitted again; if it isn't, they fill the form.
 *
 *  HOW THIS AUTOMATES IT: that field is a plain `<select>` whose options are
 *  rendered straight into the form's HTML — no API, no key, no auth, and (we
 *  checked) no AJAX search behind it. The dropdown the member scrolls IS this
 *  list. So we fetch the same page and read the same options.
 *
 *  ⚠️ THE CEILING IS REAL AND IT IS PODIO'S: the form embeds only the ~300
 *  most recent partners (ordered newest first). A partner older than that is
 *  invisible here — but it is equally invisible to the member doing it by
 *  hand, because their dropdown is filtered client-side over these very
 *  options. This check is therefore exactly as complete as the manual one,
 *  never less. `listSize` is surfaced to the UI so the wording can stay
 *  honest rather than promising a full-registry answer.
 */

/** The field that carries the partner list ("Check if your company exists?"). */
const FIELD_NAME = "fields[relationship-2]";

/** How long a fetched list stays warm. The add-account dialog checks on every
 *  keystroke (debounced), so without this we would hammer podio.com. */
const TTL_MS = 30 * 60 * 1000;
const CACHE_KEY = "podio:companies";

export interface PodioCompany {
  /** Podio item id — the <option value> */
  id: string;
  name: string;
}

export interface PodioCheck {
  /** exists   — an exact (case-insensitive) match: do NOT submit it again
   *  free     — not in the list: the member still has to submit it on Podio
   *  unknown  — Podio was unreachable; fall back to the manual link */
  status: "exists" | "free" | "unknown";
  /** the matched partner exactly as Podio spells it */
  match?: string;
  /** near-misses worth eyeballing before trusting a "free" verdict */
  similar: string[];
  /** how many partners the form exposed (Podio's own ceiling, ~300) */
  listSize: number;
  /** when the underlying list was fetched */
  checkedAt: string | null;
}

interface CachedList {
  companies: PodioCompany[];
  fetchedAt: string;
}

/** Pulls the partner list out of the public web-form's HTML. */
export function parsePodioCompanies(html: string): PodioCompany[] {
  const select = new RegExp(
    `<select[^>]*name="${FIELD_NAME.replace(/[[\]]/g, "\\$&")}"[^>]*>([\\s\\S]*?)</select>`
  ).exec(html);
  if (!select) return [];
  const out: PodioCompany[] = [];
  const option = /<option value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g;
  let m: RegExpExecArray | null;
  while ((m = option.exec(select[1])) !== null) {
    const name = decodeEntities(m[2]).trim();
    if (name) out.push({ id: m[1], name });
  }
  return out;
}

/** The handful of entities Podio actually emits in company names. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function readCache(): Promise<CachedList | null> {
  try {
    const { data } = await db()
      .from("app_settings")
      .select("value")
      .eq("key", CACHE_KEY)
      .maybeSingle<{ value: CachedList }>();
    if (!data?.value?.fetchedAt || !Array.isArray(data.value.companies)) return null;
    return data.value;
  } catch {
    return null;
  }
}

async function writeCache(list: CachedList): Promise<void> {
  try {
    await db()
      .from("app_settings")
      .upsert(
        { key: CACHE_KEY, value: list, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
  } catch (e) {
    console.error("[podio] cache write failed:", e);
  }
}

/** The partner list, cached for TTL_MS. A failed fetch falls back to the last
 *  good list (stale beats nothing) and only returns null if we never had one. */
export async function podioCompanies(force = false): Promise<CachedList | null> {
  const cached = await readCache();
  const fresh =
    cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS;
  if (cached && fresh && !force) return cached;
  if (!PODIO_FORM_URL) return cached;

  try {
    const res = await fetch(PODIO_FORM_URL, {
      // the form is public; identify ourselves rather than spoofing a browser
      headers: { "User-Agent": "Elevate-CRM/1.0 (AIESEC in Alexandria)" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const companies = parsePodioCompanies(await res.text());
    // an empty parse means Podio changed the form's shape — keep the old list
    // rather than telling everyone their company is free to submit
    if (companies.length === 0) {
      console.error("[podio] parsed 0 companies — form markup changed?");
      return cached;
    }
    const list = { companies, fetchedAt: new Date().toISOString() };
    await writeCache(list);
    return list;
  } catch (e) {
    console.error("[podio] fetch failed:", e);
    return cached;
  }
}

/** Normalized for comparison: case, surrounding space and repeated inner
 *  spaces are noise. Everything else is left alone — the user asked for an
 *  EXACT (case-insensitive) match, so "Hadana" must not match "Hadana Moves". */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Loose key for the "did you mean" hints only — never for the verdict. */
const loose = (s: string) => norm(s).replace(/[^a-z0-9؀-ۿ]/g, "");

export async function checkPodioCompany(name: string): Promise<PodioCheck> {
  const clean = (name ?? "").trim();
  const empty: PodioCheck = {
    status: "unknown",
    similar: [],
    listSize: 0,
    checkedAt: null,
  };
  if (clean.length < 2) return empty;

  const list = await podioCompanies();
  if (!list) return empty;

  const target = norm(clean);
  const exact = list.companies.find((c) => norm(c.name) === target);
  if (exact) {
    return {
      status: "exists",
      match: exact.name,
      similar: [],
      listSize: list.companies.length,
      checkedAt: list.fetchedAt,
    };
  }

  // not an exact match — offer the near-misses so a member who typed
  // "Nestcity5" instead of "nest.city5" still spots it
  const key = loose(clean);
  const similar = key.length >= 3
    ? list.companies
        .filter((c) => {
          const k = loose(c.name);
          return k === key || (k.length >= 3 && (k.includes(key) || key.includes(k)));
        })
        .map((c) => c.name)
        .slice(0, 5)
    : [];

  return {
    status: "free",
    similar,
    listSize: list.companies.length,
    checkedAt: list.fetchedAt,
  };
}
