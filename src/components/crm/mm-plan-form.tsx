"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveMmPlan } from "@/server/actions";
import { monthKeyLabel } from "@/lib/plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Field = "applicants" | "accepted" | "approvals";
type Row = Record<Field, string>;

const FIELDS: Field[] = ["applicants", "accepted", "approvals"];
const FIELD_LABEL: Record<Field, string> = {
  applicants: "Applicants",
  accepted: "Accepted",
  approvals: "Approvals",
};

/** Parse an input value the same way the server will (≥0 integer). */
const num = (s: string) => Math.max(0, Math.round(Number(s) || 0));

export function MmPlanForm({ months, peakLabel }: { months: string[]; peakLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(months.map((m) => [m, { applicants: "", accepted: "", approvals: "" }]))
  );

  const set = (month: string, field: Field, value: string) =>
    setRows((r) => ({ ...r, [month]: { ...r[month], [field]: value } }));

  const totals = months.reduce(
    (acc, m) => {
      acc.applicants += num(rows[m].applicants);
      acc.accepted += num(rows[m].accepted);
      acc.approvals += num(rows[m].approvals);
      return acc;
    },
    { applicants: 0, accepted: 0, approvals: 0 }
  );
  const allZero = totals.applicants + totals.accepted + totals.approvals === 0;

  const funnelOff = months.some((m) => {
    const a = num(rows[m].applicants);
    const b = num(rows[m].accepted);
    const c = num(rows[m].approvals);
    return b > a || c > b;
  });

  const submit = () =>
    start(async () => {
      const res = await saveMmPlan(
        months.map((m) => ({
          month: m,
          applicants: num(rows[m].applicants),
          accepted: num(rows[m].accepted),
          approvals: num(rows[m].approvals),
        }))
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Plan saved — go get those approvals! 💙");
      router.replace("/");
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      <p className="text-xs font-medium text-muted-foreground">{peakLabel}</p>

      <div className="grid gap-3">
        {/* Column headers — one row, aligned with the inputs */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <span className="hidden text-xs font-medium text-muted-foreground sm:block" aria-hidden>
            Month
          </span>
          {FIELDS.map((f) => (
            <span key={f} className="text-xs font-medium text-muted-foreground">
              {FIELD_LABEL[f]}
            </span>
          ))}
        </div>

        {months.map((m) => {
          const label = monthKeyLabel(m);
          return (
            <div
              key={m}
              className="grid grid-cols-3 gap-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr] sm:items-center"
            >
              <p className="col-span-3 text-sm font-medium sm:col-span-1">{label}</p>
              {FIELDS.map((f) => (
                <Input
                  key={f}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="h-9"
                  placeholder="0"
                  aria-label={`${label} — ${FIELD_LABEL[f].toLowerCase()}`}
                  value={rows[m][f]}
                  onChange={(e) => set(m, f, e.target.value)}
                />
              ))}
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        Total:{" "}
        <span className="font-semibold text-foreground">{totals.applicants}</span> applicants ·{" "}
        <span className="font-semibold text-foreground">{totals.accepted}</span> accepted ·{" "}
        <span className="font-semibold text-foreground">{totals.approvals}</span> approvals
      </p>

      {funnelOff ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
          Heads up: usually applicants ≥ accepted ≥ approvals.
        </p>
      ) : null}

      <Button size="lg" onClick={submit} disabled={pending || allZero}>
        {pending ? "Saving…" : "Save my plan 🚀"}
      </Button>
    </div>
  );
}
