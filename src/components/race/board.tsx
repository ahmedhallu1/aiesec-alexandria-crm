"use client";

import "./race.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SodioMark } from "@/components/crm/sodio-mark";
import { useNow } from "@/components/no-peace/bits";
import { cairoInstant } from "@/lib/war/model";
import {
  PROGRAMS, pace, raceClock, racePhase, splitDuration,
  type LaneState, type PublicRaceSide, type RaceFeedItem, type RaceSnapshot, type Side,
} from "@/lib/race/model";
import { useRaceLive, type LiveState } from "./live";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const DAY = 86_400_000;

const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Cairo" }).format(new Date(ms));
const fmtDateTime = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hourCycle: "h12", timeZone: "Africa/Cairo" }).format(new Date(ms));
const pad = (n: number) => String(n).padStart(2, "0");

function ago(iso: string | null, now: number | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!now) return fmtDateTime(t);
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return fmtDate(t);
}

/** /alex-vs-must (v38.5) — AIESEC in Alexandria vs AIESEC in MUST, the race to
 *  150 approvals. Public, read-only, live (live.ts). The story runs down the
 *  page: the loader (itself a tiny race), the hero clock, the main track — on a
 *  desktop the scroll itself drives both LCs from zero to where they are — the
 *  programs behind the numbers, the slots race, the trail, the 300 they make
 *  together, the latest moves. Every number is from CORE (approvals) or Sodio
 *  and MUST's desk (slots); every word is edited in Sodio's "Alex vs MUST". */
export function RaceBoard({ initial, realtime }: { initial: RaceSnapshot; realtime: { url: string; key: string } | null }) {
  const { snap, state } = useRaceLive(initial, realtime);
  const now = useNow(1000);
  const s = snap.settings;
  const clock = useMemo(() => raceClock(s), [s]);
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // the reveal states only exist once JS runs — no script, no hidden content
  useEffect(() => {
    root.current?.classList.add("is-js");
  }, []);

  useIso(() => {
    if (!ready || reduced()) return;
    const ctx = gsap.context(() => {
      ScrollTrigger.batch("[data-reveal]", {
        start: "top 88%",
        once: true,
        onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.08, overwrite: true }),
      });
    }, root);
    const t = setTimeout(() => ScrollTrigger.refresh(), 300);
    return () => {
      clearTimeout(t);
      ctx.revert();
    };
  }, [ready]);

  const style = { "--home": s.home.color, "--rival": s.rival.color } as React.CSSProperties;
  const lead = snap.approvals;
  const leader = lead.leader ? s[lead.leader] : null;

  return (
    <div ref={root} className="rc" style={style}>
      <Loader home={s.home} rival={s.rival} onDone={() => setReady(true)} />
      <Cursor />
      <TopBar snap={snap} state={state} now={now} />

      <main>
        <Hero snap={snap} now={now} ready={ready} />
        <MainTrack snap={snap} now={now} />
        {s.show.programs ? <Programs snap={snap} /> : null}
        {s.show.slots ? <SlotsRace snap={snap} now={now} /> : null}
        {s.show.trail && snap.trail.length > 1 ? <Trail snap={snap} now={now} /> : null}
        {s.show.together ? <Together snap={snap} /> : null}
        {s.show.feed ? <Wire feed={snap.feed} now={now} sides={s} state={state} /> : null}
        <Finale text={s.finale} />
      </main>

      <footer className="rc-foot">
        <div className="rc-wrap rc-foot-in">
          <p className="rc-foot-src">
            Approvals: CORE (core.aiesec.org.eg), counted from each LC&apos;s total on {fmtDate(clock.start)} · Slots:
            Sodio (Alexandria) and MUST&apos;s own desk · Updates live.
          </p>
          <div className="rc-credit">
            <span className="rc-credit-sodio">
              <SodioMark px={20} tone="tile" /> Powered by Sodio
            </span>
            <a href="http://elevate2point0.com/" target="_blank" rel="noreferrer" data-cursor="link" data-cursor-label="2.0">
              Made by
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/no-peace/two-point-o-18.png"
                srcSet="/brand/no-peace/two-point-o-18.png 1x, /brand/no-peace/two-point-o-36.png 2x, /brand/no-peace/two-point-o-54.png 3x"
                alt="2.0"
                width={37}
                height={18}
              />
            </a>
          </div>
        </div>
      </footer>
      <p className="rc-sr" role="status" aria-live="polite">
        {leader ? `${leader.name} leads by ${Math.abs(lead.home.value - lead.rival.value)} approvals.` : "The race is level."}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ loader

/** The loader is a race of its own: two lanes in the LCs' colours load to
 *  100% at their own pace, the first one there lights "GO", and the screen
 *  splits open. Short on a second visit this session; skipped with reduced
 *  motion. Without JS a CSS timer clears it, so nobody is ever stuck behind it. */
function Loader({ home, rival, onDone }: { home: PublicRaceSide; rival: PublicRaceSide; onDone: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useIso(() => {
    const node = el.current;
    if (!node) return;
    node.classList.add("is-driven");
    const finish = () => {
      setGone(true);
      done.current();
    };
    if (reduced()) {
      finish();
      return;
    }
    let seen = false;
    try {
      seen = sessionStorage.getItem("rc-loaded") === "1";
      sessionStorage.setItem("rc-loaded", "1");
    } catch {
      /* private mode: always the full show */
    }
    const speed = seen ? 0.45 : 1;
    const q = gsap.utils.selector(node);
    const h = { v: 0 };
    const r = { v: 0 };
    const paint = () => {
      node.style.setProperty("--lh", String(h.v / 100));
      node.style.setProperty("--lr", String(r.v / 100));
      const [a, b] = q("[data-ld]");
      if (a) a.textContent = pad(Math.round(h.v));
      if (b) b.textContent = pad(Math.round(r.v));
    };
    // two different curves, so the lead changes hands on the way
    const first = Math.random() < 0.5;
    const tl = gsap.timeline({ onComplete: finish });
    // fromTo, never from(): a from() killed half-way (dev's double effect)
    // would leave the next run animating from its stranded start
    tl.fromTo(q(".rc-ld-mark"), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5 * speed, ease: "back.out(2)" })
      .to(h, { v: 100, duration: (first ? 1.25 : 1.45) * speed, ease: first ? "power1.in" : "power3.out", onUpdate: paint }, "<0.1")
      .to(r, { v: 100, duration: (first ? 1.45 : 1.25) * speed, ease: first ? "power3.out" : "power1.in", onUpdate: paint }, "<")
      .to(q(".rc-ld-go"), { opacity: 1, scale: 1, duration: 0.25 * speed, ease: "back.out(3)" }, ">-0.05")
      .to(q(".rc-ld-top"), { yPercent: -100, duration: 0.7 * speed, ease: "expo.inOut" }, ">0.15")
      .to(q(".rc-ld-bottom"), { yPercent: 100, duration: 0.7 * speed, ease: "expo.inOut" }, "<")
      .to(q(".rc-ld-core"), { opacity: 0, scale: 1.4, duration: 0.45 * speed, ease: "power2.in" }, "<");
    const skip = () => tl.progress(1);
    node.addEventListener("click", skip);
    return () => {
      node.removeEventListener("click", skip);
      tl.kill();
    };
  }, []);

  if (gone) return null;
  return (
    <div ref={el} className="rc-loader" aria-hidden>
      <div className="rc-ld-top" />
      <div className="rc-ld-bottom" />
      <div className="rc-ld-core">
        <div className="rc-ld-mark">
          <SodioMark px={56} tone="tile" />
        </div>
        <div className="rc-ld-lanes">
          <div className="rc-ld-lane" style={{ "--c": home.color } as React.CSSProperties}>
            <span>{home.short}</span>
            <em>
              <i style={{ transform: "scaleX(var(--lh, 0))" }} />
            </em>
            <b data-ld>00</b>
          </div>
          <div className="rc-ld-lane" style={{ "--c": rival.color } as React.CSSProperties}>
            <span>{rival.short}</span>
            <em>
              <i style={{ transform: "scaleX(var(--lr, 0))" }} />
            </em>
            <b data-ld>00</b>
          </div>
        </div>
        <p className="rc-ld-go">GO</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ cursor

/** A dot that sticks to the pointer and a ring that follows it a beat later.
 *  Over a lane the ring takes that LC's colour and name; over a link it opens
 *  up. Mouse and trackpad only — never on touch, never with reduced motion. */
function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || reduced()) return;
    const d = dot.current;
    const r = ring.current;
    if (!d || !r) return;
    document.documentElement.classList.add("rc-cursor-on");
    const dx = gsap.quickTo(d, "x", { duration: 0.08, ease: "power3" });
    const dy = gsap.quickTo(d, "y", { duration: 0.08, ease: "power3" });
    const rx = gsap.quickTo(r, "x", { duration: 0.42, ease: "power3" });
    const ry = gsap.quickTo(r, "y", { duration: 0.42, ease: "power3" });
    let shown = false;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (!shown) {
        shown = true;
        gsap.set([d, r], { x: e.clientX, y: e.clientY });
        gsap.to([d, r], { opacity: 1, duration: 0.2 });
      }
      dx(e.clientX);
      dy(e.clientY);
      rx(e.clientX);
      ry(e.clientY);
      document.documentElement.style.setProperty("--rc-mx", `${e.clientX}px`);
      document.documentElement.style.setProperty("--rc-my", `${e.clientY}px`);
    };
    const over = (e: PointerEvent) => {
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-cursor]");
      const mode = t?.dataset.cursor ?? "";
      r.dataset.mode = mode;
      if (label.current) label.current.textContent = t?.dataset.cursorLabel ?? "";
    };
    const down = () => gsap.to(r, { scale: 0.8, duration: 0.15 });
    const up = () => gsap.to(r, { scale: 1, duration: 0.3, ease: "back.out(3)" });
    const leave = () => {
      shown = false;
      gsap.to([d, r], { opacity: 0, duration: 0.2 });
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerover", over, { passive: true });
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    document.addEventListener("pointerleave", leave);
    return () => {
      document.documentElement.classList.remove("rc-cursor-on");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <>
      <div ref={ring} className="rc-cursor-ring" aria-hidden>
        <span ref={label} />
      </div>
      <div ref={dot} className="rc-cursor-dot" aria-hidden />
    </>
  );
}

// ------------------------------------------------------------------ top bar

function TopBar({ snap, state, now }: { snap: RaceSnapshot; state: LiveState; now: number | null }) {
  const s = snap.settings;
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const left = now ? Math.max(0, raceClock(s).deadline - now) : null;
  const d = left !== null ? splitDuration(left) : null;
  return (
    <header className={`rc-top ${solid ? "is-solid" : ""}`}>
      <div className="rc-wrap rc-top-in">
        <a href="#top" className="rc-brand" data-cursor="link" data-cursor-label="TOP">
          <SodioMark px={28} tone="tile" />
          <span>
            {s.home.short} <em>×</em> {s.rival.short}
          </span>
        </a>
        <div className="rc-score" aria-label={`${s.home.name} ${snap.approvals.home.value}, ${s.rival.name} ${snap.approvals.rival.value}`}>
          <b style={{ color: "var(--home)" }}>{snap.approvals.home.value}</b>
          <span>—</span>
          <b style={{ color: "var(--rival)" }}>{snap.approvals.rival.value}</b>
        </div>
        <nav className="rc-nav" aria-label="Sections">
          <a href="#race" data-cursor="link" data-cursor-label="GO">Race</a>
          {s.show.slots ? <a href="#slots" data-cursor="link" data-cursor-label="GO">Slots</a> : null}
          {s.show.trail ? <a href="#trail" data-cursor="link" data-cursor-label="GO">Trail</a> : null}
          {s.show.feed ? <a href="#moves" data-cursor="link" data-cursor-label="GO">Moves</a> : null}
        </nav>
        <div className="rc-top-right">
          {d ? (
            <span className="rc-mini-clock">
              {d.d}d {pad(d.h)}:{pad(d.m)}
            </span>
          ) : null}
          <span className={`rc-live is-${state}`}>
            <i /> {state === "live" ? "Live" : state === "connecting" ? "…" : "Auto"}
          </span>
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ hero

function SplitText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className} aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} className="rc-ch" aria-hidden>
          <span>{ch === " " ? " " : ch}</span>
        </span>
      ))}
    </span>
  );
}

function Hero({ snap, now, ready }: { snap: RaceSnapshot; now: number | null; ready: boolean }) {
  const s = snap.settings;
  const clock = raceClock(s);
  const phase = now ? racePhase(clock, now) : "live";
  const el = useRef<HTMLElement>(null);
  const m = s.title.match(/^(.*?)(\d+)\s*$/);
  const words = m ? m[1].trim() : s.title;
  const big = m ? m[2] : "";
  const left = now ? splitDuration(Math.max(0, (phase === "before" ? clock.start : clock.deadline) - now)) : null;
  const a = snap.approvals;
  const winner = a.winner ? s[a.winner] : null;

  useIso(() => {
    if (!ready || !el.current) return;
    if (reduced()) return;
    const q = gsap.utils.selector(el.current);
    const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
    tl.from(q(".rc-eyebrow"), { y: 20, opacity: 0, duration: 0.8 })
      .from(q(".rc-ch > span"), { yPercent: 110, duration: 1.1, stagger: 0.035 }, "<0.05")
      .from(q(".rc-hero-big"), { scale: 0.85, opacity: 0, duration: 1.4 }, "<0.25")
      .from(q(".rc-vs-side"), { y: 40, opacity: 0, duration: 1, stagger: 0.12 }, "<0.3")
      .from(q(".rc-clock > div"), { y: 24, opacity: 0, duration: 0.8, stagger: 0.06 }, "<0.2")
      .from(q(".rc-cue"), { opacity: 0, duration: 0.8 }, "<0.4");
    // count the two scores up from zero
    for (const side of ["home", "rival"] as Side[]) {
      const n = q(`[data-hero-num="${side}"]`)[0];
      if (!n) continue;
      const o = { v: 0 };
      tl.to(o, { v: a[side].value, duration: 1.6, ease: "power2.out", onUpdate: () => {
        n.textContent = String(Math.round(o.v));
      } }, 0.6);
    }
    // the floor and the giant number drift as you scroll away
    gsap.to(q(".rc-hero-big"), { yPercent: 30, opacity: 0.2, ease: "none", scrollTrigger: { trigger: el.current, start: "top top", end: "bottom top", scrub: true } });
    gsap.to(q(".rc-hero-copy"), { yPercent: -18, ease: "none", scrollTrigger: { trigger: el.current, start: "top top", end: "bottom top", scrub: true } });
    return () => {
      tl.kill();
      ScrollTrigger.getAll().filter((t) => t.trigger === el.current).forEach((t) => t.kill());
    };
    // the entrance plays once; later pushes move the numbers through React
  }, [ready]);

  return (
    <section ref={el} className="rc-hero" id="top">
      <div className="rc-floor" aria-hidden>
        <i className="rc-beam rc-beam-home" />
        <i className="rc-beam rc-beam-rival" />
      </div>
      <div className="rc-spot" aria-hidden />
      <div className="rc-hero-big" aria-hidden>
        {big || s.approvalsGoal}
      </div>
      <div className="rc-wrap rc-hero-copy">
        <p className="rc-eyebrow">
          AIESEC in {s.home.name} <em>×</em> AIESEC in {s.rival.name}
        </p>
        <h1 className="rc-title">
          <SplitText text={words || s.title} />
          {big ? <SplitText text={big} className="rc-title-num" /> : null}
        </h1>
        {s.tagline ? <p className="rc-tagline">{s.tagline}</p> : null}

        <div className="rc-vs">
          {(["home", "rival"] as Side[]).map((side, i) => (
            <div key={side} className={`rc-vs-side is-${side}`} data-cursor={side} data-cursor-label={s[side].short}>
              <span className="rc-vs-name">{s[side].name}</span>
              <b className="rc-vs-num" data-hero-num={side}>
                {a[side].value}
              </b>
              <span className="rc-vs-of">of {a[side].goal} approvals</span>
              {i === 0 ? <span className="rc-vs-x" aria-hidden>VS</span> : null}
            </div>
          ))}
        </div>

        {winner ? (
          <p className="rc-winner" style={{ "--c": winner.color } as React.CSSProperties}>
            <span>🏁</span> {winner.name} hit {s.approvalsGoal} first
            {a[a.winner!].reachedAt ? ` · ${fmtDateTime(Date.parse(a[a.winner!].reachedAt!))}` : ""}
          </p>
        ) : null}

        <div className="rc-clock-wrap">
          <p className="rc-clock-label">
            {phase === "over"
              ? "The line has closed — the board is final"
              : phase === "before"
                ? `Starts ${fmtDate(clock.start)}`
                : `Line closes ${fmtDateTime(clock.deadline)} · Cairo`}
          </p>
          {phase !== "over" ? (
            <div className="rc-clock" role="timer">
              {(["d", "h", "m", "s"] as const).map((k) => (
                <div key={k}>
                  <b>{left ? (k === "d" ? left.d : pad(left[k])) : "--"}</b>
                  <span>{k === "d" ? "days" : k === "h" ? "hours" : k === "m" ? "min" : "sec"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <a href="#race" className="rc-cue" data-cursor="link" data-cursor-label="GO">
        <span>Scroll to race</span>
        <i />
      </a>
    </section>
  );
}

// ------------------------------------------------------------------ the tracks

const TICKS = 6;

/** One lane: a loading bar with moving stripes, a glowing head at the tip
 *  and the chequered line at the goal. Its progress is the CSS var --p (0–1),
 *  set by the track that owns it — so a scroll scrub and a live tween can
 *  both drive it without React re-rendering 60 times a second. */
function Lane({
  side, info, lane, now, clock, unit, bind, todayDelta,
}: {
  side: Side;
  info: PublicRaceSide;
  lane: LaneState;
  now: number | null;
  clock: ReturnType<typeof raceClock>;
  unit: string;
  bind: (side: Side, el: HTMLDivElement | null) => void;
  todayDelta: number | null;
}) {
  const p = now ? pace(lane, clock, now) : null;
  const done = lane.value >= lane.goal;
  return (
    <div
      ref={(n) => bind(side, n)}
      className={`rc-lane is-${side} ${done ? "is-done" : ""}`}
      style={{ "--c": `var(--${side})` } as React.CSSProperties}
      data-cursor={side}
      data-cursor-label={info.short}
    >
      <div className="rc-lane-head">
        <span className="rc-tag">{info.short}</span>
        <b className="rc-lane-name">{info.name}</b>
        <span className="rc-lane-count">
          <b data-num>{lane.value}</b>
          <small>/{lane.goal}</small>
        </span>
      </div>
      <div
        className="rc-bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={lane.goal}
        aria-valuenow={lane.value}
        aria-label={`${info.name}: ${lane.value} of ${lane.goal} ${unit}`}
      >
        <div className="rc-ticks" aria-hidden>
          {Array.from({ length: TICKS - 1 }, (_, i) => (
            <i key={i} style={{ left: `${((i + 1) / TICKS) * 100}%` }}>
              <span>{Math.round(((i + 1) / TICKS) * lane.goal)}</span>
            </i>
          ))}
        </div>
        <div className="rc-fill">
          <i />
        </div>
        <div className="rc-head" aria-hidden>
          <span />
        </div>
        <div className="rc-finish" aria-hidden />
      </div>
      <p className="rc-lane-meta">
        {done && lane.reachedAt ? (
          <span className="rc-done">🏁 Reached {lane.goal} · {fmtDateTime(Date.parse(lane.reachedAt))}</span>
        ) : (
          <>
            {todayDelta ? <span className="rc-up">+{todayDelta} today</span> : null}
            <span>{lane.goal - lane.value} to go</span>
            {p && p.perDay > 0 ? <span>{p.perDay.toFixed(1)}/day</span> : null}
            {p && p.needPerDay !== null && p.needPerDay > 0 ? <span>needs {p.needPerDay.toFixed(1)}/day</span> : null}
            {p?.eta && p.eta <= clock.deadline ? <span className="rc-eta">at this pace: {fmtDate(p.eta)}</span> : null}
          </>
        )}
      </p>
    </div>
  );
}

/** Two lanes and the scroll that runs them. On a desktop the section pins and
 *  scrolling drives both LCs from zero to where they stand ("the scroll is
 *  the race"); on a phone they run once as the section comes into view. A
 *  live push glides the numbers to their new place. */
function useTrack(values: Record<Side, number>, goal: number, opts: { pin: boolean }) {
  const section = useRef<HTMLElement>(null);
  const lanes = useRef<Record<Side, HTMLDivElement | null>>({ home: null, rival: null });
  const st = useRef({ run: 0, home: values.home, rival: values.rival });
  const mounted = useRef(false);
  const goalRef = useRef(goal);
  useIso(() => {
    goalRef.current = goal;
  });

  const render = useCallback(() => {
    for (const side of ["home", "rival"] as Side[]) {
      const el = lanes.current[side];
      if (!el) continue;
      const v = st.current[side] * st.current.run;
      el.style.setProperty("--p", String(clamp01(v / goalRef.current)));
      const n = el.querySelector<HTMLElement>("[data-num]");
      if (n) n.textContent = String(Math.round(v));
    }
  }, []);

  const bind = useCallback(
    (side: Side, el: HTMLDivElement | null) => {
      lanes.current[side] = el;
      if (el) render();
    },
    [render]
  );

  useIso(() => {
    const sec = section.current;
    if (!sec) return;
    const mm = gsap.matchMedia();
    mm.add(
      {
        pin: "(min-width: 900px) and (prefers-reduced-motion: no-preference)",
        once: "(max-width: 899px) and (prefers-reduced-motion: no-preference)",
        still: "(prefers-reduced-motion: reduce)",
      },
      (ctx) => {
        const c = ctx.conditions as { pin: boolean; once: boolean; still: boolean };
        if (c.still) {
          st.current.run = 1;
          render();
          return;
        }
        st.current.run = 0;
        render();
        if (c.pin && opts.pin) {
          gsap.to(st.current, {
            run: 1,
            ease: "none",
            onUpdate: render,
            scrollTrigger: { trigger: sec, start: "top top", end: "+=80%", pin: true, scrub: 0.7, anticipatePin: 1 },
          });
        } else {
          gsap.to(st.current, {
            run: 1,
            duration: 2.2,
            ease: "power2.out",
            onUpdate: render,
            scrollTrigger: { trigger: sec, start: "top 78%", once: true },
          });
        }
      }
    );
    return () => mm.revert();
  }, [render, opts.pin]);

  // a live push: glide to the new numbers
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const tw = gsap.to(st.current, { home: values.home, rival: values.rival, duration: reduced() ? 0 : 1.4, ease: "power3.out", onUpdate: render });
    for (const side of ["home", "rival"] as Side[]) {
      const el = lanes.current[side];
      if (el && !reduced()) gsap.fromTo(el, { "--flash": 1 }, { "--flash": 0, duration: 1.6, ease: "power2.out" });
    }
    return () => {
      tw.kill();
    };
  }, [values.home, values.rival, render]);

  useEffect(() => {
    render();
  }, [goal, render]);

  return { section, bind };
}

/** "+N today": the lane's value now minus where it stood at the start of
 *  today (Cairo), from the trail. */
function todayDeltas(snap: RaceSnapshot, now: number | null): Record<Side, number | null> {
  if (!now || snap.trail.length < 2) return { home: null, rival: null };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const since = cairoInstant(today);
  let before = snap.trail[0];
  for (const t of snap.trail) if (Date.parse(t.at) < since) before = t;
  return {
    home: Math.max(0, snap.approvals.home.value - before.home) || null,
    rival: Math.max(0, snap.approvals.rival.value - before.rival) || null,
  };
}

function Verdict({ snap, metric }: { snap: RaceSnapshot; metric: "approvals" | "slots" }) {
  const s = snap.settings;
  const m = snap[metric];
  const gap = Math.abs(m.home.value - m.rival.value);
  if (m.winner)
    return (
      <p className="rc-verdict is-win" style={{ "--c": `var(--${m.winner})` } as React.CSSProperties}>
        🏁 <b>{s[m.winner].name}</b> got there first
      </p>
    );
  if (!m.leader) return <p className="rc-verdict">Dead level{m.home.value ? ` at ${m.home.value}` : ""} — the next one takes the lead</p>;
  return (
    <p className="rc-verdict" style={{ "--c": `var(--${m.leader})` } as React.CSSProperties}>
      <b>{s[m.leader].short}</b> leads by <b>{gap}</b>
    </p>
  );
}

function MainTrack({ snap, now }: { snap: RaceSnapshot; now: number | null }) {
  const s = snap.settings;
  const clock = raceClock(s);
  const a = snap.approvals;
  const { section, bind } = useTrack({ home: a.home.value, rival: a.rival.value }, s.approvalsGoal, { pin: true });
  const today = todayDeltas(snap, now);
  const readAt = [a.home.readAt, a.rival.readAt].filter(Boolean).sort().pop() ?? null;
  return (
    <section ref={section} className="rc-track" id="race" aria-labelledby="rc-race-h">
      <div className="rc-wrap">
        <div className="rc-sec-head">
          <p className="rc-kicker">01 · Approvals</p>
          <h2 id="rc-race-h" className="rc-h2">
            First to <span className="rc-grad">{s.approvalsGoal}</span> wins
          </h2>
          <p className="rc-sub">
            Approvals since {fmtDate(clock.start)}, straight from CORE · last read {ago(readAt, now)}
          </p>
        </div>
        <div className="rc-lanes">
          <Lane side="home" info={s.home} lane={a.home} now={now} clock={clock} unit="approvals" bind={bind} todayDelta={today.home} />
          <Verdict snap={snap} metric="approvals" />
          <Lane side="rival" info={s.rival} lane={a.rival} now={now} clock={clock} unit="approvals" bind={bind} todayDelta={today.rival} />
        </div>
      </div>
    </section>
  );
}

function SlotsRace({ snap, now }: { snap: RaceSnapshot; now: number | null }) {
  const s = snap.settings;
  const clock = raceClock(s);
  const sl = snap.slots;
  const { section, bind } = useTrack({ home: sl.home.value, rival: sl.rival.value }, s.slotsGoal, { pin: false });
  return (
    <section ref={section} className="rc-track rc-track-slots" id="slots" aria-labelledby="rc-slots-h">
      <div className="rc-wrap">
        <div className="rc-sec-head" data-reveal>
          <p className="rc-kicker">03 · Slots</p>
          <h2 id="rc-slots-h" className="rc-h2">
            The race to <span className="rc-grad">{s.slotsGoal}</span> slots
          </h2>
          <p className="rc-sub">
            {s.home.name} counts its deals in Sodio · {s.rival.name} logs its own
          </p>
        </div>
        <div className="rc-lanes">
          <Lane side="home" info={s.home} lane={sl.home} now={now} clock={clock} unit="slots" bind={bind} todayDelta={null} />
          <Verdict snap={snap} metric="slots" />
          <Lane side="rival" info={s.rival} lane={sl.rival} now={now} clock={clock} unit="slots" bind={bind} todayDelta={null} />
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ programs

function Programs({ snap }: { snap: RaceSnapshot }) {
  const s = snap.settings;
  const a = snap.approvals;
  const max = Math.max(1, ...PROGRAMS.flatMap((p) => [a.home.byProgram[p], a.rival.byProgram[p]]));
  return (
    <section className="rc-programs" id="programs" aria-labelledby="rc-prog-h">
      <div className="rc-wrap">
        <div className="rc-sec-head" data-reveal>
          <p className="rc-kicker">02 · Behind the numbers</p>
          <h2 id="rc-prog-h" className="rc-h2">Where the approvals come from</h2>
          <p className="rc-sub">Since the start, per program</p>
        </div>
        <div className="rc-prog-grid">
          {PROGRAMS.map((p) => {
            const h = a.home.byProgram[p];
            const r = a.rival.byProgram[p];
            return (
              <div key={p} className="rc-prog" data-reveal>
                <p className="rc-prog-name">
                  <span className={p.startsWith("i") ? "is-in" : "is-out"}>{p.startsWith("i") ? "ICX" : "OGX"}</span> {p}
                </p>
                {(["home", "rival"] as Side[]).map((side) => {
                  const v = side === "home" ? h : r;
                  return (
                    <div key={side} className="rc-prog-row" data-cursor={side} data-cursor-label={s[side].short}>
                      <span>{s[side].short}</span>
                      <i>
                        <b style={{ width: `${(v / max) * 100}%`, background: `var(--${side})` }} />
                      </i>
                      <em>{v}</em>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ trail

function Trail({ snap, now }: { snap: RaceSnapshot; now: number | null }) {
  const s = snap.settings;
  const clock = raceClock(s);
  const el = useRef<HTMLElement>(null);
  const W = 1000;
  const H = 340;
  const pl = 44;
  const pr = 24;
  const pt = 24;
  const pb = 34;
  const span = Math.max(1, clock.deadline - clock.start);
  const nowMs = Math.min(now ?? Date.parse(snap.at), clock.deadline);
  const a = snap.approvals;
  const projH = pace(a.home, clock, nowMs);
  const projR = pace(a.rival, clock, nowMs);
  const daysLeft = Math.max(0, clock.deadline - nowMs) / DAY;
  const endH = a.home.value + projH.perDay * daysLeft;
  const endR = a.rival.value + projR.perDay * daysLeft;
  const top = Math.max(s.approvalsGoal, ...snap.trail.map((t) => Math.max(t.home, t.rival)), Math.min(endH, s.approvalsGoal * 1.5), Math.min(endR, s.approvalsGoal * 1.5)) * 1.08;
  const x = (ms: number) => pl + clamp01((ms - clock.start) / span) * (W - pl - pr);
  const y = (v: number) => H - pb - (Math.min(v, top) / top) * (H - pt - pb);
  const step = (side: Side) => {
    let d = "";
    snap.trail.forEach((t, i) => {
      const X = x(Date.parse(t.at));
      const Y = y(t[side]);
      d += i === 0 ? `M${X},${Y}` : `H${X}V${Y}`;
    });
    return d;
  };
  const area = (side: Side) => `${step(side)}V${H - pb}H${pl}Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * s.approvalsGoal));

  useIso(() => {
    if (!el.current || reduced()) return;
    const q = gsap.utils.selector(el.current);
    const tw = gsap.fromTo(
      q(".rc-trail-line"),
      { strokeDashoffset: 1 },
      { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: el.current, start: "top 75%", end: "center 45%", scrub: 0.6 } }
    );
    const tw2 = gsap.fromTo(q(".rc-trail-area, .rc-trail-proj, .rc-trail-dot"), { opacity: 0 }, { opacity: 1, duration: 0.8, stagger: 0.05, scrollTrigger: { trigger: el.current, start: "center 60%", once: true } });
    return () => {
      tw.scrollTrigger?.kill();
      tw.kill();
      tw2.scrollTrigger?.kill();
      tw2.kill();
    };
  }, []);

  return (
    <section ref={el} className="rc-trail" id="trail" aria-labelledby="rc-trail-h">
      <div className="rc-wrap">
        <div className="rc-sec-head" data-reveal>
          <p className="rc-kicker">04 · The trail</p>
          <h2 id="rc-trail-h" className="rc-h2">Every step of the way</h2>
          <p className="rc-sub">Approvals since the start · dashed = where each pace lands by the deadline</p>
        </div>
        <div className="rc-chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${s.home.name} ${a.home.value}, ${s.rival.name} ${a.rival.value} approvals since the start`}>
            <defs>
              {(["home", "rival"] as Side[]).map((side) => (
                <linearGradient key={side} id={`rc-g-${side}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={s[side].color} stopOpacity="0.32" />
                  <stop offset="1" stopColor={s[side].color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {yTicks.map((v) => (
              <g key={v} className="rc-grid-y">
                <line x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} />
                <text x={pl - 10} y={y(v) + 4}>
                  {v}
                </text>
              </g>
            ))}
            <line className="rc-goal-line" x1={pl} x2={W - pr} y1={y(s.approvalsGoal)} y2={y(s.approvalsGoal)} />
            <text className="rc-goal-label" x={W - pr} y={y(s.approvalsGoal) - 8}>
              GOAL {s.approvalsGoal}
            </text>
            {(["home", "rival"] as Side[]).map((side) => (
              <path key={`a-${side}`} className="rc-trail-area" d={area(side)} fill={`url(#rc-g-${side})`} />
            ))}
            <line className="rc-trail-proj" x1={x(nowMs)} y1={y(a.home.value)} x2={x(clock.deadline)} y2={y(endH)} stroke={s.home.color} />
            <line className="rc-trail-proj" x1={x(nowMs)} y1={y(a.rival.value)} x2={x(clock.deadline)} y2={y(endR)} stroke={s.rival.color} />
            {(["home", "rival"] as Side[]).map((side) => (
              <path key={side} className="rc-trail-line" d={step(side)} stroke={s[side].color} pathLength={1} />
            ))}
            <line className="rc-now-line" x1={x(nowMs)} x2={x(nowMs)} y1={pt} y2={H - pb} />
            <text className="rc-axis" x={x(nowMs)} y={pt - 8} textAnchor="middle">
              NOW
            </text>
            {(["home", "rival"] as Side[]).map((side) => (
              <g key={`d-${side}`} className="rc-trail-dot">
                <circle cx={x(nowMs)} cy={y(a[side].value)} r={7} fill={s[side].color} />
                <circle cx={x(nowMs)} cy={y(a[side].value)} r={14} fill={s[side].color} opacity={0.25} />
              </g>
            ))}
            <text className="rc-axis" x={pl} y={H - 10}>
              {fmtDate(clock.start)}
            </text>
            <text className="rc-axis" x={W - pr} y={H - 10} textAnchor="end">
              {fmtDate(clock.deadline)} · deadline
            </text>
          </svg>
          <div className="rc-legend">
            {(["home", "rival"] as Side[]).map((side) => (
              <span key={side}>
                <i style={{ background: s[side].color }} /> {s[side].name} · {a[side].value}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ together

function Together({ snap }: { snap: RaceSnapshot }) {
  const s = snap.settings;
  const a = snap.approvals;
  const total = a.home.goal + a.rival.goal;
  const el = useRef<HTMLElement>(null);
  const arcs = useRef<{ home: SVGCircleElement | null; rival: SVGCircleElement | null }>({ home: null, rival: null });
  const num = useRef<HTMLElement>(null);
  const run = useRef({ v: reduced() ? 1 : 0 });
  const hf = Math.min(1, a.home.value / total);
  const rf = Math.min(1 - hf, a.rival.value / total);

  const paint = useCallback(() => {
    const k = run.current.v;
    const h = arcs.current.home;
    const r = arcs.current.rival;
    if (h) h.style.strokeDasharray = `${hf * k} 1`;
    if (r) {
      r.style.strokeDasharray = `${rf * k} 1`;
      r.style.strokeDashoffset = String(-hf * k);
    }
    if (num.current) num.current.textContent = String(Math.round((a.home.value + a.rival.value) * k));
  }, [hf, rf, a.home.value, a.rival.value]);

  useIso(() => {
    paint();
    if (!el.current || reduced() || run.current.v === 1) return;
    const tw = gsap.to(run.current, { v: 1, duration: 2, ease: "power3.out", onUpdate: paint, scrollTrigger: { trigger: el.current, start: "top 70%", once: true } });
    return () => {
      tw.scrollTrigger?.kill();
      tw.kill();
    };
  }, [paint]);

  return (
    <section ref={el} className="rc-together" aria-labelledby="rc-tog-h">
      <div className="rc-wrap rc-together-in">
        <div className="rc-ring" data-reveal>
          <svg viewBox="0 0 300 300" aria-hidden>
            <circle cx="150" cy="150" r="120" className="rc-ring-bg" />
            <circle ref={(n) => { arcs.current.home = n; }} cx="150" cy="150" r="120" className="rc-ring-arc" stroke={s.home.color} pathLength={1} />
            <circle ref={(n) => { arcs.current.rival = n; }} cx="150" cy="150" r="120" className="rc-ring-arc" stroke={s.rival.color} pathLength={1} />
          </svg>
          <div className="rc-ring-c">
            <b ref={num}>{a.home.value + a.rival.value}</b>
            <span>of {total} together</span>
          </div>
        </div>
        <div className="rc-together-copy" data-reveal>
          <p className="rc-kicker">05 · Together</p>
          <h2 id="rc-tog-h" className="rc-h2">
            Two LCs. <span className="rc-grad">{total}</span> approvals.
          </h2>
          <p className="rc-sub rc-sub-lg">
            It&apos;s a race — and every approval is also somebody&apos;s exchange. Each one moves your LC and the number we
            build together.
          </p>
          <ul className="rc-split">
            {(["home", "rival"] as Side[]).map((side) => (
              <li key={side}>
                <i style={{ background: s[side].color }} />
                {s[side].name} <b>{a[side].value}</b>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ wire

const WIRE_SHORT = 10;

function Wire({ feed, now, sides, state }: { feed: RaceFeedItem[]; now: number | null; sides: RaceSnapshot["settings"]; state: LiveState }) {
  const [all, setAll] = useState(false);
  const shown = all ? feed : feed.slice(0, WIRE_SHORT);
  return (
    <section className="rc-wire" id="moves" aria-labelledby="rc-wire-h">
      <div className="rc-wrap">
        <div className="rc-sec-head" data-reveal>
          <p className="rc-kicker">06 · Latest moves</p>
          <h2 id="rc-wire-h" className="rc-h2">On the wire</h2>
          <p className="rc-sub">
            <span className={`rc-live is-${state}`}>
              <i /> {state === "live" ? "Live — moves land here the second they happen" : "Refreshing every minute"}
            </span>
          </p>
        </div>
        {feed.length === 0 ? (
          <p className="rc-empty" data-reveal>
            No moves yet — the first approval or slot will show up here.
          </p>
        ) : (
          <ol className="rc-feed">
            {shown.map((f) => (
              <li key={f.id} className={`is-${f.side}`} data-reveal style={{ "--c": `var(--${f.side})` } as React.CSSProperties}>
                <span className="rc-feed-tag">{sides[f.side].short}</span>
                <b className={f.delta < 0 ? "is-neg" : ""}>
                  {f.delta > 0 ? "+" : ""}
                  {f.delta}
                </b>
                <span className="rc-feed-what">
                  {f.kind === "approvals" ? (Math.abs(f.delta) === 1 ? "approval" : "approvals") : Math.abs(f.delta) === 1 ? "slot" : "slots"}
                  {f.delta < 0 ? " · CORE correction" : ""}
                  {f.detail ? <em> · {f.detail}</em> : null}
                </span>
                <time dateTime={f.at}>{ago(f.at, now)}</time>
              </li>
            ))}
          </ol>
        )}
        {feed.length > WIRE_SHORT ? (
          <button type="button" className="rc-more" onClick={() => setAll((a) => !a)} data-cursor="link" data-cursor-label={all ? "LESS" : "MORE"}>
            {all ? "Show the latest only" : `Show all ${feed.length} moves`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ finale

function Finale({ text }: { text: string }) {
  const el = useRef<HTMLDivElement>(null);
  useIso(() => {
    if (!el.current || reduced()) return;
    const node = el.current;
    const skew = gsap.quickTo(node, "skewX", { duration: 0.5, ease: "power3" });
    const st = ScrollTrigger.create({
      trigger: node,
      start: "top bottom",
      end: "bottom top",
      onUpdate: (self) => skew(gsap.utils.clamp(-14, 14, self.getVelocity() / -260)),
    });
    return () => st.kill();
  }, []);
  const line = (text || "Who gets there first?").toUpperCase();
  return (
    <section className="rc-finale" aria-label={text || "Who gets there first?"}>
      <div ref={el} className="rc-marquee" aria-hidden>
        <div>
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i}>
              {line} <i>✦</i>
            </span>
          ))}
        </div>
        <div>
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i}>
              {line} <i>✦</i>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
