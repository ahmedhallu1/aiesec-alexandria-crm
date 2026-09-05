-- 0072 — THE AUDIT LOG GROWS UP (v36)
--
-- `audit_log` has recorded who did what to which entity since 0001, and after
-- 14,184 rows it still cannot answer the four questions anybody actually asks
-- after something goes wrong:
--
--   WHAT CHANGED?   `details` is a free-form jsonb blob written differently by
--                   each of the ~123 call sites, so "the account moved to IGV"
--                   and "the account was renamed" are the same shape and
--                   neither carries the value it replaced. `changed` fixes
--                   that with ONE agreed form — {field: [from, to]} — so a
--                   before→after diff can be rendered without knowing which
--                   action wrote the row.
--   WHO REALLY DID IT?  A test view (v14) makes every action REAL and
--                   attributes it to the impersonated member, by design. That
--                   is correct for the data and useless for the log: the log
--                   should name the admin. `real_actor_id` is filled from
--                   getRealViewer() whenever the two differ, and is NULL the
--                   rest of the time — i.e. NULL means "nobody was pretending".
--   FROM WHERE?     `ip` / `user_agent`, read from the request headers. They
--                   are absent on cron and script paths, and that is a fact
--                   worth being able to see rather than a gap to apologise for.
--   WAS IT ALLOWED, AND DID IT WORK?  `outcome` splits a refused attempt from
--                   a completed one from one that blew up halfway. Until now a
--                   denial left no trace at all: the only evidence that
--                   somebody tried to reach another function's accounts was
--                   the absence of a row.
--
-- And the largest hole of the lot: **zero authentication events**. Not one
-- sign-in, failed sign-in, password reset or Google grant is recorded, so the
-- first question of any incident — "who was in, and did anyone fail getting
-- in?" — has never had an answer here. `category` is what lets those live in
-- the same table as the data mutations without drowning them: the console
-- filters on it, and 'auth' / 'admin' / 'access' / 'integration' / 'security'
-- are each their own view of the same stream.
--
-- ⚠️ `category` and `severity` are plain text with a default, NOT enums or
-- checks. Their unions belong to src/server/audit.ts and will grow; a check
-- constraint here would mean a migration every time a new kind of event is
-- logged, which is exactly how a system ends up with events that are not
-- logged. `outcome` DOES carry a check because there are exactly three, the
-- code branches on them, and a typo would silently make a denial look like a
-- success — the one value where being wrong is dangerous.
--
-- Every column is added with a default that reproduces what the existing
-- 14,184 rows already were (a completed data mutation by the named actor), so
-- nothing is retroactively relabelled. On PG 11+ a NOT NULL column with a
-- constant default is a catalogue-only change — no table rewrite, no lock
-- worth measuring.

alter table public.audit_log
  -- the admin behind a test view, when the actor above is being impersonated
  add column if not exists real_actor_id uuid references public.members(id) on delete set null,
  -- {field: [from, to]}, only for the keys that actually moved
  add column if not exists changed jsonb,
  add column if not exists ip text,
  add column if not exists user_agent text,
  add column if not exists category text not null default 'data',
  add column if not exists outcome text not null default 'ok',
  add column if not exists severity text not null default 'info',
  -- one human sentence, written at the call site, so the console has something
  -- to show that does not require the reader to decode jsonb
  add column if not exists summary text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'audit_log_outcome_check'
  ) then
    alter table public.audit_log
      add constraint audit_log_outcome_check
      check (outcome in ('ok', 'denied', 'failed'));
  end if;
end $$;

-- ---------------------------------------------------------------- indexes
-- The console is server-side filtered and paged, so every one of these is a
-- filter it offers. `audit_log_created_idx` (0033) already covers the
-- unfiltered "newest first" page.

-- "everything this person did" — the first thing anybody asks about a member
create index if not exists audit_log_actor_idx
  on public.audit_log (actor_id, created_at desc);

-- "everything that happened to this account / member / sign-up". This one is
-- not only for the console: `accountCreationEntry` in src/server/data.ts reads
-- the creation row for ONE account on every account page and has been doing a
-- sequential scan over the whole table to find it.
create index if not exists audit_log_entity_idx
  on public.audit_log (entity, entity_id, created_at desc);

-- the category tabs (auth / admin / access / security)
create index if not exists audit_log_category_idx
  on public.audit_log (category, created_at desc);

-- the action filter's own dropdown is built by distinct-ing this column, and
-- 102 distinct values over 14k rows is exactly the shape a plain btree serves
create index if not exists audit_log_action_idx
  on public.audit_log (action);

-- ---------------------------------------------------------------- comments
comment on column public.audit_log.real_actor_id is
  'The admin who REALLY performed this, when a test view was active (v36). NULL means actor_id is the real person — nobody was impersonating.';
comment on column public.audit_log.changed is
  'Before→after diff as {field: [from, to]}, for the keys that actually changed. Written by diffFields() in src/server/audit.ts.';
comment on column public.audit_log.category is
  'data · auth · admin · access · integration · security (v36). Free text on purpose: the union lives in src/server/audit.ts and grows without a migration.';
comment on column public.audit_log.outcome is
  'ok · denied · failed. Checked, unlike category/severity: the code branches on it and a typo would make a refused attempt read as a successful one.';
comment on column public.audit_log.summary is
  'One human sentence for the admin console, written at the call site. Never parsed — details/changed carry the machine-readable half.';

-- ---------------------------------------------------------------------- RLS
-- RLS has been on since 0001 with no policies (the deliberate deny-all every
-- table here uses). The v33.47 audit added the second half of that wall to
-- every table it touched and audit_log was not one of them — so the grants
-- Supabase hands `anon`/`authenticated` by default are still sitting on the
-- one table that now holds IP addresses and authentication history. Close it.
-- The app reads this through the service-role key, which is unaffected.
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;

-- ⚠️ RETENTION IS 12 MONTHS and is NOT enforced here. Deleting old rows is a
-- sweep the app runs (see the audit console), not a database rule: a `delete`
-- in a migration would fire once and never again, which is the shape of a
-- retention policy that quietly stops existing.

notify pgrst, 'reload schema';

-- ------------------------------------------------------- verify (read-only)
-- Expect EIGHT rows. Fewer means the alter above rolled back — read the error,
-- do not trust the green tick. (In the Supabase SQL editor, make sure NOTHING
-- is selected before you hit Run: with a selection it runs only the highlight.)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'audit_log'
  and column_name in ('real_actor_id', 'changed', 'ip', 'user_agent',
                      'category', 'outcome', 'severity', 'summary')
order by column_name;
