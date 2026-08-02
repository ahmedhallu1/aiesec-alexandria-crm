"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, CheckCircle2, Database, FlaskConical, Loader2,
  ScrollText, Search, Trash2, XCircle,
} from "lucide-react";
import { fmtDateTime } from "@/lib/types";
import type { SystemHealth, AuditEntry } from "@/server/data";
import { removeTestData, seedTestAccounts, setTestDataVisibility } from "@/server/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/** Small "time ago" for cron proxies. */
function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

/** Cron freshness: green if within a healthy window, amber if stale. The
 *  window is derived from the job's own cadence note, so adding a cron in
 *  getSystemHealth needs no change here. */
function cronStale(c: { note: string; lastRun: string | null }): boolean {
  if (!c.lastRun) return true;
  const mins = (Date.now() - new Date(c.lastRun).getTime()) / 60000;
  const note = c.note.toLowerCase();
  if (note.includes("15 min")) return mins > 60;
  if (note.includes("30 min")) return mins > 120;
  if (note.includes("hourly")) return mins > 180;
  return mins > 60 * 26; // daily jobs
}

const ACTION_TONE: Record<string, string> = {
  out_of_process: "text-destructive",
  archive_remove: "text-destructive",
  deal: "text-success",
  set_goal: "text-primary",
  view_as_start: "text-warning",
  view_as_stop: "text-warning",
};

export function AdminView({
  health,
  audit,
  testMode,
}: {
  health: SystemHealth | null;
  audit: AuditEntry[];
  testMode: { testAccounts: number; showTestData: boolean };
}) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return audit;
    return audit.filter((a) =>
      [a.action, a.entity, a.actor ?? "", a.details ?? ""].some((v) =>
        v.toLowerCase().includes(needle)
      )
    );
  }, [q, audit]);

  const allGreen = health?.checks.every((c) => c.ok) ?? false;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="rise-in">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Activity className="size-6 text-primary" /> Health &amp; Logs
          {health ? (
            <Badge
              className={cn(
                "border-transparent",
                allGreen ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
              )}
            >
              {allGreen ? "All systems go" : "Attention needed"}
            </Badge>
          ) : null}
        </h1>
        <p className="text-sm text-muted-foreground">
          Admin console — live health, counts, cron activity and the audit
          trail. This page auto-refreshes; use the sidebar refresh for an
          instant pull.
        </p>
      </div>

      <TestModeCard testMode={testMode} />

      {!health ? (
        <Card className="rise-in rise-in-1">
          <CardContent className="flex items-center gap-2 py-6 text-sm text-destructive">
            <AlertTriangle className="size-4" /> Couldn&apos;t gather health right now — try refreshing.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* health checks */}
          <Card className="rise-in rise-in-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="size-4 text-muted-foreground" /> System checks
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {health.checks.map((c) => (
                <div
                  key={c.label}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-2.5",
                    c.ok ? "border-success/30 bg-success/5" : "border-destructive/40 bg-destructive/5"
                  )}
                >
                  {c.ok ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{c.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.detail}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* counts + crons */}
          <div className="grid gap-4 rise-in rise-in-2 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="size-4 text-muted-foreground" /> Data
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                {health.counts.map((c) => (
                  <div key={c.label} className="rounded-lg bg-muted/40 p-2.5">
                    <p className="text-lg font-bold tabular-nums">
                      {c.value < 0 ? "—" : c.value.toLocaleString("en")}
                    </p>
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="size-4 text-muted-foreground" /> Automations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {health.crons.map((c) => {
                  const stale = cronStale(c);
                  return (
                    <div key={c.label} className="flex items-center gap-2 rounded-lg border p-2.5">
                      <span className={cn("size-2 shrink-0 rounded-full", stale ? "bg-warning" : "bg-success")} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.note}</p>
                      </div>
                      <span className={cn("shrink-0 text-xs font-medium", stale ? "text-warning" : "text-muted-foreground")}>
                        {ago(c.lastRun)}
                      </span>
                    </div>
                  );
                })}
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Real last-run stamps written by each job when it finishes
                  (app_settings <code>cron:*</code>). Amber = overdue for its
                  cadence — check the pg_cron schedule and CRON_SECRET.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* audit log */}
      <Card className="rise-in rise-in-3">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <ScrollText className="size-4 text-muted-foreground" /> Audit log
            <span className="text-xs font-normal text-muted-foreground">· last {audit.length} actions</span>
            <div className="relative ml-auto">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter…"
                className="h-8 w-40 pl-8"
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {audit.length === 0 ? "No audit entries yet." : "Nothing matches."}
            </p>
          ) : (
            shown.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-sm odd:bg-muted/30"
              >
                <span className={cn("font-semibold", ACTION_TONE[a.action] ?? "text-foreground")}>
                  {a.action}
                </span>
                <span className="text-muted-foreground">{a.entity}</span>
                <span className="text-xs text-muted-foreground">
                  by {a.actor ?? "system"}
                </span>
                {a.details ? (
                  <span dir="auto" className="min-w-0 truncate text-xs text-muted-foreground/70">
                    {a.details}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {fmtDateTime(a.createdAt)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** v21 — the admin's test playground:
 *  - seed/remove TEST accounts (is_test — invisible to everyone outside test
 *    mode: lists, dashboards, leaderboards, calendar, mirrors, reports);
 *  - "Show test data" switch: see them in YOUR OWN session;
 *  - reminder that Test view (profile) defaults to the SANDBOX mode where all
 *    actions are undone on exit and no emails/notifications leak. */
function TestModeCard({
  testMode,
}: {
  testMode: { testAccounts: number; showTestData: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"seed" | "wipe" | null>(null);

  const seed = () =>
    start(async () => {
      setBusy("seed");
      const res = await seedTestAccounts();
      setBusy(null);
      if (res.ok) {
        toast.success(`🧪 ${res.data!.created} test accounts seeded across all functions.`);
        router.refresh();
      } else toast.error(res.error);
    });

  const wipe = () =>
    start(async () => {
      setBusy("wipe");
      const res = await removeTestData();
      setBusy(null);
      if (res.ok) {
        toast.success(`🧹 ${res.data!.removed} test accounts removed.`);
        router.refresh();
      } else toast.error(res.error);
    });

  const toggleShow = (show: boolean) =>
    start(async () => {
      const res = await setTestDataVisibility(show);
      if (res.ok) {
        toast.success(
          show
            ? "Test data is now VISIBLE in your session (marked TEST —)."
            : "Test data hidden again."
        );
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Card className="rise-in rise-in-1 border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="size-4 text-primary" /> Test mode
          {testMode.testAccounts > 0 ? (
            <Badge variant="outline" className="font-normal">
              {testMode.testAccounts} test accounts live
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Seed <b>TEST accounts across every function</b> (various stages:
          leads, contacted, visits, deals, archived) to try flows, dashboards
          and filters with real-looking data. They are invisible to members —
          only test views and this switch reveal them, and they never reach the
          Drive mirrors or reports.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={seed} disabled={pending}>
            {busy === "seed" ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
            {testMode.testAccounts > 0 ? "Re-seed test accounts" : "Seed test accounts"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={wipe}
            disabled={pending || testMode.testAccounts === 0}
          >
            {busy === "wipe" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Remove test data
          </Button>
          <label className="ml-auto flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
            Show test data in my session
            <Switch
              checked={testMode.showTestData}
              onCheckedChange={toggleShow}
              disabled={pending}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          💡 Start a <b>Test view</b> from your Profile to use the app as any
          member — it opens in <b>Sandbox</b> by default: every action is rolled
          back when you exit, and no emails, notifications or calendar events go
          out. Flip the chip to <b>Real</b> only when you mean it.
        </p>
      </CardContent>
    </Card>
  );
}
