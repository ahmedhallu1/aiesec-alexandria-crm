"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const emptySubscribe = () => () => {};

/** Light/dark toggle (system preference is the default until first use). */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  // true after hydration only — avoids a server/client icon mismatch
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("shrink-0", className)}
      title={mounted && resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="size-4.5" />
      ) : (
        <Moon className="size-4.5" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
