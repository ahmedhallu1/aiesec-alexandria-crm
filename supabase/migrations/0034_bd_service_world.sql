-- 0034 — BD joins B2C in the "service" name world
--
-- 0020 split account names into two worlds so each keeps its own archive, and
-- put the boundary at B2C:
--
--     unique (normalized_name, (function = 'B2C'))
--
-- That left BD in with IGV/IGT/B2B. But BD sells a money partnership and B2C
-- sells courses and events — neither is raising opens. A company an IGV team
-- burned for opens is a perfectly good BD partner, and the archive of one
-- should not block the other. The boundary moves to match:
--
--     OPENS    IGV · IGT · B2B
--     SERVICE  BD  · B2C
--
-- This only ever RELAXES the constraint (a BD name stops colliding with the
-- opens world and starts colliding with B2C instead). Verified against prod
-- first: zero rows collide under the new grouping.
--
-- Mirrors `checkAccountName` in src/server/data.ts — change both together.

drop index if exists accounts_normalized_name_world_key;

create unique index accounts_normalized_name_world_key
  on accounts (
    normalized_name,
    ((function = 'B2C'::lc_function or function = 'BD'::lc_function))
  );

-- ------------------------------------------------------- verify (read-only)
-- Expect ONE row naming the new index. An error above means nothing was
-- applied — read it rather than trusting the green tick. (In the Supabase SQL
-- editor, make sure NOTHING is selected before you hit Run: with a selection
-- it executes only the highlighted text.)
select indexname, indexdef
from pg_indexes
where tablename = 'accounts' and indexname = 'accounts_normalized_name_world_key';
