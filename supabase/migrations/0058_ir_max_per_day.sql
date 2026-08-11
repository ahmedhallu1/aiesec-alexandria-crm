-- 0058 — A DAILY CAP ON IR CALLS (v33.37)
--
-- A member whose link is popular can wake up to four back-to-back calls on
-- one afternoon. The buffer spaces them; nothing LIMITED them. `max_per_day`
-- caps how many scheduled calls one Cairo day may hold — once reached, the
-- booking page simply stops offering that day. NULL = no cap (the old
-- behaviour, and the default).

alter table ir_booking_settings
  add column if not exists max_per_day int
    check (max_per_day is null or (max_per_day between 1 and 10));

comment on column ir_booking_settings.max_per_day is
  'v33.37 — max scheduled IR calls per Cairo day; NULL = unlimited.';
