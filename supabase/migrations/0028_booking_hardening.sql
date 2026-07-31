-- Sodio v27 review fixes (applied to prod 2026-08-01 via the Supabase MCP).
-- ① the ONLY real defense against a double-booked slot: two concurrent public
--    bookings pass the read-then-insert check together — the unique partial
--    index makes the second insert fail with 23505 ("slot just taken").
create unique index if not exists ir_calls_member_slot_key
  on ir_calls (member_id, called_at)
  where status = 'scheduled';

-- ② bookings remember the slot length they were made with, so a later
--    slot_minutes change never mis-computes overlaps for existing calls.
alter table ir_calls add column if not exists duration_minutes int;

notify pgrst, 'reload schema';
