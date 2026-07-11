-- "Admin" comment label — the IM director's comments are Admin, not LCP.
-- Run in the Supabase SQL editor (after 0005_deals.sql).

alter table account_comments drop constraint if exists account_comments_author_label_check;
alter table account_comments add constraint account_comments_author_label_check
  check (author_label in ('Member','TL','VP','LCP','Admin'));

-- relabel the admin's historical comments
update account_comments set author_label = 'Admin'
where author_label = 'LCP'
  and member_id in (select id from members where lower(email) = 'ahmedhallul@aiesec.net');
