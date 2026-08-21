"use client";

import { accountActions, type ActionableAccount } from "@/lib/account-actions";
import { Hint } from "./hint";
import { cn } from "@/lib/utils";

/** A SMALL DOT THAT MEANS "THIS ONE NEEDS YOU".
 *
 *  Every signal it shows already existed — an unreported visit, a Podio
 *  refresh that came due, a missing next step, three unanswered attempts — but
 *  each lived in a different email, bell or filter you had to know to apply,
 *  so on the list a row that needed work looked exactly like one that didn't.
 *
 *  Deliberately a dot and not a badge: this column already carries the name,
 *  the pin and the copy button, and a row of chips would cost more attention
 *  than the whole feature is worth. Amber = a nudge, violet = overdue. The
 *  detail is one hover (or tap — Hint opens on touch) away. */
export function ActionDot({ row, className }: { row: ActionableAccount; className?: string }) {
  const actions = accountActions(row);
  if (actions.length === 0) return null;
  const urgent = actions.some((a) => a.urgent);
  return (
    <Hint
      label={
        <span className="block text-left">
          <b>{actions.length === 1 ? "Needs you" : `${actions.length} things need you`}</b>
          {actions.map((a) => (
            <span key={a.kind} className="mt-0.5 block">
              • {a.label}
            </span>
          ))}
        </span>
      }
    >
      <span
        role="img"
        aria-label={`Action required: ${actions.map((a) => a.label).join(", ")}`}
        className={cn(
          "inline-block size-2 shrink-0 rounded-full ring-2 ring-background",
          urgent ? "bg-primary" : "bg-warning",
          className
        )}
      />
    </Hint>
  );
}
