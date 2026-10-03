"use client";

import { useMemo, useState } from "react";
import {
  CalendarRange,
  ClipboardList,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import {
  METRIC_LABEL,
  PLAN_FUNNEL,
  isOgxPlanFn,
  monthKeyLabel,
  sprintKeysOfMonth,
  type Period,
  type PlanFunction,
  type PlanMetric,
} from "@/lib/plan";
import type { MmPlanRow, PlanCell, TlPlanRow } from "@/server/data";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortMonth = (key: string) => MONTH_SHORT[Number(key.slice(5, 7)) - 1];

/** Product dot per lane — GV #F85A40 · GTa #0CB9C1 · GTe #F48924 (o* mirrors i*). */
const FN_DOT: Record<PlanFunction, string> = {
  IGV: "bg-gv", IGTa: "bg-gt", IGTe: "bg-gte",
  OGV: "bg-gv", OGTa: "bg-gt", OGTe: "bg-gte",
};

type LaneActual = { IGV: number; IGTa: number; IGTe: number };

interface Props {
  fns: PlanFunction[];
  cells: PlanCell[];
  mmPlans: MmPlanRow[];
  /** raising Team Leaders' monthly opens plans (v22 — these ARE team goals) */
  tlPlans: TlPlanRow[];
  sprint: Period;
  month: Period;
  quarter: Period;
  /** the running term's 12 first-of-month keys, Feb → Jan (S2 = the last 6) */
  termMonths: string[];
  /** the peak MMs are currently planning (months = first-of-month keys) */
  peak: { label: string; months: string[] };
  /** actual opens per ICX lane for the current windows (null for OGX-only viewers) */
  actuals: { sprint: LaneActual | null; month: LaneActual | null; quarter: LaneActual | null };
  /** 🏆 approvals achieved per window (v37) — ICX lanes, null for OGX-only */
  approvalActuals: Record<"sprint" | "month" | "quarter" | "peak" | "term", LaneActual> | null;
}

/** A table number — zeros render dimmed so the real plan pops. */
function Num({ v }: { v: number }) {
  return v === 0 ? (
    <span className="text-muted-foreground/40">0</span>
  ) : (
    <>{v.toLocaleString("en")}</>
  );
}

/** One "This sprint / month / quarter" card: planned lead metric, and for ICX
 *  lanes the actual opens with a striped progress fill (GoalCard idiom). */
function PeriodCard({
  title, sub, planned, actual, leadLabel, ogx, delay,
}: {
  title: string;
  sub: string;
  planned: number;
  actual: number | null;
  leadLabel: string;
  ogx: boolean;
  delay: 1 | 2 | 3;
}) {
  const progress = !ogx && planned > 0 ? Math.min(1, (actual ?? 0) / planned) : 0;
  return (
    <Card className={cn("card-lift rise-in", `rise-in-${delay}`)}>
      <CardContent className="pt-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <CalendarRange className="size-3.5 shrink-0" /> {title}
          <span className="truncate text-muted-foreground/70">· {sub}</span>
        </p>
        {ogx ? (
          <>
            <p className="mt-1 text-2xl font-bold">
              {planned.toLocaleString("en")}
              <span className="text-base font-semibold text-muted-foreground"> {leadLabel} planned</span>
            </p>
            <Badge variant="outline" className="mt-2.5 text-[10px] text-muted-foreground">
              plan only — no actuals tracked in Sodio yet
            </Badge>
          </>
        ) : (
          <>
            <p className="mt-1 text-2xl font-bold">
              {(actual ?? 0).toLocaleString("en")}
              <span className="text-base font-semibold text-muted-foreground">
                {" "}/ {planned.toLocaleString("en")} {leadLabel}
              </span>
            </p>
            <div className="mt-3 h-2 w-full rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  progress >= 1 ? "bg-success" : "bg-primary",
                  progress > 0 && "goal-fill goal-striped"
                )}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function PlanningView({
  fns, cells, mmPlans, tlPlans, sprint, month, quarter, termMonths, peak, actuals, approvalActuals,
}: Props) {
  const [fn, setFn] = useState<PlanFunction>(fns[0]);

  const ogx = isOgxPlanFn(fn);
  const funnel = PLAN_FUNNEL[ogx ? "ogx" : "icx"];
  const leadLabel = METRIC_LABEL[funnel[0]].toLowerCase(); // "opens" / "sign ups"
  // (v37.8) The PLANNED side of every "peak" figure must cover the same months
  // the ACHIEVED side does (page.tsx queries peak.months). It was hard-wired to
  // Aug → Jan, so Feb–Jun compared the summer peak's achieved to the winter plan.
  // If the peak isn't inside this term's sheet yet (January → next summer), keep
  // the old Aug → Jan figure rather than showing a bare zero.
  const peakInTerm = peak.months.filter((m) => termMonths.includes(m));
  const s2Months = peakInTerm.length > 0 ? peakInTerm : termMonths.slice(6);
  const peakColLabel =
    peakInTerm.length > 0 ? (peak.label.startsWith("Summer") ? "Peak S1 total" : "Peak S2 total") : "Peak S2 total";

  const fnCells = useMemo(() => cells.filter((c) => c.fn === fn), [cells, fn]);
  const sum = (scope: "month" | "sprint", keys: string[], metric: PlanMetric) =>
    fnCells
      .filter((c) => c.scope === scope && c.metric === metric && keys.includes(c.period_start))
      .reduce((s, c) => s + c.value, 0);

  // actual opens for the selected lane (ICX only)
  const act = (a: LaneActual | null): number | null =>
    !ogx && a && (fn === "IGV" || fn === "IGTa" || fn === "IGTe") ? a[fn] : null;

  // consideration-funnel columns: sprint scope → month scope → month sums
  const funnelCols: {
    label: string;
    keys: string[];
    scope: "month" | "sprint";
    /** which approvals-achieved window this column is (v37) */
    win: "sprint" | "month" | "quarter" | "peak" | "term";
  }[] = [
    { label: "This sprint", scope: "sprint", keys: sprint.planKeys, win: "sprint" },
    { label: "This month", scope: "month", keys: month.planKeys, win: "month" },
    { label: `This quarter (${quarter.label})`, scope: "month", keys: quarter.planKeys, win: "quarter" },
    { label: peakColLabel, scope: "month", keys: s2Months, win: "peak" },
    { label: "Term total", scope: "month", keys: termMonths, win: "term" },
  ];
  /** 🏆 approvals ACHIEVED for this lane in a window — ICX only (v37) */
  const approvalsGot = (w: "sprint" | "month" | "quarter" | "peak" | "term"): number | null =>
    !ogx && approvalActuals && (fn === "IGV" || fn === "IGTa" || fn === "IGTe")
      ? approvalActuals[w][fn]
      : null;

  // step-to-step conversions from the TERM month totals — deliberately NOT
  // capped at 100%: the planning funnel legitimately grows (applicants are
  // normally MORE than opens). Only the dashboard's account funnel caps.
  const termTotal = (m: PlanMetric) => sum("month", termMonths, m);
  const conversions = funnel.slice(0, -1).map((from, i) => {
    const to = funnel[i + 1];
    const a = termTotal(from);
    const b = termTotal(to);
    return { from, to, pct: a > 0 ? `${Math.round((b / a) * 100)}%` : "—" };
  });

  // sprint-split columns for the current quarter's 3 months (6 columns)
  const sprintCols = quarter.planKeys.flatMap((mk) =>
    sprintKeysOfMonth(mk).map((key, i) => ({ key, label: `${shortMonth(mk)} S${i + 1}` }))
  );

  // MM plans grouped per member, kept to the peak currently being planned
  const mmGroups = useMemo(() => {
    const peakSet = new Set(peak.months);
    const map = new Map<string, { id: string; name: string; role: string; team: string | null; rows: MmPlanRow[] }>();
    for (const p of mmPlans) {
      const key = `${p.month.slice(0, 7)}-01`;
      if (!peakSet.has(key)) continue;
      const g = map.get(p.member_id) ?? {
        id: p.member_id, name: p.member_name, role: p.member_role, team: p.team_name, rows: [],
      };
      g.rows.push(p);
      map.set(p.member_id, g);
    }
    return [...map.values()];
  }, [mmPlans, peak.months]);

  // TL opens plans grouped per Team Leader, kept to the same peak
  const tlGroups = useMemo(() => {
    const peakSet = new Set(peak.months);
    const map = new Map<string, { id: string; name: string; team: string | null; rows: TlPlanRow[]; total: number }>();
    for (const p of tlPlans) {
      const key = `${p.month.slice(0, 7)}-01`;
      if (!peakSet.has(key)) continue;
      const g = map.get(p.member_id) ?? {
        id: p.member_id, name: p.member_name, team: p.team_name, rows: [], total: 0,
      };
      g.rows.push(p);
      g.total += p.opens;
      map.set(p.member_id, g);
    }
    return [...map.values()];
  }, [tlPlans, peak.months]);

  const hasPlan = fnCells.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* header (the self-serve re-import button stays removed — v26) */}
      <div className="flex flex-wrap items-start justify-between gap-3 rise-in">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="size-6 text-primary" /> Planning
          </h1>
          <p className="text-sm text-muted-foreground">
            The VP plan vs reality — sprints, months, quarters and the MM plans behind them.
          </p>
        </div>

      </div>

      {/* function switcher */}
      <div className="flex flex-wrap gap-1.5 rise-in rise-in-1">
        {fns.map((f) => (
          <button
            key={f}
            onClick={() => setFn(f)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              fn === f
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:border-primary/50"
            )}
          >
            <span className={cn("size-2 rounded-full", FN_DOT[f])} /> {f}
          </button>
        ))}
      </div>

      {!hasPlan ? (
        <Card className="rise-in rise-in-2">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {/* (v37.8) the self-serve re-import button was removed in v26 — don't point at it */}
            No plan has been imported for {fn} yet. Ask the admin to import it from the planning sheet.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* current windows */}
          <div className="grid gap-3 sm:grid-cols-3">
            <PeriodCard
              title="This sprint"
              sub={sprint.label}
              planned={sum("sprint", sprint.planKeys, funnel[0])}
              actual={act(actuals.sprint)}
              leadLabel={leadLabel}
              ogx={ogx}
              delay={1}
            />
            <PeriodCard
              title="This month"
              sub={month.label}
              planned={sum("month", month.planKeys, funnel[0])}
              actual={act(actuals.month)}
              leadLabel={leadLabel}
              ogx={ogx}
              delay={2}
            />
            <PeriodCard
              title="This quarter"
              sub={`${quarter.label} · ${shortMonth(quarter.planKeys[0])}–${shortMonth(quarter.planKeys[2])}`}
              planned={sum("month", quarter.planKeys, funnel[0])}
              actual={act(actuals.quarter)}
              leadLabel={leadLabel}
              ogx={ogx}
              delay={3}
            />
          </div>

          {/* 🏆 APPROVALS — the ICX MOS, planned vs achieved (v37). Logged in
              Consideration → Approvals, credited to one person each. */}
          {!ogx && approvalActuals ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <PeriodCard
                title="🏆 Approvals · sprint"
                sub={sprint.label}
                planned={Math.ceil(sum("sprint", sprint.planKeys, "approvals"))}
                actual={approvalsGot("sprint")}
                leadLabel="approvals"
                ogx={false}
                delay={1}
              />
              <PeriodCard
                title="🏆 Approvals · month"
                sub={month.label}
                planned={Math.ceil(sum("month", month.planKeys, "approvals"))}
                actual={approvalsGot("month")}
                leadLabel="approvals"
                ogx={false}
                delay={2}
              />
              <PeriodCard
                title="🏆 Approvals · peak"
                sub={peak.label}
                planned={Math.ceil(sum("month", s2Months, "approvals"))}
                actual={approvalsGot("peak")}
                leadLabel="approvals"
                ogx={false}
                delay={3}
              />
            </div>
          ) : null}

          {/* consideration funnel */}
          <Card className="rise-in rise-in-2">
            <CardHeader>
              <CardTitle className="text-base">Consideration funnel — {fn}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Metric</TableHead>
                      {funnelCols.map((c) => (
                        <TableHead key={c.label} className="whitespace-nowrap text-center">
                          {c.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {funnel.map((m) => (
                      <TableRow key={m}>
                        <TableCell className="whitespace-nowrap font-medium">{METRIC_LABEL[m]}</TableCell>
                        {funnelCols.map((c) => {
                          const got = m === "approvals" ? approvalsGot(c.win) : null;
                          return (
                            <TableCell key={c.label} className="text-center text-sm font-semibold">
                              {got != null ? (
                                // 🏆 achieved / planned — the one funnel row
                                // Sodio can now measure on the consideration side
                                <span title="Achieved (logged in Consideration → Approvals) / planned">
                                  <span className="text-primary">{got}</span>
                                  <span className="text-muted-foreground"> / </span>
                                  <Num v={sum(c.scope, c.keys, m)} />
                                </span>
                              ) : (
                                <Num v={sum(c.scope, c.keys, m)} />
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* conversions */}
          <Card className="rise-in rise-in-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4 text-primary" /> Conversions
                <span className="text-xs font-normal text-muted-foreground">· planned, over the whole term</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {conversions.map((c) => (
                  <div
                    key={c.from}
                    className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-sm"
                  >
                    <span className="truncate text-muted-foreground">
                      {METRIC_LABEL[c.from]} → {METRIC_LABEL[c.to]}
                    </span>
                    <span className="font-bold">{c.pct}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* monthly plan, Feb → Jan */}
          <Card className="rise-in rise-in-3">
            <CardHeader>
              <CardTitle className="text-base">Monthly plan — {fn}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Metric</TableHead>
                      {termMonths.map((k) => (
                        <TableHead key={k} className="whitespace-nowrap text-center" title={monthKeyLabel(k)}>
                          {shortMonth(k)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {funnel.map((m) => (
                      <TableRow key={m}>
                        <TableCell className="whitespace-nowrap font-medium">{METRIC_LABEL[m]}</TableCell>
                        {termMonths.map((k) => (
                          <TableCell key={k} className="text-center text-sm font-semibold">
                            <Num v={sum("month", [k], m)} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* sprint split for the current quarter */}
          <Card className="rise-in rise-in-3">
            <CardHeader>
              <CardTitle className="text-base">
                Sprint split — {quarter.label}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  Sprint 1 = day 1–15 · Sprint 2 = 16–EOM
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Metric</TableHead>
                      {sprintCols.map((c) => (
                        <TableHead key={c.key} className="whitespace-nowrap text-center">
                          {c.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {funnel.map((m) => (
                      <TableRow key={m}>
                        <TableCell className="whitespace-nowrap font-medium">{METRIC_LABEL[m]}</TableCell>
                        {sprintCols.map((c) => (
                          <TableCell key={c.key} className="text-center text-sm font-semibold">
                            <Num v={sum("sprint", [c.key], m)} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* TL opens plans (v22) — these ARE the team goals */}
      <Card className="rise-in rise-in-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-primary" /> Raising MM plans — opens
            <span className="text-xs font-normal text-muted-foreground">· {peak.label}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tlGroups.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No plans filed yet — raising TLs &amp; Coordinators are asked on
              sign-in and can file/update from their profile.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {tlGroups.map((g) => (
                <div key={g.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold">{g.name}</p>
                    {g.team ? (
                      <Badge className="border-transparent bg-primary/15 text-[10px] font-bold text-primary">
                        {g.team}
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className="ml-auto text-[10px]">
                      {g.total.toLocaleString("en")} opens total
                    </Badge>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {g.rows.map((r) => (
                      <li key={r.month}>
                        <span className="font-medium text-foreground">
                          {monthKeyLabel(`${r.month.slice(0, 7)}-01`)}
                        </span>
                        {" — "}
                        {r.opens} opens
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* MM plans for the peak being planned */}
      <Card className="rise-in rise-in-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UsersRound className="size-4 text-primary" /> MM plans
            <span className="text-xs font-normal text-muted-foreground">· {peak.label}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mmGroups.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No MM plans filed yet — MMs are asked on their first sign-in.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {mmGroups.map((g) => (
                <div key={g.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold">{g.name}</p>
                    <Badge variant="outline" className="text-[10px]">{g.role || "MM"}</Badge>
                    {g.team ? (
                      <Badge className="border-transparent bg-primary/15 text-[10px] font-bold text-primary">
                        {g.team}
                      </Badge>
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {g.rows.map((r) => (
                      <li key={r.month}>
                        <span className="font-medium text-foreground">{monthKeyLabel(`${r.month.slice(0, 7)}-01`)}</span>
                        {" — "}
                        {r.applicants} applicants · {r.accepted} accepted · {r.approvals} approvals
                        {r.approvals_actual != null ? (
                          <span
                            className={cn(
                              "ml-1.5 font-semibold",
                              r.approvals > 0 && r.approvals_actual >= r.approvals
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-primary"
                            )}
                            title="Approvals actually credited — theirs, plus their team's when they lead one"
                          >
                            · 🏆 {r.approvals_actual} achieved
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
