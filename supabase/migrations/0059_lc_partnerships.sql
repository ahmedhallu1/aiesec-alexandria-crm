-- 0059 (v33.38): PARTNER-LC PARTNERSHIPS — the consideration floor's other MOS.
--
-- Approaching a new LC and opening a WhatsApp group with them IS the win, and
-- until now it lived nowhere: the registry knew who we CALLED, never who we
-- PARTNERED with. One row per LC × product — the same LC can be a brand-new
-- partnership for GT while being an old one for GV, with no contradiction.
--
-- status 'pending' = a TARGET an MM/VP assigned to someone ("go make this
-- partnership"); 'done' = the partnership exists (group made), with the IR who
-- anchors it. Completing a pending row credits the member it was assigned to.

create table if not exists public.lc_partnerships (
  id uuid primary key default gen_random_uuid(),
  partner_lc_id uuid not null references public.partner_lcs(id) on delete cascade,
  product text not null check (product in ('GV','GT')),
  status text not null default 'pending' check (status in ('pending','done')),
  -- the target machinery
  assigned_to uuid references public.members(id) on delete set null,
  assigned_by uuid references public.members(id) on delete set null,
  assigned_at timestamptz,
  -- the made partnership
  made_by uuid references public.members(id) on delete set null,
  partnership_date date,
  ir_name text,
  ir_phone text,
  ir_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ONE row per LC × product — "new for IGT, old for IGV" is exactly this key
create unique index if not exists lc_partnerships_lc_product_key
  on public.lc_partnerships (partner_lc_id, product);
create index if not exists lc_partnerships_pending_idx
  on public.lc_partnerships (assigned_to) where status = 'pending';
