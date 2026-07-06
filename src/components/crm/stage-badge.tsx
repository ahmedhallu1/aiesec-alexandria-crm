import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Stage } from "@/lib/types";

const styles: Record<Stage, string> = {
  "Lead": "bg-muted text-muted-foreground border-transparent",
  "Contacted": "bg-accent text-accent-foreground border-transparent",
  "Visit Scheduled": "bg-chart-4/15 text-chart-4 border-transparent",
  "Visit Done": "bg-primary/15 text-primary border-transparent",
  "Deal Done": "bg-success/15 text-success border-transparent",
  "Out of Process": "bg-destructive/10 text-destructive border-transparent",
};

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  return <Badge className={cn(styles[stage], "font-medium", className)}>{stage}</Badge>;
}
