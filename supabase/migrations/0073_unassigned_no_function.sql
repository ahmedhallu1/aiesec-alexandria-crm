-- 0073 — AN UNOWNED ACCOUNT CARRIES NO FUNCTION (v36)
--
-- `accounts.function` has been NOT NULL since 0001, which was right when every
-- account was created by a person who worked one. v22 broke that assumption
-- without anybody noticing: the LC's two old research sheets were imported as
-- 2,145 UNASSIGNED accounts, and each row was stamped with the function of the
-- SHEET it came from. Nobody chose those labels. Today 229 of them are still
-- unowned, still active, and still say IGV — because that is which tab they
-- were pasted in, not because anyone decided they were IGV names.
--
-- The label is not harmless. It puts the whole pool on IGV's dashboard as
-- IGV's market research, and it hides those same names from the IGT, B2B and
-- BD crews, who could pick up any of them tomorrow — an unowned name belongs
-- to whichever raiser claims it, and the first thing claiming does now is
-- stamp the CLAIMER's function on it. A function is a decision, so until
-- somebody makes it the column says NULL, which is the truth.
--
-- ⚠️ `Account.function` widens to `AccountFunction | null` in the TypeScript
-- layer at the same time, deliberately: it makes the ~40 read sites that
-- assume a function fail at COMPILE time instead of silently rendering an
-- empty badge in production.
--
-- `accounts_pipeline` selects `a.function` straight through and needs no
-- change — a view does not care whether a column it forwards is nullable.

-- ------------------------------------------------------------ 1. the column
alter table public.accounts alter column function drop not null;

-- ------------------------------------------------------------- 2. the check
-- 0019's version reads `check ((function)::text = any (array[...]))`, which a
-- NULL already satisfies — SQL checks pass on NULL. That is an accident of
-- three-valued logic rather than a statement of intent, and this constraint is
-- the one place a reader looks to find out whether NULL is legal here. Say it.
alter table public.accounts drop constraint if exists accounts_function_check;
alter table public.accounts add constraint accounts_function_check
  check ((function) is null
         or (function)::text = any (array['IGV', 'IGT', 'B2B', 'BD', 'B2C']));

comment on column public.accounts.function is
  'NULL = nobody has claimed it yet (v36). A function is a decision the claimer makes, and the unowned research pool has had none made about it — the 229 rows that said IGV said so because of the sheet tab they were imported from in v22, not because anyone chose. For name uniqueness a NULL counts as the ICX world (see accounts_normalized_name_world_key below).';

-- ------------------------------------------------------- 3. the name worlds
-- 0052 split account names into three worlds — ICX (IGV·IGT·B2B) · BD · B2C —
-- with a name unique only WITHIN its world.
--
-- ⚠️ THE NULL BRANCH IS NOW LOAD-BEARING AND MUST STAY EXPLICIT. Before today
-- an unowned account always had a function, so the trailing `else 'icx'` was
-- only ever reached by IGV/IGT/B2B rows. From now on it is what the ENTIRE
-- unowned pool falls through to — and it is the right answer, because the pool
-- is ICX research: an unowned name must collide with the active ICX names it
-- could be claimed as, or the same company gets researched twice. But left
-- implicit, the day somebody adds a fourth world and writes
-- `when function = 'X' then 'x' ... else 'icx'` a step out of order, or swaps
-- the fallthrough for a NULL-producing expression, uniqueness silently
-- disappears for every unowned row at once — a unique index over a NULL key
-- constrains nothing, and no error is raised anywhere.
--
-- The rewrite itself cannot fail on existing data: the CASE returns exactly
-- what it returned before for every current row (the 229 are IGV, i.e. 'icx'
-- both ways), so no pair that was unique a second ago collides now. It is done
-- BEFORE the backfill so the NULL branch is already in place the first time a
-- NULL function exists.
drop index if exists accounts_normalized_name_world_key;

create unique index accounts_normalized_name_world_key
  on public.accounts (
    normalized_name,
    (case when function is null then 'icx'          -- the unowned pool: ICX
          when function = 'B2C'::lc_function then 'b2c'
          when function = 'BD'::lc_function then 'bd'
          else 'icx' end)
  );

-- --------------------------------------------------------- 4. the pool read
-- The unowned pool is its own screen now, read newest-first by every MM and
-- VP/Director of IGV/IGT/B2B/BD. It is a few hundred rows inside a table of
-- ~4,700, which is exactly what a partial index is for.
create index if not exists accounts_unowned_idx
  on public.accounts (created_at desc)
  where responsible_id is null and out_of_process = false;

-- ------------------------------------------------------------ 5. the backfill
-- Unassigned AND active AND not test. Each condition earns its place:
--   responsible_id is null   — an OWNED account's function is a real decision
--                              its owner made, and is never touched here
--   out_of_process = false   — the archive is the blacklist, and it is
--                              per-world (0052). Blanking an archived row's
--                              function would move it between archives and let
--                              a burned name be re-added somewhere else
--   is_test = false          — seeded test accounts are left exactly as the
--                              seeder wrote them
--
-- Expect 229 ROWS UPDATED (verified against production 2026-09-02: unowned +
-- active + not test is 229 rows, all currently labelled IGV, and zero in every
-- other function). A number far off that means this file met a database it was
-- not written for — stop and read before carrying on.
--
-- It bumps `updated_at` on all 229 (the accounts_updated_at trigger from 0001
-- fires on any update). That is correct — the row DID change — but it is worth
-- knowing before somebody wonders why the whole unowned pool looks touched.
update public.accounts
   set function = null
 where responsible_id is null
   and out_of_process = false
   and is_test = false;

notify pgrst, 'reload schema';

-- ------------------------------------------------------- verify (read-only)
-- Expect one row: function_less = 229, still_labelled = 0.
select count(*) filter (where a.function is null)     as function_less,
       count(*) filter (where a.function is not null) as still_labelled
from public.accounts a
where a.responsible_id is null and a.out_of_process = false and a.is_test = false;
