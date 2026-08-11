-- 0056 — PICK WHO IS ACTUALLY INVITED (v33.34)
--
-- A touch point's audience has always been DERIVED: pick a scope (my team, my
-- function, the LC) and everyone matching it is invited, announced to, and
-- marked present or absent. That is right most of the time and wrong the rest:
-- a function meeting the newest three members aren't in yet, working hours for
-- half the team, an outing two people already said they can't make. There was
-- no way to say so — they were marked ABSENT from something nobody expected
-- them at.
--
-- `members` is an OPT-OUT list, not a replacement rule: NULL (the default, and
-- every existing row) means "derive it", exactly as before, so an audience
-- keeps growing as people join the function. A non-null array means the
-- booker looked at the derived list and unticked somebody — and then THAT is
-- the audience, for the invite and for the attendance sheet alike.
--
-- The server only ever stores a SUBSET of the derived audience, so this can
-- never widen anyone's reach: unticking is allowed, adding a stranger is not.

alter table touch_points
  add column if not exists members uuid[];

comment on column touch_points.members is
  'v33.34 — the explicit guest list, when the booker unticked someone. NULL = derive the audience from scope/function/team (the pre-0056 behaviour). Always a subset of the derived audience.';
