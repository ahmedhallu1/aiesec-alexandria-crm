-- 0071 — THE ROAD TO A PARTNERSHIP (v35.1)
--
-- lc_partnerships knew two things about a target: it existed, and one day it
-- was done. Everything between — you wrote to them, they answered, a call got
-- booked, the call happened — lived in the member's head, so an MM watching a
-- target had no way to tell "nothing has happened yet" from "the call is on
-- Thursday", and the member had nothing to walk along.
--
-- ⚠️ `stage` HOLDS ONLY WHAT A HUMAN SET. Two of the five stages are facts
-- Sodio already holds — an IR call with that LC for that programme IS "call
-- scheduled", a completed one IS "call done" — and those are derived at read
-- time from ir_calls rather than copied here. The card shows the FURTHEST of
-- the two, so automatic movement is forward only and a cancelled call can
-- never silently drag a partnership backwards. The ladder lives in
-- src/lib/partnership-stage.ts; this column just remembers the human's half.

alter table lc_partnerships
  add column if not exists stage text,
  add column if not exists stage_by uuid references public.members(id) on delete set null,
  add column if not exists stage_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lc_partnerships_stage_check'
  ) then
    alter table lc_partnerships
      add constraint lc_partnerships_stage_check
      check (stage is null or stage in
        ('contacted','answered','call_scheduled','call_done','group_made'));
  end if;
end $$;

comment on column lc_partnerships.stage is
  'The stage a HUMAN set (v35.1). call_scheduled/call_done are also derived from ir_calls at read time; the card shows whichever is further along. Ladder: src/lib/partnership-stage.ts';
