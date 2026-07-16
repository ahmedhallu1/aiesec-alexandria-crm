"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "./hint";

/** Keeps every screen fresh like a shared sheet — without hurting smoothness:
 *  re-fetches server data when the tab regains focus, and every 30s while the
 *  tab is visible. router.refresh() re-renders in place (no reload, no state
 *  loss, no flicker). A 10s floor stops refresh storms. */
const INTERVAL_MS = 30_000;
const MIN_GAP_MS = 10_000;

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
