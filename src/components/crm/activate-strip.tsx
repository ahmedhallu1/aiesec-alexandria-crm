"use client";

import { useEffect, useState } from "react";
import { cairoToday } from "@/lib/types";

/** 🏆 ROAD TO ACTIVATE (v33.54 — the road itself).
 *
 *  Activate is the national conference the whole LC is working towards, and
 *  the awards are decided by what this system already measures. So the banner
 *  is not a notice, it is a ROAD: asphalt, a moving centre line, the Blue Man
 *  travelling it, and the trophy waiting at the end. Where he stands is where
 *  the LC stands — the peak's first day is the start line, the conference is
 *  the finish.
 *
 *  NO DISMISS BUTTON, by request: this is the LC's horizon, not a notification.
 *  It removes ITSELF the day after the conference — `ACTIVATE_DAY` is the only
 *  thing keeping it alive, so there is nothing to clean up and no EB action to
 *  remember. */
export const ACTIVATE_DAY = "2026-12-03";
/** the start line: the winter peak's first day, so the road measures the run
 *  the LC is actually on rather than an arbitrary countdown window */
const ROAD_START = "2026-08-01";

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Whole Cairo days to the conference (negative once it's past). */
export function daysToActivate(today = cairoToday()): number {
  const a = dayNum(ACTIVATE_DAY);
  const t = dayNum(today);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return 0;
  return Math.round((a - t) / 86_400_000);
}

/** How far down the road we are, 0–1. */
export function roadProgress(today = cairoToday()): number {
  const start = dayNum(ROAD_START);
  const end = dayNum(ACTIVATE_DAY);
  const now = dayNum(today);
  if (!Number.isFinite(now) || end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export function ActivateStrip() {
  // the CLIENT's own Cairo day — never a build-time constant baked into a
  // cached page
  const [state, setState] = useState<{ days: number; progress: number } | null>(null);
  useEffect(() => {
    const today = cairoToday();
    setState({ days: daysToActivate(today), progress: roadProgress(today) });
  }, []);

  if (!state || state.days < 0) return null;
  const { days, progress } = state;
  const line =
    days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days} DAYS`;
  // keep the traveller clear of both kerbs so he never clips the trophy
  const at = 6 + progress * 74;

  return (
    <div className="activate-road relative overflow-hidden rounded-xl border border-white/10">
      <div className="relative flex items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
        {/* the sign */}
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">
            Road to
          </p>
          <p className="-mt-0.5 text-xl font-black uppercase leading-none tracking-tight text-white sm:text-2xl">
            Activate
          </p>
        </div>

        {/* the road */}
        <div className="relative h-11 min-w-0 flex-1 sm:h-12">
          <div className="activate-asphalt absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 overflow-hidden rounded-md sm:h-9">
            {/* kerbs */}
            <div className="absolute inset-x-0 top-[3px] h-px bg-white/25" />
            <div className="absolute inset-x-0 bottom-[3px] h-px bg-white/25" />
            {/* the centre line, travelling */}
            <div className="activate-lane absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2" />
            {/* the finish */}
            <div className="activate-finish absolute inset-y-0 right-0 w-7" />
          </div>
          {/* the traveller — where the LC is on the run */}
          <div
            className="absolute top-1/2 z-10 -translate-y-[68%] transition-[left] duration-1000"
            style={{ left: `${at}%` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/walk.png"
              alt=""
              className="h-10 w-auto drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)] sm:h-11"
            />
          </div>
          {/* the finish */}
          <div className="absolute right-0 top-1/2 z-10 -translate-y-1/2 text-2xl sm:text-[26px]">
            🏆
          </div>
        </div>

        {/* the distance left */}
        <div className="shrink-0 text-right">
          <p className="text-lg font-black leading-none tabular-nums text-white sm:text-xl">
            {line}
          </p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/55">
            {days === 0 ? "go get it" : "to go · 3 Dec"}
          </p>
        </div>
      </div>
    </div>
  );
}
