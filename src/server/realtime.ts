import "server-only";
import { env } from "@/lib/env";
import { keepAlive } from "@/server/background";

/** LIVE PUSHES TO PUBLIC PAGES (v38) — Supabase Realtime BROADCAST.
 *
 *  A page like /no-peace subscribes to a public channel with the publishable
 *  key; a write here POSTs the new state to Realtime's REST endpoint with the
 *  service key, and every open page gets it within a second. No table is
 *  exposed (it is a broadcast, not postgres_changes) and it costs no Vercel
 *  invocation per viewer — the page never polls.
 *
 *  Fire-and-forget (keepAlive): a slow Realtime must never hold up "Saved",
 *  and a failed push only means viewers see the change on their next load. */
export function broadcast(topic: string, event: string, payload: unknown): void {
  if (!env.supabaseUrl || !env.supabaseServiceKey) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  keepAlive(
    fetch(`${env.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.supabaseServiceKey,
        Authorization: `Bearer ${env.supabaseServiceKey}`,
      },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: false }] }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) console.error(`[realtime] ${topic}/${event} → ${res.status} ${await res.text().catch(() => "")}`);
      })
      .catch((e) => console.error(`[realtime] ${topic}/${event} failed:`, e instanceof Error ? e.message : e))
      .finally(() => clearTimeout(timer))
  );
}

/** What a browser needs to listen — null when the key isn't configured. */
export function realtimeClientConfig(): { url: string; key: string } | null {
  return env.supabaseUrl && env.supabasePublishableKey
    ? { url: env.supabaseUrl, key: env.supabasePublishableKey }
    : null;
}
