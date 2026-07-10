-- Deals — an account can sign MANY deals over time (e.g. 3 slots now, 6 more
-- next month = 2 deals · 9 slots). "Deals" counts deals; "Slots" sums slots.
-- Run in the Supabase SQL editor (after 0004_pins_v2.sql).

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  member_id uuid references members(id),
  slots int not null check (slots > 0),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists deals_account_idx on deals (account_id, created_at);
alter table deals enable row level security;

-- accounts keep running totals (the pipeline view exposes them via a.*)
alter table accounts add column if not exists deals_count int not null default 0;

-- migrate the old single-deal flag into a real deal row
insert into deals (account_id, member_id, slots, created_at)
select id, responsible_id, greatest(slots_count, 1), coalesce(slot_raised_at, updated_at)
from accounts
where slot_raised and not exists (select 1 from deals d where d.account_id = accounts.id);

update accounts set deals_count = (
  select count(*) from deals d where d.account_id = accounts.id
) where slot_raised;
