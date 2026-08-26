-- 0068 — THE CXP MODULE (v35)
--
-- The AIESEC in Alexandria "Internal Auditing System" was a standalone Next.js
-- app with no database at all: it parsed the ECB SubTool Google Sheet on every
-- sync and held the result in a per-lambda memory cache. That is why nothing in
-- it could be filtered, sorted or looked at historically — there was nothing to
-- query.
--
-- This migration gives it one. The module tracks, per exchange participant, the
-- documents the ECB requires at each stage of their journey, and whether the LC
-- has collected them before the weekly deadline (the 6th / 13th / 20th / 27th).
-- Failing that audit costs the LC money and can freeze a product, so these
-- tables are a compliance record, not a convenience.
--
-- FOUR TABLES:
--   cxp_ep_records         one row per (EP x function x stage) — the SubTool's
--                          own shape, mirrored
--   cxp_requirement_status one row per document we do or don't have
--   cxp_weekly_missing     what was missing at each weekly deadline — the
--                          per-week HISTORY the old app wrote and never read
--                          back, which is why its week selector showed the same
--                          numbers for every week
--   cxp_email_log          every submission reminder sent, with its recipients
--
-- RLS is enabled with NO policies on all four, exactly like the other forty
-- tables: a deliberate deny-all to anon/authenticated. The app reaches them
-- through the service-role key and authorizes every read in src/lib/cxp/rbac.ts
-- BEFORE the query runs.

-- ---------------------------------------------------------------- EP records

create table if not exists public.cxp_ep_records (
  id uuid primary key default gen_random_uuid(),

  -- identity. The SubTool keys an EP by "EP ID / Opportunity ID"; the same
  -- person appears once per stage, and once per function if they somehow
  -- straddle two (which is a data error worth being able to SEE).
  ep_opp_id text not null,
  ep_name text not null default '',
  product text not null default '',          -- raw: "GV", "GTa", "GTe"
  function text not null check (function in ('IGV','IGT','OGV','OGT')),
  side text not null check (side in ('ICX','OGX')),
  stage_key text not null check (
    stage_key in ('approval','post_approval','realization','finish','monthly')
  ),
  status text not null default '',           -- raw "Current Status" on EXPA

  -- THE DATES THAT DRIVE EVERY DEADLINE (src/lib/cxp/deadlines.ts).
  -- Nullable on purpose: a half-filled SubTool row is the normal case, and the
  -- engine returns "no deadline" rather than inventing one.
  approval_date date,
  start_date date,
  end_date date,
  arrival_date date,                          -- the FLIGHT date; anchors travel rules
  departure_date date,

  host_lc text,
  home_lc text,
  opportunity_name text,

  -- the ECB's own note on this row: what needs correcting
  ecb_comment text,
  submitted_flag boolean,
  audited_flag boolean,
  excused_flag boolean,

  -- WHICH MONTH'S SUBMISSION THIS IS (yyyy-MM-01).
  -- The SubTool splits current from past by TAB, not by column, so this is
  -- derived at sync time from the source tab name. The EP list defaults to the
  -- current month and puts last month's incomplete rows behind a toggle.
  submission_month date not null,
  is_past_month boolean not null default false,

  -- per-requirement booleans as read from the sheet, keyed by requirement key
  sheet_flags jsonb not null default '{}'::jsonb,

  -- provenance: which tab, which section, which row. Kept so a wrong number can
  -- be traced back to the cell that caused it instead of being argued about.
  source_sheet_name text not null default '',
  source_section_name text not null default '',
  source_row_number integer not null default 0,
  confidence_score numeric not null default 1,
  parsing_warnings text[] not null default '{}',
  needs_review boolean not null default false,

  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- The natural key. An EP occupies one row per function per stage; re-syncing
-- the sheet UPSERTs onto this, so a sync is idempotent and never doubles rows.
create unique index if not exists cxp_ep_records_key
  on public.cxp_ep_records (ep_opp_id, function, stage_key, submission_month);

create index if not exists cxp_ep_records_fn_month
  on public.cxp_ep_records (function, submission_month, is_past_month);
create index if not exists cxp_ep_records_side
  on public.cxp_ep_records (side, submission_month);
-- the EP list searches by name and by id
create index if not exists cxp_ep_records_name
  on public.cxp_ep_records (lower(ep_name));

comment on table public.cxp_ep_records is
  'One EP x function x stage, mirrored from the ECB SubTool sheet (v35). Upserted by the CXP sync; never edited by hand.';
comment on column public.cxp_ep_records.arrival_date is
  'The FLIGHT date. Every travel deadline (tickets -20d, OPS -7d, entry stamp +3d, 24h comm) anchors here, falling back to start_date when absent.';
comment on column public.cxp_ep_records.submission_month is
  'yyyy-MM-01. Derived from the source TAB name at sync time — the SubTool has no month column. Drives the EP list default (current month) and the last-month toggle.';

-- -------------------------------------------------------- requirement status

create table if not exists public.cxp_requirement_status (
  id uuid primary key default gen_random_uuid(),
  ep_opp_id text not null,
  function text not null check (function in ('IGV','IGT','OGV','OGT')),
  stage_key text not null check (
    stage_key in ('approval','post_approval','realization','finish','monthly')
  ),
  -- the stable requirement key from src/lib/cxp/requirements.ts. NOT a foreign
  -- key: the catalogue is code, because it is versioned business rules rather
  -- than data, and a document already filed must survive a rule being retired.
  requirement_key text not null,
  uploaded boolean not null default false,
  source text check (
    source in ('Website Upload','Manual Drive Upload','Sheet Flag')
  ),
  file_url text,
  file_id text,
  uploaded_by uuid references public.members(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists cxp_requirement_status_key
  on public.cxp_requirement_status (ep_opp_id, stage_key, requirement_key);
create index if not exists cxp_requirement_status_fn
  on public.cxp_requirement_status (function, uploaded);

comment on table public.cxp_requirement_status is
  'Whether one required document has been collected (v35). An explicit row WINS over the sheet flag on cxp_ep_records.sheet_flags — the upload is the more recent truth.';

-- ------------------------------------------------------ weekly missing history

-- THE TABLE THAT FIXES THE WEEK SELECTOR.
--
-- The old app appended to a "Weekly Missing Snapshot" sheet tab on every
-- reminder run and then never read it back — so past weeks had real history
-- sitting in storage that the UI could not show, and every week rendered the
-- same numbers. Here it is a first-class table and the week selector's source
-- for any deadline in the past.
create table if not exists public.cxp_weekly_missing (
  id uuid primary key default gen_random_uuid(),
  function text not null check (function in ('IGV','IGT','OGV','OGT')),
  deadline_date date not null,               -- the 6th / 13th / 20th / 27th
  ep_opp_id text not null,
  ep_name text not null default '',
  stage_key text not null,
  requirement_key text not null,
  requirement_name text not null default '',
  uploaded boolean not null default false,
  -- 'current'   = missing when this snapshot ran
  -- 'carry-over'= still missing from the PREVIOUS deadline
  origin text not null default 'current' check (origin in ('current','carry-over')),
  updated_at timestamptz not null default now()
);

-- one row per (deadline, EP, stage, requirement): re-running a snapshot
-- updates in place instead of accumulating duplicates the reader has to
-- collapse, which is what the sheet-based version had to do
create unique index if not exists cxp_weekly_missing_key
  on public.cxp_weekly_missing (function, deadline_date, ep_opp_id, stage_key, requirement_key);
create index if not exists cxp_weekly_missing_lookup
  on public.cxp_weekly_missing (function, deadline_date);

comment on table public.cxp_weekly_missing is
  'What was missing at each weekly ECB deadline (v35). The per-week HISTORY behind the weekly board — past weeks are read from here, upcoming weeks are derived from computed due dates.';

-- ------------------------------------------------------------------ email log

create table if not exists public.cxp_email_log (
  id uuid primary key default gen_random_uuid(),
  -- dedupe key: function|deadline|type. A reminder is sent ONCE per function
  -- per deadline however many times the cron fires.
  reminder_key text not null,
  function text not null check (function in ('IGV','IGT','OGV','OGT')),
  deadline_date date not null,
  reminder_type text not null default 'weekly',
  recipients text[] not null default '{}',
  -- people who SHOULD have been mailed but have no valid address on the
  -- membership sheet. Surfaced rather than silently dropped.
  missing_recipients text[] not null default '{}',
  ep_count integer not null default 0,
  status text not null check (status in ('sent','blocked','dry-run','failed')),
  -- why a send was blocked or how it failed, verbatim
  reason text,
  mode text not null default 'dry-run',
  sent_at timestamptz not null default now()
);

create unique index if not exists cxp_email_log_key
  on public.cxp_email_log (reminder_key)
  where status = 'sent';

create index if not exists cxp_email_log_recent
  on public.cxp_email_log (deadline_date desc, function);

comment on table public.cxp_email_log is
  'Every CXP submission reminder (v35). The partial unique index on status=''sent'' is the idempotency guard: a re-run cannot double-send, but a blocked or failed attempt can be retried.';

-- ---------------------------------------------------------------------- RLS
-- Deny-all to anon/authenticated, like every other table here. No policies is
-- deliberate: the app holds the service-role key and authorizes in the RBAC
-- layer before the query runs.

alter table public.cxp_ep_records         enable row level security;
alter table public.cxp_requirement_status enable row level security;
alter table public.cxp_weekly_missing     enable row level security;
alter table public.cxp_email_log          enable row level security;
