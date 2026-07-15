-- Sodio v10 — deal contract uploads, forgotten-visit nags, goal-period reminders.
-- Run in the Supabase SQL editor (after 0011_teams.sql).

-- ---------------------------------------------------------------- deal contracts
-- Optional contract file(s) per deal, stored in the private "contracts"
-- Storage bucket. Each entry: { path, name, type, size, uploaded_at, uploaded_by }.
alter table deals add column if not exists contracts jsonb not null default '[]';

-- private bucket for the uploaded contract files (any file format).
-- The app talks to Storage with the service-role key only, so no RLS
-- policies are needed on storage.objects for this bucket.
insert into storage.buckets (id, name, public)
  values ('contracts', 'contracts', false)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------- forgotten visits
-- One week after the "+2h report it" prompt with still no report, the member
-- (+ their TL) get one final "you forgot about it" email. Sent once per visit.
alter table visits add column if not exists forgotten_nag_sent_at timestamptz;

-- ---------------------------------------------------------------- goal reminders
-- When a goal period ends, the goal owner (VP/Director for function goals,
-- the TL for team goals) gets ONE reminder email with last period's
-- goal vs achieved and a button to set the new goal.
alter table performance_goals add column if not exists ended_reminder_sent_at timestamptz;

notify pgrst, 'reload schema';
