-- Sodio v9 — B2B accounts, per-product deal opens, manual archived accounts,
-- avatars, emailed temp passwords, next-step calendar reminders, richer view.
-- Run in the Supabase SQL editor (after 0008_notifications_feedback.sql).

-- ---------------------------------------------------------------- B2B product
-- B2B members raise for the whole ICX: their accounts are product "B2B" and
-- each deal records its opens split across IGV / IGTa / IGTe.
alter type lc_function add value if not exists 'B2B';
alter table accounts drop constraint if exists accounts_function_check;
alter table accounts add constraint accounts_function_check
  check (function::text in ('IGV', 'IGT', 'B2B'));

-- ---------------------------------------------------------------- deal breakdowns
-- Every deal now carries its opens per product (IGV accounts → all IGV;
-- IGT accounts → IGTa + IGTe; B2B accounts → any mix of the three).
alter table deals add column if not exists slots_igv  int not null default 0;
alter table deals add column if not exists slots_igta int not null default 0;
alter table deals add column if not exists slots_igte int not null default 0;

-- accounts keep running per-product totals (mirroring slots_count)
alter table accounts add column if not exists slots_igv_count  int not null default 0;
alter table accounts add column if not exists slots_igta_count int not null default 0;
alter table accounts add column if not exists slots_igte_count int not null default 0;

-- legacy deals were single-product: attribute them to the account's product
update deals d set slots_igv = d.slots
  from accounts a
  where a.id = d.account_id and a.function::text = 'IGV'
    and d.slots_igv = 0 and d.slots_igta = 0 and d.slots_igte = 0;
update deals d set slots_igte = d.slots
  from accounts a
  where a.id = d.account_id and a.function::text = 'IGT' and a.product::text = 'GTe'
    and d.slots_igv = 0 and d.slots_igta = 0 and d.slots_igte = 0;
update deals d set slots_igta = d.slots
  from accounts a
  where a.id = d.account_id and a.function::text = 'IGT'
    and coalesce(a.product::text, 'GTa') <> 'GTe'
    and d.slots_igv = 0 and d.slots_igta = 0 and d.slots_igte = 0;

update accounts a set
  slots_igv_count  = coalesce((select sum(d.slots_igv)  from deals d where d.account_id = a.id), 0),
  slots_igta_count = coalesce((select sum(d.slots_igta) from deals d where d.account_id = a.id), 0),
  slots_igte_count = coalesce((select sum(d.slots_igte) from deals d where d.account_id = a.id), 0);

-- ---------------------------------------------------------------- members
alter table members add column if not exists avatar_url text;         -- chosen avatar (falls back to Google photo)
alter table members add column if not exists temp_password_hash text; -- emailed "forgot password" password
alter table members add column if not exists temp_password_at timestamptz;

-- ---------------------------------------------------------------- next-step reminders
-- follow-up reminders land on the responsible's calendar (at the set time, or
-- 11:00 when the next step has a date only)
alter table accounts add column if not exists next_step_event_id text;

-- ---------------------------------------------------------------- pipeline view v4
-- adds: last contact result/method + latest deal info (accounts-list hovers)
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

-- make PostgREST pick everything up immediately
notify pgrst, 'reload schema';
