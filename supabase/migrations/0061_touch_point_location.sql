-- 0061 (v33.43): WHERE the touch point happens.
--
-- A virtual one carries its Meet link and a note carries everything else —
-- which meant "third floor, the big room" lived in free text or nowhere, and
-- the invite email couldn't say where to go. One optional column, shown for
-- non-virtual touch points, printed in every invite/move email.

alter table public.touch_points
  add column if not exists location text;
