-- 0083 — CXP uploads that actually arrive, and ICX APPROVALS (v37)
--
-- ① THE CXP STAGING BUCKET.
--    A CXP document used to ride inside the server action's own request, and
--    Vercel refuses any request body over 4.5 MB before the app sees it. A
--    phone photo or a scanned passport — most real documents — never arrived
--    (three uploads in a month, all small PDFs). The browser now PUTs the file
--    into this private bucket with a signed URL; the server moves it to the
--    EP's Drive folder and deletes it here. Nothing lives in it for long.
--
-- ② ICX APPROVALS — the ICX MOS, finally recorded.
--    The planning sheet has planned IGV / IGTa / IGTe approvals every month
--    since v21 and the consideration MMs file an approvals plan every month,
--    and nothing in Sodio ever counted an approval against either. One row per
--    approved EP: who made it (credited to ONE member; their Team Leader's
--    numbers include it, as every other MOS in Sodio rolls up), where they came
--    from (the sending LC), how it came (IR call / CV pool / EXPA / referral),
--    which of our opportunities, and the EP's contact.
--
--    The ECB SubTool (already synced for CXP, cxp_ep_records) lists every ICX
--    approval — the Consideration tab SUGGESTS the ones nobody has logged yet,
--    and `expa_key` is what stops the same EP from being logged twice.

-- ------------------------------------------------------------ ① staging bucket

-- private: the app reaches Storage with the service-role key only, so no RLS
-- policies are needed on storage.objects (same as contracts / cvs)
insert into storage.buckets (id, name, public, file_size_limit)
  values ('cxp-staging', 'cxp-staging', false, 26214400)
  on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- ------------------------------------------------------------ ② icx_approvals

create table if not exists public.icx_approvals (
  id uuid primary key default gen_random_uuid(),

  -- the programme; IGV = GV, IGT = GTa + GTe (the planning sheet's own split)
  product text not null check (product in ('GV', 'GTa', 'GTe')),
  function text generated always as (
    case when product = 'GV' then 'IGV' else 'IGT' end
  ) stored,

  ep_name text not null,
  -- the EXPA "EP ID / Opportunity ID" (e.g. 6207212_1334682), as typed
  expa_id text,
  -- the same, normalised — the one-EP-one-approval guard
  expa_key text generated always as (
    nullif(lower(regexp_replace(coalesce(expa_id, ''), '\s+', '', 'g')), '')
  ) stored,
  approved_on date not null,

  -- WHERE FROM: the sending LC, from the partner-LC registry when it is there
  partner_lc_id uuid references public.partner_lcs(id) on delete set null,
  partner_lc_name text,
  country text,

  -- HOW IT CAME, with the record behind it when there is one
  source text not null default 'other'
    check (source in ('ir_call', 'cv_pool', 'expa', 'referral', 'other')),
  ir_call_id uuid references public.ir_calls(id) on delete set null,
  cv_id uuid references public.cvs(id) on delete set null,

  -- OUR OPPORTUNITY: the raising account the EP was approved on, and/or the
  -- opportunity's own title as EXPA shows it
  account_id uuid references public.accounts(id) on delete set null,
  opportunity text,

  ep_email text,
  ep_phone text,
  notes text,

  -- WHO MADE IT — one person. Their Team Leader's totals include it.
  made_by uuid references public.members(id) on delete set null,
  made_by_name text not null default '',
  logged_by uuid references public.members(id) on delete set null,

  -- claimed from an ECB SubTool suggestion rather than typed from scratch
  from_subtool boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists icx_approvals_expa_key
  on public.icx_approvals (expa_key) where expa_key is not null;
create index if not exists icx_approvals_approved_on
  on public.icx_approvals (approved_on);
create index if not exists icx_approvals_made_by
  on public.icx_approvals (made_by);
create index if not exists icx_approvals_function
  on public.icx_approvals (function, approved_on);

comment on table public.icx_approvals is
  'ICX approvals (v37) — the ICX MOS. One row per approved EP, credited to one member; a Team Leader''s totals include their team''s. Logged from the Consideration tab, suggested from the ECB SubTool (cxp_ep_records).';

-- deny-all to anon/authenticated, like every other table (0062): the app uses
-- the service-role key and authorizes in src/lib/rbac.ts before every query
alter table public.icx_approvals enable row level security;

notify pgrst, 'reload schema';
