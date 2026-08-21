"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** A small branded nudge that opens The Violet Man (optionally pre-filling a
 *  question) — dropped wherever insights are one question away (v26). */
export function AskVioletMan({
  hint, prefill, className,
}: {
  /** the visible suggestion, e.g. "Ask for accounts matching any criteria" */
  hint: string;
  /** what lands in the chat input when tapped (editable before sending) */
  prefill?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("sodio:ask-violet-man", { detail: { prefill } })
        )
      }
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-all hover:border-primary/60 hover:bg-primary/10 active:scale-95",
        className
      )}
    >
      <Sparkles className="size-3.5 transition-transform group-hover:rotate-12" />
      {hint}
    </button>
  );
}
