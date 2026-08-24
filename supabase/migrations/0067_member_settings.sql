-- 0067 — MY SETTINGS, and one field that stopped being mandatory (v34.8)
--
-- 1) members.settings — the per-PERSON twin of function_settings (0054).
--    ONE jsonb blob, for exactly the reason that table is one blob: a
--    settings store that needs a migration per toggle is a store nobody adds
--    toggles to. The SHAPE and the DEFAULTS live in
--    src/lib/member-settings.ts, and an ABSENT key means the behaviour that
--    shipped before this migration — so a member who never opens the panel
--    cannot tell it exists.
--
-- 2) im_prompts.body loses its NOT NULL. The IM director's prompt asked for a
--    title AND a body AND a caption for the rating control — three boxes for
--    what is usually one sentence ("Peak review is on Sunday"). The title is
--    now the only required field, so the body has to be allowed to be empty.

alter table members
  add column if not exists settings jsonb not null default '{}'::jsonb;

comment on column members.settings is
  'Per-member preferences (v34.8). Shape + defaults in src/lib/member-settings.ts. An absent key = the pre-0067 behaviour.';

alter table im_prompts
  alter column body drop not null;
