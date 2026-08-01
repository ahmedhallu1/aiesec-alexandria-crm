"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarCheck2, CalendarClock, Clock, Loader2, Video, X,
} from "lucide-react";
import { cancelBookedCall, rescheduleBookedCall } from "@/server/actions";
import type { BookingDay, ManageBookingData } from "@/server/data";
import { cn } from "@/lib/utils";
import { BookingCredit } from "./booking-view";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STATUS_CHIP: Record<
  ManageBookingData["status"],
  { label: string; className: string }
> = {
  scheduled: { label: "Scheduled", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  completed: { label: "Completed", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

/** The PUBLIC /book/manage/<token> experience (v28): the IR sees their
 *  booking (who/when/Meet/status) and — while it's still scheduled — can
 *  RESCHEDULE onto the member's current free slots or CANCEL with a short
 *  reason. Cancelled/completed bookings show their state, actions disabled. */
export function ManageBookingView({
  token, data,
}: {
  token: string;
  data: ManageBookingData;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"none" | "reschedule" | "cancel">(
    data.rescheduleRequested && data.status === "scheduled" ? "reschedule" : "none"
  );
  const [dayIdx, setDayIdx] = useState(0);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const days: BookingDay[] = data.days;
  const day = days[Math.min(dayIdx, Math.max(0, days.length - 1))];
  const slot = day?.slots.find((s) => s.iso === slotIso) ?? null;

  const doReschedule = () =>
    start(async () => {
      if (!slotIso) {
        toast.error("Pick a new time slot first.");
        return;
      }
      const res = await rescheduleBookedCall({ token, startIso: slotIso });
      if (res.ok && res.data) {
        setMovedTo(res.data.whenLabel);
        setMode("none");
        router.refresh();
      } else if (!res.ok) toast.error(res.error);
    });

  const doCancel = () =>
    start(async () => {
      if (!reason.trim()) {
        toast.error("Tell them briefly why — it goes into their heads-up email.");
        return;
      }
      const res = await cancelBookedCall({ token, reason });
      if (res.ok) {
        setCancelled(true);
        setMode("none");
        router.refresh();
      } else if (!res.ok) toast.error(res.error);
    });

  const status = cancelled ? "cancelled" : data.status;
  const chip = STATUS_CHIP[status];
  const active = status === "scheduled";

  return (
    <div className="rise-in relative z-10 w-full max-w-2xl rounded-2xl bg-card p-6 shadow-2xl md:p-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/aiesec-blue.png" alt="AIESEC" className="mx-auto mb-4 h-10 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/aiesec-white.png" alt="AIESEC" className="mx-auto mb-4 hidden h-10 w-auto dark:block" />

      <h1 className="text-center text-2xl font-bold text-card-foreground">
        Your IR call with <span className="text-primary">{data.memberName}</span>
      </h1>
      <p className="mt-1 flex items-center justify-center gap-1 text-center text-xs font-medium text-muted-foreground">
        <Clock className="size-3.5" /> Times are in Cairo (GMT+2/+3)
      </p>

      <div className="mt-5 space-y-2 rounded-xl border p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-card-foreground" dir="auto">
            {data.partnerLc}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", chip.className)}>
            {chip.label}
          </span>
        </div>
        <p className="text-muted-foreground">
          <CalendarClock className="mr-1 inline size-4 align-[-2px]" />
          {movedTo ?? data.whenLabel} · {data.durationMinutes} minutes
        </p>
        {status === "cancelled" && (data.cancelReason || reason.trim()) ? (
          <p className="text-muted-foreground" dir="auto">
            Reason: {data.cancelReason ?? reason.trim()}
          </p>
        ) : null}
        {active && data.meetLink ? (
          <a
            href={data.meetLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Video className="size-4" /> Join the Google Meet
          </a>
        ) : null}
      </div>

      {movedTo ? (
        <p className="mt-4 rounded-lg bg-emerald-500/10 p-3 text-center text-sm font-medium text-emerald-700 dark:text-emerald-400">
          Moved to {movedTo} 🎉 — a fresh confirmation is on its way to your email.
        </p>
      ) : null}

      {status === "cancelled" ? (
        <div className="mt-4 text-center text-sm text-muted-foreground">
          <p>This booking was cancelled{cancelled ? " — the team was notified" : ""}.</p>
          {data.bookingUrl ? (
            <a
              href={data.bookingUrl}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <CalendarCheck2 className="size-4" /> Book a new call
            </a>
          ) : null}
        </div>
      ) : null}
      {status === "completed" ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          This call already happened — thanks for meeting {data.memberName}! 🌍
        </p>
      ) : null}

      {active ? (
        <>
          {data.rescheduleRequested && !movedTo ? (
            <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-center text-sm font-medium text-amber-700 dark:text-amber-400">
              {data.memberName} asked to move this call — pick a new time below. 🙏
            </p>
          ) : null}

          {/* action switch */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              variant={mode === "reschedule" ? "default" : "outline"}
              onClick={() => setMode(mode === "reschedule" ? "none" : "reschedule")}
            >
              <CalendarClock className="size-4" /> Reschedule
            </Button>
            <Button
              variant={mode === "cancel" ? "destructive" : "outline"}
              onClick={() => setMode(mode === "cancel" ? "none" : "cancel")}
            >
              <X className="size-4" /> Cancel the call
            </Button>
          </div>

          {mode === "reschedule" ? (
            days.length === 0 ? (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                No other free slots right now — check back later, or reply to
                your confirmation email to sort it out directly.
              </p>
            ) : (
              <div className="mt-4">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {days.map((d, i) => {
                    const on = i === dayIdx;
                    return (
                      <button
                        key={d.date}
                        type="button"
                        onClick={() => {
                          setDayIdx(i);
                          setSlotIso(null);
                        }}
                        className={cn(
                          "shrink-0 rounded-xl border px-3.5 py-2 text-center transition-colors",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background text-card-foreground hover:border-primary/50"
                        )}
                      >
                        <span className="block text-sm font-bold">{d.label}</span>
                        <span className={cn("block text-[11px]", on ? "text-primary-foreground/80" : "text-muted-foreground")}>
                          {d.slots.length} slot{d.slots.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {day?.slots.map((s) => {
                    const on = s.iso === slotIso;
                    return (
                      <button
                        key={s.iso}
                        type="button"
                        onClick={() => setSlotIso(on ? null : s.iso)}
                        className={cn(
                          "rounded-lg border px-2 py-2 text-sm font-semibold transition-colors",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background text-card-foreground hover:border-primary/50"
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                <Button
                  className="mt-4 h-11 w-full text-base font-bold"
                  onClick={doReschedule}
                  disabled={pending || !slotIso}
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CalendarCheck2 className="size-4" />
                  )}
                  {slot && day ? `Move to ${day.label} · ${slot.label}` : "Pick the new slot"}
                </Button>
              </div>
            )
          ) : null}

          {mode === "cancel" ? (
            <div className="mt-4 space-y-2">
              <Label htmlFor="mb-reason">Why are you cancelling? *</Label>
              <Textarea
                id="mb-reason"
                dir="auto"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="A short reason for the team in Alexandria…"
                rows={2}
                maxLength={500}
              />
              <Button
                variant="destructive"
                className="h-11 w-full text-base font-bold"
                onClick={doCancel}
                disabled={pending || !reason.trim()}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                Cancel this call
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Powered by Elevate · AIESEC in Alexandria
      </p>
      <BookingCredit />
    </div>
  );
}
