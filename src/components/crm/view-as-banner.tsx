"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Eye, GripVertical, Loader2, X } from "lucide-react";
import { setViewAsMode, startViewAs, stopViewAs } from "@/server/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface ViewAsTargetLite {
  id: string;
  label: string;
  role: string;
  functions: string;
}

type Mode = "sandbox" | "real";
type Edge = "left" | "right" | "top" | "bottom";
type Saved = { edge: Edge; frac: number; collapsed: boolean };

const LS_KEY = "sodio-viewas-chip";
const MARGIN = 12; // px gap between the chip and its snapped edge
const MARGIN_COLLAPSED = 6; // the collapsed tab hugs the edge tighter

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
const isEdge = (v: unknown): v is Edge =>
  v === "left" || v === "right" || v === "top" || v === "bottom";

/** Top-left corner (px, wrapper-relative) for a chip of w×h snapped to `edge`
 *  at `frac` (0..1 = chip CENTER along the free axis), clamped into view. */
function snapPoint(
  edge: Edge, frac: number, W: number, H: number, w: number, h: number, m: number,
) {
  const x = clamp(frac * W - w / 2, m, Math.max(m, W - w - m));
  const y = clamp(frac * H - h / 2, m, Math.max(m, H - h - m));
  switch (edge) {
    case "left": return { x: m, y };
    case "right": return { x: Math.max(m, W - w - m), y };
    case "top": return { x, y: m };
    case "bottom": return { x, y: Math.max(m, H - h - m) };
  }
}

/** Chevron rotation so the collapse arrow points AT the snapped edge. */
const CHEVRON_ROTATION: Record<Edge, number> = { bottom: 0, top: 180, left: 90, right: -90 };

/** Movable test-view chip, always visible while the admin impersonates a
 *  member. Drag it by the 👁 + "Test view" handle and it snaps to the nearest
 *  screen edge (position remembered); collapse it to a tiny 👁 tab; switch the
 *  target live; flip between 🧪 Sandbox (default — everything is rolled back on
 *  exit, no emails/notifications) and ⚡ Real mode; Exit returns to yourself. */
export function ViewAsBanner({
  activeId,
  targets,
  mode: modeProp = "sandbox",
  undoable = true,
}: {
  activeId: string;
  targets: ViewAsTargetLite[];
  mode?: Mode;
  undoable?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  /** two-step Exit in a sandbox — the first click asks, the second discards */
  const [confirmExit, setConfirmExit] = useState(false);
  // (v37.8) the armed "Discard & exit?" used to stay red forever — disarm after a few seconds
  useEffect(() => {
    if (!confirmExit) return;
    const t = setTimeout(() => setConfirmExit(false), 4000);
    return () => clearTimeout(t);
  }, [confirmExit]);

  const [mode, setMode] = useState<Mode>(modeProp);
  useEffect(() => setMode(modeProp), [modeProp]);

  // ------------------------------------------------------------- placement
  const wrapRef = useRef<HTMLDivElement>(null); // safe-area-inset viewport box
  const chipRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<Edge>("bottom");
  const [frac, setFrac] = useState(0.5); // bottom-center default
  const [collapsed, setCollapsed] = useState(false);
  const [box, setBox] = useState({ W: 0, H: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false); // hidden until restored + measured
  const [animate, setAnimate] = useState(false); // no snap glide on first paint

  // drag state — `free` = wrapper-relative top-left while the pointer holds it
  const [free, setFree] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const freeRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const persist = (s: Saved) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* private mode etc. */ }
  };

  const measure = () => {
    const wrap = wrapRef.current, chip = chipRef.current;
    if (wrap) setBox({ W: wrap.offsetWidth, H: wrap.offsetHeight });
    if (chip) setSize({ w: chip.offsetWidth, h: chip.offsetHeight });
  };

  // restore the saved spot (SSR-safe: localStorage only touched here), then
  // reveal — snap transitions switch on a frame later so mount never glides
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Saved>;
        if (isEdge(s.edge)) setEdge(s.edge);
        if (typeof s.frac === "number" && Number.isFinite(s.frac)) setFrac(clamp(s.frac, 0, 1));
        if (typeof s.collapsed === "boolean") setCollapsed(s.collapsed);
      }
    } catch { /* corrupt payload → default bottom-center */ }
    measure();
    setReady(true);
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // keep viewport + chip sizes fresh (resize, rotate, collapse, target rename)
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    if (chipRef.current) ro.observe(chipRef.current);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------- dragging
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current, chip = chipRef.current;
    if (!wrap || !chip) return;
    const wr = wrap.getBoundingClientRect();
    const cr = chip.getBoundingClientRect();
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: cr.left - wr.left,
      baseY: cr.top - wr.top,
    };
    freeRef.current = { x: dragRef.current.baseX, y: dragRef.current.baseY };
    setFree(freeRef.current);
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    const wrap = wrapRef.current, chip = chipRef.current;
    if (!wrap || !chip) return;
    const next = {
      x: clamp(d.baseX + (e.clientX - d.startX), 0, Math.max(0, wrap.offsetWidth - chip.offsetWidth)),
      y: clamp(d.baseY + (e.clientY - d.startY), 0, Math.max(0, wrap.offsetHeight - chip.offsetHeight)),
    };
    freeRef.current = next;
    setFree(next);
  };

  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    dragRef.current = null;
    setDragging(false);
    const wrap = wrapRef.current, chip = chipRef.current, p = freeRef.current;
    if (wrap && chip && p) {
      const W = wrap.offsetWidth, H = wrap.offsetHeight;
      const w = chip.offsetWidth, h = chip.offsetHeight;
      // nearest edge wins; keep the release position along the other axis
      const dists: [Edge, number][] = [
        ["bottom", H - (p.y + h)], ["top", p.y], ["left", p.x], ["right", W - (p.x + w)],
      ];
      const [nextEdge] = dists.reduce((a, b) => (b[1] < a[1] ? b : a));
      const nextFrac = nextEdge === "left" || nextEdge === "right"
        ? clamp((p.y + h / 2) / Math.max(1, H), 0, 1)
        : clamp((p.x + w / 2) / Math.max(1, W), 0, 1);
      setEdge(nextEdge);
      setFrac(nextFrac);
      persist({ edge: nextEdge, frac: nextFrac, collapsed });
    }
    freeRef.current = null;
    setFree(null); // rendering falls back to the snapped point → CSS glides there
  };

  const toggleCollapsed = (c: boolean) => {
    setConfirmExit(false);
    setCollapsed(c);
    persist({ edge, frac, collapsed: c });
  };

  // ------------------------------------------------------------- actions
  const switchTo = (id: string) => {
    if (id === activeId) return;
    setConfirmExit(false);
    start(async () => {
      const res = await startViewAs(id, mode); // switching keeps the current mode
      if (res.ok) {
        toast.success(`👁 Now viewing as ${res.data?.name}.`);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const changeMode = (m: Mode) => {
    if (m === mode || pending) return;
    setConfirmExit(false);
    const prev = mode;
    setMode(m); // optimistic — the ring recolors instantly
    start(async () => {
      const res = await setViewAsMode(m);
      if (res.ok) {
        if (m === "sandbox")
          toast.success("Sandbox — actions will be undone when you exit, and no emails/notifications go out.");
        else {
          const rb = res.data?.rolledBack ?? 0;
          toast.warning(
            rb > 0
              ? `⚡ Real mode — permanent from here. Your ${rb} sandbox change${rb === 1 ? "" : "s"} ${rb === 1 ? "was" : "were"} rolled back.`
              : "⚡ Real mode — actions are permanent and visible to everyone!"
          );
        }
        router.refresh();
      } else {
        setMode(prev);
        toast.error(res.error);
      }
    });
  };

  /** Exiting a SANDBOX throws away every change made inside it — which is the
   *  point, and also the thing people forget. An account archived in a
   *  sandbox came back the moment the session ended, twice, and nothing in
   *  the interface had said it would (v33.9). So: confirm before discarding,
   *  and name the number. Real mode exits straight out — nothing to lose. */
  const exit = () => {
    if (sandbox && !confirmExit) {
      setConfirmExit(true);
      return;
    }
    setConfirmExit(false);
    start(async () => {
      const res = await stopViewAs();
      if (res.ok) {
        const undone = res.data?.undone ?? 0;
        toast.success(
          undone > 0 ? `Test view closed — ${undone} change(s) rolled back.` : "Test view closed.",
        );
        router.refresh();
      } else toast.error(res.error);
    });
  };

  // ------------------------------------------------------------- render
  const margin = collapsed ? MARGIN_COLLAPSED : MARGIN;
  const snapped = snapPoint(edge, frac, box.W, box.H, size.w, size.h, margin);
  const pos = free ?? snapped;
  const sandbox = mode === "sandbox";
  const stop = (e: React.PointerEvent) => e.stopPropagation(); // controls never start a drag

  return (
    // pointer-events-none full-viewport layer (inset by the device safe areas,
    // so a bottom/side snap always clears the notch/home bar) — only the chip
    // itself may swallow clicks; everything beneath stays live
    <div
      ref={wrapRef}
      className="pointer-events-none fixed z-50"
      style={{
        top: "env(safe-area-inset-top, 0px)",
        right: "env(safe-area-inset-right, 0px)",
        bottom: "env(safe-area-inset-bottom, 0px)",
        left: "env(safe-area-inset-left, 0px)",
      }}
    >
      <div
        ref={chipRef}
        className={cn(
          "pointer-events-auto absolute flex max-w-full select-none items-center rounded-full border bg-card text-sm font-medium backdrop-blur",
          sandbox ? "ring-1 ring-cyan-400/60" : "ring-2 ring-amber-500/80",
          dragging ? "scale-[1.04] shadow-2xl" : "shadow-xl",
          animate && !dragging ? "transition-[left,top] duration-200 ease-out" : "transition-none",
          collapsed ? "p-0" : "gap-2 px-3 py-1.5",
        )}
        style={{ left: pos.x, top: pos.y, visibility: ready ? undefined : "hidden" }}
      >
        {collapsed ? (
          <button
            type="button"
            aria-label="Expand test view controls"
            title={`Test view (${sandbox ? "🧪 sandbox" : "⚡ real mode"}) — click to expand`}
            onClick={() => toggleCollapsed(false)}
            className="grid size-10 shrink-0 place-items-center rounded-full"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Eye className={cn("size-4", sandbox ? "text-cyan-500" : "text-amber-500")} />
            )}
          </button>
        ) : (
          <>
            {/* THE GRIP is the only drag origin (v33.19). The label used to be
                grabbable too, so a press meant to read the chip moved it and a
                near-miss on a button dragged instead of clicking. size-8 = a
                32px touch target; touch-none so a drag isn't stolen by the
                page's scroll. */}
            <div
              aria-hidden
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              title="Drag to move — snaps to the nearest edge"
              className={cn(
                "-ml-1.5 grid size-8 shrink-0 touch-none place-items-center rounded-full text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground",
                dragging ? "cursor-grabbing" : "cursor-grab",
              )}
            >
              <GripVertical className="size-4" />
            </div>

            {/* status — reading the chip never moves it */}
            <div className="flex shrink-0 items-center gap-2">
              {pending ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Eye className={cn("size-4 shrink-0", sandbox ? "text-cyan-500" : "text-amber-500")} />
              )}
              <span className="hidden shrink-0 text-muted-foreground sm:inline">Test view</span>
            </div>

            {/* controls — pointer-down stays here so they never start a drag */}
            <div className="flex min-w-0 items-center gap-2" onPointerDown={stop}>
              <Select value={activeId} onValueChange={switchTo} disabled={pending}>
                <SelectTrigger className="h-7 w-auto max-w-44 gap-1.5 rounded-full bg-transparent px-2.5 text-sm font-semibold shadow-none sm:max-w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {targets.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label} · {t.role}
                      {t.functions ? ` · ${t.functions}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* mode toggle */}
              <div
                role="group"
                aria-label="Test view mode"
                className="flex shrink-0 items-center gap-0.5 rounded-full border p-0.5"
              >
                <button
                  type="button"
                  aria-pressed={sandbox}
                  disabled={pending}
                  onClick={() => changeMode("sandbox")}
                  title={
                    undoable
                      ? "Sandbox — everything you do is rolled back when you exit; no emails or notifications go out"
                      : "Sandbox — no emails or notifications go out"
                  }
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold transition-colors",
                    sandbox
                      ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  🧪<span className="hidden sm:inline"> Sandbox</span>
                </button>
                <button
                  type="button"
                  aria-pressed={!sandbox}
                  disabled={pending}
                  onClick={() => changeMode("real")}
                  title="Real mode — actions are permanent and visible to everyone"
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold transition-colors",
                    !sandbox
                      ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  ⚡<span className="hidden sm:inline"> Real</span>
                </button>
              </div>

              <Button
                size="sm"
                variant={confirmExit ? "destructive" : "outline"}
                className="h-7 shrink-0 rounded-full px-3"
                onClick={exit}
                disabled={pending}
                title={
                  sandbox
                    ? "Everything you did in this sandbox is undone when you leave"
                    : "Return to your own account"
                }
              >
                <X className="size-3.5" />
                {confirmExit ? "Discard & exit?" : "Exit"}
              </Button>

              <button
                type="button"
                aria-label="Collapse test view chip"
                title="Collapse into a tab"
                onClick={() => toggleCollapsed(true)}
                className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronDown
                  className="size-4"
                  style={{ transform: `rotate(${CHEVRON_ROTATION[edge]}deg)` }}
                />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
