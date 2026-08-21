import { checkVisitTime } from "@/lib/visit-time";
import { cn } from "@/lib/utils";

/** Says, next to the input, what the server is about to say anyway — the
 *  refused hours as a refusal, the odd ones as a question. Renders nothing for
 *  a normal working hour, so it only ever appears when it has something to
 *  add. The server owns the actual decision (see lib/visit-time). */
export function VisitTimeNote({ time, className }: { time: string; className?: string }) {
  const v = checkVisitTime(time);
  if (v.ok && !v.warning) return null;
  return (
    <p
      role={v.ok ? "status" : "alert"}
      className={cn(
        "mt-1.5 text-xs font-medium",
        v.ok ? "text-warning" : "text-destructive",
        className
      )}
    >
      {v.ok ? `⚠️ ${v.warning}` : `⛔ ${v.error}`}
    </p>
  );
}
