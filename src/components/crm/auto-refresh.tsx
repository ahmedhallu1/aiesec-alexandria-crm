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
const INTERVAL_MS = 180_000;
const MIN_GAP_MS = 20_000;

export function AutoRefresh() {
  const router = useRouter();
  const lastRef = useRef(Date.now());

  useEffect(() => {
    const refresh = () => {
      if (Date.now() - lastRef.current < MIN_GAP_MS) return;
      lastRef.current = Date.now();
      router.refresh();
    };
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
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
