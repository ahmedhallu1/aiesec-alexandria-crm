-- 0050 — a rescheduled IR call remembers what it used to be (v33.28)
--
-- A reschedule is an in-place overwrite: `called_at` is replaced and the old
-- instant is gone. The only trace was a bell and an email, both of which
-- scroll away — so the crew opens a call whose time has moved twice and has no
-- way to know that, let alone who moved it or when. "Have they messed us
-- about?" is not an answerable question today.
--
-- One jsonb column, append-only. Each entry: { at, from, to, by, byName }.
alter table ir_calls add column if not exists reschedules jsonb not null default '[]'::jsonb;
