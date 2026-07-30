-- Sodio v24 — the TEAMS REGISTRY.
-- Team-Leader teams get first-class rows: type 'Team' with the function in
-- function_key and the team's NAME (several per function allowed). The old
-- one-per-(type,function) unique index becomes (type, function_key, name) so
-- EB/LB/Function/MM stay effectively single (import upserts by the triple)
-- while 'Team' rows can multiply. Managed from the Membership page.
-- Run in the Supabase SQL editor (after 0021).

alter table teams drop constraint if exists teams_type_check;
alter table teams
  add constraint teams_type_check check (type in ('EB', 'LB', 'Function', 'MM', 'Team'));

drop index if exists teams_type_fn_key;
create unique index if not exists teams_type_fn_name_key on teams (type, function_key, name);

notify pgrst, 'reload schema';
