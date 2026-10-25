"use client";

import "./no-peace.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BONUS, rewardFor, splitDuration, warClock, warDay, warPhase, warProgress,
  type FeedItem, type FunctionRow, type NationalStanding, type PointGroup, type Reward, type StandingRow, type WarSnapshot,
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

type Events = { at: string; fresh: FeedItem[]; deltas: Record<string, number>; enlisted: string[]; up: string[]; fnUp: string[]; newLeader: string | null };
const NO_EVENTS: Events = { at: "", fresh: [], deltas: {}, enlisted: [], up: [], fnUp: [], newLeader: null };

function diff(prev: WarSnapshot, next: WarSnapshot): Events {
  const seen = new Set(prev.feed.map((f) => f.id));
  // only entries newer than the newest one already shown: deleting an entry
  // pulls an OLD one back into the 40-item feed, and that is not news. An
  // empty feed with entries behind it is a hidden feed — nothing to compare.
  const since = prev.feed[0] ? Date.parse(prev.feed[0].at) : 0;
  const fresh =
    prev.feed.length === 0 && prev.totals.entries > 0
      ? []
      : next.feed.filter((f) => !seen.has(f.id) && Date.parse(f.at) >= since);
  const before = new Map(prev.rows.map((r) => [r.id, r]));
  const deltas: Record<string, number> = {};
  const enlisted: string[] = [];
  const up: string[] = [];
  for (const r of next.rows) {
    const b = before.get(r.id);
    if (!b) continue;
    // unscored rows all share a rank — moving among them is not a move
    if (b.rank !== r.rank && b.points > 0 && r.points > 0) deltas[r.id] = b.rank - r.rank;
    if (!b.eligible && r.eligible) enlisted.push(r.id);
    if (r.points > b.points) up.push(r.id);
  }
  const lead = (s: WarSnapshot) => s.rows.find((r) => r.points > 0)?.id ?? null;
  // functions whose total went up — their row flashes like a person's
  const fnBefore = new Map((prev.functions ?? []).map((f) => [f.fn, f.points]));
  const fnUp = (next.functions ?? []).filter((f) => f.points > (fnBefore.get(f.fn) ?? 0)).map((f) => f.fn);
  return { at: next.at, fresh, deltas, enlisted, up, fnUp, newLeader: lead(next) !== lead(prev) ? lead(next) : null };
}

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const pad = (n: number) => String(n).padStart(2, "0");
const firstName = (n: string) => n.split(/\s+/)[0] ?? n;

function ago(iso: string, now: number | null): string {
  if (!now) return "";
  // floor in every bucket — rounding showed "60m" and "24h"
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const GROUP_LABEL: Record<PointGroup, string> = { OGX: "OGX", ICX: "ICX", LC: "Across the LC" };

/** Who a reward's place belongs to right now. Ties share a rank, so a tie
 *  of n at rank R covers places R … R+n−1: two people tied first are BOTH in
 *  line for the 1st and the 2nd reward, and the LC decides who gets which. */
type Claim = { tied: boolean; who: StandingRow[] };
function claimsByPlace(rows: StandingRow[]): Map<number, Claim> {
  const groups = new Map<number, StandingRow[]>();
  for (const r of rows) if (r.eligible) groups.set(r.rank, [...(groups.get(r.rank) ?? []), r]);
  const m = new Map<number, Claim>();
  for (const [rank, who] of groups) for (let p = rank; p < rank + who.length; p++) m.set(p, { tied: who.length > 1, who });
  return m;
}
const joinNames = (who: StandingRow[]) => {
  const n = who.map((x) => firstName(x.name));
  return n.length > 3 ? `${n.slice(0, 3).join(", ")} +${n.length - 3}` : n.length > 1 ? `${n.slice(0, -1).join(", ")} & ${n.at(-1)}` : n[0];
};
function claimLine(c: Claim | undefined): string {
  if (!c) return "Unclaimed";
  return c.tied ? `Tied: ${joinNames(c.who)} — LC decides` : `Held by ${joinNames(c.who)}`;
}
const TIE_NOTE = "Ties share a rank; the LC decides who gets which reward.";

function scoreText(f: FeedItem, more: number): string {
  return `${f.name} ${f.points >= 0 ? "scored +" : "lost "}${Math.abs(f.points)} · ${f.label}${f.kind !== BONUS && f.qty > 1 ? ` ×${f.qty}` : ""}${more ? ` · ${more} more` : ""}`;
}

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

  // the toast has its own ~4.7 s life (the 60 s window above is for row
  // flashes and feed highlights): v38 left it on screen, invisible but
  // catching taps, for the whole minute. A timer, not onAnimationEnd — under
  // reduced motion there is no animation to end.
  const [toastDone, setToastDone] = useState("");
  // the screen-reader line: empty when a new score lands, filled a beat later,
  // so the live region is heard changing (a region mounted full often isn't)
  const [said, setSaid] = useState({ at: "", text: "" });
  useEffect(() => {
    if (!events.at) return;
    const at = events.at;
    const f = events.fresh[0];
    const t1 = setTimeout(() => setToastDone(at), 4700);
    const t2 = f ? setTimeout(() => setSaid({ at, text: scoreText(f, events.fresh.length - 1) }), 100) : undefined;
    return () => {
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [events.at, events.fresh]);

  const [modal, setModal] = useState<{ kind: "all" } | { kind: "one"; reward: Reward } | null>(null);
  const closeModal = useCallback(() => setModal(null), []);
  const openAll = useCallback(() => setModal({ kind: "all" }), []);
  const claims = useMemo(() => claimsByPlace(snap.rows), [snap.rows]);

  const sections = [
    { id: "leaderboard", label: "Leaderboard" },
    ...(s.show.feed ? [{ id: "live", label: "Live feed" }] : []),
    { id: "rewards", label: "Rewards" },
    ...(s.show.national ? [{ id: "national", label: "National" }] : []),
    { id: "points", label: "Point system" },
    ...(s.rules.length ? [{ id: "rules", label: "Rules" }] : []),
  ];
  const spy = useScrollSpy(sections.map((x) => x.id));

  const latest = events.at && events.at !== toastDone ? events.fresh[0] : undefined;

  return (
    <div className={`np ${stencil.variable} ${marker.variable}`}>
      <Header snap={snap} now={now} state={state} sections={sections} active={spy.active} onPick={spy.pick} />
      <Hero snap={snap} now={now} onRewards={openAll} />

      <main className="np-wrap">
        <div className="np-main">
          <Leaderboard snap={snap} events={events} />
          <aside className="np-rail" aria-label="Live feed, rewards and national rank">
            {s.show.feed ? <LiveFeed feed={snap.feed} now={now} state={state} fresh={events.fresh} /> : null}
            <RewardsCard rewards={s.rewards} minPoints={s.minPoints} claims={claims} onOpen={(r) => setModal({ kind: "one", reward: r })} onAll={openAll} />
            {s.show.national ? <National data={national} /> : null}
          </aside>
        </div>

        <PointSystem snap={snap} />
        {s.rules.length ? <Rules rules={s.rules} /> : null}
      </main>

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

      <div className="np-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {said.at === events.at ? said.text : ""}
      </div>
      {latest ? (
        <div key={`t-${events.at}`} className={`np-toast ${latest.points < 0 ? "neg" : ""}`} aria-hidden>
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
          claims={claims}
          onPick={(r) => setModal({ kind: "one", reward: r })}
          onAll={openAll}
          onClose={closeModal}
        />
      ) : null}
    </div>
  );
}

/** Which section the reader is in — the last one whose top has crossed a
 *  line 35% down the screen. A nav click wins outright for a moment, so the
 *  item you pressed lights up even when the page can't scroll that section
 *  all the way to the top (the last ones, near the bottom).
 *
 *  From 1100px the rail sits BESIDE the leaderboard, so its cards' tops cross
 *  the line while the reader is still on the board — there they are skipped
 *  and light up only from a click. */
const RAIL_IDS = new Set(["live", "rewards", "national"]);
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
      const twoCol = window.matchMedia("(min-width: 1100px)").matches;
      const line = window.innerHeight * 0.35;
      let cur = list[0];
      for (const id of list) {
        if (twoCol && RAIL_IDS.has(id)) continue;
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) cur = id;
      }
      setActive((a) => (a === cur ? a : cur));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
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
  // on a phone the section strip scrolls sideways — keep the current chip in
  // view (scrolling the strip itself, never the page)
  const strip = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = strip.current;
    const chip = el?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!el || !chip || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: chip.offsetLeft - (el.clientWidth - chip.offsetWidth) / 2, behavior: "smooth" });
  }, [active]);
  // fade the strip's right edge while there are more chips off-screen —
  // otherwise nothing says the strip scrolls at all
  const count = sections.length;
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const check = () => {
      if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) el.dataset.more = "";
      else delete el.dataset.more;
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      ro?.disconnect();
    };
  }, [count]);
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
      <nav className="np-subnav" aria-label="Sections" ref={strip}>
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
  const dhm = left ? `${left.d}d ${pad(left.h)}h ${pad(left.m)}m` : "—";
  return (
    <section className="np-hero" id="top">
      <HarbourScene />
      <span className="np-coords" aria-hidden>31.2140° N · 29.8856° E</span>
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
            <p className="np-display np-clock-final" style={{ fontSize: 30, marginTop: 10 }}>Final standings</p>
          )}
          {/* phones and short landscape screens: the whole clock on one line,
              so the leaderboard starts on the first screen */}
          <p className="np-clock-line">
            {phase === "before" ? (
              <>Starts in {dhm}</>
            ) : phase === "live" ? (
              <>
                {dhm} left <span>· Day {day} of {clock.totalDays}</span>
              </>
            ) : (
              <>The war is over <span>· all {clock.totalDays} days fought</span></>
            )}
          </p>
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

const nf = new Intl.NumberFormat("en-GB");

/** The function race (v38.3): one row per function, a bar against the leader,
 *  total points rolling like the people's. Ties share a rank; a function
 *  nobody has scored for yet shows "—". */
function FunctionRace({ rows, up }: { rows: FunctionRow[]; up: string[] }) {
  const lead = Math.max(1, rows[0]?.points ?? 0);
  const flipRef = useFlip<HTMLOListElement>(rows.map((f) => f.fn).join(","));
  return (
    <ol className="np-frows" ref={flipRef} aria-label="Function standings">
      {rows.map((f) => (
        <li
          key={f.fn}
          data-flip={f.fn}
          className={`np-frow ${f.points > 0 && f.rank === 1 ? "np-flead" : ""}`}
          data-flash={up.includes(f.fn) ? "true" : undefined}
        >
          <span className="np-frank" aria-label={f.points > 0 ? `rank ${f.rank}` : "unranked"}>
            {f.points > 0 ? f.rank : "—"}
          </span>
          <span className="np-fbody">
            <span className="np-fhead">
              <span className="np-fname">{f.fn}</span>
              <span className="np-fmeta">
                {f.scorers} of {f.troops} scored{f.top ? ` · top: ${firstName(f.top.name)} (${f.top.points})` : ""}
              </span>
            </span>
            <span className="np-fbar" aria-hidden>
              <i style={{ width: `${(Math.max(0, f.points) / lead) * 100}%` }} />
            </span>
          </span>
          <span className="np-fpts">
            <Odometer value={f.points} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function Leaderboard({ snap, events }: { snap: WarSnapshot; events: Events }) {
  const s = snap.settings;
  const [q, setQ] = useState("");
  const [fn, setFn] = useState("");
  const [onlyEnlisted, setOnlyEnlisted] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  // v38.3 — people race people, functions race functions; one card, two views.
  // A shared link can open straight on the function race with #functions.
  const fnRace = snap.functions ?? [];
  const [view, setView] = useState<"people" | "functions">("people");
  useEffect(() => {
    if (window.location.hash !== "#functions") return;
    // after hydration (the server can't see the hash), never during render
    const t = setTimeout(() => setView("functions"), 0);
    return () => clearTimeout(t);
  }, []);
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
  // "From #4" was wrong under ties — name the first rank actually listed
  const from = list[0] && list[0].points > 0 ? `From #${list[0].rank}` : "Name";

  return (
    <section className="np-card" id="leaderboard" aria-labelledby="np-lb-title">
      <div className="np-board-head">
        <div>
          <h2 className="np-h2" id="np-lb-title">Leaderboard</h2>
          {view === "functions" ? (
            <p className="np-board-sub">
              <b>{fnRace.length}</b> functions at war · total war points, each person counted for their main function
            </p>
          ) : (
            <p className="np-board-sub">
              <b>{snap.totals.troops}</b> in the race · <b>{snap.totals.enlisted}</b> over the {s.minPoints}-point line ·{" "}
              <b>{nf.format(snap.totals.points)}</b> war points so far
            </p>
          )}
        </div>
        {fnRace.length ? (
          <div className="np-seg np-view" role="group" aria-label="Who is racing">
            <button type="button" aria-pressed={view === "people"} onClick={() => setView("people")}>
              People
            </button>
            <button type="button" aria-pressed={view === "functions"} onClick={() => setView("functions")}>
              Functions
            </button>
          </div>
        ) : null}
      </div>

      {view === "functions" && fnRace.length ? (
        <FunctionRace rows={fnRace} up={events.fnUp} />
      ) : snap.rows.length === 0 ? (
        <p className="np-empty">Nobody is in the race yet.</p>
      ) : (
        <>
          {podium.length ? (
            <div className="np-podium">
              {[podium[1], podium[0], podium[2]].map((r, i) =>
                r ? (
                  <div
                    key={r.id}
                    // size follows the slot (the middle one is the tallest),
                    // colour follows the RANK — a tied #2 is silver, not bronze
                    className={`np-pod ${i === 1 ? "np-center" : ""} ${r.rank === 1 ? "np-gold" : r.rank === 2 ? "" : "np-bronze"} ${events.newLeader === r.id ? "np-shine" : ""}`}
                  >
                    <span className="np-pod-rank">{r.rank}</span>
                    <Avatar row={r} />
                    <span className="np-pod-name" dir="auto" title={r.name}>
                      <span className="np-pod-full">{r.name}</span>
                      <span className="np-pod-first" aria-hidden>{firstName(r.name)}</span>
                    </span>
                    <span className="np-pod-fn">{r.fn}</span>
                    <span className="np-pod-pts">
                      <Odometer value={r.points} />
                    </span>
                    {(() => {
                      const rw = rewardFor(r, s.rewards);
                      return rw ? (
                        <span className="np-pod-reward" title={rw.title}>
                          {rw.emoji}
                          <span className="np-pod-reward-t"> {rw.title}</span>
                        </span>
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
            <span>{filtering ? `${matches.length} found` : podium.length ? from : "Everyone"}</span>
            <span>Progress to {s.minPoints}</span>
            <span>Points</span>
          </div>

          <div className="np-rows" ref={flipRef}>
            {shown.map((r) => {
              const scored = r.points > 0;
              const d = scored ? events.deltas[r.id] : undefined;
              const reward = rewardFor(r, s.rewards);
              const isOpen = open === r.id;
              const tag = (where: "wide" | "narrow") =>
                r.eligible ? (
                  <span
                    className={`np-tag np-tag-${where} ${events.enlisted.includes(r.id) ? "np-new" : ""}`}
                    title={`${s.minPoints}+ war points — in the race for rewards`}
                  >
                    Enlisted
                  </span>
                ) : null;
              return (
                <div key={r.id} data-flip={r.id} className="np-row" data-eligible={r.eligible} data-open={isOpen ? "true" : undefined}>
                  {/* a second score inside the 60 s window remounts this and flashes again */}
                  {events.up.includes(r.id) ? <span key={events.at} className="np-row-flash" aria-hidden /> : null}
                  <button
                    type="button"
                    className="np-row-btn"
                    aria-expanded={isOpen}
                    aria-controls={`np-br-${r.id}`}
                    onClick={() => setOpen(isOpen ? null : r.id)}
                  >
                    <span className="np-rank">
                      {scored ? (
                        r.rank
                      ) : (
                        <>
                          <span aria-hidden>—</span>
                          <span className="np-sr-only">unranked</span>
                        </>
                      )}
                      {d ? (
                        <span className={`np-move ${d > 0 ? "up" : "down"}`}>
                          <span aria-hidden>{d > 0 ? `▲${d}` : `▼${-d}`}</span>
                          <span className="np-sr-only">{d > 0 ? `up ${d}` : `down ${-d}`}</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="np-who">
                      <Avatar row={r} />
                      <span className="np-who-text">
                        <span className="np-name-line">
                          <span className="np-name" dir="auto" title={r.name}>
                            {r.name}
                          </span>
                          {reward ? (
                            <span className="np-name-emoji" title={reward.title}>
                              {reward.emoji}
                            </span>
                          ) : null}
                          {tag("wide")}
                        </span>
                        <span className="np-meta">
                          {tag("narrow")}
                          <span className="np-meta-t">
                            {r.fn} · {r.role}
                          </span>
                        </span>
                      </span>
                    </span>
                    <span className="np-bar-cell">
                      <span className="np-bar" title={`${r.points} of ${s.minPoints}`}>
                        <i style={{ width: `${Math.min(100, (Math.max(0, r.points) / scale) * 100)}%` }} />
                        <b style={{ left: `${(s.minPoints / scale) * 100}%` }} />
                      </span>
                    </span>
                    <span className="np-pts">
                      <Odometer value={r.points} />
                    </span>
                  </button>
                  <ul className="np-break" id={`np-br-${r.id}`} hidden={!isOpen} aria-label={`${r.name}'s points`}>
                    {Object.keys(r.breakdown).length === 0 ? (
                      <li>{s.show.breakdown ? "No points yet." : "Breakdowns are private."}</li>
                    ) : (
                      Object.entries(r.breakdown).map(([k, v]) =>
                        k === BONUS ? (
                          <li key={k}>
                            Bonus <b>{v >= 0 ? "+" : ""}{v}</b>
                          </li>
                        ) : (
                          <li key={k}>
                            {types.get(k)?.label ?? k} ×{v} = <b>{(types.get(k)?.points ?? 0) * v}</b>
                          </li>
                        )
                      )
                    )}
                  </ul>
                </div>
              );
            })}
            {shown.length === 0 ? (
              <p className="np-empty">{filtering ? "Nobody matches that." : podium.length ? "Everyone in the race is on the podium." : null}</p>
            ) : null}
          </div>
          {!all && !filtering && list.length > shown.length ? (
            <div className="np-more">
              <button type="button" className="np-btn np-btn-ghost" onClick={() => setAll(true)}>
                Show all {snap.rows.length}
              </button>
            </div>
          ) : null}
        </>
      )}
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
  rewards, minPoints, claims, onOpen, onAll,
}: {
  rewards: Reward[];
  minPoints: number;
  claims: Map<number, Claim>;
  onOpen: (r: Reward) => void;
  onAll: () => void;
}) {
  return (
    <section className="np-card" id="rewards" aria-labelledby="np-rw-title">
      <div className="np-card-head">
        <h2 className="np-card-title" id="np-rw-title">War rewards</h2>
        {/* the hero's "War rewards" button is hidden on phones — this is its way in there */}
        <button type="button" className="np-link-btn" onClick={onAll}>
          See all
        </button>
      </div>
      {rewards.map((r, i) => {
        const c = claims.get(r.rank);
        return (
          // by index: two rewards may share a rank and a title while being edited
          <button key={i} type="button" className="np-reward" onClick={() => onOpen(r)}>
            <span className="np-reward-emoji" aria-hidden>{r.emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span className="np-label" style={{ display: "block", fontSize: 10.5 }}>{r.place}</span>
              <span className="np-reward-title" style={{ display: "block" }}>{r.title}</span>
              <span className="np-reward-holder" style={{ display: "block" }}>
                {claimLine(c)}
              </span>
            </span>
            <svg className="np-reward-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        );
      })}
      <p className="np-note">At least {minPoints} war points to compete. {TIE_NOTE}</p>
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
          <div className="np-seg" role="group" aria-label="Stage">
            {data.stages.map((x, i) => (
              <button key={x.stage} type="button" aria-pressed={i === stage} onClick={() => setStage(i)}>
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
            <a href="https://core.aiesec.org.eg" target="_blank" rel="noreferrer" className="np-core-link">
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
  modal, rewards, minPoints, claims, onPick, onAll, onClose,
}: {
  modal: { kind: "all" } | { kind: "one"; reward: Reward };
  rewards: Reward[];
  minPoints: number;
  claims: Map<number, Claim>;
  onPick: (r: Reward) => void;
  onAll: () => void;
  onClose: () => void;
}) {
  const back = useRef<HTMLDivElement | null>(null);
  const x = useRef<HTMLButtonElement | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  // once per opening: lock the page behind, make it inert (so Tab and a
  // screen reader stay inside the dialog), and on close hand focus back to
  // whatever opened it
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = back.current?.parentElement;
    const behind = root ? [...root.querySelectorAll<HTMLElement>(":scope > header, :scope > .np-hero, :scope > .np-wrap, :scope > footer")] : [];
    for (const el of behind) el.inert = true;
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      for (const el of behind) el.inert = false;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  // the button that switched views is gone — keep focus in the dialog
  const view = modal.kind === "one" ? `one-${modal.reward.rank}-${modal.reward.title}` : "all";
  useEffect(() => {
    x.current?.focus();
  }, [view]);

  const c = modal.kind === "one" ? claims.get(modal.reward.rank) : undefined;
  return (
    <div className="np-modal-back" onClick={onClose} role="presentation" ref={back}>
      <div
        className="np-modal"
        role="dialog"
        aria-modal="true"
        aria-label={modal.kind === "one" ? modal.reward.title : "War rewards"}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="np-x" onClick={onClose} aria-label="Close" ref={x}>
          ×
        </button>
        {/* the body scrolls, the × stays put — on a landscape phone it used to scroll away */}
        <div className="np-modal-body">
          {modal.kind === "one" ? (
            <>
              <div className="np-modal-emoji" aria-hidden>{modal.reward.emoji}</div>
              <p className="np-label" style={{ marginTop: 14, color: "var(--np-brass)" }}>{modal.reward.place}</p>
              <h3 className="np-display" style={{ margin: "6px 0 0", fontSize: 30, lineHeight: 1.05 }}>{modal.reward.title}</h3>
              {modal.reward.detail ? <p style={{ marginTop: 12, color: "var(--np-muted)" }}>{modal.reward.detail}</p> : null}
              <div className="np-modal-holder">
                {c ? (
                  <>
                    {c.tied ? "Tied for it right now: " : "In line right now: "}
                    <b>{c.who.map((h) => `${h.name} (${h.points})`).join(", ")}</b>
                    {c.tied ? <> — the LC decides who gets which reward.</> : null}
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
              <p style={{ marginTop: 6, color: "var(--np-muted)", fontSize: 14 }}>
                At least {minPoints} war points to compete. {TIE_NOTE}
              </p>
              <div style={{ marginTop: 16, textAlign: "left", border: "1px solid var(--np-line)", borderRadius: 14, overflow: "hidden" }}>
                {rewards.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    className="np-reward"
                    style={i === 0 ? { borderTop: 0 } : undefined}
                    onClick={() => onPick(r)}
                  >
                    <span className="np-reward-emoji" aria-hidden>{r.emoji}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="np-label" style={{ display: "block", fontSize: 10.5 }}>{r.place}</span>
                      <span className="np-reward-title" style={{ display: "block" }}>{r.title}</span>
                      <span className="np-reward-holder" style={{ display: "block" }}>
                        {claimLine(claims.get(r.rank))}
                      </span>
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
    </div>
  );
}
