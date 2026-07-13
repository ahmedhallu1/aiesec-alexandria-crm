"use client";

import { useRef, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const emptySubscribe = () => () => {};

/** Light/dark toggle (system preference is the default until first use).
 *  Uses the View Transitions API for a smooth circular reveal from the button;
 *  falls back to the CSS color transition on browsers without it. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const btnRef = useRef<HTMLButtonElement>(null);
  // true after hydration only — avoids a server/client icon mismatch
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const toggle = () => {
    const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!doc.startViewTransition || prefersReduced) {
      setTheme(nextTheme);
      return;
    }

    // reveal the new theme from the toggle button's center
    const rect = btnRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 40;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight - 40;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = doc.startViewTransition(() => setTheme(nextTheme));
    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 480,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    });
  };

  return (
    <Button
      ref={btnRef}
      variant="ghost"
      size="icon"
      className={cn("shrink-0", className)}
      title={mounted && resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="size-4.5 transition-transform duration-500 rotate-0" />
      ) : (
        <Moon className="size-4.5 transition-transform duration-500 rotate-0" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
