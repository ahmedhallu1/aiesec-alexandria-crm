"use client";

import { Check, CircleAlert, Loader2, PencilLine } from "lucide-react";
import type { AutosaveStatus } from "@/lib/autosave";
import { cn } from "@/lib/utils";

/** The one line that tells a member their edit is safe (v36.6). An autosave
 *  that saves silently is indistinguishable from one that doesn't — which is
 *  the exact confusion this replaces — so every state says itself. */
export function SaveStatus({
  status,
  onRetry,
  className,
}: {
  status: AutosaveStatus;
  onRetry?: () => void;
  className?: string;
}) {
  if (status.kind === "idle") return null;
  return (
    <p
      aria-live="polite"
      className={cn("flex min-w-0 items-center gap-1.5 text-xs", className, {
        "text-muted-foreground": status.kind === "pending" || status.kind === "saving",
        "text-success": status.kind === "saved",
        "text-warning": status.kind === "blocked",
        "text-destructive": status.kind === "error",
      })}
    >
      {status.kind === "pending" ? (
        <>
          <PencilLine className="size-3.5 shrink-0" /> Saves automatically when you pause…
        </>
      ) : status.kind === "saving" ? (
        <>
          <Loader2 className="size-3.5 shrink-0 animate-spin" /> Saving…
        </>
      ) : status.kind === "saved" ? (
        <>
          <Check className="size-3.5 shrink-0" /> Saved
        </>
      ) : status.kind === "blocked" ? (
        <>
          <CircleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words">Not saved yet — {status.reason}</span>
        </>
      ) : (
        <>
          <CircleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words">Not saved — {status.error}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="ml-1 shrink-0 rounded px-1.5 py-0.5 font-semibold underline underline-offset-2 hover:bg-destructive/10"
            >
              Retry
            </button>
          ) : null}
        </>
      )}
    </p>
  );
}
