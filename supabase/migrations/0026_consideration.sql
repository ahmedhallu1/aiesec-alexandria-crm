-- Sodio v26 — THE CONSIDERATION MODULE: IR calls + CV pool.
-- IR calls: video calls with partner LCs abroad marketing our opens; the
-- screenshot lands in the "CRM — IR Calls" folder on the system Drive.
-- CVs: uploaded files (private `cvs` storage bucket) auto-analyzed by Gemini
-- (name / phone / email / industry match / skills + full text) so The Blue
-- Man can answer "which CVs know C#?".

create table if not exists partner_lcs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists partner_lcs_name_key on partner_lcs (lower(name));

create table if not exists ir_calls (
  id uuid primary key default gen_random_uuid(),
  partner_lc_id uuid references partner_lcs(id) on delete set null,
  partner_lc_name text not null,
  called_at timestamptz not null default now(),
  notes text,
  -- Drive file of the screenshot (uploaded via the service account)
  screenshot_drive_id text,
  screenshot_name text,
  screenshot_link text,
  member_id uuid references members(id) on delete set null,
  member_name text not null,
  fn text not null default 'Consideration',
  created_at timestamptz not null default now()
);
create index if not exists ir_calls_called_idx on ir_calls (called_at desc);

create table if not exists cvs (
  id uuid primary key default gen_random_uuid(),
  partner_lc_id uuid references partner_lcs(id) on delete set null,
  partner_lc_name text,
  -- file in the private `cvs` storage bucket
  file_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  -- AI-extracted fields (editable afterwards; null = not found / no extraction)
  person_name text,
  phone text,
  email text,
  industry text,
  skills text,
  summary text,
  extracted_text text,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'done', 'failed', 'unsupported')),
  uploaded_by uuid references members(id) on delete set null,
  uploader_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cvs_created_idx on cvs (created_at desc);

alter table partner_lcs enable row level security;
alter table ir_calls enable row level security;
alter table cvs enable row level security;
create trigger cvs_updated_at before update on cvs
  for each row execute function set_updated_at();

notify pgrst, 'reload schema';
