"use client";

import { useEffect, useRef, useState } from "react";
import { cairoInstant, splitDuration, warClock, type Delegate, type WarSnapshot } from "@/lib/war/model";
import { initials } from "./bits";

/** ACTIVATE on the No Peace board (v38.5) — everything that drives the LC to
 *  the conference, in one place: the APD goal (the same count as Alex vs
 *  MUST), the delegation bus that fills as the F&L VP ticks people in the War
 *  Room, the boarding list, and the registration card with the COD's message.
 *  Every word is edited in the War Room → Activate. */

/** "Sat 5 Dec" built from parts — Node and browsers punctuate en-GB weekdays
 *  differently, which broke hydration when it came from one format call. */
const fmtDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const wk = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d);
  const dm = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  return `${wk} ${dm}`;
};
const pad = (n: number) => String(n).padStart(2, "0");
const WINDOWS = 9;
const ROSTER_SHORT = 24;

function ago(iso: string, now: number | null): string {
  if (!now) return "";
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 60) return m < 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function ActivateFront({ snap, now, racePublic }: { snap: WarSnapshot; now: number | null; racePublic: boolean }) {
  const s = snap.settings;
  const a = s.activate;
  const act = snap.activate;
  if (!a?.enabled || !act) return null;
  return (
    <section className="np-section np-act" id="activate" aria-labelledby="np-act-title">
      <div className="np-section-head">
        <span className="np-label">The road to {s.activateLabel}</span>
        <h2 className="np-h2" id="np-act-title">
          {a.name}
        </h2>
        <p>
          {[a.dates, a.location].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="np-act-grid">
        <div className="np-act-main">
          <ApdGoal snap={snap} now={now} racePublic={racePublic} />
          <Bus delegates={act.delegates} seats={a.seats} label={s.activateLabel} now={now} />
          <Roster delegates={act.delegates} />
        </div>
        <Register snap={snap} now={now} />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ APD goal

function ApdGoal({ snap, now, racePublic }: { snap: WarSnapshot; now: number | null; racePublic: boolean }) {
  const s = snap.settings;
  const apd = snap.activate?.apd ?? null;
  const goal = s.activate.apdGoal;
  const value = apd?.value ?? 0;
  const p = Math.min(1, value / goal);
  const clock = warClock(s);
  const days = now ? Math.max(0, Math.ceil((clock.activate - now) / 86_400_000)) : null;
  const marks = [0.25, 0.5, 0.75];
  return (
    <div className="np-card np-apd">
      <div className="np-card-head">
        <h3 className="np-card-title">
          {goal} APDs by {s.activateLabel}
        </h3>
        <span className="np-label">Live from CORE</span>
      </div>
      <div className="np-apd-body">
        <div className="np-apd-count">
          <b className="np-mono">{value}</b>
          <span className="np-mono">/ {goal}</span>
          {value >= goal ? <em>Goal reached 🎉</em> : null}
        </div>
        <div className="np-apd-road" role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={value} aria-label={`${value} of ${goal} approvals`}>
          <i className="np-apd-fill" style={{ width: `${p * 100}%` }} />
          {marks.map((m) => (
            <span key={m} className={`np-apd-mark ${p >= m ? "on" : ""}`} style={{ left: `${m * 100}%` }}>
              <small>{Math.round(goal * m)}</small>
            </span>
          ))}
          <span className="np-apd-flag" aria-hidden>
            🏁
          </span>
          <span className="np-apd-tip" style={{ left: `${p * 100}%` }} aria-hidden />
        </div>
        <p className="np-apd-meta">
          {value < goal ? <b>{goal - value} to go</b> : <b>Every one from here is a bonus</b>}
          {days !== null ? <span>{days === 0 ? `${s.activateLabel} is here` : `${days} day${days === 1 ? "" : "s"} to ${s.activateLabel}`}</span> : null}
          {apd ? <span>read {ago(apd.readAt, now)}</span> : <span>waiting for the first reading</span>}
        </p>
        {racePublic ? (
          <a className="np-apd-race" href="/alex-vs-must" target="_blank" rel="noreferrer">
            We&apos;re racing MUST to the same {goal} — watch the race ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the bus

/** The delegation bus: one window per early delegate (their initials), a
 *  "+N" window when the bus is fuller than its windows, the count on its side
 *  and the seats bar under it. It honks when someone new climbs aboard. */
function Bus({ delegates, seats, label, now }: { delegates: Delegate[]; seats: number; label: string; now: number | null }) {
  const count = delegates.length;
  const [honk, setHonk] = useState(0);
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current) setHonk((h) => h + 1);
    prev.current = count;
  }, [count]);
  const shown = delegates.slice(0, count > WINDOWS ? WINDOWS - 1 : WINDOWS);
  const more = count - shown.length;
  const full = count >= seats;
  void now;
  return (
    <div className="np-card np-bus-card" id="delegation">
      <div className="np-card-head">
        <h3 className="np-card-title">The delegation bus</h3>
        <span className="np-label">
          {count} / {seats} seats
        </span>
      </div>
      <div className="np-bus-stage">
        <svg className="np-bus" viewBox="0 0 640 250" role="img" aria-label={`${count} of ${seats} seats taken on the bus to ${label}`}>
          {/* road */}
          <rect x="0" y="214" width="640" height="36" fill="#0b1619" />
          <line className="np-road-dash" x1="0" y1="232" x2="640" y2="232" stroke="#e2b354" strokeWidth="3" strokeDasharray="26 22" />
          <g className="np-bus-body">
            {/* shadow */}
            <ellipse cx="320" cy="214" rx="250" ry="7" fill="rgba(0,0,0,.45)" />
            {/* body */}
            <rect x="60" y="54" width="520" height="146" rx="26" fill="#037EF3" />
            <rect x="60" y="150" width="520" height="50" rx="0" fill="#0263c2" />
            <rect x="60" y="176" width="520" height="24" rx="12" fill="#024f9b" />
            <rect x="60" y="142" width="520" height="8" fill="#e2b354" />
            {/* front */}
            <path d="M556 54h4a26 26 0 0 1 26 26v84h-30z" fill="#0263c2" />
            <rect x="562" y="76" width="18" height="58" rx="5" fill="#9fd2ff" opacity=".85" />
            <circle cx="578" cy="168" r="6" fill="#ffe7a8" className="np-bus-light" />
            {/* destination board */}
            <rect x="92" y="62" width="180" height="22" rx="5" fill="#0b1619" />
            <text x="182" y="78" textAnchor="middle" className="np-bus-sign">
              {label.toUpperCase()} · ABU QIR
            </text>
            {/* windows */}
            {Array.from({ length: WINDOWS }, (_, i) => {
              const x = 82 + i * 52;
              const d = shown[i];
              const isMore = !d && i === WINDOWS - 1 && more > 0;
              return (
                <g key={i}>
                  <rect x={x} y="92" width="44" height="44" rx="8" fill={d || isMore ? "#cfe8ff" : "#7fb8ec"} opacity={d || isMore ? 1 : 0.55} />
                  {d ? (
                    <g className="np-bus-face">
                      <circle cx={x + 22} cy="116" r="15" fill="#e2b354" />
                      <text x={x + 22} y="121" textAnchor="middle" className="np-bus-ini">
                        {initials(d.name)}
                      </text>
                    </g>
                  ) : isMore ? (
                    <text x={x + 22} y="120" textAnchor="middle" className="np-bus-more">
                      +{more}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {/* the count on its side */}
            <text x="320" y="190" textAnchor="middle" className="np-bus-count">
              {count} ON BOARD
            </text>
            {/* wheels */}
            {[150, 480].map((cx) => (
              <g key={cx} transform={`translate(${cx} 200)`}>
                <circle r="30" fill="#0b1619" />
                <g className="np-wheel">
                  <circle r="17" fill="#c5ccd3" />
                  <path d="M0-17V17M-17 0H17M-12-12L12 12M12-12L-12 12" stroke="#61716f" strokeWidth="3" />
                </g>
                <circle r="5" fill="#0b1619" />
              </g>
            ))}
          </g>
          {honk ? (
            <g key={honk} className="np-honk">
              <rect x="560" y="10" width="72" height="30" rx="15" fill="#e2b354" />
              <text x="596" y="30" textAnchor="middle" className="np-honk-t">
                BEEP!
              </text>
            </g>
          ) : null}
        </svg>
      </div>
      <div className="np-seats">
        <div className="np-seats-bar" aria-hidden>
          <i style={{ width: `${Math.min(100, (count / seats) * 100)}%` }} />
        </div>
        <p>
          {full ? (
            <b>The bus is full 🎉 — {count} of us are going.</b>
          ) : count === 0 ? (
            <>The bus is waiting. The first name that registers takes seat #1.</>
          ) : (
            <>
              <b>{seats - count}</b> seats left · names appear once the F&amp;L VP confirms your registration
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Roster({ delegates }: { delegates: Delegate[] }) {
  // a name that just climbed aboard glows for a few seconds
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const ids = delegates.map((d) => d.id).join(",");
  useEffect(() => {
    const now = new Set(ids ? ids.split(",") : []);
    if (seen.current) {
      const add = [...now].filter((id) => !seen.current!.has(id));
      if (add.length) {
        setFresh(add);
        const t = setTimeout(() => setFresh([]), 8000);
        seen.current = now;
        return () => clearTimeout(t);
      }
    }
    seen.current = now;
  }, [ids]);
  const [all, setAll] = useState(false);
  if (delegates.length === 0) return null;
  const shown = all ? delegates : delegates.slice(0, ROSTER_SHORT);
  return (
    <div className="np-card np-roster-card">
      <div className="np-card-head">
        <h3 className="np-card-title">Who&apos;s coming</h3>
        <span className="np-label">In the order they registered</span>
      </div>
      <ol className="np-roster">
        {shown.map((d, i) => (
          <li key={d.id} className={fresh.includes(d.id) ? "is-new" : ""}>
            <span className="np-seat np-mono">{pad(i + 1)}</span>
            {d.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.avatar} alt="" width={30} height={30} loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <span className="np-roster-ini">{initials(d.name)}</span>
            )}
            <span className="np-roster-name">
              <b>{d.name}</b>
              {d.fn && d.fn !== "—" ? <small>{d.fn}</small> : null}
            </span>
          </li>
        ))}
      </ol>
      {delegates.length > ROSTER_SHORT ? (
        <button type="button" className="np-roster-more" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${delegates.length}`}
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ register

function Register({ snap, now }: { snap: WarSnapshot; now: number | null }) {
  const a = snap.settings.activate;
  const [copied, setCopied] = useState(false);
  const closes = cairoInstant(a.deadline, "23:59");
  const open = now === null || now <= closes;
  const left = now ? splitDuration(Math.max(0, closes - now)) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a.payNumber.replace(/\s+/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* the number is on screen to copy by hand */
    }
  };
  const facts: [string, React.ReactNode][] = [
    ["Date", a.dates],
    ["Location", a.location],
    ["Fees", a.fees],
    ["Down payment", a.downPayment],
  ];
  return (
    <aside className="np-card np-reg" id="register" aria-labelledby="np-reg-title">
      <div className="np-reg-top">
        <span className={`np-reg-state ${open ? "on" : ""}`}>{open ? "Registration open" : "Registration closed"}</span>
        <h3 className="np-reg-title" id="np-reg-title">
          Register for {a.name}
        </h3>
      </div>
      {a.announcement ? <p className="np-reg-msg">{a.announcement}</p> : null}
      <dl className="np-reg-facts">
        {facts
          .filter(([, v]) => !!v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        {a.payNumber ? (
          <div>
            <dt>{a.payVia || "Pay to"}</dt>
            <dd className="np-reg-pay">
              <b className="np-mono">{a.payNumber}</b>
              <button type="button" onClick={copy} className="np-reg-copy">
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Deadline</dt>
          <dd>
            {fmtDay(a.deadline)}
            {open && left ? (
              <span className="np-reg-left">
                {" "}
                · {left.d}d {pad(left.h)}h left
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      {open && a.formUrl ? (
        <a className="np-btn np-btn-primary np-reg-go" href={a.formUrl} target="_blank" rel="noreferrer">
          Open the registration form
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M7 17 17 7M9 7h8v8" />
          </svg>
        </a>
      ) : null}
      <p className="np-reg-foot">
        Paid the down payment? Your name climbs onto the bus as soon as the F&amp;L VP confirms it.
        {a.signedBy ? <span> — {a.signedBy}</span> : null}
      </p>
    </aside>
  );
}
