/**
 * THE BACKGROUND JOBS THAT DON'T NEED VERCEL (v33.46).
 *
 * Sibling of run-import.mjs, same reasoning, two more jobs. `visit-followups`
 * ran every 15 minutes and `sheets-export` every hour — around the clock,
 * from Supabase pg_cron straight at Vercel. Between them that was 120 of the
 * ~126 daily cron invocations on the account, and a third of them fired
 * between midnight and 6 AM Cairo, when there is no visit to chase and
 * nothing new to export.
 *
 * Neither job serves a browser request: they read Supabase, send Gmail and
 * write Google Sheets. GitHub Actions runs them for free at the same cadence.
 * This script calls the SAME exported functions the Vercel routes call, so
 * there is exactly one implementation and the routes stay usable as a manual
 * "run it now" handle.
 *
 * Usage:  npx tsx --tsconfig tsconfig.scripts.json \
 *            scripts/run-cron.mjs visit-followups|sheets-export
 *
 * The --tsconfig flag is LOAD-BEARING: src/server/** carries
 * `import "server-only"`, which Next resolves via its bundler and plain Node
 * cannot resolve at all. tsconfig.scripts.json aliases it to the same no-op
 * stub the tests use. Without it every run dies on module resolution.
 *
 * Required env (GitHub → Settings → Secrets and variables → Actions):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, DRIVE_FOLDER_ID,
 *   GMAIL_REFRESH_TOKEN, GMAIL_SENDER, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET,
 *   NEXT_PUBLIC_APP_URL  (the reminder emails link back to the CRM — get this
 *                         wrong and every member gets a dead link)
 */

import "./_node-compat.mjs";

const JOBS = ["visit-followups", "sheets-export"];
const which = process.argv[2];

if (!JOBS.includes(which)) {
  console.error(`usage: run-cron.mjs ${JOBS.join("|")}`);
  process.exit(2);
}

// visit-followups EMAILS REAL MEMBERS, so a missing var must stop the run
// rather than half-send. sheets-export needs the Google pair but no mailbox.
const NEEDED = {
  "visit-followups": [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GMAIL_REFRESH_TOKEN",
    "GMAIL_SENDER",
    "AUTH_GOOGLE_ID",
    "AUTH_GOOGLE_SECRET",
    "NEXT_PUBLIC_APP_URL",
  ],
  "sheets-export": [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64",
    "DRIVE_FOLDER_ID",
  ],
};

const missing = NEEDED[which].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing env: ${missing.join(", ")}`);
  process.exit(2);
}

const started = Date.now();
try {
  if (which === "visit-followups") {
    const { runVisitFollowups } = await import("../src/server/cron/visit-followups.ts");
    const r = await runVisitFollowups();
    console.log(
      `visit-followups: ${r.sent} prompt(s) from ${r.checked} pending, ` +
        `${r.nagged} nag(s) from ${r.forgottenChecked} unreported, ` +
        `bounces ${r.bounces.flagged}/${r.bounces.checked} flagged`
    );
  } else {
    const { exportAllSheets } = await import("../src/lib/google/sheets.ts");
    await exportAllSheets();
    // ⚠️ v36 — THE SIGN-UP MIRROR RUNS HERE TOO. Sign-up edits stopped pushing
    // their own row (three Google round trips per dropdown change); this is
    // the hourly batch that replaced them. It must be in BOTH runners — this
    // one and the Vercel route — or whichever one the LC is actually using
    // would silently stop mirroring OGX while still reporting success.
    // It never fails the raising export above, which is the older contract.
    let signups = null;
    try {
      const { exportDirtySignups } = await import("../src/lib/google/signups.ts");
      signups = await exportDirtySignups();
      console.log(
        `sheets-export: sign-ups mirrored — ${signups.pushed} pushed` +
          (signups.missed.length ? `, ${signups.missed.length} missed (${signups.missed.slice(0, 5).join(", ")})` : "")
      );
    } catch (e) {
      console.error("sheets-export: sign-up mirror FAILED:", e?.message ?? e);
    }
    // the health page reads these stamps — keep them truthful wherever the
    // job ran. runVisitFollowups writes its own; this one has none of its own.
    const { markCronRun } = await import("../src/server/data.ts");
    await markCronRun("sheets-export");
    console.log("sheets-export: all sheets written");
  }
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
} catch (e) {
  console.error(`[${which}] FAILED:`, e);
  process.exit(1);
}
