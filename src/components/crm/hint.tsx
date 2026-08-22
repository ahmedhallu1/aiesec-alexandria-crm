"use client";

import { useEffect, useRef, useState } from "react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

/** A HINT HAS TO WORK ON A PHONE TOO (v33.28).
 *
 *  This was a plain Radix tooltip: hover or keyboard focus, nothing else. On a
 *  touch device there is no hover, so every hint in Sodio — and there are
 *  dozens, they are how the system explains itself — was simply invisible.
 *  Tapping the thing it wraps did nothing, which reads as a broken link.
 *
 *  So the tooltip is controlled: pointer devices keep hover exactly as before,
 *  and a COARSE pointer opens it on tap and closes it on the next tap, on
 *  scroll, or after a few seconds. The wrapped control keeps its own click —
 *  a tap on a button both fires the button and shows its hint, which is what
 *  someone poking at an unfamiliar icon actually wants.
 */
export function Hint({
  label,
  side = "top",
  children,
}: {
  /** ReactNode, not string: a few hints list several lines (the accounts
   *  list's action dot names every thing the row is waiting for). */
  label: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // a hint must never outlive the thing it is explaining
    timer.current = window.setTimeout(close, 4000);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      window.removeEventListener("scroll", close, { capture: true });
    };
  }, [open]);

  const coarse = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none), (pointer: coarse)").matches;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          asChild
          // Radix's own handlers cover hover/focus; this adds the touch case
          // without swallowing the wrapped control's click.
          onPointerDown={(e) => {
            if (e.pointerType === "touch" || coarse()) setOpen((o) => !o);
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-56 text-center">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
