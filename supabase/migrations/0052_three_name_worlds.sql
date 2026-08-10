-- 0052 — THREE name worlds: ICX (IGV·IGT·B2B) · BD · B2C
--
-- 0020 split account names into two worlds (B2C vs the rest) and 0034 moved
-- BD across to sit with B2C. The floor's rule is finer: BD and B2C are
-- different businesses too — a venue B2C burned for an event says nothing
-- about BD selling them a sponsorship. Each of the three groups now keeps its
-- own archive, and a name is unique only WITHIN its group:
--
--     ICX  IGV · IGT · B2B   — raising opens
--     BD                     — money partnerships
--     B2C                    — courses / events / student activities
--
-- Across groups nothing blocks: the app (checkAccountName in
-- src/server/data.ts — change both together) shows an INFO note when the
-- name is already active elsewhere, and proceeds.
--
-- This only ever RELAXES the constraint (splitting the BD·B2C world in two
-- can only reduce collisions), so no prod rows can violate it.

drop index if exists accounts_normalized_name_world_key;

create unique index accounts_normalized_name_world_key
  on accounts (
    normalized_name,
    (case when function = 'B2C'::lc_function then 'b2c'
          when function = 'BD'::lc_function then 'bd'
          else 'icx' end)
  );

-- ------------------------------------------------------- verify (read-only)
-- Expect ONE row naming the new index with the CASE expression.
select indexname, indexdef
from pg_indexes
where tablename = 'accounts' and indexname = 'accounts_normalized_name_world_key';
