-- Elevate v31 — touch points: remember whether the audience was ever told.
--
-- Two new realities (both asked for by the LC):
--   1. a touch point whose start time is ALREADY PAST is a LOG of something
--      that happened — nobody is invited to it, so no email and no bell,
--   2. the booker may switch the announcement off for any touch point
--      ("Tell everyone invited" — on by default).
--
-- The decision has to survive the insert: a later move or cancel re-announces,
-- and a point that was never announced must NOT suddenly mail people who never
-- heard of it. `announced` carries it.
--
-- Every row that exists today WAS announced (create always announced before
-- v31), so the default is true and the backfill is a no-op.

alter table touch_points
  add column if not exists announced boolean not null default true;

comment on column touch_points.announced is
  'false = the audience was never told (logged after the fact, or the booker '
  'switched the announcement off). Move/cancel stay silent for these rows.';
