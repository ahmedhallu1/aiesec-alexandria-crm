"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WAR_SLUG, type WarSnapshot } from "@/lib/war/model";

export type LiveState = "connecting" | "live" | "offline";

// ONE client per page load. The `realtime` prop is a fresh object on every
// server refresh, so the effect below keys on its two strings, and the client
// itself is cached here — a new client per refresh would stack sockets.
type Client = import("@supabase/supabase-js").SupabaseClient;
let cached: { key: string; client: Promise<Client> } | null = null;
function liveClient(url: string, key: string): Promise<Client> {
  const id = `${url}|${key}`;
  if (cached?.key !== id)
    cached = {
      key: id,
      client: import("@supabase/supabase-js").then(({ createClient }) =>
        createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, storageKey: "sodio-no-peace" },
          realtime: { params: { eventsPerSecond: 5 } },
        })
      ),
    };
  return cached.client;
}

const atMs = (s: WarSnapshot) => Date.parse(s.at);
/** a strictly newer snapshot — parsed, never compared as strings */
const newer = (a: WarSnapshot, b: WarSnapshot) => atMs(a) > atMs(b);

// how far ahead of what we already have a snapshot may claim to be — a
// far-future `at` would win every later comparison and freeze the board
const MAX_AHEAD_MS = 5 * 60_000;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Everything the board reads off a snapshot, checked before it renders — a
 *  malformed payload would otherwise take the whole public page down. */
export function validSnapshot(p: unknown, newestMs: number): p is WarSnapshot {
  if (!isObj(p)) return false;
  const st = p.settings;
  if (!isObj(st) || typeof st.name !== "string" || typeof st.minPoints !== "number" || !isObj(st.show)) return false;
  for (const k of ["rewards", "pointTypes", "rules", "heroLines"] as const) if (!Array.isArray(st[k])) return false;
  if (!Array.isArray(p.feed) || !Array.isArray(p.rows) || p.rows.length > 500) return false;
  if (!isObj(p.totals) || !isObj(p.totals.byKind)) return false;
  const rowOk = (r: unknown) =>
    isObj(r) && typeof r.id === "string" && typeof r.name === "string" && typeof r.fn === "string" && typeof r.role === "string" && typeof r.points === "number" && typeof r.rank === "number" && isObj(r.breakdown);
  const feedOk = (f: unknown) => isObj(f) && typeof f.id === "string" && typeof f.name === "string" && typeof f.label === "string" && typeof f.points === "number" && typeof f.at === "string";
  if (!p.rows.every(rowOk) || !p.feed.every(feedOk)) return false;
  if (typeof p.at !== "string") return false;
  const at = Date.parse(p.at);
  // ahead of the newest snapshot we hold OR the local clock, whichever is
  // later: a legit save after a quiet hour is an hour newer than the page
  return Number.isFinite(at) && at <= Math.max(newestMs, Date.now()) + MAX_AHEAD_MS;
}

/** THE LIVE WIRE (v38). Subscribes to the war's Supabase Realtime BROADCAST
 *  channel — every save in the War Room pushes the whole public snapshot
 *  (server/war-actions.ts → server/realtime.ts), so the page updates within a
 *  second and never polls Vercel.
 *
 *  The channel is PRIVATE (v38.3): only the server can send on it, so nobody
 *  with the public key can push a forged board to every open page; anything
 *  that arrives is still shape-checked first. A "closed" broadcast means the
 *  page was taken down — the refresh lands on the 404.
 *
 *  Without a key (or if the socket drops for good) it falls back to a quiet
 *  server refresh every 60 s while the tab is visible. Whichever snapshot is
 *  newer wins: the one in the props (a refresh) or the one off the wire. */
export function useWarLive(initial: WarSnapshot, realtime: { url: string; key: string } | null) {
  const router = useRouter();
  const [wire, setWire] = useState<WarSnapshot | null>(null);
  const [state, setState] = useState<LiveState>(realtime ? "connecting" : "offline");
  const hiddenAt = useRef<number | null>(null);

  // the subscription outlives renders — read the latest of these through refs
  const routerRef = useRef(router);
  const newestRef = useRef(atMs(initial));
  useEffect(() => {
    routerRef.current = router;
    newestRef.current = Math.max(atMs(initial), wire ? atMs(wire) : 0);
  });

  const url = realtime?.url ?? null;
  const key = realtime?.key ?? null;
  useEffect(() => {
    if (!url || !key) return;
    let alive = true;
    let cleanup: (() => void) | null = null;
    const mountedAt = Date.now();
    // a missed window: the socket dropped after being live, or the first
    // join took long enough that a save may have gone by unheard
    let wasLive = false;
    let dropped = false;
    liveClient(url, key).then((client) => {
      if (!alive) return;
      const channel = client
        .channel(WAR_SLUG, { config: { private: true } })
        .on("broadcast", { event: "snapshot" }, ({ payload }) => {
          if (!validSnapshot(payload, newestRef.current)) return;
          setWire((w) => (!w || newer(payload, w) ? payload : w));
        })
        .on("broadcast", { event: "closed" }, () => routerRef.current.refresh())
        .subscribe((status) => {
          if (!alive) return;
          if (status === "SUBSCRIBED") {
            if (dropped || (!wasLive && Date.now() - mountedAt > 3000)) routerRef.current.refresh();
            wasLive = true;
            dropped = false;
            setState("live");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            if (wasLive) dropped = true;
            setState("offline");
          }
        });
      cleanup = () => {
        client.removeChannel(channel);
      };
    });
    return () => {
      alive = false;
      cleanup?.();
    };
  }, [url, key]);

  // the fallback: a refresh a minute while visible (only when not live)
  useEffect(() => {
    if (state === "live") return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [state, router]);

  // coming back to a tab that slept a while — catch up on what was missed
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 30_000) router.refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [router]);

  const snap = wire && newer(wire, initial) ? wire : initial;
  return { snap, state };
}
