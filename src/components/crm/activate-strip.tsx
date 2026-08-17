"use client";

import { useEffect, useState } from "react";
import { cairoToday } from "@/lib/types";

/** 🏆 ROAD TO ACTIVATE (v33.55 — a road with a horizon, not two lines).
 *
 *  Activate is the national conference the whole LC is working towards, and
 *  the awards are decided by what this system already measures. So the banner
 *  is a ROAD IN PERSPECTIVE: it starts wide underfoot and narrows to a
 *  vanishing point where the trophy waits, with milestone posts down the verge
 *  and the Blue Man walking it. He stands where the LC stands — the peak's
 *  first day is the start line, 3 December the finish — and he SHRINKS as he
 *  gets further away, which is what makes it read as distance rather than as a
 *  progress bar with a picture on it.
 *
 *  Everything is drawn: one inline SVG, one coordinate space, no layout maths
 *  between the road and the traveller (the first cut positioned him with CSS
 *  percentages against a separately-drawn road, which is why he floated).
 *
 *  NO DISMISS BUTTON, by request — this is the LC's horizon, not a
 *  notification. It removes ITSELF the day after the conference. */
export const ACTIVATE_DAY = "2026-12-03";
/** the start line: the winter peak's first day */
const ROAD_START = "2026-08-01";

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`);

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

// ---- the road's geometry, in the SVG's own units --------------------------
const W = 620;
const H = 104;
/** the vanishing point — where the road, the verges and the horizon meet */
const VX = 566;
const VY = 40;
/** the near edge of the tarmac, at the left kerb */
const NEAR_TOP = 44;
const NEAR_BOTTOM = 100;

/** the road's two edges at a given distance t (0 = here, 1 = the horizon) */
const edgeTop = (t: number) => NEAR_TOP + (VY - NEAR_TOP) * t;
const edgeBottom = (t: number) => NEAR_BOTTOM + (VY - NEAR_BOTTOM) * t;
const atX = (t: number) => t * VX;

export function ActivateStrip() {
  // the CLIENT's own Cairo day — never a build-time constant in a cached page
  const [state, setState] = useState<{ days: number; progress: number } | null>(null);
  useEffect(() => {
    const today = cairoToday();
    setState({ days: daysToActivate(today), progress: roadProgress(today) });
  }, []);

  if (!state || state.days < 0) return null;
  const { days, progress } = state;
  const line = days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days} DAYS`;

  // the traveller: further along = further away = smaller and higher up
  const t = Math.min(0.88, progress);
  const manH = 46 - 30 * t;
  const manX = atX(t) - manH * 0.18;
  const manY = edgeBottom(t) - manH * 0.86;

  // centre-line dashes, spaced so they crowd towards the horizon like real ones
  const dashes = Array.from({ length: 11 }, (_, i) => {
    const a = Math.pow(i / 11, 0.72);
    const b = Math.pow((i + 0.45) / 11, 0.72);
    const midA = (edgeTop(a) + edgeBottom(a)) / 2;
    const midB = (edgeTop(b) + edgeBottom(b)) / 2;
    const wA = (edgeBottom(a) - edgeTop(a)) * 0.055;
    const wB = (edgeBottom(b) - edgeTop(b)) * 0.055;
    return `M ${atX(a)} ${midA - wA} L ${atX(b)} ${midB - wB} L ${atX(b)} ${midB + wB} L ${atX(a)} ${midA + wA} Z`;
  });

  // milestone posts down the near verge
  const posts = [0.16, 0.38, 0.6, 0.79].map((p) => ({
    x: atX(p),
    y: edgeBottom(p),
    h: 13 - 8 * p,
    done: p <= progress,
  }));

  return (
    <div className="activate-road relative overflow-hidden rounded-xl border border-white/10">
      <div className="relative flex items-center gap-4 px-4 py-3 sm:px-6">
        {/* the sign */}
        <div className="shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">
            Road to
          </p>
          <p className="-mt-0.5 text-2xl font-black uppercase leading-none tracking-tight text-white sm:text-3xl">
            Activate
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/45">
            3 December 2026
          </p>
        </div>

        {/* the road */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`The road to Activate — ${days} days to go`}
          // WIDTH-DRIVEN, height follows (v33.55). Fixing the height instead
          // letterboxed it: a 6:1 drawing inside a 12:1 box centres itself and
          // leaves half the banner empty blue.
          className="min-w-0 flex-1"
          style={{ height: "auto", maxHeight: 112 }}
          preserveAspectRatio="xMidYMax meet"
        >
          <defs>
            <linearGradient id="rt-tarmac" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#39434f" />
              <stop offset="1" stopColor="#1a212b" />
            </linearGradient>
            <radialGradient id="rt-haze" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#9ec9ff" stopOpacity="0.55" />
              <stop offset="1" stopColor="#9ec9ff" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* the light at the end of it */}
          <ellipse cx={VX} cy={VY} rx="70" ry="26" fill="url(#rt-haze)" />

          {/* verges */}
          <path
            d={`M 0 ${NEAR_BOTTOM} L ${VX} ${VY} L ${VX} ${VY + 3} L 0 ${H} Z`}
            fill="#0b2f5e"
          />
          {/* the tarmac */}
          <path
            d={`M 0 ${NEAR_TOP} L ${VX} ${VY} L ${VX} ${VY} L 0 ${NEAR_BOTTOM} Z`}
            fill="url(#rt-tarmac)"
          />
          {/* kerb lines */}
          <path d={`M 0 ${NEAR_TOP + 3} L ${VX} ${VY}`} stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.5" fill="none" />
          <path d={`M 0 ${NEAR_BOTTOM - 3} L ${VX} ${VY}`} stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.5" fill="none" />
          {/* the centre line */}
          {dashes.map((d, i) => (
            <path key={i} d={d} fill="#ffd400" fillOpacity={0.92 - i * 0.05} />
          ))}
          {/* milestone posts — the ones behind us are lit */}
          {posts.map((p, i) => (
            <g key={i}>
              <line
                x1={p.x} y1={p.y} x2={p.x} y2={p.y - p.h}
                stroke={p.done ? "#ffd400" : "#ffffff"}
                strokeOpacity={p.done ? 0.9 : 0.3}
                strokeWidth="1.6"
              />
              <circle cx={p.x} cy={p.y - p.h} r={p.done ? 2.4 : 1.8} fill={p.done ? "#ffd400" : "#ffffff"} fillOpacity={p.done ? 1 : 0.35} />
            </g>
          ))}
          {/* the finish: a gate at the vanishing point */}
          <g>
            <line x1={VX - 16} y1={VY + 2} x2={VX - 16} y2={VY - 22} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.6" />
            <line x1={VX + 16} y1={VY + 2} x2={VX + 16} y2={VY - 22} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1.6" />
            <rect x={VX - 17} y={VY - 26} width="34" height="7" fill="#ffffff" fillOpacity="0.85" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <rect
                key={i}
                x={VX - 17 + i * 5.7}
                y={VY - 26 + (i % 2 ? 3.5 : 0)}
                width="5.7"
                height="3.5"
                fill="#0A2540"
                fillOpacity="0.85"
              />
            ))}
          </g>
          {/* the traveller */}
          <image
            href="/brand/walk.png"
            x={manX}
            y={manY}
            height={manH}
            style={{ filter: "drop-shadow(0 2px 5px rgba(0,0,0,.75))" }}
          />
        </svg>

        {/* the distance left */}
        <div className="shrink-0 text-right">
          <p className="text-xl font-black leading-none tabular-nums text-white sm:text-2xl">
            {line}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">
            {days === 0 ? "go get it 🏆" : "to go"}
          </p>
        </div>
      </div>
    </div>
  );
}
