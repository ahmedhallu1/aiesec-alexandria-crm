-- 0081 (v36.6) — the Activate 26' hosting bid page, and the walkthrough that
-- kept coming back.
--
-- ① THE WALKTHROUGH IS REMEMBERED BY THE SERVER, NOT THE BROWSER.
--    The first-run tour stored "seen" in localStorage and only wrote it when the
--    tour was CLOSED cleanly (Done or ✕). Closing the app mid-tour, a browser
--    that clears site data, the Android app vs. the browser, a second phone —
--    every one of those met the tour again, from step 1, on every visit. That is
--    exactly what Yassin ElHawash reported. The flag now lives on the member and
--    is set the moment the tour OPENS, so any way out of it counts.
--
--    Everyone who has already entered Sodio has, by construction, already been
--    shown the tour (it auto-opened for anyone without the browser flag), so
--    they are backfilled as seen. New members still get it once; anyone can
--    replay it from Help.
alter table members add column if not exists tour_seen_at timestamptz;
update members
   set tour_seen_at = coalesce(profile_completed_at, now())
 where profile_completed_at is not null
   and tour_seen_at is null;

-- ② THE BID PLAN, EDITABLE LIKE A SHEET.
--    A section is one act of the page (hero, the timeline, a table). Its rows
--    are the sheet's rows; a row's cells live in `data` keyed by column key.
--    Editing a cell merges ONE key into `data` in a single statement, so two
--    people editing different cells of the same row never overwrite each other.
--    Rows are soft-deleted so the other editors' screens can learn about the
--    deletion from the same "changed since" poll.
create table if not exists activation_sections (
  id            text primary key,
  position      double precision not null default 0,
  kind          text not null check (kind in ('hero', 'timeline', 'table')),
  title         text not null default '',
  subtitle      text not null default '',
  config        jsonb not null default '{}'::jsonb,
  hidden_public boolean not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references members(id) on delete set null
);

create table if not exists activation_rows (
  id          uuid primary key default gen_random_uuid(),
  section_id  text not null references activation_sections(id) on delete cascade,
  position    double precision not null default 0,
  data        jsonb not null default '{}'::jsonb,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references members(id) on delete set null
);

create index if not exists activation_rows_section_idx
  on activation_rows (section_id, position) where deleted_at is null;
create index if not exists activation_rows_updated_idx
  on activation_rows (updated_at);

-- the app reads and writes with the service role; nothing is exposed to anon
alter table activation_sections enable row level security;
alter table activation_rows enable row level security;

-- one cell (or a few) of one row, atomically: `data || patch` replaces only the
-- keys in the patch
create or replace function activation_set_cells(p_row uuid, p_patch jsonb, p_member uuid)
returns timestamptz
language sql
set search_path = public
as $$
  update activation_rows
     set data = data || coalesce(p_patch, '{}'::jsonb),
         updated_at = now(),
         updated_by = p_member
   where id = p_row
     and deleted_at is null
  returning updated_at;
$$;

revoke execute on function activation_set_cells(uuid, jsonb, uuid) from public, anon, authenticated;
