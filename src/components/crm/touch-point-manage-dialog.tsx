"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Save, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  cancelTouchPoint, touchPointGuestList, updateTouchPoint, updateTouchPointMembers,
} from "@/server/touch-points";
import { AudiencePicker, type AudiencePerson } from "./audience-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Everything the manage dialog needs — a structural subset of the calendar's
 *  touch-point DTO, so the page's rows pass straight through. */
export interface ManageableTouchPoint {
  id: string;
  label: string;
  /** Cairo calendar day, YYYY-MM-DD */
  date: string;
  /** Cairo start, 24h HH:MM (what the form edits) */
  timeValue: string;
  note: string | null;
  audience: string;
}

/** MOVE or CANCEL a booked touch point (v29). Both re-announce to the whole
 *  audience — the server owns the rules, this is just the way in. */
export function TouchPointManageDialog({
  tp,
  onClose,
}: {
  tp: ManageableTouchPoint;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState(tp.date);
  const [time, setTime] = useState(tp.timeValue);
  const [note, setNote] = useState(tp.note ?? "");
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  // EDITABLE AFTER BOOKING (v33.35) — people join, people drop out, and a
  // guest list that can only be set once stops matching reality by the second
  // day. Loaded on demand: the calendar page would otherwise carry an
  // audience for every touch point in the month.
  const [crew, setCrew] = useState<AudiencePerson[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [crewLocked, setCrewLocked] = useState(false);
  const [crewOpen, setCrewOpen] = useState(false);
  const [crewLoaded, setCrewLoaded] = useState(false);
  useEffect(() => {
    if (!crewOpen || crewLoaded) return;
    let alive = true;
    touchPointGuestList(tp.id)
      .then((res) => {
        if (!alive || !res.ok || !res.data) return;
        setCrew(res.data.people);
        setExcluded(res.data.excluded);
        setCrewLocked(res.data.locked);
      })
      .finally(() => alive && setCrewLoaded(true));
    return () => { alive = false; };
  }, [crewOpen, crewLoaded, tp.id]);

  const saveCrew = () =>
    start(async () => {
      const res = await updateTouchPointMembers(
        tp.id,
        excluded.length === 0 ? null : crew.filter((m) => !excluded.includes(m.id)).map((m) => m.id)
      );
      if (res.ok) {
        toast.success("Guest list updated — the attendance sheet follows it.");
        router.refresh();
      } else toast.error(res.error);
    });

  const moved = date !== tp.date || time !== tp.timeValue;

  const save = () =>
    start(async () => {
      if (!date || !time) {
        toast.error("Pick the date and start time.");
        return;
      }
      const res = await updateTouchPoint(tp.id, { date, time, note: note || null });
      if (res.ok) {
        toast.success(
          moved
            ? "Moved — everyone invited just heard about it 📣"
            : "Saved ✅"
        );
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });

  const cancel = () =>
    start(async () => {
      if (reason.trim().length < 3) {
        toast.error("Add a short reason — everyone invited reads it.");
        return;
      }
      const res = await cancelTouchPoint(tp.id, reason);
      if (res.ok) {
        toast.success("Cancelled — everyone invited was told why.");
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle dir="auto">{tp.label}</DialogTitle>
          <DialogDescription dir="auto">
            {tp.audience} — moving it or calling it off emails and bells
            everyone invited.
          </DialogDescription>
        </DialogHeader>

        {cancelling ? (
          <div className="grid gap-1.5">
            <Label>Why is it off? *</Label>
            <Textarea
              dir="auto"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Everyone invited reads this…"
              maxLength={500}
            />
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Date *</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Starts at *</Label>
                <Input
                  type="time"
                  step={900}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Cairo time.</p>
            <div className="grid gap-1.5">
              <Label>Note (optional)</Label>
              <Textarea
                dir="auto"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Agenda, place, anything they should know…"
                maxLength={500}
              />
            </div>

            {/* WHO IS COMING — editable, because a list set once stops
                matching reality by the second day (v33.35). Quiet: changing
                it doesn't re-announce; the attendance sheet just follows. */}
            <div className="grid gap-1.5 rounded-lg border border-border p-3">
              <button
                type="button"
                onClick={() => setCrewOpen((v) => !v)}
                className="flex items-center justify-between gap-2 text-left"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Users className="size-4" /> Who&apos;s invited
                    {crewLoaded ? (
                      <span className="rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary">
                        {crew.length - excluded.length}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {crewLocked
                      ? "Attendance is already recorded — the list is history now."
                      : "Add or remove people. Only the ticked ones are on the attendance sheet."}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium text-primary">
                  {crewOpen ? "Hide" : "Edit"}
                </span>
              </button>
              {crewOpen ? (
                <div className="border-t pt-2">
                  {crewLocked ? (
                    <p className="py-2 text-xs text-muted-foreground">
                      This one&apos;s register was signed off — changing who was
                      invited now would rewrite it.
                    </p>
                  ) : (
                    <>
                      <AudiencePicker
                        people={crew}
                        excluded={excluded}
                        onChange={setExcluded}
                        loading={!crewLoaded}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={saveCrew}
                        disabled={pending || !crewLoaded}
                      >
                        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        Save the guest list
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {cancelling ? (
            <>
              <Button variant="ghost" onClick={() => setCancelling(false)} disabled={pending}>
                Back
              </Button>
              <Button variant="destructive" onClick={cancel} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Cancel it
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setCancelling(true)} disabled={pending}>
                <Trash2 className="size-4" /> Cancel it
              </Button>
              <Button onClick={save} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : moved ? (
                  <CalendarClock className="size-4" />
                ) : (
                  <Save className="size-4" />
                )}
                {moved ? "Move it" : "Save"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
