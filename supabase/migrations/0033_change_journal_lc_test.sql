-- 0033 — the general change journal, undo-from-logs and LC-wide test sessions
--
-- v21 gave the admin's sandbox test view a row-level undo journal (test_undo).
-- Two v32 features build on it:
--
--   1. UNDO FROM THE LOGS (/admin): every audited mutation now carries a
--      CHANGE SET id. One server-action call = one request = one change set, so
--      the journal rows a single action wrote can be replayed in reverse as a
--      unit — that is what the Undo button on a log entry does.
--
--   2. LC-WIDE TESTING SESSIONS: the admin opens one session for the WHOLE LC,
--      everyone's writes are journaled into it, and closing it rolls the
--      database back. Unlike the per-admin sandbox, outbound side effects are
--      NOT suppressed (a deliberate choice — the LC tests the real thing,
--      emails included), so only the database is restored.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------- 1. sessions
alter table test_sessions add column if not exists kind text not null default 'view_as';

alter table test_sessions drop constraint if exists test_sessions_mode_check;
alter table test_sessions
  add constraint test_sessions_mode_check check (mode in ('sandbox', 'real', 'lc'));

alter table test_sessions drop constraint if exists test_sessions_kind_check;
alter table test_sessions
  add constraint test_sessions_kind_check check (kind in ('view_as', 'lc'));

-- an LC-wide session is global: at most ONE may be open at a time
create unique index if not exists test_sessions_one_open_lc
  on test_sessions ((kind))
  where kind = 'lc' and ended_at is null;

-- ----------------------------------------------------------------- 2. journal
-- session_id becomes NULLABLE: outside a test session the journal still
-- records every change, which is what makes undo-from-logs possible.
alter table test_undo alter column session_id drop not null;

alter table test_undo add column if not exists change_set uuid;
alter table test_undo add column if not exists actor_id uuid references members(id) on delete set null;
-- what the row WAS, in words, for the admin UI ("Account · Hadana Moves")
alter table test_undo add column if not exists label text;

create index if not exists test_undo_change_set_idx on test_undo (change_set);
create index if not exists test_undo_created_idx on test_undo (created_at desc);

-- ------------------------------------------------------------------ 3. audit
alter table audit_log add column if not exists change_set uuid;
alter table audit_log add column if not exists undone_at timestamptz;
alter table audit_log add column if not exists undone_by uuid references members(id) on delete set null;
-- the LC test session an entry belongs to (so its rows can be shown/undone
-- together, and so the session's own log is distinguishable)
alter table audit_log add column if not exists test_session_id uuid references test_sessions(id) on delete set null;

create index if not exists audit_log_change_set_idx on audit_log (change_set);
create index if not exists audit_log_created_idx on audit_log (created_at desc);
