"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarCheck2,
  CheckCircle2,
  ClipboardList,
  Clock,
  Hand,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  appealAttendance,
  loadAttendanceSheet,
  resolveAppeal,
  saveAttendance,
  type AttendanceSheet,
} from "@/server/attendance";
import type {
  AttendanceHistoryRow,
  AttendanceTotals,
  OpenAppeal,
} from "@/server/attendance-read";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/lib/types";
import {
  PageSizePicker, resizableCellStyle, ResizableHead,
} from "./data-table-kit";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  SortHeader, TableSettings, useTableColumns, useTableSort, type TableColumn,
} from "./data-table-kit";
import { Hint } from "./hint";
import { bookedBy } from "@/lib/touch-point-label";

/** /attendance (v29) — for EVERYONE.
 *  A member reads their own history and appeals a wrong row; a Team Leader
 *  sees their team, a VP/Director their function, TM core and the LCP the
 *  whole LC. The "Needs recording" lane at the top is what every reminder,
 *  bell and pending prompt deep-links to. */

/** One entry of the "open any session" picker (v33.19.2). */
export interface PickableTouchPoint {
  id: string;
  label: string;
  whenLabel: string;
  audience: string;
  recorded: boolean;
}

export interface OwedTouchPoint {
  id: string;
  label: string;
  kind: string;
  whenLabel: string;
  audience: string;
  scope?: string | null;
  ownerName: string;
  isWorkingHours: boolean;
  windowClosed: boolean;
}

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  attended: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  late: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  absent: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
};
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  attended: "Attended",
  late: "Late",
  absent: "Absent",
};
const KIND_LABEL: Record<string, string> = {
  meeting: "Meeting",
  working_hours: "Working hours",
  outing: "Outing",
};

function StatusChip({ status, excused }: { status: AttendanceStatus; excused: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant="outline" className={cn("font-semibold", STATUS_STYLE[status])}>
        {STATUS_LABEL[status]}
      </Badge>
      {excused ? (
        <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-[10px] text-sky-700 dark:text-sky-300">
          excused
        </Badge>
      ) : null}
    </span>
  );
}

const cairoDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    timeZone: "Africa/Cairo",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const cairoTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "Africa/Cairo",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

// ------------------------------------------------------------------ recording

interface DraftRow {
  status: AttendanceStatus | null;
  excused: boolean;
  excuse: string;
}

function RecordDialog({
  touchPointId,
  onClose,
}: {
  touchPointId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();
  // bumped after a recompute to pull the fresh verdicts back in
  const [reloadKey, setReloadKey] = useState(0);
  // SEARCH + FILTER (v33.19.2): an LC working-hours sheet is ~70 rows, and
  // finding one person meant scrolling the whole audience.
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | AttendanceStatus | "unset">("all");
  // onClose is re-created by the parent on every render — the ref keeps the
  // fetch effect from re-firing on it
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await loadAttendanceSheet(touchPointId);
      if (!alive) return;
      if (!res.ok) {
        toast.error(res.error);
        closeRef.current();
        return;
      }
      setSheet(res.data!);
      const next: Record<string, DraftRow> = {};
      for (const r of res.data!.rows)
        next[r.memberId] = {
          status: r.status,
          excused: r.excused,
          excuse: r.excuse ?? "",
        };
      setDraft(next);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [touchPointId, reloadKey]);

  const set = (memberId: string, patch: Partial<DraftRow>) =>
    setDraft((d) => ({ ...d, [memberId]: { ...d[memberId], ...patch } }));

  const markAll = (status: AttendanceStatus) =>
    setDraft((d) => {
      const next = { ...d };
      for (const r of sheet?.rows ?? [])
        if (!r.locked) next[r.memberId] = { ...next[r.memberId], status };
      return next;
    });

  const submit = () =>
    start(async () => {
      const rows = (sheet?.rows ?? [])
        .filter((r) => !r.locked && draft[r.memberId]?.status)
        .map((r) => ({
          memberId: r.memberId,
          status: draft[r.memberId].status as AttendanceStatus,
          excused: draft[r.memberId].excused,
          excuse: draft[r.memberId].excuse,
        }));
      if (rows.length === 0) {
        toast.error("Set at least one person's attendance first.");
        return;
      }
      const res = await saveAttendance(touchPointId, rows);
      if (res.ok) {
        const saved = res.data?.saved ?? rows.length;
        const confirmed = res.data?.confirmed ?? true;
        toast.success(
          confirmed && saved === 0
            ? "Confirmed — the pre-filled records stand ✅"
            : confirmed
              ? `Attendance confirmed (${saved} row${saved === 1 ? "" : "s"} edited) ✅`
              : `Saved for ${saved} people — set everyone to confirm the session`
        );
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });

  const missing = (sheet?.rows ?? []).filter((r) => !r.locked && !draft[r.memberId]?.status).length;
  const needle = q.trim().toLowerCase();
  const shownRows = (sheet?.rows ?? []).filter((r) => {
    if (needle && !r.name.toLowerCase().includes(needle)) return false;
    if (only === "all") return true;
    const st = draft[r.memberId]?.status ?? null;
    return only === "unset" ? !st : st === only;
  });
  // a working-hours session can't be hand-written before it has even finished
  // (the server refuses it) — don't offer the button
  const stillOpen = !!sheet?.isWorkingHours && !sheet.windowClosed;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle dir="auto">{sheet ? sheet.label : "Attendance"}</DialogTitle>
          <DialogDescription dir="auto">
            {sheet
              ? `${sheet.whenLabel} · ${sheet.audience} · booked by ${bookedBy(sheet)}`
              : "Loading the audience…"}
          </DialogDescription>
        </DialogHeader>

        {loading || !sheet ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {sheet.isWorkingHours ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
                <p className="flex items-center gap-1.5 font-semibold text-primary">
                  <Sparkles className="size-3.5" />
                  {sheet.recordedAt
                    ? "Pre-filled automatically — confirmed"
                    : sheet.windowClosed
                      ? "AI pre-filled — review & confirm"
                      : "Filling itself in from everyone's work…"}
                </p>
                {/* the engine proposes, a human decides: nothing counts as
                    recorded until this sheet is confirmed (v29.3) */}
                <p className="mt-1 text-muted-foreground">
                  {sheet.recordedAt
                    ? "Sodio filled this in from everyone's work activity and you confirmed it. Change anything you like — it saves again."
                    : "Sodio filled this in from everyone's work activity. Correct whatever looks wrong, then confirm — until you do, this session keeps reminding you."}
                </p>
                <p className="mt-1 text-muted-foreground">{sheet.rule}</p>
                {/* v33.17: the sheet computes ITSELF on open once the window
                    closes — the Recompute button became a chore, not a tool */}
                {!sheet.windowClosed ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    The session is still open — it computes itself the moment
                    you open this sheet after it ends.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Everyone:</span>
              {ATTENDANCE_STATUSES.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => markAll(s)}>
                  {STATUS_LABEL[s]}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search a name…"
                className="h-8 w-full sm:w-52"
                dir="auto"
              />
              <Select value={only} onValueChange={(v) => setOnly(v as typeof only)}>
                <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="unset">Not set yet</SelectItem>
                  {ATTENDANCE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {q || only !== "all" ? (
                <span className="text-xs text-muted-foreground">
                  {shownRows.length} of {sheet.rows.length}
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              {shownRows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nobody matches that.
                </p>
              ) : null}
              {shownRows.map((r) => {
                const d = draft[r.memberId] ?? { status: null, excused: false, excuse: "" };
                const excusable = d.status === "absent" || d.status === "late";
                return (
                  <div
                    key={r.memberId}
                    className={cn(
                      "rounded-lg border p-2.5",
                      r.locked && "border-dashed opacity-70"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" dir="auto">
                          {r.name}
                          {r.automatic ? (
                            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                              auto
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {r.role}
                          {r.team ? ` · ${r.team}` : ""}
                          {r.workHint ? ` · ${r.workHint}` : ""}
                        </p>
                      </div>
                      {r.locked ? (
                        <span className="text-[11px] text-muted-foreground">
                          Your own row — only the owner or TM sets it
                        </span>
                      ) : (
                        <div className="flex shrink-0 gap-1">
                          {ATTENDANCE_STATUSES.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => set(r.memberId, { status: s })}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                                d.status === s
                                  ? STATUS_STYLE[s]
                                  : "border-border text-muted-foreground hover:border-primary/50"
                              )}
                            >
                              {STATUS_LABEL[s]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {!r.locked && excusable ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                        <Label className="flex items-center gap-2 text-xs">
                          <Switch
                            checked={d.excused}
                            onCheckedChange={(v) => set(r.memberId, { excused: v })}
                          />
                          Valid excuse?
                        </Label>
                        <Input
                          dir="auto"
                          className="h-8 flex-1 min-w-40 text-xs"
                          placeholder="Why (optional)"
                          maxLength={500}
                          value={d.excuse}
                          onChange={(e) => set(r.memberId, { excuse: e.target.value })}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="items-center">
          {stillOpen ? (
            <span className="mr-auto text-[11px] text-muted-foreground">
              The session is still running — you can confirm it once its window
              closes.
            </span>
          ) : missing > 0 ? (
            <span className="mr-auto text-[11px] text-muted-foreground">
              {missing} still unset
            </span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || loading || stillOpen}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {/* working hours arrive filled in — the responsible CONFIRMS them,
                and that confirmation is what marks the point recorded */}
            {sheet?.isWorkingHours && !sheet.recordedAt
              ? "Confirm attendance"
              : "Save attendance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ appeal

function AppealDialog({
  row,
  onClose,
}: {
  row: AttendanceHistoryRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await appealAttendance(row.id, message);
      if (res.ok) {
        toast.success("Appeal sent — TM is on copy 🙋");
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Appeal this record</DialogTitle>
          <DialogDescription dir="auto">
            {row.label} · {cairoDay(row.startsAt)} — recorded as{" "}
            <b>{STATUS_LABEL[row.status]}</b>
            {row.automatic ? " by Sodio (automatic working hours)" : ""}. Say what
            actually happened; it goes to whoever recorded it, with TM on copy.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          dir="auto"
          rows={4}
          maxLength={1000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="I was there from 6 to 9 — I logged 4 contacts that evening…"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || message.trim().length < 5}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Hand className="size-4" />}
            Send the appeal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------- universal table columns

/** Every column the attendance history CAN show. */
const ATTENDANCE_COLUMNS: TableColumn[] = [
  { key: "label", label: "Touch point", required: true },
  { key: "kind", label: "Type" },
  { key: "when", label: "When" },
  { key: "member", label: "Member" },
  { key: "status", label: "Status" },
  { key: "excuse", label: "Excuse" },
  { key: "actions", label: "Actions" },
  { key: "audience", label: "Audience", defaultHidden: true },
  { key: "owner", label: "Booked by", defaultHidden: true },
  { key: "recorded", label: "Recorded at", defaultHidden: true },
];

const ATTENDANCE_CELL_CLASS: Record<string, string> = {
  label: "max-w-56",
  kind: "text-xs text-muted-foreground",
  when: "whitespace-nowrap text-xs",
  member: "max-w-40 truncate",
  excuse: "max-w-48 truncate text-xs text-muted-foreground",
  audience: "max-w-40 truncate text-xs text-muted-foreground",
  owner: "max-w-40 truncate text-xs text-muted-foreground",
  recorded: "whitespace-nowrap text-xs text-muted-foreground",
  actions: "whitespace-nowrap text-right",
};

/** Client-side sort accessors over the page in hand (the history is paged
 *  server-side; sorting reorders what you're looking at). */
const ATTENDANCE_SORTERS: Record<string, (r: AttendanceHistoryRow) => string | number | null> = {
  label: (r) => r.label,
  kind: (r) => r.kind,
  when: (r) => r.startsAt,
  member: (r) => r.memberName,
  status: (r) => r.status,
  excuse: (r) => r.excuse,
  audience: (r) => r.audience,
  owner: (r) => r.ownerName,
  recorded: (r) => r.recordedAt,
};

// ------------------------------------------------------------------ the page

export function AttendanceView({
  owed,
  pickable = [],
  history,
  total,
  page,
  pageSize,
  pageSizeOptions,
  totals,
  appeals,
  filters,
  scopeLabel,
  openTouchPointId,
}: {
  owed: OwedTouchPoint[];
  /** every past session the viewer may open — the picker (v33.19.2) */
  pickable?: PickableTouchPoint[];
  history: AttendanceHistoryRow[];
  total: number;
  /** 0-based */
  page: number;
  pageSize: number;
  pageSizeOptions: number[];
  totals: AttendanceTotals;
  appeals: OpenAppeal[];
  filters: { from: string; to: string; kind: string; status: string };
  scopeLabel: string;
  openTouchPointId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  const [recording, setRecording] = useState<string | null>(openTouchPointId);
  const [appealing, setAppealing] = useState<AttendanceHistoryRow | null>(null);
  const [resolving, startResolve] = useTransition();

  // a reminder / bell / pending prompt deep-links straight into the sheet:
  // derive the open dialog from the ?tp= prop (adjust-during-render, so no
  // cascading effect) — a manual open/close still wins until the link changes
  const [lastLinked, setLastLinked] = useState(openTouchPointId);
  if (lastLinked !== openTouchPointId) {
    setLastLinked(openTouchPointId);
    setRecording(openTouchPointId);
  }

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      if (key !== "page") params.delete("page");
      startNav(() => router.replace(`/attendance?${params.toString()}`));
    },
    [router, searchParams]
  );

  const closeSheet = () => {
    setRecording(null);
    if (searchParams.get("tp")) setParam("tp", "");
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  // ⚙ Columns + click-to-sort over the page in hand
  const cols = useTableColumns("attendance-history", ATTENDANCE_COLUMNS);
  const { sorted: sortedHistory, sortKey, dir, toggle: toggleSort } =
    useTableSort(history, ATTENDANCE_SORTERS);

  /** One history cell, by column key. */
  const historyCell = (r: AttendanceHistoryRow, key: string): React.ReactNode => {
    switch (key) {
      case "label":
        return (
          <>
            <span className="block truncate font-medium" dir="auto">{r.label}</span>
            {cols.isVisible("audience") ? null : (
              <span className="block truncate text-xs text-muted-foreground" dir="auto">
                {r.audience}
              </span>
            )}
          </>
        );
      case "kind":
        return KIND_LABEL[r.kind] ?? r.kind;
      case "when":
        return (
          <>
            {cairoDay(r.startsAt)}
            <span className="block text-muted-foreground">{cairoTime(r.startsAt)}</span>
          </>
        );
      case "member":
        return (
          <>
            {r.mine ? <b>You</b> : r.memberName}
            {r.automatic ? (
              <Hint label="Recorded automatically from this member's work activity">
                <span className="ml-1 text-[10px] text-muted-foreground">auto</span>
              </Hint>
            ) : null}
          </>
        );
      case "status":
        return <StatusChip status={r.status} excused={r.excused} />;
      case "excuse":
        return <span dir="auto">{r.excuse ?? "—"}</span>;
      case "audience":
        return <span dir="auto">{r.audience}</span>;
      case "owner":
        return <span dir="auto">{r.ownerName}</span>;
      case "recorded":
        return r.recordedAt ? cairoDay(r.recordedAt) : "—";
      case "actions":
        return (
          <>
            {r.mine && !r.appeal && r.status !== "attended" ? (
              <Button size="sm" variant="outline" onClick={() => setAppealing(r)}>
                <Hand className="size-3.5" /> Appeal
              </Button>
            ) : null}
            {r.appeal ? (
              <Badge variant="outline" className="text-[10px]">
                {r.appeal.resolved ? "Appeal resolved" : "Appeal open"}
              </Badge>
            ) : null}
            {r.canRecord ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-1"
                onClick={() => setRecording(r.touchPointId)}
              >
                Edit
              </Button>
            ) : null}
          </>
        );
      default:
        return null;
    }
  };

  const kpi = [
    { label: "Records", value: totals.total, icon: ClipboardList },
    { label: "Attended", value: totals.attended, icon: CheckCircle2 },
    { label: "Late", value: totals.late, icon: Clock },
    { label: "Absent", value: totals.absent, icon: XCircle },
    { label: "Excused", value: totals.excused, icon: Hand },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="rise-in">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CalendarCheck2 className="size-6 text-primary" /> Attendance
        </h1>
        <p className="text-sm text-muted-foreground">
          Every meeting, working-hours session and outing — who showed up, who
          didn&apos;t, and why. You&apos;re seeing {scopeLabel}.
        </p>
      </div>

      {/* --------- open ANY session's sheet (v33.19.2) --------- */}
      {pickable.length > 0 ? (
        <Card className="rise-in">
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-sm font-semibold">Open a session:</span>
            <Select value="" onValueChange={(v) => setRecording(v)}>
              <SelectTrigger className="h-9 w-full sm:w-[26rem]">
                <SelectValue placeholder="Choose a touch point…" />
              </SelectTrigger>
              <SelectContent>
                {pickable.map((tp) => (
                  <SelectItem key={tp.id} value={tp.id}>
                    <span dir="auto">
                      {tp.recorded ? "✅ " : "🕓 "}
                      {tp.label} · {tp.whenLabel}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              ✅ recorded · 🕓 still open — pick one to view or edit its attendance.
            </span>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- needs recording ---------------- */}
      {owed.length > 0 ? (
        <Card className="rise-in border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="size-4 text-amber-600" />
              Needs recording ({owed.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {owed.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" dir="auto">
                    {o.label}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" dir="auto">
                    {o.whenLabel} · {o.audience} · booked by {bookedBy(o)}
                  </p>
                </div>
                <Button size="sm" onClick={() => setRecording(o.id)}>
                  {o.isWorkingHours ? <Sparkles className="size-4" /> : <ClipboardList className="size-4" />}
                  {o.isWorkingHours
                    ? o.windowClosed
                      ? "Review & confirm"
                      : "Open (still running)"
                    : "Record attendance"}
                </Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Working-hours sessions fill themselves in from everyone&apos;s work
              once their window closes — you still review and <b>confirm</b> them,
              and they keep reminding you until you do.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- open appeals ---------------- */}
      {appeals.length > 0 ? (
        <Card className="rise-in rise-in-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Hand className="size-4 text-primary" /> Appeals to review ({appeals.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {appeals.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold" dir="auto">
                    {a.memberName} — {STATUS_LABEL[a.status]} · {a.label}
                  </p>
                  <p className="break-words text-xs text-muted-foreground" dir="auto">
                    {cairoDay(a.startsAt)} · {a.message}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setRecording(a.touchPointId)}>
                    Open record
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={resolving}
                    onClick={() =>
                      startResolve(async () => {
                        const res = await resolveAppeal(a.id);
                        if (res.ok) {
                          toast.success("Appeal closed ✅");
                          router.refresh();
                        } else toast.error(res.error);
                      })
                    }
                  >
                    Mark resolved
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- the numbers ---------------- */}
      <div className="grid grid-cols-2 gap-2 rise-in rise-in-1 sm:grid-cols-6">
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Attendance rate</p>
            <p className="text-2xl font-bold tabular-nums text-primary">{totals.rate}%</p>
          </CardContent>
        </Card>
        {kpi.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-3">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <k.icon className="size-3.5" /> {k.label}
              </p>
              <p className="text-2xl font-bold tabular-nums">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ---------------- filters ---------------- */}
      <div className={cn("flex flex-wrap items-center gap-2 rise-in rise-in-2", navPending && "nav-pending")}>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input
            type="date"
            className="h-9 w-36"
            value={filters.from}
            onChange={(e) => setParam("from", e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input
            type="date"
            className="h-9 w-36"
            value={filters.to}
            onChange={(e) => setParam("to", e.target.value)}
          />
        </div>
        <Select value={filters.kind || "all"} onValueChange={(v) => setParam("kind", v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status || "all"} onValueChange={(v) => setParam("status", v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {ATTENDANCE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filters.from || filters.to || filters.kind || filters.status ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => startNav(() => router.replace("/attendance"))}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {/* ---------------- history ---------------- */}
      {history.length === 0 ? (
        <Card className="rise-in rise-in-3">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nothing recorded yet. Attendance shows up here the moment a touch
            point is filled in.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* phones: cards */}
          <div className="space-y-2 rise-in rise-in-3 md:hidden">
            {sortedHistory.map((r) => (
              <Card key={r.id}>
                <CardContent className="space-y-1.5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" dir="auto">{r.label}</p>
                      <p className="truncate text-xs text-muted-foreground" dir="auto">
                        {cairoDay(r.startsAt)} · {cairoTime(r.startsAt)} · {r.audience}
                      </p>
                    </div>
                    <StatusChip status={r.status} excused={r.excused} />
                  </div>
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {r.mine ? "You" : r.memberName}
                    {r.automatic ? " · recorded automatically" : ""}
                  </p>
                  {r.excuse ? (
                    <p className="break-words text-xs italic text-muted-foreground" dir="auto">“{r.excuse}”</p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {r.mine && !r.appeal && r.status !== "attended" ? (
                      <Button size="sm" variant="outline" onClick={() => setAppealing(r)}>
                        <Hand className="size-3.5" /> Appeal
                      </Button>
                    ) : null}
                    {r.appeal ? (
                      <Badge variant="outline" className="text-[10px]">
                        {r.appeal.resolved ? "Appeal resolved" : "Appeal open"}
                      </Badge>
                    ) : null}
                    {r.canRecord ? (
                      <Button size="sm" variant="ghost" onClick={() => setRecording(r.touchPointId)}>
                        Edit record
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* desktop: one wide table */}
          <div className="hidden justify-end rise-in rise-in-3 md:flex">
            <TableSettings columns={cols} />
          </div>
          <div className="hidden overflow-x-auto rounded-lg border rise-in rise-in-3 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {cols.visible.map((c) =>
                    c.key === "actions" ? (
                      <ResizableHead key={c.key} colKey={c.key} cols={cols} className="text-right">
                        {c.label}
                      </ResizableHead>
                    ) : (
                      <ResizableHead key={c.key} colKey={c.key} cols={cols}>
                        <SortHeader
                          label={c.label}
                          onClick={() => toggleSort(c.key, c.key === "when" ? "desc" : "asc")}
                          active={sortKey === c.key}
                          dir={dir}
                        />
                      </ResizableHead>
                    )
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedHistory.map((r) => (
                  <TableRow key={r.id}>
                    {cols.visible.map((c) => (
                      <TableCell key={c.key} className={ATTENDANCE_CELL_CLASS[c.key]}>
                        {historyCell(r, c.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {total > 0 ? (
            <PageSizePicker
              value={pageSize}
              options={pageSizeOptions}
              onChange={(n) => setParam("size", String(n))}
            />
          ) : null}
          {total > pageSize ? (
            <div className="flex items-center justify-center gap-3 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || navPending}
                onClick={() => setParam("page", String(page))}
              >
                ← Prev
              </Button>
              <span className="tabular-nums">Page {page + 1} / {pages}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pages || navPending}
                onClick={() => setParam("page", String(page + 2))}
              >
                Next →
              </Button>
            </div>
          ) : null}
        </>
      )}

      {recording ? <RecordDialog touchPointId={recording} onClose={closeSheet} /> : null}
      {appealing ? <AppealDialog row={appealing} onClose={() => setAppealing(null)} /> : null}
    </div>
  );
}
