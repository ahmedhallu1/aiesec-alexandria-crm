-- Elevate v28 — BOOKING v2 (Google-Calendar-appointment parity).
-- Settings gain the scheduling controls Calendar offers; bookings capture the
-- IR's email (invited to the Meet), a manage token for public
-- reschedule/cancel, the Meet link, and cancel/reschedule audit fields.

alter table ir_booking_settings
  add column if not exists buffer_minutes int not null default 0
    check (buffer_minutes between 0 and 60),
  add column if not exists min_notice_minutes int not null default 60
    check (min_notice_minutes between 0 and 10080),
  add column if not exists max_advance_days int not null default 14
    check (max_advance_days between 1 and 90),
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists guests_can_invite boolean not null default true;

alter table ir_calls
  add column if not exists booker_email text,
  add column if not exists meet_link text,
  add column if not exists manage_token text,
  add column if not exists cancel_reason text,
  add column if not exists reschedule_requested_at timestamptz;
create unique index if not exists ir_calls_manage_token_key
  on ir_calls (manage_token) where manage_token is not null;

notify pgrst, 'reload schema';
