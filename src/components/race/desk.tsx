"use client";

import "./race.css";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SodioMark } from "@/components/crm/sodio-mark";
import { RACE_LIMITS, RACE_PUBLIC_PATH, type RaceSnapshot } from "@/lib/race/model";
import { logRivalSlots, removeRivalEntry } from "@/server/race-actions";

/** "Sat 5 Dec" built from parts — Node and browsers punctuate en-GB weekdays
 *  differently, which broke hydration when it came from one format call. */
const fmtDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const wk = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d);
  const dm = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  return `${wk} ${dm}`;
};

/** MUST's slots desk (v38.5): one big number, one button. The count is the
 *  slots MUST raised; the note and date are optional. Everything MUST adds
 *  shows up on the public board within a second, and can be taken back here. */
export function RivalDesk({
  token,
  snapshot,
  entries,
  open,
  today,
}: {
  token: string;
  snapshot: RaceSnapshot;
  entries: { id: string; qty: number; note: string | null; occurred_on: string; created_at: string; mine: boolean }[];
  open: boolean;
  today: string;
}) {
  const router = useRouter();
  const s = snapshot.settings;
  const lane = snapshot.slots.rival;
  const home = snapshot.slots.home;
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [day, setDay] = useState(today > s.deadlineDate ? s.deadlineDate : today);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const max = today > s.deadlineDate ? s.deadlineDate : today;
  const style = { "--home": s.home.color, "--rival": s.rival.color } as React.CSSProperties;

  const submit = () =>
    start(async () => {
      setMsg(null);
      const res = await logRivalSlots(token, { qty, note, occurredOn: day });
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      setMsg({ ok: true, text: `+${qty} ${qty === 1 ? "slot" : "slots"} logged for ${s.rival.name}. It's on the board.` });
      setQty(1);
      setNote("");
      router.refresh();
    });

  const takeBack = (id: string) =>
    start(async () => {
      if (!window.confirm("Take this entry back? It comes off the board straight away.")) return;
      const res = await removeRivalEntry(token, id);
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      setMsg({ ok: true, text: "Taken back." });
      router.refresh();
    });

  return (
    <div className="rc" style={style}>
      <main className="rc-desk">
        <div className="rc-wrap">
          <div className="rc-desk-card">
            <p className="rc-kicker" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <SodioMark px={20} tone="tile" className="h-5 w-5 shrink-0" /> {s.title} · {s.rival.name} desk
            </p>
            <h1>Log {s.rival.name}&apos;s slots</h1>
            <p className="rc-desk-note">
              Every slot you add here counts toward {s.rival.name}&apos;s race to {s.slotsGoal}, and shows on the live board at once.
              This link is {s.rival.name}&apos;s alone — anyone holding it can add slots, so keep it inside your team.
            </p>

            <div className="rc-desk-bar" style={{ "--c": "var(--rival)", "--p": Math.min(1, lane.value / lane.goal) } as React.CSSProperties}>
              <div className="rc-lane-head" style={{ marginBottom: 10 }}>
                <span className="rc-tag" style={{ background: "var(--rival)" }}>{s.rival.short}</span>
                <span className="rc-lane-count" style={{ marginLeft: "auto" }}>
                  <b style={{ color: "var(--rival)", fontSize: 28 }}>{lane.value}</b>
                  <small>/{lane.goal}</small>
                </span>
              </div>
              <div className="rc-bar">
                <div className="rc-fill">
                  <i />
                </div>
                <div className="rc-head">
                  <span />
                </div>
              </div>
              <p className="rc-desk-note" style={{ marginTop: 10 }}>
                {s.home.name}: {home.value} · {lane.value === home.value ? "level" : lane.value > home.value ? `you lead by ${lane.value - home.value}` : `${home.value - lane.value} behind`}
              </p>
            </div>

            {open ? (
              <>
                <div className="rc-step">
                  <button type="button" aria-label="One less" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1 || pending}>
                    −
                  </button>
                  <output aria-live="polite">{qty}</output>
                  <button type="button" aria-label="One more" onClick={() => setQty((q) => Math.min(RACE_LIMITS.qty, q + 1))} disabled={pending}>
                    +
                  </button>
                </div>
                <div className="rc-chips">
                  {[1, 3, 5, 10].map((n) => (
                    <button key={n} type="button" onClick={() => setQty(n)} aria-pressed={qty === n}>
                      {n}
                    </button>
                  ))}
                </div>
                <label className="rc-field">
                  Note (optional — only Alexandria&apos;s editors and this desk see it)
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={RACE_LIMITS.note} placeholder="e.g. IGV · partner name" />
                </label>
                <label className="rc-field">
                  Raised on
                  <input type="date" value={day} min={s.startDate} max={max} onChange={(e) => setDay(e.target.value)} />
                </label>
                <button type="button" className="rc-btn rc-btn-go" onClick={submit} disabled={pending}>
                  {pending ? "Saving…" : `Log ${qty} ${qty === 1 ? "slot" : "slots"}`}
                </button>
              </>
            ) : (
              <p className="rc-desk-msg">Logging is closed{snapshot.slots.winner ? " — the race is decided" : ""}. The board below is final.</p>
            )}
            {msg ? <p className={`rc-desk-msg ${msg.ok ? "is-ok" : "is-err"}`} role="status">{msg.text}</p> : null}
            <p className="rc-desk-note">
              <a href={RACE_PUBLIC_PATH} target="_blank" rel="noreferrer">
                Open the live board ↗
              </a>
            </p>
          </div>

          <div className="rc-desk-card">
            <p className="rc-kicker">What {s.rival.name} logged</p>
            {entries.length === 0 ? (
              <p className="rc-desk-note">Nothing yet — your first slot will show here.</p>
            ) : (
              <ul className="rc-desk-list">
                {entries.map((e) => (
                  <li key={e.id}>
                    <b>+{e.qty}</b>
                    <span>
                      {fmtDay(e.occurred_on)}
                      {e.note ? <small>{e.note}</small> : null}
                      {!e.mine ? <small>added by Alexandria</small> : null}
                    </span>
                    {e.mine && open ? (
                      <button type="button" onClick={() => takeBack(e.id)} disabled={pending}>
                        Take back
                      </button>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
