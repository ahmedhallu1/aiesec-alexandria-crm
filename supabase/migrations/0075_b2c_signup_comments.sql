-- 0075 — B2C'S VOICE ON A SIGN-UP ACTUALLY WORKS (v36)
--
-- v35.1 ④ gave the B2C crew somewhere to write down what was said on their
-- selling call: they comment on the sign-up in their OWN class, shown as its
-- own thread, so the context stops living in WhatsApp while the row looks
-- untouched. The code shipped on 2026-08-28 — `actions.ts` writes
-- `author_class: "b2c"`, `types.ts` declares `"member" | "vp" | "b2c"`, and
-- `signups-view.tsx` renders a third thread with its own 🛍 marker.
--
-- ⚠️ THE CONSTRAINT WAS NEVER WIDENED. `0025_ogx_signups.sql:68` still reads
-- `check (author_class in ('member', 'vp'))` and it is the ONLY place the
-- column is constrained anywhere in this repo — no migration was ever written
-- to add the third class. So every B2C comment since the feature shipped has
-- failed on
--     new row for relation "signup_comments" violates check constraint
--     "signup_comments_author_class_check"
-- and the member saw a red banner with a Postgres error in it.
--
-- Measured against production before writing this file: `signup_comments`
-- holds 3,166 'member' rows and 21 'vp' rows and ZERO 'b2c' rows, against 70
-- B2C calls logged by 2 distinct B2C callers. The feature has not worked once.
--
-- THE LESSON, WORTH WRITING DOWN BECAUSE IT WILL HAPPEN AGAIN: migrations here
-- are applied BY HAND in the Supabase SQL editor (there is no CLI on the
-- deploying machine — see AI_CONTEXT.md §1). Code and schema therefore ship on
-- two different clocks, and nothing in CI catches a write that the database
-- will refuse. A CHECK constraint listing string literals is the sharpest
-- version of that trap: TypeScript's union type and the SQL check are two
-- copies of one list, and only one of them is enforced at build time.

-- The constraint is replaced rather than added to — Postgres has no "extend a
-- check", and dropping by the exact name 0025 generated is what makes this
-- file safe to run twice.
alter table public.signup_comments
  drop constraint if exists signup_comments_author_class_check;

alter table public.signup_comments
  add constraint signup_comments_author_class_check
  check (author_class in ('member', 'vp', 'b2c'));

comment on column public.signup_comments.author_class is
  'Which thread the comment belongs to. "member" = the sign-up''s owner or an MM; "vp" = the function''s VP/Director (v33 numbering rules); "b2c" = the B2C caller selling a course to the same person (v35.1). ⚠️ A b2c row is NEVER written back to the OGX tracker sheet — that Comment/VP Comment pair belongs to the OGX crew''s own log, and the write-back only speaks the first two classes.';

notify pgrst, 'reload schema';

-- ------------------------------------------------------- verify (read-only)
-- Expect: allows_b2c = true. Run a real B2C comment afterwards to confirm the
-- insert succeeds — the constraint is only half the fix, the caller also has
-- to be permitted to comment at all (see addSignupComment's b2cOnly branch).
select pg_get_constraintdef(oid) like '%b2c%' as allows_b2c,
       pg_get_constraintdef(oid)               as definition
from pg_constraint
where conrelid = 'public.signup_comments'::regclass
  and conname  = 'signup_comments_author_class_check';
