import { cn } from "@/lib/utils";

/** The AIESEC human, walking — Sodio's loading animation.
 *  (Looping alpha APNG converted from the official brand asset — APNG keeps
 *  correct frame disposal so frames never stack over each other.) */
export function WalkingLoader({
  label = "Loading…",
  className,
}: {
  /** Pass null to hide the caption. */
  label?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 py-10", className)}
      aria-busy
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/walk.png"
        alt=""
        aria-hidden
        className="h-24 w-auto select-none"
        draggable={false}
      />
      {label ? <p className="text-sm font-medium text-muted-foreground">{label}</p> : null}
    </div>
  );
}
