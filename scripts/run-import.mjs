/**
 * IMPORTS THAT DON'T COST VERCEL ANYTHING (v33.19).
 *
 * The membership + sign-ups imports were the biggest line on the Fluid CPU
 * bill: heavy Google Sheets parses running every 15–30 minutes, forever, on
 * the same plan that serves the app to 70 people during working hours. They
 * don't need to run on Vercel at all — they touch Google and Supabase, never
 * a browser request.
 *
 * GitHub Actions runs them instead (free for public/lightweight private use
 * at this cadence). This script calls the SAME exported functions the Vercel
 * routes call, so there is exactly one implementation of the import logic.
 *
 * Usage:  npx tsx --tsconfig tsconfig.scripts.json \
 *            scripts/run-import.mjs membership|signups [--force]
 *
 * The --tsconfig flag is LOAD-BEARING: src/server/** carries
 * `import "server-only"`, which Next resolves via its bundler and plain Node
 * cannot resolve at all. tsconfig.scripts.json aliases it to the same no-op
 * stub the tests use. Without it every run dies on module resolution.
 *
 * Required env (GitHub → Settings → Secrets and variables → Actions):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, DRIVE_FOLDER_ID
 *   (and for anything that emails: GMAIL_REFRESH_TOKEN, AUTH_GOOGLE_ID,
 *    AUTH_GOOGLE_SECRET, GMAIL_SENDER)
 */

const which = process.argv[2];
const force = process.argv.includes("--force");

if (!["membership", "signups"].includes(which)) {
  console.error("usage: run-import.mjs membership|signups [--force]");
  process.exit(2);
}

const missing = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64",
  "DRIVE_FOLDER_ID",
].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`missing env: ${missing.join(", ")}`);
  process.exit(2);
}

const started = Date.now();
try {
  if (which === "membership") {
    const { importMembership } = await import("../src/lib/google/sheets.ts");
    const n = await importMembership({ force });
    console.log(
      n === -1
        ? "membership: unchanged since last run — skipped"
        : `membership: ${n} rows imported`
    );
  } else {
    const { importSignups } = await import("../src/lib/google/signups.ts");
    const res = await importSignups({ force });
    console.log(
      res.skipped
        ? "signups: unchanged since last run — skipped"
        : `signups: ${res.imported} imported, ${res.created} created`
    );
  }
  // the health page reads these stamps — keep them truthful wherever the job ran
  const { markCronRun } = await import("../src/server/data.ts");
  await markCronRun(`${which}-import`);
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
} catch (e) {
  console.error(`[${which}-import] FAILED:`, e);
  process.exit(1);
}
