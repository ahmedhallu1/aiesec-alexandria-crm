-- 0070 — WHAT ACTUALLY HAPPENED ON A B2C CALL (v35.1)
--
-- The B2C selling call recorded "Called: Yes / No", which answers a question
-- nobody was asking. The four ways a call fails are not the same thing and
-- they need different follow-ups: BUSY and DIDN'T ANSWER mean try again, OUT
-- OF SERVICE means the number is dead and no amount of trying fixes it, and
-- CALL BACK is an appointment the person themselves asked for — the one
-- outcome that must come back to the caller at a specific time, exactly the
-- way a raising account's next step does.
--
-- `contact_status` STAYS, written from the outcome ('answered' → Yes, every
-- other outcome → No). It is what the B2C dashboard card, the "called" count
-- and the open-calls count already read, and rows recorded before today only
-- ever say Yes or No — so the mirror keeps five years of numbers meaning the
-- same thing while the interface asks the better question.

alter table signup_cic_calls
  add column if not exists outcome text,
  add column if not exists call_back_at timestamptz,
  -- stamped when the reminder has gone out, so it fires once and not every
  -- time the cron passes over a call-back that is still due
  add column if not exists call_back_reminded_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'signup_cic_calls_outcome_check'
  ) then
    alter table signup_cic_calls
      add constraint signup_cic_calls_outcome_check
      check (outcome is null or outcome in
        ('answered','busy','no_answer','out_of_service','call_back'));
  end if;
end $$;

-- the reminder pass reads exactly this: call-backs that are due and unnudged
create index if not exists signup_cic_calls_callback_idx
  on signup_cic_calls (call_back_at)
  where outcome = 'call_back' and call_back_reminded_at is null;

comment on column signup_cic_calls.outcome is
  'What happened on the call (v35.1): answered · busy · no_answer · out_of_service · call_back. contact_status is derived from it (answered = Yes) for every pre-0070 reader.';
