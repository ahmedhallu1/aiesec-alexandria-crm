-- Sodio v14 — BD deals measure MONEY, not opens: their MOS is the deal's
-- amount in EGP (plus optional non-monetary benefits). Other products keep
-- counting opens; a BD deal may still carry opens when it includes some.
-- Run in the Supabase SQL editor (after 0014_bd_podio.sql).

alter table deals add column if not exists amount numeric not null default 0; -- EGP
alter table deals add column if not exists benefits text;                     -- other benefits (free text)

-- money-only BD deals carry 0 opens — relax the 0005 "slots > 0" rule, but a
-- deal must still bring SOMETHING (opens or money)
alter table deals drop constraint if exists deals_slots_check;
alter table deals add constraint deals_slots_check
  check (slots >= 0 and (slots > 0 or amount > 0));

notify pgrst, 'reload schema';
