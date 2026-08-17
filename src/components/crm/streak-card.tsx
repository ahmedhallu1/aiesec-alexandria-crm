"use client";

import Link from "next/link";
import type { StreakStats } from "@/server/data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** 🔥 THE STREAK CARD — ONE of them (v33.55).
 *
 *  It lived in signups-view with a thinner copy on the dashboard: no "Your
 *  best" wording, no side chips, and the LC board rendered as one wrapped line
 *  of names at the same size, which tells nobody who is first. Both places
 *  render this now, so it can only drift on purpose.
 *
 *  `onScope` is optional — where there is nothing to switch to, the side chips
 *  simply don't render. */
export function StreakCard({
  streak,
  onScope,
  /** the dashboard shows a way back to the work; /signups already IS it */
  showAction = false,
}: {
  streak: StreakStats;
  onScope?: (s: string) => void;
  showAction?: boolean;
}) {
  const medals = ["🥇", "🥈", "🥉"];
  const dayWord = (n: number) => `day${n === 1 ? "" : "s"}`;
  return (
    <Card className="rise-in border-orange-400/40">
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "text-4xl leading-none transition-all",
              !streak.savedToday && "opacity-40 grayscale"
            )}
          >
            🔥
          </span>
          <div className="min-w-0">
            <p className="text-xl font-bold tabular-nums">
              {streak.current}-day streak
            </p>
            <p
              className={cn(
                "text-xs",
                streak.savedToday
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground"
              )}
            >
              {streak.savedToday
                ? `Saved today ✅ — ${streak.todayCount} contact${streak.todayCount === 1 ? "" : "s"}`
                : "Save today's streak — contact a sign-up!"}
            </p>
          </div>
          {/* YOUR best, not the LC's (v33.26). Sitting unlabelled next to a
              board of other people's live streaks, "Best: 0 days" read as a
              broken number rather than as "you haven't started". */}
          {showAction && !streak.savedToday ? (
            <Button size="sm" variant="outline" asChild className="order-last shrink-0 sm:order-none">
              <Link href="/signups">Go contact one</Link>
            </Button>
          ) : null}
          <p className="ml-auto shrink-0 text-end text-xs text-muted-foreground">
            {streak.best > 0 ? (
              <>
                Your best:{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {streak.best}
                </span>{" "}
                {dayWord(streak.best)}
              </>
            ) : (
              "No streak yet — today can be day 1"
            )}
          </p>
        </div>
        <div className="border-t pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {streak.scope} top streaks
            </p>
            {/* one board for all of OGX, narrowed to a side when wanted */}
            {onScope && streak.scopes.length > 1 ? (
              <div className="ml-auto flex items-center gap-0.5 rounded-md bg-muted p-0.5">
                {streak.scopes.map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => onScope?.(sc)}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                      streak.scope === sc
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {sc}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {/* A RANKING SHOULD LOOK LIKE A RANKING (v33.26). Five names on one
              wrapped line, all the same size, told nobody who was first — so
              this is a real board: numbered rows, the day count as the thing
              your eye lands on, and each person's OGX side in its own colour. */}
          {streak.topStreaks.length > 0 ? (
            <div className="mt-1.5 grid gap-1">
              {streak.topStreaks.map((t, i) => (
                <div
                  key={`${t.name}-${i}`}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1",
                    i === 0 && "bg-orange-400/10"
                  )}
                >
                  <span className="w-6 shrink-0 text-center text-sm">
                    {medals[i] ?? <span className="text-muted-foreground">{i + 1}</span>}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                    {t.name}
                  </span>
                  {t.fn ? (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
                      style={{ backgroundColor: t.fn === "OGV" ? "#F85A40" : "#0CB9C1" }}
                    >
                      {t.fn}
                    </span>
                  ) : null}
                  {t.savedToday ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t.today} today
                    </span>
                  ) : (
                    // ALIVE BUT UNSAVED (v33.37): the grace day. Saying it
                    // out loud is what keeps the board honest — this row
                    // dies at midnight unless they contact someone.
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      not saved today ⏳
                    </span>
                  )}
                  <span
                    className={cn(
                      "w-16 shrink-0 text-end text-sm font-bold tabular-nums",
                      !t.savedToday && "opacity-50"
                    )}
                  >
                    🔥 {t.current}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Nobody has a live streak yet — be the first. 🔥
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
