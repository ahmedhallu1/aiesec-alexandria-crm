-- AIESEC in Alexandria CRM — initial schema
-- Run this in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type lc_function as enum ('IGV', 'IGT', 'OGV', 'OGT');
-- ICX = works both Raising and Consideration; OGX = OGV/OGT (no sub-function split)
create type sub_function as enum ('Raising', 'Consideration', 'ICX', 'OGX');
create type member_role as enum ('LCP', 'VP', 'TL', 'Coordinator', 'Member');
create type igt_product as enum ('GTa', 'GTe'); -- Global Talent / Global Teacher
create type contact_method as enum ('Call', 'WhatsApp', 'Email');
create type contact_status as enum ('No Response', 'Responded', 'Interested', 'Not Interested', 'Wrong Contact');
create type request_state as enum ('Checking', 'Approved', 'Rejected');

-- ---------------------------------------------------------------- members
create table members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nickname text,
  email text not null unique,
  phone text,
  function lc_function,                      -- null for LCP
  sub_function sub_function,                 -- null for LCP
  role member_role not null default 'Member',
  stakeholder_email text,                    -- as written in the Membership sheet
  stakeholder_id uuid references members(id),-- resolved on import
  team_name text,                            -- optional, shown for TLs
  is_active boolean not null default true,
  google_refresh_token text,                 -- for calendar events on their own calendar
  first_login_at timestamptz,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index members_stakeholder_idx on members (stakeholder_id);
create index members_email_lower_idx on members (lower(email));

-- ---------------------------------------------------------------- accounts
create table accounts (
  id uuid primary key default gen_random_uuid(),
  function lc_function not null check (function in ('IGV', 'IGT')),
  name text not null,
  normalized_name text generated always as (regexp_replace(lower(btrim(name)), '\s+', ' ', 'g')) stored,

  -- IGT-specific
  product igt_product,                       -- required when function = IGT
  sub_product text,

  -- IGV-specific
  project text,                              -- Skill Up!, Rooted, ... (required when function = IGV)
  account_type text,
  industry text,
  package_plan text,
  proposal_sent boolean not null default false,

  -- shared contact info
  phone text,
  email text,
  social_link text,
  website text,

  -- Podio (manual fields, no API)
  podio_link text,
  requested_podio boolean not null default false, -- filled by the account owner
  request_state request_state,                    -- filled by TL / Coordinator / VP

  responsible_id uuid not null references members(id),

  -- pipeline
  next_step text,
  next_step_date date,
  next_step_time time,
  slot_raised boolean not null default false,
  slot_raised_at timestamptz,
  slots_count int not null default 0,
  out_of_process boolean not null default false,
  oop_reason text,
  oop_at timestamptz,

  -- comments
  tl_comment text,
  vp_comment text,
  final_comment text,

  created_by uuid references members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- HARD RULE: an account name may exist only once across ALL ICX data
create unique index accounts_normalized_name_key on accounts (normalized_name);
create index accounts_responsible_idx on accounts (responsible_id);
create index accounts_function_idx on accounts (function);
create index accounts_name_trgm_idx on accounts using gin (normalized_name gin_trgm_ops);

-- ---------------------------------------------------------------- contact attempts
create table contact_attempts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  member_id uuid not null references members(id),
  method contact_method not null,
  status contact_status not null,
  comment text,
  created_at timestamptz not null default now()
);
create index contact_attempts_account_idx on contact_attempts (account_id);

-- ---------------------------------------------------------------- visits
create table visits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  member_id uuid not null references members(id),
  visit_date date not null,
  visit_time time not null,
  calendar_event_id text,
  done boolean,                               -- null = pending confirmation
  visit_comment text,
  next_step text,
  followup_prompt_sent_at timestamptz,        -- the +2h "was it completed?" email
  report_sent_at timestamptz,                 -- the VP/stakeholder notification
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visits_account_idx on visits (account_id);
create index visits_pending_idx on visits (done) where done is null;

-- ---------------------------------------------------------------- blacklist (shared across ICX, managed by VPs)
create table blacklist (
  id uuid primary key default gen_random_uuid(),
  account_name text not null,
  normalized_name text generated always as (regexp_replace(lower(btrim(account_name)), '\s+', ' ', 'g')) stored,
  project text,
  comments text,
  podio_link text,
  link text,
  added_by uuid references members(id),
  created_at timestamptz not null default now()
);
create unique index blacklist_normalized_name_key on blacklist (normalized_name);
create index blacklist_name_trgm_idx on blacklist using gin (normalized_name gin_trgm_ops);

-- ---------------------------------------------------------------- feedback & goals & settings & audit
create table feedback (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id),
  type text not null check (type in ('Bug', 'Enhancement', 'Other')),
  message text not null,
  page text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  function lc_function not null,
  metric text not null check (metric in ('Slots', 'Approvals', 'Completes')),
  target int not null default 0,
  term text not null default 'Summer Peak 26',
  unique (function, metric, term)
);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references members(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- updated_at triggers
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger members_updated_at before update on members for each row execute function set_updated_at();
create trigger accounts_updated_at before update on accounts for each row execute function set_updated_at();
create trigger visits_updated_at before update on visits for each row execute function set_updated_at();

-- ---------------------------------------------------------------- pipeline view
-- Funnel: Lead → Contacted → Visit Scheduled → Visit Done → Deal Done (Slot Raised)
create or replace view accounts_pipeline as
select
  a.*,
  m.name  as responsible_name,
  m.nickname as responsible_nickname,
  m.email as responsible_email,
  m.stakeholder_id as responsible_stakeholder_id,
  m.function as responsible_function,
  m.role as responsible_role,
  m.team_name as responsible_team_name,
  coalesce(c.attempts, 0) as attempts,
  coalesce(c.no_response_attempts, 0) as no_response_attempts,
  c.last_contact_at,
  v.visit_id,
  v.visit_date,
  v.visit_time,
  v.visit_done,
  v.visit_comment,
  case
    when a.out_of_process then 'Out of Process'
    when a.slot_raised then 'Deal Done'
    when v.visit_done then 'Visit Done'
    when v.visit_id is not null then 'Visit Scheduled'
    when coalesce(c.attempts, 0) > 0 then 'Contacted'
    else 'Lead'
  end as stage,
  -- 3-contact rule: 3+ attempts, none of them answered, still in process
  (coalesce(c.attempts, 0) >= 3
    and coalesce(c.attempts, 0) = coalesce(c.no_response_attempts, 0)
    and not a.out_of_process
    and not a.slot_raised) as contact_limit_reached,
  -- Next-step obligation: contacted at least once, no visit scheduled, no next step, still in process
  (coalesce(c.attempts, 0) > 0
    and v.visit_id is null
    and a.next_step_date is null
    and not a.out_of_process
    and not a.slot_raised) as next_step_missing
from accounts a
join members m on m.id = a.responsible_id
left join lateral (
  select count(*) as attempts,
         count(*) filter (where status = 'No Response') as no_response_attempts,
         max(created_at) as last_contact_at
  from contact_attempts where account_id = a.id
) c on true
left join lateral (
  select id as visit_id, visit_date, visit_time, done as visit_done, visit_comment
  from visits where account_id = a.id
  order by visit_date desc, visit_time desc
  limit 1
) v on true;

-- ---------------------------------------------------------------- security
-- All application access goes through the Next.js server using the service-role key.
-- Enabling RLS with no policies blocks the public anon key entirely.
alter table members enable row level security;
alter table accounts enable row level security;
alter table contact_attempts enable row level security;
alter table visits enable row level security;
alter table blacklist enable row level security;
alter table feedback enable row level security;
alter table goals enable row level security;
alter table app_settings enable row level security;
alter table audit_log enable row level security;

-- ---------------------------------------------------------------- seed goals (from tracker: SLOTS 100 / APPROVALS 50 / COMPLETES 50)
insert into goals (function, metric, target) values
  ('IGT', 'Slots', 100), ('IGT', 'Approvals', 50), ('IGT', 'Completes', 50),
  ('IGV', 'Slots', 100), ('IGV', 'Approvals', 50), ('IGV', 'Completes', 50);
