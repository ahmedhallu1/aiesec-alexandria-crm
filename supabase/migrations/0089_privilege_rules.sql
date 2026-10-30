-- 0089 — THE RULE MANAGER (v38.4)
--
-- One row per PRIVILEGE the LCP/admins have touched (Settings → Rules). A
-- privilege with no row behaves exactly as the code says — the built-in RBAC
-- answer in src/lib/rbac.ts. The rule is resolved by src/lib/privileges.ts
-- and the columns mirror its PrivilegeRule type, deliberately the same shape
-- as tab_rules (0087): two permission screens that stored their audiences
-- differently would be a trap.
--
-- `key` is NOT a foreign key to anything: the list of switchable privileges
-- lives in code (PRIVILEGE_REGISTRY). A row whose key is no longer in that
-- list is ignored by the resolver rather than deleted, so renaming a rule
-- never silently drops what the LC had set.
--
-- RLS on, no policies: the anon/publishable key reaches none of it. Every
-- read and write goes through the service role behind the RBAC layer.

create table if not exists privilege_rules (
  key text primary key,
  base text not null default 'default' check (base in ('default', 'everyone', 'nobody')),
  allow_to jsonb not null default '{}'::jsonb,
  deny_from jsonb not null default '{}'::jsonb,
  note text,
  updated_by uuid references members(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table privilege_rules enable row level security;
