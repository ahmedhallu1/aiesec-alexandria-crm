import { cn } from "@/lib/utils";
import { WalkingMan } from "./walking-man";

/** The AIESEC human, walking — Sodio's loading animation.
 *  (Looping alpha APNG converted from the official brand asset — APNG keeps
 *  correct frame disposal so frames never stack over each other.)
 *  96px is the identity's loading-state size, measured on the FIGURE: see
 *  WalkingMan for why the raw image size is not the same number. */
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
      <WalkingMan height={96} />
      {label ? <p className="text-sm font-medium text-muted-foreground">{label}</p> : null}
    </div>
  );
}
