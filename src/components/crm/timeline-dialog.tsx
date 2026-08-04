"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Loader2, Repeat, Trash2, Video } from "lucide-react";
import { deleteTimeline, listTimelines, saveTimeline } from "@/server/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** THE TIMELINE (v32.9) — the routine a Team Leader / VP / TM VP keeps across
 *  the peak: "team meeting every Tuesday 19:00", "working hours every
 *  Saturday". Saving one books EVERY occurrence up front, so the whole peak is
 *  on the calendar from day one — and because each one is a normal touch
 *  point, any single date can be moved when exams or a clash happen without
 *  disturbing the rest of the series. */
const DAYS = [
  { v: 6, label: "Saturday" },
  { v: 0, label: "Sunday" },
  { v: 1, label: "Monday" },
  { v: 2, label: "Tuesday" },
  { v: 3, label: "Wednesday" },
  { v: 4, label: "Thursday" },
  { v: 5, label: "Friday" },
];

interface Row {
  id: string;
  scope: string;
  kind: string;
  weekday: number;
  time: string;
  virtual?: boolean;
  startsOn: string;
  endsOn: string;
  occurrences: number;
}

export function TimelineDialog({
  scopes,
  functionKey,
  teamName,
}: {
  /** the scopes this viewer may book — same matrix as a single touch point */
  scopes: string[];
  functionKey?: string | null;
  teamName?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pending, start] = useTransition();

  const [scope, setScope] = useState(scopes[0] ?? "team");
  const [kind, setKind] = useState("meeting");
  const [weekday, setWeekday] = useState(2);
  const [time, setTime] = useState("19:00");
  const [virtual, setVirtual] = useState(false);
  const [note, setNote] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().slice(0, 10);
  });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void listTimelines().then((res) => {
      if (alive && res.ok) setRows((res.data ?? []) as Row[]);
    });
    return () => { alive = false; };
  }, [open]);

  const save = () =>
    start(async () => {
      const res = await saveTimeline({
        scope, kind, functionKey, teamName,
        weekday, time, virtual, note, startsOn, endsOn,
      });
      if (!res.ok) { toast.error(res.error); return; }
      const { created, skipped } = res.data ?? { created: 0, skipped: 0 };
      toast.success(
        `Timeline saved — ${created} touch point${created === 1 ? "" : "s"} booked${
          skipped ? ` · ${skipped} skipped` : ""
        } 🗓️`
      );
      setRows(null);
      const again = await listTimelines();
      if (again.ok) setRows((again.data ?? []) as Row[]);
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      const res = await deleteTimeline(id);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Timeline removed — future dates cleared, the past kept.");
      setRows((r) => (r ?? []).filter((x) => x.id !== id));
      router.refresh();
    });

  if (scopes.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Repeat className="size-4" /> Timeline
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your timeline</DialogTitle>
          <DialogDescription>
            The routine you keep across the peak. Saving books every date up
            front — move any single one later if something comes up.
          </DialogDescription>
        </DialogHeader>

        {rows && rows.length > 0 ? (
          <div className="space-y-1.5 rounded-lg border p-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {r.kind.replace("_", " ")} · every{" "}
                  {DAYS.find((d) => d.v === r.weekday)?.label} {r.time}
                  {r.virtual ? " · virtual" : ""}
                  <span className="text-muted-foreground">
                    {" "}— {r.occurrences} booked
                  </span>
                </span>
                <Button
                  size="icon" variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  disabled={pending}
                  onClick={() => remove(r.id)}
                  aria-label="Remove this timeline"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {scopes.length > 1 ? (
              <div className="grid gap-1.5">
                <Label>Who</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {scopes.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s === "lc" ? "The whole LC" : s === "function" ? "My function" : "My team"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label>What</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="working_hours">Working hours</SelectItem>
                  <SelectItem value="outing">Outing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Every</Label>
              <Select value={String(weekday)} onValueChange={(v) => setWeekday(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d) => (
                    <SelectItem key={d.v} value={String(d.v)}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>At (Cairo)</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>From</Label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Until</Label>
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Video className="size-4" /> Virtual
              </span>
              <span className="text-xs text-muted-foreground">
                Sends a Google Calendar invite with a Meet link — and everyone&apos;s
                Yes/No on it pre-fills the attendance.
              </span>
            </span>
            <Switch checked={virtual} onCheckedChange={setVirtual} />
          </label>
          <div className="grid gap-1.5">
            <Label>Note (optional)</Label>
            <Textarea
              rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the team should know each time"
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Repeat className="size-4" />}
            Save &amp; book the peak
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
