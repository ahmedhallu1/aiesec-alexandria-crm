-- 0036 — virtual touch points (RSVP attendance from Google Calendar) +
-- timelines. APPLIED via the Supabase connection.
alter table touch_points add column if not exists virtual boolean not null default false;
alter table touch_points add column if not exists calendar_event_id text;
alter table touch_points add column if not exists meet_link text;
alter table touch_points add column if not exists rsvp_synced_at timestamptz;

alter table touch_point_attendance add column if not exists source text not null default 'manual';
alter table touch_point_attendance drop constraint if exists tpa_source_check;
alter table touch_point_attendance
  add constraint tpa_source_check check (source in ('manual', 'rsvp', 'auto'));

create table if not exists touch_point_routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references members(id) on delete set null,
  owner_name text not null,
  scope text not null check (scope in ('team', 'function', 'lc')),
  kind text not null check (kind in ('meeting', 'working_hours', 'outing')),
  function_key text,
  team_name text,
  weekday int not null check (weekday between 0 and 6),
  at_time text not null,
  virtual boolean not null default false,
  note text,
  starts_on date not null,
  ends_on date not null,
  invited_teams jsonb not null default '[]'::jsonb,
  invited_functions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table touch_point_routines enable row level security;

alter table touch_points add column if not exists routine_id uuid
  references touch_point_routines(id) on delete set null;
alter table touch_points add column if not exists moved_from_routine boolean not null default false;
create index if not exists touch_points_routine_idx on touch_points (routine_id);
