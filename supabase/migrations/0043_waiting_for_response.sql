-- 0043: "Waiting for response" contact result — the default for WhatsApp and
-- Email contact attempts (message sent, no reply yet). It counts as
-- UNANSWERED for the 3-contact rule, exactly like "No Response".
--
-- NOTE: an enum value added by ALTER TYPE ... ADD VALUE cannot be USED as an
-- enum literal in the same transaction — the view below therefore compares
-- status::text against text literals, which keeps this whole script safe to
-- run in one go (the SQL editor wraps it in a single transaction).

alter type contact_status add value if not exists 'Waiting for response';

-- accounts_pipeline: count the new value as an unanswered attempt so
-- contact_limit_reached (the 3-contacts-no-answer flag) keeps firing for
-- accounts worked over WhatsApp/Email. Only the no_response_attempts FILTER
-- changes; every output column keeps its name, type and position.
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
    a.podio_update_notified_at,
    a.podio_update_enabled,
    a.podio_update_second_notified_at
   FROM accounts a
     LEFT JOIN members m ON m.id = a.responsible_id
     LEFT JOIN LATERAL ( SELECT count(*) AS attempts,
            count(*) FILTER (WHERE contact_attempts.status::text in ('No Response', 'Waiting for response')) AS no_response_attempts,
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
