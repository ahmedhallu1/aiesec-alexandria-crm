-- Scheduled jobs via Supabase pg_cron + pg_net (free tier).
-- REPLACE <APP_URL> with your deployed URL (e.g. https://aiesec-alexandria-crm.vercel.app)
-- and <CRON_SECRET> with the CRON_SECRET value from your Vercel env vars, then run in the SQL editor.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every 15 minutes: send the "+2 hours after visit" completion prompt to members
select cron.schedule(
  'visit-followups',
  '*/15 * * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/visit-followups?key=<CRON_SECRET>') $$
);

-- Every 30 minutes: import members from the Membership sheet
select cron.schedule(
  'membership-import',
  '*/30 * * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/membership-import?key=<CRON_SECRET>') $$
);

-- Every hour: export CRM data mirrors to Google Sheets
select cron.schedule(
  'sheets-export',
  '5 * * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/sheets-export?key=<CRON_SECRET>') $$
);

-- (v22) the goal-reminders job is GONE — goals come from the planning sheet
-- and the TLs' filed plans; nothing is set (or reminded about) in-app.
-- If an old 'goal-reminders' job still exists: select cron.unschedule('goal-reminders');

-- To inspect: select * from cron.job;
-- To remove:  select cron.unschedule('visit-followups');

-- v21: per-function period reports (sprint / month / quarter) — checked daily
-- at 07:00 UTC; the route itself decides which period (if any) just closed.
select cron.schedule(
  'period-reports',
  '0 7 * * *',
  $$
  select net.http_get(
    url := '<APP_URL>/api/cron/period-reports?key=<CRON_SECRET>'
  );
  $$
);

-- v23: B2C accounts must be refreshed on Podio every N days — checked daily
-- at 05:00 UTC; nags the responsible + the B2C VP/Director once per cycle.
select cron.schedule(
  'podio-updates',
  '0 5 * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/podio-updates?key=<CRON_SECRET>') $$
);

-- v25: OGX sign-ups two-way sync — pulls the OGT/OGV tracker tabs every
-- 15 minutes (Sodio-side edits write back instantly from the app itself).
select cron.schedule(
  'signups-import',
  '*/15 * * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/signups-import?key=<CRON_SECRET>') $$
);

-- v27: OGV contact streaks — end-of-day "save your streak!" nag, daily at
-- 16:00 UTC (19:00 Cairo in DST, 18:00 in winter): any OGV MM with a ≥3-day streak and no sign-up
-- contact yet today gets the funny email + bell (once per day).
select cron.schedule(
  'streak-nags',
  '0 16 * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/streak-nags?key=<CRON_SECRET>') $$
);

-- v29: TM attendance — nightly at 20:59 UTC = 23:59 Cairo (DST). Working-hours sessions whose
-- window has closed record THEMSELVES from work_activity; every other touch
-- point that started and still has no record nags whoever owes it (once per
-- Cairo day), and after 3 reminders files a pending_prompts row so the app
-- asks them on sight.
select cron.schedule(
  'attendance-reminders',
  '59 20 * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/attendance-reminders?key=<CRON_SECRET>') $$
);

-- v33.35: ASK FOR THE RATING — daily at 19:00 UTC = 22:00 Cairo. Every touch
-- point that HAPPENED today gets one email to everyone who was in its
-- audience (BCC), with TM and the booker on CC, asking for the 1–5 star
-- rating. Once per touch point — `feedback_asked_at` is the stamp.
select cron.schedule(
  'touch-point-feedback',
  '0 19 * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/touch-point-feedback?key=<CRON_SECRET>') $$
);

-- THE NIGHTLY BACKUP (v33). Supabase's free tier has no automated backups at
-- all, so this job is the only thing between a lost database and losing the
-- LC's year. Dumps every table, gzipped, into the private `backups` bucket
-- (30 days) and emails an off-site copy to the IM mailbox.
select cron.schedule(
  'backup',
  '0 2 * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/backup?key=<CRON_SECRET>') $$
);

-- ===================================================================
-- v33.19 — HOSTING CPU. Two changes, in this order:
--
-- 1) The import routes now SKIP when the sheet hasn't changed and pause
--    01:00–07:00 Cairo, so these jobs cost near-zero on a quiet night even
--    while they stay scheduled here.
--
-- 2) The imports also run in GitHub Actions (.github/workflows/imports.yml),
--    which costs Vercel NOTHING. Once a manual run there is green, retire the
--    Vercel twins — the app keeps working either way, so there is no window
--    where nothing runs:
--
--      select cron.unschedule('membership-import');
--      select cron.unschedule('signups-import');
--
--    To go back (GitHub down, secrets rotated), re-run the two cron.schedule
--    calls above and disable the workflow.
-- ===================================================================

-- ============================================================ CXP module (v35)
-- APPLIED 2026-08-26 against https://sodio.vercel.app (jobids 25/26/27, active).
-- Kept here as the reproducible record — re-running is safe only after
-- cron.unschedule(), since cron.schedule() with an existing name errors.
-- The ECB submission tracking migrated out of the standalone Internal Auditing
-- System. ORDER MATTERS: the sync must land before the reminder reads it, or
-- the email quotes yesterday's missing-document counts.

-- Hourly at :20 — mirror the ECB SubTool tabs into cxp_ep_records
select cron.schedule(
  'cxp-sync',
  '20 * * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/cxp-sync?key=<CRON_SECRET>') $$
);

-- Hourly at :35 — index documents dropped straight into Drive (after the sync,
-- which is what tells it which EPs exist)
select cron.schedule(
  'cxp-drive-scan',
  '35 * * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/cxp-drive-scan?key=<CRON_SECRET>') $$
);

-- Daily 08:00 UTC (10:00/11:00 Cairo) — the weekly submission reminder.
-- Runs every day but SENDS only when tomorrow is an ECB deadline (6/13/20/27),
-- i.e. on the 5th, 12th, 19th and 26th. Same gate the old system used.
select cron.schedule(
  'cxp-reminders',
  '0 8 * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/cxp-reminders?key=<CRON_SECRET>') $$
);
