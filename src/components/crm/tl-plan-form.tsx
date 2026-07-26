"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveTlPlan } from "@/server/actions";
import { monthKeyLabel } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Parse an input value the same way the server will (≥0 integer). */
const num = (s: string) => Math.max(0, Math.round(Number(s) || 0));

/** The raising Team Leader's opens plan — one number per peak month. Used on
 *  first sign-in (/welcome/plan-tl, redirects home after saving) AND on the
 *  profile "My plan" card (stays put, shows each month's actual next to the
 *  plan so the TL tracks themselves). */
export function TlPlanForm({
  months,
  peakLabel,
  initial,
  actuals,
  mode = "welcome",
}: {
  months: string[];
  peakLabel: string;
  /** existing plan (profile mode prefills — the form is an upsert) */
  initial?: Record<string, number>;
  /** the team's actual opens per month (profile mode shows plan vs reality) */
  actuals?: Record<string, number>;
  mode?: "welcome" | "profile";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      months.map((m) => [m, initial?.[m] ? String(initial[m]) : ""])
    )
  );

  const total = months.reduce((s, m) => s + num(rows[m]), 0);
  const allZero = total === 0;
  const showActuals = !!actuals;

  const submit = () =>
    start(async () => {
      const res = await saveTlPlan(months.map((m) => ({ month: m, opens: num(rows[m]) })));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (mode === "welcome") {
        toast.success("Plan saved — go raise those opens! 💙");
        router.replace("/");
      } else {
        toast.success("Plan updated 🎯");
      }
      router.refresh();
    });

  const gridCols = showActuals
    ? "grid-cols-[1fr_5rem_5rem]"
    : "grid-cols-[1fr_6rem]";

  return (
    <div className="grid gap-4">
      <p className="text-xs font-medium text-muted-foreground">{peakLabel}</p>

      <div className="grid gap-3">
        <div className={cn("grid items-center gap-2", gridCols)}>
          <span className="text-xs font-medium text-muted-foreground">Month</span>
          <span className="text-xs font-medium text-muted-foreground">Opens</span>
          {showActuals ? (
            <span className="text-xs font-medium text-muted-foreground">Raised</span>
          ) : null}
        </div>

        {months.map((m) => {
          const label = monthKeyLabel(m);
          const actual = actuals?.[m] ?? 0;
          const planned = num(rows[m]);
          return (
            <div key={m} className={cn("grid items-center gap-2", gridCols)}>
              <p className="text-sm font-medium">{label}</p>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                className="h-9"
                placeholder="0"
                aria-label={`${label} — opens`}
                value={rows[m]}
                onChange={(e) => setRows((r) => ({ ...r, [m]: e.target.value }))}
              />
              {showActuals ? (
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    planned > 0 && actual >= planned
                      ? "text-success"
                      : actual > 0
                        ? "text-foreground"
                        : "text-muted-foreground/60"
                  )}
                >
                  {actual}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        Peak total: <span className="font-semibold text-foreground">{total}</span> opens
        {showActuals ? (
          <>
            {" "}· raised so far:{" "}
            <span className="font-semibold text-foreground">
              {months.reduce((s, m) => s + (actuals?.[m] ?? 0), 0)}
            </span>
          </>
        ) : null}
      </p>

      <Button size="lg" onClick={submit} disabled={pending || allZero}>
        {pending ? "Saving…" : mode === "welcome" ? "Save my plan 🚀" : "Update my plan 🎯"}
      </Button>
    </div>
  );
}
