"use client";

import { SDGS, sdgsForProject } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

/** One animated SDG tile — the official goal color + number, with a slow
 *  shine sweep and a gentle hover lift. Motion is reduced-motion safe (CSS). */
function SdgTile({ n, size = "md" }: { n: number; size?: "sm" | "md" | "lg" }) {
  const sdg = SDGS[n];
  if (!sdg) return null;
  const dim = size === "lg" ? "size-12" : size === "sm" ? "size-7" : "size-9";
  const num = size === "lg" ? "text-lg" : size === "sm" ? "text-[11px]" : "text-sm";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("sdg-tile relative inline-flex shrink-0 overflow-hidden rounded-md", dim)}
            style={{ backgroundColor: sdg.color }}
            aria-label={`SDG ${n}: ${sdg.name}`}
          >
            <span className={cn("relative z-10 flex w-full flex-col items-center justify-center leading-none text-white", size === "sm" && "gap-0")}>
              <span className={cn("font-black tabular-nums", num)}>{n}</span>
              {size !== "sm" ? (
                <span className="mt-0.5 px-0.5 text-center text-[6px] font-semibold uppercase leading-[1.05] tracking-tight opacity-95 line-clamp-2">
                  {sdg.name}
                </span>
              ) : null}
            </span>
            <span className="sdg-shine pointer-events-none absolute inset-0 z-20" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="text-xs font-medium">SDG {n} · {sdg.name}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** All SDG tiles for an IGV project (renders nothing when unmapped). */
export function ProjectSdgs({
  project, size = "md", className,
}: {
  project: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const goals = sdgsForProject(project);
  if (goals.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {goals.map((n) => <SdgTile key={n} n={n} size={size} />)}
    </span>
  );
}
