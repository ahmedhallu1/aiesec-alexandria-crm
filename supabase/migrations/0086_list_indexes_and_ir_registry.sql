-- 0086 — the accounts view stops computing every row for one page, and the IRs
-- the booking page never registered are registered (v37.14)
--
-- 1. accounts_pipeline joins five LATERAL lookups onto every account (contact
--    counts, last contact, last visit, last deal, pinned comment). Every read
--    of it ORDERs and pages — the list by updated_at, fetchAll by created_at —
--    and with no index on either order Postgres had to run all five lookups
--    for ALL ~5,650 accounts, sort, and then keep 100 or 1,000 of them:
--    ~70 ms for one 100-row list page, ~290 ms for each 1,000-row page of a
--    full read. With the order indexed it walks the index and stops after the
--    page — measured 3.5 ms and 16 ms on production data.
create index if not exists accounts_updated_order_idx
  on public.accounts (updated_at desc nulls last, id);
create index if not exists accounts_created_order_idx
  on public.accounts (created_at, id);

-- 2. The pinned-comment lookup was the most expensive of the five: the only
--    index is (account_id, created_at), so for every account it walked ALL of
--    its comments backwards looking for a pinned one (~150 ms of the 290).
--    Pinned comments are a handful — a partial index makes it one probe.
create index if not exists account_comments_pinned_idx
  on public.account_comments (account_id, created_at desc)
  where pinned;

-- 3. The CIC "my second calls" view filters sign-ups by cic_assigned_to, which
--    had no index (Supabase advisor 0001, the one unindexed FK the app reads by).
create index if not exists signups_cic_assigned_idx
  on public.signups (cic_assigned_to)
  where cic_assigned_to is not null;

-- 4. EVERY IR IS A REAL PERSON — FOR REAL THIS TIME. 0049 gave
--    partner_lc_contacts a one-row-per-person index on
--    (partner_lc_id, lower(email)) WHERE email IS NOT NULL and backfilled it
--    once; the booking code then upserted with on_conflict=(partner_lc_id,
--    email), which names no index (the real one is an expression AND partial),
--    so every booking since was refused with 42P10 and nothing logged it.
--    128 of 170 calls had no contact row on 2026-10-16. Same backfill as 0049 —
--    idempotent, adds only what is missing. The code is fixed in the same
--    release (a plain insert; a duplicate is "already there").
insert into partner_lc_contacts (partner_lc_id, name, role, email, phone, product, source)
select distinct on (c.partner_lc_id, lower(c.booker_email))
       c.partner_lc_id,
       coalesce(nullif(trim(c.booker_name), ''), split_part(c.booker_email, '@', 1)),
       c.booker_role,
       lower(c.booker_email),
       c.booker_phone,
       c.product,
       'booking'
from ir_calls c
where c.partner_lc_id is not null
  and c.booker_email is not null
  and trim(c.booker_email) <> ''
order by c.partner_lc_id, lower(c.booker_email), c.called_at desc
on conflict do nothing;

-- 5. A CANCELLED LAST DEAL LEFT THE ACCOUNT AT "DEAL DONE". The pipeline
--    view's stage reads accounts.slot_raised, and cancelDeal recomputed the
--    counters but never cleared it (fixed in code, same release). One account
--    on 2026-10-16 — Leader Gym, its only deal cancelled 2026-08-28.
update accounts a
   set slot_raised = false, slot_raised_at = null
 where a.slot_raised
   and not exists (select 1 from deals d where d.account_id = a.id);

-- 6. IMPOSSIBLE NEXT-STEP DATES. Before v36.6 (account edits) and v37.7
--    (contact / direct visit / report) a six-digit year could be typed into a
--    next step — "99999-09-09", "275760-09-09". It satisfies the "no account
--    floats without a dated next step" rule forever and never reminds anyone
--    (Google refuses the event). Every write path rejects it now; these 19
--    were written before that (all one member's, September 2026). The DATE is
--    cleared — the step's text stays — so the account honestly shows "No next
--    step set" until a real date is given. Same bounds as isSaneIsoDate.
update accounts
   set next_step_date = null, next_step_time = null
 where next_step_date > date '2100-12-31' or next_step_date < date '2020-01-01';

-- 7. Hourly throttle buckets are dead the moment their hour ends, and nothing
--    ever removed one (~340 by 2026-10-16, most of app_settings). The backup
--    cron prunes them nightly from now on (pruneRateBuckets); this clears the
--    backlog.
delete from app_settings
where (key like 'bookrl:%' or key like 'loginrl:%' or key like 'pwid:%'
    or key like 'pwip:%' or key like 'resetip:%' or key like 'resetmember:%'
    or key like 'apirl:%')
  and updated_at < now() - interval '2 days';

analyze public.accounts;
analyze public.account_comments;
