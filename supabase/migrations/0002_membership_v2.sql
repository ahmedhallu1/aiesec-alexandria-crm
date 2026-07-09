-- Membership v2 — final Membership sheet structure, password auth, numbered
-- comments, call scheduling.
-- Run in the Supabase SQL editor (after 0001_init.sql).

-- the pipeline view reads members.role/function, so drop it first (recreated below)
drop view if exists accounts_pipeline;

-- ---------------------------------------------------------------- members
-- New roles (LCVP / Team Leader / Director), multi-select functions and
-- sub-functions, stakeholder referenced by NAME, password login + onboarding.
alter table members add column if not exists password_hash text;
alter table members add column if not exists profile_completed_at timestamptz;
alter table members add column if not exists functions text[] not null default '{}';
alter table members add column if not exists sub_functions text[] not null default '{}';
alter table members add column if not exists stakeholder_name text;

update members set functions = array[function::text]
  where function is not null and functions = '{}';
update members set sub_functions = array[sub_function::text]
  where sub_function is not null and sub_functions = '{}';

-- role: enum -> text so new roles don't need enum surgery next time
alter table members alter column role drop default;
alter table members alter column role type text using role::text;
update members set role = 'LCVP' where role = 'VP';
update members set role = 'Team Leader' where role = 'TL';
alter table members alter column role set default 'Member';
alter table members add constraint members_role_check
  check (role in ('LCP','LCVP','Team Leader','Coordinator','Member','Director'));

alter table members drop column if exists function;
alter table members drop column if exists sub_function;
alter table members drop column if exists stakeholder_email;
drop type if exists member_role;

-- ---------------------------------------------------------------- contact status
-- "Call Scheduled" result (with a chosen date + time -> next step)
alter type contact_status add value if not exists 'Call Scheduled';

-- ---------------------------------------------------------------- numbered comments
-- Replaces the single tl/vp/final comment fields: every member logs as many
-- numbered comments as needed; TL/VP/LCP comments carry their label.
create table if not exists account_comments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  member_id uuid references members(id),
  author_label text not null default 'Member'
    check (author_label in ('Member','TL','VP','LCP')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists account_comments_account_idx
  on account_comments (account_id, created_at);
alter table account_comments enable row level security;

-- migrate any legacy one-field comments into the new table
insert into account_comments (account_id, member_id, author_label, body, created_at)
  select id, created_by, 'Member', final_comment, updated_at
  from accounts where final_comment is not null and btrim(final_comment) <> '';
insert into account_comments (account_id, member_id, author_label, body, created_at)
  select id, null, 'TL', tl_comment, updated_at
  from accounts where tl_comment is not null and btrim(tl_comment) <> '';
insert into account_comments (account_id, member_id, author_label, body, created_at)
  select id, null, 'VP', vp_comment, updated_at
  from accounts where vp_comment is not null and btrim(vp_comment) <> '';

alter table accounts drop column if exists tl_comment;
alter table accounts drop column if exists vp_comment;
alter table accounts drop column if exists final_comment;

-- ---------------------------------------------------------------- pipeline view
create or replace view accounts_pipeline as
select
  a.*,
  m.name  as responsible_name,
  m.nickname as responsible_nickname,
  m.email as responsible_email,
  m.stakeholder_id as responsible_stakeholder_id,
  m.functions as responsible_functions,
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
  (coalesce(c.attempts, 0) >= 3
    and coalesce(c.attempts, 0) = coalesce(c.no_response_attempts, 0)
    and not a.out_of_process
    and not a.slot_raised) as contact_limit_reached,
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
