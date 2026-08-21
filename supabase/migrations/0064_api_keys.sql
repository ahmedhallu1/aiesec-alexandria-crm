-- 0064 — API KEYS (v34.2)
--
-- A read-only, names-only accounts endpoint so someone can build an automatic
-- market-research tool that checks "do we already have this partner?" without
-- being handed the CRM.
--
-- Keys are NAMED and REVOCABLE: one per tool or person, so a key can be killed
-- without breaking every other integration, and the log says which key pulled
-- what. The key itself is never stored — only a SHA-256 hash of it, plus a
-- short prefix so a human can tell two keys apart in the admin list. Losing
-- the database therefore does not hand anyone a working key.

create table if not exists api_keys (
  id            uuid primary key default gen_random_uuid(),
  -- what this key is for, in the admin's words ("Ahmed's MR bot")
  label         text        not null,
  -- sha-256 of the key, hex. The key is shown ONCE, at creation.
  key_hash      text        not null unique,
  -- first 8 chars of the key, so the list is identifiable at a glance
  prefix        text        not null,
  created_by    uuid        references members(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  request_count bigint      not null default 0,
  -- revoking is a stamp, never a delete: the audit trail outlives the key
  revoked_at    timestamptz
);

create index if not exists api_keys_hash_idx on api_keys (key_hash) where revoked_at is null;

-- RLS on by default with NO policy: the app reaches this table only through
-- the service role, which bypasses RLS. anon/authenticated get nothing, which
-- is the v33.47 lesson — a table without RLS is a table that was forgotten.
alter table api_keys enable row level security;
revoke all on api_keys from anon, authenticated;

-- Atomic usage stamp: a read-modify-write on request_count would lose counts
-- under concurrent pulls. SECURITY DEFINER with a pinned search_path and no
-- anon/authenticated execute — the v33.47 audit's rule for every such function.
create or replace function bump_api_key_use(key_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update api_keys
     set request_count = request_count + 1,
         last_used_at  = now()
   where id = key_id;
$$;

revoke execute on function public.bump_api_key_use(uuid) from anon, authenticated;
