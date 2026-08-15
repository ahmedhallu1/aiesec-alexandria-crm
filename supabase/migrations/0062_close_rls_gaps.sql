-- CLOSING THE THREE HOLES IN THE ANON WALL (v33.46)
--
-- src/lib/supabase.ts states the security model in one line: "RLS blocks the
-- anon key entirely; every query goes through this client and is authorized by
-- the RBAC layer before it runs." The app holds up its end — there is exactly
-- one Supabase client in the codebase and it uses the service-role key, which
-- bypasses RLS by design.
--
-- The database did not. `anon` and `authenticated` hold SELECT/INSERT/UPDATE
-- grants on the public schema (Supabase's default), so RLS is the ONLY thing
-- standing between the anon key and the data. Every table had it enabled with
-- no policies — a deliberate deny-all, and the correct shape for this app —
-- except three objects:
--
--   function_settings     RLS never enabled
--   lc_partnerships       RLS never enabled (added in 0059)
--   accounts_pipeline     a SECURITY DEFINER view, so it runs as its OWNER and
--                         ignores the caller's RLS entirely — it would have
--                         served the whole account pipeline to anyone holding
--                         the anon key
--
-- This is not an active leak: the anon key is not used by the app and never
-- reaches the browser. It is the defence-in-depth layer that was believed to
-- be complete and was not, and anon keys are publishable by design — a
-- screenshot of the Supabase dashboard or one future client-side feature is
-- all it takes to make the difference matter.
--
-- SAFE TO APPLY: the service-role key bypasses RLS, so the running app sees no
-- change. Only the anon/authenticated roles lose access they were never meant
-- to have.

-- ---------------------------------------------------------------- tables
alter table public.function_settings enable row level security;
alter table public.lc_partnerships   enable row level security;

-- No policies, deliberately: deny-all to anon/authenticated, exactly like the
-- other forty tables. The app reaches them through the service role.

-- ---------------------------------------------------------------- the view
-- security_invoker makes the view run as the CALLER, so it inherits the RLS on
-- `accounts` underneath instead of laundering past it. The service role still
-- bypasses RLS, so the app is unaffected.
alter view public.accounts_pipeline set (security_invoker = on);

-- ------------------------------------------------------------- functions
-- bump_rate_bucket is the rate limiter. It is SECURITY DEFINER and was
-- callable by anon over /rest/v1/rpc — i.e. the one control that throttles
-- abuse could itself be driven by an anonymous caller. The app calls it
-- through the service role, which is unaffected by these revokes.
revoke execute on function public.bump_rate_bucket(text) from anon, authenticated;

-- A mutable search_path lets a caller who can create objects shadow the tables
-- a SECURITY DEFINER function resolves. Pin both.
alter function public.bump_rate_bucket(text) set search_path = public, pg_temp;
alter function public.set_updated_at()       set search_path = public, pg_temp;
