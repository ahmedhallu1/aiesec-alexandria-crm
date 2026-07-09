# Setup guide — AIESEC in Alexandria CRM

Everything below is on **free tiers**. Total time: ~45 minutes.
Work through the sections in order; each produces env vars for `.env.local`
(local dev) and the Vercel project (production).

> ⚠️ **Never commit secrets.** The two OAuth client JSONs in Downloads must not
> enter this repo. Since the web client secret has been passed around in files,
> **rotate it** (Cloud Console → Credentials → your Web client → *Reset secret*)
> before going live, then use the new value below.

---

## 1. Supabase (database)

1. Create a project at [supabase.com](https://supabase.com) (free tier, region `eu-central`).
2. SQL Editor → paste and run **`supabase/migrations/0001_init.sql`**.
3. SQL Editor → paste and run **`supabase/migrations/0002_membership_v2.sql`**
   (final membership structure, password auth, numbered comments, call scheduling).
3. Project Settings → API:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = `service_role` secret key

## 2. Google Cloud project

Use the existing project `gen-lang-client-0055329754` (or a fresh one named
"AIESEC ALEX CRM"). In **APIs & Services → Library**, enable:

- Gmail API
- Google Calendar API
- Google Sheets API
- Google Drive API

### 2a. OAuth consent screen
- User type **External**, publishing status **In production** (otherwise
  refresh tokens die after 7 days).
- Scopes: `email`, `profile`, `openid`,
  `https://www.googleapis.com/auth/calendar.events`, `https://mail.google.com/`.
- Because the app is external + sensitive scopes, Google shows an "unverified
  app" screen. That's fine for our LC: members just click *Advanced →
  Continue*. (Optional later: verify the app to remove the warning.)

### 2b. Web OAuth client (sign-in + Gmail + Calendar)
Credentials → your **Web application** client:
- Authorized redirect URIs:
  - `http://localhost:3000/api/auth/callback/google`
  - `https://<your-app>.vercel.app/api/auth/callback/google`
  - `https://developers.google.com/oauthplayground` (temporarily, for step 5)
- `AUTH_GOOGLE_ID` = client ID, `AUTH_GOOGLE_SECRET` = (rotated) client secret.

The Desktop client from Downloads is **not needed** — you can delete it in
Cloud Console.

## 3. Service account (Sheets mirror)

1. Credentials → Create credentials → **Service account** (name: `crm-sheets`).
   No roles needed. Create a **JSON key** and download it.
2. `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` = `base64 -i key.json | tr -d '\n'`
3. In **your Drive** (ahmedhallul@aiesec.net): create a folder, e.g.
   `AIESEC Alexandria CRM`, and **share it with the service account's email**
   (`crm-sheets@…iam.gserviceaccount.com`) as **Editor**.
4. `DRIVE_FOLDER_ID` = the part of the folder URL after `/folders/`.

5. **Create six empty Google Sheets inside the folder** with these names
   (service accounts have no Drive storage quota, so the CRM cannot create
   files — it finds yours by name, tolerant of dash/case differences, and
   fills them):

   - `CRM — Membership` (you fill this one; auto-seeded with headers + EB)
   - `CRM — IGV Accounts`
   - `CRM — IGT Accounts`
   - `CRM — Contact Log`
   - `CRM — Visits`
   - `CRM — Blacklist`

## 4. Membership sheet

After the first sync (button on the `/membership` page, or the cron), open
**CRM — Membership** — it's pre-seeded with the current EB. Columns:

Final structure (column order matters — A→J):

| Column | Values |
|---|---|
| Name | full name |
| Nickname | shown in the UI |
| Email | the @aiesec.net account (used for sign-in) |
| Phone | numbers only |
| Role | LCP / LCVP / Team Leader / Coordinator / Member / Director |
| Function | IGT / IGV / OGV / OGT / CXP / B2C / F&L — **multi-select allowed** ("LCP" = LC-wide) |
| Sub Function | Raising / Consideration / ICX / OGX / CXP / B2C / Finance / BD / B2B — multi-select allowed |
| Stakeholder | the stakeholder's **name** (dropdown referencing column A) |
| Team Name | optional, shown on dashboards (set on the TL row) |
| Active | Yes / No — No blocks sign-in |

Rows removed from the sheet are deactivated automatically at the next sync.
The sheet is **two-way**: in-app membership edits (EB) and member profile
confirmations are written back to it, so imports never revert them.

## 5. Gmail refresh token (transactional email)

Sent from `ahmedhallul@aiesec.net` (IM director). One-time:

1. Open [OAuth Playground](https://developers.google.com/oauthplayground).
2. ⚙️ → check **Use your own OAuth credentials** → paste the Web client ID +
   secret.
3. In Step 1 enter scope `https://mail.google.com/` → Authorize while signed
   in as **ahmedhallul@aiesec.net** → Step 2 → **Exchange authorization code
   for tokens**.
4. `GMAIL_REFRESH_TOKEN` = the refresh token shown.
5. You can now remove the playground redirect URI from the client.

`GMAIL_SENDER=ahmedhallul@aiesec.net`, `GMAIL_SENDER_NAME=AIESEC in Alexandria CRM`.

## 6. App secrets

- `AUTH_SECRET` = `openssl rand -base64 32`
- `CRON_SECRET` = `openssl rand -hex 24`
- `ADMIN_EMAILS` = `ahmedhallul@aiesec.net` (comma-separate to add more)

## 7. GitHub + Vercel

1. Push this repo to GitHub (private is fine).
2. [vercel.com](https://vercel.com) → Import the repo → Framework: Next.js.
3. Add **all** env vars from `.env.example` with real values, plus
   `NEXT_PUBLIC_APP_URL=https://<your-app>.vercel.app`.
4. Deploy, then add the production redirect URI (step 2b) if you haven't.

## 8. Scheduled jobs

In the Supabase SQL Editor, open **`supabase/cron.sql`**, replace `<APP_URL>`
and `<CRON_SECRET>`, and run it. Verify with `select * from cron.job;`.

## 9. Smoke test (10 minutes)

1. Visit the app → sign in with your @aiesec.net account → you should land on
   the dashboard and receive the **welcome email**.
2. `/membership` → *Sync membership now* → confirm members appear.
3. Add an account → try adding it again (duplicate must be blocked with
   details) → blacklist a name as VP/admin and try adding it (blocked).
4. Log 3 contacts with "No Response" → the Out-of-Process prompt must appear.
5. Schedule a visit ~3 hours ahead → check the calendar event (reminders 24h/1h)
   → after the +2h mark the follow-up email arrives → report the visit → VP +
   stakeholder get the report email.
6. `/membership` → *Export mirrors now* → check the sheets in the Drive folder.

## 10. Optional

- **GA4:** create a property → `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-…`
- **PWA:** on a phone, "Add to Home Screen" — it installs standalone.
- **Play Store later:** wrap as a TWA (e.g. Bubblewrap), then put the signing
  cert SHA-256 into `public/.well-known/assetlinks.json`.
