-- 0049 — direct visits, the in-app mailbox, IR notes on a booking (v33.24)

-- ------------------------------------------------------------ DIRECT VISITS
-- Not every partner comes through market research. Someone walks a street,
-- finds a business, walks in and offers the product on the spot — and until
-- now that work was invisible: to log it they had to add an account, log a
-- contact, book a visit into the past and report it, four screens for one
-- thing that already happened. So it went unlogged, and the funnel called
-- them idle.
--
-- A direct visit is a real account through the real funnel (MR + contact +
-- visit are all true), flagged so the LC can see how much of the pipeline
-- comes from the street rather than the sheet.
alter table accounts add column if not exists direct_visit boolean not null default false;
create index if not exists accounts_direct_visit_idx on accounts (direct_visit)
  where direct_visit = true;

-- ------------------------------------------------------- THE IR'S OWN NOTE
-- The booking page asks who they are and when — never WHY. The host walks in
-- blind, and the one person who knew what the call is about had no way to say.
alter table ir_calls add column if not exists booker_note text;

-- ------------------------------------------------ EVERY IR IS A REAL PERSON
-- IRs who booked through the link existed only as a denormalized snapshot on
-- the call, so they could not be commented on, tagged or corrected. They now
-- get a row like any hand-added IR; `source` says which door they came in by.
alter table partner_lc_contacts add column if not exists source text
  not null default 'manual' check (source in ('manual', 'booking'));
-- one row per person per LC — the upsert key for a booking
create unique index if not exists partner_lc_contacts_email_key
  on partner_lc_contacts (partner_lc_id, lower(email))
  where email is not null;

insert into partner_lc_contacts (partner_lc_id, name, role, email, phone, product, source)
select distinct on (c.partner_lc_id, lower(c.booker_email))
       c.partner_lc_id,
       coalesce(nullif(trim(c.booker_name), ''), split_part(c.booker_email, '@', 1)),
       c.booker_role,
       lower(c.booker_email),
       c.booker_phone,
       c.product,
       'booking'
from ir_calls c
where c.partner_lc_id is not null
  and c.booker_email is not null
  and trim(c.booker_email) <> ''
order by c.partner_lc_id, lower(c.booker_email), c.called_at desc
on conflict do nothing;

-- --------------------------------------------------------- THE LC's MAILBOX
-- Members write to partners, EPs and other LCs from their own Gmail, from
-- scratch, every time — so the LC has no record of what was said to whom, and
-- everyone rebuilds the same letter. This logs what Sodio sent on their
-- behalf: it is the sent-items list, the "who did we already write to" answer,
-- and the source of the recent-recipient suggestions.
create table if not exists sent_emails (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) on delete set null,
  member_name text not null,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text not null,
  body_html text not null,
  -- 'sent' went out through their Gmail · 'draft' is waiting in it
  status text not null default 'sent' check (status in ('sent', 'draft')),
  /** the template it started from, when it started from one */
  template text,
  created_at timestamptz not null default now()
);
create index if not exists sent_emails_member_idx on sent_emails (member_id, created_at desc);
alter table sent_emails enable row level security;

notify pgrst, 'reload schema';
