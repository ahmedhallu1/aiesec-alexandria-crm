"use client";

import { useCallback, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Loader2, Target, Trophy, UserRound, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Hint } from "./hint";
import { CountUp } from "./count-up";
import { cn } from "@/lib/utils";
import { FUNCTION_COLORS } from "@/lib/types";
import type { DrillGroup, FunnelStats, LanePlan, TeamPlan } from "@/server/data";

export interface DashboardScopeView { key: string; label: string }

interface Props {
  total: FunnelStats;
  byFunction: DrillGroup[];
  byTeam: DrillGroup[];
  memberBoard: DrillGroup[];
  mmBoard: DrillGroup[];
  teamBoard: DrillGroup[];
  views: DashboardScopeView[];
  activeFn: string;
  laneLabel: string;
  scopeLabel: string;
  showTeamDrill: boolean;
  teamOptions: { id: string; label: string }[];
  memberOptions: { id: string; label: string }[];
  filters: { team: string; member: string; from: string; to: string };
  /** the signed-in member — powers the "My numbers" personal KPI toggle */
  viewerId: string;
  /** leaders (VP/Director/LCP) see the whole function — no "My numbers" chip */
  showMyNumbers: boolean;
  /** VP plan snapshot for product lanes (IGV/IGTa/IGTe/IGT) — null elsewhere.
   *  v22: this IS the lane goal (from the planning sheet — nothing set in-app) */
  lanePlan: LanePlan | null;
  /** the viewer's team plan (the TL's filed opens plan vs the team's month) */
  teamPlan: TeamPlan | null;
  teamLabel: string | null;
}

/** Funnel conversions are capped at 100% — a later step can outrun an earlier
 *  one in the data (e.g. a deal without a reported visit), never in logic. */
const pct = (num: number, den: number) =>
  den > 0 ? `${Math.min(100, Math.round((num / den) * 100))}%` : "—";

function monthRange(): { from: string; to: string; label: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    from: iso(from),
    to: iso(to),
    label: now.toLocaleString("en", { month: "long", year: "numeric" }),
  };
}

export function DashboardView({
  total, byFunction, byTeam, memberBoard, mmBoard, teamBoard,
  views, activeFn, laneLabel, scopeLabel,
  showTeamDrill, teamOptions, memberOptions, filters, viewerId, showMyNumbers,
  lanePlan, teamPlan, teamLabel,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();

  const go = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      startNav(() => {
        router.replace(params.size > 0 ? `/dashboard?${params.toString()}` : "/dashboard");
      });
    },
    [router, searchParams]
  );
  const setParam = useCallback(
    (key: string, value: string) =>
      go((p) => (value ? p.set(key, value) : p.delete(key))),
    [go]
  );

  // KPIs, in the LC's order — conversions between consecutive steps live below
  const kpis = [
    { label: "Market Research", value: total.mr, hint: "total accounts in the system" },
    { label: "Contacted", value: total.contacted, hint: "accounts with ≥1 contact" },
    { label: "Visits", value: total.visitScheduled, hint: "visits scheduled" },
    { label: "Visits done", value: total.visitDone, hint: "confirmed visits" },
    { label: "Deals", value: total.deals, hint: "deals signed (accounts can close many)" },
    { label: "Slots raised", value: total.slots, hint: "total slots/opens" },
  ];
  const conversions = [
    { label: "MR → Contacted", value: pct(total.contacted, total.mr) },
    { label: "Contacted → Visits", value: pct(total.visitScheduled, total.contacted) },
    { label: "Visits → Done", value: pct(total.visitDone, total.visitScheduled) },
    { label: "Visit Done → Deal", value: pct(total.dealAccounts, total.visitDone) },
  ];
  const month = monthRange();
  const today = new Date().toISOString().slice(0, 10);
  const thisMonthActive = filters.from === month.from && filters.to === month.to;
  const myNumbersActive = filters.member === viewerId;
  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <div className={cn("mx-auto max-w-6xl space-y-5", navPending && "nav-pending")}>
      <div className="flex flex-wrap items-center justify-between gap-3 rise-in">
        <div>
          <h1 className="text-2xl font-bold">
            {laneLabel} Dashboard{" "}
            {navPending ? <Loader2 className="ml-1 inline size-4 animate-spin text-primary" /> : null}
          </h1>
          <p className="text-sm text-muted-foreground">{scopeLabel}</p>
        </div>
        {views.length > 1 ? (
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {views.map((v) => (
              <button
                key={v.key}
                onClick={() => setParam("fn", v.key === views[0].key ? "" : v.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  activeFn === v.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rise-in rise-in-1">
        <Hint label="Show only this calendar month's accounts">
          <Button
            variant={thisMonthActive ? "default" : "outline"}
            className="h-9"
            size="sm"
            onClick={() =>
              go((p) => {
                if (thisMonthActive) { p.delete("from"); p.delete("to"); }
                else { p.set("from", month.from); p.set("to", month.to); }
              })
            }
          >
            <CalendarRange className="size-4" /> This month
          </Button>
        </Hint>
        {showMyNumbers ? (
          <Hint label="Track your own KPIs & MOS — every number counts only the accounts you're responsible for">
            <Button
              variant={myNumbersActive ? "default" : "outline"}
              className="h-9"
              size="sm"
              onClick={() => setParam("member", myNumbersActive ? "" : viewerId)}
            >
              <UserRound className="size-4" /> My numbers
            </Button>
          </Hint>
        ) : null}
        {teamOptions.length > 0 ? (
          <Select
            value={filters.team || "__all"}
            onValueChange={(v) => setParam("team", v === "__all" ? "" : v)}
          >
            <SelectTrigger className="h-9 w-auto min-w-28">
              <SelectValue placeholder="Team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Team: all</SelectItem>
              {teamOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {memberOptions.length > 1 ? (
          <Select
            value={filters.member || "__all"}
            onValueChange={(v) => setParam("member", v === "__all" ? "" : v)}
          >
            <SelectTrigger className="h-9 w-auto min-w-28">
              <SelectValue placeholder="Member" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Member: all</SelectItem>
              {memberOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {/* one h-9 group so the whole bar sits on a single baseline */}
        <div className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30">
          <span className="hidden text-xs font-medium text-muted-foreground min-[400px]:inline">Added</span>
          <Input
            type="date"
            max={today}
            className="h-7 w-[6.6rem] min-[400px]:w-[7.9rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label="Added from"
            value={filters.from}
            onChange={(e) => setParam("from", e.target.value)}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            max={today}
            className="h-7 w-[6.6rem] min-[400px]:w-[7.9rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label="Added to"
            value={filters.to}
            onChange={(e) => setParam("to", e.target.value)}
          />
        </div>
        {anyFilter ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go((p) => { ["team", "member", "from", "to"].forEach((k) => p.delete(k)); })}
          >
            <X className="size-4" /> Clear
          </Button>
        ) : null}
      </div>

      {/* Goals = the plans (v22): the lane goal comes from the VPs' planning
          sheet, the team goal from the TL's filed plan — nothing is set here. */}
      {lanePlan ? <PlanCard plan={lanePlan} /> : null}
      {teamPlan ? (
        <TeamPlanCard plan={teamPlan} teamLabel={teamLabel} isOwnPlan={teamPlan.teamLeaderId === viewerId} />
      ) : null}

      {/* KPI row — MR · Contacted · Visits · Visits done · Deals · Slots · Lead→Deal */}
      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} sub={k.hint} />
        ))}
        <KpiCard
          label="Lead → Open"
          valueText={pct(total.dealAccounts, total.mr)}
          sub="accounts that raised opens"
        />
      </div>

      {/* step-to-step conversion strip */}
      <Card className="rise-in rise-in-2">
        <CardContent className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-4">
          {conversions.map((c) => (
            <div key={c.label} className="text-center">
              <p className="text-xl font-bold text-primary">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Leaderboards — compact boards side by side on wide screens (Members /
          MMs), each with all numbers + click-a-KPI-header-to-re-rank. */}
      <div className="grid gap-4 rise-in rise-in-3 xl:grid-cols-2">
        {memberBoard.length > 0 ? (
          <Leaderboard title={`${laneLabel} — Members`} groups={memberBoard} />
        ) : null}
        {mmBoard.length > 0 ? (
          <Leaderboard title={`${laneLabel} — MMs`} groups={mmBoard} />
        ) : null}
        {teamBoard.length > 1 ? (
          <Leaderboard
            title={`${teamLabel ?? "Team"} leaderboard`}
            groups={teamBoard}
          />
        ) : null}
      </div>

      {/* Drill-down */}
      {(byFunction.length > 1 || showTeamDrill) ? (
        <Card className="rise-in rise-in-4">
          <CardHeader>
            <CardTitle className="text-base">Drill-down</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={byFunction.length > 1 ? "function" : "team"}>
              <TabsList className="flex-wrap">
                {byFunction.length > 1 ? <TabsTrigger value="function">By product</TabsTrigger> : null}
                {showTeamDrill ? <TabsTrigger value="team">By team</TabsTrigger> : null}
              </TabsList>
              {byFunction.length > 1 ? (
                <TabsContent value="function"><DrillTable groups={byFunction} colorKeys /></TabsContent>
              ) : null}
              {showTeamDrill ? (
                <TabsContent value="team"><DrillTable groups={byTeam} /></TabsContent>
              ) : null}
            </Tabs>
          </CardContent>
        </Card>
      ) : null}

    </div>
  );
}

// ------------------------------------------------------------------ pieces

/** The viewer's TEAM goal (v22): the Team Leader's filed opens plan for the
 *  current month vs what the team actually raised. Nothing is set here — the
 *  TL files/updates the plan from their profile. */
function TeamPlanCard({
  plan, teamLabel, isOwnPlan,
}: {
  plan: TeamPlan;
  teamLabel: string | null;
  isOwnPlan: boolean;
}) {
  const progress = plan.plannedOpens > 0 ? Math.min(1, plan.actualOpens / plan.plannedOpens) : 0;
  return (
    <Card className="relative overflow-hidden rise-in rise-in-2">
      <CardContent className="pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Target className="size-3.5" /> {teamLabel ?? "Team"} plan · {plan.monthLabel}
            </p>
            {plan.plannedOpens > 0 ? (
              <p className="mt-1 text-2xl font-bold">
                {plan.actualOpens.toLocaleString("en")}
                <span className="text-base font-semibold text-muted-foreground">
                  {" "}/ {plan.plannedOpens.toLocaleString("en")} opens planned
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {isOwnPlan
                  ? "No plan filed for this month yet — set your team's opens plan from your profile."
                  : "Your Team Leader hasn't filed this month's plan yet."}
              </p>
            )}
          </div>
          {isOwnPlan ? (
            <Button size="sm" variant="outline" asChild>
              <Link href="/profile">
                <Target className="size-4" /> My plan
              </Link>
            </Button>
          ) : null}
        </div>
        {plan.plannedOpens > 0 ? (
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
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The VP plan snapshot (from the planning sheet): current SPRINT by default,
 *  toggleable to the month. Opens = plan vs actually-raised; the consideration
 *  funnel numbers are the plan (consideration isn't tracked in Sodio yet). */
function PlanCard({ plan }: { plan: LanePlan }) {
  const [view, setView] = useState<"sprint" | "month">("sprint");
  const win = view === "sprint" ? plan.sprint : plan.month;
  const progress = win.plannedOpens > 0 ? Math.min(1, win.actualOpens / win.plannedOpens) : 0;
  const metricLabel: Record<string, string> = {
    applicants: "Applicants", accepted: "Accepted", approvals: "Approvals",
  };
  return (
    <Card className="relative overflow-hidden rise-in rise-in-2">
      <CardContent className="pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarRange className="size-3.5" /> {plan.lane} goal · {win.label}
            </p>
            <p className="mt-1 text-2xl font-bold">
              {win.actualOpens.toLocaleString("en")}
              <span className="text-base font-semibold text-muted-foreground">
                {" "}/ {win.plannedOpens.toLocaleString("en")} opens planned
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {(["sprint", "month"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setView(k)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                  view === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                {k === "sprint" ? "This sprint" : "This month"}
              </button>
            ))}
          </div>
        </div>
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
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">Consideration plan:</span>
          {win.funnel.map((f) => (
            <span key={f.metric}>
              {metricLabel[f.metric] ?? f.metric}: <b className="text-foreground">{f.value.toLocaleString("en")}</b>
            </span>
          ))}
          <span className="text-muted-foreground/60">— from the VPs&apos; planning sheet</span>
        </div>
      </CardContent>
    </Card>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** Leaderboard metrics, in funnel order — Opens (slots) is the default sort. */
const BOARD_METRICS: { key: keyof FunnelStats; label: string; short: string }[] = [
  { key: "mr", label: "MR", short: "MR" },
  { key: "contacted", label: "Contacted", short: "Cont." },
  { key: "visitScheduled", label: "Visits", short: "Vis." },
  { key: "visitDone", label: "Visits done", short: "Done" },
  { key: "deals", label: "Deals", short: "Deals" },
  { key: "slots", label: "Opens", short: "Opens" },
];

/** FLIP reorder: animate rows sliding to their new spot when the sort changes.
 *  Captures each row's position, and on the next layout inverts + plays the
 *  delta. Respects prefers-reduced-motion. */
function useFlipReorder<T>(dep: T) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rows = container.querySelectorAll<HTMLElement>("[data-flip-key]");
    const next = new Map<string, number>();
    rows.forEach((row) => next.set(row.dataset.flipKey!, row.getBoundingClientRect().top));
    if (!reduce) {
      rows.forEach((row) => {
        const key = row.dataset.flipKey!;
        const before = prev.current.get(key);
        const after = next.get(key)!;
        if (before != null && Math.abs(before - after) > 1) {
          row.animate(
            [{ transform: `translateY(${before - after}px)` }, { transform: "translateY(0)" }],
            { duration: 420, easing: "cubic-bezier(0.34, 1.2, 0.64, 1)" }
          );
        }
      });
    }
    prev.current = next;
  }, [dep]);
  return ref;
}

/** ONE wide board showing every funnel number per member. Click any KPI header
 *  to re-sort — rows glide to their new places. Members & Coordinators only,
 *  default sorted by Opens. */
function Leaderboard({ title, groups }: { title: string; groups: DrillGroup[] }) {
  const [metricKey, setMetricKey] = useState<keyof FunnelStats>("slots");
  const ranked = [...groups].sort(
    (a, b) =>
      (b[metricKey] as number) - (a[metricKey] as number) ||
      b.slots - a.slots ||
      b.deals - a.deals ||
      b.contacted - a.contacted
  );
  const flipRef = useFlipReorder(metricKey + ":" + groups.map((g) => g.key).join(","));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="size-4 text-warning" /> {title}
          <span className="text-xs font-normal text-muted-foreground">· tap a metric to rank by it</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        {/* phones: compact board — metric chips + rank/name/value, no wide table */}
        <div className="md:hidden">
          <div className="mb-2 flex flex-wrap gap-1">
            {BOARD_METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetricKey(m.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                  metricKey === m.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:border-primary/50"
                )}
              >
                {m.short}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            {ranked.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No members yet.</p>
            ) : (
              ranked.slice(0, 8).map((g, i) => {
                const active = g[metricKey] as number;
                return (
                  <div
                    key={g.key}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                      i === 0 && active > 0 ? "bg-warning/10" : i % 2 ? "bg-muted/30" : ""
                    )}
                  >
                    <span className="w-7 shrink-0 text-center text-base">
                      {active > 0 && MEDALS[i] ? MEDALS[i] : (
                        <span className="text-xs text-muted-foreground">#{i + 1}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{g.label}</span>
                    <span className="shrink-0 font-bold tabular-nums text-primary">{active}</span>
                    <span className="w-16 shrink-0 text-right text-[10px] text-muted-foreground">
                      {BOARD_METRICS.find((m) => m.key === metricKey)?.label}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
        {/* ≥md: the full wide board */}
        <div className="hidden overflow-x-auto md:block">
          <div className="min-w-[34rem]">
            {/* header row of clickable KPIs */}
            <div className="flex items-center gap-2 border-b px-2 pb-2 text-xs font-semibold text-muted-foreground">
              <span className="w-7 shrink-0" />
              <span className="min-w-0 flex-1">Member</span>
              {BOARD_METRICS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMetricKey(m.key)}
                  className={cn(
                    "w-14 shrink-0 rounded-md py-1 text-center transition-colors",
                    metricKey === m.key
                      ? "bg-primary/10 font-bold text-primary"
                      : "hover:bg-muted hover:text-foreground"
                  )}
                  title={`Rank by ${m.label}`}
                >
                  {m.short}
                  <span className={cn("mx-auto mt-0.5 block h-0.5 w-4 rounded-full transition-all", metricKey === m.key ? "bg-primary" : "bg-transparent")} />
                </button>
              ))}
            </div>

            {/* animated rows */}
            <div ref={flipRef} className="pt-1">
              {ranked.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No members yet.</p>
              ) : (
                ranked.slice(0, 12).map((g, i) => {
                  const active = g[metricKey] as number;
                  return (
                    <div
                      key={g.key}
                      data-flip-key={g.key}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-2 text-sm",
                        i === 0 && active > 0 ? "bg-warning/10" : i % 2 ? "bg-muted/30" : ""
                      )}
                    >
                      <span className="w-7 shrink-0 text-center text-base">
                        {active > 0 && MEDALS[i] ? MEDALS[i] : <span className="text-xs text-muted-foreground">#{i + 1}</span>}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{g.label}</span>
                      {BOARD_METRICS.map((m) => {
                        const v = g[m.key] as number;
                        const isActive = m.key === metricKey;
                        return (
                          <span
                            key={m.key}
                            className={cn(
                              "w-14 shrink-0 text-center tabular-nums transition-colors",
                              isActive
                                ? "font-bold text-primary"
                                : v > 0
                                  ? "text-foreground"
                                  : "text-muted-foreground/50"
                            )}
                          >
                            {v}
                          </span>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCard({
  label, value, valueText, sub, tone, href,
}: {
  label: string; value?: number; valueText?: string; sub?: string;
  tone?: "warn" | "bad"; href?: string;
}) {
  const body = (
    <Card className="kpi-card h-full">
      <CardContent className="flex h-full flex-col px-4 py-3">
        <p className="kpi-label min-h-8 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "text-2xl font-bold leading-none xl:text-3xl",
            // toned values keep their warning/danger color; neutral ones light up blue
            !tone && "kpi-value",
            tone === "warn" && "text-warning",
            tone === "bad" && "text-destructive"
          )}
        >
          <CountUp value={value} text={valueText} />
        </p>
        {sub ? (
          <p className="mt-1.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground">
            {sub}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function DrillTable({ groups, colorKeys }: { groups: DrillGroup[]; colorKeys?: boolean }) {
  if (groups.length === 0)
    return <p className="py-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            <TableHead className="text-right">MR</TableHead>
            <TableHead className="text-right">Contacted</TableHead>
            <TableHead className="text-right">Visits</TableHead>
            <TableHead className="text-right">Visits done</TableHead>
            <TableHead className="text-right">Deals</TableHead>
            <TableHead className="text-right">Slots</TableHead>
            <TableHead className="text-right">Lead → Open</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const color = colorKeys ? FUNCTION_COLORS[g.key] : undefined;
            return (
              <TableRow key={g.key}>
                <TableCell className="font-medium">
                  {color ? (
                    <Badge className={cn("border-transparent font-semibold", color.bg, color.text)}>
                      {g.label}
                    </Badge>
                  ) : (
                    g.label
                  )}
                </TableCell>
                <TableCell className="text-right">{g.mr}</TableCell>
                <TableCell className="text-right">{g.contacted}</TableCell>
                <TableCell className="text-right">{g.visitScheduled}</TableCell>
                <TableCell className="text-right">{g.visitDone}</TableCell>
                <TableCell className="text-right">{g.deals}</TableCell>
                <TableCell className="text-right font-semibold">{g.slots}</TableCell>
                <TableCell className="text-right text-muted-foreground">{pct(g.dealAccounts, g.mr)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
