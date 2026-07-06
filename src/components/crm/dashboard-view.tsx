"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DrillGroup, FunnelStats } from "@/server/data";

interface Goal { function: string; metric: string; target: number }

interface Props {
  total: FunnelStats;
  byFunction: DrillGroup[];
  byTeam: DrillGroup[];
  byMember: DrillGroup[];
  goals: Goal[];
  activeFn: "all" | "IGV" | "IGT";
  scopeLabel: string;
  showFnFilter: boolean;
  showTeamDrill: boolean;
}

const pct = (num: number, den: number) =>
  den > 0 ? `${Math.round((num / den) * 100)}%` : "—";

export function DashboardView({
  total, byFunction, byTeam, byMember, goals, activeFn, scopeLabel, showFnFilter, showTeamDrill,
}: Props) {
  const funnel = [
    { label: "Leads", value: total.leads, hint: "accounts in the pipeline" },
    { label: "Contacted", value: total.contacted, hint: "at least one logged contact" },
    { label: "Visit Scheduled", value: total.visitScheduled, hint: "visit on the calendar" },
    { label: "Visit Done", value: total.visitDone, hint: "confirmed visits" },
    { label: "Deal Done", value: total.dealDone, hint: "slot raised" },
  ];
  const max = Math.max(total.leads, 1);
  const slotsGoal = goals
    .filter((g) => g.metric === "Slots" && (activeFn === "all" || g.function === activeFn))
    .reduce((s, g) => s + g.target, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Raising Dashboard</h1>
          <p className="text-sm text-muted-foreground">{scopeLabel} · Summer Peak 26</p>
        </div>
        {showFnFilter ? (
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(["all", "IGV", "IGT"] as const).map((fn) => (
              <Link
                key={fn}
                href={fn === "all" ? "/" : `/?fn=${fn}`}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  activeFn === fn
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {fn === "all" ? "All ICX" : fn}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Slots raised"
          value={total.slots}
          sub={slotsGoal ? `goal ${slotsGoal} · ${pct(total.slots, slotsGoal)}` : undefined}
          progress={slotsGoal ? Math.min(1, total.slots / slotsGoal) : undefined}
        />
        <KpiCard label="Deals done" value={total.dealDone} sub={`${pct(total.dealDone, total.leads)} of leads`} />
        <KpiCard
          label="⚠️ 3-contact limit"
          value={total.contactLimitFlags}
          sub="need an Out-of-Process decision"
          tone={total.contactLimitFlags > 0 ? "warn" : undefined}
          href="/accounts?flag=contact_limit"
        />
        <KpiCard
          label="🚨 No next step"
          value={total.nextStepMissingFlags}
          sub="floating accounts"
          tone={total.nextStepMissingFlags > 0 ? "bad" : undefined}
          href="/accounts?flag=next_step_missing"
        />
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pipeline funnel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {funnel.map((step, i) => (
            <div key={step.label} className="space-y-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{step.label}</span>
                <span className="text-muted-foreground">
                  {step.value}
                  {i > 0 ? (
                    <span className="ml-2 text-xs">
                      ({pct(step.value, funnel[i - 1].value)} of {funnel[i - 1].label.toLowerCase()})
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="h-7 w-full overflow-hidden rounded-md bg-muted">
                <div
                  className="flex h-full items-center rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground transition-all"
                  style={{ width: `${Math.max((step.value / max) * 100, step.value > 0 ? 6 : 0)}%` }}
                >
                  {step.value > 0 ? step.value : ""}
                </div>
              </div>
            </div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">
            {total.outOfProcess} account{total.outOfProcess === 1 ? "" : "s"} out of process
          </p>
        </CardContent>
      </Card>

      {/* Drill-down */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drill-down</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={byFunction.length > 1 ? "function" : showTeamDrill ? "team" : "member"}>
            <TabsList>
              {byFunction.length > 1 ? <TabsTrigger value="function">By function</TabsTrigger> : null}
              {showTeamDrill ? <TabsTrigger value="team">By team</TabsTrigger> : null}
              <TabsTrigger value="member">By member</TabsTrigger>
            </TabsList>
            {byFunction.length > 1 ? (
              <TabsContent value="function"><DrillTable groups={byFunction} /></TabsContent>
            ) : null}
            {showTeamDrill ? (
              <TabsContent value="team"><DrillTable groups={byTeam} /></TabsContent>
            ) : null}
            <TabsContent value="member"><DrillTable groups={byMember} /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label, value, sub, tone, progress, href,
}: {
  label: string; value: number; sub?: string;
  tone?: "warn" | "bad"; progress?: number; href?: string;
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
          {value}
        </p>
        {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
        {progress !== undefined ? (
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
            <div className="h-full rounded-full bg-success" style={{ width: `${progress * 100}%` }} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function DrillTable({ groups }: { groups: DrillGroup[] }) {
  if (groups.length === 0)
    return <p className="py-6 text-center text-sm text-muted-foreground">No data yet.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            <TableHead className="text-right">Leads</TableHead>
            <TableHead className="text-right">Contacted</TableHead>
            <TableHead className="text-right">Visits sched.</TableHead>
            <TableHead className="text-right">Visits done</TableHead>
            <TableHead className="text-right">Deals</TableHead>
            <TableHead className="text-right">Slots</TableHead>
            <TableHead className="text-right">Lead → Deal</TableHead>
            <TableHead className="text-right">Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <TableRow key={g.key}>
              <TableCell className="font-medium">{g.label}</TableCell>
              <TableCell className="text-right">{g.leads}</TableCell>
              <TableCell className="text-right">{g.contacted}</TableCell>
              <TableCell className="text-right">{g.visitScheduled}</TableCell>
              <TableCell className="text-right">{g.visitDone}</TableCell>
              <TableCell className="text-right">{g.dealDone}</TableCell>
              <TableCell className="text-right font-semibold">{g.slots}</TableCell>
              <TableCell className="text-right text-muted-foreground">{pct(g.dealDone, g.leads)}</TableCell>
              <TableCell className="text-right">
                {g.contactLimitFlags + g.nextStepMissingFlags > 0 ? (
                  <Badge variant="destructive">{g.contactLimitFlags + g.nextStepMissingFlags}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
