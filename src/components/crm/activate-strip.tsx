"use client";

import { useEffect, useState } from "react";
import { cairoToday } from "@/lib/types";

/** 🏆 ROAD TO ACTIVATE (v33.57 — a road you walk ALONG).
 *
 *  Activate is the national conference the whole LC works towards, and the
 *  awards are decided by what this system already measures. The banner is the
 *  run up to it: a road seen from the side, the Blue Man walking it, milestone
 *  posts along the verge and the finish line at the end. He stands where the
 *  LC stands — 1 August is the start line, 3 December the finish.
 *
 *  ── WHY THE FIRST TWO ATTEMPTS LOOKED WRONG ─────────────────────────────
 *  v33.55 drew the road in one-point perspective, which in a 12:1 strip reads
 *  as a WALL: a wedge you look at side-on rather than a surface you look
 *  along. A side view is the honest projection for a wide, short band.
 *
 *  And the walker floated because of the asset, not the layout. `walk.png` is
 *  a 356×200 APNG whose figure occupies only the middle fifth of the canvas
 *  (x 39.3%–59.6%, y 17.0%–83.5%) — the rest is transparent room for the walk
 *  cycle. Positioning the IMAGE put the canvas where the person should be, so
 *  he sat high and to the left of his own feet. The three constants below are
 *  measured from the file's alpha channel, and every placement goes through
 *  them: `figure` height, `centre` x, `feet` y. */
export const ACTIVATE_DAY = "2026-12-03";
const ROAD_START = "2026-08-01";

/** measured from walk.png's alpha channel — see the note above */
const ART = { aspect: 356 / 200, left: 0.393, right: 0.596, top: 0.17, bottom: 0.835 };
const ART_H = ART.bottom - ART.top; // 0.665 of the canvas is actual person
const ART_CX = (ART.left + ART.right) / 2; // 0.494 of the canvas width

/** Canvas box that puts a figure of `figH` with its feet at (cx, feetY). */
function walker(cx: number, feetY: number, figH: number) {
  const h = figH / ART_H;
  const w = h * ART.aspect;
  return { x: cx - w * ART_CX, y: feetY - h * ART.bottom, width: w, height: h };
}

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function daysToActivate(today = cairoToday()): number {
  const a = dayNum(ACTIVATE_DAY);
  const t = dayNum(today);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return 0;
  return Math.round((a - t) / 86_400_000);
}

export function roadProgress(today = cairoToday()): number {
  const start = dayNum(ROAD_START);
  const end = dayNum(ACTIVATE_DAY);
  const now = dayNum(today);
  if (!Number.isFinite(now) || end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

// ---- the road, in the SVG's own units ------------------------------------
// A LONG, LOW BOX ON PURPOSE (v33.57). With `meet`, any viewBox NARROWER in
// aspect than its container gets letterboxed — which is what left blue gutters
// either side of the road. At ~9:1 the drawing is always width-limited, so it
// fills the banner edge to edge and the height simply follows. The RATIO is
// therefore the banner's height: 800:112 puts a ~98px band under a ~700px
// slot, which is enough road for the walker to have presence on. No max
// height — a cap re-creates the gutters it was meant to avoid.
const W = 800;
const H = 112;
const FAR = 66; // the far kerb
const NEAR = 104; // the near kerb — the edge closest to the viewer
const LANE = (FAR + NEAR) / 2; // the centre line
/** where feet land: on the near half of the tarmac, so the road is UNDER him */
const WALK_Y = NEAR - 5;
const START_X = 30;
const FINISH_X = 726;

export function ActivateStrip() {
  const [state, setState] = useState<{ days: number; progress: number } | null>(null);
  useEffect(() => {
    const today = cairoToday();
    setState({ days: daysToActivate(today), progress: roadProgress(today) });
  }, []);

  if (!state || state.days < 0) return null;
  const { days, progress } = state;
  const line = days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days} DAYS`;

  const manX = START_X + (FINISH_X - START_X - 40) * progress;
  const man = walker(manX, WALK_Y, 40);
  const posts = [0.2, 0.4, 0.6, 0.8];

  return (
    <div className="activate-road relative overflow-hidden rounded-xl border border-white/10">
      <div className="relative flex items-center gap-4 px-4 py-3 sm:px-6">
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

        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`The road to Activate — ${days} days to go`}
          className="min-w-0 flex-1"
          style={{ height: "auto" }}
          preserveAspectRatio="xMidYMax meet"
        >
          <defs>
            <linearGradient id="rt-road" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4a5563" />
              <stop offset="0.35" stopColor="#333d49" />
              <stop offset="1" stopColor="#222a34" />
            </linearGradient>
            <linearGradient id="rt-done" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffd400" stopOpacity="0.18" />
              <stop offset="1" stopColor="#ffd400" stopOpacity="0.02" />
            </linearGradient>
            <radialGradient id="rt-shadow" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#000000" stopOpacity="0.45" />
              <stop offset="1" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* the ground beyond the far kerb */}
          <rect x="0" y={FAR - 7} width={W} height="7" fill="#0b2f5e" />
          {/* the tarmac */}
          <rect x="0" y={FAR} width={W} height={NEAR - FAR} fill="url(#rt-road)" />
          {/* the stretch already walked, warmed up */}
          <rect x="0" y={FAR} width={manX} height={NEAR - FAR} fill="url(#rt-done)" />
          {/* kerbs */}
          <rect x="0" y={FAR} width={W} height="1.6" fill="#ffffff" fillOpacity="0.4" />
          <rect x="0" y={NEAR - 1.6} width={W} height="1.6" fill="#ffffff" fillOpacity="0.25" />
          {/* the centre line */}
          {Array.from({ length: 17 }, (_, i) => (
            <rect
              key={i}
              x={10 + i * 47}
              y={LANE - 1.5}
              width="26"
              height="3"
              rx="1.5"
              fill="#ffd400"
              fillOpacity="0.85"
            />
          ))}
          {/* verge posts — lit once they're behind him */}
          {posts.map((p) => {
            const x = START_X + (FINISH_X - START_X) * p;
            const done = x <= manX;
            return (
              <g key={p}>
                <rect x={x - 1} y={FAR - 13} width="2" height="13" fill="#ffffff" fillOpacity={done ? 0.75 : 0.28} />
                <circle cx={x} cy={FAR - 15} r="2.6" fill={done ? "#ffd400" : "#ffffff"} fillOpacity={done ? 1 : 0.35} />
              </g>
            );
          })}

          {/* the finish: two posts and a chequered banner, standing ON the road */}
          <g>
            <rect x={FINISH_X - 1.5} y={FAR - 26} width="3" height={NEAR - FAR + 26} fill="#ffffff" fillOpacity="0.75" />
            <rect x={FINISH_X + 40} y={FAR - 26} width="3" height={NEAR - FAR + 26} fill="#ffffff" fillOpacity="0.55" />
            {Array.from({ length: 8 }, (_, i) => (
              <rect
                key={i}
                x={FINISH_X + (i % 4) * 11}
                y={FAR - 26 + (i < 4 ? 0 : 6)}
                width="11"
                height="6"
                fill={(i + (i < 4 ? 0 : 1)) % 2 ? "#0A2540" : "#ffffff"}
                fillOpacity="0.92"
              />
            ))}
          </g>

          {/* his shadow, then him — feet on the tarmac */}
          <ellipse cx={manX} cy={WALK_Y + 1} rx="15" ry="3.6" fill="url(#rt-shadow)" />
          <image
            href="/brand/walk.png"
            x={man.x}
            y={man.y}
            width={man.width}
            height={man.height}
            preserveAspectRatio="xMidYMid meet"
          />
        </svg>

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
