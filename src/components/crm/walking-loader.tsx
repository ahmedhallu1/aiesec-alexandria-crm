/** The AIESEC human, walking — the system's loading animation.
 *  (Looping alpha APNG converted from the official brand asset — APNG keeps
 *  correct frame disposal so frames never stack over each other.) */
export function WalkingLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10" aria-busy>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/walk.png"
        alt=""
        aria-hidden
        className="h-24 w-auto select-none"
        draggable={false}
      />
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
