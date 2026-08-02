-- Elevate v29 — booking v3: the booker's role in their LC (mandatory at
-- booking time) and the verbatim reason a member sends with a reschedule
-- request.
--
-- APPLIED TO PROD 2026-08-08 by hand — this file restores supabase/migrations
-- as the schema source of truth. Idempotent: safe to re-run against the live
-- database that already carries both columns.

alter table ir_calls add column if not exists booker_role text;
alter table ir_calls add column if not exists reschedule_reason text;

notify pgrst, 'reload schema';
