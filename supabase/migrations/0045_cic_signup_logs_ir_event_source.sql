-- 0045 (v33.19): CIC second calls · sign-up edit history · IR event source
--
-- ① CIC — "Customer Interview Calls": a SECOND person re-calls a contacted
--   sign-up that never progressed to a status, verifying the first call and
--   following up. The first assignee keeps the row (their KPIs/MOS are
--   untouched); the second call lives in its own cic_* columns so it can
--   never pollute the funnel's Contacted/Interested numbers.
-- ② signup_logs — the per-sign-up edit history ("who changed what, when").
-- ③ ir_calls.event_calendar — whose calendar carries the event: the owner's
--   ('owner') or the IM mailbox's ('mailbox', the fallback for members with
--   no Google grant yet). Cancel/reschedule must patch the right calendar.

alter table signups
  add column if not exists cic_assigned_to uuid references members(id),
  add column if not exists cic_assigned_name text,
  add column if not exists cic_assigned_at timestamptz,
  add column if not exists cic_contact_status text,
  add column if not exists cic_interested text;

create table if not exists signup_logs (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references signups(id) on delete cascade,
  member_id uuid references members(id),
  member_name text not null,
  field text not null,
  old_value text,
  new_value text,
  at timestamptz not null default now()
);
create index if not exists signup_logs_signup_idx on signup_logs (signup_id, at desc);
alter table signup_logs enable row level security;

alter table ir_calls
  add column if not exists event_calendar text;

notify pgrst, 'reload schema';
