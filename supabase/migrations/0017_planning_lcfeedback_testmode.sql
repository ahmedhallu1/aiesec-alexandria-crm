-- Sodio v21 — VP planning (sheet import + MM monthly plans), LC people
-- feedback, system-feedback categories, and admin test mode (test accounts +
-- sandbox undo). Run after 0016_comment_archive.sql.

-- ------------------------------------------------------------ 1. VP planning
-- Imported from "Alexandria | Planning Tool 26.1" (goal-setting tabs).
-- scope 'month'  → period_start = 1st of month  (opens/signups planned monthly)
-- scope 'sprint' → period_start = 1st or 16th   (consideration funnel per sprint)
create table if not exists plan_cells (
  id uuid primary key default gen_random_uuid(),
  fn text not null check (fn in ('IGV','IGTa','IGTe','OGV','OGTa','OGTe')),
  scope text not null check (scope in ('month','sprint')),
  period_start date not null,
  metric text not null check (metric in
    ('opens','signups','applicants','accepted','approvals','realised','finished','complete')),
  value numeric not null default 0,
  imported_at timestamptz not null default now(),
  unique (fn, scope, period_start, metric)
);
alter table plan_cells enable row level security;

-- ------------------------------------------------------- 2. MM monthly plans
-- OGX & Consideration MMs fill applicants/accepted/approvals for each month of
-- their peak (winter = Aug–Jan, summer = Feb–Jul) on first sign-in.
create table if not exists mm_plans (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  month date not null,
  applicants int not null default 0,
  accepted int not null default 0,
  approvals int not null default 0,
  peak text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, month)
);
alter table mm_plans enable row level security;

-- ------------------------------------------- 3. system feedback categories
alter table feedback add column if not exists category text;

-- ------------------------------------------------- 4. LC people feedback
-- Positive → notification + email to the member(s). Negative → inbox visible
-- ONLY to the LCP + admin. Author is always stored (accountability) but never
-- shown when anonymous.
create table if not exists lc_feedback (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references members(id) on delete set null,
  anonymous boolean not null default false,
  positive boolean not null,
  about uuid[] not null default '{}',
  message text not null,
  status text not null default 'new' check (status in ('new','seen','done')),
  created_at timestamptz not null default now()
);
alter table lc_feedback enable row level security;

-- ------------------------------------------------------------ 5. test mode
alter table accounts add column if not exists is_test boolean not null default false;

create table if not exists test_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references members(id) on delete set null,
  target_id uuid references members(id) on delete set null,
  mode text not null default 'sandbox' check (mode in ('sandbox','real')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table test_sessions enable row level security;

-- Row-level undo journal for sandbox test views: on exit, rows are replayed in
-- reverse (insert → delete, update → restore before, delete → re-insert).
create table if not exists test_undo (
  id bigserial primary key,
  session_id uuid not null references test_sessions(id) on delete cascade,
  tbl text not null,
  row_id uuid not null,
  op text not null check (op in ('insert','update','delete')),
  before jsonb,
  created_at timestamptz not null default now()
);
create index if not exists test_undo_session_idx on test_undo (session_id, id desc);
alter table test_undo enable row level security;

-- -------------------------------- 6. accounts_pipeline exposes is_test (LAST)
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
     JOIN members m ON m.id = a.responsible_id
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
