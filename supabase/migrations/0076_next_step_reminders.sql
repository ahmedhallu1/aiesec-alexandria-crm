-- 0076 — NEXT-STEP REMINDERS FOR EVERYONE (v36.2)
--
-- The only next-step reminder used to be a Google Calendar event, so members
-- who never connected Google (44 of 100 upcoming steps' owners) got nothing.
-- The 15-minute visit-followups tick now reminds every responsible itself
-- (src/lib/next-step-reminder.ts); this column makes it once per step.
--
-- It holds the "<date> <HH:MM>" the owner was last reminded about. A reminder
-- fires when the key differs, so moving the step re-arms it and an unchanged
-- step never nags twice.
--
-- Applied 2026-09-10 via the Supabase MCP.

alter table accounts add column if not exists next_step_reminded_key text;

comment on column accounts.next_step_reminded_key is
  'v36.2: the "<date> <time>" of the next step the responsible was last reminded about. A reminder fires once per value; moving the step changes the key, so the new one is reminded too.';
