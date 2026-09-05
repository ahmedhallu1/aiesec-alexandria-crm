import "server-only";
// aliased on purpose: `diffFields` below takes a parameter literally called
// `after` (it reads as before → after, which is the whole point of a diff), and
// shadowing Next's `after` inside it would be a trap waiting for the next
// person who adds a deferred write to this file
import { after as afterResponse } from "next/server";
import { db } from "@/lib/supabase";
import { currentChangeSet } from "./change-set";

/** THE AUDIT TRAIL (v36).
 *
 *  Lifted out of `data.ts`, where it had been one 30-line function writing five
 *  columns. `audit_log` holds 14,184 rows across 102 distinct actions and grows
 *  by ~350 a day, and until now every one of them said only *who did what to
 *  which row* — never what actually changed, never from where, never who was
 *  really behind an impersonated action, and (the gap that mattered most)
 *  **not one authentication event in the entire history of the system**.
 *
 *  `data.ts` re-exports `logAudit` from here, so all ~123 existing call sites
 *  keep working untouched: the five positional parameters are unchanged and
 *  everything new arrives through an optional sixth `opts` argument.
 *
 *  TWO RULES GOVERN THIS FILE, AND THEY OUTRANK COMPLETENESS:
 *
 *  ① **It never throws.** An audit row is a description of an action; a
 *     description failing must never fail the thing it describes. Every path
 *     here ends in a `catch` that logs to the console and returns.
 *
 *  ② **It costs the member as little as possible.** The project sits at *194%*
 *     of its Vercel Fluid Active CPU allowance (AI_CONTEXT v33.59 measured it:
 *     7h45m against a 4h ceiling), so a synchronous INSERT in front of the
 *     response on every one of ~350 daily mutations is not affordable. The
 *     insert therefore runs inside `after()` — the request is already answered
 *     by the time it happens.
 *
 *     ⚠️ THE TRADE-OFF, SAID OUT LOUD: a request that crashes hard, or a lambda
 *     Vercel freezes before the deferred work settles, loses its audit row. The
 *     mutation still happened; the log just never hears about it. That is
 *     accepted — the alternative is paying for a blocking round trip on every
 *     write, and this log is a record for humans, not a ledger anything
 *     reconciles against.
 *
 *  Retention (12 months) is not enforced here — this file only writes. */

export type AuditCategory =
  | "data" // an ordinary row mutation: the account, the deal, the sign-up
  | "auth" // sign-in, sign-out, passwords, Google grants
  | "admin" // admin tools: view-as, test sessions, API keys, broadcasts
  | "access" // a PRIVILEGED READ — a signed file URL, an /api/v1 pull
  | "integration" // Google, Podio, CORE, the sheets, a cron's own work
  | "security"; // a refusal: something was asked for and denied

export type AuditOutcome = "ok" | "denied" | "failed";
export type AuditSeverity = "info" | "notice" | "warn" | "critical";

export interface AuditOpts {
  /** default "data" — the overwhelming majority of call sites are mutations */
  category?: AuditCategory;
  /** default "ok" */
  outcome?: AuditOutcome;
  /** default "info", auto-raised to "warn" when the outcome is not "ok" */
  severity?: AuditSeverity;
  /** `{field: [from, to]}` — build it with `diffFields`, never by hand */
  changed?: Record<string, [unknown, unknown]>;
  /** ONE human sentence for the admin console's row. Not a field dump: the
   *  fields are already in `changed`, and a console you have to decode is a
   *  console nobody reads. */
  summary?: string;
}

// ------------------------------------------------------------------ the write

/** Everything that has to be read WHILE the request is still alive.
 *
 *  Next is explicit that a Server Component may not call `cookies()` or
 *  `headers()` inside an `after()` callback (it runs past React's rendering
 *  lifecycle, so the request store is gone) — it throws at runtime. Route
 *  handlers and server functions are allowed to, but `logAudit` is called from
 *  all three, so the request-shaped facts are gathered up front and the
 *  callback closes over plain values. That is the pattern Next's own docs
 *  recommend, and it costs nothing here: every one of these lookups is either
 *  a header read or already memoised by `cache()` for this request. */
interface AuditContext {
  changeSet: string | null;
  testSessionId: string | null;
  realActorId: string | null;
  ip: string | null;
  userAgent: string | null;
}

async function auditContext(actorId: string | null): Promise<AuditContext> {
  const ctx: AuditContext = {
    changeSet: null,
    testSessionId: null,
    realActorId: null,
    ip: null,
    userAgent: null,
  };

  try {
    // ONE dynamic import for both values. Dynamic because `sandbox.ts` reaches
    // back into `data.ts`, which now statically imports this file — a static
    // edge here would close that ring at module-evaluation time. It also keeps
    // the module graph exactly as it was before this file existed.
    const { lcTestSession, VIEW_AS_COOKIE } = await import("./sandbox");
    // v32: stamp the action's CHANGE SET (and the LC test session it belongs
    // to, if one is open) so /admin can reverse exactly this action's journal
    // rows. `currentChangeSet` is imported STATICALLY from its own leaf module:
    // a second module instance would hand out a second id, which is precisely
    // how the audit rows and their journal rows once ended up unmatched and
    // every Undo button silently disabled (v33.10).
    ctx.changeSet = currentChangeSet();
    ctx.testSessionId = await lcTestSession();
    ctx.realActorId = await realActorId(actorId, VIEW_AS_COOKIE);
  } catch {
    /* outside a request scope (crons, scripts) — a plain audit row is fine */
  }

  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    // Vercel puts the client in x-forwarded-for; the first hop is the caller,
    // the rest are proxies. Capped at 45 chars — the longest possible IPv6.
    const fwd = h.get("x-forwarded-for");
    const ip = (fwd ? fwd.split(",")[0] : h.get("x-real-ip"))?.trim();
    ctx.ip = ip ? ip.slice(0, 45) : null;
    ctx.userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  } catch {
    // A cron has no request headers, and neither does a script. That is not a
    // failure — it is what a cron LOOKS like in the log, and the console can
    // say so ("no IP: ran from a job, not a browser").
  }

  return ctx;
}

/** WHO REALLY DID IT.
 *
 *  Inside an admin's test view the whole app deliberately behaves as the target
 *  member, so `getViewer()` — and therefore every `logAudit` call site — names
 *  the TARGET. That is correct for the action and wrong for the record: the
 *  actions taken in a test view are real (AI_CONTEXT says so in as many words),
 *  and until now the only trace of who was behind one was the pair of
 *  `view_as_start` / `view_as_stop` rows bracketing them.
 *
 *  `real_actor_id` closes that. It is filled ONLY while a view-as cookie is
 *  actually set — outside a test view it would just repeat `actor_id`, and a
 *  column that is usually a duplicate of its neighbour teaches people to ignore
 *  it. Reading the cookie first also means the common path pays nothing: no
 *  cookie, no lookup. */
async function realActorId(
  actorId: string | null,
  cookieName: string
): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const raw = (await cookies()).get(cookieName)?.value;
    if (!raw) return null;
    const targetId = raw.split("|")[0];
    if (!targetId) return null;
    // memoised by `cache()` — every action has already resolved it this request
    const { getRealViewer } = await import("./data");
    const real = await getRealViewer();
    return real.id && real.id !== actorId ? real.id : null;
  } catch {
    // getRealViewer() can `redirect()` when there is no session. Swallowing
    // that here is safe and deliberate: this runs on a logging path that never
    // touches the response.
    return null;
  }
}

/** Runs the insert after the response when there IS a response to be after.
 *
 *  Verified against `next/dist/server/after/after.js` rather than assumed:
 *  `after()` reads the work + work-unit async stores and **throws** when both
 *  are missing, i.e. outside a request scope. Route handlers (every
 *  `/api/cron/*` job) are a request scope and get the deferral; a plain Node
 *  script run through `tsx` is not. Losing the row there would be the worse
 *  bargain — nobody is waiting on a response in a script — so the fallback runs
 *  the work inline and the caller's `await` covers it, which also keeps a
 *  short-lived script alive long enough to finish writing. */
async function runAfterResponse(work: () => Promise<void>): Promise<void> {
  try {
    afterResponse(work);
  } catch {
    await work();
  }
}

/** WHICH COLUMNS THIS DATABASE ACTUALLY HAS.
 *
 *  Migrations here are applied BY HAND in the Supabase SQL editor, so there is
 *  always a real window in which the deployed code is ahead of the schema — and
 *  during that window every audit insert would be rejected for naming a column
 *  that does not exist yet, so the log would go quiet exactly when a fresh
 *  release is the thing you most want a record of.
 *
 *  So the row is written at the newest shape the database has proved it
 *  accepts, degrading on a missing-column error (see `MISSING_COLUMN` below):
 *  "v2" (0072 — this release) → "v1" (0033's
 *  change-set columns) → "legacy" (the original five). The answer is remembered
 *  so an un-migrated database does not pay two failed inserts on every
 *  mutation, and it is remembered only BRIEFLY — the journal in `sandbox.ts`
 *  learned this the hard way: latching OFF permanently meant that once the
 *  migration finally landed, every already-warm server kept writing the old
 *  shape until it happened to recycle. Re-probing heals within minutes and
 *  without a redeploy. */
type RowShape = "v2" | "v1" | "legacy";
const SHAPES: RowShape[] = ["v2", "v1", "legacy"];
const SHAPE_RETRY_MS = 2 * 60 * 1000;
let shape: RowShape = "v2";
let shapeSetAt = 0;

/** "That column does not exist", in the two dialects it can arrive in.
 *  `42703` is Postgres's own undefined_column, which is what the pre-0033
 *  grace in `data.ts` has always checked for — but PostgREST validates an
 *  INSERT against its SCHEMA CACHE before the statement ever reaches Postgres
 *  and answers `PGRST204` instead, so on a database that hasn't run the
 *  migration yet the Postgres code may never be seen at all. Accepting both is
 *  the difference between the fallback working and the log going silent for
 *  however long the migration sits unapplied. */
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

async function writeRow(
  base: Record<string, unknown>,
  v1: Record<string, unknown>,
  v2: Record<string, unknown>
): Promise<void> {
  // a downgraded shape is only ever a working ASSUMPTION — re-probe the newest
  // one once the cool-off has passed, so a migration landing fixes itself
  if (shape !== "v2" && Date.now() - shapeSetAt > SHAPE_RETRY_MS) shape = "v2";

  for (let i = SHAPES.indexOf(shape); i < SHAPES.length; i++) {
    const attempt = SHAPES[i];
    const row =
      attempt === "v2"
        ? { ...base, ...v1, ...v2 }
        : attempt === "v1"
          ? { ...base, ...v1 }
          : base;
    const { error } = await db().from("audit_log").insert(row);
    if (!error) {
      if (shape !== attempt) {
        shape = attempt;
        shapeSetAt = Date.now();
      }
      return;
    }
    if (!MISSING_COLUMN.has(error.code ?? "")) {
      // a real failure (RLS, a bad uuid, the database being down) — say so once
      // and stop. Retrying at a narrower shape would only hide the cause.
      console.error("[audit] insert failed:", error.message);
      return;
    }
    if (attempt === "legacy") {
      console.error("[audit] insert failed: audit_log is missing base columns");
      return;
    }
    console.warn(
      `[audit] ${attempt} columns missing — falling back (run supabase/migrations/0072_audit_v2.sql)`
    );
  }
}

/** Log one audited action.
 *
 *  Backwards compatible with all ~123 existing call sites: the first five
 *  parameters are exactly what they always were, and everything this release
 *  adds arrives through `opts`.
 *
 *      await logAudit(viewer.id, "account_update", "account", id, { name },
 *        { changed: diffFields(before, patch), summary: `Edited ${before.name}` });
 */
export async function logAudit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  details?: Record<string, unknown>,
  opts?: AuditOpts
): Promise<void> {
  try {
    const ctx = await auditContext(actorId);
    const changed =
      opts?.changed && Object.keys(opts.changed).length > 0 ? opts.changed : null;
    const outcome: AuditOutcome = opts?.outcome ?? "ok";
    // an explicit severity always wins; an unstated one follows the outcome,
    // because "denied" and "failed" rows are the ones somebody has to look at
    const severity: AuditSeverity =
      opts?.severity ?? (outcome === "ok" ? "info" : "warn");

    const base = {
      actor_id: actorId,
      action,
      entity,
      entity_id: entityId,
      details: details ?? null,
    };
    const v1 = { change_set: ctx.changeSet, test_session_id: ctx.testSessionId };
    const v2 = {
      real_actor_id: ctx.realActorId,
      changed,
      ip: ctx.ip,
      user_agent: ctx.userAgent,
      category: opts?.category ?? "data",
      outcome,
      severity,
      summary: opts?.summary ? opts.summary.slice(0, 300) : null,
    };

    await runAfterResponse(() => writeRow(base, v1, v2));
  } catch (e) {
    // rule ①: the description of an action never fails the action
    console.error("[audit] log failed:", e);
  }
}

// ------------------------------------------------------------------ diffs

/** WHAT ACTUALLY CHANGED — `{field: [from, to]}`, and only for keys that really
 *  moved.
 *
 *  The whole value of this is in what it LEAVES OUT. An account edit posts the
 *  entire form back, so a naive before/after dump reports thirty fields on an
 *  edit that touched one, and a console showing thirty fields per row is a
 *  console nobody scrolls. Three kinds of false positive are folded away:
 *
 *   · **the same instant written differently** — Postgres hands back
 *     `2026-09-02T10:00:00+00:00`, a form hands over a `Date`, and
 *     `new Date().toISOString()` adds milliseconds. All three are one moment
 *     and none of them is a change;
 *   · **empty and empty** — a cleared input posts `""` where the column holds
 *     `null`. Nothing about that is worth a line in an audit log. (Deliberate:
 *     it does mean a genuine `""` → `null` normalisation goes unreported. That
 *     is the right trade — nobody has ever needed to know.)
 *   · **`5` and `"5"`** — numerics come back from PostgREST as strings often
 *     enough to matter. Folded ONLY when one side is a real number and the
 *     other stringifies to exactly it, so `100` and `"0100"` (a phone, an EP
 *     id) still read as different, which they are.
 *
 *  `keys` narrows to a set of fields; `omit` drops them.
 *
 *  ⚠️ NOTHING IS REDACTED AUTOMATICALLY — this function cannot tell a note from
 *  a secret, and a guess either leaks or silently swallows a real edit. Callers
 *  holding something that must never reach the log pass it to `omit`:
 *  `password_hash` (`upsertMember`, `setPassword`, `issueTempPassword`), an API
 *  key or its hash, an IR call's `manage_token` (it is a bearer URL — anyone
 *  holding it can move or cancel that call), and a push subscription's
 *  endpoint/keys. */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: Partial<T>,
  keys?: readonly (keyof T)[],
  omit?: readonly (keyof T)[]
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  try {
    const skip = new Set((omit ?? []).map((k) => String(k)));
    const look = keys ?? (Object.keys(after) as (keyof T)[]);
    for (const k of look) {
      const key = String(k);
      if (skip.has(key)) continue;
      // a key the caller never wrote is not a change, even when `keys` names it
      if (!(key in after)) continue;
      const from = before ? before[k] : undefined;
      const to = after[k];
      if (unchanged(from, to)) continue;
      out[key] = [jsonSafe(from), jsonSafe(to)];
    }
  } catch (e) {
    // rule ①. A diff that throws would take the whole mutation with it.
    console.error("[audit] diff failed:", e);
  }
  return out;
}

function blank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** The instant a value represents, or null when it isn't a timestamp. The
 *  regex is deliberately strict about a leading `YYYY-MM-DD`: `Date.parse`
 *  happily accepts `"2026"` (a year) and `"Suits"` on some engines, and a
 *  team name silently compared as a date would be worse than no folding. */
function instantOf(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Key-order-independent JSON, so `{a,b}` and `{b,a}` — the same jsonb column
 *  read back twice — don't read as an edit. null when it can't be stringified
 *  (a cycle, a BigInt), in which case the two values are simply reported as
 *  different rather than guessed at. */
function stable(v: unknown): string | null {
  try {
    return JSON.stringify(v, (_k, val) => {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const o = val as Record<string, unknown>;
        return Object.keys(o)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => ((acc[k] = o[k]), acc), {});
      }
      return val;
    }) ?? null;
  } catch {
    return null;
  }
}

function unchanged(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (blank(a) && blank(b)) return true;
  const ta = instantOf(a);
  const tb = instantOf(b);
  if (ta !== null && tb !== null) return ta === tb;
  if (typeof a === "number" && typeof b === "string") return String(a) === b.trim();
  if (typeof b === "number" && typeof a === "string") return String(b) === a.trim();
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const sa = stable(a);
    const sb = stable(b);
    return sa !== null && sb !== null && sa === sb;
  }
  return false;
}

/** jsonb-safe, and CAPPED. `audit_log` is 4.4 MB across 14k rows precisely
 *  because it has never stored free text; one pasted comment body per side per
 *  field would change that fast. 500 characters is enough to see WHAT changed —
 *  the row itself is where you go to read it in full. */
function jsonSafe(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v.length > 500 ? `${v.slice(0, 500)}…` : v;
  return v;
}

// ------------------------------------------------------------------ auth events

/** Human sentences for the console, written once here so every caller phrases
 *  the same event the same way. */
const AUTH_SUMMARY: Record<string, string> = {
  sign_in: "Signed in",
  sign_in_failed: "Sign-in refused",
  sign_out: "Signed out",
  password_reset_requested: "Asked for a new password",
  password_issued: "Was emailed a fresh password",
  password_changed: "Changed their password",
  google_grant: "Granted Sodio their Google access",
  inactive_bounce: "Deactivated member was sent to /inactive",
};

/** SIGN-INS, AND EVERYTHING ELSE THAT DECIDES WHO SOMEBODY IS.
 *
 *  `audit_log` held **zero** authentication events before v36 — 14,184 rows
 *  about accounts and deals and not one about anybody arriving. So "when did
 *  she last get in", "did that password reset ever reach him", "who has never
 *  signed in at all" were unanswerable questions about a system seventy people
 *  use, and a member locked out could only be diagnosed by reproducing it.
 *
 *  `actorId` is nullable ON PURPOSE: a refused sign-in usually has no member to
 *  point at (that is *why* it was refused). The identifier that was typed
 *  belongs in `details`, so the row still says who was being looked for.
 *
 *  ⚠️ Never hand this a password, a temporary password, or a token. Nothing
 *  here redacts, and a secret in a log is a secret in a backup, in a Drive
 *  copy, and in an email to the IM mailbox — all three of which the nightly
 *  backup makes of this table.
 *
 *  Severity is "notice", not "warn", even for a refusal: one failed sign-in is
 *  a typo. A hundred in an hour is an attack, and COUNTING them is the admin
 *  console's job, not a per-row judgement this function could ever make. */
export async function logAuth(
  action:
    | "sign_in"
    | "sign_in_failed"
    | "sign_out"
    | "password_reset_requested"
    | "password_issued"
    | "password_changed"
    | "google_grant"
    | "inactive_bounce",
  actorId: string | null,
  details?: Record<string, unknown>,
  outcome?: AuditOutcome
): Promise<void> {
  const refused = action === "sign_in_failed";
  return logAudit(actorId, action, "auth", actorId, details, {
    category: "auth",
    outcome: outcome ?? (refused ? "failed" : "ok"),
    severity: refused || action === "inactive_bounce" ? "notice" : "info",
    summary: AUTH_SUMMARY[action] ?? action,
  });
}

// ------------------------------------------------------------------ denials

/** SOMETHING WAS ASKED FOR AND REFUSED.
 *
 *  ⚠️ CALL THIS SPARINGLY, AND ONLY WHERE A REFUSAL IS INFORMATION. The system
 *  refuses things constantly and most of those refusals are the RBAC engine
 *  doing its ordinary job — a member opening a URL that isn't theirs, a stale
 *  tab posting to an action it no longer may. Logging every `fail(…,
 *  "forbidden")` would add a write to the hottest code in the app and bury the
 *  handful of refusals anybody would ever want to read.
 *
 *  The list, deliberately short:
 *    · the admin tools — anything behind `canUseAdminTools`;
 *    · cross-scope account access (someone reaching outside their own floor);
 *    · membership edits;
 *    · API-key issue / use.
 *
 *  `reason` is the sentence a human needs, not an error code. */
export async function logDenied(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  reason: string
): Promise<void> {
  return logAudit(actorId, action, entity, entityId, { reason }, {
    category: "security",
    outcome: "denied",
    severity: "warn",
    summary: reason ? `Refused — ${reason}` : "Refused",
  });
}
