-- 0035 — the IR's phone, collected at booking time (APPLIED via Supabase MCP).
--
-- The crew reaches IRs on WhatsApp, so the public booking form now REQUIRES a
-- number with its country code (a local-format number from another country is
-- unusable). Stored in full international form, +<country code><number>.
-- Nullable in the DB because every call booked before this has none.
alter table ir_calls add column if not exists booker_phone text;
