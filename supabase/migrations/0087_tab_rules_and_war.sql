-- 0087 — THE TAB MANAGER + THE "NO PEACE" WAR (v38)
--
-- tab_rules: one row per sidebar tab the LCP/admins have touched. A tab with
-- no row behaves exactly as the code says (the built-in RBAC rule). The rule
-- is resolved by src/lib/tabs.ts; the columns mirror its TabRule type.
--
-- war_campaigns / war_entries: the points race the F&L VP runs from the War
-- Room tab (/war-room) and that the public page /no-peace shows live. Points
-- are NOT stored per entry for achievements — they come from the campaign's
-- point table at read time, so fixing a value re-scores every entry. Only a
-- bonus entry carries its own number. Entries are soft-deleted (undo).
--
-- RLS on, no policies: the anon/publishable key reaches none of it. Every
-- read and write goes through the service role behind the RBAC layer.

create table if not exists tab_rules (
  href text primary key,
  label text,
  position integer,
  base text not null default 'default' check (base in ('default', 'everyone', 'nobody')),
  show_to jsonb not null default '{}'::jsonb,
  hide_from jsonb not null default '{}'::jsonb,
  visible_from timestamptz,
  remove_at timestamptz,
  retired_at timestamptz,
  public_off boolean not null default false,
  public_with_tab boolean not null default false,
  note text,
  updated_by uuid references members(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table tab_rules enable row level security;

create table if not exists war_campaigns (
  slug text primary key,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references members(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table war_campaigns enable row level security;

create table if not exists war_entries (
  id uuid primary key default gen_random_uuid(),
  campaign text not null references war_campaigns(slug) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  kind text not null,
  qty integer not null default 1 check (qty between 1 and 1000),
  points integer check (points between -1000 and 1000),
  note text,
  occurred_on date not null default ((now() at time zone 'Africa/Cairo')::date),
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references members(id) on delete set null,
  -- a bonus carries its own number; an achievement never does
  constraint war_entries_bonus_points check ((kind = 'bonus') = (points is not null))
);
alter table war_entries enable row level security;

create index if not exists war_entries_live_idx
  on war_entries (campaign, created_at desc) where deleted_at is null;
create index if not exists war_entries_member_idx
  on war_entries (campaign, member_id) where deleted_at is null;

insert into war_campaigns (slug, name)
values ('no-peace', 'No Peace')
on conflict (slug) do nothing;
