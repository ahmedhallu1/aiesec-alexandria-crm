"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * 🃏 PRANK MODE — THE ENGINE (v33.51).
 *
 * The EB switches one member's Sodio into a mischievous mood from the
 * membership editor. This component is the entire feature: mounted only for
 * that member, only while the mood lasts, and it lives wholly in their
 * browser.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * IT MUST NEVER COST THE LC A MINUTE OF REAL WORK. Every prank here is
 * cosmetic, self-reverting and under three seconds, and the guard rails below
 * are not decoration — they are the reason a joke is allowed to exist inside
 * the system 70 people run their peak on:
 *
 *   · NOTHING is ever blocked. The stubborn button eventually goes through
 *     (and grows, so it gets EASIER to hit); the wrong turn always hands over
 *     a working link to where they were going.
 *   · A HARD BLOCKLIST of everything that matters: no dialogs, no forms, no
 *     Save / Record / Send / Delete / Archive / Confirm / Sign in, no
 *     destructive buttons, nothing on /login, /welcome, /inactive, /feedback
 *     (reporting a problem must never BE a problem) or /admin.
 *   · A COOLDOWN — at most one prank every 90 seconds, whatever they click.
 *   · AN ESCAPE HATCH on every single prank: "😤 I'm actually working" pauses
 *     everything for 10 minutes. The victim decides when the joke stops.
 *   · A REVEAL the first time, so nobody spends an afternoon convinced Sodio
 *     is broken and files a bug that costs somebody else the afternoon too.
 *   · IT EXPIRES BY ITSELF. The server stops sending it; nothing to clean up.
 *
 * Nothing here writes to the database, sends anything, or touches a number.
 */

const COOLDOWN_MS = 90_000;
const SNOOZE_MS = 10 * 60_000;
const SNOOZE_KEY = "sodio-prank-snooze";
const REVEAL_KEY = "sodio-prank-revealed";
/** how many clicks a stubborn button demands (the LAST one always works) */
const STUBBORN_CLICKS = 3;

/** Pages where the mood is switched off entirely. Onboarding, sign-in, the
 *  page you report problems on, and the page you diagnose them from. */
const SAFE_PATHS = ["/login", "/welcome", "/inactive", "/feedback", "/admin", "/help"];

/** Button labels that are somebody's WORK. Never pranked, at any size. */
const SERIOUS = /save|delete|remove|archive|send|confirm|sign|submit|record|deal|pay|upload|import|export|cancel|undo|revive|assign|book|report|approve|reject|yes|no,|continue|finish/i;

const STUBBORN_LINES = [
  "Nope. 😌",
  "Try harder. 💪",
  "Almost… 🥁",
  "Was that a click or a suggestion? 🤨",
  "One more. I promise. 🤞",
  "The button is thinking about it. 🧠",
];

const AMBIENT_LINES = [
  "The Violet Man just looked at your numbers. He said nothing. 🚶",
  "Sodio is quietly proud of you. Don't let it go to your head. 💜",
  "Fun fact: this toast has no purpose whatsoever. 🍞",
  "Somebody in the EB is watching this exact screen. Probably. 👀",
  "Achievement unlocked: 🏆 Clicked A Thing",
  "Loading… just kidding, everything already loaded. ⚡",
  "Your streak called. It wants attention. 🔥",
  "This message will self-destruct. (It won't.) 💣",
];

const DETOUR_LINES = [
  "Oops — did you mean",
  "Whoops, wrong door. Were you going to",
  "Sorry! My hand slipped. You wanted",
  "Ah. That's not it. You meant",
];

export function Prankster({ prankedBy }: { prankedBy?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const lastRef = useRef(0);
  const [reveal, setReveal] = useState(false);
  // a click we deliberately let through (the stubborn button's final click,
  // and the "take me there" link after a wrong turn) — never re-pranked
  const passRef = useRef<Set<Element>>(new Set());

  const snoozed = () => Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  const snooze = useCallback(() => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    toast.success("Fine. 😤 Ten minutes of peace — go be productive.");
  }, []);

  /** Can a prank fire AT ALL right now? The single gate every prank passes. */
  const canPrank = useCallback(() => {
    if (SAFE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
    if (snoozed()) return false;
    if (Date.now() - lastRef.current < COOLDOWN_MS) return false;
    // never while a dialog, a dropdown or a tooltip is open — those are people
    // in the middle of something
    if (document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]'))
      return false;
    // never while they're typing
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
    return true;
  }, [pathname]);

  const spent = () => { lastRef.current = Date.now(); };

  /** Every prank's toast carries the way out. */
  const prankToast = useCallback(
    (msg: string, opts: { duration?: number } = {}) =>
      toast(msg, {
        duration: opts.duration ?? 5000,
        action: { label: "😤 I'm working", onClick: snooze },
      }),
    [snooze]
  );

  // THE REVEAL WAITS ITS TURN. A modal makes the rest of the page inert while
  // it is open, so opening it the instant the first prank fires would swallow
  // the very clicks the joke is asking for. Seven seconds: the stubborn button
  // is done, the wrong-turn toast has been read, and THEN it explains itself.
  const showReveal = useCallback(() => {
    if (localStorage.getItem(REVEAL_KEY)) return;
    localStorage.setItem(REVEAL_KEY, "1");
    setTimeout(() => setReveal(true), 7000);
  }, []);

  // ── PRANK 1: THE STUBBORN BUTTON ──────────────────────────────────────────
  // It takes three clicks and grows each time, so the joke gets easier to
  // finish than it was to start. Only ever on buttons that do nothing
  // irreversible; the third click is the real one, and it fires for real.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const btn = target?.closest?.("button");
      if (!btn || passRef.current.has(btn)) return;
      if (!canPrank()) return;
      // the blocklist: work, forms, dialogs, destructive things, icon-only
      // controls (the bell, the theme toggle — too small to be funny)
      const label = (btn.textContent ?? "").trim();
      if (
        label.length < 3 ||
        SERIOUS.test(label) ||
        btn.getAttribute("type") === "submit" ||
        btn.closest("form, [role='dialog'], [data-no-prank]") ||
        btn.className.includes("bg-destructive") ||
        btn.hasAttribute("aria-haspopup")
      )
        return;
      if (Math.random() > 0.45) return; // not every time — that's just a wall

      e.preventDefault();
      e.stopPropagation();
      spent();
      showReveal();

      // THE BUTTON'S CONTENTS ARE REACT'S, NOT OURS. Rewriting a button's
      // label mid-render is how you earn a "failed to execute removeChild" in
      // somebody's console, so the joke touches exactly one thing React does
      // not manage — the inline transform — and says its line in a toast.
      const el = btn as HTMLElement;
      const restore = el.style.transition;
      let clicks = 1;
      passRef.current.add(el); // the document listener leaves it alone now
      el.style.transition = "transform .18s cubic-bezier(.34,1.56,.64,1)";
      el.style.transform = "scale(1.16)";
      const line = () => STUBBORN_LINES[Math.floor(Math.random() * STUBBORN_LINES.length)];
      prankToast(line(), { duration: 2500 });

      const heal = () => {
        el.removeEventListener("click", again, true);
        el.style.transform = "";
        el.style.transition = restore;
        passRef.current.delete(el);
      };
      const again = (ev: MouseEvent) => {
        clicks += 1;
        if (clicks < STUBBORN_CLICKS) {
          ev.preventDefault();
          ev.stopPropagation();
          el.style.transform = `scale(${1.16 + clicks * 0.2})`;
          prankToast(line(), { duration: 2500 });
          return;
        }
        // the last click is REAL — it goes through to whatever it always did
        heal();
        prankToast("Fine, FINE. 🙄 There you go.", { duration: 2500 });
      };
      el.addEventListener("click", again, true);
      // never leave a button mid-joke: walking away heals it
      setTimeout(() => { if (document.contains(el)) heal(); }, 20_000);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [canPrank, prankToast, showReveal]);

  // ── PRANK 2: THE SCENIC ROUTE ─────────────────────────────────────────────
  // A sidebar tab occasionally opens the WRONG page — and immediately hands
  // over a real, working link to the one they asked for. The apology link is
  // never pranked twice, so one extra tap is the entire cost.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a") as HTMLAnchorElement | null;
      if (!a || passRef.current.has(a)) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href === pathname) return;
      if (!a.closest("aside, [data-slot='sheet-content']")) return; // sidebar only
      if (!canPrank()) return;
      if (Math.random() > 0.5) return;

      // somewhere else they're allowed to be: another tab from the same nav
      const others = [...(a.closest("nav")?.querySelectorAll("a[href^='/']") ?? [])]
        .map((x) => (x as HTMLAnchorElement).getAttribute("href") ?? "")
        .filter((h) => h && h !== href && h !== pathname);
      if (others.length === 0) return;
      const wrong = others[Math.floor(Math.random() * others.length)];

      e.preventDefault();
      e.stopPropagation();
      spent();
      showReveal();
      passRef.current.add(a);
      router.push(wrong);
      const line = DETOUR_LINES[Math.floor(Math.random() * DETOUR_LINES.length)];
      toast(`${line} ${a.textContent?.trim() || "that other tab"}? 😇`, {
        description: "So sorry. Tap below to actually go there — it's not another trap. Promise. 🤞",
        duration: 12_000,
        action: {
          label: "Take me there →",
          onClick: () => router.push(href),
        },
      });
      setTimeout(() => passRef.current.delete(a), 30_000);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [canPrank, pathname, router, showReveal]);

  // ── PRANK 3: AMBIENT MISCHIEF ─────────────────────────────────────────────
  // Once in a while, on a page they're already looking at: the Violet Man
  // strolls past, the page shivers for a second, or a completely pointless
  // toast appears. Nothing to click, nothing to undo.
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!canPrank()) return;
      if (Math.random() > 0.35) return;
      spent();
      showReveal();
      const pick = Math.floor(Math.random() * 3);
      if (pick === 0) {
        stroll();
      } else if (pick === 1) {
        document.body.classList.add("prank-shiver");
        setTimeout(() => document.body.classList.remove("prank-shiver"), 1300);
        prankToast("Whoa. Did you feel that? 🫨", { duration: 3500 });
      } else {
        prankToast(AMBIENT_LINES[Math.floor(Math.random() * AMBIENT_LINES.length)]);
      }
    }, 45_000);
    return () => clearInterval(tick);
  }, [canPrank, prankToast, showReveal]);

  return (
    <Dialog open={reveal} onOpenChange={setReveal}>
      <DialogContent className="sm:max-w-md" data-no-prank>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            🃏 You&apos;ve been pranked
          </DialogTitle>
          <DialogDescription className="sr-only">
            Prank mode is switched on for your account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            Nothing is broken. {prankedBy ? <b>{prankedBy}</b> : <b>Someone in the EB</b>}{" "}
            switched <b>prank mode</b> on for you, and Sodio is now in a mood. 🚶💜
          </p>
          <p className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <b>What it will do:</b> a button that needs convincing, a tab that
            sends you the scenic way, the Violet Man walking across your screen.
            <br />
            <b>What it will never do:</b> touch your accounts, your numbers,
            your emails or anything you actually have to get done. Every button
            still works — some just want to be asked twice.
          </p>
          <p className="text-muted-foreground">
            It turns itself off on its own. And whenever you genuinely need to
            work, hit <b>&quot;😤 I&apos;m working&quot;</b> on any of its
            messages — ten minutes of total silence, as often as you like.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => { snooze(); setReveal(false); }}>
            😤 Not now — pause 10 min
          </Button>
          <Button onClick={() => setReveal(false)}>😂 Bring it on</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The Violet Man takes a walk across the bottom of the screen and leaves. Pure
 *  decoration: fixed, pointer-events-none, removes itself. */
function stroll() {
  const img = document.createElement("img");
  img.src = "/brand/walk.png";
  img.alt = "";
  img.className = "prank-stroll walkman-tint";
  document.body.appendChild(img);
  setTimeout(() => img.remove(), 9000);
}
