-- Sodio v11 — named AIESEC teams. The team STRUCTURE already lives in the
-- membership (roles / functions / stakeholder links); this table just gives
-- each team a NAME, imported from the "Teams" tab of the "CRM — Membership" sheet.
--   EB       the Executive Board (LCP + VPs)            e.g. IRIS
--   LB       Leadership Body (EB + MMs)
--   Function a whole function (VP + MMs + members)       e.g. IGT = فرقة ناجي عطالله, B2B = Suits
--   MM       a function's VP + their MMs (management)
-- Team-Leader teams keep using members.team_name.
-- Run in the Supabase SQL editor (after 0010_notif_link.sql).

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('EB', 'LB', 'Function', 'MM')),
  -- IGV / IGT / B2B for Function & MM teams; '' (empty) for the single EB / LB teams
  function_key text not null default '',
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one named team per (type, function)
create unique index if not exists teams_type_fn_key on teams (type, function_key);

alter table teams enable row level security;
create trigger teams_updated_at before update on teams
  for each row execute function set_updated_at();

notify pgrst, 'reload schema';
