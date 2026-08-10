-- 0053 — WHO CAN SEE A CUSTOM CALENDAR ITEM (v33.31)
--
-- 0044 gave custom items an invite-shaped audience: the owner plus an
-- EXPLICIT assignee list, and nobody else. That covers "put this on three
-- people's calendars" but not "block this hour so my team can see I'm busy",
-- which is what the floor actually asked for.
--
-- `visibility` widens the audience WITHOUT touching the assignee rule: the
-- owner and every assignee always see the item, and the scope adds a group
-- on top. 'self' is exactly the old behaviour, which is why it is the
-- default — every existing row keeps behaving as it did.
--
--   self      owner + assignees only          (the 0044 behaviour)
--   team      + the owner's team              (same manager, or manager<->report)
--   function  + everyone in `function_key`    (frozen at creation, see below)
--   eb        + the EB (LCP + LCVPs)
--   lc        + the whole LC
--
-- Which scopes a person may PICK is `calendarItemScopes` in src/lib/rbac.ts —
-- change both together.
--
-- `function_key` already existed but was written as "the owner's arbitrary
-- first function" and read by nothing. From now on it is MEANINGFUL for
-- visibility='function', and it is frozen at creation on purpose: deriving it
-- from the owner's CURRENT functions would silently rewrite the audience of
-- every past item the day someone changes function (the v33.23 ir_calls.fn
-- lesson).

alter table calendar_items
  add column if not exists visibility text not null default 'self';

alter table calendar_items
  drop constraint if exists calendar_items_visibility_check;

alter table calendar_items
  add constraint calendar_items_visibility_check
  check (visibility in ('self', 'team', 'function', 'eb', 'lc'));

-- ------------------------------------------------------- verify (read-only)
-- Expect: the column present, defaulting to 'self', and every existing row
-- carrying 'self' (i.e. nothing changed audience under anyone's feet).
select
  (select count(*) from calendar_items) as total_items,
  (select count(*) from calendar_items where visibility = 'self') as unchanged_items,
  (select column_default from information_schema.columns
    where table_name = 'calendar_items' and column_name = 'visibility') as default_value;
