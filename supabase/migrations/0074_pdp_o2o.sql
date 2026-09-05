-- 0074 — PDP / O2O: THE TM SHEET, BROUGHT INSIDE (v36)
--
-- Every month TM asks each leader to sit down with the people under them, look
-- at last month's numbers together, agree what to work on, and break it into
-- four weekly steps. It is the LC's own development process and it has always
-- lived in a Google Sheet — one tab per month, one block per person, filled in
-- by whoever remembered. Which means: the numbers in it are typed by hand and
-- therefore already stale by the time the conversation happens, last month's
-- plan is a scroll away in a different tab so nobody checks whether the four
-- steps were ever done, and TM cannot answer "who has not had their O2O yet"
-- without reading the whole sheet.
--
-- THE SHAPE OF THE PROCESS IS THE SHAPE OF THE LC: a leader files for the MMs
-- under them, and those MMs then file for their own members. Nobody files for
-- themselves and nobody files for a stranger — `author_id` is the leader who
-- sat in the conversation, `member_id` is the person it was about, and the two
-- must be a real manager link (enforced in src/lib/rbac.ts, where every other
-- authority question in this system is answered).
--
-- ⚠️ READING IS DELIBERATELY NARROWER THAN `hasTmAccess`. A PDP holds what
-- somebody is bad at and what they said about it, which is not the same class
-- of thing as an attendance row. Only the member, their leader, that leader's
-- leader, TM core and the LCP may read one. That is `canReadPdp`, and it is a
-- narrowing of the TM module's own access on purpose.
--
-- WHAT IS DATA HERE AND WHY:
--   · the QUESTIONS (pdp_questions) — the sheet's O2O tab is edited by TM
--     every peak. Hard-coding them would mean a deploy to change a question,
--     which is how a form ossifies and people stop answering it honestly.
--   · the NUMBERS (pdps.last_month) — frozen at filing time as a snapshot. The
--     conversation was had about THOSE figures; recomputing them later would
--     silently rewrite the reason a goal was set, and a plan whose premise
--     drifts is worse than no plan.
--   · the CYCLE (pdp_cycles) — one per month, with the deadline TM set. The
--     missed-PDP nag ladder hangs off it, and it is SKIPPABLE: it rides
--     `pending_prompts` (0031), whose `reminders` column doubles as the skip
--     count exactly as the v34.7 touch-point rating does. A development
--     conversation that gets nagged into existence is not one worth having, so
--     the ladder asks and then lets go.
--
-- ⚠️ "No more than 4 MMs per VP" came from the TM VP as a statement about
-- WORKLOAD, not a rule. The count is surfaced in the UI; a fifth is never
-- refused. Writing it into a constraint here would turn an observation into a
-- wall on the day an LC genuinely needs one.

-- ---------------------------------------------------------------- the cycle

create table if not exists public.pdp_cycles (
  id           uuid primary key default gen_random_uuid(),
  -- the month this cycle is FOR, always the 1st (yyyy-MM-01), Cairo
  period_start date        not null,
  -- when the filing is due. A timestamptz because the nag ladder compares
  -- against an instant, and "the 7th" means the 7th in Cairo.
  deadline     timestamptz not null,
  title        text,
  note         text,
  created_by   uuid        references public.members(id) on delete set null,
  -- a cycle can be closed without being deleted: its PDPs are the record
  active       boolean     not null default true,
  created_at   timestamptz not null default now(),
  -- ONE cycle per month. Two open cycles for August would split the LC's
  -- filings in half and make "who is missing" unanswerable.
  unique (period_start)
);

create index if not exists pdp_cycles_active_idx
  on public.pdp_cycles (period_start desc)
  where active;

comment on table public.pdp_cycles is
  'One PDP/O2O round, one per month (v36). Its deadline drives the skippable nag ladder, which rides pending_prompts (0031) rather than inventing a delivery mechanism.';

-- ------------------------------------------------------------- the questions

-- The O2O half of the sheet: the questions a leader asks in the conversation.
-- TM edits these in-app, so they are DATA, not code.
create table if not exists public.pdp_questions (
  id       uuid primary key default gen_random_uuid(),
  -- NULL = a standing question that applies to EVERY cycle. A cycle_id set
  -- means TM asked something specific this month only.
  cycle_id uuid    references public.pdp_cycles(id) on delete cascade,
  idx      int     not null,
  prompt   text    not null,
  hint     text,
  -- retired rather than deleted: answers already filed under a question must
  -- keep something to be read against
  active   boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists pdp_questions_cycle_idx
  on public.pdp_questions (cycle_id, idx);

comment on table public.pdp_questions is
  'The O2O questions (v36). cycle_id NULL = asked every cycle; set = asked this month only. Retired with active=false, never deleted — filed answers key on the question id.';

-- ------------------------------------------------------------------ the PDP

create table if not exists public.pdps (
  id        uuid primary key default gen_random_uuid(),
  cycle_id  uuid not null references public.pdp_cycles(id) on delete cascade,
  -- the subject: the person the conversation was about
  member_id uuid not null references public.members(id) on delete cascade,
  -- the leader who filed it. `set null` rather than cascade: a member leaving
  -- the LC must not delete the development plan of everyone they led.
  author_id uuid references public.members(id) on delete set null,
  status    text not null default 'draft'
              check (status in ('draft', 'filed')),

  -- ── the personal track: a skill, and what "better" looks like
  personal_skill      text,
  personal_goal       text,

  -- ── the professional track: a number, a target for it, and the goal in words
  professional_metric text,
  professional_target int,
  professional_goal   text,

  -- ── the gap track: the weakest step of their own funnel, and what about it.
  -- The step is CHOSEN by the pair, not imposed — funnelGap() in src/lib/pdp.ts
  -- suggests one and returns null rather than inventing a gap out of three
  -- accounts.
  gap_step            text,
  gap_note            text,

  -- last month's numbers, frozen at filing time so the premise of the goals
  -- cannot drift out from under them
  last_month jsonb,
  -- the O2O answers, {question_id: answer}
  o2o        jsonb,

  filed_at   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ONE PDP per person per cycle. The pair may edit it all month; they do not
  -- get to file a second opinion.
  unique (cycle_id, member_id)
);

-- "my plans", and "everything this person has ever been given" — the member's
-- own history page, newest cycle first
create index if not exists pdps_member_idx
  on public.pdps (member_id);

-- the leader's own queue: what they still owe. A partial index because a filed
-- PDP is never in it, and drafts are the small minority at any moment.
create index if not exists pdps_author_draft_idx
  on public.pdps (author_id)
  where status = 'draft';

comment on table public.pdps is
  'One member''s development plan for one cycle (v36). author_id is the leader who sat in the conversation; reading is gated by canReadPdp — member, their leader, that leader''s leader, TM core, LCP.';
comment on column public.pdps.last_month is
  'Last month''s numbers as they stood when the plan was made. A frozen snapshot on purpose: recomputing them later would rewrite the reason the goal was set.';
comment on column public.pdps.o2o is
  '{question_id: answer} against pdp_questions. Keyed by id, not by index, so re-ordering or retiring a question never re-labels an answer already given.';

-- ---------------------------------------------------------------- the steps

-- The four weekly action steps per track. `week` is 1–4 against pdpWeeks() in
-- src/lib/pdp.ts, which is NEW and deliberately does not align with the
-- sprints in src/lib/plan.ts — a sprint is half a month (v21) and this process
-- has always been four weeks. Week 1 starts on the 1st and the last week
-- absorbs the remainder, so a 31-day month gives 7/7/7/10.
create table if not exists public.pdp_steps (
  id      uuid     primary key default gen_random_uuid(),
  pdp_id  uuid     not null references public.pdps(id) on delete cascade,
  track   text     not null check (track in ('personal', 'professional', 'gap')),
  week    smallint not null check (week between 1 and 4),
  body    text     not null,
  done    boolean  not null default false,
  done_at timestamptz,
  -- who ticked it. Either half of the pair may, and which one it was is the
  -- difference between "I did it" and "my leader says I did it".
  done_by uuid     references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pdp_steps_pdp_idx
  on public.pdp_steps (pdp_id);

comment on table public.pdp_steps is
  'The weekly action steps of a PDP, 3 tracks x 4 weeks (v36). Weeks come from pdpWeeks() in src/lib/pdp.ts and are NOT the sprints in src/lib/plan.ts.';

-- ------------------------------------------------------------- updated_at
-- Guarded rather than bare `create trigger`, so re-running this file is a
-- no-op like every other statement in it.
do $$
begin
  if not exists (
    -- tgrelid as well as the name: a trigger name is unique per TABLE, not
    -- across the database, so the name alone would match a namesake elsewhere
    select 1 from pg_trigger
     where tgname = 'pdps_updated_at' and tgrelid = 'public.pdps'::regclass
  ) then
    create trigger pdps_updated_at before update on public.pdps
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------- RLS
-- Deny-all to anon/authenticated, like the other forty-odd tables: RLS on, no
-- policies, and the grants Supabase hands those roles by default revoked on
-- top (the v33.47 audit's second half). The app reaches these through the
-- service-role key and authorizes in src/lib/rbac.ts BEFORE the query runs —
-- which matters more here than almost anywhere else, because a PDP is the one
-- record in Sodio that says out loud what somebody is not good at yet.

alter table public.pdp_cycles    enable row level security;
alter table public.pdp_questions enable row level security;
alter table public.pdps          enable row level security;
alter table public.pdp_steps     enable row level security;

revoke all on public.pdp_cycles, public.pdp_questions, public.pdps, public.pdp_steps
  from anon, authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------- verify (read-only)
-- Expect FOUR rows, each with rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('pdp_cycles', 'pdp_questions', 'pdps', 'pdp_steps')
order by tablename;
