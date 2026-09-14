"use client";

import { useEffect, useSyncExternalStore, type PointerEvent, type RefObject } from "react";

/** Motion helpers for the Activate 26' page (v36.7). Everything here is
 *  decoration: if any of it fails, the content is still there and readable. */

/** Reveal-on-scroll. Marks the root `js-ready` (the CSS only hides
 *  [data-reveal] under that class) and reveals each element once it enters the
 *  viewport — including elements that mount LATER (switching edit mode, a new
 *  row), which a one-time query would leave invisible forever. */
export function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return; // nothing hidden
    el.classList.add("js-ready");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    const watch = (node: Element) => {
      if (node.matches?.("[data-reveal]:not(.is-in)")) io.observe(node);
      node.querySelectorAll?.("[data-reveal]:not(.is-in)").forEach((n) => io.observe(n));
    };
    watch(el);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach((n) => n instanceof Element && watch(n));
    });
    mo.observe(el, { childList: true, subtree: true });
    // BELT AND BRACES: some embedded browsers throttle IntersectionObserver
    // (a backgrounded WebView, a jump-scroll from an anchor). Anything already
    // on screen after a scroll is revealed by position, so content can never
    // be left invisible waiting for a callback that doesn't come.
    let t: number | null = null;
    const sweep = () => {
      t = null;
      const h = window.innerHeight;
      el.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)").forEach((n) => {
        const r = n.getBoundingClientRect();
        if (r.top < h && r.bottom > 0) {
          n.classList.add("is-in");
          io.unobserve(n);
        }
      });
    };
    const onScroll = () => {
      if (t === null) t = window.setTimeout(sweep, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    const first = window.setTimeout(sweep, 400);
    return () => {
      io.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.clearTimeout(first);
      if (t !== null) window.clearTimeout(t);
    };
  }, [root]);
}

/** A card that leans towards the pointer. Fine pointers only. */
export function tilt(max = 7) {
  return {
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") return;
      const r = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      e.currentTarget.style.setProperty("--ry", `${(x * max).toFixed(2)}deg`);
      e.currentTarget.style.setProperty("--rx", `${(-y * max).toFixed(2)}deg`);
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.style.setProperty("--ry", "0deg");
      e.currentTarget.style.setProperty("--rx", "0deg");
    },
  };
}

/** The spotlight in the hero follows the pointer. */
export function followSpot(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}

/** Seconds since epoch, ticking; 0 on the server so SSR never disagrees. */
export function useNowSeconds(): number {
  return useSyncExternalStore(
    (cb) => {
      const t = window.setInterval(cb, 1000);
      return () => window.clearInterval(t);
    },
    () => Math.floor(Date.now() / 1000),
    () => 0
  );
}

/** Narrow screens get the agenda instead of the Gantt. */
export function useNarrow(query = "(max-width: 767px)"): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** The big-top valance: crimson and cream stripes with a scalloped hem. */
export function Valance({ scallops = 18 }: { scallops?: number }) {
  const w = 1200;
  const h = 58;
  const step = w / scallops;
  let d = `M0,0 H${w} V${h - 18}`;
  for (let i = scallops; i > 0; i--) {
    const x0 = i * step;
    const x1 = (i - 1) * step;
    d += ` Q${x0 - step / 2},${h + 6} ${x1},${h - 18}`;
  }
  d += " Z";
  return (
    <svg className="circus-valance" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <pattern id="cz-stripes" width={step} height={h} patternUnits="userSpaceOnUse">
          <rect width={step / 2} height={h} fill="#c8102e" />
          <rect x={step / 2} width={step / 2} height={h} fill="#fbeed3" />
        </pattern>
        <linearGradient id="cz-shade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.25" />
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <g>
        <path d={d} fill="url(#cz-stripes)" />
        <path d={d} fill="url(#cz-shade)" />
        <path d={`M0,3 H${w}`} stroke="#f7c65b" strokeWidth="4" />
      </g>
    </svg>
  );
}
