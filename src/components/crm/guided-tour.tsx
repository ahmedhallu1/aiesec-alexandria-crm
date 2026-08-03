"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE GUIDED WALKTHROUGH (v32.3) — the tour walks the real system.
 *
 * It replaces a deck of slides nobody read. A step points at an ACTUAL element
 * on an ACTUAL page: it navigates there, opens the dialog if the element lives
 * inside one, spotlights it, and says one short line about what it is.
 *
 * RELIABILITY IS THE WHOLE POINT — a walkthrough that highlights empty space is
 * worse than none, so every step is defensive:
 *   · a target that never appears is SKIPPED, never left pointing at nothing;
 *   · the spotlight re-measures on scroll, resize and DOM changes, so it can't
 *     drift off its element;
 *   · steps whose page the viewer can't reach are dropped up front;
 *   · Escape and the ✕ always end it, and the position is clamped on screen.
 *
 * Targets are marked in the markup with `data-tour="<id>"`. Keep those ids
 * stable — they are the contract between a view and this file.
 */

export interface TourStep {
  /** `data-tour` id of the element to point at */
  target: string;
  title: string;
  body: string;
  /** navigate here first (the step waits for the target afterwards) */
  route?: string;
  /** CSS selector clicked BEFORE the step — opens the dialog the target is in */
  openBy?: string;
  /** CSS selector clicked when leaving — closes what `openBy` opened */
  closeBy?: string;
  /** where to put the bubble relative to the target */
  place?: "auto" | "bottom" | "top";
}

const PAD = 8;
const BUBBLE_W = 320;

/** Waits for an element to exist AND have a real box. Resolves null on timeout
 *  so a missing target skips its step instead of hanging the tour. */
function waitFor(id: string, ms = 4000): Promise<HTMLElement | null> {
  return waitForSelector(`[data-tour="${id}"]`, ms);
}

/** Same, for any CSS selector (openBy/closeBy drive controls we don't own). */
function waitForSelector(selector: string, ms = 4000): Promise<HTMLElement | null> {
  const find = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? el : null;
  };
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const started = Date.now();
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) { cleanup(); resolve(el); }
    });
    const timer = window.setInterval(() => {
      const el = find();
      if (el) { cleanup(); resolve(el); }
      else if (Date.now() - started > ms) { cleanup(); resolve(null); }
    }, 120);
    const cleanup = () => { obs.disconnect(); window.clearInterval(timer); };
    obs.observe(document.body, { childList: true, subtree: true });
  });
}

interface Box { top: number; left: number; width: number; height: number }

export function GuidedTour({
  steps,
  open,
  onClose,
}: {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [busy, setBusy] = useState(false);
  const elRef = useRef<HTMLElement | null>(null);
  const stepRef = useRef(0);
  const mounted = useRef(false);
  // `go` advances to the next step when a target is missing; going through a
  // ref keeps that from being a self-reference the linter (rightly) rejects
  const goRef = useRef<((index: number) => Promise<void>) | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const measure = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // an element scrolled out of the viewport has a box, but pointing at it
    // would be nonsense — re-scroll rather than draw off-screen
    setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  /** Runs one step: navigate → open → wait → scroll → measure. */
  const go = useCallback(
    async (index: number) => {
      const step = steps[index];
      if (!step) { onClose(); return; }
      stepRef.current = index;
      setBusy(true);
      setBox(null);
      elRef.current = null;

      if (step.route && pathname !== step.route) {
        router.push(step.route);
        // give the route a moment to commit before hunting for the target
        await new Promise((r) => setTimeout(r, 350));
      }
      if (step.openBy) {
        const opener = await waitForSelector(step.openBy, 3000);
        opener?.click();
        // let the dialog mount before hunting for a field inside it
        await new Promise((r) => setTimeout(r, 250));
      }
      const el = await waitFor(step.target);
      if (!mounted.current || stepRef.current !== index) return;
      if (!el) {
        // never point at nothing — move on
        setBusy(false);
        if (index + 1 < steps.length) void goRef.current?.(index + 1);
        else onClose();
        return;
      }
      elRef.current = el;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      await new Promise((r) => setTimeout(r, 320));
      if (!mounted.current || stepRef.current !== index) return;
      measure();
      setBusy(false);
    },
    [steps, pathname, router, measure, onClose]
  );
  // keep the ref pointing at the latest `go` (assigning during render is what
  // the rules-of-hooks lint objects to, so do it in an effect)
  useEffect(() => { goRef.current = go; }, [go]);

  const closeCurrent = useCallback(async () => {
    const step = steps[stepRef.current];
    if (step?.closeBy) {
      document.querySelector<HTMLElement>(step.closeBy)?.click();
      await new Promise((r) => setTimeout(r, 250));
    }
  }, [steps]);

  const next = useCallback(async () => {
    await closeCurrent();
    const n = stepRef.current + 1;
    if (n >= steps.length) { onClose(); return; }
    setI(n);
    void go(n);
  }, [closeCurrent, steps.length, onClose, go]);

  const back = useCallback(async () => {
    if (stepRef.current === 0) return;
    await closeCurrent();
    const n = stepRef.current - 1;
    setI(n);
    void go(n);
  }, [closeCurrent, go]);

  const finish = useCallback(async () => {
    await closeCurrent();
    onClose();
  }, [closeCurrent, onClose]);

  // start / restart — deferred so no state is set inside the effect body
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { setI(0); void goRef.current?.(0); }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // keep the spotlight glued to its element
  useEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    const obs = new ResizeObserver(onMove);
    if (elRef.current) obs.observe(elRef.current);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      obs.disconnect();
    };
  }, [open, box?.top, measure]);

  // Escape always gets you out
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void finish();
      if (e.key === "ArrowRight") void next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish, next]);

  if (!open || typeof document === "undefined") return null;
  const step = steps[i];
  if (!step) return null;

  // bubble placement: under the target, flipped above when it would fall off
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  let bubbleTop = 0;
  let bubbleLeft = 0;
  if (box) {
    const below = box.top + box.height + 12;
    const wantAbove = step.place === "top" || below + 190 > vh;
    bubbleTop = wantAbove ? Math.max(12, box.top - 190) : below;
    bubbleLeft = Math.min(
      Math.max(12, box.left + box.width / 2 - BUBBLE_W / 2),
      vw - BUBBLE_W - 12
    );
  } else {
    bubbleTop = vh / 2 - 90;
    bubbleLeft = vw / 2 - BUBBLE_W / 2;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Guided walkthrough">
      {/* the spotlight: one box over the element, with the rest of the screen
          dimmed by an enormous ring shadow (no SVG mask needed) */}
      {box ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(2,6,23,0.72)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(2,6,23,0.72)]" />
      )}

      {/* click-through guard: the page stays visible but not clickable, so a
          stray click can't take someone somewhere the tour didn't expect */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div
        className={cn(
          "absolute w-[320px] rounded-xl border bg-popover p-4 text-popover-foreground shadow-2xl transition-all duration-200",
          busy && "opacity-70"
        )}
        style={{ top: bubbleTop, left: bubbleLeft }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold">{step.title}</p>
          <button
            type="button"
            onClick={finish}
            aria-label="End the walkthrough"
            className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground" dir="auto">
          {step.body}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {i + 1} / {steps.length}
          </span>
          <div className="flex gap-2">
            {i > 0 ? (
              <Button size="sm" variant="outline" onClick={back} disabled={busy}>
                Back
              </Button>
            ) : null}
            <Button size="sm" onClick={next} disabled={busy}>
              {i === steps.length - 1 ? "Done 🚀" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
