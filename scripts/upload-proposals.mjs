/* eslint-disable */
/**
 * UPLOAD THE OFFICIAL PROPOSAL DECKS to Supabase Storage (v36.1).
 *
 * The decks used to be bundled into EVERY serverless function by
 * `outputFileTracingIncludes` — 38 MB of PDF in each function of each
 * deployment, which is how the Vercel team hit its 10 GB Function Storage
 * ceiling. They now live in the private `proposals` bucket and the Proposal
 * email downloads the one it needs at send time.
 *
 * `proposals/` in the repo stays the source of truth (the tests check sizes
 * against it). Replacing a deck = drop the new file in `proposals/`, update
 * PROPOSAL_PDF_MB, then run this. Safe to re-run: it overwrites.
 *
 * Usage:
 *   node scripts/upload-proposals.mjs
 */
import "./_node-compat.mjs";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf-8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const BUCKET = "proposals";
const DECKS = ["B2B", "iGV", "iGTa", "iGTe"]; // = PROPOSAL_PDFS

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: buckets, error: listError } = await supabase.storage.listBuckets();
if (listError) throw listError;
if (!buckets.some((b) => b.id === BUCKET)) {
  // private: only the server (service role) reads it
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
  if (error) throw error;
  console.log(`created private bucket "${BUCKET}"`);
}

for (const deck of DECKS) {
  const file = readFileSync(`proposals/${deck}.pdf`);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${deck}.pdf`, file, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error(`${deck}.pdf: ${error.message}`);
  console.log(`uploaded ${deck}.pdf (${(file.length / 1e6).toFixed(1)} MB)`);
}
