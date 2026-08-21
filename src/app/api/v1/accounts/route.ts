import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { verifyApiKey } from "@/server/api-keys";
import { normalizeName } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/v1/accounts — EVERY NAME THE ICX AND BD FLOORS ALREADY HOLD.
 *
 *  Built for one job: a tool doing automatic market research needs to know
 *  what NOT to add. So it returns names, and nothing else — no phones, no
 *  emails, no owners, no stage, no deal values. A leaked key is then worth
 *  exactly one thing: the list of companies this LC has already touched.
 *
 *  IT INCLUDES THE ARCHIVE AND THE BLACKLIST ON PURPOSE. An MR tool that
 *  skipped them would keep proposing names the LC burned months ago, which is
 *  the single most annoying thing it could do. Everything in this response
 *  means "we already know this one".
 *
 *  B2C is excluded: it is a separate name world (migration 0052), so a B2C
 *  name does not block an ICX one and listing it would produce false skips.
 *
 *  Auth: `Authorization: Bearer sodio_…`. Header only — a key in a query
 *  string ends up in server logs, browser history and referrers.
 */

/** the ICX + BD name worlds — what "ICX and B2B" means in the schema */
const FUNCTIONS = ["IGV", "IGT", "B2B", "BD"];
const PAGE = 1000;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : null;
  const key = await verifyApiKey(presented);
  if (!key) {
    return NextResponse.json(
      { error: "unauthorized", hint: "Send Authorization: Bearer <your Sodio API key>." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  const names: string[] = [];

  // accounts — active AND archived, paged past Supabase's 1000-row cap
  for (let off = 0; off < 40000; off += PAGE) {
    const { data, error } = await db()
      .from("accounts")
      .select("name")
      .in("function", FUNCTIONS)
      .eq("is_test", false)
      .order("name")
      .order("id")
      .range(off, off + PAGE - 1);
    if (error) {
      console.error("[api/v1/accounts] accounts query failed:", error.message);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
    for (const r of data ?? []) if (r.name) names.push(r.name as string);
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
    if (error) {
      console.error("[api/v1/accounts] blacklist query failed:", error.message);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
    for (const r of data ?? []) if (r.account_name) names.push(r.account_name as string);
    if ((data ?? []).length < PAGE) break;
  }

  // de-duplicate on the SAME normalization the add-account check uses, so the
  // caller can compare without reimplementing it — and ship that form too
  const seen = new Map<string, string>();
  for (const n of names) {
    const norm = normalizeName(n);
    if (norm && !seen.has(norm)) seen.set(norm, n);
  }
  const accounts = [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([normalized, name]) => ({ name, normalized }));

  return NextResponse.json(
    {
      count: accounts.length,
      generated_at: new Date().toISOString(),
      note:
        "Every name here is already known to AIESEC in Alexandria (active, archived or blacklisted) " +
        "— do not add it again. Compare on `normalized`.",
      accounts,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
