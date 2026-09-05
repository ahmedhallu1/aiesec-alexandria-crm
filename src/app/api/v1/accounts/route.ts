import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/supabase";
import { overRateLimit, verifyApiKey, type VerifiedKey } from "@/server/api-keys";
import { normalizeName } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/v1/accounts — the account names this LC already holds.
 *
 *  Built for one job: a tool doing automatic market research needs to know
 *  what NOT to add. What a caller gets back is decided by THEIR KEY, not by
 *  the request — functions, field depth, whether the archive is included — so
 *  a key issued to dedupe names can never be talked into returning phones.
 *
 *  IT INCLUDES THE ARCHIVE AND THE BLACKLIST (unless the key says otherwise).
 *  An MR tool that skipped them would keep proposing names the LC burned
 *  months ago, which is the most annoying thing it could do.
 *
 *  Auth: `Authorization: Bearer sodio_…`. Header only — a key in a query
 *  string ends up in server logs, browser history and referrers.
 *
 *  ── WHY THIS IS CHEAP ────────────────────────────────────────────────────
 *  Vercel is on Hobby and already past its CPU allowance, so a polling
 *  integration is the whole LC's problem. Three defences, in order:
 *    · a MODULE-MEMORY snapshot shared by every key (module memory, not
 *      unstable_cache — `revalidatePath("/", "layout")` runs on ~94 write
 *      paths and would evict it continuously, the v33.46 lesson);
 *    · an ETag, so a well-behaved client gets a 304 with no body at all;
 *    · a per-key hourly ceiling.
 */
const PAGE = 1000;
const TTL_MS = 5 * 60 * 1000;

type Row = {
  name: string;
  /** v36 — null for the unclaimed research pool: nobody has decided which
   *  function it belongs to yet, and a client that dedupes on names needs to
   *  see it regardless. Serialised as null, never guessed. */
  function: string | null;
  archived: boolean;
  product: string | null;
  responsible: string | null;
  created_at: string | null;
  contacts: unknown;
  email: string | null;
  phone: string | null;
  social_link: string | null;
};

let snapshot: { at: number; rows: Row[] } | null = null;

/** One read for every key. Refreshed at most once every 5 minutes. */
async function allRows(): Promise<Row[]> {
  if (snapshot && Date.now() - snapshot.at < TTL_MS) return snapshot.rows;
  const rows: Row[] = [];
  for (let off = 0; off < 40000; off += PAGE) {
    const { data, error } = await db()
      .from("accounts")
      .select(
        "name, function, out_of_process, product, created_at, contacts, email, phone, " +
          "social_link, responsible:members!accounts_responsible_id_fkey(name)"
      )
      .eq("is_test", false)
      .order("name")
      .order("id")
      .range(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      if (!r.name) continue;
      rows.push({
        name: r.name as string,
        function: (r.function as string | null) ?? null,
        archived: !!r.out_of_process,
        product: (r.product as string) ?? null,
        responsible: ((r.responsible as { name?: string } | null)?.name) ?? null,
        created_at: (r.created_at as string) ?? null,
        contacts: r.contacts ?? null,
        email: (r.email as string) ?? null,
        phone: (r.phone as string) ?? null,
        social_link: (r.social_link as string) ?? null,
      });
    }
    if ((data ?? []).length < PAGE) break;
  }
  // the manual blacklist — names burned before the CRM existed, which block a
  // re-add exactly like an archived account
  for (let off = 0; off < 40000; off += PAGE) {
    const { data, error } = await db()
      .from("blacklist")
      .select("account_name")
      .order("account_name")
      .order("id")
      .range(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? [])
      if (r.account_name)
        rows.push({
          name: r.account_name as string,
          function: "BLACKLIST",
          archived: true,
          product: null, responsible: null, created_at: null,
          contacts: null, email: null, phone: null, social_link: null,
        });
    if ((data ?? []).length < PAGE) break;
  }
  snapshot = { at: Date.now(), rows };
  return rows;
}

function shape(r: Row, fields: VerifiedKey["fields"]) {
  const base = { name: r.name, normalized: normalizeName(r.name) };
  if (fields === "names") return base;
  const mid = {
    ...base,
    function: r.function,
    archived: r.archived,
    product: r.product,
    responsible: r.responsible,
    added: r.created_at ? r.created_at.slice(0, 10) : null,
  };
  if (fields === "pipeline") return mid;
  return {
    ...mid,
    // the tagged list is the real one; the flat columns are the legacy
    // first-of-kind mirrors the sheets still read
    contacts: r.contacts,
    email: r.email,
    phone: r.phone,
    link: r.social_link,
  };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : null;
  const key = await verifyApiKey(presented);
  if (typeof key === "string") {
    const why =
      key === "revoked"
        ? "That key has been revoked. Ask the IM team for a new one."
        : key === "expired"
          ? "That key has expired. Ask the IM team for a new one."
          : "Send Authorization: Bearer <your Sodio API key>.";
    return NextResponse.json(
      { error: key === "unknown" ? "unauthorized" : key, hint: why },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }
  if (await overRateLimit(key)) {
    return NextResponse.json(
      { error: "rate_limited", hint: `This key allows ${key.ratePerHour} requests an hour.` },
      { status: 429, headers: { "Retry-After": "600" } }
    );
  }

  let rows: Row[];
  try {
    rows = await allRows();
  } catch (e) {
    console.error("[api/v1/accounts] read failed:", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const allowed = new Set([...key.functions, "BLACKLIST"]);
  const seen = new Map<string, Row>();
  for (const r of rows) {
    // ⚠️ v36 — THE UNCLAIMED POOL IS NOT DROPPED. `allowed.has(null)` is false,
    // so a function-less research row silently fell out of every response —
    // including a names-only key whose entire job is duplicate detection,
    // which would then have told an integration a name was free when Sodio
    // already holds it. Nobody has decided which function these belong to; a
    // key scoped to ANY raising function should still see them, and the shape
    // reports `function: null` rather than guessing one.
    const poolRow = r.function == null && !r.archived;
    if (!poolRow && !(r.function && allowed.has(r.function))) continue;
    if (r.archived && !key.includeArchived) continue;
    const norm = normalizeName(r.name);
    if (norm && !seen.has(norm)) seen.set(norm, r);
  }
  const accounts = [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, r]) => shape(r, key.fields));

  const body = {
    count: accounts.length,
    generated_at: new Date(snapshot?.at ?? Date.now()).toISOString(),
    scope: {
      functions: key.functions,
      fields: key.fields,
      includes_archived: key.includeArchived,
    },
    note:
      "Every name here is already known to AIESEC in Alexandria (active, archived or " +
      "blacklisted) — do not add it again. Compare on `normalized`.",
    accounts,
  };

  // a client that sends If-None-Match gets a 304 and no body — the cheapest
  // possible answer, and the reason this can be polled without hurting
  const etag = `W/"${createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 32)}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }
  return NextResponse.json(body, {
    headers: { ETag: etag, "Cache-Control": "private, max-age=60" },
  });
}
