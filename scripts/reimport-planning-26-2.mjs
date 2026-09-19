/**
 * ONE-OFF (v36.9) — re-point the planning importer at the new "Alexandria |
 * Planning Tool 26.2" sheet (the old "26.1" one is permanently unreachable —
 * 403 for the service account) and refresh plan_cells:
 *   · the 6-lane funnel (IGV/IGTa/IGTe/OGV/OGTa/OGTe), WINTER PEAK ONLY
 *     (Aug 2026 – Jan 2027) — Feb–Jul cells are left as they are, by request
 *   · BD & B2B's term goals (new in 26.2's sheet, and in Sodio's schema —
 *     see migration 0082)
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/reimport-planning-26-2.mjs
 */
import "./_node-compat.mjs";

const NEW_SHEET_ID = "1BF4nh017y12glrOzfQBNarS2tNya9P7QInvpE11HC5I";
const WINTER_MONTHS = ["August", "September", "October", "November", "December", "January"];

const { db } = await import("../src/lib/supabase.ts");
const { importPlanningSheet, importBdB2bPlanning } = await import("../src/lib/google/sheets.ts");

const { error: settingErr } = await db()
  .from("app_settings")
  .upsert({ key: "planning:sheet-id", value: NEW_SHEET_ID, updated_at: new Date().toISOString() });
if (settingErr) throw new Error(`app_settings upsert failed: ${settingErr.message}`);
console.log("planning:sheet-id →", NEW_SHEET_ID);

const lanes = await importPlanningSheet(undefined, WINTER_MONTHS);
console.log(`6-lane winter refresh: ${lanes.cells} cells`, lanes.skipped.length ? { skipped: lanes.skipped } : "");

const bdB2b = await importBdB2bPlanning();
console.log(`BD/B2B term goals: ${bdB2b.cells} cells`, bdB2b.skipped.length ? { skipped: bdB2b.skipped } : "");
