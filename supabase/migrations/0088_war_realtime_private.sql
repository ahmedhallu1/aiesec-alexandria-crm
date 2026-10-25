-- 0088 — THE WAR BOARD'S LIVE CHANNEL IS LISTEN-ONLY (v38.3)
--
-- v38 broadcast the public snapshot on a PUBLIC Realtime channel. Public
-- channels let any client holding the (public, by design) publishable key
-- SEND on them too — so anyone could push a forged leaderboard onto every
-- open /no-peace page. The channel is now PRIVATE: Realtime authorises each
-- client against RLS on realtime.messages. Browsers (anon / signed-in) may
-- only LISTEN to broadcasts on the "no-peace" topic; there is deliberately no
-- INSERT policy, so no browser can send. The server sends through Realtime's
-- REST endpoint with the service role, which bypasses RLS.

create policy "no-peace board: listen only"
  on realtime.messages
  for select
  to anon, authenticated
  using (realtime.topic() = 'no-peace' and extension = 'broadcast');
