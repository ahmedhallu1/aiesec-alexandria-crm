"use client";

import { useEffect, useRef, useState } from "react";

/** Animates numbers counting up on mount — cheap (one rAF loop, ~450ms). */
export function CountUp({ value, text }: { value?: number; text?: string }) {
  const target = value ?? 0;
  const [shown, setShown] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (text !== undefined || started.current) return;
    started.current = true;
    if (target === 0) return;
    const t0 = performance.now();
    const duration = 450;
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, text]);

  if (text !== undefined) return <>{text}</>;
  return <>{shown}</>;
}
