-- Ops v2 — tagged multi contacts + performance goals (function/team, per period).
-- Run in the Supabase SQL editor (after 0002_membership_v2.sql).

-- ---------------------------------------------------------------- account contacts
-- Multiple phones/emails per account, each with a tag ("CEO", "HR", …).
alter table accounts add column if not exists contacts jsonb not null default '[]';

update accounts set contacts =
  coalesce(
    case when phone is not null and btrim(phone) <> ''
      then jsonb_build_array(jsonb_build_object('tag','Contact','kind','phone','value',phone))
      else '[]'::jsonb end
    ||
    case when email is not null and btrim(email) <> ''
      then jsonb_build_array(jsonb_build_object('tag','Contact','kind','email','value',email))
      else '[]'::jsonb end,
  '[]'::jsonb)
where contacts = '[]'::jsonb
  and ((phone is not null and btrim(phone) <> '') or (email is not null and btrim(email) <> ''));

-- ---------------------------------------------------------------- performance goals
-- The month/peak slots goal each VP (function) or Team Leader (team) commits to.
create table if not exists performance_goals (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('function','team')),
  function text,                                -- 'IGV' | 'IGT' when scope = function
  team_leader_id uuid references members(id),   -- when scope = team
  metric text not null default 'Slots',
  target int not null check (target > 0),
  period_label text not null,                   -- e.g. 'July 2026' or 'Summer Peak 26'
  period_start date not null,
  period_end date not null,
  created_by uuid references members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists performance_goals_lookup_idx
  on performance_goals (scope, function, team_leader_id, period_end desc);
alter table performance_goals enable row level security;
create trigger performance_goals_updated_at
  before update on performance_goals for each row execute function set_updated_at();
