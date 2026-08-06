"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import { createCalendarItem } from "@/server/calendar-items";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** CUSTOM CALENDAR ITEM (v33.16) — a Google-Calendar-style slot or task with
 *  an explicit assignee list. TLs pick from their team, VPs/Directors from
 *  their function, LCP-level from the whole LC (the server re-checks). */
export function CalendarItemDialog({
  assignables, viewerId, defaultDate, open, onOpenChange,
}: {
  assignables: { id: string; label: string }[];
  viewerId: string;
  defaultDate?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const controlled = open !== undefined;
  const [selfOpen, setSelfOpen] = useState(false);
  const isOpen = controlled ? open : selfOpen;
  const setOpen = controlled ? (onOpenChange ?? (() => {})) : setSelfOpen;

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate ?? today);
  const [time, setTime] = useState("18:00");
  const [endTime, setEndTime] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? assignables.filter((a) => a.label.toLowerCase().includes(needle))
      : assignables;
  }, [assignables, q]);
  const allPicked = picked.size === assignables.length && assignables.length > 0;

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    start(async () => {
      const res = await createCalendarItem({
        title,
        date,
        time,
        endTime: endTime || null,
        note: note || null,
        assigneeIds: [...picked],
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        picked.size > 0
          ? `"${title.trim()}" added — ${picked.size} ${picked.size === 1 ? "person" : "people"} notified 🔔`
          : `"${title.trim()}" added to your calendar`
      );
      setTitle(""); setEndTime(""); setNote(""); setPicked(new Set()); setQ("");
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {!controlled ? (
        <DialogTrigger asChild>
          <Button variant="outline" className="h-9">
            <CalendarPlus className="size-4" /> Add item
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a calendar item</DialogTitle>
          <DialogDescription>
            A custom slot or task — it lands on your calendar and on everyone
            you assign (they get a bell). Cairo time.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>What is it?</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Market research sprint, CV screening, booth shift…"
              maxLength={120}
              dir="auto"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>From</Label>
              <Input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>To (optional)</Label>
              <Input type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything the assignees should know"
              dir="auto"
            />
          </div>
          {assignables.length > 0 ? (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Assign to</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setPicked(allPicked ? new Set() : new Set(assignables.map((a) => a.id)))
                  }
                >
                  {allPicked ? "Clear all" : `Everyone (${assignables.length})`}
                </Button>
              </div>
              {assignables.length > 8 ? (
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search people…"
                  className="h-8"
                />
              ) : null}
              <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
                {shown.map((a) => (
                  <label
                    key={a.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60",
                      picked.has(a.id) && "bg-primary/5 font-medium"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-[var(--primary)]"
                      checked={picked.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {a.label}
                      {a.id === viewerId ? (
                        <span className="text-muted-foreground"> (you)</span>
                      ) : null}
                    </span>
                  </label>
                ))}
                {shown.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    Nobody matches that search.
                  </p>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Leave everyone unticked to keep it on your calendar only.
              </p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !title.trim() || !date || !time}>
            {pending ? "Adding…" : "Add to calendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
