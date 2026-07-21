import "server-only";
import { cache } from "react";
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

/** Journals one mutation for undo. No-op outside an active sandbox. */
export async function recordUndo(
  tbl: string,
  rowId: string,
  op: "insert" | "update" | "delete",
  before?: unknown
): Promise<void> {
  const s = await sandboxState();
  if (!s.active) return;
  try {
    await db().from("test_undo").insert({
      session_id: s.sessionId,
      tbl,
      row_id: rowId,
      op,
      before: before ?? null,
    });
  } catch (e) {
    console.error("[sandbox] undo journal failed:", e);
  }
}

/** Snapshot a row before updating it, then journal it — one call at each
 *  update site: `await snapshotForUndo("accounts", id)`. */
export async function snapshotForUndo(tbl: string, rowId: string): Promise<void> {
  const s = await sandboxState();
  if (!s.active) return;
  try {
    const { data } = await db().from(tbl).select("*").eq("id", rowId).maybeSingle();
    if (data) await recordUndo(tbl, rowId, "update", data);
  } catch (e) {
    console.error("[sandbox] snapshot failed:", e);
  }
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

/** Replays a session's journal in reverse and DELETES it, so it can never be
 *  replayed twice. Does NOT close the session. Returns rows undone. */
export async function rollbackJournal(sessionId: string): Promise<number> {
  const { data: rows } = await db()
    .from("test_undo")
    .select("id, tbl, row_id, op, before")
    .eq("session_id", sessionId)
    .order("id", { ascending: false });
  let undone = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (rows ?? []) as any[]) {
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
      }
      undone++;
    } catch (e) {
      console.error(`[sandbox] undo failed for ${r.tbl}/${r.row_id}:`, e);
    }
  }
  // clear so a later exit (or a re-flip to sandbox) never re-applies these
  await db().from("test_undo").delete().eq("session_id", sessionId);
  return undone;
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
