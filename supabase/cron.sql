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

-- Daily 06:00 UTC (~8-9am Cairo): after a goal period ends, remind the
-- VPs/Directors (lane goals) and Team Leaders (team goals) to set the new
-- period's goal — with last period's goal vs achieved in the email.
select cron.schedule(
  'goal-reminders',
  '0 6 * * *',
  $$ select net.http_get(url := '<APP_URL>/api/cron/goal-reminders?key=<CRON_SECRET>') $$
);

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
