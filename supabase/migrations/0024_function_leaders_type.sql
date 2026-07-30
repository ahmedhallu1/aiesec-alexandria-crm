-- Sodio v24.2 (applied to prod 2026-07-30 via the Supabase MCP).
-- Store the "Function leaders" team type under its REAL name (it had been
-- aliased to 'MM' since v12). The Membership Teams registry edits all
-- 5 types now: EB · LB · Function · Function leaders · Team.
alter table teams drop constraint if exists teams_type_check;
update teams set type = 'Function leaders' where type = 'MM';
alter table teams
  add constraint teams_type_check
  check (type in ('EB', 'LB', 'Function', 'Function leaders', 'Team'));
notify pgrst, 'reload schema';
