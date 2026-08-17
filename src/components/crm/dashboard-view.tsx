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
import { AskBlueMan } from "./ask-blue-man";
import { Hint } from "./hint";
import { CountUp } from "./count-up";
import { cn } from "@/lib/utils";
import { cairoToday, FUNCTION_COLORS } from "@/lib/types";
import type {
  DrillGroup, FunnelStats, LanePlan, OgxBoardRow, OgxDashboardData, OgxFunnel,
  StreakStats, TeamPlan,
} from "@/server/data";

export interface DashboardScopeView { key: string; label: string }

interface Props {
  /** the Consideration lanes (v29): IR calls (+ the IGT-only CV pool) — set
   *  only on ?fn=CONS_IGV / ?fn=CONS_IGT */
  consideration?: import("@/server/data").ConsiderationStats | null;
  /** the OGT/OGV sign-up lane (v28) — set only on ?fn=OGT / ?fn=OGV */
  ogx?: OgxDashboardData | null;
  /** the OGV contact streak (v27) — set only on ?fn=OGV, null when the viewer
   *  isn't a streak player */
  streak?: StreakStats | null;
  /** the TM lane (v33.17) — set only on ?fn=TM */
  tm?: import("@/server/tm-stats").TmStats | null;
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
  /** the B2C lane (v23): deals-centric — no opens/slots anywhere */
  isB2cLane: boolean;
  /** the B2C lane's CIC numbers (v33.29) — null off the lane */
  b2cCic?: import("@/server/data").B2cCicStats | null;
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

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function monthRange(): { from: string; to: string; label: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: isoDay(from),
    to: isoDay(to),
    label: now.toLocaleString("en", { month: "long", year: "numeric" }),
  };
}

/** The current SPRINT = half-month: day 1–15, or 16–end (v24). */
function sprintRange(): { from: string; to: string } {
  const now = new Date();
  const first = now.getDate() <= 15;
  const from = new Date(now.getFullYear(), now.getMonth(), first ? 1 : 16);
  const to = first
    ? new Date(now.getFullYear(), now.getMonth(), 15)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: isoDay(from), to: isoDay(to) };
}

export function DashboardView({
  consideration, ogx, streak, tm,
  total, byFunction, byTeam, memberBoard, mmBoard, teamBoard,
  views, activeFn, laneLabel, scopeLabel,
  showTeamDrill, teamOptions, memberOptions, filters, viewerId, showMyNumbers,
  isB2cLane, b2cCic, lanePlan, teamPlan, teamLabel,
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

  // KPIs, in the LC's order — conversions between consecutive steps live below.
  // B2C (v23) is deals-centric: no opens/slots exist there at all.
  //
  // THE HINT SAYS WHICH DATE THE NUMBER IS COUNTED ON (v33.49). With a range
  // set, each of these is judged on its OWN date — the account's birthday, the
  // contact's timestamp, the day the visit was booked, the day it was held,
  // the day the deal was signed — so the hint has to say which, or the next
  // person to compare two cards is right back where this started.
  const dated = !!(filters.from || filters.to);
  const kpis = [
    {
      label: "Market Research",
      value: total.mr,
      hint: dated ? "accounts ADDED in this range" : "total accounts in the system",
    },
    {
      label: "Contacted",
      value: total.contacted,
      hint: dated ? "accounts contacted IN this range" : "accounts with ≥1 contact",
    },
    {
      label: "Visits",
      value: total.visitScheduled,
      hint: dated ? "accounts whose visit was BOOKED in this range" : "visits scheduled",
    },
    {
      label: "Visits done",
      value: total.visitDone,
      hint: dated ? "visits HELD in this range" : "confirmed visits",
    },
    {
      label: "Deals",
      value: total.deals,
      hint: dated
        ? "deals SIGNED in this range"
        : "deals signed (accounts can close many)",
    },
    ...(isB2cLane
      ? []
      : [
          {
            label: "Slots raised",
            value: total.slots,
            hint: dated ? "opens from deals signed in this range" : "total slots/opens",
          },
        ]),
  ];
  const conversions = [
    { label: "MR → Contacted", value: pct(total.contacted, total.mr) },
    { label: "Contacted → Visits", value: pct(total.visitScheduled, total.contacted) },
    { label: "Visits → Done", value: pct(total.visitDone, total.visitScheduled) },
    { label: "Visit Done → Deal", value: pct(total.dealAccounts, total.visitDone) },
  ];
  const month = monthRange();
  const sprint = sprintRange();
  const today = cairoToday();
  const thisMonthActive = filters.from === month.from && filters.to === month.to;
  const thisSprintActive = filters.from === sprint.from && filters.to === sprint.to;
  const myNumbersActive = filters.member === viewerId;
  const anyFilter = Object.values(filters).some(Boolean);
  // OGX pseudo-lanes (v28): same filter bar, sign-up funnel instead of accounts
  const isOgxLane = activeFn === "OGT" || activeFn === "OGV";
  // Consideration lanes (v33.32): same bar again, IR calls instead of accounts
  const isConsLane = activeFn.startsWith("CONS");
  const noun = isConsLane ? "IR calls" : isOgxLane ? "sign-ups" : "accounts";
  /** which DATE the range filters on — each lane has its own. A raising lane
   *  no longer has ONE: every KPI is counted on its own date (v33.49), so the
   *  label stopped saying "Added" — which is true of Market Research and of
   *  nothing else on the row. */
  const dateLabel = isConsLane ? "Called" : isOgxLane ? "Signed up" : "Worked";
  // a call can legitimately be in the FUTURE, so the consideration lane is the
  // one place the date inputs must not be clamped to today
  const dateMax = isConsLane ? undefined : today;

  return (
    <div className={cn("mx-auto max-w-6xl space-y-5", navPending && "nav-pending")}>
      <div className="flex flex-wrap items-center justify-between gap-3 rise-in">
        <div>
          <h1 className="text-2xl font-bold">
            {laneLabel} Dashboard{" "}
            {navPending ? <Loader2 className="ml-1 inline size-4 animate-spin text-primary" /> : null}
          </h1>
          <AskBlueMan
            className="mt-1.5"
            hint="Ask The Blue Man about your numbers"
            prefill="How is my funnel doing this month? "
          />
        </div>
        {views.length > 1 ? (
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {views.map((v) => (
              <button
                key={v.key}
                onClick={() =>
                  go((p) => {
                    // ICX member/team ids mean nothing on OGX lanes (and vice
                    // versa) — stale params would silently zero the dashboard
                    const isOgx = (k: string) => k === "OGT" || k === "OGV";
                    if (isOgx(v.key) !== isOgx(activeFn)) {
                      p.delete("team");
                      p.delete("member");
                    }
                    if (v.key === views[0].key) p.delete("fn");
                    else p.set("fn", v.key);
                  })
                }
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

      {activeFn === "TM" && tm ? (
        <TmPanel stats={tm} />
      ) : (
        <>
      {/* Filter bar — THE CONSIDERATION LANES GET IT TOO (v33.32). They were
          the one place that returned a whole-history snapshot and ignored
          Added→ / team / member, so a leader could not ask "what did we do
          this sprint" of the IR floor at all. */}
      <div className="flex flex-wrap items-center gap-2 rise-in rise-in-1">
        <Hint label={`Show only this calendar month's ${noun}`}>
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
        <Hint label={`Only this sprint's ${noun} — the current half of the month (1–15 / 16–end)`}>
          <Button
            variant={thisSprintActive ? "default" : "outline"}
            className="h-9"
            size="sm"
            onClick={() =>
              go((p) => {
                if (thisSprintActive) { p.delete("from"); p.delete("to"); }
                else { p.set("from", sprint.from); p.set("to", sprint.to); }
              })
            }
          >
            <CalendarRange className="size-4" /> This sprint
          </Button>
        </Hint>
        {showMyNumbers ? (
          <Hint label={`Track your own KPIs & MOS — every number counts only the ${noun} assigned to you`}>
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
          <span className="hidden text-xs font-medium text-muted-foreground min-[400px]:inline">
            {dateLabel}
          </span>
          <Input
            type="date"
            max={dateMax}
            className="h-7 w-[7.6rem] min-[400px]:w-[8.2rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label={`${dateLabel} from`}
            value={filters.from}
            onChange={(e) => setParam("from", e.target.value)}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            max={dateMax}
            className="h-7 w-[7.6rem] min-[400px]:w-[8.2rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label={`${dateLabel} to`}
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

      {isConsLane ? (
        consideration ? <ConsiderationPanel stats={consideration} /> : null
      ) : isOgxLane && ogx ? (
        <OgxPanel data={ogx} streak={streak ?? null} />
      ) : (
        <>
      {/* Goals = the plans (v22): the lane goal comes from the VPs' planning
          sheet, the team goal from the TL's filed plan — nothing is set here. */}
      {lanePlan ? <PlanCard plan={lanePlan} /> : null}
      {isB2cLane && b2cCic ? <B2cCicCard stats={b2cCic} /> : null}
      {teamPlan ? (
        <TeamPlanCard plan={teamPlan} teamLabel={teamLabel} isOwnPlan={teamPlan.teamLeaderId === viewerId} />
      ) : null}

      {/* KPI row — MR · Contacted · Visits · Visits done · Deals · Slots · Lead→Deal */}
      <div
        className={cn(
          "stagger grid grid-cols-2 gap-3 sm:grid-cols-3",
          isB2cLane ? "lg:grid-cols-6" : "lg:grid-cols-7"
        )}
      >
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} sub={k.hint} />
        ))}
        <KpiCard
          label={isB2cLane ? "Lead → Deal" : "Lead → Open"}
          valueText={pct(total.dealAccounts, total.mr)}
          sub={isB2cLane ? "accounts that signed a deal" : "accounts that raised opens"}
        />
      </div>

      {/* v33.50 — the paragraph that used to explain the per-KPI dates here is
          gone by request. The explanation lives where it doesn't cost the row
          any height: each KPI card's own hint names the date it counts, and
          the Help centre's "Read the dashboard" spells the whole rule out. */}

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
          <Leaderboard title={`${laneLabel} — Members`} groups={memberBoard} dealsOnly={isB2cLane} />
        ) : null}
        {mmBoard.length > 0 ? (
          <Leaderboard title={`${laneLabel} — MMs`} groups={mmBoard} dealsOnly={isB2cLane} />
        ) : null}
        {teamBoard.length > 1 ? (
          <Leaderboard
            title={`${teamLabel ?? "Team"} leaderboard`}
            groups={teamBoard}
            dealsOnly={isB2cLane}
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
            {/* "By MM" opens by default (v33.17) — who's carrying the lane is
              the first thing a leader looks for; products are one tap away */}
          <Tabs defaultValue={showTeamDrill ? "team" : "function"}>
              <TabsList className="flex-wrap">
                {byFunction.length > 1 ? <TabsTrigger value="function">By product</TabsTrigger> : null}
                {showTeamDrill ? <TabsTrigger value="team">By MM</TabsTrigger> : null}
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
        </>
      )}

        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

/** The viewer's TEAM goal (v22): the Team Leader's filed opens plan for the
 *  current month vs what the team actually raised. Nothing is set here — the
 *  TL files/updates the plan from their profile. */
/** A Consideration lane (v29 — one per product): the IR-call pulse for that
 *  function, plus the CV pool on the IGT lane only (the pool is an IGT hunt,
 *  so the IGV lane omits those cards rather than showing zeros). */
/** THE TM LANE (v33.17): does the LC show up, record itself, plan, and
 *  deliver. Self-contained like ConsiderationPanel — it replaces the account
 *  body entirely on ?fn=TM. */
// literal classes so Tailwind's scanner sees them (never built at runtime)
const TM_FN_BAR: Record<string, string> = {
  IGV: "bg-gv", OGV: "bg-gv", IGT: "bg-gt", OGT: "bg-gt", IGTa: "bg-gt",
  IGTe: "bg-gte", B2B: "bg-primary", BD: "bg-chart-4", B2C: "bg-chart-2",
};

function TmPanel({ stats }: { stats: import("@/server/tm-stats").TmStats }) {
  const kpi = (label: string, value: string | number, sub?: string) => {
    const card = (
      <Card className="kpi-card rise-in h-full" title={sub}>
        <CardContent className="flex h-full flex-col justify-between gap-2 px-4 py-3.5">
          <p className="kpi-label break-words text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="kpi-value text-3xl font-black leading-none tabular-nums xl:text-4xl">
            {typeof value === "number" ? value.toLocaleString("en") : value}
          </p>
        </CardContent>
      </Card>
    );
    return sub ? <Hint label={sub}>{card}</Hint> : card;
  };
  const a = stats.attendance;
  const p = stats.plans;
  // the drill-down cap: past ~40 names this stops being a list and starts
  // being a database — the rest is one tap away in Attendance
  const MEMBER_ROWS = 40;
  const rateTone = (r: number) =>
    r < 50 ? "text-destructive" : r < 75 ? "text-warning" : "text-success";
  /** one horizontal bar row: label · fill · rate over records/people */
  const rateRow = (
    key: string, label: string, rate: number,
    records: number, people: number, barClass: string
  ) => (
    <div
      key={key}
      className="flex items-center gap-2"
      title={`${rate}% showed up · ${records} attendance record${records === 1 ? "" : "s"} · ${people} ${people === 1 ? "person" : "people"}`}
    >
      <span className="w-24 shrink-0 truncate font-semibold">{label}</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", barClass)} style={{ width: `${rate}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums">
        <span className="font-semibold">{rate}%</span>
        <span className="block text-[10px] text-muted-foreground">
          {records} · {people} ppl
        </span>
      </span>
    </div>
  );
  const bar = (planned: number, actual: number) => {
    const w = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : actual > 0 ? 100 : 0;
    return (
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
      </div>
    );
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rise-in rise-in-1 lg:grid-cols-4">
        {kpi("Attendance rate", `${a.rate}%`, `Showed up (attended + late) across every confirmed touch point, ${stats.windowLabel}`)}
        {kpi("Sessions held", a.sessions, `Touch points with confirmed attendance, ${stats.windowLabel}`)}
        {kpi("Awaiting record", a.owed, "Past touch points whose attendance nobody confirmed yet — the chase list")}
        {kpi("Active members", stats.membersActive, "Everyone currently on the membership")}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rise-in rise-in-2">
          <CardHeader><CardTitle className="text-base">Attendance — {stats.windowLabel}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="border-success/50 text-success">✓ {a.attended} attended</Badge>
              <Badge variant="outline" className="border-warning/50 text-warning">⏰ {a.late} late</Badge>
              <Badge variant="outline" className="border-destructive/50 text-destructive">✗ {a.absent} absent</Badge>
              <Badge variant="outline">🙏 {a.excused} excused</Badge>
              {a.cancelled > 0 ? <Badge variant="outline">🚫 {a.cancelled} cancelled</Badge> : null}
            </div>
            {a.byKind.length > 0 ? (
              <div className="space-y-1.5">
                {a.byKind.map((k) => (
                  <div key={k.kind} className="flex items-center justify-between gap-2">
                    <span className="capitalize text-muted-foreground">
                      {k.kind.replace("_", " ")} · {k.sessions} session{k.sessions === 1 ? "" : "s"}
                    </span>
                    <span className="font-semibold tabular-nums">{k.rate}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No confirmed sessions in the window yet.</p>
            )}
            {a.lowMembers.length > 0 ? (
              <div className="border-t pt-2">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Weakest showing (≥3 records)
                </p>
                {a.lowMembers.map((m) => (
                  <div key={m.name} className="flex items-center justify-between gap-2 text-xs">
                    <span dir="auto">{m.name}</span>
                    <span className="tabular-nums text-muted-foreground">{m.rate}% of {m.records}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* THE DRILL-DOWN (v33.18): the same attendance rows cut three ways —
          function, role level, person. "By function" opens by default (the
          shape of the LC); "By member" is the chase list, worst rate first. */}
        <Card className="rise-in rise-in-2">
          <CardHeader><CardTitle className="text-base">Attendance drill-down</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <Tabs defaultValue="function">
              <TabsList className="flex-wrap">
                <TabsTrigger value="function">By function</TabsTrigger>
                <TabsTrigger value="role">By role</TabsTrigger>
                <TabsTrigger value="member">By member</TabsTrigger>
              </TabsList>

              <TabsContent value="function" className="space-y-1.5">
                {a.byFunction.length === 0 ? (
                  <p className="text-muted-foreground">Nothing recorded in the window yet.</p>
                ) : (
                  a.byFunction.map((f) =>
                    rateRow(f.fn, f.fn, f.rate, f.records, f.people, TM_FN_BAR[f.fn] ?? "bg-primary")
                  )
                )}
                <p className="pt-1 text-xs text-muted-foreground">
                  A member counts in each of their functions; working hours never judge TM/F&L/CXP.
                </p>
              </TabsContent>

              <TabsContent value="role" className="space-y-1.5">
                {a.byRole.length === 0 ? (
                  <p className="text-muted-foreground">Nothing recorded in the window yet.</p>
                ) : (
                  a.byRole.map((r) => rateRow(r.role, r.role, r.rate, r.records, r.people, "bg-primary"))
                )}
                <p className="pt-1 text-xs text-muted-foreground">
                  Every attendance record grouped by the member&apos;s role, top of
                  the LC down.
                </p>
              </TabsContent>

              <TabsContent value="member" className="space-y-2">
                {a.byMember.length === 0 ? (
                  <p className="text-muted-foreground">Nothing recorded in the window yet.</p>
                ) : (
                  <>
                    <div className="-mx-2 overflow-x-auto px-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Member</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Functions</TableHead>
                            <TableHead className="text-right">Rate</TableHead>
                            <TableHead className="text-right">Records</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {a.byMember.slice(0, MEMBER_ROWS).map((m) => (
                            <TableRow key={m.id}>
                              <TableCell className="font-medium" dir="auto">{m.name}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {m.role}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {m.fns || "—"}
                              </TableCell>
                              <TableCell
                                className={cn("text-right font-semibold tabular-nums", rateTone(m.rate))}
                              >
                                {m.rate}%
                              </TableCell>
                              <TableCell
                                className="text-right tabular-nums text-muted-foreground"
                                title={`${m.attended} attended · ${m.late} late · ${m.absent} absent`}
                              >
                                {m.records}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {a.byMember.length > MEMBER_ROWS ? (
                      <p className="text-xs text-muted-foreground">
                        +{a.byMember.length - MEMBER_ROWS} more —{" "}
                        <Link href="/attendance" className="font-medium text-primary hover:underline">
                          the full record lives in Attendance
                        </Link>
                        .
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Worst rate first. Hover a record count for the
                      attended/late/absent split.
                    </p>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="rise-in rise-in-3">
          <CardHeader><CardTitle className="text-base">Plans — {stats.monthLabel}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="flex items-center justify-between">
                <span>MM plans filed (consideration/OGX)</span>
                <span className="font-semibold tabular-nums">{p.mmFiled}/{p.mmTotal}</span>
              </div>
              {p.mmMissing.length > 0 ? (
                <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                  Missing: {p.mmMissing.join(", ")}
                </p>
              ) : null}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span>Raising MM plans filed (opens)</span>
                <span className="font-semibold tabular-nums">{p.tlFiled}/{p.tlTotal}</span>
              </div>
              {p.tlMissing.length > 0 ? (
                <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                  Missing: {p.tlMissing.join(", ")}
                </p>
              ) : null}
            </div>
            <div className="border-t pt-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                VP planning sheet (this month&apos;s cells)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {p.vpLanes.map((l) => (
                  <Badge
                    key={l.fn}
                    variant="outline"
                    className={l.filed ? "border-success/50 text-success" : "border-muted-foreground/40 text-muted-foreground"}
                  >
                    {l.filed ? "✓" : "—"} {l.fn}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rise-in rise-in-3">
          <CardHeader><CardTitle className="text-base">Plan vs delivered — {stats.monthLabel}</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {stats.goals.length === 0 ? (
              <p className="text-muted-foreground">
                No plan cells for this month yet — they appear once the VP
                planning lands.
              </p>
            ) : (
              stats.goals.map((g) => (
                <div key={g.fn} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{g.fn}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {g.actual.toLocaleString("en")} / {g.planned.toLocaleString("en")} {g.unit}
                    </span>
                  </div>
                  {bar(g.planned, g.actual)}
                </div>
              ))
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              OGX approvals are approximate (status set this month) — the status
              carries no date of its own.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** THE B2C CIC CARD (v33.29) — the selling side's read on the sign-up pool:
 *  calls handed out, made, interested, this month, per member. Lives on the
 *  B2C lane only. */
function B2cCicCard({ stats }: { stats: import("@/server/data").B2cCicStats }) {
  const chip = (label: string, value: number) => (
    <span className="rounded-full border bg-muted px-2.5 py-1 text-xs font-medium">
      {label} <b className="tabular-nums">{value}</b>
    </span>
  );
  return (
    <Card className="rise-in">
      <CardContent className="pt-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          📞 B2C CIC — selling calls into the OGX sign-up pool
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chip("Handed out", stats.assigned)}
          {chip("Called", stats.called)}
          {chip("Interested", stats.interestedYes)}
          {chip("Open now", stats.openNow)}
          {chip("This month", stats.thisMonth)}
        </div>
        {stats.byMember.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Caller</th>
                  <th className="py-1 pr-2 text-right font-medium">Handed</th>
                  <th className="py-1 pr-2 text-right font-medium">Called</th>
                  <th className="py-1 text-right font-medium">Interested</th>
                </tr>
              </thead>
              <tbody>
                {stats.byMember.map((m) => (
                  <tr key={m.name} className="border-t">
                    <td className="max-w-40 truncate py-1.5 pr-2" dir="auto">{m.name}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{m.assigned}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{m.called}</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{m.interested}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing handed out yet — the B2C CIC queue lives on the Sign-ups tab.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ConsiderationPanel({ stats }: { stats: import("@/server/data").ConsiderationStats }) {
  // same shape as KpiCard (v30.1): name + number only, the explainer moved into
  // the hover hint — a 2-up phone grid never clips the number
  const kpi = (label: string, value: number, sub?: string, suffix?: string) => {
    const card = (
      <Card className="kpi-card rise-in h-full" title={sub}>
        <CardContent className="flex h-full flex-col justify-between gap-2 px-4 py-3.5">
          <p className="kpi-label break-words text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="kpi-value text-3xl font-black leading-none tabular-nums xl:text-4xl">
            {value.toLocaleString("en")}
            {suffix ? <span className="text-xl font-bold">{suffix}</span> : null}
          </p>
        </CardContent>
      </Card>
    );
    return sub ? <Hint label={sub}>{card}</Hint> : card;
  };
  const delta =
    stats.irLastMonth == null ? null : stats.irThisMonth - stats.irLastMonth;
  const maxMonth = Math.max(1, ...stats.byMonth.map((m) => m.calls));
  return (
    <div className="space-y-4">
      {stats.filtered ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Filtered — every number below counts only the calls the filter bar
          left in. Clear it to see the whole floor.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpi("IR calls — total", stats.irTotal, "Every recorded + booked call (cancelled excluded)")}
        {kpi(
          "Calls this month",
          stats.irThisMonth,
          // there is no "last month" in the first month of a peak — the
          // previous month belongs to the last term (v33.32.2)
          stats.irLastMonth == null || delta == null
            ? `The first month of ${stats.peakLabel} — nothing before it to compare with`
            : `${stats.irLastMonth} last month${delta !== 0 ? ` (${delta > 0 ? "+" : ""}${delta})` : ""}`
        )}
        {kpi("Upcoming booked calls", stats.irUpcoming, "Booked, still ahead of us")}
        {kpi("Calls completed", stats.irCompleted, "Booked or recorded calls that actually happened")}
        {stats.irOverdue > 0
          ? kpi(
              "Waiting to be reported",
              stats.irOverdue,
              "Booked, the time has passed, and nobody has said what happened — open the call and record it, or cancel it"
            )
          : null}
        {kpi("Partner LCs reached", stats.partnerLcsContacted, `${stats.newLcsThisMonth} reached for the first time this month`)}
        {kpi(
          "🤝 Partnerships",
          stats.partnerships.total,
          `New LCs partnered with (WhatsApp group open) — ${stats.partnerships.thisMonth} made this month${stats.partnerships.pending > 0 ? ` · ${stats.partnerships.pending} target${stats.partnerships.pending === 1 ? "" : "s"} still pending` : ""}`
        )}
        {kpi(
          "Partnerships this month",
          stats.partnerships.thisMonth,
          "Partnerships whose date falls in this month"
        )}
        {kpi("New LCs this month", stats.newLcsThisMonth, "Partner LCs whose first-ever call was this month")}
        {stats.completionRate != null
          ? kpi(
              "Booked → happened",
              stats.completionRate,
              `${stats.irCompleted} completed vs ${stats.irCancelled} cancelled — % of settled calls that happened`,
              "%"
            )
          : null}
        {stats.showCvs
          ? kpi("CVs in the pool", stats.cvTotal, `${stats.cvThisMonth} this month`)
          : null}
      </div>
      {/* the last 6 months at a glance */}
      <Card className="rise-in">
        <CardContent className="pt-4">
          <p className="text-xs font-medium text-muted-foreground">
            Calls per month — {stats.peakLabel} so far
          </p>
          <div className="mt-3 flex items-end gap-2">
            {stats.byMonth.map((m) => (
              <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="text-xs font-bold tabular-nums">{m.calls}</span>
                <div
                  className="w-full max-w-10 rounded-t bg-primary/70 transition-all"
                  style={{ height: `${Math.max(4, (m.calls / maxMonth) * 72)}px` }}
                />
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {/* who is making the calls */}
      {stats.byMember.length > 0 ? (
        <Card className="rise-in rise-in-1">
          <CardContent className="pt-4">
            <p className="text-xs font-medium text-muted-foreground">
              🏅 Consideration leaderboard — ranked by calls done
            </p>
            {/* THE COLUMNS ADD UP NOW (v33.32). It used to read
                "This month · Upcoming · Total" — three numbers that look like
                a sum and aren't: an upcoming call is already inside both the
                month and the total, so 4 this month + 1 upcoming showed a
                total of 4 and read as broken. Done + Upcoming + Waiting IS
                the total; "this month" is a slice, and says so. */}
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Done + Upcoming + Waiting = Total. &quot;This month&quot; is a slice
              of the same calls, not another bucket. Cancelled calls are in none
              of them.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Member</th>
                    <th className="py-1 pr-2 text-right font-medium" title="Calls that happened">
                      Done
                    </th>
                    <th className="py-1 pr-2 text-right font-medium" title="Booked, still ahead">
                      Upcoming
                    </th>
                    <th
                      className="py-1 pr-2 text-right font-medium"
                      title="The slot has passed and nobody reported what happened"
                    >
                      Waiting
                    </th>
                    <th className="py-1 pr-2 text-right font-medium" title="Of the calls in this snapshot, how many fall in this month">
                      This month
                    </th>
                    <th className="py-1 pr-2 text-right font-medium" title="Every call they hold — done, upcoming and waiting together">
                      Total
                    </th>
                    {/* THE REST OF THE JOB (v33.52) — a caller is not measured
                        on calls alone: the LCs they reach, the partnerships
                        they open and (on IGT) the CVs they bring back are the
                        same person's KPIs, and this floor had no ranking on
                        any of them. */}
                    <th className="py-1 pr-2 text-right font-medium" title="Distinct partner LCs they have actually spoken to">
                      LCs
                    </th>
                    <th className="py-1 pr-2 text-right font-medium" title="New partnerships they made in this lane">
                      🤝
                    </th>
                    {stats.showCvs ? (
                      <th className="py-1 text-right font-medium" title="CVs they put in the shared pool">
                        CVs
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {stats.byMember.map((m) => (
                    <tr key={m.name} className="border-t">
                      <td className="max-w-40 truncate py-1.5 pr-2" dir="auto">
                        <span className="mr-1.5 text-xs text-muted-foreground tabular-nums">
                          {stats.byMember.indexOf(m) + 1}.
                        </span>
                        {m.name}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{m.done}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{m.upcoming}</td>
                      <td
                        className={cn(
                          "py-1.5 pr-2 text-right tabular-nums",
                          m.overdue > 0 ? "font-semibold text-amber-600 dark:text-amber-400" : ""
                        )}
                      >
                        {m.overdue}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                        {m.month}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{m.total}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{m.lcs}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{m.partnerships}</td>
                      {stats.showCvs ? (
                        <td className="py-1.5 text-right tabular-nums">{m.cvs}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {/* 🤝 who is making the partnerships (v33.38) — the member's KPI */}
      {stats.partnerships.byMember.length > 0 ? (
        <Card className="rise-in rise-in-1">
          <CardContent className="pt-4">
            <p className="text-xs font-medium text-muted-foreground">
              🤝 Partnerships by member
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stats.partnerships.byMember.map((m) => (
                <span
                  key={m.name}
                  className="rounded-full border bg-muted px-2.5 py-1 text-xs font-medium"
                  title={`${m.month} this month`}
                >
                  {m.name} <b>{m.total}</b>
                  {m.month > 0 ? (
                    <span className="text-muted-foreground"> · {m.month} this month</span>
                  ) : null}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {stats.plan ? (
        <Card className="rise-in rise-in-1">
          <CardContent className="pt-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Target className="size-3.5" /> Consideration plan — this month
            </p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <span><b>{stats.plan.applicants}</b> applicants planned</span>
              <span><b>{stats.plan.accepted}</b> accepted planned</span>
              <span><b>{stats.plan.approvals}</b> approvals planned 🏆</span>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {stats.showCvs && stats.cvByIndustry.length > 0 ? (
        <Card className="rise-in rise-in-2">
          <CardContent className="pt-4">
            <p className="text-xs font-medium text-muted-foreground">CV pool by industry</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stats.cvByIndustry.map((i) => (
                <span
                  key={i.industry}
                  className="rounded-full border bg-muted px-2.5 py-1 text-xs font-medium"
                >
                  {i.industry} <b>{i.count}</b>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {stats.fn} numbers — calls are attributed through the caller&apos;s
        function (the crew&apos;s own calls market both). The full log lives in
        the{" "}
        <Link href="/consideration" className="font-medium text-primary hover:underline">
          Consideration module
        </Link>
        {stats.showCvs ? " — calls, screenshots and the searchable CV pool." : " — calls and screenshots."}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ OGX (v28)

/** OGX leaderboard metrics, in funnel order — Approvals (the MOS) is the
 *  default sort. */
const OGX_METRICS: { key: keyof OgxFunnel; label: string; short: string }[] = [
  { key: "signups", label: "Sign-ups", short: "SUs" },
  { key: "contacted", label: "Contacted", short: "Cont." },
  { key: "interested", label: "Interested", short: "Int." },
  { key: "applied", label: "Applied", short: "Appl." },
  { key: "accepted", label: "Accepted", short: "Acc." },
  { key: "approved", label: "Approvals", short: "Appr." },
];

/** The OGT/OGV lane (v28): the sign-up funnel — Sign-ups → Contacted →
 *  Interested → Applied → Accepted → Approved (the MOS), with the fn's MM
 *  plans, a Members & Coordinators leaderboard and a per-team drill. */
function OgxPanel({ data, streak }: { data: OgxDashboardData; streak: StreakStats | null }) {
  const t = data.total;
  const kpis = [
    {
      label: "Sign-ups",
      value: t.signups,
      hint: data.referrals
        ? `everyone who signed up — ${data.referrals} of them organic referrals`
        : "everyone who signed up",
    },
    { label: "Contacted", value: t.contacted, hint: "sign-ups marked Contacted" },
    { label: "Interested", value: t.interested, hint: "said Yes to interest" },
    { label: "Applied", value: t.applied, hint: "applied — or further down the funnel" },
    { label: "Accepted", value: t.accepted, hint: "accepted — or already approved" },
    { label: "Approved", value: t.approved, hint: "the OGX MOS 🏆" },
  ];
  const conversions = [
    { label: "Sign-ups → Contacted", value: pct(t.contacted, t.signups) },
    { label: "Contacted → Interested", value: pct(t.interested, t.contacted) },
    { label: "Interested → Applied", value: pct(t.applied, t.interested) },
    { label: "Applied → Accepted", value: pct(t.accepted, t.applied) },
    { label: "Accepted → Approved", value: pct(t.approved, t.accepted) },
  ];
  return (
    <>
      {/* the OGV streak sits at the TOP of the lane — it's the daily habit the
          whole crew (members, coordinators, TLs and their VP) plays */}
      {streak ? <DashboardStreakCard streak={streak} /> : null}

      {/* THE FUNCTION'S GOAL FROM THE PLANNING SHEET (v33.52) — this is the
          VPs' own plan, and until now no OGX lane ever showed it even though
          the numbers have been imported since v21. It renders whether or not
          any MM has filed, which is what "the goal isn't appearing" was. */}
      {data.lanePlan ? <OgxLanePlan fn={data.fn} plan={data.lanePlan} /> : null}
      {data.plan ? <OgxPlanBar fn={data.fn} plan={data.plan} /> : null}
      {data.needsOwnPlan ? (
        <Card className="rise-in rise-in-2 border-amber-500/50 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <p className="text-sm">
              🎯 <b>You haven&apos;t filed this month&apos;s plan.</b> Your
              applicants · accepted · approvals for {data.fn} are your goals for
              the period — file them and they show up here.
            </p>
            <Button variant="outline" asChild>
              <Link href="/profile">Open my plan</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* KPI row — the sign-up funnel, in order */}
      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} sub={k.hint} />
        ))}
      </div>

      {/* step-to-step conversion strip */}
      <Card className="rise-in rise-in-2">
        <CardContent className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-3 lg:grid-cols-5">
          {conversions.map((c) => (
            <div key={c.label} className="text-center">
              <p className="text-xl font-bold text-primary">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* TWO BOARDS (v33.13) — members and MMs do different jobs, and ranking
          them on one list flattered neither */}
      <div className="grid gap-4 rise-in rise-in-3">
        <OgxLeaderboard title={`${data.fn} — Members`} groups={data.board} />
        {data.mmBoard.length > 0 ? (
          <OgxLeaderboard
            title={`${data.fn} — MMs (Team Leaders & Coordinators)`}
            groups={data.mmBoard}
          />
        ) : null}
      </div>

      {data.byTeam.length > 0 ? (
        <Card className="rise-in rise-in-4">
          <CardHeader>
            <CardTitle className="text-base">By team</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="-mx-2 overflow-x-auto px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    {OGX_METRICS.map((m) => (
                      <TableHead key={m.key} className="text-right">{m.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byTeam.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-medium">{g.label}</TableCell>
                      {OGX_METRICS.map((m) => (
                        <TableCell
                          key={m.key}
                          className={cn(
                            "text-right",
                            m.key === "approved" && "font-semibold"
                          )}
                        >
                          {g[m.key]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

/** The OGV contact-streak game (v27) — ≥1 sign-up contact action per Cairo day
 *  keeps the flame alive. It was only on /signups; it belongs here too, on the
 *  OGV lane, for every OGV person: members, coordinators, TLs and the VP.
 *  The flame is dimmed until today's save lands. */
function DashboardStreakCard({ streak }: { streak: StreakStats }) {
  const dayWord = (n: number) => `day${n === 1 ? "" : "s"}`;
  return (
    <Card className="rise-in rise-in-1 border-orange-400/40">
      <CardContent className="space-y-2.5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "text-4xl leading-none transition-all",
              !streak.savedToday && "opacity-40 grayscale"
            )}
          >
            🔥
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold tabular-nums">
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
                ? "Streak saved for today ✅"
                : "Save today's streak — contact a sign-up!"}
            </p>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            Best:{" "}
            <span className="font-semibold tabular-nums text-foreground">{streak.best}</span>{" "}
            {dayWord(streak.best)}
          </p>
          {!streak.savedToday ? (
            <Button size="sm" variant="outline" asChild className="shrink-0">
              <Link href="/signups">Go contact one</Link>
            </Button>
          ) : null}
        </div>
        {streak.topStreaks.length > 0 ? (
          <div className="border-t pt-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              LC top streaks
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {streak.topStreaks.map((t, i) => (
                <p
                  key={`${t.name}-${i}`}
                  className={cn("text-sm", !t.savedToday && "opacity-60")}
                  title={t.savedToday ? undefined : "Alive, but not saved today — dies at midnight"}
                >
                  {MEDALS[i] ?? "•"} {t.name}
                  <span className="text-muted-foreground">
                    {" "}
                    — {t.current} {dayWord(t.current)}
                    {t.savedToday ? "" : " ⏳"}
                  </span>
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** THE VPs' PLAN FOR THIS OGX LANE (v33.52) — straight off the planning
 *  sheet's own cells (OGV / OGTa+OGTe), this sprint and this month. It is the
 *  function's official goal, and it is shown to everyone on the lane: an MM
 *  reading it knows what the function committed to, which is the number their
 *  own plan has to add up to. */
function OgxLanePlan({
  fn, plan,
}: {
  fn: string;
  plan: NonNullable<OgxDashboardData["lanePlan"]>;
}) {
  const trio = (t: { applicants: number; accepted: number; approvals: number }) => (
    <span className="flex flex-wrap gap-x-4 gap-y-0.5">
      <span>Applicants <b className="text-foreground">{t.applicants}</b></span>
      <span>Accepted <b className="text-foreground">{t.accepted}</b></span>
      <span>Approvals <b className="text-foreground">{t.approvals}</b> 🏆</span>
    </span>
  );
  return (
    <Card className="rise-in rise-in-2">
      <CardContent className="space-y-2 pt-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Target className="size-3.5" /> {fn} goal · the VPs&apos; planning sheet
        </p>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="rounded-lg border p-2.5">
            <p className="mb-1 font-semibold text-foreground">{plan.sprintLabel}</p>
            {trio(plan.sprint)}
          </div>
          <div className="rounded-lg border p-2.5">
            <p className="mb-1 font-semibold text-foreground">{plan.monthLabel}</p>
            {trio(plan.month)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** The fn's plan (mm_plans totals for the current month) vs the LIVE
 *  pipeline — Approvals (the MOS) carry the bar. */
function OgxPlanBar({
  fn, plan,
}: {
  fn: string;
  plan: NonNullable<OgxDashboardData["plan"]>;
}) {
  const progress =
    plan.plan.approvals > 0
      ? Math.min(1, plan.actual.approvals / plan.plan.approvals)
      : plan.actual.approvals > 0
        ? 1
        : 0;
  return (
    <Card className="relative overflow-hidden rise-in rise-in-2">
      <CardContent className="pt-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Target className="size-3.5" /> {fn} plan · {plan.monthLabel}
        </p>
        <p className="mt-1 text-2xl font-bold">
          {plan.actual.approvals.toLocaleString("en")}
          <span className="text-base font-semibold text-muted-foreground">
            {" "}/ {plan.plan.approvals.toLocaleString("en")} approvals planned
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
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            Applicants: <b className="text-foreground">{plan.actual.applicants}</b>
            {" "}/ {plan.plan.applicants}
          </span>
          <span>
            Accepted: <b className="text-foreground">{plan.actual.accepted}</b>
            {" "}/ {plan.plan.accepted}
          </span>
          <span className="text-muted-foreground/60">
            — the {fn} MMs&apos; filed plans vs the live pipeline
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/** ONE wide OGX board: every funnel number per member, click a KPI header to
 *  re-rank (FLIP glide). Members & Coordinators only, default Approvals. */
function OgxLeaderboard({
  title, groups,
}: {
  title: string;
  groups: OgxBoardRow[];
}) {
  const [metricKey, setMetricKey] = useState<keyof OgxFunnel>("approved");
  // same rule as the raising board: ties fall back right to left along the
  // funnel, so the person deeper down the pipeline ranks higher
  const ogxTieBreak = [...OGX_METRICS]
    .reverse()
    .map((m) => m.key)
    .filter((k) => k !== metricKey);
  const ranked = [...groups].sort((a, b) => {
    const first = b[metricKey] - a[metricKey];
    if (first) return first;
    for (const k of ogxTieBreak) {
      const d = b[k] - a[k];
      if (d) return d;
    }
    return a.label.localeCompare(b.label);
  });
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
        {/* phones: compact board — metric chips + rank/name/value */}
        <div className="md:hidden">
          <div className="mb-2 flex flex-wrap gap-1">
            {OGX_METRICS.map((m) => (
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
                const active = g[metricKey];
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
                      {OGX_METRICS.find((m) => m.key === metricKey)?.label}
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
            <div className="flex items-center gap-2 border-b px-2 pb-2 text-xs font-semibold text-muted-foreground">
              <span className="w-7 shrink-0" />
              <span className="min-w-0 flex-1">Member</span>
              {OGX_METRICS.map((m) => (
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

            <div ref={flipRef} className="pt-1">
              {ranked.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No members yet.</p>
              ) : (
                ranked.slice(0, 12).map((g, i) => {
                  const active = g[metricKey];
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
                      {OGX_METRICS.map((m) => {
                        const v = g[m.key];
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

function TeamPlanCard({
  plan, teamLabel, isOwnPlan,
}: {
  plan: TeamPlan;
  teamLabel: string | null;
  isOwnPlan: boolean;
}) {
  const progress = plan.plannedOpens > 0 ? Math.min(1, plan.actualOpens / plan.plannedOpens) : 0;
  // a planning Coordinator's card is PERSONAL (own plan vs own numbers) —
  // a real Team Leader always carries a team label
  const personal = isOwnPlan && !teamLabel;
  return (
    <Card className="relative overflow-hidden rise-in rise-in-2">
      <CardContent className="pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Target className="size-3.5" /> {personal ? "My" : teamLabel ?? "Team"} plan · {plan.monthLabel}
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
                {personal
                  ? "No plan filed for this month yet — set your opens plan from your profile."
                  : isOwnPlan
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
function Leaderboard({
  title, groups, dealsOnly,
}: {
  title: string;
  groups: DrillGroup[];
  /** B2C (v23): no opens exist — rank by Deals, hide the Opens column */
  dealsOnly?: boolean;
}) {
  const metrics = dealsOnly ? BOARD_METRICS.filter((m) => m.key !== "slots") : BOARD_METRICS;
  const [metricKey, setMetricKey] = useState<keyof FunnelStats>(dealsOnly ? "deals" : "slots");
  // Ties fall back RIGHT TO LEFT along the funnel: level on the ranked metric?
  // compare the last column (Opens), then Deals, then Done, then Visits, then
  // Contacted, then MR. Deeper work outranks earlier work, which is the order
  // the columns are already read in. Ranking only — the medals still follow
  // whatever order this produces.
  const tieBreak = [...metrics].reverse().map((m) => m.key).filter((k) => k !== metricKey);
  const ranked = [...groups].sort((a, b) => {
    const first = (b[metricKey] as number) - (a[metricKey] as number);
    if (first) return first;
    for (const k of tieBreak) {
      const d = (b[k] as number) - (a[k] as number);
      if (d) return d;
    }
    return a.label.localeCompare(b.label);
  });
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
            {metrics.map((m) => (
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
                      {metrics.find((m) => m.key === metricKey)?.label}
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
              {metrics.map((m) => (
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
                      {metrics.map((m) => {
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

/** A KPI tile: the NAME and the NUMBER, nothing else.
 *  v30.1 — the little explainer line ("said Yes to interest", "accounts with ≥1
 *  contact") used to sit under every value and made the row noisy. It now lives
 *  in the hover hint, with `title` as the touch / no-JS fallback, and the two
 *  things that matter carry the weight the third line was stealing. */
function KpiCard({
  label, value, valueText, sub, tone, href,
}: {
  label: string; value?: number; valueText?: string; sub?: string;
  tone?: "warn" | "bad"; href?: string;
}) {
  const body = (
    <Card className="kpi-card h-full" title={sub}>
      <CardContent className="flex h-full flex-col justify-between gap-2 px-4 py-3.5">
        <p className="kpi-label min-h-8 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "text-3xl font-black leading-none tabular-nums xl:text-4xl",
            // toned values keep their warning/danger color; neutral ones light up blue
            !tone && "kpi-value",
            tone === "warn" && "text-warning",
            tone === "bad" && "text-destructive"
          )}
        >
          <CountUp value={value} text={valueText} />
        </p>
      </CardContent>
    </Card>
  );
  const card = href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
  return sub ? <Hint label={sub}>{card}</Hint> : card;
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
