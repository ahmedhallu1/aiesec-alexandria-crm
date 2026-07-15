-- Sodio v12 — Directors get their own comment label (a Director is NOT a VP).
-- Run in the Supabase SQL editor (after 0012_contracts_reminders.sql).

alter table account_comments drop constraint if exists account_comments_author_label_check;
alter table account_comments add constraint account_comments_author_label_check
  check (author_label in ('Member', 'TL', 'VP', 'Director', 'LCP', 'Admin'));

notify pgrst, 'reload schema';
