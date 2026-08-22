"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FolderOpen } from "lucide-react";
import { InstagramIcon } from "./icons";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cairoToday } from "@/lib/types";
import { walkerBox } from "./walking-man";

/** 🏆 ROAD TO ACTIVATE (v33.57 — a road you walk ALONG; v33.58 — and one you
 *  can TAP to find out what you're walking towards).
 *
 *  Activate is the national conference the whole LC works towards, and the
 *  awards are decided by what this system already measures. The banner is the
 *  run up to it: a road seen from the side, the Violet Man walking it, month
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

/** The alpha bounds live in ONE place now (walking-man.tsx). This file used
 *  to keep its own copy measured from a single frame, which cut the walker's
 *  head on 4 of the 16 frames — see the note there. */
const walker = walkerBox;

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`);
const DAY_MS = 86_400_000;

export function daysToActivate(today = cairoToday()): number {
  const a = dayNum(ACTIVATE_DAY);
  const t = dayNum(today);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return 0;
  return Math.round((a - t) / DAY_MS);
}

export function roadProgress(today = cairoToday()): number {
  const start = dayNum(ROAD_START);
  const end = dayNum(ACTIVATE_DAY);
  const now = dayNum(today);
  if (!Number.isFinite(now) || end <= start) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/** HOW FAR IN WE ARE, IN DAYS (v33.58 — the ask was "he should get closer by
 *  days"). His x has always been the elapsed fraction, which IS a day-by-day
 *  advance — but at ~5px a day inside an 800-unit road, a step nobody can see
 *  reads as a picture that never moves. So the road now SAYS the day out loud
 *  (`Day 18 of 124`) and its verge posts are the real months of the run-up
 *  rather than four arbitrary quarters: passing "SEP" is a thing you notice. */
export function roadDays(today = cairoToday()): { day: number; total: number } {
  const start = dayNum(ROAD_START);
  const end = dayNum(ACTIVATE_DAY);
  const now = dayNum(today);
  const total = Math.max(1, Math.round((end - start) / DAY_MS));
  if (!Number.isFinite(now)) return { day: 0, total };
  const day = Math.min(total, Math.max(0, Math.round((now - start) / DAY_MS)));
  return { day, total };
}

/** The months between the start line and the conference, as road fractions —
 *  each one a post the LC walks past. Derived, never hand-placed, so the
 *  posts stay right whatever the two dates are. */
function monthPosts(): { label: string; at: number }[] {
  const start = dayNum(ROAD_START);
  const end = dayNum(ACTIVATE_DAY);
  if (!Number.isFinite(start) || end <= start) return [];
  const out: { label: string; at: number }[] = [];
  const d = new Date(start);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1); // the first month AFTER the start line
  while (d.getTime() < end) {
    const at = (d.getTime() - start) / (end - start);
    // A POST INSIDE THE GATE IS NOT A POST. The conference falls on the 3rd,
    // so its own month starts two days before the finish — measured at 0.984
    // of the road, which drew DEC's marker and label underneath the chequered
    // banner. Anything in the last 6% is the finish, and the finish already
    // has a marker.
    if (at <= 0.94)
      out.push({
        label: d.toLocaleString("en", { month: "short", timeZone: "UTC" }).toUpperCase(),
        at,
      });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
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

/** WHAT THE LC IS WALKING TOWARDS — the panel behind the banner (v33.58).
 *
 *  Half the floor has never been to an Activate and has no picture of it, so
 *  "3 December" is just a date on a blue bar. Everything here is aimed at one
 *  member reading it for the first time: what the conference IS, what is
 *  actually being handed out there, and the honest line between the two —
 *  that the awards go to the LC that delivered, and delivering is the work
 *  this system counts every day. The links are the LC's own: three years of
 *  the conference's Instagram, and the shared folder. */
const LINKS: { label: string; note: string; href: string; kind: "ig" | "drive" }[] = [
  {
    label: "@__activate25",
    note: "last year's Activate — the newest one to scroll",
    href: "https://www.instagram.com/__activate25/",
    kind: "ig",
  },
  {
    label: "@activate__24",
    note: "Activate '24",
    href: "https://www.instagram.com/activate__24/",
    kind: "ig",
  },
  {
    label: "@22_activate",
    note: "Activate '22",
    href: "https://www.instagram.com/22_activate/",
    kind: "ig",
  },
  {
    label: "The Activate folder",
    note: "photos, recaps and materials from the conferences",
    href: "https://drive.google.com/drive/folders/1MYHeFNWYYIFhgRrhzQl2sVwJQK_4MZMM",
    kind: "drive",
  },
];

function ActivateBrief({ days, day, total }: { days: number; day: number; total: number }) {
  return (
    <div className="grid gap-4 text-sm [overflow-wrap:anywhere]">
      <p>
        <b>Activate is AIESEC in Egypt&apos;s national conference.</b> Every LC in
        the country sends delegates to the same hall for a few days — sessions,
        the other LCs, the people you have only ever seen in a group chat — and
        it closes with the part everyone is really there for: <b>the awards</b>.
      </p>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
        <p className="font-semibold">🏆 The awards are handed out per aspect.</p>
        <p className="mt-1 text-muted-foreground">
          <b>Every function has its own award</b> — and it doesn&apos;t stop at
          the functions: there are awards for the LC as a whole, and others
          besides. Whatever you work on, there is something there to win.
        </p>
      </div>

      <p>
        And they are won <b>before</b> the conference, not at it. What gets read
        out on stage is what an LC actually delivered over the peak — the
        partners signed, the opens raised, the EPs approved, the people
        developed. That is the same work Sodio counts every single day: the
        contact you log, the visit you report, the deal you record, the sign-up
        you move to <b>Approved 🏆</b>.
      </p>

      <p className="rounded-lg bg-muted/60 p-3">
        So the honest version is short:{" "}
        <b>
          {days > 0
            ? `we have ${days} day${days === 1 ? "" : "s"} to build the case`
            : "today is the day"}
        </b>
        . Day {day} of {total} on the road above — the Violet Man moves one step
        along it every morning, whether or not the numbers moved with him. 💙
      </p>

      <div className="grid gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          See it for yourself
        </p>
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3 rounded-lg border p-2.5 transition-colors hover:border-primary/50 hover:bg-primary/5"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground group-hover:text-primary">
              {l.kind === "ig" ? (
                <InstagramIcon className="size-4" />
              ) : (
                <FolderOpen className="size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{l.label}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {l.note}
              </span>
            </span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </a>
        ))}
      </div>
    </div>
  );
}

export function ActivateStrip() {
  const [state, setState] = useState<{ days: number; progress: number; day: number; total: number } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const today = cairoToday();
    const { day, total } = roadDays(today);
    setState({ days: daysToActivate(today), progress: roadProgress(today), day, total });
  }, []);

  if (!state || state.days < 0) return null;
  const { days, progress, day, total } = state;
  const line = days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days} DAYS`;

  const manX = START_X + (FINISH_X - START_X - 40) * progress;
  const man = walker(manX, WALK_Y, 40);
  const posts = monthPosts();

  return (
    <>
      {/* THE WHOLE BANNER IS THE BUTTON (v33.58). A member who doesn't know
          what Activate is has no reason to hunt for a small "info" target —
          the thing they'd tap is the thing they don't understand, so that IS
          the control. A real <button> so it carries the keyboard and the
          screen-reader label; the countdown line doubles as the hint. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Road to Activate — ${days} days to go. What is Activate?`}
        className="activate-road group relative block w-full overflow-hidden rounded-xl border border-white/10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {/* justify-between matters on a PHONE: the road between these two blocks
            is hidden below sm, and both blocks are shrink-0, so without it they
            bunched at the left and left the right half of the banner empty. */}
        <div className="relative flex items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6">
          <div className="shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">
              Road to
            </p>
            <p className="-mt-0.5 text-2xl font-black uppercase leading-none tracking-tight text-white sm:text-3xl">
              Activate
            </p>
            <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/45 transition-colors group-hover:text-white/80">
              3 December 2026 · <span className="underline underline-offset-2">what&apos;s this?</span>
            </p>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`The road to Activate — day ${day} of ${total}`}
            // A ROAD NEEDS ROOM (v33.58). `flex-1` over a basis of 0 means the
            // drawing gets whatever the two text blocks leave — on a phone
            // that is about 100px, which compresses 800 units eightfold and
            // renders the walker as a five-pixel smudge. Below `sm` the
            // countdown says it in words instead, and the road returns the
            // moment there is road to draw.
            className="hidden min-w-0 flex-1 sm:block"
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
                <stop offset="0" stopColor="#7552CC" stopOpacity="0.42" />
                <stop offset="1" stopColor="#7552CC" stopOpacity="0.05" />
              </linearGradient>
              <radialGradient id="rt-shadow" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#000000" stopOpacity="0.45" />
                <stop offset="1" stopColor="#000000" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* the ground beyond the far kerb */}
            <rect x="0" y={FAR - 7} width={W} height="7" fill="#0d1e38" />
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
            {/* THE MONTHS OF THE RUN-UP — lit once they're behind him. A post
                that says SEP is a step you can actually feel being taken; the
                four unlabelled fractions this replaces could not be. */}
            {posts.map((p) => {
              const x = START_X + (FINISH_X - START_X) * p.at;
              const done = x <= manX;
              return (
                <g key={p.label}>
                  <rect x={x - 1} y={FAR - 13} width="2" height="13" fill="#ffffff" fillOpacity={done ? 0.75 : 0.28} />
                  <circle cx={x} cy={FAR - 15} r="2.6" fill={done ? "#A78BEA" : "#ffffff"} fillOpacity={done ? 1 : 0.35} />
                  <text
                    x={x}
                    y={FAR - 21}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="700"
                    letterSpacing="0.5"
                    fill="#ffffff"
                    fillOpacity={done ? 0.8 : 0.35}
                  >
                    {p.label}
                  </text>
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
            {/* THE DAY, SAID OUT LOUD (v33.58) — the walker advances by one
                day's worth of road every morning; this is the number that
                makes that advance readable instead of merely true. */}
            <p className="mt-0.5 text-[10px] font-medium tabular-nums text-white/40">
              day {day} of {total}
            </p>
          </div>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* p-6 on a 375px screen leaves the brief ~295px and it read as cut off;
            the padding relaxes on a phone and tightens back up from sm. */}
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-xl">🏆 What is Activate?</DialogTitle>
            <DialogDescription>
              The national conference this whole road leads to — 3 December 2026.
            </DialogDescription>
          </DialogHeader>
          <ActivateBrief days={days} day={day} total={total} />
        </DialogContent>
      </Dialog>
    </>
  );
}
