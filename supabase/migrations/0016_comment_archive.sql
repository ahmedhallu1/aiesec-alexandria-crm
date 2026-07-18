-- Sodio v20 — comments can be archived (hidden from the default view, kept for
-- the record). Run in the Supabase SQL editor (after 0015_bd_deal_amount.sql).

alter table account_comments add column if not exists archived boolean not null default false;

notify pgrst, 'reload schema';
