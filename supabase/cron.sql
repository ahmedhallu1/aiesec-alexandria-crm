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

-- THE NIGHTLY BACKUP (v33). Supabase's free tier has no automated backups at
-- all, so this job is the only thing between a lost database and losing the
-- LC's year. Dumps every table, gzipped, into the private `backups` bucket
-- (30 days) and emails an off-site copy to the IM mailbox.
select cron.schedule(
  'backup',
  '0 2 * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/backup?key=<CRON_SECRET>') $$
);
