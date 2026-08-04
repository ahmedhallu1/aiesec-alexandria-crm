import "server-only";
import { db } from "@/lib/supabase";

/**
 * THE NIGHTLY BACKUP (v33).
 *
 * Supabase's free tier has NO automated backups — not "backups you haven't
 * switched on", none at all. Losing the database means losing every account,
 * every member, every deal and every comment, permanently. This is the answer
 * that costs nothing: a full logical dump of every table, every night,
 * keeping a month of history.
 *
 * It is a LOGICAL backup, not a snapshot: it captures rows, not the schema.
 * Restoring means re-running the migrations and re-inserting the JSON, which
 * is slower than a real PITR restore but is the difference between a bad day
 * and losing the LC's year of work.
 *
 * TWO DESTINATIONS, deliberately:
 *   1. the private `backups` Supabase bucket — fast, keeps 30 days, and covers
 *      the failure that actually happens: a bad migration, a wiped table,
 *      someone deleting the wrong thing;
 *   2. a gzipped copy EMAILED to the IM mailbox — off-site, so it survives
 *      losing the Supabase project itself. A backup that lives only inside the
 *      thing it is backing up is not really a backup.
 *   3. best-effort, a copy in the CRM Drive folder, where the EB can see it
 *      without asking anyone. This needs the mailbox token to carry the Drive
 *      scope (`scripts/mint-mailbox-token.mjs`); the SERVICE ACCOUNT can never
 *      do it — it has no storage quota of its own, so every upload comes back
 *      "Service Accounts do not have storage quota". When the scope is
 *      missing this step is skipped and the other two still run.
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
/** Keep a month — long enough to notice a slow corruption. */
const KEEP_DAYS = 30;
const BUCKET = "backups";

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
  /** whether the off-site email copy went out */
  emailed: boolean;
  /** whether the visible Drive copy landed (needs the Drive scope) */
  drive: boolean;
}

/** Dumps every table, stores it, and mails an off-site copy. */
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
  const fileName = `sodio-backup-${stamp}.json.gz`;

  // GZIPPED, both copies. The raw dump is ~13 MB, so a month of them would eat
  // 400 MB of a 1 GB free tier and would be too big to email; gzipped it is a
  // fraction of that. Restoring is one `gunzip` away.
  const { gzipSync } = await import("node:zlib");
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));

  // 1. the private bucket — the copy you actually restore from
  const { error: upErr } = await db()
    .storage.from(BUCKET)
    .upload(fileName, gz, { contentType: "application/gzip", upsert: true });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  // 2. an off-site copy by email
  let emailed = false;
  try {
    const { sendEmail } = await import("@/lib/google/gmail");
    const { env } = await import("@/lib/env");
    const to = env.adminEmails[0] ?? env.gmailSender;
    if (to && gz.byteLength < 20 * 1024 * 1024) {
      await sendEmail({
        to: [to],
        subject: `🗄️ Sodio backup — ${stamp.slice(0, 10)} (${rows} rows)`,
        html: `<p>Nightly backup of AIESEC in Alexandria's CRM.</p>
<p><b>${rows}</b> rows across <b>${Object.keys(data).length}</b> tables.
${failed.length ? `<br><b style="color:#b91c1c">${failed.length} table(s) failed</b> — check the logs.` : ""}</p>
<p>The attachment is a gzipped JSON dump (<code>gunzip</code> it): rows only,
no schema. To restore, run the migrations on a fresh database and insert each
array.</p>
<p style="color:#64748b;font-size:13px;">A copy is also in the private
<code>backups</code> storage bucket, which keeps 30 days.</p>`,
        attachments: [
          {
            filename: fileName,
            mimeType: "application/gzip",
            contentBase64: gz.toString("base64"),
          },
        ],
      });
      emailed = true;
    }
  } catch (e) {
    // the bucket copy already succeeded — a mail failure must not fail the job
    console.error("[backup] off-site email failed:", e);
  }

  // 3. a copy where the EB can see it. Never allowed to fail the run.
  let drive = false;
  try {
    const { uploadToDriveFolder } = await import("@/lib/google/drive-upload");
    await uploadToDriveFolder({
      folderName: "CRM — Backups",
      fileName,
      mimeType: "application/gzip",
      data: gz,
    });
    drive = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      "[backup] Drive copy skipped:",
      /storage quota/i.test(msg)
        ? "the mailbox token has no Drive scope — re-mint it with scripts/mint-mailbox-token.mjs"
        : msg
    );
  }

  const pruned = await pruneOldBackups();
  return {
    fileName,
    link: `${BUCKET}/${fileName}`,
    tables: Object.keys(data).length,
    rows,
    failed,
    pruned,
    emailed,
    drive,
  };
}

/** Deletes backups older than KEEP_DAYS so the bucket doesn't grow without
 *  bound. Only ever touches files this job created — the name prefix guards
 *  it. */
async function pruneOldBackups(): Promise<number> {
  try {
    const { data } = await db().storage.from(BUCKET).list("", { limit: 500 });
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    const stale = (data ?? [])
      .filter(
        (f) =>
          f.name.startsWith("sodio-backup-") &&
          new Date(f.created_at ?? f.updated_at ?? Date.now()).getTime() < cutoff
      )
      .map((f) => f.name);
    if (stale.length === 0) return 0;
    const { error } = await db().storage.from(BUCKET).remove(stale);
    return error ? 0 : stale.length;
  } catch (e) {
    console.error("[backup] prune failed:", e);
    return 0;
  }
}
