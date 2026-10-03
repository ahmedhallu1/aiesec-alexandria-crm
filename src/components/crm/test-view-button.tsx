"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Loader2, Search } from "lucide-react";
import { startViewAs } from "@/server/actions";
import type { ViewAsTarget } from "@/server/data";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Hint } from "./hint";
import { cn } from "@/lib/utils";

/** THE TEST VIEW, ONE TAP AWAY (v33.42).
 *
 *  It lived only on the profile, so checking "what does a Member actually see
 *  on this page?" meant leaving the page you were looking at. The button sits
 *  next to 🛠️ Report for whoever holds the admin tools: pick a person, land in
 *  their view, and the floating banner brings you back.
 *
 *  Sandbox mode by default — the same call the profile card makes — so
 *  everything written while testing is rolled back on exit. */
export function TestViewButton({
  targets,
  className,
}: {
  targets: ViewAsTarget[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  // (v37.8) which row was tapped — the spinner belongs to that row alone
  const [startingId, setStartingId] = useState<string | null>(null);
  const router = useRouter();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return targets.slice(0, 40);
    return targets
      .filter(
        (t) =>
          t.label.toLowerCase().includes(needle) ||
          t.role.toLowerCase().includes(needle) ||
          t.functions.toLowerCase().includes(needle)
      )
      .slice(0, 40);
  }, [targets, q]);

  const begin = (id: string, name: string) =>
    start(async () => {
      setStartingId(id);
      const res = await startViewAs(id);
      setStartingId(null);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`👁 Now viewing as ${res.data?.name ?? name} — Exit on the banner to come back.`);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Hint label="Test view — see Sodio as someone else">
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-8", className)}
          aria-label="Open the test view"
          onClick={() => setOpen(true)}
        >
          <Eye className="size-4" />
        </Button>
      </Hint>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="size-4 text-warning" /> Test view
            </DialogTitle>
            <DialogDescription>
              See the whole app exactly as they do. It opens in <b>sandbox</b>:
              anything you change is rolled back when you exit.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-8"
              placeholder="Search a name, role or function…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            {shown.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nobody matches that.
              </p>
            ) : (
              shown.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={pending}
                  onClick={() => begin(t.id, t.label)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" dir="auto">
                      {t.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t.role}
                      {t.functions ? ` · ${t.functions}` : ""}
                    </span>
                  </span>
                  {pending && startingId === t.id ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
