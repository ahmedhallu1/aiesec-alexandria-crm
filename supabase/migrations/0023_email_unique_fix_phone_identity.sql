-- Sodio v24 review fixes (applied to prod 2026-07-30 via the Supabase MCP).
--
-- ① 0021 replaced members' email UNIQUE CONSTRAINT with a PARTIAL unique
--    index — PostgREST's ON CONFLICT (email) cannot use a partial index, so
--    every membership upsert (incl. the 30-min import cron) failed. A plain
--    UNIQUE constraint permits multiple NULLs (NULLS DISTINCT), so it is the
--    correct shape for optional emails.
drop index if exists members_email_key;
alter table members add constraint members_email_key unique (email);

-- ② phone-only members are identified by their phone — make that identity
--    unambiguous: unique normalized digits among email-less members.
create unique index if not exists members_phone_digits_key
  on members ((regexp_replace(coalesce(phone, ''), '\D', '', 'g')))
  where email is null and phone is not null;

-- ③ normalize stored phones so digit-tail matching works against formatted
--    sheet values ("+20 100 123 4567" → "+201001234567").
update members
  set phone = regexp_replace(phone, '[^0-9+]', '', 'g')
  where phone is not null and phone ~ '[^0-9+]';
