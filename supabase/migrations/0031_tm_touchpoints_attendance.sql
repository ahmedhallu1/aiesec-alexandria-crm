-- Elevate v29 — THE TM MODULE: touch points, attendance, appeals.
--
-- A touch point is a scheduled LC/function/team moment (meeting · working
-- hours · outing). Only a start time is set (no end). Attendance is recorded
-- afterwards — manually for meetings/outings, AUTOMATICALLY for working hours
-- (≥2 real work actions ≥10 min apart inside the session window).
--
-- Booking rights: Team Leader → team_* (may invite sibling teams) · VP or
-- Director → function_* (may invite other functions) · TM VP/MM → lc_* ·
-- LCP/admin → everything.

create table if not exists touch_points (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('team', 'function', 'lc')),
  kind text not null check (kind in ('meeting', 'working_hours', 'outing')),
  -- who it belongs to: the team's name + function, or the function, or the LC
  function_key text,
  team_name text,
  starts_at timestamptz not null,
  note text,
  -- extra audiences the owner invited (team names / function keys)
  invited_teams jsonb not null default '[]',
  invited_functions jsonb not null default '[]',
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  cancel_reason text,
  owner_id uuid references members(id) on delete set null,
  owner_name text not null,
  -- attendance bookkeeping: who must fill it, and the nag ladder
  attendance_recorded_at timestamptz,
  attendance_reminders int not null default 0,
  attendance_reminded_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists touch_points_starts_idx on touch_points (starts_at desc);
create index if not exists touch_points_scope_idx on touch_points (scope, function_key, team_name);

create table if not exists touch_point_attendance (
  id uuid primary key default gen_random_uuid(),
  touch_point_id uuid not null references touch_points(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  status text not null check (status in ('attended', 'absent', 'late')),
  excused boolean not null default false,
  excuse text,
  -- true when the working-hours engine decided it, not a human
  automatic boolean not null default false,
  recorded_by uuid references members(id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tp_attendance_key on touch_point_attendance (touch_point_id, member_id);
create index if not exists tp_attendance_member_idx on touch_point_attendance (member_id);

-- "I think this is wrong": mailed to whoever recorded it + TM VP/MMs on CC
create table if not exists attendance_appeals (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references touch_point_attendance(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists attendance_appeals_open_idx on attendance_appeals (resolved, created_at desc);

-- every meaningful work action, stamped — the raw material of automatic
-- working-hours attendance (2+ actions ≥10 min apart inside the window)
create table if not exists work_activity (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists work_activity_member_at_idx on work_activity (member_id, at desc);

-- the GENERAL "you must act" ladder (v29): 3 reminders, then a blocking
-- prompt on next app open. Reused by any future must-do action.
create table if not exists pending_prompts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  kind text not null,
  ref_id uuid,
  title text not null,
  body text,
  link text,
  reminders int not null default 0,
  last_reminded_on date,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists pending_prompts_open_idx on pending_prompts (member_id, resolved);

alter table touch_points enable row level security;
alter table touch_point_attendance enable row level security;
alter table attendance_appeals enable row level security;
alter table work_activity enable row level security;
alter table pending_prompts enable row level security;

create trigger touch_points_updated_at before update on touch_points
  for each row execute function set_updated_at();
create trigger tp_attendance_updated_at before update on touch_point_attendance
  for each row execute function set_updated_at();

notify pgrst, 'reload schema';
