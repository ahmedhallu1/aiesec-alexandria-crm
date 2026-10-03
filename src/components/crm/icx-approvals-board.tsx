"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LaneApprovals } from "@/lib/icx-approvals";

/**
 * 🏆 THE APPROVALS BOARD — the ICX MOS, the way the planning sheet reads it.
 *
 * Planned vs achieved for the period the filter bar is on, the whole peak so
 * far, a month-by-month strip against the plan, and the two leaderboards: by
 * PERSON (what each one was credited with) and by MM (a Team Leader's own
 * approvals plus their team's — the rule every MOS in Sodio rolls up by).
 *
 * Shared by the dashboard's consideration lane and the Consideration module's
 * Approvals tab, so the two can never show different numbers.
 */
export function IcxApprovalsBoard({
  data,
  mmPlanned,
  compact = false,
}: {
  data: LaneApprovals;
  /** the consideration MMs' own filed approvals for this month, when any */
  mmPlanned?: number | null;
  /** the tab shows the boards itself — skip them here */
  compact?: boolean;
}) {
  const pct = (a: number, p: number | null) =>
    p && p > 0 ? Math.round((a / p) * 100) : null;
  const planPct = pct(data.plan.achieved, data.plan.planned);
  const peakPct = pct(data.peak.achieved, data.peak.planned);
  const maxBar = Math.max(1, ...data.byMonth.map((m) => Math.max(m.achieved, m.planned ?? 0)));
  const delta = data.lastMonth == null ? null : data.thisMonth - data.lastMonth;

  const mine = data.planKind === "mine";
  const noPlanText = mine
    ? "You haven't filed an approvals plan for this — do it on your profile."
    : "No approvals planned on the sheet for this period.";

  return (
    <div className="space-y-3">
      {data.planKind === "none" ? (
        // A MEMBER SEES NO PLAN (v37.1) — just what the floor has achieved
        <div className="grid grid-cols-2 gap-3">
          <CountCard title="🏆 Approvals — this month" value={data.thisMonth} />
          <CountCard title={`🏆 Approvals — ${data.peak.label}`} value={data.peak.achieved} />
        </div>
      ) : (
      <div className="grid gap-3 md:grid-cols-2">
        <ProgressCard
          title={`🏆 ${mine ? "Your approvals" : "Approvals"} — ${data.plan.mode === "sprint" ? "this sprint" : "this month"}`}
          subtitle={`${data.plan.label} · ${mine ? "your plan, from your profile" : "the planning sheet"}`}
          achieved={data.plan.achieved}
          planned={data.plan.planned}
          pct={planPct}
          noPlanText={noPlanText}
          foot={
            [
              !mine && mmPlanned != null && mmPlanned > 0
                ? `The MMs filed ${mmPlanned} for this month`
                : null,
              mine ? "Yours + your team's" : null,
              !mine && delta != null && data.plan.mode === "month"
                ? `${data.lastMonth} last month${delta !== 0 ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || null
          }
        />
        <ProgressCard
          title={`🏆 ${mine ? "Your approvals" : "Approvals"} — the peak so far`}
          subtitle={`${data.peak.label} · ${mine ? "your plan" : "the planning sheet"}`}
          achieved={data.peak.achieved}
          planned={data.peak.planned}
          pct={peakPct}
          noPlanText={noPlanText}
          foot={
            !mine && data.total !== data.peak.achieved
              ? `${data.total} ${data.totalLabel}`
              : null
          }
        />
      </div>
      )}

      {data.planKind !== "none" && data.byMonth.length > 0 ? (
        <Card className="rise-in py-0">
          <CardContent className="px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">
              {mine ? "Your approvals per month vs your plan" : "Approvals per month vs the plan"} — {data.peak.label}
            </p>
            <div className="mt-3 flex items-end gap-2">
              {data.byMonth.map((m) => (
                <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-bold tabular-nums">
                    {m.achieved}
                    {m.planned != null ? (
                      <span className="font-normal text-muted-foreground">/{m.planned}</span>
                    ) : null}
                  </span>
                  <div className="relative flex h-[72px] w-full max-w-10 items-end">
                    {m.planned != null ? (
                      <div
                        className="absolute inset-x-0 border-t-2 border-dashed border-muted-foreground/60"
                        style={{ bottom: `${(m.planned / maxBar) * 72}px` }}
                        title={`${m.planned} planned`}
                      />
                    ) : null}
                    <div
                      className={cn(
                        "w-full rounded-t transition-all",
                        m.planned != null && m.achieved >= m.planned
                          ? "bg-emerald-500/80"
                          : "bg-primary/80"
                      )}
                      style={{ height: `${Math.max(3, (m.achieved / maxBar) * 72)}px` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{m.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Bar = achieved · dashed line = {mine ? "your plan" : "planned on the planning sheet"}.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!compact && (data.people.length > 0 || data.mms.length > 0) ? (
        <div className="grid gap-3 md:grid-cols-2">
          <BoardCard
            title="🏅 By person"
            hint="Approvals credited to each person"
            rows={data.people.map((p) => ({ key: p.id ?? p.name, name: p.name, value: p.own }))}
          />
          <BoardCard
            title="👥 By MM — own + team"
            hint="A Team Leader's own approvals plus everyone who reports to them"
            rows={data.mms.map((m) => ({
              key: m.id,
              name: m.name,
              value: m.total,
              detail: `${m.own} own · ${m.team} team`,
            }))}
            empty="Nobody who reports to a Team Leader has an approval in this window yet."
          />
        </div>
      ) : null}

      {data.total > 0 ? (
        <Card className="rise-in py-0">
          <CardContent className="grid gap-3 px-4 py-3 sm:grid-cols-3">
            <ChipGroup
              title="Programme"
              items={data.byProduct.map((p) => ({ label: p.product, count: p.count }))}
            />
            <ChipGroup
              title="How they came"
              items={data.bySource.map((s) => ({ label: s.label, count: s.count }))}
            />
            <ChipGroup
              title="Where from (sending LC)"
              items={data.topLcs.map((l) => ({ label: l.name, count: l.count }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ProgressCard({
  title,
  subtitle,
  achieved,
  planned,
  pct,
  foot,
  noPlanText,
}: {
  title: string;
  subtitle: string;
  achieved: number;
  planned: number | null;
  pct: number | null;
  foot: string | null;
  noPlanText: string;
}) {
  return (
    <Card className="kpi-card rise-in py-0">
      <CardContent className="px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        <p className="mt-1.5 text-3xl font-black leading-none tabular-nums">
          {achieved}
          {planned != null && planned > 0 ? (
            <span className="text-lg font-bold text-muted-foreground"> / {planned}</span>
          ) : null}
        </p>
        {/* (v37.8) a plan of 0 has no percentage — treat it as "no plan" instead of a bare "% of the plan" */}
        {planned != null && planned > 0 ? (
          <>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  (pct ?? 0) >= 100 ? "bg-emerald-500" : "bg-primary"
                )}
                style={{ width: `${Math.min(100, pct ?? 0)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {pct}% of the plan
              {achieved < planned ? ` · ${planned - achieved} to go` : " · plan met 🎉"}
            </p>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{noPlanText}</p>
        )}
        {foot ? <p className="mt-1 text-[11px] text-muted-foreground">{foot}</p> : null}
      </CardContent>
    </Card>
  );
}

function CountCard({ title, value }: { title: string; value: number }) {
  return (
    <Card className="kpi-card rise-in py-0">
      <CardContent className="px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="mt-1.5 text-3xl font-black leading-none tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function BoardCard({
  title,
  hint,
  rows,
  empty = "No approvals in this window yet.",
}: {
  title: string;
  hint: string;
  rows: { key: string; name: string; value: number; detail?: string }[];
  empty?: string;
}) {
  return (
    <Card className="rise-in py-0">
      <CardContent className="px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground" title={hint}>
          {title}
        </p>
        {rows.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ol className="mt-2 space-y-1">
            {rows.slice(0, 15).map((r, i) => (
              <li
                key={r.key}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-sm",
                  i === 0 && "bg-amber-50 dark:bg-amber-950/30"
                )}
              >
                <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {r.name}
                  {r.detail ? (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{r.detail}</span>
                  ) : null}
                </span>
                <span className="font-bold tabular-nums">{r.value}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function ChipGroup({ title, items }: { title: string; items: { label: string; count: number }[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          items.map((i) => (
            <span
              key={i.label}
              className="max-w-full truncate rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium"
              dir="auto"
            >
              {i.label} <b>{i.count}</b>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
