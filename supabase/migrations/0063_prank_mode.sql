-- 0063: 🃏 PRANK MODE (v33.51) — the EB can switch a member's Sodio into a
-- mischievous mood for a day, a week, the peak, or until they turn it off.
--
-- ONE column and one pointer. Everything the prank actually DOES lives in the
-- browser (src/components/crm/prankster.tsx): no jobs, no emails, no writes,
-- nothing on the sheet, nothing that can touch a number. The only server-side
-- fact is "is this person in a mood right now, and who did it to them".
--
-- prank_until  NULL or in the past  = off. A future instant = on until then.
--              "Until I turn it off" is stored as a far date (2099-12-31).
-- prank_by     accountability: a prank always has an author in the audit log
--              AND on the row, so nobody has to wonder who to get back at.

alter table members
  add column if not exists prank_until timestamptz,
  add column if not exists prank_by uuid references members(id) on delete set null;

comment on column members.prank_until is
  '🃏 Prank mode is ON until this instant (NULL/past = off). Client-side only: harmless UI mischief, never work, never data.';
comment on column members.prank_by is
  'Who switched prank mode on — the EB member responsible, for the audit trail.';

notify pgrst, 'reload schema';
