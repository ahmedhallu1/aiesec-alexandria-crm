-- Sodio v27 — IR call BOOKING + OGV contact STREAKS.
--
-- Booking: each consideration member publishes a Sodio-branded booking page
-- (/book/<slug>, public) built from their weekly availability; an IR abroad
-- picks a slot + their LC → the call lands in ir_calls as 'scheduled'
-- automatically (+ a Google Calendar event on the member's own calendar).
-- During the call the member fills the structured notes (demand domains,
-- "When are your B2C campaigns?", free notes, screenshot).
--
-- Streaks: OGV MMs keep a daily ≥1-sign-up-contact streak — activity days are
-- stamped by the signup actions, the /signups page shows current/best/LC-top
-- streaks, and an end-of-day cron sends the funny "save your streak!" nag.

create table if not exists ir_booking_settings (
  member_id uuid primary key references members(id) on delete cascade,
  slug text not null,
  slot_minutes int not null default 30 check (slot_minutes between 10 and 120),
  -- [{ day: 0-6 (0=Sunday), from: "18:00", to: "21:00" }] in Cairo time
  availability jsonb not null default '[]',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index if not exists ir_booking_slug_key on ir_booking_settings (lower(slug));

alter table ir_calls
  add column if not exists status text not null default 'completed'
    check (status in ('scheduled', 'completed', 'cancelled')),
  add column if not exists demand text,
  add column if not exists b2c_campaigns text,
  add column if not exists booker_name text,
  add column if not exists booked_at timestamptz,
  add column if not exists calendar_event_id text;

-- one activity stamp per member per (Cairo) day — the streak raw material
create table if not exists signup_activity (
  member_id uuid not null references members(id) on delete cascade,
  day date not null,
  primary key (member_id, day)
);

-- once-per-day guard for the end-of-day streak nag
alter table members add column if not exists streak_reminded_on date;

alter table ir_booking_settings enable row level security;
alter table signup_activity enable row level security;
create trigger ir_booking_settings_updated_at before update on ir_booking_settings
  for each row execute function set_updated_at();

notify pgrst, 'reload schema';
