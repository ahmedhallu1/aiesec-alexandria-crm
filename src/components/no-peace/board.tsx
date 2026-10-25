"use client";

import "./no-peace.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BONUS, rewardFor, splitDuration, warClock, warDay, warPhase, warProgress, addDays,
  type FeedItem, type NationalStanding, type Reward, type StandingRow, type WarSnapshot,
} from "@/lib/war/model";
import { marker, stencil, typewriter } from "./fonts";
import { useWarLive, type LiveState } from "./live";
import { Chute, Flip, Odometer, Plane, Reveal, Tank, initials, useFlip, useNow } from "./bits";

/** /no-peace — AIESEC in Alexandria's war board (v38). Read-only and public;
 *  every number on it is edited in Sodio's War Room and arrives here over the
 *  live wire (live.ts). Sections, top to bottom: the Activate countdown bar,
 *  the declaration, the front line (the war's own clock), the national front
 *  (CORE), the decorated (podium), the battalion (everyone), the dispatches
 *  (live feed), the arsenal (point system), the rewards and the rules. */

type Events = { at: string; drops: FeedItem[]; deltas: Record<string, number>; enlisted: string[]; up: string[] };
const NO_EVENTS: Events = { at: "", drops: [], deltas: {}, enlisted: [], up: [] };

function diff(prev: WarSnapshot, next: WarSnapshot): Events {
  const seen = new Set(prev.feed.map((f) => f.id));
  const drops = next.feed.filter((f) => !seen.has(f.id)).slice(0, 3);
  const before = new Map(prev.rows.map((r) => [r.id, r]));
  const deltas: Record<string, number> = {};
  const enlisted: string[] = [];
  const up: string[] = [];
  for (const r of next.rows) {
    const b = before.get(r.id);
    if (!b) continue;
    if (b.rank !== r.rank) deltas[r.id] = b.rank - r.rank;
    if (!b.eligible && r.eligible) enlisted.push(r.id);
    if (r.points > b.points) up.push(r.id);
  }
  return { at: next.at, drops, deltas, enlisted, up };
}

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function ago(iso: string, now: number | null): string {
  if (!now) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function NoPeaceBoard({
  initial,
  national,
  realtime,
}: {
  initial: WarSnapshot;
  national: NationalStanding | null;
  realtime: { url: string; key: string } | null;
}) {
  const { snap, state } = useWarLive(initial, realtime);
  const s = snap.settings;
  const now = useNow();
  const clock = useMemo(() => warClock(s), [s]);

  // what changed since the last snapshot — React's "adjust state while
  // rendering" pattern, so a new snapshot and its effects land in one pass
  const [prev, setPrev] = useState(snap);
  const [events, setEvents] = useState<Events>(NO_EVENTS);
  if (snap.at !== prev.at) {
    setPrev(snap);
    setEvents(diff(prev, snap));
  }
  useEffect(() => {
    if (!events.at) return;
    const t = setTimeout(() => setEvents((e) => (e.at === events.at ? { ...e, drops: [] } : e)), 6000);
    const t2 = setTimeout(() => setEvents((e) => (e.at === events.at ? NO_EVENTS : e)), 60_000);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [events.at]);

  const [modal, setModal] = useState<{ kind: "all" } | { kind: "one"; reward: Reward } | null>(null);
  const [burst, setBurst] = useState<{ id: number; bits: { dx: number; r: number; left: number; c: string; d: number }[] } | null>(null);
  const openReward = (m: { kind: "all" } | { kind: "one"; reward: Reward }) => {
    const colors = ["#e2b354", "#b8432d", "#8fd3c7", "#ecdcb6", "#5d6638"];
    setBurst({
      id: Date.now(),
      bits: Array.from({ length: 28 }, (_, i) => ({
        dx: Math.round((Math.random() - 0.5) * 380),
        r: Math.round(Math.random() * 720 - 360),
        left: 30 + Math.random() * 40,
        c: colors[i % colors.length],
        d: Math.random() * 0.25,
      })),
    });
    setModal(m);
  };

  const holders = useMemo(() => {
    const m = new Map<number, StandingRow[]>();
    for (const r of snap.rows) {
      const rw = rewardFor(r, s.rewards);
      if (rw) m.set(rw.rank, [...(m.get(rw.rank) ?? []), r]);
    }
    return m;
  }, [snap.rows, s.rewards]);

  return (
    <div className={`np ${stencil.variable} ${typewriter.variable} ${marker.variable}`}>
      <TopBar snap={snap} clockActivate={clock.activate} now={now} state={state} onRewards={() => openReward({ kind: "all" })} />
      <Hero snap={snap} now={now} onRewards={() => openReward({ kind: "all" })} />
      <FrontLine snap={snap} now={now} />
      {s.show.national ? <NationalFront data={national} /> : null}
      <Podium snap={snap} />
      {s.show.feed ? <Dispatches feed={snap.feed} now={now} events={events} /> : null}
      <Battalion snap={snap} events={events} />
      <Arsenal snap={snap} />
      <Rewards snap={snap} holders={holders} onOpen={(r) => openReward({ kind: "one", reward: r })} />
      <Rules rules={s.rules} />
      <footer className="np-foot">
        <div className="np-wrap">
          <p className="np-marker" style={{ fontSize: "clamp(28px,5vw,46px)", color: "var(--np-brass-2)" }}>{s.motto}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/alex-white.png" alt="AIESEC in Alexandria" style={{ height: 34, margin: "26px auto 0", opacity: 0.9 }} />
          <p className="np-type" style={{ marginTop: 14, fontSize: 12, opacity: 0.6 }}>
            Powered by Sodio · Made by 2.0 · last dispatch {snap.feed[0] ? ago(snap.feed[0].at, now) : "—"}
          </p>
        </div>
      </footer>

      {modal ? (
        <RewardModal
          modal={modal}
          rewards={s.rewards}
          minPoints={s.minPoints}
          holders={holders}
          burst={burst}
          onPick={(r) => openReward({ kind: "one", reward: r })}
          onAll={() => setModal({ kind: "all" })}
          onClose={() => setModal(null)}
        />
      ) : null}

      {events.drops.map((f, i) => (
        <div key={`${events.at}-${f.id}`} className="np-airdrop" style={{ left: `${18 + ((i * 29) % 64)}%`, animationDelay: `${i * 0.7}s` }} aria-hidden>
          <div style={{ width: 70, margin: "0 auto" }}>
            <Chute />
          </div>
          <span className="np-crate np-stencil">
            {f.points >= 0 ? "+" : ""}
            {f.points} · {f.name.split(" ")[0]}
          </span>
        </div>
      ))}
      {events.drops[0] ? (
        <div key={`b-${events.at}`} className="np-banner np-type" role="status" aria-live="polite">
          <span style={{ fontSize: 20 }}>📡</span>
          <span>
            <b className="np-stencil" style={{ color: "var(--np-rust)" }}>INCOMING</b> · {events.drops[0].name} ·{" "}
            {events.drops[0].label}
            {events.drops[0].kind !== BONUS && events.drops[0].qty > 1 ? ` ×${events.drops[0].qty}` : ""} ·{" "}
            <b>
              {events.drops[0].points >= 0 ? "+" : ""}
              {events.drops[0].points}
            </b>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ top bar

function TopBar({
  snap, clockActivate, now, state, onRewards,
}: {
  snap: WarSnapshot;
  clockActivate: number;
  now: number | null;
  state: LiveState;
  onRewards: () => void;
}) {
  const s = snap.settings;
  const left = now ? splitDuration(clockActivate - now) : null;
  const on = now !== null && now >= clockActivate;
  const ticker = snap.feed.slice(0, 12);
  return (
    <div className="np-top">
      <div className="np-wrap np-top-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/alex-white.png" alt="AIESEC in Alexandria" style={{ height: 22, flexShrink: 0 }} className="hidden sm:block" />
        <span className="np-stencil hidden md:inline" style={{ color: "var(--np-brass)", fontSize: 18 }}>
          {s.name.toUpperCase()}
        </span>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span className="np-type" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.75, whiteSpace: "nowrap" }}>
            {on ? `🎪 ${s.activateLabel} is on` : `${s.activateLabel} in`}
          </span>
          {!on ? (
            <span className="np-clock" aria-label={left ? `${left.d} days ${left.h} hours ${left.m} minutes` : "loading"}>
              <Flip value={left ? String(left.d) : "--"} size="17px" />
              <span className="np-clock-sep np-stencil" style={{ fontSize: 15 }}>d</span>
              <Flip value={left ? pad(left.h) : "--"} size="17px" />
              <span className="np-clock-sep" style={{ fontSize: 15 }}>:</span>
              <Flip value={left ? pad(left.m) : "--"} size="17px" />
              <span className="np-clock-sep hidden sm:inline" style={{ fontSize: 15 }}>:</span>
              <span className="hidden sm:inline-flex">
                <Flip value={left ? pad(left.s) : "--"} size="17px" />
              </span>
            </span>
          ) : null}
        </div>
        <span className="np-live" data-state={state} title={state === "live" ? "Live — numbers update the moment they're logged" : state === "connecting" ? "Connecting…" : "Refreshing every minute"}>
          <span className="np-live-dot" />
          <span className="hidden sm:inline">{state === "live" ? "Live" : state === "connecting" ? "…" : "Auto"}</span>
        </span>
        <button type="button" className="np-btn np-btn-ghost" style={{ padding: "7px 11px", fontSize: 11 }} onClick={onRewards}>
          🎖 <span className="hidden sm:inline">Rewards</span>
        </button>
      </div>
      <div className="np-ticker np-type" aria-label="Latest dispatches">
        <div className="np-ticker-track" style={{ ["--np-marquee" as string]: `${Math.max(30, ticker.length * 7)}s` }}>
          {ticker.length ? (
            ticker.map((f) => (
              <span key={f.id}>
                <b style={{ color: f.points >= 0 ? "var(--np-brass)" : "var(--np-rust-2)" }}>
                  {f.points >= 0 ? "▲ +" : "▼ "}
                  {f.points}
                </b>{" "}
                {f.name} — {f.label}
                {f.kind !== BONUS && f.qty > 1 ? ` ×${f.qty}` : ""}
              </span>
            ))
          ) : (
            <span>{s.heroLines.join("  ·  ")}  ·  the first points start the war</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ hero

function useTyped(lines: string[]): { typed: string[]; done: boolean } {
  const full = lines.join("\n");
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let i = 0;
    let iv: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      if (reduce) {
        setN(full.length);
        return;
      }
      iv = setInterval(() => {
        i += 1;
        setN(i);
        if (i >= full.length) clearInterval(iv);
      }, 42);
    }, reduce ? 0 : 1500);
    return () => {
      clearTimeout(start);
      if (iv) clearInterval(iv);
    };
  }, [full]);
  return { typed: full.slice(0, n).split("\n"), done: n >= full.length };
}

function Hero({ snap, now, onRewards }: { snap: WarSnapshot; now: number | null; onRewards: () => void }) {
  const s = snap.settings;
  const clock = warClock(s);
  const phase = now ? warPhase(clock, now) : "live";
  const left = now ? splitDuration((phase === "before" ? clock.start : clock.end) - now) : null;
  const { typed, done } = useTyped(s.heroLines);
  const planes = [
    { y: "14%", w: "86px", d: "26s", delay: "-4s" },
    { y: "22%", w: "54px", d: "34s", delay: "-18s" },
    { y: "9%", w: "40px", d: "41s", delay: "-30s" },
  ];
  const chutes = [
    { x: "78%", w: "54px", d: "21s", delay: "-3s" },
    { x: "12%", w: "44px", d: "27s", delay: "-15s" },
    { x: "62%", w: "36px", d: "33s", delay: "-24s" },
  ];
  return (
    <header className="np-hero" style={{ ["--np-hero-img" as string]: "url(/brand/no-peace/banner.webp)" }}>
      <div className="np-hero-bg np-hero-bg-l" />
      <div className="np-hero-bg np-hero-bg-r" />
      <div className="np-hero-shade" />
      <div className="np-beam np-beam-a" />
      <div className="np-beam np-beam-b" />
      {planes.map((p, i) => (
        <Plane key={i} className="np-plane" style={{ ["--y" as string]: p.y, ["--w" as string]: p.w, ["--d" as string]: p.d, ["--delay" as string]: p.delay }} />
      ))}
      {chutes.map((c, i) => (
        <button
          key={i}
          type="button"
          className="np-chute"
          aria-label="Open the war rewards"
          title="An airdrop! Open the war rewards"
          onClick={onRewards}
          style={{ ["--x" as string]: c.x, ["--w" as string]: c.w, ["--d" as string]: c.d, ["--delay" as string]: c.delay }}
        >
          <Chute />
        </button>
      ))}

      <div className="np-wrap np-hero-inner">
        <span className="np-eyebrow np-stencil">
          🚨 War declaration<span className="hidden sm:inline"> · AIESEC in Alexandria</span>
        </span>
        <div style={{ marginTop: 22 }}>
          <div className="np-title-plate">
            <h1 className="np-title np-stencil">{s.name.toUpperCase()}</h1>
          </div>
        </div>
        <div className="np-lines np-type" aria-label={s.heroLines.join(". ")}>
          {typed.map((l, i) => (
            <div key={i}>
              {l}
              {i === typed.length - 1 ? <span className="np-caret" style={{ opacity: done ? 0 : 1 }} /> : null}
            </div>
          ))}
        </div>
        {s.tagline ? <p className="np-tagline">{s.tagline}</p> : null}

        <div style={{ marginTop: 30 }}>
          <p className="np-type" style={{ fontSize: 12, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--np-brass)", marginBottom: 10 }}>
            {phase === "before" ? "The war starts in" : phase === "live" ? "The war ends in" : "The war is over"}
          </p>
          {phase !== "over" ? (
            <div className="np-clock" style={{ gap: 10 }}>
              <Flip value={left ? pad(left.d) : "--"} label="days" size="clamp(34px,7vw,64px)" />
              <span className="np-clock-sep np-stencil" style={{ fontSize: "clamp(30px,6vw,56px)" }}>:</span>
              <Flip value={left ? pad(left.h) : "--"} label="hours" size="clamp(34px,7vw,64px)" />
              <span className="np-clock-sep np-stencil" style={{ fontSize: "clamp(30px,6vw,56px)" }}>:</span>
              <Flip value={left ? pad(left.m) : "--"} label="min" size="clamp(34px,7vw,64px)" />
              <span className="np-clock-sep np-stencil" style={{ fontSize: "clamp(30px,6vw,56px)" }}>:</span>
              <Flip value={left ? pad(left.s) : "--"} label="sec" size="clamp(34px,7vw,64px)" />
            </div>
          ) : (
            <p className="np-stencil" style={{ fontSize: 34, color: "var(--np-brass-2)" }}>The standings are final</p>
          )}
        </div>

        <div style={{ marginTop: 32, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="#battalion" className="np-btn np-btn-brass">⚔ See the standings</a>
          <button type="button" className="np-btn np-btn-ghost" onClick={onRewards}>🎖 War rewards</button>
        </div>
        <div style={{ marginTop: 26, display: "flex", gap: 22, justifyContent: "center", flexWrap: "wrap" }} className="np-type">
          {[
            { k: "war points", v: snap.totals.points },
            { k: "troops", v: snap.totals.troops },
            { k: `enlisted (${s.minPoints}+)`, v: snap.totals.enlisted },
          ].map((x) => (
            <div key={x.k} style={{ textAlign: "center" }}>
              <Odometer value={x.v} className="np-stencil" />
              <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.65, marginTop: 4 }}>{x.k}</div>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ front line

function FrontLine({ snap, now }: { snap: WarSnapshot; now: number | null }) {
  const s = snap.settings;
  const clock = warClock(s);
  const p = now ? warProgress(clock, now) : 0;
  const day = now ? warDay(clock, now) : 0;
  const total = clock.totalDays;
  const x = (frac: number) => 3 + 85 * frac;
  const daysLeft = now ? Math.max(0, Math.ceil((clock.end - now) / 86_400_000)) : 0;
  // on a phone the map scrolls sideways — bring today's position into view
  const scroller = useRef<HTMLDivElement | null>(null);
  const centred = useRef(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !now || centred.current || el.scrollWidth <= el.clientWidth) return;
    centred.current = true;
    el.scrollLeft = Math.max(0, (x(p) / 100) * el.scrollWidth - el.clientWidth / 2);
  });
  return (
    <section className="np-section">
      <div className="np-wrap">
        <Reveal>
          <p className="np-kicker np-type">The front line</p>
          <h2 className="np-h2 np-stencil">
            {now && warPhase(clock, now) === "before" ? "Mobilising" : `Day ${day} of ${total}`}
          </h2>
          <p className="np-sub">
            {fmtDay(s.startDate)} → {fmtDay(s.endDate)} · {Math.round(p * 100)}% of the war fought · {daysLeft}{" "}
            {daysLeft === 1 ? "day" : "days"} left to push the line.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="np-paper np-front" style={{ marginTop: 22 }}>
            <div className="np-front-scroll" ref={scroller}>
              <div className="np-front-map">
                <div className="np-front-grid" />
                <div className="np-front-road" />
                <div className="np-front-done" style={{ width: `${85 * p}%` }} />
                {Array.from({ length: total + 1 }, (_, i) => {
                  const week = i % 7 === 0 || i === total;
                  return (
                    <div key={i}>
                      <div className={`np-front-tick ${week ? "np-week" : ""}`} style={{ left: `${x(i / total)}%` }} />
                      {week ? (
                        <div className="np-front-label np-type" style={{ left: `${x(i / total)}%` }}>
                          {fmtDay(addDays(s.startDate, Math.min(i, total - 1)))}
                          {i === total ? " · end" : ""}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div className="np-front-tank" style={{ left: `${x(p)}%` }} title="Where the war stands today">
                  <Tank />
                </div>
                <div className="np-front-flag">
                  <div style={{ fontSize: 28 }}>🎪</div>
                  <div className="np-stencil" style={{ fontSize: 12, color: "var(--np-ink)" }}>{s.activateLabel}</div>
                  <div className="np-type" style={{ fontSize: 10.5, color: "var(--np-ink-2)" }}>{fmtDay(s.activateDate)}</div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ national front (CORE)

function NationalFront({ data }: { data: NationalStanding | null }) {
  const [stage, setStage] = useState(0);
  const st = data?.stages[Math.min(stage, (data?.stages.length ?? 1) - 1)];
  const total = st?.cells.find((c) => c.program.toLowerCase() === "total");
  const programs = st?.cells.filter((c) => c.program.toLowerCase() !== "total") ?? [];
  const blips = programs.filter((c) => c.rank !== null && c.rank <= 3);
  return (
    <section className="np-section" style={{ background: "linear-gradient(180deg, transparent, rgba(18,52,58,.35), transparent)" }}>
      <div className="np-wrap">
        <Reveal>
          <p className="np-kicker np-type">The national front</p>
          <h2 className="np-h2 np-stencil">Where Alexandria stands in Egypt</h2>
          <p className="np-sub">
            Live from CORE, the national analytics — Alexandria&apos;s place among every Egyptian LC, per program.
          </p>
        </Reveal>
        {!data || !st ? (
          <Reveal>
            <p className="np-type" style={{ marginTop: 24, opacity: 0.75 }}>
              📡 CORE isn&apos;t answering right now — the national front reloads every 15 minutes.
            </p>
          </Reveal>
        ) : (
          <div style={{ display: "grid", gap: 28, marginTop: 28, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", alignItems: "center" }}>
            <Reveal>
              <div style={{ display: "grid", placeItems: "center" }}>
                <div className="np-radar">
                  <div className="np-radar-sweep" />
                  {blips.map((b, i) => {
                    const a = (i / Math.max(1, blips.length)) * Math.PI * 2 + 0.6;
                    const r = 18 + (b.rank! - 1) * 12;
                    return <span key={b.program} className="np-blip" style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%`, animationDelay: `${(a / (Math.PI * 2)) * 4}s` }} title={`${b.program} #${b.rank}`} />;
                  })}
                  <div className="np-radar-core">
                    <div>
                      <div className="np-type" style={{ fontSize: 11, letterSpacing: ".2em", color: "var(--np-mint)" }}>TOTAL · {st.label.toUpperCase()}</div>
                      <div className="np-stencil" style={{ fontSize: 76, lineHeight: 1, color: "var(--np-brass-2)", textShadow: "0 0 24px rgba(226,179,84,.4)" }}>
                        {total?.rank ? `#${total.rank}` : "10+"}
                      </div>
                      <div className="np-type" style={{ fontSize: 12, opacity: 0.8 }}>
                        {total?.count !== null && total?.count !== undefined ? `${total.count} ${st.label.toLowerCase()}` : "outside the top 10"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div role="tablist" aria-label="Stage" className="np-tabs">
                {data.stages.map((x, i) => (
                  <button key={x.stage} type="button" role="tab" aria-selected={i === stage} className="np-tab" onClick={() => setStage(i)}>
                    {x.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 14 }}>
                {programs.map((c) => (
                  <div key={c.program} className="np-prog">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span className="np-stencil" style={{ fontSize: 16 }}>{c.program}</span>
                      <span className="np-stencil" style={{ fontSize: 24, color: c.rank && c.rank <= 3 ? "var(--np-brass-2)" : "var(--np-paper)" }}>
                        {c.rank ? `#${c.rank}` : "10+"}
                      </span>
                    </div>
                    <div className="np-prog-bar" style={{ marginTop: 10 }}>
                      <i style={{ width: `${c.count && c.leader?.count ? Math.max(4, (c.count / c.leader.count) * 100) : 0}%` }} />
                    </div>
                    <div className="np-type" style={{ fontSize: 11, marginTop: 7, opacity: 0.75, lineHeight: 1.35 }}>
                      {c.count !== null ? `${c.count} · ` : ""}
                      {c.rank === 1 ? "leading the country" : c.leader ? `#1 ${c.leader.lc} (${c.leader.count})` : ""}
                    </div>
                  </div>
                ))}
              </div>
              <p className="np-type" style={{ fontSize: 11, opacity: 0.55, marginTop: 12 }}>
                Source:{" "}
                <a href="https://core.aiesec.org.eg" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                  core.aiesec.org.eg
                </a>{" "}
                · CORE lists the top 10 per program · refreshed every 15 min
              </p>
            </Reveal>
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ podium

function Avatar({ row, size }: { row: StandingRow; size?: number }) {
  return row.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={row.avatar} alt="" className="np-avatar" style={size ? { width: size, height: size } : undefined} loading="lazy" />
  ) : (
    <span className="np-avatar" style={size ? { width: size, height: size, fontSize: size / 2.8 } : undefined} aria-hidden>
      {initials(row.name)}
    </span>
  );
}

function Podium({ snap }: { snap: WarSnapshot }) {
  const s = snap.settings;
  const top = snap.rows.filter((r) => r.points > 0).slice(0, 3);
  const order = [top[1], top[0], top[2]];
  const chain = [70, 34, 96];
  const metal = ["np-silver", "np-gold", "np-bronze"];
  return (
    <section className="np-section">
      <div className="np-wrap">
        <Reveal>
          <p className="np-kicker np-type">The decorated</p>
          <h2 className="np-h2 np-stencil">Leading the charge</h2>
        </Reveal>
        {top.length === 0 ? (
          <Reveal>
            <div className="np-paper np-type" style={{ marginTop: 26, padding: 28, textAlign: "center", fontSize: 16 }}>
              The battlefield is quiet. The first points logged take the top of the hill.
            </div>
          </Reveal>
        ) : (
          <div className="np-podium" style={{ marginTop: 10 }}>
            {order.map((r, i) =>
              r ? (
                <div key={r.id} className="np-tag-wrap">
                  <div className="np-chain" style={{ height: chain[i] }} />
                  <div className={`np-tag ${metal[i]}`}>
                    <div className="np-stencil np-tag-emboss" style={{ fontSize: "clamp(22px,4vw,34px)" }}>#{r.rank}</div>
                    <div style={{ display: "grid", placeItems: "center", margin: "8px 0" }}>
                      <Avatar row={r} size={i === 1 ? 64 : 52} />
                    </div>
                    <div className="np-stencil np-tag-emboss" style={{ fontSize: "clamp(12px,2vw,17px)", lineHeight: 1.15, wordBreak: "break-word" }} dir="auto">
                      {r.name}
                    </div>
                    <div className="np-type" style={{ fontSize: 11, opacity: 0.75 }}>{r.fn}</div>
                    <div className="np-stencil" style={{ fontSize: i === 1 ? "clamp(30px,5vw,46px)" : "clamp(24px,4vw,36px)", marginTop: 8 }}>
                      <Odometer value={r.points} />
                    </div>
                    <div className="np-type" style={{ fontSize: 11 }}>war points</div>
                    <div className="np-type" style={{ fontSize: 11, marginTop: 6, fontWeight: 700 }}>
                      {rewardFor(r, s.rewards)
                        ? `${rewardFor(r, s.rewards)!.emoji} ${rewardFor(r, s.rewards)!.title}`
                        : r.eligible
                          ? "Enlisted"
                          : `${s.minPoints - r.points} to enlist`}
                    </div>
                  </div>
                </div>
              ) : (
                <div key={i} />
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ battalion

function Battalion({ snap, events }: { snap: WarSnapshot; events: Events }) {
  const s = snap.settings;
  const [q, setQ] = useState("");
  const [fn, setFn] = useState<string | null>(null);
  const [enlistedOnly, setEnlistedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const fns = useMemo(() => [...new Set(snap.rows.map((r) => r.fn))].sort(), [snap.rows]);
  const types = useMemo(() => new Map(s.pointTypes.map((t) => [t.key, t])), [s.pointTypes]);
  const term = q.trim().toLowerCase();
  const rows = snap.rows.filter(
    (r) => (!term || r.name.toLowerCase().includes(term)) && (!fn || r.fn === fn) && (!enlistedOnly || r.eligible)
  );
  const shown = all || term ? rows : rows.slice(0, 15);
  const max = Math.max(s.minPoints * 1.25, ...snap.rows.map((r) => r.points), 1);
  const flipRef = useFlip(shown.map((r) => r.id).join(","));

  return (
    <section className="np-section" id="battalion">
      <div className="np-wrap">
        <Reveal>
          <p className="np-kicker np-type">The battalion</p>
          <h2 className="np-h2 np-stencil">Every soldier, every point</h2>
          <p className="np-sub">
            {snap.totals.troops} troops in the race · {snap.totals.enlisted} enlisted with {s.minPoints}+ war points ·
            ties share a rank. Tap anyone to see what they scored.
          </p>
        </Reveal>
        <div className="np-filters" style={{ marginTop: 22 }}>
          <div style={{ position: "relative", flex: "1 1 200px", display: "flex" }}>
            <span style={{ position: "absolute", left: 11, top: 9, opacity: 0.6 }} aria-hidden>⌕</span>
            <input className="np-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a soldier…" aria-label="Search by name" />
          </div>
          <button type="button" className="np-chip" aria-pressed={fn === null} onClick={() => setFn(null)}>All</button>
          {fns.map((f) => (
            <button key={f} type="button" className="np-chip" aria-pressed={fn === f} onClick={() => setFn(fn === f ? null : f)}>
              {f}
            </button>
          ))}
          <button type="button" className="np-chip" aria-pressed={enlistedOnly} onClick={() => setEnlistedOnly((v) => !v)}>
            ★ {s.minPoints}+
          </button>
        </div>

        <div ref={flipRef} style={{ display: "grid", gap: 7, marginTop: 14 }}>
          {shown.map((r) => {
            const d = events.deltas[r.id];
            const reward = rewardFor(r, s.rewards);
            const isOpen = open === r.id;
            return (
              <div
                key={r.id}
                data-flip={r.id}
                className="np-row"
                data-eligible={r.eligible}
                data-flash={events.up.includes(r.id) ? "up" : undefined}
                onClick={() => setOpen(isOpen ? null : r.id)}
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpen(isOpen ? null : r.id);
                  }
                }}
              >
                <div className="np-rank np-stencil">{r.rank}</div>
                <Avatar row={r} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir="auto">{r.name}</span>
                    {reward ? <span title={reward.title}>{reward.emoji}</span> : null}
                    {r.eligible ? (
                      <span className={`np-enlisted np-stencil ${events.enlisted.includes(r.id) ? "np-new" : ""}`}>ENLISTED</span>
                    ) : null}
                  </div>
                  <div className="np-type" style={{ fontSize: 11.5, opacity: 0.6 }}>
                    {r.fn} · {r.role}
                  </div>
                  <div className="np-march" title={`${r.points} / ${s.minPoints} to enlist`}>
                    <i style={{ width: `${Math.max(0, Math.min(100, (r.points / max) * 100))}%` }} />
                    <b style={{ left: `${(s.minPoints / max) * 100}%` }} />
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="np-stencil" style={{ fontSize: 24, color: r.eligible ? "var(--np-brass-2)" : "var(--np-paper)" }}>
                    <Odometer value={r.points} />
                  </div>
                  {d ? <div className={`np-delta ${d > 0 ? "up" : "down"}`}>{d > 0 ? `▲ ${d}` : `▼ ${-d}`}</div> : null}
                </div>
                {isOpen ? (
                  <div className="np-break np-type">
                    {Object.keys(r.breakdown).length === 0 ? (
                      <span>{s.show.breakdown ? "No points yet — the war is young." : "Breakdowns are private."}</span>
                    ) : (
                      Object.entries(r.breakdown).map(([k, v]) =>
                        k === BONUS ? (
                          <span key={k}>Bonus {v >= 0 ? "+" : ""}{v}</span>
                        ) : (
                          <span key={k}>
                            {types.get(k)?.label ?? k} ×{v} = {(types.get(k)?.points ?? 0) * v}
                          </span>
                        )
                      )
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
          {shown.length === 0 ? (
            <p className="np-type" style={{ textAlign: "center", padding: 24, opacity: 0.7 }}>No soldier by that name in this battalion.</p>
          ) : null}
        </div>
        {!all && !term && rows.length > shown.length ? (
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button type="button" className="np-btn np-btn-ghost" onClick={() => setAll(true)}>
              Show all {rows.length}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ dispatches

function Dispatches({ feed, now, events }: { feed: FeedItem[]; now: number | null; events: Events }) {
  const fresh = new Set(events.drops.map((d) => d.id));
  const list = feed.slice(0, 9);
  return (
    <section className="np-section" style={{ background: "linear-gradient(180deg, transparent, rgba(59,42,20,.25), transparent)" }}>
      <div className="np-wrap">
        <Reveal>
          <p className="np-kicker np-type">Field dispatches</p>
          <h2 className="np-h2 np-stencil">Straight from the front</h2>
          <p className="np-sub">Every point the moment it&apos;s logged — this list moves on its own.</p>
        </Reveal>
        {list.length === 0 ? (
          <p className="np-type" style={{ marginTop: 22, opacity: 0.7 }}>No dispatches yet. The radio is on.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 24, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))" }}>
            {list.map((f) => (
              <div key={f.id} className={`np-dispatch ${fresh.has(f.id) ? "np-new" : ""}`}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="np-dispatch-pts np-stencil" style={{ color: f.points < 0 ? "var(--np-ink-2)" : undefined }}>
                    {f.points >= 0 ? "+" : ""}
                    {f.points}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} dir="auto">{f.name}</div>
                    <div className="np-type" style={{ fontSize: 12.5 }}>
                      {f.label}
                      {f.kind !== BONUS && f.qty > 1 ? ` ×${f.qty}` : ""} · {ago(f.at, now)}
                    </div>
                  </div>
                  <span className="np-type" style={{ fontSize: 10, letterSpacing: ".2em", opacity: 0.55 }}>STOP</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ arsenal

function Arsenal({ snap }: { snap: WarSnapshot }) {
  const s = snap.settings;
  const [pressed, setPressed] = useState<string | null>(null);
  const cards = [
    ...s.pointTypes.map((t) => ({ key: t.key, label: t.label, pts: `+${t.points}`, group: t.group, hint: t.hint })),
    { key: BONUS, label: "Bonus", pts: "±", group: "LC", hint: "Attendance & engagement at every checkpoint" },
  ];
  return (
    <section className="np-section">
      <div className="np-wrap">
        <Reveal>
          <p className="np-kicker np-type">The arsenal</p>
          <h2 className="np-h2 np-stencil">The point system</h2>
          <p className="np-sub">What every achievement is worth. Turn a crate over to see how often it&apos;s been fired.</p>
        </Reveal>
        <div className="np-arsenal" style={{ marginTop: 24 }}>
          {cards.map((c, i) => {
            const used = snap.totals.byKind[c.key];
            return (
              <Reveal key={c.key} delay={i * 50}>
                <button
                  type="button"
                  className="np-card"
                  aria-pressed={pressed === c.key}
                  onClick={() => setPressed(pressed === c.key ? null : c.key)}
                  aria-label={`${c.label}: ${c.pts} points`}
                >
                  <div className="np-card-in">
                    <div className="np-face np-face-front">
                      <span className="np-group np-type">{c.group}</span>
                      <div>
                        <div className="np-face-pts np-stencil">{c.pts}</div>
                        <div className="np-stencil" style={{ fontSize: 17, marginTop: 4 }}>{c.label}</div>
                      </div>
                    </div>
                    <div className="np-face np-face-back">
                      <span className="np-type" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{c.hint || c.label}</span>
                      <div>
                        <div className="np-stencil" style={{ fontSize: 26 }}>{used ? `${used.qty}×` : "0×"}</div>
                        <div className="np-type" style={{ fontSize: 11.5 }}>
                          {used ? `${used.points >= 0 ? "+" : ""}${used.points} points so far` : "not fired yet"}
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ rewards

function Rewards({
  snap, holders, onOpen,
}: {
  snap: WarSnapshot;
  holders: Map<number, StandingRow[]>;
  onOpen: (r: Reward) => void;
}) {
  const s = snap.settings;
  return (
    <section className="np-section" style={{ background: "radial-gradient(800px 400px at 50% 30%, rgba(226,179,84,.10), transparent 70%)" }}>
      <div className="np-wrap">
        <Reveal>
          <p className="np-kicker np-type">The spoils of war</p>
          <h2 className="np-h2 np-stencil">War rewards</h2>
          <p className="np-sub">
            You need at least <b style={{ color: "var(--np-brass-2)" }}>{s.minPoints} war points</b> to compete. Tap a
            medal for the details — and who&apos;s holding it right now.
          </p>
        </Reveal>
        <div className="np-rewards" style={{ marginTop: 26 }}>
          {s.rewards.map((r, i) => {
            const h = holders.get(r.rank);
            return (
              <Reveal key={`${r.rank}-${r.title}`} delay={i * 80}>
                <TiltCard onClick={() => onOpen(r)} label={`${r.place}: ${r.title}`}>
                  <span className="np-medal-emoji" style={{ animationDelay: `${i * -0.7}s` }}>{r.emoji}</span>
                  <div className="np-type" style={{ fontSize: 12, letterSpacing: ".24em", textTransform: "uppercase", marginTop: 12, color: "var(--np-brass)" }}>
                    {r.place}
                  </div>
                  <div className="np-stencil" style={{ fontSize: 22, marginTop: 4 }}>{r.title}</div>
                  <div className="np-type" style={{ fontSize: 12, marginTop: 10, opacity: 0.75 }}>
                    {h?.length ? `Held by ${h.map((x) => x.name.split(" ")[0]).join(" & ")}` : "Unclaimed — up for grabs"}
                  </div>
                </TiltCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TiltCard({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  const [t, setT] = useState({ x: 0, y: 0 });
  return (
    <button
      type="button"
      className="np-medal"
      aria-label={label}
      onClick={onClick}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const b = e.currentTarget.getBoundingClientRect();
        setT({ x: ((e.clientY - b.top) / b.height - 0.5) * -10, y: ((e.clientX - b.left) / b.width - 0.5) * 12 });
      }}
      onPointerLeave={() => setT({ x: 0, y: 0 })}
      style={{ transform: `perspective(700px) rotateX(${t.x}deg) rotateY(${t.y}deg)`, width: "100%" }}
    >
      {children}
    </button>
  );
}

function RewardModal({
  modal, rewards, minPoints, holders, burst, onPick, onAll, onClose,
}: {
  modal: { kind: "all" } | { kind: "one"; reward: Reward };
  rewards: Reward[];
  minPoints: number;
  holders: Map<number, StandingRow[]>;
  burst: { id: number; bits: { dx: number; r: number; left: number; c: string; d: number }[] } | null;
  onPick: (r: Reward) => void;
  onAll: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="np-modal-back" onClick={onClose} role="presentation">
      <div className="np-paper np-modal" role="dialog" aria-modal="true" aria-label="War rewards" onClick={(e) => e.stopPropagation()}>
        {burst?.bits.map((b, i) => (
          <span
            key={`${burst.id}-${i}`}
            className="np-confetti"
            style={{ left: `${b.left}%`, background: b.c, animationDelay: `${b.d}s`, ["--dx" as string]: `${b.dx}px`, ["--r" as string]: `${b.r}deg` }}
          />
        ))}
        <button type="button" className="np-x" onClick={onClose} aria-label="Close" autoFocus>×</button>
        {modal.kind === "one" ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 96, lineHeight: 1, filter: "drop-shadow(0 14px 18px rgba(0,0,0,.35))" }}>{modal.reward.emoji}</div>
            <div className="np-type" style={{ fontSize: 12, letterSpacing: ".3em", textTransform: "uppercase", marginTop: 12, color: "var(--np-rust)" }}>
              {modal.reward.place}
            </div>
            <h3 className="np-stencil" style={{ fontSize: 34, marginTop: 4 }}>{modal.reward.title}</h3>
            {modal.reward.detail ? <p style={{ marginTop: 10, lineHeight: 1.55 }}>{modal.reward.detail}</p> : null}
            <div className="np-type" style={{ marginTop: 18, padding: 12, border: "1.5px dashed var(--np-ink-2)", borderRadius: 4, fontSize: 13.5 }}>
              {holders.get(modal.reward.rank)?.length
                ? `In line right now: ${holders.get(modal.reward.rank)!.map((h) => `${h.name} (${h.points})`).join(", ")}`
                : `Nobody holds it yet. Get to ${minPoints} war points and climb.`}
            </div>
            <button type="button" className="np-btn np-btn-ghost" style={{ marginTop: 18, color: "var(--np-ink)", borderColor: "var(--np-ink-2)" }} onClick={onAll}>
              ‹ All rewards
            </button>
          </div>
        ) : (
          <div>
            <h3 className="np-stencil" style={{ fontSize: 30, textAlign: "center" }}>War rewards</h3>
            <p className="np-type" style={{ textAlign: "center", fontSize: 13, marginTop: 6 }}>
              At least {minPoints} war points to compete.
            </p>
            <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
              {rewards.map((r) => (
                <button
                  key={`${r.rank}-${r.title}`}
                  type="button"
                  onClick={() => onPick(r)}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: 12, borderRadius: 6, border: "1.5px solid rgba(74,58,38,.35)", background: "rgba(255,255,255,.25)", textAlign: "left", cursor: "pointer", color: "var(--np-ink)" }}
                >
                  <span style={{ fontSize: 38 }}>{r.emoji}</span>
                  <span style={{ flex: 1 }}>
                    <span className="np-type" style={{ fontSize: 11, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--np-rust)" }}>{r.place}</span>
                    <span className="np-stencil" style={{ display: "block", fontSize: 19 }}>{r.title}</span>
                  </span>
                  <span aria-hidden>›</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ rules

function Rules({ rules }: { rules: string[] }) {
  if (rules.length === 0) return null;
  return (
    <section className="np-section">
      <div className="np-wrap" style={{ maxWidth: 860 }}>
        <Reveal>
          <p className="np-kicker np-type">Orders</p>
          <h2 className="np-h2 np-stencil">Rules of engagement</h2>
        </Reveal>
        <Reveal delay={100}>
          <div className="np-paper np-memo" style={{ marginTop: 24 }}>
            <span className="np-classified np-stencil">Classified</span>
            <p className="np-type" style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
              TO: AIESEC in Alexandria membership · RE: the war · STATUS: this is not a drill
            </p>
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {rules.map((r, i) => (
                <li key={i}>
                  <b className="np-stencil">{i + 1}</b>
                  {r}
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
