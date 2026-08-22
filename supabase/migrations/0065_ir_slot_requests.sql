-- 0065 — "NONE OF THESE TIMES WORK" (v34.5)
--
-- The public booking page could only ever offer what the host had already
-- opened. If a consideration member had no availability left — or none that
-- suited an IR eight time zones away — the page was a dead end, and the LC
-- lost the conversation to whatever the IR did next.
--
-- An IR can now ASK for a time that does not exist. The host is emailed and
-- sees it on their IR page, and answers: accept (it becomes a real booked call,
-- exactly like any other) or decline, with an optional comment that reaches
-- the IR verbatim. Nothing is auto-booked — the host's calendar is theirs.

create table if not exists ir_slot_requests (
  id               uuid primary key default gen_random_uuid(),
  -- the host being asked
  member_id        uuid        not null references members(id) on delete cascade,
  partner_lc_id    uuid        references partner_lcs(id) on delete set null,
  lc_name          text        not null,
  -- who is asking (same shape the booking page already collects)
  booker_name      text        not null,
  booker_role      text,
  booker_email     text        not null,
  booker_phone     text,
  booker_tz        text,
  country          text,
  note             text,
  -- what they asked for
  requested_at     timestamptz not null,
  duration_minutes int         not null default 30,
  -- the host's answer
  status           text        not null default 'pending'
                     check (status in ('pending', 'accepted', 'declined')),
  responded_at     timestamptz,
  response_comment text,
  -- set when accepted: the call it became
  ir_call_id       uuid        references ir_calls(id) on delete set null,
  created_at       timestamptz not null default now()
);

-- the host's pending queue is the only hot read
create index if not exists ir_slot_requests_pending_idx
  on ir_slot_requests (member_id, requested_at)
  where status = 'pending';

-- ONE OPEN ASK PER LC PER SLOT, so a refresh or a double-tap on a public page
-- cannot fill a host's queue with the same request.
create unique index if not exists ir_slot_requests_open_key
  on ir_slot_requests (member_id, booker_email, requested_at)
  where status = 'pending';

alter table ir_slot_requests enable row level security;
revoke all on ir_slot_requests from anon, authenticated;
