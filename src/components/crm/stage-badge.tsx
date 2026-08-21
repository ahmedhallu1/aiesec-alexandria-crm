import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Stage } from "@/lib/types";

/** THE PIPELINE READS AS A JOURNEY, and purple appears exactly once.
 *  The identity's rule is that purple "only marks actions and wins", so it
 *  belongs on DEAL DONE and nowhere else on this scale — it used to sit on
 *  Contacted and Visit Done, which made the action colour label a status.
 *  Colours are --stage-* tokens rather than the chart hues because a badge is
 *  TEXT on a 15% tint of itself, and the chart blue fails contrast there. */
const styles: Record<Stage, string> = {
  "Lead": "bg-muted text-muted-foreground border-transparent",
  "Contacted": "bg-stage-contacted/15 text-stage-contacted border-transparent",
  "Visit Scheduled": "bg-stage-scheduled/15 text-stage-scheduled border-transparent",
  "Visit Done": "bg-stage-done/15 text-stage-done border-transparent",
  "Deal Done": "bg-stage-deal/15 text-stage-deal border-transparent",
  "Out of Process": "bg-stage-oop/15 text-stage-oop border-transparent",
};

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  return <Badge className={cn(styles[stage], "font-medium", className)}>{stage}</Badge>;
}
