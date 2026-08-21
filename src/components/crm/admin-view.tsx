"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, CheckCircle2, Database, FlaskConical, Loader2,
  ScrollText, Search, Trash2, Undo2, XCircle,
} from "lucide-react";
import { fmtDateTime } from "@/lib/types";
import type { SystemHealth, AuditEntry } from "@/server/data";
import {
  removeTestData, seedTestAccounts, setTestDataVisibility, startLcTestSession,
  stopLcTestSession, undoAuditEntries,
} from "@/server/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeysCard } from "./api-keys-card";
import type { ApiKeyRow } from "@/server/api-keys";
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
  lcSession,
  apiKeys,
}: {
  health: SystemHealth | null;
  audit: AuditEntry[];
  testMode: { testAccounts: number; showTestData: boolean };
  lcSession: { id: string; startedAt: string; changes: number } | null;
  apiKeys: ApiKeyRow[];
}) {
  const [q, setQ] = useState("");
  // bulk selection over the log (v32)
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [undoing, startUndo] = useTransition();
  const router = useRouter();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return audit;
    return audit.filter((a) =>
      [a.action, a.entity, a.actor ?? "", a.details ?? ""].some((v) =>
        v.toLowerCase().includes(needle)
      )
    );
  }, [q, audit]);

  // only entries that actually have journal rows can be reversed
  const undoableShown = shown.filter((a) => a.undoable > 0);
  const pickedUndoable = [...picked].filter((id) =>
    audit.some((a) => a.id === id && a.undoable > 0)
  );
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const runUndo = (ids: number[]) =>
    startUndo(async () => {
      const res = await undoAuditEntries(ids);
      if (!res.ok) { toast.error(res.error); return; }
      const { undone, skipped, failed } = res.data!;
      if (undone === 0 && failed === 0) toast.info("Nothing to undo in that selection.");
      else if (failed > 0)
        toast.warning(`Undid ${undone} action${undone === 1 ? "" : "s"}, ${failed} partly failed — check the rows.`);
      else
        toast.success(
          `Undid ${undone} action${undone === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped` : ""}.`
        );
      setPicked(new Set());
      router.refresh();
    });

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

      <ApiKeysCard keys={apiKeys} />

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
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                    {/* NOT `truncate` (v33.28): hiding the overflow left 439px
                        of sentence inside a 247px box, which is the complaint —
                        the detail is the diagnosis, so it wraps and is read. */}
                    <p className="break-words text-xs text-muted-foreground">{c.detail}</p>
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

      {/* LC-wide testing session (v32) */}
      <LcSessionCard session={lcSession} />

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
          {/* bulk bar — appears once something reversible is selected */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={undoableShown.length === 0}
              onClick={() =>
                setPicked(
                  pickedUndoable.length === undoableShown.length
                    ? new Set()
                    : new Set(undoableShown.map((a) => a.id))
                )
              }
            >
              {pickedUndoable.length === undoableShown.length && undoableShown.length > 0
                ? "Clear"
                : `Select undoable (${undoableShown.length})`}
            </Button>
            {pickedUndoable.length > 0 ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-8"
                disabled={undoing}
                onClick={() => runUndo(pickedUndoable)}
              >
                {undoing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Undo2 className="size-4" />
                )}
                Undo {pickedUndoable.length} action{pickedUndoable.length === 1 ? "" : "s"}
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Undo replays an action&apos;s row changes in reverse. Actions from
              before this release, and ones that touched nothing reversible
              (sign-ins, sent reports), have nothing to replay.
            </p>
          </div>
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
                className={cn(
                  "flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-sm odd:bg-muted/30",
                  picked.has(a.id) && "bg-primary/10 odd:bg-primary/10",
                  a.undoneAt && "opacity-60"
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-[var(--primary)] disabled:opacity-30"
                  checked={picked.has(a.id)}
                  disabled={a.undoable === 0}
                  aria-label={
                    a.undoable === 0 ? "Nothing to undo for this action" : `Select ${a.action}`
                  }
                  onChange={() => toggle(a.id)}
                />
                <span className={cn("font-semibold", ACTION_TONE[a.action] ?? "text-foreground")}>
                  {a.action}
                </span>
                <span className="text-muted-foreground">{a.entity}</span>
                <span className="text-xs text-muted-foreground">
                  {a.actorAdminOnly ? (
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      by {a.actor} 🎭 (anonymous — admin eyes only)
                    </span>
                  ) : (
                    <>by {a.actor ?? "system"}</>
                  )}
                </span>
                {a.inTestSession ? (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    🧪 test session
                  </Badge>
                ) : null}
                {a.undoneAt ? (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    undone
                  </Badge>
                ) : null}
                {a.details ? (
                  <span dir="auto" className="min-w-0 truncate text-xs text-muted-foreground/70">
                    {a.details}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {fmtDateTime(a.createdAt)}
                </span>
                {a.undoable > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-xs"
                    disabled={undoing}
                    onClick={() => runUndo([a.id])}
                    title={`Reverse ${a.undoable} row change${a.undoable === 1 ? "" : "s"}`}
                  >
                    <Undo2 className="size-3.5" /> Undo
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** v32 — the LC-wide testing session.
 *
 *  One switch that puts the WHOLE LC into a test: everyone keeps using the app
 *  normally, every database write is journaled, and stopping the session rolls
 *  all of it back. The warning is deliberately loud because outbound side
 *  effects are NOT suppressed (the admin chose that): mail that goes out
 *  during the test has really gone out. */
function LcSessionCard({
  session,
}: {
  session: { id: string; startedAt: string; changes: number } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmStop, setConfirmStop] = useState<null | "rollback" | "keep">(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) { toast.error(res.error ?? "Something went wrong."); return; }
      toast.success(ok);
      setConfirmStop(null);
      router.refresh();
    });

  return (
    <Card className={cn("rise-in rise-in-3", session && "border-warning/50 bg-warning/5")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="size-4 text-primary" /> LC-wide testing session
          {session ? (
            <Badge className="bg-warning text-warning-foreground">RUNNING</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {session ? (
          <>
            <p>
              Started <b>{fmtDateTime(session.startedAt)}</b> ·{" "}
              <b>{session.changes}</b> row change{session.changes === 1 ? "" : "s"} journaled
              so far. Everyone in the LC can use the system normally; every write
              is being recorded.
            </p>
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              ⚠️ Emails, notifications, calendar events and the Sheets write-back
              are <b>live</b> during this session and cannot be rolled back.
              Stopping restores the <b>database</b> only.
            </p>
            {confirmStop === null ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" size="sm" onClick={() => setConfirmStop("rollback")}>
                  Stop &amp; undo everything
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmStop("keep")}>
                  Stop &amp; keep the changes
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">
                  {confirmStop === "rollback"
                    ? `Undo all ${session.changes} change${session.changes === 1 ? "" : "s"} made since the session started?`
                    : "Keep every change made during the session?"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {confirmStop === "rollback"
                    ? "Rows are restored in reverse order. This cannot itself be undone."
                    : "The session closes and the changes stay. Individual actions remain undoable from the log below."}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={confirmStop === "rollback" ? "destructive" : "default"}
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => stopLcTestSession(confirmStop === "keep"),
                        confirmStop === "rollback"
                          ? "Session closed — the database is back to where it started."
                          : "Session closed — the changes were kept."
                      )
                    }
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                    Yes, {confirmStop === "rollback" ? "undo everything" : "keep them"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmStop(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Turn the whole LC loose on the system for a session — training, a
              feedback round, a stress test. Every database write is journaled
              and undone in one click when you stop, so nothing has to be cleaned
              up by hand afterwards.
            </p>
            <p className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
              What is <b>not</b> undone: emails, in-app notifications, calendar
              events, Gmail drafts and the Membership sheet write-back all fire
              for real. Permanent deletes of archived accounts are blocked while
              a session runs, because a cascade delete cannot be replayed.
            </p>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(startLcTestSession, "Testing session started — the LC is in test mode.")}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
              Start a testing session
            </Button>
          </>
        )}
      </CardContent>
    </Card>
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
