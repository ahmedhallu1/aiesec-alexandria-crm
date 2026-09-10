-- 0080 — REDIRECT LINKS NAME NOBODY; MAP LINKS ARE LOCATIONS (v36.4)
--
-- 1) Measured right after 0078: the most-shared "link" in the CRM was
--    l.facebook.com/l.php — Facebook's outbound-link wrapper, pasted onto six
--    unrelated accounts. It identifies no company, so it yields no key (and
--    the few rows that stored one are touched so the generated column is
--    recomputed).
--
-- 2) Maps share links (maps.app.goo.gl, goo.gl/maps, google.*/maps, Apple
--    Maps, Waze) are now tagged "Location" and drawn with the Maps pin. 69
--    accounts already carried one under "Website" or "Other"; they are
--    re-tagged here, in place, keeping every other contact as it was.

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
    -- a redirect wrapper names nobody
    if host in ('l.facebook.com', 'lm.facebook.com', 'l.instagram.com', 'l.messenger.com') then
      return null;
    end if;
    host := regexp_replace(host, '^(www|m|mobile|web|business)\.', '');
    if host in ('fb.com', 'fb.me') then host := 'facebook.com'; end if;
    if host = '' or position('.' in host) = 0 then return null; end if;

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

-- recompute the rows that stored a redirect key (the column is generated)
update accounts
set contacts = contacts
where exists (
  select 1 from unnest(contact_keys) k
  where k like 'l:l.facebook.com%' or k like 'l:lm.facebook.com%'
     or k like 'l:l.instagram.com%' or k like 'l:l.messenger.com%'
);

-- map links → "Location"
update accounts a
set contacts = (
  select jsonb_agg(
           case
             when c->>'kind' = 'link'
              and coalesce(c->>'tag', '') <> 'Location'
              and c->>'value' ~* '(maps\.app\.goo\.gl|goo\.gl/maps|maps\.google\.|google\.[a-z.]+/maps|maps\.apple\.com|waze\.com)'
             then jsonb_set(c, '{tag}', '"Location"')
             else c
           end
           order by t.ord)
  from jsonb_array_elements(a.contacts) with ordinality as t(c, ord)
)
where jsonb_typeof(a.contacts) = 'array'
  and exists (
    select 1 from jsonb_array_elements(a.contacts) c
    where c->>'kind' = 'link'
      and coalesce(c->>'tag', '') <> 'Location'
      and c->>'value' ~* '(maps\.app\.goo\.gl|goo\.gl/maps|maps\.google\.|google\.[a-z.]+/maps|maps\.apple\.com|waze\.com)'
  );
