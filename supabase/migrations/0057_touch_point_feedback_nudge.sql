-- 0057 — ASK FOR THE RATING, ONCE (v33.35)
--
-- v33.33 turned session feedback into 1–5 stars, which takes about four
-- seconds. Nobody was ever asked for it, so almost nobody gave it — the
-- feature existed and the data didn't.
--
-- One email at the end of the day to everyone who was at a touch point that
-- happened, TM and the booker on CC. The stamp is what makes it ONCE: an
-- inbox that asks twice for a four-second job is an inbox people filter.

alter table touch_points
  add column if not exists feedback_asked_at timestamptz;

comment on column touch_points.feedback_asked_at is
  'v33.35 — when the end-of-day "rate it" email went out to this touch point''s audience. Set once; the cron skips anything already stamped.';
