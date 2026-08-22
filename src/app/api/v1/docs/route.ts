import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyApiKey } from "@/server/api-keys";

export const dynamic = "force-dynamic";

/** GET /api/v1/docs — the whole API in one Markdown file.
 *
 *  Most people will hand this straight to an AI and ask it to write the
 *  integration, so it is ONE self-contained document: auth, the exact shape of
 *  every response, the errors, the rate limit and a worked example. It also
 *  states THIS key's own scope, because "why am I not getting phone numbers"
 *  is otherwise a support conversation.
 *
 *  Authenticated on purpose: the docs name real field structures. */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : null;
  const key = await verifyApiKey(presented);
  if (typeof key === "string") {
    return NextResponse.json(
      { error: "unauthorized", hint: "Send Authorization: Bearer <your Sodio API key>." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  const base = `${env.appUrl}/api/v1`;
  const fieldsDoc =
    key.fields === "names"
      ? `\`\`\`json
{ "name": "Hadana Moves", "normalized": "hadana moves" }
\`\`\`
Your key is scoped to **names only**. That is everything it will ever return —
enough to answer "do we already have this?" and nothing more.`
      : key.fields === "pipeline"
        ? `\`\`\`json
{
  "name": "Hadana Moves",
  "normalized": "hadana moves",
  "function": "IGV",
  "archived": false,
  "product": null,
  "responsible": "Mariam Hassan",
  "added": "2026-07-14"
}
\`\`\`
\`product\` is only set on IGT accounts (\`GTa\` / \`GTe\`). \`archived: true\` means
the name is burned — never propose it again.`
        : `\`\`\`json
{
  "name": "Hadana Moves",
  "normalized": "hadana moves",
  "function": "IGV",
  "archived": false,
  "product": null,
  "responsible": "Mariam Hassan",
  "added": "2026-07-14",
  "contacts": [{ "value": "+201012345678", "tag": "Whatsapp" }],
  "email": "info@example.com",
  "phone": "+201012345678",
  "link": "https://instagram.com/example"
}
\`\`\`
\`contacts\` is the tagged list and is the real one; \`email\` / \`phone\` / \`link\`
are legacy first-of-kind mirrors kept for the Google Sheets exports.
**This is partner contact data — treat it accordingly.**`;

  const md = `# Sodio Accounts API

Read-only. One endpoint. It answers a single question: **which company names does
AIESEC in Alexandria already hold?** — so an automatic market-research tool never
proposes a name that is already taken, already worked, or already burned.

- Base URL: \`${base}\`
- Auth: \`Authorization: Bearer <your key>\` — **header only**. A key in a query
  string ends up in server logs, browser history and referrer headers.
- Your key: **${key.label}**

## Your key's scope

| Setting | Value |
| --- | --- |
| Functions | ${key.functions.join(", ") || "(none)"} |
| Field depth | \`${key.fields}\` |
| Includes archived / blacklisted | ${key.includeArchived ? "yes" : "no"} |
| Rate limit | ${key.ratePerHour} requests per hour |

Scope is decided by the KEY, not by the request. There are no query parameters
that widen it — asking for more just returns the same thing.

## GET /accounts

\`\`\`bash
curl -s "${base}/accounts" \\
  -H "Authorization: Bearer $SODIO_KEY"
\`\`\`

\`\`\`json
{
  "count": 4444,
  "generated_at": "2026-08-22T12:00:00.000Z",
  "scope": { "functions": ${JSON.stringify(key.functions)}, "fields": "${key.fields}", "includes_archived": ${key.includeArchived} },
  "note": "Every name here is already known …",
  "accounts": [ … ]
}
\`\`\`

Each entry looks like:

${fieldsDoc}

### The one rule

**Everything in \`accounts\` means "we already know this one — do not add it."**
That deliberately includes archived and blacklisted names${key.includeArchived ? "" : " (your key excludes them, so you will only see live ones)"}:
a tool that skipped them would keep re-proposing companies the LC burned months
ago.

### Matching

Compare on \`normalized\`, not \`name\`. It is the same normalisation Sodio's own
duplicate check uses — lowercased, whitespace collapsed — so
\`"  Hadana   Moves "\` and \`"hadana moves"\` are one company.

\`\`\`js
const known = new Set(data.accounts.map(a => a.normalized));
const isNew = (name) =>
  !known.has(name.toLowerCase().replace(/\\s+/g, " ").trim());
\`\`\`

## Caching — please use it

This runs on a plan that is already at its CPU ceiling. The response carries an
\`ETag\`; send it back and you get \`304 Not Modified\` with no body:

\`\`\`bash
curl -s "${base}/accounts" \\
  -H "Authorization: Bearer $SODIO_KEY" \\
  -H 'If-None-Match: W/"…"'
\`\`\`

The underlying snapshot refreshes at most every 5 minutes, so polling faster
than that cannot return anything new. Once or twice an hour is plenty.

## Errors

| Status | Meaning |
| --- | --- |
| \`401 unauthorized\` | No key, or one we don't recognise |
| \`401 revoked\` | The key was switched off — ask the IM team |
| \`401 expired\` | The key passed its expiry date |
| \`429 rate_limited\` | Over ${key.ratePerHour}/hour. \`Retry-After\` says how long |
| \`500 server_error\` | Our side. Retry with backoff |
| \`304\` | Your \`If-None-Match\` matched — nothing changed |

## GET /docs

This document, always reflecting your key's current scope.

---
Sodio · AIESEC in Alexandria. Keys are issued and revoked by the IM team; a
revoked key stops working immediately.
`;

  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sodio-accounts-api.md"',
      "Cache-Control": "no-store",
    },
  });
}
