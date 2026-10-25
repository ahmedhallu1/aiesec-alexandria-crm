"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** One clock for the page — ticks every second, null until mounted so the
 *  server render never disagrees with the browser. */
export function useNow(everyMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [everyMs]);
  return now;
}

/** Adds .np-in when the element scrolls into view (once). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("np-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("np-in");
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`np-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Rolling-digit counter: each digit is a 0–9 strip that slides to place. */
export function Odometer({ value, className = "" }: { value: number; className?: string }) {
  const neg = value < 0;
  const digits = String(Math.abs(Math.round(value))).split("");
  return (
    <span className={`np-odo np-num ${className}`} aria-label={String(value)} role="img">
      {neg ? <span aria-hidden>−</span> : null}
      {digits.map((d, i) => (
        <span key={digits.length - i} className="np-odo-col" aria-hidden style={{ transform: `translateY(-${Number(d) * 10}%)` }}>
          {"0123456789".split("").map((n) => (
            <span key={n}>{n}</span>
          ))}
        </span>
      ))}
    </span>
  );
}

/** FLIP reorder: rows glide from where they were to where they are. */
export function useFlip(dep: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const kids = [...el.querySelectorAll<HTMLElement>("[data-flip]")];
    const next = new Map<string, number>();
    for (const k of kids) next.set(k.dataset.flip!, k.getBoundingClientRect().top);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const k of kids) {
        const before = last.current.get(k.dataset.flip!);
        const now = next.get(k.dataset.flip!)!;
        if (before === undefined || Math.abs(before - now) < 2) continue;
        k.animate(
          [{ transform: `translateY(${before - now}px)` }, { transform: "translateY(0)" }],
          { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" }
        );
      }
    }
    last.current = next;
  }, [dep]);
  return ref;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}
