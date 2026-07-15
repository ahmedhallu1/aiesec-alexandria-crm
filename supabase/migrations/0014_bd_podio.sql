-- Sodio v13 — BD accounts (B2B & BD are one function, two account labels) +
-- the Podio-submission workflow (pending filter, "ask to submit" pin).
-- Run in the Supabase SQL editor (after 0013_director_label.sql).

-- ---------------------------------------------------------------- BD accounts
-- B2B/BD members choose per account whether it's a B2B or a BD account; both
-- behave identically (whole-ICX opens mix), the label tells them apart.
alter type lc_function add value if not exists 'BD';
alter table accounts drop constraint if exists accounts_function_check;
alter table accounts add constraint accounts_function_check
  check (function::text in ('IGV', 'IGT', 'B2B', 'BD'));

-- ---------------------------------------------------------------- podio submit requests
-- A B2B/BD leader (MM / Director / VP) can ask the account owner to submit it
-- on Podio: sets this stamp, notifies the owner in-app, and pins the account
-- at the top of the owner's accounts list until it's requested/stated.
alter table accounts add column if not exists podio_submit_requested_at timestamptz;

-- ---------------------------------------------------------------- pipeline view v5
-- recreate so the view picks up the new column (a.* is captured at creation)
drop view if exists accounts_pipeline;
create view accounts_pipeline as
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
  lc.last_contact_status,
  lc.last_contact_method,
  v.visit_id,
  v.visit_date,
  v.visit_time,
  v.visit_done,
  v.visit_comment,
  ld.last_deal_at,
  ld.last_deal_slots,
  ld.last_deal_note,
  pc.pinned_comment,
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
  select status::text as last_contact_status, method::text as last_contact_method
  from contact_attempts where account_id = a.id
  order by created_at desc
  limit 1
) lc on true
left join lateral (
  select id as visit_id, visit_date, visit_time, done as visit_done, visit_comment
  from visits where account_id = a.id
  order by visit_date desc, visit_time desc
  limit 1
) v on true
left join lateral (
  select created_at as last_deal_at, slots as last_deal_slots, note as last_deal_note
  from deals where account_id = a.id
  order by created_at desc
  limit 1
) ld on true
left join lateral (
  select body as pinned_comment
  from account_comments
  where account_id = a.id and pinned
  order by created_at desc
  limit 1
) pc on true;

notify pgrst, 'reload schema';
