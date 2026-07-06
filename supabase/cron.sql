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

-- To inspect: select * from cron.job;
-- To remove:  select cron.unschedule('visit-followups');
