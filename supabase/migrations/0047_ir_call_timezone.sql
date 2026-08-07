-- 0047 — the IR's own time zone (v33.22)
--
-- Every call is stored as a UTC instant, so no booking was ever at the wrong
-- MOMENT. What was wrong is what the IR was shown: the public page rendered
-- Cairo time with a one-line footnote, so an IR in Jakarta picked "6:00 PM"
-- meaning 6 PM where they live. Google Calendar renders in the viewer's zone;
-- from now on so do we — and the zone the IR was looking at is recorded, so
-- every later email can speak their local time instead of ours.
--
-- Old rows have no zone: their emails fall back to the partner LC's country
-- (see zoneForCountry in src/lib/timezones.ts), and say Cairo time plainly
-- when even that is unknown.

alter table ir_calls add column if not exists booker_tz text;
-- what the LC's IRs have used before — the default offered on the next
-- booking from the same LC, and the fallback for their old calls
alter table partner_lcs add column if not exists timezone text;
