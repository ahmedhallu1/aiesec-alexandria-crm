-- Sodio v25 — THE OGX MODULE: sign-ups for OGT & OGV.
-- Source of truth flows BOTH ways with the LC's tracker sheets (OGT "New
-- SUs"/"Old SUs", OGV [Old]"Old"/[New]"Main"): a 15-min import cron pulls new
-- rows + sheet-side edits of untouched rows, and every Sodio edit writes the
-- workflow cells straight back. Row identity = (source, ep_id).

create table if not exists signups (
  id uuid primary key default gen_random_uuid(),
  fn text not null check (fn in ('OGT', 'OGV')),
  batch text not null check (batch in ('new', 'old')),
  -- which tab the row lives in: ogt_new | ogt_old | ogv_old | ogv_main
  source text not null,
  ep_id text not null,
  name text not null,

  -- intake data (sheet-authoritative, read-only in Sodio)
  signed_up_at text,
  phone text,
  email text,
  gender text,
  dob text,
  person_status text,
  program text,
  referral text,
  grad_year text,
  university text,
  background text,
  home_lc text,
  campaign text,

  -- workflow: member / MM editable
  assigned_to uuid references members(id) on delete set null,
  assigned_name text,          -- raw sheet value when no member matched
  contact_status text,         -- Yes / No
  interested text,             -- Yes / No

  -- workflow: VP only
  country text,
  sub_product text,            -- OGT only
  status text,                 -- Parents Approval / Applied / Accepted / Approved
  out_of_process boolean not null default false,
  oop_reason text,
  reasons_not_travel text,     -- OGV Old legacy column

  -- automation stamps
  assigned_at timestamptz,
  contacted_at timestamptz,
  last_edited_at timestamptz,  -- mirrored to the sheet's Time Stamp cell
  -- once true, Sodio owns the workflow fields (imports stop overwriting them)
  sodio_touched boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists signups_source_ep_key on signups (source, ep_id);
create index if not exists signups_fn_oop_idx on signups (fn, out_of_process);
create index if not exists signups_assigned_idx on signups (assigned_to);
create index if not exists signups_status_idx on signups (status);

-- comment LOG (organized; mirrored into the sheet's Comment / VP Comment cells)
create table if not exists signup_comments (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references signups(id) on delete cascade,
  author_id uuid references members(id) on delete set null,
  author_name text not null,
  -- 'member' logs land in the Comment cell, 'vp' logs in the VP Comment cell
  author_class text not null check (author_class in ('member', 'vp')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists signup_comments_signup_idx on signup_comments (signup_id, created_at);

alter table signups enable row level security;
alter table signup_comments enable row level security;
create trigger signups_updated_at before update on signups
  for each row execute function set_updated_at();

notify pgrst, 'reload schema';
