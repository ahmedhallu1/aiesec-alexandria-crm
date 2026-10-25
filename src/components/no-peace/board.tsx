"use client";

import "./no-peace.css";
import { useEffect, useMemo, useState } from "react";
import {
  BONUS, rewardFor, splitDuration, warClock, warDay, warPhase, warProgress,
  type FeedItem, type NationalStanding, type PointGroup, type Reward, type StandingRow, type WarSnapshot,
} from "@/lib/war/model";
import { marker, stencil } from "./fonts";
import { useWarLive, type LiveState } from "./live";
import { HarbourScene } from "./scene";
import { Odometer, Reveal, initials, useFlip, useNow } from "./bits";

/** /no-peace — AIESEC in Alexandria's war board (v38, redesigned v38.1).
 *
 *  THE LEADERBOARD IS THE PAGE. A short header (the war clock), then the
 *  leaderboard as the main column with the live feed, the rewards and the
 *  national rank in a rail beside it; the point system and the rules below.
 *  A sticky nav reaches every section from anywhere. Read-only and public;
 *  every number is edited in Sodio's War Room and arrives over the live wire
 *  (live.ts). */

type Events = { at: string; fresh: FeedItem[]; deltas: Record<string, number>; enlisted: string[]; up: string[]; newLeader: string | null };
const NO_EVENTS: Events = { at: "", fresh: [], deltas: {}, enlisted: [], up: [], newLeader: null };

function diff(prev: WarSnapshot, next: WarSnapshot): Events {
  const seen = new Set(prev.feed.map((f) => f.id));
  const fresh = next.feed.filter((f) => !seen.has(f.id));
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
  const lead = (s: WarSnapshot) => s.rows.find((r) => r.points > 0)?.id ?? null;
  return { at: next.at, fresh, deltas, enlisted, up, newLeader: lead(next) !== lead(prev) ? lead(next) : null };
}

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const pad = (n: number) => String(n).padStart(2, "0");
const firstName = (n: string) => n.split(/\s+/)[0] ?? n;

function ago(iso: string, now: number | null): string {
  if (!now) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const GROUP_LABEL: Record<PointGroup, string> = { OGX: "OGX", ICX: "ICX", LC: "Across the LC" };

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
    const t = setTimeout(() => setEvents((e) => (e.at === events.at ? NO_EVENTS : e)), 60_000);
    return () => clearTimeout(t);
  }, [events.at]);

  const [modal, setModal] = useState<{ kind: "all" } | { kind: "one"; reward: Reward } | null>(null);
  const holders = useMemo(() => {
    const m = new Map<number, StandingRow[]>();
    for (const r of snap.rows) {
      const rw = rewardFor(r, s.rewards);
      if (rw) m.set(rw.rank, [...(m.get(rw.rank) ?? []), r]);
    }
    return m;
  }, [snap.rows, s.rewards]);

  const sections = [
    { id: "leaderboard", label: "Leaderboard" },
    ...(s.show.feed ? [{ id: "live", label: "Live feed" }] : []),
    { id: "rewards", label: "Rewards" },
    ...(s.show.national ? [{ id: "national", label: "National" }] : []),
    { id: "points", label: "Point system" },
    ...(s.rules.length ? [{ id: "rules", label: "Rules" }] : []),
  ];
  const spy = useScrollSpy(sections.map((x) => x.id));

  const latest = events.fresh[0];

  return (
    <div className={`np ${stencil.variable} ${marker.variable}`}>
      <Header snap={snap} now={now} state={state} sections={sections} active={spy.active} onPick={spy.pick} />
      <Hero snap={snap} now={now} onRewards={() => setModal({ kind: "all" })} />

      <div className="np-wrap">
        <div className="np-main">
          <Leaderboard snap={snap} events={events} />
          <aside className="np-rail" aria-label="Live feed, rewards and national rank">
            {s.show.feed ? <LiveFeed feed={snap.feed} now={now} state={state} fresh={events.fresh} /> : null}
            <RewardsCard rewards={s.rewards} minPoints={s.minPoints} holders={holders} onOpen={(r) => setModal({ kind: "one", reward: r })} />
            {s.show.national ? <National data={national} /> : null}
          </aside>
        </div>

        <PointSystem snap={snap} />
        {s.rules.length ? <Rules rules={s.rules} /> : null}
      </div>

      <footer className="np-foot">
        <div className="np-wrap">
          {s.motto ? <p className="np-motto">{s.motto}</p> : null}
          <AlexLogo className="np-foot-logo" base={72} />
          <div className="np-credit">
            <span>Powered by Sodio</span>
            <a href="http://elevate2point0.com/" target="_blank" rel="noreferrer" title="Created by 2.0 — elevate2point0.com">
              Created by
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

      {latest ? (
        <div key={`t-${events.at}`} className="np-toast" role="status" aria-live="polite">
          <b className="np-mono">
            {latest.points >= 0 ? "+" : ""}
            {latest.points}
          </b>
          <span>
            <b>{latest.name}</b> · {latest.label}
            {latest.kind !== BONUS && latest.qty > 1 ? ` ×${latest.qty}` : ""}
            {events.fresh.length > 1 ? ` · +${events.fresh.length - 1} more` : ""}
          </span>
        </div>
      ) : null}

      {modal ? (
        <RewardModal
          modal={modal}
          rewards={s.rewards}
          minPoints={s.minPoints}
          holders={holders}
          onPick={(r) => setModal({ kind: "one", reward: r })}
          onAll={() => setModal({ kind: "all" })}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

/** Which section the reader is in — the last one whose top has crossed a
 *  line 35% down the screen. A nav click wins outright for a moment, so the
 *  item you pressed lights up even when the page can't scroll that section
 *  all the way to the top (the last ones, near the bottom). */
function useScrollSpy(ids: string[]): { active: string; pick: (id: string) => void } {
  const key = ids.join(",");
  const [active, setActive] = useState(ids[0] ?? "");
  const [lockUntil, setLockUntil] = useState(0);
  useEffect(() => {
    const list = key.split(",");
    let raf = 0;
    const read = () => {
      raf = 0;
      if (Date.now() < lockUntil) return;
      const line = window.innerHeight * 0.35;
      let cur = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) cur = id;
      }
      setActive((a) => (a === cur ? a : cur));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key, lockUntil]);
  return {
    active,
    pick: (id) => {
      setActive(id);
      setLockUntil(Date.now() + 1200);
    },
  };
}

function AlexLogo({ className, base }: { className?: string; base: 44 | 72 }) {
  const set = base === 44 ? [44, 88, 132] : [72, 144, 216];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={`/brand/no-peace/alex-${set[0]}.png`}
      srcSet={set.map((h, i) => `/brand/no-peace/alex-${h}.png ${i + 1}x`).join(", ")}
      alt="AIESEC in Alexandria"
      height={base}
      width={Math.round((base * 699) / 388)}
    />
  );
}

// ------------------------------------------------------------------ header

function Header({
  snap, now, state, sections, active, onPick,
}: {
  snap: WarSnapshot;
  now: number | null;
  state: LiveState;
  sections: { id: string; label: string }[];
  active: string;
  onPick: (id: string) => void;
}) {
  const s = snap.settings;
  const clock = warClock(s);
  const left = now ? splitDuration(clock.activate - now) : null;
  const on = now !== null && now >= clock.activate;
  const links = (cls?: string) =>
    sections.map((x) => (
      <a key={x.id} href={`#${x.id}`} aria-current={active === x.id ? "true" : undefined} className={cls} onClick={() => onPick(x.id)}>
        {x.label}
      </a>
    ));
  return (
    <header className="np-header">
      <div className="np-wrap np-header-row">
        <a href="#top" className="np-brand" aria-label={`${s.name} — back to the top`}>
          <AlexLogo base={44} />
          <span className="np-brand-sep" />
          <span className="np-brand-name">{s.name.toUpperCase()}</span>
        </a>
        <nav className="np-nav" aria-label="Sections">
          {links()}
        </nav>
        <div className="np-head-right">
          <div className="np-activate" title={`${s.activateLabel} · ${fmtDay(s.activateDate)} ${s.activateTime}`}>
            <span className="np-label">{on ? s.activateLabel : `${s.activateLabel} in`}</span>
            <b>{on ? "it's on" : left ? `${left.d}d ${pad(left.h)}h ${pad(left.m)}m` : "—"}</b>
          </div>
          <span
            className="np-live"
            data-state={state}
            title={state === "live" ? "Live — numbers move the moment they're logged" : state === "connecting" ? "Connecting…" : "Refreshing every minute"}
          >
            <span className="np-dot" />
            {state === "live" ? "Live" : state === "connecting" ? "…" : "Auto"}
          </span>
        </div>
      </div>
      <nav className="np-subnav" aria-label="Sections">
        {links()}
      </nav>
    </header>
  );
}

// ------------------------------------------------------------------ hero

function Hero({ snap, now, onRewards }: { snap: WarSnapshot; now: number | null; onRewards: () => void }) {
  const s = snap.settings;
  const clock = warClock(s);
  const phase = now ? warPhase(clock, now) : "live";
  const left = now ? splitDuration((phase === "before" ? clock.start : clock.end) - now) : null;
  const p = now ? warProgress(clock, now) : 0;
  const day = now ? warDay(clock, now) : 0;
  return (
    <section className="np-hero" id="top">
      <HarbourScene />
      <span className="np-coords">31.2140° N · 29.8856° E</span>
      <div className="np-wrap np-hero-grid">
        <div>
          <span className="np-eyebrow">
            AIESEC in Alexandria<span className="np-sm-hide">&nbsp;· War declaration</span>
          </span>
          <h1 className="np-title">{s.name.toUpperCase()}</h1>
          {s.heroLines.length ? <p className="np-lines">{s.heroLines.map((l) => l.replace(/[.\s]+$/, "")).join(". ")}.</p> : null}
          {s.tagline ? <p className="np-tagline">{s.tagline}</p> : null}
          <div className="np-ctas">
            <a href="#leaderboard" className="np-btn np-btn-primary">
              <span className="np-sm-hide">View the leaderboard</span>
              <span className="np-sm-only">Leaderboard</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </a>
            <button type="button" className="np-btn np-btn-ghost" onClick={onRewards}>
              War rewards
            </button>
          </div>
        </div>

        <div className="np-clock-card">
          <span className="np-label">
            {phase === "before" ? "The war starts in" : phase === "live" ? "The war ends in" : "The war is over"}
          </span>
          {phase !== "over" ? (
            <div className="np-clock" role="timer" aria-label={left ? `${left.d} days ${left.h} hours ${left.m} minutes` : undefined}>
              {(
                [
                  [left?.d, "days"],
                  [left?.h, "hours"],
                  [left?.m, "min"],
                  [left?.s, "sec"],
                ] as const
              ).map(([v, u]) => (
                <div key={u}>
                  <span className="np-clock-n">{v === undefined ? "--" : pad(v)}</span>
                  <span className="np-clock-u">{u}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="np-display" style={{ fontSize: 30, marginTop: 10 }}>Final standings</p>
          )}
          <div className="np-track" aria-hidden>
            <i style={{ width: `${p * 100}%` }} />
            <b style={{ left: `${p * 100}%` }} />
          </div>
          <div className="np-track-legend">
            <span>{phase === "before" ? "Not started" : phase === "over" ? `All ${clock.totalDays} days fought` : `Day ${day} of ${clock.totalDays}`}</span>
            <span>
              {fmtDay(s.startDate)} → {fmtDay(s.endDate)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ leaderboard

function Avatar({ row }: { row: StandingRow }) {
  return row.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={row.avatar} alt="" className="np-avatar" loading="lazy" />
  ) : (
    <span className="np-avatar" aria-hidden>
      {initials(row.name)}
    </span>
  );
}

const PAGE = 20;

function Leaderboard({ snap, events }: { snap: WarSnapshot; events: Events }) {
  const s = snap.settings;
  const [q, setQ] = useState("");
  const [fn, setFn] = useState("");
  const [onlyEnlisted, setOnlyEnlisted] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const fns = useMemo(() => [...new Set(snap.rows.map((r) => r.fn))].sort(), [snap.rows]);
  const types = useMemo(() => new Map(s.pointTypes.map((t) => [t.key, t])), [s.pointTypes]);

  const podium = snap.rows.filter((r) => r.points > 0).slice(0, 3);
  const filtering = !!q.trim() || !!fn || onlyEnlisted;
  const term = q.trim().toLowerCase();
  const matches = snap.rows.filter(
    (r) => (!term || r.name.toLowerCase().includes(term)) && (!fn || r.fn === fn) && (!onlyEnlisted || r.eligible)
  );
  const podiumIds = new Set(podium.map((r) => r.id));
  const list = filtering ? matches : matches.filter((r) => !podiumIds.has(r.id));
  const shown = all || filtering ? list : list.slice(0, PAGE);
  const scale = Math.max(s.minPoints * 1.4, ...snap.rows.map((r) => r.points), 1);
  const flipRef = useFlip(shown.map((r) => r.id).join(","));

  return (
    <section className="np-card" id="leaderboard" aria-labelledby="np-lb-title">
      <div className="np-board-head">
        <div>
          <h2 className="np-h2" id="np-lb-title">Leaderboard</h2>
          <p className="np-board-sub">
            <b>{snap.totals.troops}</b> in the race · <b>{snap.totals.enlisted}</b> over the {s.minPoints}-point line ·{" "}
            <b>{snap.totals.points.toLocaleString()}</b> war points so far
          </p>
        </div>
      </div>

      {podium.length ? (
        <div className="np-podium">
          {[podium[1], podium[0], podium[2]].map((r, i) =>
            r ? (
              <div
                key={r.id}
                className={`np-pod ${i === 1 ? "np-first" : i === 2 ? "np-third" : ""} ${events.newLeader === r.id ? "np-shine" : ""}`}
              >
                <span className="np-pod-rank">{r.rank}</span>
                <Avatar row={r} />
                <span className="np-pod-name" dir="auto">{r.name}</span>
                <span className="np-pod-fn">{r.fn}</span>
                <span className="np-pod-pts">
                  <Odometer value={r.points} />
                </span>
                {(() => {
                  const rw = rewardFor(r, s.rewards);
                  return rw ? (
                    <span className="np-pod-reward">{rw.emoji} {rw.title}</span>
                  ) : (
                    <span className="np-pod-reward np-off">
                      {r.eligible ? "Enlisted" : `${s.minPoints - r.points} to the ${s.minPoints} line`}
                    </span>
                  );
                })()}
              </div>
            ) : (
              <div key={`empty-${i}`} />
            )
          )}
        </div>
      ) : (
        <p className="np-empty">No points logged yet. The first ones take the top of the board.</p>
      )}

      <div className="np-tools">
        <label className="np-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input className="np-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone…" aria-label="Search by name" />
        </label>
        <select className="np-select" value={fn} onChange={(e) => setFn(e.target.value)} aria-label="Function">
          <option value="">All functions</option>
          {fns.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button type="button" className="np-toggle" aria-pressed={onlyEnlisted} onClick={() => setOnlyEnlisted((v) => !v)}>
          {s.minPoints}+ only
        </button>
      </div>

      <div className="np-thead np-label" aria-hidden>
        <span>#</span>
        <span>{filtering ? `${matches.length} found` : podium.length ? `From #${podium.length + 1}` : "Everyone"}</span>
        <span>Progress to {s.minPoints}</span>
        <span>Points</span>
      </div>

      <div className="np-rows" ref={flipRef}>
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
              data-flash={events.up.includes(r.id) ? "true" : undefined}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen(isOpen ? null : r.id);
                }
              }}
            >
              <span className="np-rank">
                {r.rank}
                {d ? <span className={`np-move ${d > 0 ? "up" : "down"}`}>{d > 0 ? `▲${d}` : `▼${-d}`}</span> : null}
              </span>
              <span className="np-who">
                <Avatar row={r} />
                <span style={{ minWidth: 0 }}>
                  <span className="np-name" dir="auto" style={{ display: "block" }}>
                    {r.name}
                    {reward ? <span title={reward.title}> {reward.emoji}</span> : null}
                    {r.eligible ? (
                      <span className={`np-tag ${events.enlisted.includes(r.id) ? "np-new" : ""}`} title={`${s.minPoints}+ war points — in the race for rewards`}>
                        Enlisted
                      </span>
                    ) : null}
                  </span>
                  <span className="np-meta" style={{ display: "block" }}>
                    {r.fn} · {r.role}
                  </span>
                </span>
              </span>
              <span className="np-bar-cell">
                <span className="np-bar" title={`${r.points} of ${s.minPoints}`} style={{ display: "block" }}>
                  <i style={{ width: `${Math.min(100, (Math.max(0, r.points) / scale) * 100)}%` }} />
                  <b style={{ left: `${(s.minPoints / scale) * 100}%` }} />
                </span>
              </span>
              <span className="np-pts">
                <Odometer value={r.points} />
              </span>
              {isOpen ? (
                <span className="np-break">
                  {Object.keys(r.breakdown).length === 0 ? (
                    <span>{s.show.breakdown ? "No points yet." : "Breakdowns are private."}</span>
                  ) : (
                    Object.entries(r.breakdown).map(([k, v]) =>
                      k === BONUS ? (
                        <span key={k}>
                          Bonus <b>{v >= 0 ? "+" : ""}{v}</b>
                        </span>
                      ) : (
                        <span key={k}>
                          {types.get(k)?.label ?? k} ×{v} = <b>{(types.get(k)?.points ?? 0) * v}</b>
                        </span>
                      )
                    )
                  )}
                </span>
              ) : null}
            </div>
          );
        })}
        {shown.length === 0 ? <p className="np-empty">{filtering ? "Nobody matches that." : "Everyone in the race is on the podium."}</p> : null}
      </div>
      {!all && !filtering && list.length > shown.length ? (
        <div className="np-more">
          <button type="button" className="np-btn np-btn-ghost" onClick={() => setAll(true)}>
            Show all {snap.rows.length}
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ rail

function LiveFeed({ feed, now, state, fresh }: { feed: FeedItem[]; now: number | null; state: LiveState; fresh: FeedItem[] }) {
  const newIds = new Set(fresh.map((f) => f.id));
  return (
    <section className="np-card" id="live" aria-labelledby="np-live-title">
      <div className="np-card-head">
        <h2 className="np-card-title" id="np-live-title">Live feed</h2>
        <span className="np-live" data-state={state}>
          <span className="np-dot" />
          {state === "live" ? "Live" : "Auto"}
        </span>
      </div>
      {feed.length === 0 ? (
        <p className="np-note" style={{ borderTop: 0, paddingTop: 0 }}>Nothing logged yet — points appear here the moment they&apos;re logged.</p>
      ) : (
        <ul className="np-feed">
          {feed.slice(0, 8).map((f) => (
            <li key={f.id} className={newIds.has(f.id) ? "np-new" : undefined}>
              <span className={`np-feed-pts ${f.points < 0 ? "neg" : ""}`}>
                {f.points >= 0 ? "+" : ""}
                {f.points}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="np-feed-name" dir="auto" style={{ display: "block" }}>{f.name}</span>
                <span className="np-feed-what" style={{ display: "block" }}>
                  {f.label}
                  {f.kind !== BONUS && f.qty > 1 ? ` ×${f.qty}` : ""}
                </span>
              </span>
              <span className="np-feed-when">{ago(f.at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RewardsCard({
  rewards, minPoints, holders, onOpen,
}: {
  rewards: Reward[];
  minPoints: number;
  holders: Map<number, StandingRow[]>;
  onOpen: (r: Reward) => void;
}) {
  return (
    <section className="np-card" id="rewards" aria-labelledby="np-rw-title">
      <div className="np-card-head">
        <h2 className="np-card-title" id="np-rw-title">War rewards</h2>
      </div>
      {rewards.map((r) => {
        const h = holders.get(r.rank);
        return (
          <button key={`${r.rank}-${r.title}`} type="button" className="np-reward" onClick={() => onOpen(r)}>
            <span className="np-reward-emoji" aria-hidden>{r.emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span className="np-label" style={{ display: "block", fontSize: 10.5 }}>{r.place}</span>
              <span className="np-reward-title" style={{ display: "block" }}>{r.title}</span>
              <span className="np-reward-holder" style={{ display: "block" }}>
                {h?.length ? `Held by ${h.map((x) => firstName(x.name)).join(" & ")}` : "Unclaimed"}
              </span>
            </span>
            <svg className="np-reward-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        );
      })}
      <p className="np-note">At least {minPoints} war points to compete. Ties share a rank.</p>
    </section>
  );
}

function National({ data }: { data: NationalStanding | null }) {
  const [stage, setStage] = useState(0);
  const st = data?.stages[Math.min(stage, (data?.stages.length ?? 1) - 1)];
  const total = st?.cells.find((c) => c.program.toLowerCase() === "total");
  const programs = st?.cells.filter((c) => c.program.toLowerCase() !== "total") ?? [];
  return (
    <section className="np-card" id="national" aria-labelledby="np-nat-title">
      <div className="np-card-head">
        <h2 className="np-card-title" id="np-nat-title">Alexandria in Egypt</h2>
        {data ? (
          <div className="np-seg" role="tablist" aria-label="Stage">
            {data.stages.map((x, i) => (
              <button key={x.stage} type="button" role="tab" aria-selected={i === stage} onClick={() => setStage(i)}>
                {x.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!data || !st ? (
        <p className="np-note" style={{ borderTop: 0, paddingTop: 0 }}>CORE isn&apos;t answering right now — this reloads every 15 minutes.</p>
      ) : (
        <>
          <div className="np-nat-total">
            <span className="np-display">{total?.rank ? `#${total.rank}` : "10+"}</span>
            <span style={{ color: "var(--np-muted)", fontSize: 13.5 }}>
              nationally · {st.label.toLowerCase()}
              {total?.count != null ? (
                <>
                  <br />
                  <b style={{ color: "var(--np-text)" }}>{total.count}</b> {total.leader && total.rank !== 1 ? `· #1 ${total.leader.lc} (${total.leader.count})` : ""}
                </>
              ) : null}
            </span>
          </div>
          {programs.map((c) => (
            <div key={c.program} className="np-nat-row" title={c.leader ? `#1 ${c.leader.lc} (${c.leader.count})` : undefined}>
              <span style={{ fontWeight: 700 }}>{c.program}</span>
              <span className="np-nat-bar">
                <i style={{ width: `${c.count && c.leader?.count ? Math.max(3, (c.count / c.leader.count) * 100) : 0}%` }} />
              </span>
              <span className="np-mono" style={{ color: c.rank && c.rank <= 3 ? "var(--np-brass-2)" : undefined }}>
                {c.rank ? `#${c.rank}` : "10+"}
              </span>
            </div>
          ))}
          <p className="np-note">
            From{" "}
            <a href="https://core.aiesec.org.eg" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              CORE
            </a>{" "}
            · bars compare us with #1 · CORE lists the top 10 only
          </p>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ point system + rules

function PointSystem({ snap }: { snap: WarSnapshot }) {
  const s = snap.settings;
  const groups = (["OGX", "ICX", "LC"] as PointGroup[])
    .map((g) => ({ g, items: s.pointTypes.filter((t) => t.group === g) }))
    .filter((x) => x.items.length || x.g === "LC");
  return (
    <section className="np-section" id="points" aria-labelledby="np-pts-title">
      <Reveal className="np-section-head">
        <h2 className="np-h2" id="np-pts-title">The point system</h2>
        <p>What every achievement is worth in war points.</p>
      </Reveal>
      <div className="np-points">
        {groups.map(({ g, items }) => (
          <Reveal key={g}>
            <div className="np-card">
              <div className="np-card-head">
                <h3 className="np-card-title">{GROUP_LABEL[g]}</h3>
              </div>
              {items.map((t) => {
                const used = snap.totals.byKind[t.key];
                return (
                  <div key={t.key} className="np-point">
                    <span style={{ minWidth: 0 }}>
                      <span className="np-point-label" style={{ display: "block" }}>{t.label}</span>
                      <span className="np-point-hint" style={{ display: "block" }}>
                        {t.hint}
                        {used ? ` · scored ${used.qty}×` : ""}
                      </span>
                    </span>
                    <span className="np-point-val">{t.points}</span>
                  </div>
                );
              })}
              {g === "LC" ? (
                <div className="np-point">
                  <span style={{ minWidth: 0 }}>
                    <span className="np-point-label" style={{ display: "block" }}>BONUS</span>
                    <span className="np-point-hint" style={{ display: "block" }}>Attendance & engagement, at every checkpoint</span>
                  </span>
                  <span className="np-point-val">±</span>
                </div>
              ) : null}
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Rules({ rules }: { rules: string[] }) {
  return (
    <section className="np-section" id="rules" aria-labelledby="np-rules-title">
      <Reveal className="np-section-head">
        <h2 className="np-h2" id="np-rules-title">Rules of engagement</h2>
      </Reveal>
      <Reveal>
        <div className="np-memo">
          <ol>
            {rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </div>
      </Reveal>
    </section>
  );
}

// ------------------------------------------------------------------ rewards modal

function RewardModal({
  modal, rewards, minPoints, holders, onPick, onAll, onClose,
}: {
  modal: { kind: "all" } | { kind: "one"; reward: Reward };
  rewards: Reward[];
  minPoints: number;
  holders: Map<number, StandingRow[]>;
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
      <div className="np-modal" role="dialog" aria-modal="true" aria-label="War rewards" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="np-x" onClick={onClose} aria-label="Close" autoFocus>
          ×
        </button>
        {modal.kind === "one" ? (
          <>
            <div className="np-modal-emoji" aria-hidden>{modal.reward.emoji}</div>
            <p className="np-label" style={{ marginTop: 14, color: "var(--np-brass)" }}>{modal.reward.place}</p>
            <h3 className="np-display" style={{ margin: "6px 0 0", fontSize: 30, lineHeight: 1.05 }}>{modal.reward.title}</h3>
            {modal.reward.detail ? <p style={{ marginTop: 12, color: "var(--np-muted)" }}>{modal.reward.detail}</p> : null}
            <div className="np-modal-holder">
              {holders.get(modal.reward.rank)?.length ? (
                <>
                  In line right now:{" "}
                  <b>{holders.get(modal.reward.rank)!.map((h) => `${h.name} (${h.points})`).join(", ")}</b>
                </>
              ) : (
                <>Nobody holds it yet. Reach {minPoints} war points and climb.</>
              )}
            </div>
            <button type="button" className="np-btn np-btn-ghost" style={{ marginTop: 16 }} onClick={onAll}>
              All rewards
            </button>
          </>
        ) : (
          <>
            <h3 className="np-display" style={{ margin: 0, fontSize: 30 }}>War rewards</h3>
            <p style={{ marginTop: 6, color: "var(--np-muted)", fontSize: 14 }}>At least {minPoints} war points to compete.</p>
            <div style={{ marginTop: 16, textAlign: "left", border: "1px solid var(--np-line)", borderRadius: 14, overflow: "hidden" }}>
              {rewards.map((r, i) => (
                <button
                  key={`${r.rank}-${r.title}`}
                  type="button"
                  className="np-reward"
                  style={i === 0 ? { borderTop: 0 } : undefined}
                  onClick={() => onPick(r)}
                >
                  <span className="np-reward-emoji" aria-hidden>{r.emoji}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="np-label" style={{ display: "block", fontSize: 10.5 }}>{r.place}</span>
                    <span className="np-reward-title" style={{ display: "block" }}>{r.title}</span>
                  </span>
                  <svg className="np-reward-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
