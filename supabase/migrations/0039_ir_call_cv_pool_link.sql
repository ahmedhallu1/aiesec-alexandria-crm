-- 0039 — the partner LC's own CV pool (v33.6)
-- IRs sometimes hand over a link to their CV pool during a call. It was going
-- into the free-text notes, where nobody could find it again.
alter table ir_calls add column if not exists cv_pool_link text;
