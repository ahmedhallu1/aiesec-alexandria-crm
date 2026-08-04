import "server-only";
import { db } from "@/lib/supabase";

/**
 * THE NIGHTLY BACKUP (v33).
 *
 * Supabase's free tier has NO automated backups — not "backups you haven't
 * switched on", none at all. Losing the database means losing every account,
 * every member, every deal and every comment, permanently. This is the answer
 * that costs nothing: a full logical dump of every table, written as JSON into
 * the CRM's own Drive folder every night, keeping a month of history.
 *
 * It is a LOGICAL backup, not a snapshot: it captures rows, not the schema.
 * Restoring means re-running the migrations and re-inserting the JSON, which
 * is slower than a real PITR restore but is the difference between a bad day
 * and losing the LC's year of work.
 *
 * Storage buckets (contracts, CVs) are NOT included — they are files, not
 * rows, and they already live outside Postgres.
 */

/** Every table holding data the LC cannot recreate by hand. Order matters
 *  only for a restore (parents before children), so it is kept meaningful. */
const BACKUP_TABLES = [
  // people and structure
  "members",
  "teams",
  // the raising pipeline
  "accounts",
  "contact_attempts",
  "visits",
  "deals",
  "deal_allocations",
  "account_comments",
  "blacklist",
  // OGX
  "signups",
  "signup_comments",
  // consideration
  "partner_lcs",
  "ir_calls",
  "cvs",
  "ir_booking_settings",
  // TM
  "touch_points",
  "touch_point_attendance",
  "attendance_appeals",
  "touch_point_routines",
  // planning + feedback
  "plan_cells",
  "mm_plans",
  "tl_plans",
  "lc_feedback",
  "feedback",
  // operational
  "notifications",
  "audit_log",
  "app_settings",
] as const;

const PAGE = 1000;
/** Keep a month. Long enough to notice a slow corruption, short enough that
 *  the Drive folder stays navigable. */
const KEEP_DAYS = 30;
const FOLDER = "CRM — Backups";

/** Reads a whole table, paging past PostgREST's 1000-row response cap. */
async function dumpTable(table: string): Promise<unknown[] | { error: string }> {
  const rows: unknown[] = [];
  try {
    for (let from = 0; from < 200_000; from += PAGE) {
      const { data, error } = await db()
        .from(table)
        .select("*")
        .range(from, from + PAGE - 1);
      if (error) return { error: error.message };
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
    return rows;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export interface BackupResult {
  fileName: string;
  link: string;
  tables: number;
  rows: number;
  failed: string[];
  pruned: number;
}

/** Dumps every table and writes one JSON file to Drive. */
export async function runBackup(): Promise<BackupResult> {
  const started = new Date();
  const payload: Record<string, unknown> = {
    takenAt: started.toISOString(),
    note: "Sodio logical backup — rows only, no schema. Restore = run the migrations, then insert these arrays.",
  };
  const data: Record<string, unknown[]> = {};
  const failed: string[] = [];
  let rows = 0;

  for (const table of BACKUP_TABLES) {
    const res = await dumpTable(table);
    if (Array.isArray(res)) {
      data[table] = res;
      rows += res.length;
    } else {
      // a table that doesn't exist yet (an unapplied migration) must not sink
      // the whole backup — record it and keep going
      failed.push(`${table}: ${res.error}`);
    }
  }
  payload.tables = Object.fromEntries(
    Object.entries(data).map(([t, r]) => [t, r.length])
  );
  payload.data = data;
  if (failed.length > 0) payload.failed = failed;

  const stamp = started.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const fileName = `sodio-backup-${stamp}.json`;
  const { uploadToDriveFolder } = await import("@/lib/google/drive-upload");
  const up = await uploadToDriveFolder({
    folderName: FOLDER,
    fileName,
    mimeType: "application/json",
    data: Buffer.from(JSON.stringify(payload), "utf8"),
  });

  const pruned = await pruneOldBackups();
  return {
    fileName,
    link: up.webViewLink,
    tables: Object.keys(data).length,
    rows,
    failed,
    pruned,
  };
}

/** Deletes backup files older than KEEP_DAYS so the folder doesn't grow
 *  without bound. Only ever touches files this job created — the name prefix
 *  is the guard. */
async function pruneOldBackups(): Promise<number> {
  try {
    const { clients } = await import("@/lib/google/sheets");
    const { drive } = clients();
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
    const list = await drive.files.list({
      q: `name contains 'sodio-backup-' and trashed = false and createdTime < '${cutoff}'`,
      fields: "files(id, name)",
      pageSize: 100,
    });
    let n = 0;
    for (const f of list.data.files ?? []) {
      if (!f.id || !f.name?.startsWith("sodio-backup-")) continue;
      await drive.files.delete({ fileId: f.id });
      n += 1;
    }
    return n;
  } catch (e) {
    console.error("[backup] prune failed:", e);
    return 0;
  }
}
