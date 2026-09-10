# Official proposal PDFs

The source copies of the decks the Proposal email can attach, with EXACTLY
these names:

- `B2B.pdf`
- `iGV.pdf`
- `iGTa.pdf`
- `iGTe.pdf`

**The live app does not read this folder** (v36.1). The decks are served from
the private Supabase Storage bucket `proposals`; bundling them into every
serverless function is what filled the Vercel team's 10 GB Function Storage.

To replace a deck:

1. Drop the new file here under the same name (keep it under ~17 MB — Gmail
   weighs attachments after base64, and refuses a message over 25 MB).
2. Update its size in `PROPOSAL_PDF_MB` (`src/lib/proposal-pdfs.ts`) — the
   tests check the number against the file.
3. Run `node scripts/upload-proposals.mjs` to push it to Storage.

A deck missing from Storage makes the send fail with a clear message.
