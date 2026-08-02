"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cancelTouchPoint, updateTouchPoint } from "@/server/touch-points";
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
