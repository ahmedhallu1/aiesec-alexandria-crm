-- 0044: CUSTOM CALENDAR ITEMS (v33.16) — Google-Calendar-style slots/tasks.
--
-- Deliberately NOT a touch-point kind: touch points derive their audience
-- from scope/function/team and ride the attendance machinery (nightly
-- reminder ladder, working-hours engine, history). A custom item's audience
-- is an EXPLICIT list of members picked by its owner, it has no attendance,
-- and it must never be nagged about. A separate table keeps all of that
-- structurally impossible instead of filtered-out in four places.
--
-- Visibility = owner + assignees (like a calendar invite). Creation: Team
-- Leaders and above (TL → their team, VP/Director → their function, LCP/admin
-- → anyone) — enforced in the server action, service role bypasses RLS.

create table if not exists calendar_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  note text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  owner_id uuid not null references members(id),
  owner_name text not null,
  assignee_ids uuid[] not null default '{}',
  function_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_items_starts_idx on calendar_items (starts_at);
create index if not exists calendar_items_owner_idx on calendar_items (owner_id);

alter table calendar_items enable row level security;

notify pgrst, 'reload schema';
