-- Sodio v8 — in-app notifications + feedback workflow (anonymous, status).
-- Run in the Supabase SQL editor (after 0007_visit_scheduled_result.sql).

-- ---------------------------------------------------------------- notifications
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  kind text not null default 'info',           -- welcome / reset / visit / followup / thanks / broadcast / info
  title text not null,
  body text,
  created_by uuid references members(id),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_member_idx
  on notifications (member_id, created_at desc);
alter table notifications enable row level security;

-- ---------------------------------------------------------------- feedback workflow
alter table feedback add column if not exists anonymous boolean not null default false;
alter table feedback add column if not exists status text not null default 'new';
alter table feedback drop constraint if exists feedback_status_check;
alter table feedback add constraint feedback_status_check
  check (status in ('new', 'done', 'archived'));

-- make PostgREST pick up the new enum values / columns immediately
notify pgrst, 'reload schema';
