"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Loader2, X } from "lucide-react";
import { startViewAs, stopViewAs } from "@/server/actions";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface ViewAsTargetLite {
  id: string;
  label: string;
  role: string;
  functions: string;
}

/** Always-visible pill while the admin is test-viewing as another member —
 *  the name is a live SWITCHER (pick anyone to jump straight to their view)
 *  and Exit gets the admin back to themselves from anywhere. */
export function ViewAsBanner({
  activeId,
  targets,
}: {
  activeId: string;
  targets: ViewAsTargetLite[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const switchTo = (id: string) => {
    if (id === activeId) return;
    start(async () => {
      const res = await startViewAs(id);
      if (res.ok) {
        toast.success(`👁 Now viewing as ${res.data?.name}.`);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const exit = () =>
    start(async () => {
      const res = await stopViewAs();
      if (res.ok) {
        toast.success("Back to yourself 👋");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    // pointer-events-none on the full-width strip: only the pill itself may
    // swallow clicks — everything beneath (e.g. the sidebar credit) stays live
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-warning/50 bg-warning/15 px-3 py-1.5 text-sm font-medium shadow-lg backdrop-blur">
        {pending ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-warning" />
        ) : (
          <Eye className="size-4 shrink-0 text-warning" />
        )}
        <span className="hidden shrink-0 text-muted-foreground sm:inline">Test view:</span>
        <Select value={activeId} onValueChange={switchTo} disabled={pending}>
          <SelectTrigger className="h-7 w-auto max-w-56 gap-1.5 rounded-full border-warning/40 bg-transparent px-2.5 text-sm font-semibold shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {targets.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label} · {t.role}
                {t.functions ? ` · ${t.functions}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 rounded-full px-3"
          onClick={exit}
          disabled={pending}
        >
          <X className="size-3.5" />
          Exit
        </Button>
      </div>
    </div>
  );
}
