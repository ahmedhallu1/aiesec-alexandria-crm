-- 0040 — the membership ARCHIVE (v33.7)
-- Removing someone from the sheet means they left the LC. That is not the
-- same as deactivating someone who is still on the register, and mixing the
-- two makes the members list read as wrong.
alter table members add column if not exists left_at timestamptz;
create index if not exists members_left_at_idx on members (left_at) where left_at is not null;
