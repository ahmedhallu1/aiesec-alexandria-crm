-- Sodio v10 — notifications carry an optional in-app link (click → open the
-- related account) and a new "visit_announcement" kind for the function-wide
-- "a visit was booked" fan-out.
-- Run in the Supabase SQL editor (after 0009_b2b_deals_v9.sql).

alter table notifications add column if not exists link text;

notify pgrst, 'reload schema';
