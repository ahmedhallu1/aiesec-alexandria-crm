-- 0042 — optional attachments on feedback (v33.13)
-- A screenshot says in one image what a paragraph struggles to: system
-- feedback is usually a picture of the bug, LC feedback is often evidence.
alter table feedback add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table lc_feedback add column if not exists attachments jsonb not null default '[]'::jsonb;
insert into storage.buckets (id, name, public)
values ('feedback', 'feedback', false) on conflict (id) do nothing;
