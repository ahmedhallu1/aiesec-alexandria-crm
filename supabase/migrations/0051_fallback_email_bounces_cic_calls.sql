-- 0051 (v33.29): the Gmail fallback, bounce flags, and multi-row CIC calls
-- (applied to prod via MCP on 2026-08-09 — see AI_CONTEXT changelog)

-- a personal Gmail used ONLY until the AIESEC email lands: password resets,
-- calendar invites on IR calls (fixes the Meet "waiting to be admitted" —
-- an invited attendee enters directly; an anonymous guest knocks at a door
-- whose host, the IM mailbox, is never in the room to open it)
alter table members add column if not exists fallback_email text;

-- an email we sent this IR bounced — surfaced on the call instead of dying
-- unseen in the IM inbox (live case: an IR typed her own address reversed,
-- and her confirmation + manage link silently went nowhere)
alter table ir_calls add column if not exists email_bounced_at timestamptz;

-- CIC as ROWS (many per sign-up): an OGX second call and a B2C call can both
-- exist, each with its own caller, side and outcome
create table if not exists signup_cic_calls (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references signups(id) on delete cascade,
  side text not null check (side in ('OGX','B2C')),
  caller_id uuid references members(id) on delete set null,
  caller_name text not null,
  assigned_by uuid references members(id) on delete set null,
  assigned_by_name text,
  assigned_at timestamptz not null default now(),
  contact_status text,
  interested text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists signup_cic_calls_signup_idx on signup_cic_calls (signup_id, created_at);
create index if not exists signup_cic_calls_caller_idx on signup_cic_calls (caller_id);
alter table signup_cic_calls enable row level security;

-- migrate the single-slot cic_* columns into the first row (side = OGX);
-- the legacy columns stay readable until every reader has moved
insert into signup_cic_calls (signup_id, side, caller_id, caller_name, assigned_at, contact_status, interested)
select id, 'OGX', cic_assigned_to, coalesce(cic_assigned_name, 'Unknown'),
       coalesce(cic_assigned_at, now()), cic_contact_status, cic_interested
from signups
where cic_assigned_to is not null
on conflict do nothing;

notify pgrst, 'reload schema';
