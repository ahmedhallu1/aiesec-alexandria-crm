"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RACE_SLUG, type RaceSnapshot } from "@/lib/race/model";

export type LiveState = "connecting" | "live" | "offline";

// ONE client per page load, keyed on url|key (the prop is a fresh object on
// every server refresh — a client per refresh would stack sockets)
type Client = import("@supabase/supabase-js").SupabaseClient;
let cached: { key: string; client: Promise<Client> } | null = null;
function liveClient(url: string, key: string): Promise<Client> {
  const id = `${url}|${key}`;
  if (cached?.key !== id)
    cached = {
      key: id,
      client: import("@supabase/supabase-js").then(({ createClient }) =>
        createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, storageKey: "sodio-alex-vs-must" },
          realtime: { params: { eventsPerSecond: 5 } },
        })
      ),
    };
  return cached.client;
}

const atMs = (s: RaceSnapshot) => Date.parse(s.at);
const MAX_AHEAD_MS = 5 * 60_000;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const laneOk = (l: unknown) => isObj(l) && typeof l.value === "number" && typeof l.goal === "number";

/** Everything the board reads off a snapshot, checked before it renders — a
 *  malformed push would otherwise take the public page down. */
export function validRaceSnapshot(p: unknown, newestMs: number): p is RaceSnapshot {
  if (!isObj(p) || !isObj(p.settings) || !isObj(p.approvals) || !isObj(p.slots)) return false;
  const st = p.settings;
  if (typeof st.title !== "string" || !isObj(st.home) || !isObj(st.rival) || !isObj(st.show)) return false;
  if (typeof st.approvalsGoal !== "number" || typeof st.slotsGoal !== "number") return false;
  for (const k of ["home", "rival"] as const) {
    if (!laneOk(p.approvals[k]) || !laneOk(p.slots[k])) return false;
    if (!isObj((p.approvals[k] as Record<string, unknown>).byProgram)) return false;
  }
  if (!Array.isArray(p.trail) || p.trail.length > 1000 || !Array.isArray(p.feed) || p.feed.length > 200) return false;
  if (!p.trail.every((t) => isObj(t) && typeof t.at === "string" && typeof t.home === "number" && typeof t.rival === "number")) return false;
  if (!p.feed.every((f) => isObj(f) && typeof f.id === "string" && typeof f.delta === "number" && typeof f.at === "string")) return false;
  if (typeof p.at !== "string") return false;
  const at = Date.parse(p.at);
  return Number.isFinite(at) && at <= Math.max(newestMs, Date.now()) + MAX_AHEAD_MS;
}

/** THE LIVE WIRE for /alex-vs-must — Supabase Realtime BROADCAST on the
 *  PRIVATE topic 'alex-vs-must' (0090: browsers may only listen). Every write
 *  (MUST logging a slot, a deal in Sodio, a CORE reading that moved) pushes the
 *  whole board. Without a key, or with the socket down, a quiet refresh a
 *  minute while visible. The newer snapshot wins. */
export function useRaceLive(initial: RaceSnapshot, realtime: { url: string; key: string } | null) {
  const router = useRouter();
  const [wire, setWire] = useState<RaceSnapshot | null>(null);
  const [state, setState] = useState<LiveState>(realtime ? "connecting" : "offline");
  const routerRef = useRef(router);
  const newestRef = useRef(atMs(initial));
  const hiddenAt = useRef<number | null>(null);
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
    let wasLive = false;
    let dropped = false;
    liveClient(url, key).then((client) => {
      if (!alive) return;
      const channel = client
        .channel(RACE_SLUG, { config: { private: true } })
        .on("broadcast", { event: "snapshot" }, ({ payload }) => {
          if (!validRaceSnapshot(payload, newestRef.current)) return;
          setWire((w) => (!w || atMs(payload) > atMs(w) ? payload : w));
        })
        .on("broadcast", { event: "closed" }, () => routerRef.current.refresh())
        .subscribe((status) => {
          if (!alive) return;
          if (status === "SUBSCRIBED") {
            if (dropped) routerRef.current.refresh();
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

  useEffect(() => {
    if (state === "live") return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [state, router]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 30_000) router.refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [router]);

  const snap = wire && atMs(wire) > atMs(initial) ? wire : initial;
  return { snap, state };
}
