"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "./hint";

/** Keeps every screen fresh like a shared sheet — without hurting smoothness:
 *  re-fetches server data when the tab regains focus, and periodically while
 *  the tab is visible. router.refresh() re-renders in place (no reload, no
 *  state loss, no flicker).
 *
 *  THE INTERVAL IS A HOSTING BILL (v33). Every tick is a full server render,
 *  and a dashboard render reads the LC's whole account table — so at 30s, 40
 *  members with a tab open cost ~115k renders a month doing nothing but
 *  re-drawing unchanged numbers. That is what pushed the project to 97.5% of
 *  the Fluid Active CPU allowance. Three minutes is still "live" for a CRM
 *  nobody watches second-by-second, and the FOCUS refresh below means coming
 *  back to the tab is always instant and current — which is when staleness is
 *  actually noticed. */
/** v33.5 — raised 20s → 2min. Focus-driven refresh is cheap per event but a
 *  member alt-tabbing between Sodio and WhatsApp fires it constantly, and each
 *  one is a full server render. Two minutes still means "current when you come
 *  back to it" for a CRM nobody watches second-by-second, and it cut the
 *  refresh traffic of an active session by roughly six.
 *
 *  v33.14 — raised again to TEN minutes with the project near its CPU
 *  allowance. Every focus event is a full server render; a member alt-tabbing
 *  between Sodio and WhatsApp all morning was generating dozens. The manual
 *  refresh button is always there, and any action you take re-renders anyway. */
const MIN_GAP_MS = 600_000;

export function AutoRefresh() {
  const router = useRouter();
  // 0 = never refreshed yet; seeded inside the effect, not during render
  const lastRef = useRef(0);

  useEffect(() => {
    if (lastRef.current === 0) lastRef.current = Date.now();
    const refresh = () => {
      if (Date.now() - lastRef.current < MIN_GAP_MS) return;
      lastRef.current = Date.now();
      router.refresh();
    };
    // FOCUS-DRIVEN ONLY. Background polling is what ate the quota: an idle tab
    // nobody was looking at re-rendered the whole page — and the dashboard
    // render reads the LC's entire account table — every 30 seconds, forever.
    // Refreshing when someone actually returns to the tab gives the same
    // freshness where it is perceived, and costs nothing while they're away.
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}

/** Manual "pull the latest" button for the sidebar — spins while re-fetching. */
export function RefreshButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Hint label="Refresh — pull everyone's latest changes">
      <button
        type="button"
        aria-label="Refresh data"
        onClick={() => start(() => router.refresh())}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
          className
        )}
      >
        <RefreshCw className={cn("size-4.5", pending && "animate-spin")} />
      </button>
    </Hint>
  );
}
