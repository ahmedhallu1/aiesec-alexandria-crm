"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Loader2, X } from "lucide-react";
import { stopViewAs } from "@/server/actions";
import { Button } from "@/components/ui/button";

/** Always-visible pill while the admin is test-viewing as another member —
 *  one click gets them back to themselves from anywhere in the app. */
export function ViewAsBanner({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const exit = () =>
    start(async () => {
      const res = await stopViewAs();
      if (res.ok) {
        toast.success("Back to yourself 👋");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <div className="fixed inset-x-0 bottom-3 z-50 flex justify-center px-3">
      <div className="flex max-w-full items-center gap-2 rounded-full border border-warning/50 bg-warning/15 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur">
        <Eye className="size-4 shrink-0 text-warning" />
        <span className="truncate">
          Test view: <b>{name}</b>
          <span className="text-muted-foreground"> · {role} — the whole app behaves as them</span>
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 rounded-full px-3"
          onClick={exit}
          disabled={pending}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
          Exit
        </Button>
      </div>
    </div>
  );
}
