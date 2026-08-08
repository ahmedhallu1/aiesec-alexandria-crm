"use client";

import { useEffect } from "react";

/** THE PAGE THAT STOPS ACCEPTING TAPS (v33.24).
 *
 *  Reported from the floor: on one member's iPhone "most buttons become
 *  unclickable in a weird way", while the same account on another phone was
 *  fine. That shape — device-specific, intermittent, everything dead at once
 *  rather than one broken button — is the signature of a stuck modal lock,
 *  not of a permission or an account.
 *
 *  Radix sets `pointer-events: none` on <body> while a dialog, dropdown or
 *  select is open, and removes it when the last one closes. If the close
 *  animation is interrupted — a slow device, a backgrounded tab, one dialog
 *  opening as another closes, an iOS Safari memory reclaim mid-transition —
 *  the cleanup never runs and the style stays. Every tap then lands on
 *  nothing, and the only cure the member knows is force-quitting the app.
 *
 *  This watches for exactly that state — body locked while nothing is
 *  actually open — and releases it. It is deliberately conservative: it never
 *  touches the lock while a real overlay is mounted, so open dialogs still
 *  behave normally.
 */
export function PointerEventsGuard() {
  useEffect(() => {
    const anyOverlayOpen = () =>
      document.querySelector(
        "[data-state='open'][data-slot='dialog-content']," +
          "[data-state='open'][data-slot='sheet-content']," +
          "[data-radix-popper-content-wrapper]," +
          "[role='dialog'][data-state='open']," +
          "[data-sonner-toast][data-expanded='true']"
      ) != null;

    const release = () => {
      const locked = document.body.style.pointerEvents === "none";
      if (locked && !anyOverlayOpen()) document.body.style.pointerEvents = "";
    };

    // whenever the attribute changes — this is the moment the leak happens
    const mo = new MutationObserver(release);
    mo.observe(document.body, { attributes: true, attributeFilter: ["style"] });

    // and the belt-and-braces passes: returning to the tab, and a slow poll
    // for the case where the mutation fired before the overlay unmounted
    const onVisible = () => { if (!document.hidden) release(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    const timer = window.setInterval(release, 1500);

    return () => {
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
