import "server-only";
import { cache } from "react";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/supabase";

/** Sandbox test-view plumbing (v21).
 *
 *  The admin's view-as cookie can carry a MODE: `<targetId>|sandbox|<sessionId>`
 *  (legacy value = bare target id = real mode). While a SANDBOX session is
 *  active:
 *    - outbound side effects are suppressed (emails, in-app notifications,
 *      calendar events, sheet write-backs, Gmail drafts) — a test click must
 *      never ping a real member;
 *    - every row mutation on the core tables is journaled to `test_undo`;
 *      exiting the test view replays the journal in reverse (insert→delete,
 *      update→restore, delete→re-insert), leaving the DB as it was.
 *
 *  The cookie alone is NOT trusted: the session id must match an OPEN row in
 *  test_sessions (uuid, server-issued). A forged cookie without one is inert.
 */

export const VIEW_AS_COOKIE = "sodio-view-as";
/** Admin-only "show test data" toggle (outside of view-as). */
export const TEST_MODE_COOKIE = "sodio-test-mode";

export interface SandboxState {
  active: boolean;
  sessionId: string | null;
}

/** Re-exported so existing imports keep working — the definition lives in
 *  `change-set.ts`, which both actions.ts and data.ts import the SAME way.
 *  See that file for why that matters. */
export { currentChangeSet } from "./change-set";
import { currentChangeSet } from "./change-set";

/** The OPEN LC-wide testing session, if any (v32).
 *
 *  Unlike the per-admin sandbox this is global and cookie-less: the admin opens
 *  it from /admin and EVERY member's writes are journaled into it until it is
 *  closed, at which point the database is rolled back. Deliberately does NOT
 *  suppress side effects — the LC is testing the real system, emails included
 *  — so `sandboxSuppressed` never consults it. cache(): one lookup per request. */
export const lcTestSession = cache(async (): Promise<string | null> => {
  try {
    const { data } = await db()
      .from("test_sessions")
      .select("id")
      .eq("kind", "lc")
      .is("ended_at", null)
      .maybeSingle<{ id: string }>();
    return data?.id ?? null;
  } catch {
    return null;
  }
});

/** Which session (if any) owns the journal rows written right now. The admin's
 *  own sandbox wins — they are inside a view-as and expect THEIR undo. */
async function journalSession(): Promise<string | null> {
  const s = await sandboxState();
  if (s.active) return s.sessionId;
  return lcTestSession();
}

/** Parses + verifies the sandbox cookie. cache(): one lookup per request.
 *  Safe to call from anywhere — returns inactive outside a request scope
 *  (cron routes, scripts). */
export const sandboxState = cache(async (): Promise<SandboxState> => {
  try {
    const { cookies } = await import("next/headers");
    const raw = (await cookies()).get(VIEW_AS_COOKIE)?.value;
    if (!raw || !raw.includes("|")) return { active: false, sessionId: null };
    const [, mode, sessionId] = raw.split("|");
    if (mode !== "sandbox" || !sessionId) return { active: false, sessionId: null };
    const { data } = await db()
      .from("test_sessions")
      .select("id")
      .eq("id", sessionId)
      .is("ended_at", null)
      .maybeSingle();
    return data ? { active: true, sessionId } : { active: false, sessionId: null };
  } catch {
    return { active: false, sessionId: null };
  }
});

/** True when outbound side effects must be swallowed (sandbox test view). */
export async function sandboxSuppressed(tag: string): Promise<boolean> {
  const s = await sandboxState();
  if (s.active) console.log(`[sandbox] suppressed side effect: ${tag}`);
  return s.active;
}

/** Journals one mutation so it can be reversed.
 *
 *  Since v32 this runs ALWAYS, not only inside a sandbox: the row carries the
 *  change set of the action that wrote it, which is what powers Undo on the
 *  /admin log. `session_id` is set when a sandbox or LC test session owns the
 *  change (so closing that session rolls it back) and null otherwise. */
export async function recordUndo(
  tbl: string,
  rowId: string,
  op: "insert" | "update" | "delete",
  before?: unknown,
  label?: string
): Promise<void> {
  if (!journalReady()) return;
  try {
    const { error } = await db().from("test_undo").insert({
      session_id: await journalSession(),
      change_set: currentChangeSet(),
      actor_id: await journalActorId(),
      tbl,
      row_id: rowId,
      op,
      before: before ?? null,
      label: label ?? null,
    });
    if (error?.code === "42703") {
      // 0033 hasn't been run yet — stand down BRIEFLY, then try again, so the
      // journal comes back on its own once the migration lands
      journalOffUntil = Date.now() + JOURNAL_RETRY_MS;
      console.warn(
        "[journal] paused 2 min: migration 0033 not applied — run supabase/migrations/0033_change_journal_lc_test.sql"
      );
    } else if (error) {
      console.error("[journal] write failed:", error.message);
    }
  } catch (e) {
    console.error("[journal] write failed:", e);
  }
}

/** Journal availability, remembered briefly.
 *
 *  When the columns are missing (migration not applied yet) we stop writing so
 *  an un-migrated database doesn't pay a failed INSERT per mutation. The first
 *  version latched OFF permanently and only reset on a cold start — which
 *  meant that once 0033 DID land, every already-warm server kept skipping the
 *  journal until it happened to recycle. Actions taken in that window got an
 *  audit entry with a change set but no rows to replay, so Undo had nothing to
 *  do and silently offered nothing. It now RETRIES after a short cool-off, so
 *  a migration landing heals itself within minutes and without a redeploy. */
const JOURNAL_RETRY_MS = 2 * 60 * 1000;
let journalOffUntil = 0;
const journalReady = () => Date.now() >= journalOffUntil;

/** Snapshot a row before updating it, then journal it — one call at each
 *  update site: `await snapshotForUndo("accounts", id)`. */
export async function snapshotForUndo(tbl: string, rowId: string): Promise<void> {
  if (!journalReady()) return;
  try {
    const { data } = await db().from(tbl).select("*").eq("id", rowId).maybeSingle();
    if (data) await recordUndo(tbl, rowId, "update", data, describeRow(tbl, data));
  } catch (e) {
    console.error("[journal] snapshot failed:", e);
  }
}

/** Who is making the change. Read lazily and defensively — the journal must
 *  never be the reason a mutation fails. */
const journalActorId = cache(async (): Promise<string | null> => {
  try {
    const { getViewer } = await import("./data");
    return (await getViewer()).id ?? null;
  } catch {
    return null;
  }
});

/** A human label for the admin log ("Account · Hadana Moves"). */
function describeRow(tbl: string, row: Record<string, unknown>): string {
  const pretty: Record<string, string> = {
    accounts: "Account",
    account_comments: "Comment",
    contact_attempts: "Contact",
    visits: "Visit",
    deals: "Deal",
    deal_allocations: "Deal split",
    members: "Member",
    signups: "Sign-up",
    signup_comments: "Sign-up comment",
    ir_calls: "IR call",
    cvs: "CV",
    partner_lcs: "Partner LC",
    blacklist: "Archived name",
    mm_plans: "MM plan",
    tl_plans: "Raising plan",
  };
  const name =
    (row.name as string) ??
    (row.account_name as string) ??
    (row.partner_lc_name as string) ??
    null;
  return name ? `${pretty[tbl] ?? tbl} · ${name}` : (pretty[tbl] ?? tbl);
}

/** Columns Postgres GENERATES — they can't appear in an INSERT/UPDATE, so the
 *  undo replay must strip them from the restored snapshot. */
const GENERATED_COLUMNS: Record<string, string[]> = {
  accounts: ["normalized_name"],
  blacklist: ["normalized_name"],
};

function stripGenerated(tbl: string, row: Record<string, unknown>): Record<string, unknown> {
  const drop = GENERATED_COLUMNS[tbl];
  if (!drop) return row;
  const clean = { ...row };
  for (const c of drop) delete clean[c];
  return clean;
}

/** Replays journal rows in reverse: insert→delete, update→restore the
 *  snapshot, delete→re-insert. Shared by the session rollback and the
 *  per-action Undo on /admin. Returns how many rows were reversed and how
 *  many refused — a partial replay must never report success. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function replayReverse(rows: any[]): Promise<{ undone: number; failed: number }> {
  let undone = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      if (r.op === "insert") {
        await db().from(r.tbl).delete().eq("id", r.row_id);
      } else if (r.op === "update" && r.before) {
        // strip identity + generated columns that reject an UPDATE
        const { id: _id, ...rest } = stripGenerated(r.tbl, r.before as Record<string, unknown>);
        void _id;
        await db().from(r.tbl).update(rest).eq("id", r.row_id);
      } else if (r.op === "delete" && r.before) {
        // keep id (it's the PK for the re-insert) but drop generated columns
        await db().from(r.tbl).upsert(stripGenerated(r.tbl, r.before as Record<string, unknown>));
      } else {
        failed++;
        continue;
      }
      undone++;
    } catch (e) {
      console.error(`[journal] undo failed for ${r.tbl}/${r.row_id}:`, e);
      failed++;
    }
  }
  return { undone, failed };
}

/** Replays a session's journal in reverse and DELETES it, so it can never be
 *  replayed twice. Does NOT close the session. Returns rows undone. */
export async function rollbackJournal(sessionId: string): Promise<number> {
  const { data: rows } = await db()
    .from("test_undo")
    .select("id, tbl, row_id, op, before")
    .eq("session_id", sessionId)
    .order("id", { ascending: false });
  const { undone } = await replayReverse((rows ?? []) as unknown[]);
  // clear so a later exit (or a re-flip to sandbox) never re-applies these
  await db().from("test_undo").delete().eq("session_id", sessionId);
  return undone;
}

/** Reverses ONE audited action (all the journal rows sharing its change set),
 *  newest first. Used by the Undo button on /admin. The rows are deleted after
 *  a clean replay so the same action can't be undone twice. */
export async function rollbackChangeSet(
  changeSet: string
): Promise<{ undone: number; failed: number }> {
  const { data: rows } = await db()
    .from("test_undo")
    .select("id, tbl, row_id, op, before")
    .eq("change_set", changeSet)
    .order("id", { ascending: false });
  const list = (rows ?? []) as unknown[];
  if (list.length === 0) return { undone: 0, failed: 0 };
  const res = await replayReverse(list);
  if (res.failed === 0)
    await db().from("test_undo").delete().eq("change_set", changeSet);
  return res;
}

/** How many reversible rows an action wrote — the /admin log uses this to show
 *  Undo only where it would actually do something. */
export async function changeSetSizes(
  changeSets: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (changeSets.length === 0) return out;
  const { data } = await db()
    .from("test_undo")
    .select("change_set")
    .in("change_set", changeSets);
  for (const r of (data ?? []) as { change_set: string | null }[]) {
    if (r.change_set) out.set(r.change_set, (out.get(r.change_set) ?? 0) + 1);
  }
  return out;
}

/** Journal retention: rows outside any session older than `days` are dropped.
 *  Rows belonging to an OPEN session are never touched — that session still
 *  has to be able to roll back. */
export async function pruneJournal(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db()
    .from("test_undo")
    .delete()
    .is("session_id", null)
    .lt("created_at", cutoff)
    .select("id");
  return (data ?? []).length;
}

/** Rolls back the sandbox journal AND closes the session (on Exit). */
export async function undoSandboxSession(sessionId: string): Promise<number> {
  const undone = await rollbackJournal(sessionId);
  await db()
    .from("test_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  return undone;
}
