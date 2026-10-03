"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { CalendarRange, GanttChart, List, Palette, Plus, Table2, Trash2 } from "lucide-react";
import { WalkingMan } from "@/components/crm/walking-man";
import {
  addDays, cairoTodayIso, clampSpan, columnKey, daysBetween, fmtDay, fmtSpan, isIsoDate, monthOf,
  packTracks, timelineColumns, weekdayOf, TIMELINE_KIND_LABEL, TIMELINE_KINDS,
  type ActivationRow, type ActivationSection, type Lane, type TimelineKind,
} from "@/lib/activation/model";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useBoard } from "./context";
import { useNarrow } from "./fx";
import { SheetGrid } from "./sheet-grid";

/**
 * ACT I — THE ROAD TO THE SHOW (v36.7). The merged Timeline tab as a parade:
 * one lane per team, a bar per task, a flag per checkpoint, the four show days
 * as a big top at the end. In edit mode a bar is dragged to move it and by its
 * edges to stretch it; a flag is dragged to move its checkpoint. Phones get an
 * agenda, and editors get the same rows as a sheet.
 */

const DAY_W = 38;
const LABEL_W = 138;
const TRACK_H = 34;
const HEAD_H = 76;

export interface CheckpointMark {
  id: string;
  name: string;
  date: string;
  detail: { label: string; text: string; color: string }[];
}

interface Item {
  id: string;
  title: string;
  lane: string;
  start: string;
  end: string;
  kind: TimelineKind;
  notes: string;
  original: string;
}

function toItem(r: ActivationRow): Item | null {
  const d = r.data;
  const start = String(d.start ?? "");
  if (!isIsoDate(start)) return null;
  const endRaw = String(d.end ?? "");
  const end = isIsoDate(endRaw) && endRaw >= start ? endRaw : start;
  const kind = (TIMELINE_KINDS as readonly string[]).includes(String(d.kind)) ? (d.kind as TimelineKind) : "task";
  return {
    id: r.id,
    title: String(d.title ?? "") || "Untitled",
    lane: String(d.lane ?? ""),
    start,
    end,
    kind,
    notes: String(d.notes ?? ""),
    original: String(d.original ?? ""),
  };
}

type DragKind = "move" | "start" | "end" | "cp";
interface Drag {
  id: string;
  kind: DragKind;
  x0: number;
  delta: number;
  moved: boolean;
}

function applyDrag(start: string, end: string, d: Drag, min: string, max: string): [string, string] {
  let s = start;
  let e = end;
  if (d.kind === "move" || d.kind === "cp") {
    s = addDays(s, d.delta);
    e = addDays(e, d.delta);
  } else if (d.kind === "start") {
    s = addDays(s, d.delta);
    if (s > e) s = e;
  } else {
    e = addDays(e, d.delta);
    if (e < s) e = s;
  }
  return clampSpan(s, e, min, max);
}

export function TimelineAct({
  section, rows, checkpoints,
}: { section: ActivationSection; rows: ActivationRow[]; checkpoints: CheckpointMark[] }) {
  const api = useBoard();
  const narrow = useNarrow();
  // v36.8: the WEEK BOARD is the default — every item readable at a glance,
  // no clicking slot by slot. The Gantt stays for dragging, the agenda for phones.
  const [pref, setPref] = useState<"weeks" | "gantt" | "agenda" | "sheet" | null>(null);
  const fallback = narrow ? "agenda" : "weeks";
  const layout = pref === "sheet" && !api.editing ? fallback : pref ?? fallback;
  const lanes = useMemo(() => section.config.lanes ?? [], [section.config.lanes]);
  const start = section.config.start ?? "2026-09-25";
  const end = section.config.end ?? "2026-12-05";
  const items = useMemo(() => rows.map(toItem).filter((x): x is Item => !!x), [rows]);
  const [open, setOpen] = useState<{ id: string | null; draft: Item } | null>(null);
  const [cp, setCp] = useState<CheckpointMark | null>(null);
  const [lanesOpen, setLanesOpen] = useState(false);

  const openItem = (id: string) => {
    const it = items.find((i) => i.id === id);
    if (it) setOpen({ id, draft: it });
  };
  const newItem = () => {
    const today = cairoTodayIso();
    const day = today >= start && today <= end ? today : start;
    setOpen({
      id: null,
      draft: {
        id: "", title: "", lane: lanes.find((l) => l.key !== "all")?.key ?? lanes[0]?.key ?? "all",
        start: day, end: day, kind: "task", notes: "", original: "",
      },
    });
  };

  const views: [typeof layout, typeof GanttChart, string][] = [
    ["weeks", CalendarRange, "Week by week"],
    ["gantt", GanttChart, "Timeline"],
    ["agenda", List, "Agenda"],
    ...(api.editing ? ([["sheet", Table2, "Sheet"]] as [typeof layout, typeof GanttChart, string][]) : []),
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2" data-reveal>
        <div className="inline-flex rounded-full bg-white/5 p-1 ring-1 ring-[var(--cz-line)]">
          {views.map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPref(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition",
                layout === key ? "bg-[var(--cz-gold)] text-[#2a0710]" : "text-[var(--cz-muted)] hover:text-[var(--cz-cream)]"
              )}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {lanes.map((l) => (
            <span key={l.key} className="circus-chip" style={{ "--chip": l.color } as CSSProperties}>
              {l.label}
            </span>
          ))}
        </div>
        {api.editing ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="circus-btn !px-4 !py-2 !text-xs" onClick={newItem}>
              <Plus className="size-4" /> Add to the show
            </button>
            <button type="button" className="circus-btn ghost !px-4 !py-2 !text-xs" onClick={() => setLanesOpen(true)}>
              <Palette className="size-4" /> Teams & dates
            </button>
          </div>
        ) : null}
      </div>
      {api.editing && layout === "gantt" ? (
        <p className="mb-3 text-xs text-[var(--cz-muted)]">
          Drag a bar to move it · drag its edges to change how long it runs · click it to edit · drag a 🚩 to move a
          checkpoint.
        </p>
      ) : null}

      <Opening start={start} end={end} />

      {layout === "sheet" ? (
        <SheetGrid
          columns={timelineColumns(lanes)}
          rows={rows}
          onCommit={(rowId, key, value) => api.setCells(rowId, { [key]: value })}
          onAddRow={(near) => api.addRow(section.id, { kind: "task", start, end: start, lane: lanes[1]?.key ?? "all", title: "" }, near)}
          onDeleteRow={api.deleteRow}
          onDeleteRows={api.deleteRows}
          onSetMany={(updates) => api.setMany(section.id, updates)}
          onMoveRow={api.moveRow}
          onPaste={(r, c, m) => api.paste(section.id, r, c, m, timelineColumns(lanes))}
          colorOf={(col, v) => (col.key === "lane" ? lanes.find((l) => l.key === v)?.color : undefined)}
        />
      ) : layout === "agenda" ? (
        <Agenda items={items} lanes={lanes} start={start} end={end} checkpoints={checkpoints} onOpen={openItem} onCp={setCp} />
      ) : layout === "weeks" ? (
        <WeekBoard items={items} lanes={lanes} start={start} end={end} checkpoints={checkpoints} onOpen={openItem} onCp={setCp} />
      ) : (
        <Gantt
          items={items}
          lanes={lanes}
          start={start}
          end={end}
          checkpoints={checkpoints}
          editing={api.editing}
          onOpen={openItem}
          onMove={(id, s, e) => api.setCells(id, { start: s, end: e })}
          onCp={setCp}
          onCpMove={(id, date) => api.setCells(id, { date })}
        />
      )}

      <ItemDialog
        state={open}
        lanes={lanes}
        min={start}
        max={end}
        editing={api.editing}
        onClose={() => setOpen(null)}
        onSave={(id, draft) => {
          const data = {
            title: draft.title.trim(), lane: draft.lane, start: draft.start, end: draft.end,
            kind: draft.kind, notes: draft.notes,
          };
          if (id) api.setCells(id, data);
          else api.addRow(section.id, data);
          setOpen(null);
        }}
        onDelete={(id) => {
          api.deleteRow(id);
          setOpen(null);
        }}
      />
      <CheckpointDialog mark={cp} onClose={() => setCp(null)} />
      {api.editing ? (
        <LanesDialog
          open={lanesOpen}
          onOpenChange={setLanesOpen}
          lanes={lanes}
          start={start}
          end={end}
          counts={Object.fromEntries(lanes.map((l) => [l.key, items.filter((i) => i.lane === l.key).length]))}
          onSave={async (next) => {
            const ok = await api.updateSection(section.id, { config: next });
            if (ok) setLanesOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Before the road opens: where we are, walking towards it. */
function Opening({ start, end }: { start: string; end: string }) {
  const today = cairoTodayIso();
  if (today >= start) {
    if (today > end) return null;
    return null;
  }
  const n = daysBetween(today, start);
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm ring-1 ring-[var(--cz-line)]" data-reveal>
      <WalkingMan height={28} tone="white" />
      <span>
        The road opens with the bid result on <b>{weekdayOf(start)} {fmtDay(start)}</b> — {n} day{n === 1 ? "" : "s"} from today.
      </span>
    </div>
  );
}

function Gantt({
  items, lanes, start, end, checkpoints, editing, onOpen, onMove, onCp, onCpMove,
}: {
  items: Item[];
  lanes: Lane[];
  start: string;
  end: string;
  checkpoints: CheckpointMark[];
  editing: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, start: string, end: string) => void;
  onCp: (m: CheckpointMark) => void;
  onCpMove: (id: string, date: string) => void;
}) {
  const total = Math.max(1, daysBetween(start, end) + 1);
  const trackW = total * DAY_W;
  const days = useMemo(() => Array.from({ length: total }, (_, i) => addDays(start, i)), [start, total]);
  const months = useMemo(() => {
    const out: { label: string; from: number; count: number }[] = [];
    days.forEach((d, i) => {
      const m = monthOf(d);
      if (out.length && out[out.length - 1].label === m) out[out.length - 1].count++;
      else out.push({ label: m, from: i, count: 1 });
    });
    return out;
  }, [days]);
  const today = cairoTodayIso();
  const todayIdx = daysBetween(start, today);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // open on today (or the start) rather than wherever the scroll happened to be
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (todayIdx > 3 && todayIdx < total) el.scrollLeft = Math.max(0, todayIdx * DAY_W - 160);
  }, [todayIdx, total]);

  const lanesWithItems = useMemo(() => {
    const known = new Set(lanes.map((l) => l.key));
    const orphans = items.filter((i) => !known.has(i.lane));
    const list = [
      ...lanes.map((l) => ({ lane: l, list: items.filter((i) => i.lane === l.key) })),
      ...(orphans.length ? [{ lane: { key: "_", label: "No team", color: "#cdb9a3" }, list: orphans }] : []),
    ];
    return list.map(({ lane, list: its }) => {
      const clamped = its.map((it) => {
        const [s, e] = clampSpan(it.start, it.end, start, end);
        return { ...it, start: s, end: e };
      });
      const packed = packTracks(clamped);
      const tracks = Math.max(1, ...packed.map((p) => p.track + 1));
      return { lane, packed, tracks };
    });
  }, [lanes, items, start, end]);

  const begin = (e: PointerEvent<HTMLElement>, id: string, kind: DragKind) => {
    if (!editing || e.button !== 0) return;
    e.stopPropagation();
    // capture keeps the drag alive when the pointer leaves the bar; a browser
    // that refuses it (an unusual pointer, a stale id) still gets a working drag
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {}
    dragRef.current = { id, kind, x0: e.clientX, delta: 0, moved: false };
  };
  const track = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    const delta = Math.round(dx / DAY_W);
    if (delta !== d.delta || !drag) {
      d.delta = delta;
      setDrag({ ...d });
    }
  };
  const finish = (e: PointerEvent<HTMLElement>, onTap: () => void, commit: (d: Drag) => void) => {
    e.stopPropagation();
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (!d.moved) onTap();
    else if (d.delta !== 0) commit(d);
  };
  const cancel = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const shown = (it: Item): [string, string] =>
    drag && drag.id === it.id && drag.kind !== "cp" ? applyDrag(it.start, it.end, drag, start, end) : [it.start, it.end];

  return (
    <div ref={scrollRef} className="tl-scroll rounded-2xl bg-[#130a20]/80 ring-1 ring-[var(--cz-line)]" data-reveal>
      <div className="relative" style={{ width: LABEL_W + trackW }}>
        {/* header: months · checkpoint flags · days */}
        <div className="flex border-b border-white/10" style={{ height: HEAD_H }}>
          <div
            className="tl-lane-label sticky left-0 flex shrink-0 items-end px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--cz-muted)]"
            style={{ width: LABEL_W }}
          >
            Teams
          </div>
          <div className="relative shrink-0" style={{ width: trackW }}>
            {months.map((m) => (
              <div
                key={m.label + m.from}
                className="absolute top-1 border-l border-[var(--cz-line)] pl-2 text-xs font-black uppercase tracking-widest text-[var(--cz-gold)]"
                style={{ left: m.from * DAY_W, width: m.count * DAY_W }}
              >
                {m.label}
              </div>
            ))}
            {checkpoints.map((c, i) => {
              const date = drag?.kind === "cp" && drag.id === c.id ? applyDrag(c.date, c.date, drag, start, end)[0] : c.date;
              const idx = daysBetween(start, date);
              if (idx < 0 || idx >= total) return null;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="tl-flag"
                  style={{ left: idx * DAY_W + DAY_W / 2, top: 22 }}
                  title={`${c.name} · ${fmtDay(date)}`}
                  onPointerDown={(e) => begin(e, c.id, "cp")}
                  onPointerMove={track}
                  onPointerUp={(e) =>
                    finish(e, () => onCp(c), (d) => onCpMove(c.id, applyDrag(c.date, c.date, d, start, end)[0]))
                  }
                  onPointerCancel={cancel}
                  onClick={editing ? undefined : () => onCp(c)}
                >
                  🚩 {i + 1}
                </button>
              );
            })}
            {days.map((d, i) => {
              const wd = weekdayOf(d);
              return (
                <div
                  key={d}
                  className={cn(
                    "absolute bottom-1 flex flex-col items-center text-[10px] leading-tight",
                    wd === "Fri" || wd === "Sat" ? "text-[var(--cz-muted)]/60" : "text-[var(--cz-muted)]",
                    i === todayIdx && "font-black text-[var(--cz-crimson)]"
                  )}
                  style={{ left: i * DAY_W, width: DAY_W }}
                >
                  <span>{wd.charAt(0)}</span>
                  <span className="text-[12px] font-bold text-[var(--cz-cream)]">{Number(d.slice(8))}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* body */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0" style={{ left: LABEL_W, width: trackW }}>
            {days.map((d, i) =>
              weekdayOf(d) === "Fri" || weekdayOf(d) === "Sat" ? (
                <div key={d} className="tl-weekend absolute inset-y-0" style={{ left: i * DAY_W, width: DAY_W }} />
              ) : null
            )}
            {checkpoints.map((c) => {
              const idx = daysBetween(start, c.date);
              return idx >= 0 && idx < total ? (
                <div key={c.id} className="tl-cp-line" style={{ left: idx * DAY_W + DAY_W / 2 - 1 }} />
              ) : null;
            })}
            {todayIdx >= 0 && todayIdx < total ? (
              <div className="tl-today" style={{ left: todayIdx * DAY_W + DAY_W / 2 - 1 }} />
            ) : null}
          </div>

          {lanesWithItems.map(({ lane, packed, tracks }) => (
            <div key={lane.key} className="relative flex border-t border-white/5" style={{ height: tracks * TRACK_H + 10 }}>
              <div
                className="tl-lane-label sticky left-0 flex shrink-0 items-center gap-2 px-3 text-xs font-bold text-[var(--cz-cream)]"
                style={{ width: LABEL_W }}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: lane.color, boxShadow: `0 0 10px ${lane.color}` }} />
                <span className="truncate">{lane.label}</span>
                <span className="ml-auto text-[10px] font-semibold text-[var(--cz-muted)]">{packed.length}</span>
              </div>
              <div className="relative shrink-0" style={{ width: trackW }}>
                {lane.key === "all" && todayIdx >= 0 && todayIdx < total ? (
                  <span className="pointer-events-none absolute -top-1 z-[4]" style={{ left: todayIdx * DAY_W + 4 }}>
                    <WalkingMan height={20} tone="white" />
                  </span>
                ) : null}
                {packed.map(({ item: it, track: t }) => {
                  const [s, e] = shown(it);
                  const left = daysBetween(start, s) * DAY_W + 2;
                  const width = (daysBetween(s, e) + 1) * DAY_W - 4;
                  return (
                    <div
                      key={it.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "tl-bar",
                        it.kind === "milestone" && "milestone",
                        it.kind === "show" && "show",
                        drag?.id === it.id && "is-dragging"
                      )}
                      style={{ "--lane": lane.color, left, width, top: 5 + t * TRACK_H } as CSSProperties}
                      title={`${it.title} · ${fmtSpan(s, e)}`}
                      onPointerDown={(ev) => begin(ev, it.id, "move")}
                      onPointerMove={track}
                      onPointerUp={(ev) =>
                        finish(ev, () => onOpen(it.id), (d) => {
                          const [ns, ne] = applyDrag(it.start, it.end, d, start, end);
                          onMove(it.id, ns, ne);
                        })
                      }
                      onPointerCancel={cancel}
                      onClick={editing ? undefined : () => onOpen(it.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          onOpen(it.id);
                        }
                      }}
                    >
                      <span className="truncate">
                        {it.kind === "milestone" ? "★ " : it.kind === "show" ? "🎪 " : ""}
                        {it.title}
                      </span>
                      {editing ? (
                        <>
                          <span
                            className="tl-handle l"
                            onPointerDown={(ev) => begin(ev, it.id, "start")}
                            onPointerMove={track}
                            onPointerUp={(ev) =>
                              finish(ev, () => onOpen(it.id), (d) => {
                                const [ns, ne] = applyDrag(it.start, it.end, d, start, end);
                                onMove(it.id, ns, ne);
                              })
                            }
                            onPointerCancel={cancel}
                          />
                          <span
                            className="tl-handle r"
                            onPointerDown={(ev) => begin(ev, it.id, "end")}
                            onPointerMove={track}
                            onPointerUp={(ev) =>
                              finish(ev, () => onOpen(it.id), (d) => {
                                const [ns, ne] = applyDrag(it.start, it.end, d, start, end);
                                onMove(it.id, ns, ne);
                              })
                            }
                            onPointerCancel={cancel}
                          />
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Agenda({
  items, lanes, start, end, checkpoints, onOpen, onCp,
}: {
  items: Item[];
  lanes: Lane[];
  start: string;
  end: string;
  checkpoints: CheckpointMark[];
  onOpen: (id: string) => void;
  onCp: (m: CheckpointMark) => void;
}) {
  const color = (k: string) => lanes.find((l) => l.key === k)?.color ?? "#cdb9a3";
  const today = cairoTodayIso();
  const weeks = weeksOf(start, end);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {weeks.map((w) => {
        const days: string[] = [];
        for (let d = w.from; d <= w.to; d = addDays(d, 1)) days.push(d);
        const busy = days
          .map((d) => ({
            d,
            its: items.filter((i) => i.start === d || (d === w.from && i.start < w.from && i.end >= w.from)),
            cps: checkpoints.filter((c) => c.date === d),
          }))
          .filter((x) => x.its.length || x.cps.length);
        return (
          <section key={w.n} className="circus-card lift p-4" data-reveal>
            <h4 className="flex items-baseline justify-between gap-2">
              <span className="circus-serif text-xl font-bold italic text-[var(--cz-cream)]">Week {w.n}</span>
              <span className="text-xs text-[var(--cz-muted)]">
                {fmtDay(w.from)} – {fmtDay(w.to)}
              </span>
            </h4>
            {busy.length === 0 ? <p className="mt-3 text-sm text-[var(--cz-muted)]">A quiet week.</p> : null}
            {busy.map(({ d, its, cps }) => (
              <div key={d} className="flex gap-3 border-t border-white/5 py-2.5 first:mt-2">
                <div className={cn("w-12 shrink-0 text-center", d === today && "text-[var(--cz-crimson)]")}>
                  <div className="text-[10px] font-bold uppercase text-[var(--cz-muted)]">{weekdayOf(d)}</div>
                  <div className="circus-display text-xl leading-none text-[var(--cz-gold)]">{Number(d.slice(8))}</div>
                  <div className="text-[10px] text-[var(--cz-muted)]">{monthOf(d)}</div>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap content-start gap-1.5">
                  {cps.map((c) => (
                    <button key={c.id} type="button" className="circus-chip" onClick={() => onCp(c)}>
                      🚩 {c.name}
                    </button>
                  ))}
                  {its.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      onClick={() => onOpen(i.id)}
                      className="circus-chip max-w-full text-left"
                      style={{ "--chip": i.kind === "milestone" ? "#f7c65b" : i.kind === "show" ? "#d7263d" : color(i.lane) } as CSSProperties}
                    >
                      <span className="truncate">
                        {i.kind === "show" ? "🎪 " : i.kind === "milestone" ? "★ " : ""}
                        {i.title}
                        {i.end > i.start ? ` → ${fmtDay(i.end)}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** The road in seven-day blocks from its first day. */
function weeksOf(start: string, end: string): { n: number; from: string; to: string }[] {
  const weeks: { n: number; from: string; to: string }[] = [];
  for (let w = 0; w < 60; w++) {
    const from = addDays(start, w * 7);
    if (from > end) break;
    const to = addDays(from, 6) > end ? end : addDays(from, 6);
    weeks.push({ n: w + 1, from, to });
  }
  return weeks;
}

/**
 * THE WEEK BOARD (v36.8) — "from outside I can see the details without
 * clicking each slot". One row per week, one column per team, and every item
 * written out in full with its date where it starts. Something still running
 * from an earlier week shows as a muted "↳ … until" line, so a long task is
 * never invisible in the weeks it covers. Checkpoints and the show days sit
 * in the week's own label. A click still opens the full item.
 */
function WeekBoard({
  items, lanes, start, end, checkpoints, onOpen, onCp,
}: {
  items: Item[];
  lanes: Lane[];
  start: string;
  end: string;
  checkpoints: CheckpointMark[];
  onOpen: (id: string) => void;
  onCp: (m: CheckpointMark) => void;
}) {
  const today = cairoTodayIso();
  const weeks = weeksOf(start, end);
  const known = new Set(lanes.map((l) => l.key));
  const cols: Lane[] = [
    ...lanes,
    ...(items.some((i) => !known.has(i.lane)) ? [{ key: "_", label: "No team", color: "#cdb9a3" }] : []),
  ];
  const laneOf = (i: Item) => (known.has(i.lane) ? i.lane : "_");
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const when = (i: Item) =>
    i.end > i.start ? `${fmtDay(i.start)} → ${fmtDay(i.end)}` : `${weekdayOf(i.start)} ${fmtDay(i.start)}`;

  return (
    <div>
      <p className="mb-3 text-xs text-[var(--cz-muted)]">
        Read across: each row is one week, each column a team. <span className="text-[var(--cz-cream)]">↳</span> means
        still running from an earlier week. Tap anything for its notes.
      </p>
      <div className="tl-scroll wk-wrap" data-reveal>
        <table className="wk">
          <thead>
            <tr>
              <th className="wk-weekcol">Week</th>
              {cols.map((l) => (
                <th key={l.key} style={{ "--lane": l.color } as CSSProperties}>
                  <span className="wk-lane-dot" />
                  {l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const isNow = today >= w.from && today <= w.to;
              const cps = checkpoints.filter((c) => c.date >= w.from && c.date <= w.to);
              return (
                <tr key={w.n} className={cn(isNow && "is-now")}>
                  <th className="wk-weekcol" scope="row">
                    <span className="circus-serif block text-lg font-bold italic text-[var(--cz-cream)]">Week {w.n}</span>
                    <span className="block text-[11px] font-semibold text-[var(--cz-muted)]">
                      {fmtDay(w.from)} – {fmtDay(w.to)}
                    </span>
                    {isNow ? <span className="wk-now">This week</span> : null}
                    {cps.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="wk-flag"
                        onClick={() => onCp(c)}
                        title={c.detail.filter((x) => x.text).map((x) => `${x.label}: ${x.text}`).join("\n") || undefined}
                      >
                        🚩 {c.name} · {weekdayOf(c.date)} {fmtDay(c.date)}
                      </button>
                    ))}
                  </th>
                  {cols.map((l) => {
                    const starts = sorted.filter((i) => laneOf(i) === l.key && i.start >= w.from && i.start <= w.to);
                    const carry = sorted.filter((i) => laneOf(i) === l.key && i.start < w.from && i.end >= w.from);
                    return (
                      <td key={l.key} style={{ "--lane": l.color } as CSSProperties}>
                        {starts.length === 0 && carry.length === 0 ? <span className="wk-empty">—</span> : null}
                        {carry.map((i) => (
                          <button key={`c-${i.id}`} type="button" className="wk-item is-cont" onClick={() => onOpen(i.id)}>
                            ↳ {i.title} <span className="wk-date">· until {fmtDay(i.end)}</span>
                          </button>
                        ))}
                        {starts.map((i) => (
                          <button
                            key={i.id}
                            type="button"
                            className={cn("wk-item", i.kind === "milestone" && "is-milestone", i.kind === "show" && "is-show")}
                            onClick={() => onOpen(i.id)}
                          >
                            <span className="wk-date">{when(i)}</span>
                            <span className="wk-title" dir="auto">
                              {i.kind === "show" ? "🎪 " : i.kind === "milestone" ? "★ " : ""}
                              {i.title}
                            </span>
                          </button>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemDialog({
  state, lanes, min, max, editing, onClose, onSave, onDelete,
}: {
  state: { id: string | null; draft: Item } | null;
  lanes: Lane[];
  min: string;
  max: string;
  editing: boolean;
  onClose: () => void;
  onSave: (id: string | null, draft: Item) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {state ? (
          editing ? (
            <ItemForm key={state.id ?? "new"} state={state} lanes={lanes} min={min} max={max} onSave={onSave} onDelete={onDelete} />
          ) : (
            <ItemTicket item={state.draft} lane={lanes.find((l) => l.key === state.draft.lane)} />
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ItemTicket({ item, lane }: { item: Item; lane?: Lane }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {item.kind === "show" ? "🎪" : item.kind === "milestone" ? "★" : "🎟️"} {item.title}
        </DialogTitle>
        <DialogDescription>
          {fmtSpan(item.start, item.end)}
          {item.end > item.start ? ` · ${daysBetween(item.start, item.end) + 1} days` : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ background: lane?.color ?? "#888" }}>
          {lane?.label ?? "No team"}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">{TIMELINE_KIND_LABEL[item.kind]}</span>
      </div>
      {item.notes ? <p className="whitespace-pre-line text-sm" dir="auto">{item.notes}</p> : null}
    </>
  );
}

function ItemForm({
  state, lanes, min, max, onSave, onDelete,
}: {
  state: { id: string | null; draft: Item };
  lanes: Lane[];
  min: string;
  max: string;
  onSave: (id: string | null, draft: Item) => void;
  onDelete: (id: string) => void;
}) {
  const [d, setD] = useState<Item>(state.draft);
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setD((x) => ({ ...x, [k]: v }));
  const problem = !d.title.trim()
    ? "Give it a name."
    : !isIsoDate(d.start) || !isIsoDate(d.end)
      ? "Pick real dates."
      : d.end < d.start
        ? "It can't end before it starts."
        : // (v37.8) an item wholly outside the road matches no week, so the Week and Agenda views silently dropped it
          d.start > max || d.end < min
          ? `That's outside the road (${fmtDay(min)} – ${fmtDay(max)}). Pick dates inside it.`
          : null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{state.id ? "Edit this act" : "Add to the show"}</DialogTitle>
        {state.id && d.original ? (
          <DialogDescription>In the original sheet: {d.original.split(" → ").map(fmtDay).join(" → ")}</DialogDescription>
        ) : null}
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label>What</Label>
          <Input autoFocus value={d.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Team</Label>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={d.lane} onChange={(e) => set("lane", e.target.value)}>
              {lanes.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>Kind</Label>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={d.kind}
              onChange={(e) => set("kind", e.target.value as TimelineKind)}
            >
              {TIMELINE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TIMELINE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>Starts</Label>
            <Input type="date" min={min} max={max} value={d.start} onChange={(e) => set("start", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Ends</Label>
            <Input type="date" min={min} max={max} value={d.end} onChange={(e) => set("end", e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Notes</Label>
          <Textarea rows={3} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        {problem ? <p className="text-xs text-destructive">{problem}</p> : null}
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        {state.id ? (
          <Button variant="destructive" onClick={() => onDelete(state.id!)}>
            <Trash2 className="size-4" /> Delete
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={!!problem} onClick={() => onSave(state.id, d)}>
          {state.id ? "Save" : "Add it"}
        </Button>
      </DialogFooter>
    </>
  );
}

function CheckpointDialog({ mark, onClose }: { mark: CheckpointMark | null; onClose: () => void }) {
  return (
    <Dialog open={!!mark} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {mark ? (
          <>
            <DialogHeader>
              <DialogTitle>
                🚩 {mark.name}
              </DialogTitle>
              <DialogDescription>
                {weekdayOf(mark.date)} {fmtDay(mark.date)} — what each team brings to it
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {mark.detail.filter((x) => x.text).length === 0 ? (
                <p className="text-sm text-muted-foreground">No deliverables written down yet.</p>
              ) : (
                mark.detail
                  .filter((x) => x.text)
                  .map((x) => (
                    <div key={x.label} className="rounded-lg border-l-4 bg-muted/40 px-3 py-2 text-sm" style={{ borderColor: x.color }}>
                      <b>{x.label}</b> — <span dir="auto">{x.text}</span>
                    </div>
                  ))
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LanesDialog({
  open, onOpenChange, lanes, start, end, counts, onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lanes: Lane[];
  start: string;
  end: string;
  counts: Record<string, number>;
  onSave: (next: { lanes: Lane[]; start: string; end: string }) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open ? <LanesForm lanes={lanes} start={start} end={end} counts={counts} onSave={onSave} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LanesForm({
  lanes, start, end, counts, onSave,
}: {
  lanes: Lane[];
  start: string;
  end: string;
  counts: Record<string, number>;
  onSave: (next: { lanes: Lane[]; start: string; end: string }) => Promise<void>;
}) {
  const [list, setList] = useState<Lane[]>(lanes);
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const [busy, setBusy] = useState(false);
  const valid = isIsoDate(s) && isIsoDate(e) && e >= s && list.every((l) => l.label.trim()) && list.length > 0;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Teams & dates</DialogTitle>
        <DialogDescription>Rename a team, recolour it, add one — and set where the road starts and ends.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        {list.map((l, i) => (
          <div key={l.key} className="flex items-center gap-2">
            <input
              type="color"
              value={l.color}
              onChange={(ev) => setList(list.map((x, j) => (j === i ? { ...x, color: ev.target.value } : x)))}
              className="h-9 w-10 cursor-pointer rounded border bg-transparent"
              aria-label={`${l.label} colour`}
            />
            <Input value={l.label} onChange={(ev) => setList(list.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} />
            <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">{counts[l.key] ?? 0} items</span>
            <Button
              variant="ghost"
              size="icon"
              disabled={(counts[l.key] ?? 0) > 0 || list.length <= 1}
              title={(counts[l.key] ?? 0) > 0 ? "Move its items to another team first" : "Remove"}
              onClick={() => setList(list.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() =>
            setList([...list, { key: columnKey("team", list.map((l) => l.key)), label: "New team", color: "#ffd166" }])
          }
        >
          <Plus className="size-4" /> Add a team
        </Button>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Road starts</Label>
            <Input type="date" value={s} onChange={(ev) => setS(ev.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Road ends</Label>
            <Input type="date" value={e} onChange={(ev) => setE(ev.target.value)} />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({ lanes: list.map((l) => ({ ...l, label: l.label.trim() })), start: s, end: e });
            } finally {
              setBusy(false); // (v37.8) a throw used to leave "Saving…" stuck
            }
          }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
      {!valid ? <p className="text-xs text-destructive">Every team needs a name, and the road can&apos;t end before it starts.</p> : null}
    </>
  );
}
