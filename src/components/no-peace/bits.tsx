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

/** Split-flap face: re-keys on every change so the flip replays. */
export function Flip({ value, label, size }: { value: string; label?: string; size: string }) {
  return (
    <span className="np-clock-unit">
      <span className="np-clock-face np-stencil np-num" style={{ fontSize: size }}>
        <span key={value}>{value}</span>
      </span>
      {label ? <span className="np-clock-label">{label}</span> : null}
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

export function Plane({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 120 50" className={className} style={style} aria-hidden fill="currentColor">
      <path d="M2 24c10-2 30-3 44-3l14-18h8l-7 18c14 0 30 1 40 2 6 1 10 2 13 3-3 1-7 2-13 3-10 1-26 2-40 2l7 18h-8L46 31c-14 0-34-1-44-3l-2-2z" />
      <path d="M8 24l-6-10h5l9 9zM8 28l-6 10h5l9-9z" />
      <circle cx="104" cy="26" r="2" fill="#000" opacity=".4" />
    </svg>
  );
}

export function Chute({ label }: { label?: string }) {
  return (
    <svg viewBox="0 0 80 110" width="100%" aria-hidden>
      <path d="M4 34C4 14 22 2 40 2s36 12 36 32c-6-5-12-5-18 0-6-5-12-5-18 0-6-5-12-5-18 0-6-5-12-5-18 0z" fill="#e9dcb8" stroke="#3a2e1c" strokeWidth="2" />
      <path d="M22 34c0-14 6-26 18-32M58 34c0-14-6-26-18-32" stroke="#3a2e1c" strokeWidth="1.4" fill="none" opacity=".6" />
      <path d="M4 34l30 50M22 34l14 50M58 34L44 84M76 34L46 84" stroke="#3a2e1c" strokeWidth="1" opacity=".7" />
      <rect x="28" y="82" width="24" height="20" rx="2" fill="#6a5532" stroke="#2e2414" strokeWidth="2" />
      <path d="M28 92h24M40 82v20" stroke="#2e2414" strokeWidth="1.4" />
      {label ? (
        <text x="40" y="96" textAnchor="middle" fontSize="7" fill="#f6d48a" fontWeight="700">{label}</text>
      ) : null}
    </svg>
  );
}

export function Tank() {
  return (
    <svg viewBox="0 0 64 34" width="56" aria-hidden>
      <rect x="18" y="6" width="22" height="10" rx="3" fill="#5d6638" stroke="#2c311a" strokeWidth="1.5" />
      <rect x="38" y="9" width="24" height="3.5" rx="1.5" fill="#2c311a" />
      <rect x="4" y="15" width="52" height="9" rx="3" fill="#6f7a44" stroke="#2c311a" strokeWidth="1.5" />
      <rect x="2" y="23" width="56" height="9" rx="4.5" fill="#2c311a" />
      {[8, 16, 24, 32, 40, 48].map((x) => (
        <circle key={x} cx={x + 2} cy="27.5" r="2.6" fill="#8b8b74" />
      ))}
      <rect x="26" y="1" width="1.6" height="7" fill="#2c311a" />
      <path d="M27.6 1h7l-2 2 2 2h-7z" fill="#b8432d" />
    </svg>
  );
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
