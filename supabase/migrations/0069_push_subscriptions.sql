-- 0069 — PUSH SUBSCRIPTIONS: the bell reaches the phone (v35)
--
-- Sodio has had an in-app bell since v8, and it only ever rang inside a tab
-- somebody already had open. Everything urgent therefore travelled by email,
-- which is why the email volume kept being the thing people complained about.
-- A Web Push subscription is what lets a notification arrive on a locked
-- phone — and it is the same mechanism the Android app uses: the Play build
-- is a Trusted Web Activity, so its notifications are THESE notifications,
-- delegated to the app's own tray. One send path, two surfaces.
--
-- One row per DEVICE, not per member: the same person has a laptop, a phone
-- and the installed app, and each holds its own subscription with its own
-- keys. The endpoint is the identity (it is what the push service addresses),
-- so it carries the unique constraint and an upsert on it re-homes a
-- subscription that moved to another member — which happens on a shared
-- device the moment somebody else signs in.
--
-- Nothing here is a preference. A member turns push off by unsubscribing,
-- which DELETES the row; a permission revoked in the browser makes the
-- endpoint return 404/410 and `sendPushToMembers` prunes it on the next send.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  -- the push service's URL for this device — the subscription's identity
  endpoint text not null unique,
  -- the two keys the payload is encrypted to (RFC 8291)
  p256dh text not null,
  auth text not null,
  -- for the "which of my devices is this?" line in settings
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_member_idx
  on push_subscriptions (member_id);

comment on table push_subscriptions is
  'Web Push endpoints, one per device (v35). Written by savePushSubscription; pruned automatically when a push comes back 404/410. Also serves the Play TWA, whose notifications are delegated web push.';

-- RLS ON, NO POLICIES — the v33.47 audit's rule: the app reads this with the
-- service role only, and the anon key must never see somebody's device keys.
alter table push_subscriptions enable row level security;
