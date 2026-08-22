-- 0066 — THE IM DIRECTOR'S OWN PROMPT, AND LC TOUCH-POINT RATINGS (v34.7)
--
-- Two things that both want the same rail: something the LC must SEE, and
-- ideally answer, the next time they open Sodio. `pending_prompts` (0031)
-- already carries that ladder — kind + ref_id + title/body/link, one blocking
-- dialog, a per-day escape — so neither of these invents a delivery mechanism.
-- What they add is the CONTENT and what comes back.

-- ── the director's prompt ────────────────────────────────────────────────
create table if not exists im_prompts (
  id             uuid primary key default gen_random_uuid(),
  created_by     uuid        references members(id) on delete set null,
  title          text        not null,
  body           text        not null,
  -- what (if anything) is captured back. 'none' is a pure announcement.
  response_kind  text        not null default 'none'
                   check (response_kind in ('none', 'acknowledge', 'rating', 'text')),
  -- the question above the control, when there is one
  response_label text,
  -- who sees it: everyone, a set of functions, a set of roles, or named people
  audience       text        not null default 'all'
                   check (audience in ('all', 'function', 'role', 'picked')),
  audience_values text[]     not null default '{}',
  -- an announcement can be waved away; something that needs doing may not be
  dismissible    boolean     not null default true,
  active         boolean     not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists im_prompt_responses (
  id           uuid primary key default gen_random_uuid(),
  prompt_id    uuid        not null references im_prompts(id) on delete cascade,
  member_id    uuid        not null references members(id) on delete cascade,
  rating       int         check (rating between 1 and 5),
  text_answer  text,
  acknowledged boolean     not null default false,
  skipped      boolean     not null default false,
  created_at   timestamptz not null default now(),
  unique (prompt_id, member_id)
);

create index if not exists im_prompt_responses_prompt_idx
  on im_prompt_responses (prompt_id);

alter table im_prompts enable row level security;
alter table im_prompt_responses enable row level security;
revoke all on im_prompts, im_prompt_responses from anon, authenticated;

-- ── LC touch-point ratings ───────────────────────────────────────────────
-- No new table: the ask is a `pending_prompts` row of kind 'touchpoint_rating'
-- whose ref_id is the touch point, and `reminders` doubles as the SKIP COUNT.
-- The ladder the LC asked for falls out of that: skip once and it says the
-- rating matters and comes back TOMORROW (reminders = 1); skip it a second
-- time and it is resolved for good. `lc_feedback` already stores the rating
-- itself, so a rating given here is the same row the Feedback page writes.
