-- 0037 — "Admin" becomes a real member role (APPLIED via the Supabase connection).
--
-- The system caretaker. A PURE Admin (this role, no operational rank) sees the
-- whole LC like the LCP; a caretaker who also runs a function carries "Admin"
-- in their Sub Function column instead and keeps only their own modules, plus
-- the admin tools. The check constraint rejected the value, so an "Admin" on
-- the Membership sheet was silently importing as "Member".
alter table members drop constraint if exists members_role_check;
alter table members add constraint members_role_check
  check (role in ('LCP', 'LCVP', 'Team Leader', 'Coordinator', 'Member', 'Director', 'Admin'));
