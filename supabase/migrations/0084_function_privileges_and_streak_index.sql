-- 0084 — close the PUBLIC execute grant on the two SECURITY DEFINER counters,
-- pin search_path on the contact-key helpers, index the streak read (v37.7)
--
-- 1. 0030 and 0064 revoked EXECUTE from anon/authenticated, but Postgres grants
--    EXECUTE to PUBLIC by default, so the live ACL was still `=X/postgres`:
--    anyone holding the anon key could call bump_rate_bucket(k) through
--    /rest/v1/rpc — and it upserts app_settings with a CALLER-CHOSEN key, i.e.
--    it could overwrite any setting (cxp:drive-root, planning:sheet-id, …) with
--    {n: …}. Every legitimate caller uses the service-role client.
revoke execute on function public.bump_rate_bucket(text) from public, anon, authenticated;
revoke execute on function public.bump_api_key_use(uuid) from public, anon, authenticated;
grant execute on function public.bump_rate_bucket(text) to service_role;
grant execute on function public.bump_api_key_use(uuid) to service_role;

-- 2. Security advisor 0011 (function_search_path_mutable). No behaviour change.
alter function public.contact_key(text, text) set search_path = public, pg_temp;
alter function public.account_contact_keys(jsonb, text, text, text, text) set search_path = public, pg_temp;
alter function public.account_contact_clashes(jsonb, uuid) set search_path = public, pg_temp;
alter function public.account_ids_matching_contact(text) set search_path = public, pg_temp;

-- 3. streakStats reads signup_logs by field = 'contacted' and a date window on
--    every sign-ups/dashboard render; with only (signup_id, at) indexed that was
--    a full scan each time (~54k seq scans, 414M tuples read by 2026-10-03).
create index if not exists signup_logs_field_at_idx on public.signup_logs (field, at);
