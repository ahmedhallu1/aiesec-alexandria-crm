-- Sodio v23 — the B2C module: accounts with a Type (Courses / Events /
-- Student activities), a continuous Podio-update cadence with reminders, and
-- detail-free deals ("deal signed", nothing else). Run after 0018.
-- NOTE: the ALTER TYPE line must run in its own statement/transaction.

-- 1. B2C joins the account functions
alter type lc_function add value if not exists 'B2C';

alter table accounts drop constraint if exists accounts_function_check;
alter table accounts add constraint accounts_function_check
  check ((function)::text = any (array['IGV','IGT','B2B','BD','B2C']));

-- 2. B2C deals carry NO details (no opens, no money) — relax the deals check
alter table deals drop constraint if exists deals_slots_check;
alter table deals add constraint deals_slots_check check (slots >= 0);

-- 3. Podio continuous-update cadence (B2C only): every account must be
-- refreshed on Podio every N days; the daily cron nags the responsible +
-- the B2C VP/Director when the date arrives (once per cycle).
alter table accounts add column if not exists podio_update_every_days int;
alter table accounts add column if not exists podio_updated_at timestamptz;
alter table accounts add column if not exists podio_update_notified_at timestamptz;

-- 4. accounts_pipeline: expose the cadence columns (appended at the END —
-- create or replace view can only add trailing columns)
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
    a.is_test,
    a.podio_update_every_days,
    a.podio_updated_at,
    a.podio_update_notified_at
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
