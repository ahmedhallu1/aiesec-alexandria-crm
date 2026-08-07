-- 0048 — which PRODUCT an IR call marketed, and comments on an LC / an IR
--        (v33.23)
--
-- PRODUCT. An IR call has never known whether it was a GV or a GT
-- conversation. `ir_calls.fn` (0026:29) looks like it should say — it is
-- `text not null default 'Consideration'` — but no code path has ever written
-- it, and every "is this call IGV or IGT" question is answered by re-deriving
-- it from the HOST's current functions. That derivation is wrong twice over:
-- a member who works both products has their calls counted in BOTH lanes, and
-- a member who moves function silently rewrites the history of every call they
-- ever made. The product is a fact about the CALL, so it is stored on the call.
--
-- The LC-level "reached out as GV / GT / both" is deliberately NOT a column:
-- an LC can be both (İstanbul Asia and AIESEC in Mumbai already are), and a
-- stored set would drift on every merge, rename and delete. It is aggregated
-- at read time from the calls, which listPartnerLcDetails already fetches.

alter table ir_calls add column if not exists product text
  check (product is null or product in ('GV', 'GT'));

-- Backfill from the host's product function — the exact rule every reader uses
-- today, applied once and then frozen.
update ir_calls c set product = case
  when (coalesce(m.functions, '{}') || coalesce(m.sub_functions, '{}')) && array['IGT'] then 'GT'
  when (coalesce(m.functions, '{}') || coalesce(m.sub_functions, '{}')) && array['IGV'] then 'GV'
end
from members m
where m.id = c.member_id and c.product is null;

create index if not exists ir_calls_product_idx on ir_calls (product);

-- `ir_calls.fn` is dead and superseded by `product`. It is left in place on
-- purpose: src/server/backup.ts dumps whole rows, so dropping it would break a
-- restore from any pre-0048 backup.

-- An IR added by hand has no call to derive a product from, so they carry
-- their own tag.
alter table partner_lc_contacts add column if not exists product text
  check (product is null or product in ('GV', 'GT'));

-- ---------------------------------------------------------------- comments
-- Notes on a partner LC, or on ONE of its IRs. Everything the crew learns
-- about an entity between calls — "their oGV peak starts in March", "Sarah is
-- the one who actually answers" — currently has nowhere to live except the
-- notes field of a single call.
--
-- One table, not two: an IR belongs to exactly one LC, so a nullable
-- `contact_id` says "about this person" and NULL says "about the LC itself".
create table if not exists partner_lc_comments (
  id uuid primary key default gen_random_uuid(),
  partner_lc_id uuid not null references partner_lcs(id) on delete cascade,
  -- null = the comment is about the LC as a whole
  contact_id uuid references partner_lc_contacts(id) on delete cascade,
  body text not null,
  author_id uuid references members(id) on delete set null,
  -- name SNAPSHOT, like every other comment table: a member who leaves still
  -- signed what they wrote
  author_name text not null,
  created_at timestamptz not null default now()
);
create index if not exists partner_lc_comments_lc_idx
  on partner_lc_comments (partner_lc_id, created_at desc);
create index if not exists partner_lc_comments_contact_idx
  on partner_lc_comments (contact_id);
alter table partner_lc_comments enable row level security;

notify pgrst, 'reload schema';
