import "server-only";
import { env } from "@/lib/env";
import { keepAlive } from "@/server/background";

/** LIVE PUSHES TO PUBLIC PAGES (v38) — Supabase Realtime BROADCAST.
 *
 *  A page like /no-peace subscribes to a channel with the publishable key; a
 *  write here POSTs the new state to Realtime's REST endpoint with the service
 *  key, and every open page gets it within a second. No table is exposed (it
 *  is a broadcast, not postgres_changes) and it costs no Vercel invocation per
 *  viewer — the page never polls.
 *
 *  PRIVATE (v38.3): on a public channel anyone holding the publishable key
 *  could SEND too — a forged leaderboard on every open page. A private
 *  channel is authorised by RLS on realtime.messages (0088: browsers may only
 *  listen); the service key bypasses RLS, so only the server can send.
 *
 *  Fire-and-forget (keepAlive): a slow Realtime must never hold up "Saved".
 *  One retry after a short pause covers a blip; past that a failed push only
 *  means viewers see the change on their next load. */
const RETRY_AFTER_MS = 1500;

async function postBroadcast(body: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${env.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.supabaseServiceKey,
        Authorization: `Bearer ${env.supabaseServiceKey}`,
      },
      body,
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    return { ok: false, why: `${res.status} ${await res.text().catch(() => "")}` };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export function broadcast(topic: string, event: string, payload: unknown): void {
  if (!env.supabaseUrl || !env.supabaseServiceKey) return;
  const body = JSON.stringify({ messages: [{ topic, event, payload, private: true }] });
  keepAlive(
    (async () => {
      let r = await postBroadcast(body);
      if (!r.ok) {
        await new Promise((done) => setTimeout(done, RETRY_AFTER_MS));
        r = await postBroadcast(body);
      }
      if (!r.ok) console.error(`[realtime] ${topic}/${event} failed after a retry: ${r.why}`);
    })()
  );
}

/** What a browser needs to listen — null when the key isn't configured. */
export function realtimeClientConfig(): { url: string; key: string } | null {
  return env.supabaseUrl && env.supabasePublishableKey
    ? { url: env.supabaseUrl, key: env.supabasePublishableKey }
    : null;
}
