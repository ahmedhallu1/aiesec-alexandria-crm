"use client";

import { useEffect, useRef, useState } from "react";

/** Animates a number counting to its value — cheap (one rAF loop, ~450ms).
 *
 *  It animates on EVERY change, not only the first. The original latched with
 *  a `started` ref, so once a card had counted up it ignored every later
 *  value: switching dashboard lanes re-renders the same component instance
 *  with the new lane's number, and the old one stayed on screen. Market
 *  Research showed the whole LC's 3811 on the B2B and B2C lanes for exactly
 *  that reason — the other KPIs were zero, so nobody noticed them sticking
 *  too. */
export function CountUp({ value, text }: { value?: number; text?: string }) {
  const target = value ?? 0;
  const [shown, setShown] = useState(0);
  // where the last animation ENDED — the next one starts from there. Held in
  // a ref written only from the effect, never during render.
  const fromRef = useRef(0);

  useEffect(() => {
    if (text !== undefined) return;
    const start = fromRef.current;
    fromRef.current = target;
    if (start === target) return;
    const t0 = performance.now();
    const duration = 450;
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (target - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, text]);

  if (text !== undefined) return <>{text}</>;
  return <>{shown}</>;
}
