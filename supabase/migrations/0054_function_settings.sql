-- 0054 — FUNCTION DEFAULTS (v33.32)
--
-- Until now every function-wide default was a constant in the code: new
-- accounts got Podio continuous updates because their function was in a
-- hard-coded list, the cadence was 14 days for everyone, a Member saw their
-- own accounts and nothing else, and the OGX/TM behaviours were on for all.
-- Those are the LEADER's calls, not the system's — so each function gets one
-- row here and its VP/Director edits it from their profile.
--
-- One JSONB blob rather than a column per switch: the set will grow with every
-- release, and a settings table that needs a migration per toggle is a table
-- nobody adds toggles to. The SHAPE lives in src/lib/function-settings.ts,
-- which also holds the defaults — an empty/absent row must mean exactly the
-- behaviour that shipped before this migration.

create table if not exists function_settings (
  function_key    text primary key,
  settings        jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references members(id) on delete set null,
  updated_by_name text
);

comment on table function_settings is
  'Per-function defaults set by that function''s LCVP/Director (v33.32). One row per function key (IGV, IGT, B2B, BD, B2C, OGT, OGV, TM). Absent row = the built-in defaults in src/lib/function-settings.ts.';
