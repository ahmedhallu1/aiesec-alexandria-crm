-- 0060 (v33.39): PER-WEEKDAY IR-CALL CAPS.
--
-- v33.37's max_per_day is one number for every day, and real weeks aren't
-- flat: "3 a day, but Sunday only 1". The overrides ride one JSONB map —
-- {"0": 1} means Sunday (JS getUTCDay convention, 0=Sunday) caps at 1 —
-- and a day without an override follows max_per_day as before.

alter table public.ir_booking_settings
  add column if not exists max_per_day_overrides jsonb;
