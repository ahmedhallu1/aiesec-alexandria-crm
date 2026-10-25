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

/** THE LIVE WIRE (v38). Subscribes to the war's Supabase Realtime BROADCAST
 *  channel — every save in the War Room pushes the whole public snapshot
 *  (server/war-actions.ts → server/realtime.ts), so the page updates within a
 *  second and never polls Vercel.
 *
 *  Without a key (or if the socket drops for good) it falls back to a quiet
 *  server refresh every 60 s while the tab is visible. Whichever snapshot is
 *  newer wins: the one in the props (a refresh) or the one off the wire. */
export function useWarLive(initial: WarSnapshot, realtime: { url: string; key: string } | null) {
  const router = useRouter();
  const [wire, setWire] = useState<WarSnapshot | null>(null);
  const [state, setState] = useState<LiveState>(realtime ? "connecting" : "offline");
  const hiddenAt = useRef<number | null>(null);

  const url = realtime?.url ?? null;
  const key = realtime?.key ?? null;
  useEffect(() => {
    if (!url || !key) return;
    let alive = true;
    let cleanup: (() => void) | null = null;
    liveClient(url, key).then((client) => {
      if (!alive) return;
      const channel = client
        .channel(WAR_SLUG)
        .on("broadcast", { event: "snapshot" }, ({ payload }) => {
          if (payload && typeof payload === "object" && Array.isArray((payload as WarSnapshot).rows))
            setWire(payload as WarSnapshot);
        })
        .subscribe((status) => {
          if (!alive) return;
          if (status === "SUBSCRIBED") setState("live");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setState("offline");
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

  const snap = wire && wire.at > initial.at ? wire : initial;
  return { snap, state };
}
