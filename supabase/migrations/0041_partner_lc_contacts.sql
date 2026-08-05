-- 0041 — the IR people at a partner LC (v33.9)
-- They used to be INFERRED from whoever booked a call, so an IR introduced
-- over WhatsApp, or one whose colleague did the booking, existed nowhere.
create table if not exists partner_lc_contacts (
  id uuid primary key default gen_random_uuid(),
  partner_lc_id uuid not null references partner_lcs(id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  note text,
  added_by uuid references members(id),
  created_at timestamptz not null default now()
);
create index if not exists partner_lc_contacts_lc_idx on partner_lc_contacts (partner_lc_id);
alter table partner_lc_contacts enable row level security;
