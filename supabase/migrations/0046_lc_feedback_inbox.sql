-- 0046 — the LC feedback inbox becomes a real inbox (v33.22)
--
-- Until now a concern could only be flipped new → seen → done, by whoever
-- opened it, with no record of what was decided and no way to bring anyone
-- else in. Three changes:
--
--  1. SEEN AND DONE WERE THE SAME THING (the LCP's call). One less state to
--     argue about: `new` (nobody has handled it), `done` (handled), and
--     `archived` (filed away — not a to-do any more, and not a resolution).
--     Existing 'seen' rows fold into 'done' — someone had read them.
--  2. A resolution is recorded: who closed it, when, and optionally what they
--     want the author told.
--  3. Feedback about a SESSION is its own kind. It used to be a concern with
--     the session's name glued onto the front of the message, so the inbox
--     could not separate "someone has an issue with a person" from "the
--     Thursday LC meeting ran long".

alter table lc_feedback
  add column if not exists touch_point_id uuid references touch_points(id) on delete set null;
alter table lc_feedback add column if not exists resolved_at timestamptz;
alter table lc_feedback
  add column if not exists resolved_by uuid references members(id) on delete set null;
alter table lc_feedback add column if not exists resolution text;
-- who it was passed on to, so the same person is never looped in twice
alter table lc_feedback add column if not exists shared_with uuid[] not null default '{}';
-- whether the author has been told it was handled (they are never named to
-- the reader, but the system knows who they are and can thank them)
alter table lc_feedback add column if not exists author_told_at timestamptz;

alter table lc_feedback drop constraint if exists lc_feedback_status_check;
update lc_feedback set status = 'done' where status = 'seen';
alter table lc_feedback
  add constraint lc_feedback_status_check check (status in ('new', 'done', 'archived'));

create index if not exists lc_feedback_status_idx on lc_feedback (status, created_at desc);
create index if not exists lc_feedback_touch_point_idx on lc_feedback (touch_point_id);
