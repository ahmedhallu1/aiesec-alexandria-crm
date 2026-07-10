"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Loader2, Target, Trophy, X } from "lucide-react";
import { setPerformanceGoal } from "@/server/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Hint } from "./hint";
import { cn } from "@/lib/utils";
import { FUNCTION_COLORS } from "@/lib/types";
import type { DrillGroup, FunnelStats, PerformanceGoal } from "@/server/data";

export interface DashboardScopeView { key: string; label: string }

interface GoalCaps {
  /** which function goal the viewer may set from the current lane (IGV/IGT) */
  functionGoalFn: "IGV" | "IGT" | null;
  /** the team whose goal the viewer may set (their own team) */
  teamGoal: boolean;
  teamLeaderId: string | null;
  teamLabel: string | null;
}

interface Props {
  total: FunnelStats;
  byFunction: DrillGroup[];
  byTeam: DrillGroup[];
  functionBoard: DrillGroup[];
  teamBoard: DrillGroup[];
  funcGoal: PerformanceGoal | null;
  teamGoal: PerformanceGoal | null;
  views: DashboardScopeView[];
  activeFn: string;
  laneLabel: string;
  scopeLabel: string;
  showTeamDrill: boolean;
  teamOptions: { id: string; label: string }[];
  memberOptions: { id: string; label: string }[];
  filters: { team: string; member: string; from: string; to: string };
  goalCaps: GoalCaps;
}

const pct = (num: number, den: number) =>
  den > 0 ? `${Math.round((num / den) * 100)}%` : "—";

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
  total, byFunction, byTeam, functionBoard, teamBoard, funcGoal, teamGoal,
  views, activeFn, laneLabel, scopeLabel, showTeamDrill, teamOptions,
  memberOptions, filters, goalCaps,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  const [goalOpen, setGoalOpen] = useState(false);

  const go = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      startNav(() => {
        router.replace(params.size > 0 ? `/?${params.toString()}` : "/");
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
    { label: "Done → Deals", value: pct(total.dealAccounts, total.visitDone) },
  ];
  const month = monthRange();
  const today = new Date().toISOString().slice(0, 10);
  const thisMonthActive = filters.from === month.from && filters.to === month.to;
  const anyFilter = Object.values(filters).some(Boolean);
  const canSetAnyGoal = !!goalCaps.functionGoalFn || goalCaps.teamGoal;

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
        {/* labeled so the boxes are self-explanatory on mobile (no dd/mm/yyyy hint there) */}
        <div className="flex items-end gap-1.5">
          <div className="grid gap-0.5">
            <span className="px-0.5 text-[10px] font-medium text-muted-foreground">Added from</span>
            <Input
              type="date"
              max={today}
              className="h-9 w-[8.6rem]"
              value={filters.from}
              onChange={(e) => setParam("from", e.target.value)}
            />
          </div>
          <div className="grid gap-0.5">
            <span className="px-0.5 text-[10px] font-medium text-muted-foreground">to</span>
            <Input
              type="date"
              max={today}
              className="h-9 w-[8.6rem]"
              value={filters.to}
              onChange={(e) => setParam("to", e.target.value)}
            />
          </div>
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

      {/* Goals */}
      {(funcGoal || teamGoal || canSetAnyGoal) ? (
        <div className="grid gap-3 sm:grid-cols-2 rise-in rise-in-2">
          <GoalCard
            title={`${laneLabel} goal`}
            goal={funcGoal}
            achieved={total.slots}
            canSet={!!goalCaps.functionGoalFn}
            onSet={() => setGoalOpen(true)}
          />
          {(teamGoal || goalCaps.teamGoal || goalCaps.teamLeaderId) ? (
            <GoalCard
              title={`${goalCaps.teamLabel ?? "Team"} goal`}
              goal={teamGoal}
              achieved={
                teamBoard.reduce((s, g) => s + g.slots, 0)
              }
              canSet={goalCaps.teamGoal}
              onSet={() => setGoalOpen(true)}
            />
          ) : null}
        </div>
      ) : null}

      {/* KPI row — MR · Contacted · Visits · Visits done · Deals · Slots · Lead→Deal */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7 rise-in rise-in-2">
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} sub={k.hint} />
        ))}
        <KpiCard
          label="Lead → Deal"
          valueText={pct(total.dealAccounts, total.mr)}
          sub="accounts that reached a deal"
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

      {/* Leaderboards */}
      <div className="grid gap-4 lg:grid-cols-2 rise-in rise-in-3">
        {activeFn !== "all" && functionBoard.length > 0 ? (
          <Leaderboard title={`${laneLabel} leaderboard`} groups={functionBoard} />
        ) : null}
        {teamBoard.length > 1 ? (
          <Leaderboard
            title={`${goalCaps.teamLabel ?? "Team"} leaderboard`}
            groups={teamBoard}
          />
        ) : null}
      </div>

      {/* Drill-down */}
      <Card className="rise-in rise-in-4">
        <CardHeader>
          <CardTitle className="text-base">Drill-down</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={byFunction.length > 1 ? "function" : showTeamDrill ? "team" : "member"}>
            <TabsList className="flex-wrap">
              {byFunction.length > 1 ? <TabsTrigger value="function">By product</TabsTrigger> : null}
              {showTeamDrill ? <TabsTrigger value="team">By team</TabsTrigger> : null}
              <TabsTrigger value="member">By member</TabsTrigger>
            </TabsList>
            {byFunction.length > 1 ? (
              <TabsContent value="function"><DrillTable groups={byFunction} colorKeys /></TabsContent>
            ) : null}
            {showTeamDrill ? (
              <TabsContent value="team"><DrillTable groups={byTeam} /></TabsContent>
            ) : null}
            <TabsContent value="member"><DrillTable groups={functionBoard} /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <GoalDialog
        open={goalOpen}
        onOpenChange={setGoalOpen}
        caps={goalCaps}
        monthDefault={month}
      />
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function GoalCard({
  title, goal, achieved, canSet, onSet,
}: {
  title: string;
  goal: PerformanceGoal | null;
  achieved: number;
  canSet: boolean;
  onSet: () => void;
}) {
  const progress = goal ? Math.min(1, achieved / goal.target) : 0;
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Target className="size-3.5" /> {title}
              {goal ? <span className="text-muted-foreground/70">· {goal.period_label}</span> : null}
            </p>
            {goal ? (
              <p className="mt-1 text-2xl font-bold">
                {achieved}
                <span className="text-base font-semibold text-muted-foreground"> / {goal.target} slots</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                No goal set for this period yet.
              </p>
            )}
          </div>
          {canSet ? (
            <Hint label="Set or update the slots goal your people rally around">
              <Button size="sm" variant="outline" onClick={onSet}>
                <Target className="size-4" /> Set goal
              </Button>
            </Hint>
          ) : null}
        </div>
        {goal ? (
          <div className="mt-3 h-2 w-full rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700",
                progress >= 1 ? "bg-success" : "bg-primary"
              )}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Leaderboard({ title, groups }: { title: string; groups: DrillGroup[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="size-4 text-warning" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {groups.slice(0, 8).map((g, i) => (
          <div
            key={g.key}
            className={cn(
              "flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm",
              i === 0 && g.slots > 0 ? "bg-warning/10" : i % 2 ? "bg-muted/40" : ""
            )}
          >
            <span className="w-6 text-center text-base">
              {g.slots > 0 && MEDALS[i] ? MEDALS[i] : <span className="text-xs text-muted-foreground">#{i + 1}</span>}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{g.label}</span>
            <span className="text-xs text-muted-foreground">{g.contacted} contacted</span>
            <Badge
              className={cn(
                "border-transparent font-bold",
                g.slots > 0 ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
              )}
            >
              {g.slots} slot{g.slots === 1 ? "" : "s"}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GoalDialog({
  open, onOpenChange, caps, monthDefault,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caps: GoalCaps;
  monthDefault: { from: string; to: string; label: string };
}) {
  const router = useRouter();
  const scopes: ("function" | "team")[] = [
    ...(caps.functionGoalFn ? (["function"] as const) : []),
    ...(caps.teamGoal ? (["team"] as const) : []),
  ];
  const [scope, setScope] = useState<"function" | "team">(scopes[0] ?? "team");
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState(monthDefault.label);
  const [start, setStart] = useState(monthDefault.from);
  const [end, setEnd] = useState(monthDefault.to);
  const [pending, startSave] = useTransition();

  const save = () =>
    startSave(async () => {
      const res = await setPerformanceGoal({
        scope,
        function: scope === "function" ? caps.functionGoalFn : null,
        teamLeaderId: scope === "team" ? caps.teamLeaderId : null,
        target: Number(target),
        periodLabel: label.trim(),
        periodStart: start,
        periodEnd: end,
      });
      if (res.ok) {
        toast.success("Goal set — it's on everyone's dashboard now 🎯");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>🎯 Set the slots goal</DialogTitle>
          <DialogDescription>
            The goal shows on the dashboard of everyone it covers — the shared
            target for the month or the peak.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {scopes.length > 1 ? (
            <div className="grid gap-1.5">
              <Label>Goal for</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as "function" | "team")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {caps.functionGoalFn ? (
                    <SelectItem value="function">{caps.functionGoalFn} (whole function)</SelectItem>
                  ) : null}
                  {caps.teamGoal ? (
                    <SelectItem value="team">{caps.teamLabel ?? "My team"}</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Slots target *</Label>
              <Input
                type="number"
                min={1}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="e.g. 25"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Period name *</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="July 2026 / Summer Peak 26"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>From</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>To</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={save}
            disabled={pending || !Number(target) || !label.trim() || !start || !end || scopes.length === 0}
          >
            {pending ? "Saving…" : "Set goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KpiCard({
  label, value, valueText, sub, tone, href,
}: {
  label: string; value?: number; valueText?: string; sub?: string;
  tone?: "warn" | "bad"; href?: string;
}) {
  const body = (
    <Card className={cn("h-full transition-shadow", href && "hover:shadow-md")}>
      <CardContent className="pt-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-1 text-3xl font-bold",
            tone === "warn" && "text-warning",
            tone === "bad" && "text-destructive"
          )}
        >
          {valueText ?? value}
        </p>
        {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
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
            <TableHead className="text-right">Lead → Deal</TableHead>
            <TableHead className="text-right">Flags</TableHead>
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
                <TableCell className="text-right">
                  {g.contactLimitFlags + g.nextStepMissingFlags > 0 ? (
                    <Badge variant="destructive">{g.contactLimitFlags + g.nextStepMissingFlags}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
