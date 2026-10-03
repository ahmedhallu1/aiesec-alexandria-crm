"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { RotateCw, Search, Users } from "lucide-react";
import {
  addDays, cairoTodayIso, daysBetween, fmtDay, isIsoDate, weekdayOf,
  type ActivationRow, type ActivationSection, type CellValue, type Column,
} from "@/lib/activation/model";
import { cn } from "@/lib/utils";
import { tilt } from "./fx";

/** The designed side of the page (v36.7): each act read as a show, not a
 *  spreadsheet. Every view reads rows generically — a column the LC adds later
 *  still shows up (PlainView, and the "more" lines on the cards). */

const TEAM_COLOR: Record<string, string> = {
  dx: "#e63946", decor: "#ff6f91", marketing: "#a06cd5", mktg: "#a06cd5", logistics: "#2ec4b6",
  finance: "#52b788", catering: "#f4a261", bd: "#ffd166", ocp: "#f7c65b", coach: "#cdb9a3",
};
export const teamColor = (name: unknown) =>
  TEAM_COLOR[String(name ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? "#f7c65b";
const str = (v: CellValue | undefined) => (v === null || v === undefined ? "" : String(v));
const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

// ------------------------------------------------------------------ checkpoints
export function CheckpointsView({ section, rows }: { section: ActivationSection; rows: ActivationRow[] }) {
  const today = cairoTodayIso();
  const list = useMemo(
    () => [...rows].sort((a, b) => str(a.data.date).localeCompare(str(b.data.date)) || a.position - b.position),
    [rows]
  );
  const teams = (section.config.columns ?? []).filter((c) => !["name", "date"].includes(c.key) && !c.hidden);
  // these are the plan's stops, not tasks to tick off (v36.8) — the page
  // opens on the next one coming up
  // (v37.8) -1 = every checkpoint is behind us: no "Next stop", and the page opens on the last one
  const upcomingIdx = list.findIndex((r) => str(r.data.date) >= today);
  const upcoming = upcomingIdx >= 0 ? list[upcomingIdx] : undefined;
  const [selId, setSelId] = useState<string | null>(null);
  const active = list.find((r) => r.id === selId) ?? upcoming ?? list[list.length - 1];
  const n = list.length;
  const pts = list.map((_, i) => ({ x: ((i + 0.5) / Math.max(1, n)) * 1000, y: i % 2 === 0 ? 62 : 150 }));
  const path = pts.reduce(
    (acc, p, i) =>
      i === 0 ? `M${p.x},${p.y}` : `${acc} C${(pts[i - 1].x + p.x) / 2},${pts[i - 1].y} ${(pts[i - 1].x + p.x) / 2},${p.y} ${p.x},${p.y}`,
    ""
  );

  if (n === 0) return <Empty />;
  return (
    <div className="space-y-6">
      {upcoming && isIsoDate(str(upcoming.data.date)) ? (
        <p className="text-center text-sm text-[var(--cz-muted)]" data-reveal>
          Next stop: <b className="text-[var(--cz-cream)]">{str(upcoming.data.name) || `Checkpoint ${upcomingIdx + 1}`}</b> ·{" "}
          {weekdayOf(str(upcoming.data.date))} {fmtDay(str(upcoming.data.date))} ·{" "}
          {relDays(daysBetween(today, str(upcoming.data.date)))}
        </p>
      ) : null}

      <div className="overflow-x-auto pb-2" data-reveal>
        <div className="relative mx-auto h-[230px] min-w-[760px] max-w-[1100px]">
          <svg viewBox="0 0 1000 220" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            <path d={path} fill="none" stroke="rgba(247,198,91,0.18)" strokeWidth="14" strokeLinecap="round" />
            <path d={path} className="cp-path" fill="none" stroke="#f7c65b" strokeWidth="3" strokeDasharray="10 12" strokeLinecap="round" />
          </svg>
          {list.map((r, i) => {
            const date = str(r.data.date);
            const isSel = active?.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelId(r.id)}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
                style={{ left: `${pts[i].x / 10}%`, top: `${(pts[i].y / 220) * 100}%` }}
                aria-pressed={isSel}
              >
                <span className={cn("cp-ring", isSel && "is-sel")}>
                  <span className="circus-display text-2xl leading-none">{i + 1}</span>
                </span>
                <span className={cn("text-[11px] font-bold", date === today ? "text-[var(--cz-crimson)]" : "text-[var(--cz-muted)]")}>
                  {isIsoDate(date) ? `${weekdayOf(date)} ${fmtDay(date)}` : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {active ? (
        <div key={active.id} className="circus-card mx-auto max-w-4xl p-5 sm:p-6 cz-rise">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="circus-eyebrow">{str(active.data.name) || "Checkpoint"}</p>
              <p className="circus-serif mt-1 text-2xl font-bold italic text-[var(--cz-cream)]">
                {isIsoDate(str(active.data.date)) ? `${weekdayOf(str(active.data.date))} ${fmtDay(str(active.data.date))}` : "No date yet"}
                <span className="ml-2 text-sm font-normal not-italic text-[var(--cz-muted)]">
                  {isIsoDate(str(active.data.date)) ? relDays(daysBetween(today, str(active.data.date))) : ""}
                </span>
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((t, i) => {
              const text = str(active.data[t.key]);
              return (
                <div
                  key={t.key}
                  className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10 cz-rise"
                  style={{ ...d(i * 60), boxShadow: `inset 3px 0 0 ${teamColor(t.key)}` }}
                >
                  <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: teamColor(t.key) }}>
                    {t.label}
                  </p>
                  <p className={cn("mt-1 text-sm", text ? "text-[var(--cz-cream)]" : "text-white/30")} dir="auto">
                    {text || "—"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function relDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// ------------------------------------------------------------------ roles
const ROLE_EMOJI: [RegExp, string][] = [
  [/coach/i, "🧭"], [/\bocp\b|president/i, "🎩"], [/dx|entertain/i, "🎭"], [/market/i, "📣"],
  [/bd|sponsor|partner/i, "🤝"], [/logist|catering/i, "🚚"], [/financ/i, "💰"],
];
const roleEmoji = (role: string) => ROLE_EMOJI.find(([re]) => re.test(role))?.[1] ?? "⭐";

/** A job description as bullets. The sheet wrapped long lines by hand, so a
 *  line that doesn't start a new bullet belongs to the one above it. */
export function jobItems(text: string): { heading: boolean; text: string }[] {
  const out: { heading: boolean; text: string }[] = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (/^[A-Z][A-Z &/]+:$/.test(l)) out.push({ heading: true, text: l.replace(/:$/, "") });
    else if (/^[•\-–]/.test(l) || out.length === 0 || out[out.length - 1].heading)
      out.push({ heading: false, text: l.replace(/^[•\-–]\s*/, "") });
    else out[out.length - 1].text += ` ${l}`;
  }
  return out;
}

function JobText({ text }: { text: string }) {
  const items = jobItems(text);
  if (!items.length) return <p className="text-sm text-white/40">No job description written yet.</p>;
  return (
    <ul className="space-y-1.5 text-sm leading-snug" dir="auto">
      {items.map((it, i) =>
        it.heading ? (
          <li key={i} className="pt-2 text-[11px] font-black uppercase tracking-wider text-[var(--cz-gold)] first:pt-0">
            {it.text}
          </li>
        ) : (
          <li key={i} className="flex gap-2">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--cz-gold)]" />
            <span>{it.text}</span>
          </li>
        )
      )}
    </ul>
  );
}

export function RolesView({ rows }: { section: ActivationSection; rows: ActivationRow[] }) {
  const tier = (r: ActivationRow) => str(r.data.tier);
  const coach = rows.filter((r) => tier(r) === "Coach");
  const presidents = rows.filter((r) => tier(r) === "President");
  const vps = rows.filter((r) => tier(r) === "OCVP");
  const others = rows.filter((r) => !["Coach", "President", "OCVP"].includes(tier(r)));
  const teamsters = rows.reduce((n, r) => n + (Number(r.data.teamsters) || 0), 0);
  const total = teamsters + vps.length + presidents.length + coach.length;

  return (
    <div className="space-y-2">
      <WideRow list={coach} from={0} />
      {coach.length ? <Connector /> : null}
      <WideRow list={presidents} from={coach.length} />
      {presidents.length ? <Connector /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {vps.map((r, i) => (
          <FlipRole key={r.id} r={r} i={i} />
        ))}
      </div>
      {others.length ? (
        <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          {others.map((r, i) => (
            <FlipRole key={r.id} r={r} i={i} />
          ))}
        </div>
      ) : null}
      <p className="pt-6 text-center text-sm text-[var(--cz-muted)]" data-reveal>
        <Users className="mr-1 inline size-4 text-[var(--cz-gold)]" />
        {coach.length ? `${coach.length} coach · ` : ""}
        {presidents.length ? `${presidents.length} OCP · ` : ""}
        {vps.length} OCVPs · {teamsters} teamsters — <b className="text-[var(--cz-cream)]">{total} people running the show</b>
      </p>
    </div>
  );
}

/** One tier of wide cards (the coaches, the OCP). Two or more sit SIDE BY
 *  SIDE (v36.8) — two coaches are peers, not a chain of command. */
function WideRow({ list, from }: { list: ActivationRow[]; from: number }) {
  if (!list.length) return null;
  const pair = list.length > 1;
  return (
    <div className={cn("mx-auto grid w-full gap-4", pair ? "max-w-5xl md:grid-cols-2" : "max-w-3xl")}>
      {list.map((r, i) => (
        <Wide key={r.id} r={r} i={from + i} compact={pair} />
      ))}
    </div>
  );
}

/** The coach and the OCP: wide cards, the whole job description visible. */
function Wide({ r, i, compact }: { r: ActivationRow; i: number; compact: boolean }) {
  return (
    <div className="circus-card lift circus-tilt h-full w-full p-5 sm:p-6" data-reveal style={d(i * 90)} {...tilt(4)}>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{roleEmoji(str(r.data.role))}</span>
        <div>
          <p className="circus-eyebrow !text-[10px]">{str(r.data.tier) || "Role"}</p>
          <p className="circus-serif text-2xl font-bold italic text-[var(--cz-cream)]">{str(r.data.role)}</p>
        </div>
      </div>
      <div className={cn("mt-4", !compact && "sm:columns-2 sm:gap-8")}>
        <JobText text={str(r.data.responsibilities)} />
      </div>
    </div>
  );
}

function Connector() {
  return <div className="mx-auto h-8 w-px bg-gradient-to-b from-[var(--cz-gold)] to-transparent" aria-hidden data-reveal />;
}

function FlipRole({ r, i }: { r: ActivationRow; i: number }) {
  const [flipped, setFlipped] = useState(false);
  const role = str(r.data.role);
  const n = Number(r.data.teamsters) || 0;
  return (
    <div
      className={cn("circus-flip h-[320px]", flipped && "is-flipped")}
      data-reveal
      style={d(i * 80)}
      onClick={() => setFlipped((f) => !f)}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setFlipped((f) => !f);
        }
      }}
    >
      <div className="circus-flip-inner">
        <div className="circus-flip-face circus-card flex flex-col items-center justify-center gap-3 p-5 text-center">
          <span className="text-5xl drop-shadow-[0_6px_16px_rgba(247,198,91,0.35)]">{roleEmoji(role)}</span>
          <p className="circus-serif text-xl font-bold italic leading-tight text-[var(--cz-cream)]">{role}</p>
          <div className="flex flex-wrap justify-center gap-1" aria-label={`${n} teamsters`}>
            {Array.from({ length: Math.min(n, 12) }, (_, k) => (
              <span key={k} className="size-2.5 rounded-full bg-[var(--cz-gold)] shadow-[0_0_8px_rgba(247,198,91,0.7)]" />
            ))}
          </div>
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--cz-muted)]">
            {n ? `${n} teamster${n === 1 ? "" : "s"}` : "No teamsters"}
          </p>
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--cz-gold)]">
            <RotateCw className="size-3" /> Tap to read the job
          </p>
        </div>
        <div className="circus-flip-face circus-flip-back circus-card overflow-y-auto p-4 text-left">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-[var(--cz-gold)]">{role}</p>
          <JobText text={str(r.data.responsibilities)} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ people
const POS_COLOR: Record<string, string> = { EB: "#f7c65b", MM: "#d7263d", Member: "#2ec4b6" };

export function PeopleView({ section, rows }: { section: ActivationSection; rows: ActivationRow[] }) {
  // (v37.8) memoised on `rows`, so the prefs memo below isn't recomputed on every search keystroke
  const people = useMemo<(Record<string, CellValue> & { id: string })[]>(
    () => rows.map((r) => ({ ...r.data, id: r.id })),
    [rows]
  );
  const hasNames = people.some((p) => str(p.name));
  const capacity = section.config.capacity ?? people.length;
  const expected = people.filter((p) => str(p.expected_oc).toLowerCase() === "yes").length;
  const positions = ["EB", "MM", "Member"].map((pos) => ({ pos, n: people.filter((p) => str(p.position) === pos).length }));
  const prefs = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of people)
      for (const v of [p.pref1, p.pref2]) {
        const k = str(v).trim();
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [people]);
  const max = prefs[0]?.[1] ?? 1;
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const shown = hasNames ? people.filter((p) => !q || str(p.name).toLowerCase().includes(q.toLowerCase())) : [];
  const picked = people.find((p) => p.id === pick);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Stat big={capacity} label="LC capacity" note="members the LC can put behind the show" i={0} />
        <Stat big={expected} label="ready for the OC" note={`of ${people.length} on the casting list`} i={1} />
        <div className="circus-card p-5" data-reveal style={d(160)}>
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--cz-muted)]">Who they are</p>
          <div className="mt-3 space-y-2.5">
            {positions.map((p) => (
              <div key={p.pos} className="flex items-center gap-2 text-sm">
                <span className="w-16 shrink-0 font-bold" style={{ color: POS_COLOR[p.pos] }}>
                  {p.pos}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="circus-bar-fill h-full rounded-full"
                    data-reveal
                    style={{ "--w": people.length ? p.n / people.length : 0, background: POS_COLOR[p.pos] } as CSSProperties}
                  />
                </div>
                <span className="w-8 text-right tabular-nums text-[var(--cz-cream)]">{p.n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {prefs.length ? (
        <div className="circus-card p-5" data-reveal>
          <p className="circus-serif text-xl font-bold italic text-[var(--cz-cream)]">The roles they asked for</p>
          <div className="mt-4 grid gap-2.5 md:grid-cols-2 md:gap-x-10">
            {prefs.map(([role, n]) => (
              <div key={role} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 truncate text-[var(--cz-cream)]" title={role}>
                  {role}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="circus-bar-fill h-full rounded-full bg-gradient-to-r from-[#d7263d] to-[#f7c65b]"
                    data-reveal
                    style={{ "--w": n / max } as CSSProperties}
                  />
                </div>
                <span className="w-6 text-right font-bold tabular-nums text-[var(--cz-gold)]">{n}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {hasNames ? (
        <div className="circus-card p-5" data-reveal>
          <div className="flex flex-wrap items-center gap-3">
            {/* the sheet called this tab "Mapping" — and the LC can rename it (v36.8) */}
            <p className="circus-serif text-xl font-bold italic text-[var(--cz-cream)]">
              {section.config.listTitle?.trim() || "Mapping"}
            </p>
            <span className="text-xs text-[var(--cz-muted)]">{people.filter((p) => str(p.name)).length} names</span>
            <label className="ml-auto flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 ring-1 ring-[var(--cz-line)]">
              <Search className="size-4 text-[var(--cz-muted)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find someone…"
                className="w-40 bg-transparent text-sm text-[var(--cz-cream)] outline-none placeholder:text-[var(--cz-muted)]"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {shown.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPick(pick === p.id ? null : p.id)}
                className={cn("circus-chip transition hover:scale-105", pick === p.id && "ring-2 ring-[var(--cz-gold)]")}
                style={{ "--chip": POS_COLOR[str(p.position)] ?? "#cdb9a3" } as CSSProperties}
                title={[str(p.pref1), str(p.pref2)].filter(Boolean).join(" · ") || undefined}
              >
                {str(p.name)}
              </button>
            ))}
          </div>
          {picked ? (
            <div className="mt-4 rounded-xl bg-white/[0.05] p-4 text-sm ring-1 ring-[var(--cz-line)] cz-rise">
              <p className="font-bold text-[var(--cz-cream)]">
                {str(picked.name)} <span className="font-normal text-[var(--cz-muted)]">· {str(picked.position)}</span>
              </p>
              <p className="mt-1 text-[var(--cz-muted)]">
                Wants: {[str(picked.pref1), str(picked.pref2)].filter(Boolean).join(", then ") || "not said yet"}
              </p>
              {str(picked.experience) ? <p className="mt-1 text-[var(--cz-muted)]">Experience: {str(picked.experience)}</p> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-center text-sm text-[var(--cz-muted)]" data-reveal>
          Individual names stay inside AIESEC in Alexandria.
        </p>
      )}
    </div>
  );
}

function Stat({ big, label, note, i }: { big: number; label: string; note: string; i: number }) {
  return (
    <div className="circus-card lift p-5 text-center" data-reveal style={d(i * 80)}>
      <p className="circus-display text-5xl text-[var(--cz-gold)]">{big}</p>
      <p className="mt-1 text-sm font-bold uppercase tracking-wider text-[var(--cz-cream)]">{label}</p>
      <p className="mt-1 text-xs text-[var(--cz-muted)]">{note}</p>
    </div>
  );
}

// ------------------------------------------------------------------ checklist
export function ChecklistView({ rows }: { section: ActivationSection; rows: ActivationRow[] }) {
  const stages = [...new Set(rows.map((r) => str(r.data.stage) || "Steps"))];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {stages.map((stage, si) => {
        const its = rows.filter((r) => (str(r.data.stage) || "Steps") === stage);
        const rounds = [...new Set(its.map((r) => str(r.data.round)))];
        return (
          <div key={stage} className="circus-card p-5" data-reveal style={d(si * 100)}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="circus-serif text-2xl font-bold italic text-[var(--cz-cream)]">{stage}</p>
              <span className="text-xs font-bold text-[var(--cz-gold)]">
                {its.length} step{its.length === 1 ? "" : "s"}
              </span>
            </div>
            {rounds.map((round) => (
              <div key={round} className="mt-4">
                {round ? <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-[var(--cz-muted)]">{round}</p> : null}
                <ol className="relative space-y-3 border-l border-[var(--cz-line)] pl-5">
                  {its
                    .filter((r) => str(r.data.round) === round)
                    .map((r) => {
                      const date = str(r.data.date);
                      return (
                        <li key={r.id} className="relative">
                          <span
                            aria-hidden
                            className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-[var(--cz-gold)]/70 bg-[#1a0f28] shadow-[0_0_8px_rgba(247,198,91,0.35)]"
                          />
                          <p className="text-sm font-semibold text-[var(--cz-cream)]">{str(r.data.step)}</p>
                          <p className="text-xs text-[var(--cz-muted)]">
                            {isIsoDate(date) ? `${weekdayOf(date)} ${fmtDay(date)}` : "Only if needed"}
                          </p>
                          {str(r.data.comment) ? (
                            <p className="mt-0.5 text-xs text-[var(--cz-cream)]/80" dir="auto">
                              {str(r.data.comment)}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                </ol>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ run of show
export function RunbookView({
  section, rows, day0,
}: { section: ActivationSection; rows: ActivationRow[]; day0: string | null }) {
  const order = (section.config.columns ?? []).find((c) => c.key === "day")?.options ?? [];
  const days = [...new Set([...order.filter((o) => rows.some((r) => str(r.data.day) === o)), ...rows.map((r) => str(r.data.day))])].filter(
    Boolean
  );
  const [active, setActive] = useState<string | null>(null);
  const day = active && days.includes(active) ? active : days[0];
  const its = rows.filter((r) => str(r.data.day) === day);
  const dateOf = (label: string) => {
    const n = Number(/(\d+)/.exec(label)?.[1]);
    return day0 && Number.isFinite(n) ? addDays(day0, n) : null;
  };
  if (!days.length) return <Empty />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-center gap-3" data-reveal>
        {days.map((label) => {
          const date = dateOf(label);
          return (
            <button
              key={label}
              type="button"
              onClick={() => setActive(label)}
              className={cn(
                "circus-ticket min-w-[120px] px-5 py-2.5 text-center transition hover:-translate-y-1",
                day === label ? "!bg-[linear-gradient(180deg,#ff5a6e,#b3122a)] !text-white" : "opacity-90"
              )}
            >
              <span className="circus-display block text-xl">{label}</span>
              <span className="block text-[11px] font-bold opacity-80">
                {date ? `${weekdayOf(date)} ${fmtDay(date)}` : ""}
              </span>
            </button>
          );
        })}
      </div>
      {day && section.config.dayNotes?.[day] ? (
        <p className="text-center text-sm italic text-[var(--cz-gold)]">{section.config.dayNotes[day]}</p>
      ) : null}
      <div key={day} className="mx-auto grid max-w-4xl gap-2.5">
        {its.map((r, i) => (
          <div
            key={r.id}
            className="circus-card lift flex items-start gap-3 px-4 py-3 cz-rise"
            style={{ ...d(Math.min(i, 12) * 45), boxShadow: `inset 4px 0 0 ${teamColor(r.data.team)}` }}
          >
            <span className="mt-0.5 w-6 shrink-0 text-center font-mono text-xs text-[var(--cz-muted)]">{i + 1}</span>
            {/* the activity gets its own line; who owns it sits under it — on a
                phone a chip beside it squeezed the text into a sliver */}
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-semibold text-[var(--cz-cream)]" dir="auto">
                {str(r.data.activity)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="circus-chip" style={{ "--chip": teamColor(r.data.team) } as CSSProperties}>
                  {str(r.data.team) || "—"} · {str(r.data.position) || "—"}
                </span>
                {str(r.data.backup_team) || str(r.data.backup_position) ? (
                  <span className="text-[11px] text-[var(--cz-muted)]">
                    ↳ backup: {str(r.data.backup_team)} {str(r.data.backup_position) ? `· ${str(r.data.backup_position)}` : ""}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ anything else
export function PlainView({ section, rows }: { section: ActivationSection; rows: ActivationRow[] }) {
  const cols: Column[] = (section.config.columns ?? []).filter((c) => !c.hidden);
  if (!rows.length || !cols.length) return <Empty />;
  const [head, ...rest] = cols;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r, i) => (
        <div key={r.id} className="circus-card lift p-4" data-reveal style={d(Math.min(i, 9) * 50)}>
          <p className="circus-serif text-lg font-bold italic text-[var(--cz-cream)]" dir="auto">
            {cellShow(head, r.data[head.key]) || "—"}
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            {rest.map((c) => {
              const v = cellShow(c, r.data[c.key]);
              return v ? (
                <div key={c.key} className="flex gap-2">
                  <dt className="shrink-0 text-[var(--cz-muted)]">{c.label}:</dt>
                  <dd className="min-w-0 whitespace-pre-line break-words text-[var(--cz-cream)]" dir="auto">
                    {v}
                  </dd>
                </div>
              ) : null;
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}

function cellShow(c: Column, v: CellValue | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  if (c.type === "checkbox") return v ? "✓" : "";
  if (c.type === "date") return fmtDay(String(v));
  if (c.type === "select") return c.labels?.[String(v)] ?? String(v);
  return String(v);
}

function Empty() {
  return <p className="text-center text-sm text-[var(--cz-muted)]">Nothing here yet.</p>;
}
