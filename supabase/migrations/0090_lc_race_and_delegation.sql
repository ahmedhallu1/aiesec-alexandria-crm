-- v38.5 — ALEX vs MUST (the LC-to-LC race to 150 approvals) + the Activate
-- delegation on the No Peace board.
--
--  · The race's settings live in `war_campaigns` under its own slug
--    ('alex-vs-must') — the same row shape the No Peace war uses, so the
--    settings JSON is edited from Sodio (the "Alex vs MUST" tab), never code.
--  · `race_readings`: every time CORE's total approvals for an LC CHANGES, one
--    row (or a reading typed by hand in the editor). The race's current count,
--    who got to the goal first and the trail chart are all derived from these.
--  · `race_entries`: slots that don't come from Sodio's deals — MUST logs its
--    own through a private link, the editor can add for either side.
--  · `activate_delegates`: who is registered for Activate, ticked by the F&L
--    VP in the War Room. Drives the bus on /no-peace and the in-app prompt.
--  · Realtime: the public race page may LISTEN on topic 'alex-vs-must' (only
--    the server can send — same rule as 'no-peace' in 0088).

insert into war_campaigns (slug, name)
values ('alex-vs-must', 'Alex vs MUST')
on conflict (slug) do nothing;

create table if not exists race_readings (
  id uuid primary key default gen_random_uuid(),
  campaign text not null references war_campaigns(slug) on delete cascade,
  side text not null check (side in ('home', 'rival')),
  total integer not null check (total between 0 and 100000),
  programs jsonb not null default '{}'::jsonb,
  source text not null default 'core' check (source in ('core', 'manual')),
  created_by uuid references members(id) on delete set null,
  at timestamptz not null default now()
);
alter table race_readings enable row level security;
create index if not exists race_readings_side_idx on race_readings (campaign, side, at desc);

create table if not exists race_entries (
  id uuid primary key default gen_random_uuid(),
  campaign text not null references war_campaigns(slug) on delete cascade,
  side text not null check (side in ('home', 'rival')),
  qty integer not null check (qty between 1 and 500),
  note text,
  occurred_on date not null default ((now() at time zone 'Africa/Cairo')::date),
  source text not null default 'link' check (source in ('link', 'editor')),
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references members(id) on delete set null
);
alter table race_entries enable row level security;
create index if not exists race_entries_live_idx
  on race_entries (campaign, created_at desc) where deleted_at is null;

create table if not exists activate_delegates (
  campaign text not null references war_campaigns(slug) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  marked_by uuid references members(id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (campaign, member_id)
);
alter table activate_delegates enable row level security;

drop policy if exists "alex-vs-must race: listen only" on realtime.messages;
create policy "alex-vs-must race: listen only"
  on realtime.messages
  for select
  to anon, authenticated
  using (realtime.topic() = 'alex-vs-must' and extension = 'broadcast');
