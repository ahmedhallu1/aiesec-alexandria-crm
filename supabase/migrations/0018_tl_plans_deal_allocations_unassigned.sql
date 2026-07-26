-- Sodio v22 — Team-Leader plans, per-member deal opens allocations, and
-- unassigned accounts (bulk sheet import). Run after 0017.

-- ------------------------------------------------- 1. Team-Leader plans
-- Raising TLs (IGV/IGT/B2B/BD) plan their team's OPENS per month of the peak,
-- mirroring mm_plans (which stays for OGX & Consideration MMs).
create table if not exists tl_plans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  month date not null,
  opens int not null default 0,
  peak text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, month)
);
alter table tl_plans enable row level security;

-- ------------------------------------------- 2. deal opens allocations
-- A deal's opens can be split across several members (e.g. 3 to the account
-- owner, 3 to whoever helped close). Every deal gets at least one allocation;
-- the default is 100% to the account's responsible. Leaderboards / member
-- KPIs / reports attribute opens from THIS table; lane totals still come from
-- the deals' per-product split columns.
create table if not exists deal_allocations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  slots_igv int not null default 0,
  slots_igta int not null default 0,
  slots_igte int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists deal_allocations_deal_idx on deal_allocations (deal_id);
create index if not exists deal_allocations_member_idx on deal_allocations (member_id);
alter table deal_allocations enable row level security;

-- Backfill: one allocation per existing deal, to the deal's member (frozen
-- responsible at record time) or the account's current responsible.
insert into deal_allocations (deal_id, member_id, slots_igv, slots_igta, slots_igte)
select d.id,
       coalesce(d.member_id, a.responsible_id),
       d.slots_igv, d.slots_igta, d.slots_igte
  from deals d
  join accounts a on a.id = d.account_id
 where coalesce(d.member_id, a.responsible_id) is not null
   and not exists (select 1 from deal_allocations da where da.deal_id = d.id);

-- ------------------------------------------------ 3. unassigned accounts
-- Bulk-imported market research lands without an owner; leaders assign
-- manually. Member/TL scopes never match NULL, so unassigned accounts are
-- visible to VPs/Directors/LCP only.
alter table accounts alter column responsible_id drop not null;

-- ------------------------- 4. accounts_pipeline: LEFT JOIN the responsible
create or replace view accounts_pipeline as
 SELECT a.id,
    a.function,
    a.name,
    a.normalized_name,
    a.product,
    a.sub_product,
    a.project,
    a.account_type,
    a.industry,
    a.package_plan,
    a.proposal_sent,
    a.phone,
    a.email,
    a.social_link,
    a.website,
    a.podio_link,
    a.requested_podio,
    a.request_state,
    a.responsible_id,
    a.next_step,
    a.next_step_date,
    a.next_step_time,
    a.slot_raised,
    a.slot_raised_at,
    a.slots_count,
    a.out_of_process,
    a.oop_reason,
    a.oop_at,
    a.created_by,
    a.created_at,
    a.updated_at,
    a.contacts,
    a.deals_count,
    a.slots_igv_count,
    a.slots_igta_count,
    a.slots_igte_count,
    a.next_step_event_id,
    a.podio_submit_requested_at,
    m.name AS responsible_name,
    m.nickname AS responsible_nickname,
    m.email AS responsible_email,
    m.stakeholder_id AS responsible_stakeholder_id,
    m.functions AS responsible_functions,
    m.role AS responsible_role,
    m.team_name AS responsible_team_name,
    COALESCE(c.attempts, 0::bigint) AS attempts,
    COALESCE(c.no_response_attempts, 0::bigint) AS no_response_attempts,
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
        CASE
            WHEN a.out_of_process THEN 'Out of Process'::text
            WHEN a.slot_raised THEN 'Deal Done'::text
            WHEN v.visit_done THEN 'Visit Done'::text
            WHEN v.visit_id IS NOT NULL THEN 'Visit Scheduled'::text
            WHEN COALESCE(c.attempts, 0::bigint) > 0 THEN 'Contacted'::text
            ELSE 'Lead'::text
        END AS stage,
    COALESCE(c.attempts, 0::bigint) >= 3 AND COALESCE(c.attempts, 0::bigint) = COALESCE(c.no_response_attempts, 0::bigint) AND NOT a.out_of_process AND NOT a.slot_raised AS contact_limit_reached,
    COALESCE(c.attempts, 0::bigint) > 0 AND v.visit_id IS NULL AND a.next_step_date IS NULL AND NOT a.out_of_process AND NOT a.slot_raised AS next_step_missing,
    a.is_test
   FROM accounts a
     LEFT JOIN members m ON m.id = a.responsible_id
     LEFT JOIN LATERAL ( SELECT count(*) AS attempts,
            count(*) FILTER (WHERE contact_attempts.status = 'No Response'::contact_status) AS no_response_attempts,
            max(contact_attempts.created_at) AS last_contact_at
           FROM contact_attempts
          WHERE contact_attempts.account_id = a.id) c ON true
     LEFT JOIN LATERAL ( SELECT contact_attempts.status::text AS last_contact_status,
            contact_attempts.method::text AS last_contact_method
           FROM contact_attempts
          WHERE contact_attempts.account_id = a.id
          ORDER BY contact_attempts.created_at DESC
         LIMIT 1) lc ON true
     LEFT JOIN LATERAL ( SELECT visits.id AS visit_id,
            visits.visit_date,
            visits.visit_time,
            visits.done AS visit_done,
            visits.visit_comment
           FROM visits
          WHERE visits.account_id = a.id
          ORDER BY visits.visit_date DESC, visits.visit_time DESC
         LIMIT 1) v ON true
     LEFT JOIN LATERAL ( SELECT deals.created_at AS last_deal_at,
            deals.slots AS last_deal_slots,
            deals.note AS last_deal_note
           FROM deals
          WHERE deals.account_id = a.id
          ORDER BY deals.created_at DESC
         LIMIT 1) ld ON true
     LEFT JOIN LATERAL ( SELECT account_comments.body AS pinned_comment
           FROM account_comments
          WHERE account_comments.account_id = a.id AND account_comments.pinned
          ORDER BY account_comments.created_at DESC
         LIMIT 1) pc ON true;

notify pgrst, 'reload schema';
