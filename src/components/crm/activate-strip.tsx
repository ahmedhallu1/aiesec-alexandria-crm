"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cairoToday } from "@/lib/types";

/** 🏆 ROAD TO ACTIVATE (v33.52).
 *
 *  Activate is the national conference the whole LC works towards, and the
 *  awards are decided by what this system already measures. A thin band above
 *  every page keeps the deadline in front of the people doing the work.
 *
 *  IT REMOVES ITSELF. `ACTIVATE_DAY` is the conference; the day AFTER it the
 *  strip stops rendering for everyone, with nothing to clean up and no EB
 *  action needed. Dismissing it hides it until tomorrow — never longer,
 *  because a countdown nobody sees is just a row of pixels. */
export const ACTIVATE_DAY = "2026-12-03";
const DISMISS_KEY = "sodio-activate-dismissed";

/** Whole Cairo days from today to the conference (negative once it's past). */
export function daysToActivate(today = cairoToday()): number {
  const a = Date.parse(`${ACTIVATE_DAY}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return 0;
  return Math.round((a - t) / 86_400_000);
}

export function ActivateStrip() {
  // rendered from the CLIENT's own Cairo day so the countdown is never a
  // build-time constant baked into a cached page
  const [days, setDays] = useState<number | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const today = cairoToday();
    const left = daysToActivate(today);
    setDays(left);
    setHidden(left < 0 || localStorage.getItem(DISMISS_KEY) === today);
  }, []);

  if (hidden || days === null || days < 0) return null;

  const line =
    days === 0
      ? "It's today. Go get it. 🏆"
      : days === 1
        ? "Tomorrow. 🏆"
        : `${days} days to go`;

  return (
    <div className="relative z-40 flex items-center justify-center gap-2.5 bg-gradient-to-r from-[#037EF3] via-[#0a5fd0] to-[#0A2540] px-10 py-1.5 text-center text-white">
      <p className="truncate text-xs font-semibold tracking-wide sm:text-sm">
        🏆 <span className="font-black">Road to Activate</span>
        <span className="mx-1.5 opacity-60">·</span>
        <span className="tabular-nums">{line}</span>
        <span className="hidden opacity-80 sm:inline">
          {" "}— every account, call and open counts towards it.
        </span>
      </p>
      <button
        type="button"
        aria-label="Hide until tomorrow"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, cairoToday());
          setHidden(true);
        }}
        className="absolute right-2 rounded p-1 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
