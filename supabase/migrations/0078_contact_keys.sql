-- 0078 — ONE CANONICAL KEY PER PHONE, EMAIL AND LINK (v36.4)
--
-- Asked for in as many words: "adding a phone number that is on another
-- account marks this account as a duplicate — refuse, and give the details.
-- Same for links and emails. Sometimes someone adds the same account under a
-- different name, like 'abc kindergarten' and 'abc pre school'." The name
-- check can't see that; the contact details can.
--
-- ONE SOURCE OF TRUTH, IN SQL. `contact_key` turns a phone, an email or a link
-- into the form two spellings of the same thing share, and it is used for BOTH
-- sides of every comparison — the keys stored on an account (a generated
-- column, so no write path can forget to keep it) and the values being typed
-- (the clash RPC below). A TypeScript copy of this logic would drift.
--
--   phone  digits only; 00-prefix dropped; Egyptian local 01… / 02… / 03…
--          read as +20, so 01012345678 = +201012345678. 5-digit hotlines kept
--          (19xxx belongs to one company).
--   email  lower-cased.
--   link   no scheme, no www./m./web., no trailing slash, no ?query or #hash
--          (Instagram's ?igsh=, Maps' ?g_st=); facebook profile.php keeps its
--          id; fb.com = facebook.com; wa.me/<number> IS that phone. The bare
--          front page of a platform (facebook.com, linktr.ee) names nobody and
--          yields no key.

create or replace function public.contact_key(p_kind text, p_value text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v text := lower(btrim(coalesce(p_value, '')));
  d text;
  host text;
  rest text;
  fbid text;
begin
  if v = '' then
    return null;
  end if;

  if p_kind = 'phone' then
    d := regexp_replace(v, '\D', '', 'g');
    if left(d, 2) = '00' then d := substr(d, 3); end if;
    if length(d) = 11 and left(d, 2) = '01' then d := '2' || d; end if;
    if length(d) in (9, 10) and left(d, 2) in ('02', '03') then d := '2' || d; end if;
    if length(d) < 5 then return null; end if;
    return 'p:' || d;
  end if;

  if p_kind = 'email' then
    if position('@' in v) < 2 then return null; end if;
    return 'e:' || v;
  end if;

  if p_kind = 'link' then
    v := regexp_replace(v, '^[a-z][a-z0-9+.-]*://', '');
    host := split_part(split_part(split_part(v, '/', 1), '?', 1), '#', 1);
    rest := substr(v, length(host) + 1);
    host := regexp_replace(host, ':\d+$', '');
    host := regexp_replace(host, '^(www|m|mobile|web|business)\.', '');
    if host in ('fb.com', 'fb.me') then host := 'facebook.com'; end if;
    if host = '' or position('.' in host) = 0 then return null; end if;

    -- a WhatsApp link is that phone number
    if host = 'wa.me' or host like '%whatsapp.com' then
      d := regexp_replace(coalesce(substring(rest from '^/([0-9+]+)'), substring(rest from 'phone=([0-9+]+)'), ''), '\D', '', 'g');
      if length(d) >= 7 then return 'p:' || d; end if;
      return null;
    end if;

    if host = 'facebook.com' and rest ~ '^/profile\.php\?' then
      fbid := substring(rest from '[?&]id=([0-9]+)');
      return case when fbid is null then null else 'l:facebook.com/profile.php?id=' || fbid end;
    end if;

    rest := split_part(split_part(rest, '?', 1), '#', 1);
    rest := regexp_replace(rest, '/+$', '');
    if rest = '' and host ~ '^(facebook|instagram|linkedin|twitter|x|tiktok|youtube|linktr|snapchat|t)\.' then
      return null;
    end if;
    return 'l:' || host || rest;
  end if;

  return null;
end $$;

create or replace function public.account_contact_keys(
  p_contacts jsonb, p_phone text, p_email text, p_website text, p_social text
)
returns text[]
language sql
immutable
parallel safe
as $$
  select coalesce(array_agg(distinct k) filter (where k is not null), '{}')
  from (
    select public.contact_key(c->>'kind', c->>'value') as k
    from jsonb_array_elements(
      case when jsonb_typeof(p_contacts) = 'array' then p_contacts else '[]'::jsonb end
    ) c
    union all select public.contact_key('phone', p_phone)
    union all select public.contact_key('email', p_email)
    union all select public.contact_key('link', p_website)
    union all select public.contact_key('link', p_social)
  ) s
$$;

alter table accounts
  add column if not exists contact_keys text[]
  generated always as (public.account_contact_keys(contacts, phone, email, website, social_link)) stored;

create index if not exists accounts_contact_keys_gin on accounts using gin (contact_keys);

comment on column accounts.contact_keys is
  'v36.4: canonical keys of every phone/email/link on the account (see contact_key). Generated — never written by the app.';

-- WHO ALREADY HOLDS THESE? Only keys the account doesn't ALREADY carry are
-- checked, so an account that shared a number with another one before this
-- guard existed can still be edited. Test accounts never block a real one.
create or replace function public.account_contact_clashes(p_contacts jsonb, p_exclude uuid default null)
returns table (
  key text,
  account_id uuid,
  name text,
  function text,
  responsible_id uuid,
  responsible_name text,
  out_of_process boolean,
  oop_reason text
)
language sql
stable
as $$
  with incoming as (
    select distinct public.contact_key(c->>'kind', c->>'value') as key
    from jsonb_array_elements(
      case when jsonb_typeof(p_contacts) = 'array' then p_contacts else '[]'::jsonb end
    ) c
  ),
  mine as (
    select coalesce((select a.contact_keys from accounts a where a.id = p_exclude), '{}') as keys
  ),
  fresh as (
    select i.key from incoming i, mine where i.key is not null and not (i.key = any (mine.keys))
  )
  select f.key, a.id, a.name, a.function::text, a.responsible_id, m.name, a.out_of_process, a.oop_reason
  from fresh f
  join accounts a on a.contact_keys @> array[f.key]
  left join members m on m.id = a.responsible_id
  where (p_exclude is null or a.id <> p_exclude)
    and not coalesce(a.is_test, false)
  order by a.out_of_process, a.name
  limit 20
$$;

-- SEARCH BY NUMBER, EMAIL OR LINK — the accounts list and The Violet Man.
-- A partial number matches ("0101234" finds +201012345678); text with an @,
-- a dot or a slash is matched against emails and links.
create or replace function public.account_ids_matching_contact(p_q text)
returns setof uuid
language sql
stable
as $$
  with q as (
    select lower(btrim(coalesce(p_q, ''))) as t,
           ltrim(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '0') as d
  )
  select a.id
  from accounts a, q
  where exists (
    select 1 from unnest(a.contact_keys) k
    where (length(q.d) >= 4 and k like 'p:%' and substr(k, 3) like '%' || q.d || '%')
       or (length(q.t) >= 3 and q.t ~ '[@./]' and k like '%' || regexp_replace(q.t, '^[a-z]+://(www\.)?', '') || '%')
  )
  limit 300
$$;

revoke execute on function public.contact_key(text, text) from anon, authenticated;
revoke execute on function public.account_contact_keys(jsonb, text, text, text, text) from anon, authenticated;
revoke execute on function public.account_contact_clashes(jsonb, uuid) from anon, authenticated;
revoke execute on function public.account_ids_matching_contact(text) from anon, authenticated;
