"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { logContact, setOutOfProcess } from "@/server/actions";
import type { ContactMethod } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Mail, Phone } from "lucide-react";
import { WhatsAppIcon } from "./icons";

const METHODS: ContactMethod[] = ["Call", "WhatsApp", "Email"];
/** results offered in the UI ("Call Scheduled" is legacy-only) */
const STATUSES = [
  "No Response", "Responded", "Interested", "Not Interested", "Wrong Contact", "Visit Scheduled",
] as const;
type UiStatus = (typeof STATUSES)[number];

export interface ContactTarget {
  id: string;
  name: string;
  hasPendingVisit: boolean;
  nextStepDate: string | null;
}

/** The Contact button flow: log method + result + comment. "Call Scheduled"
 *  captures the call's date + time (that becomes the next step). Enforces the
 *  next-step obligation and triggers the 3-contact-limit prompt. */
export function ContactDialog({
  target, open, onOpenChange,
}: {
  target: ContactTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [method, setMethod] = useState<ContactMethod>("Call");
  const [status, setStatus] = useState<UiStatus>("No Response");
  const [comment, setComment] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [nextStepDate, setNextStepDate] = useState("");
  const [nextStepTime, setNextStepTime] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [limitPrompt, setLimitPrompt] = useState(false);
  const [oopReason, setOopReason] = useState("");
  const [pending, startTransition] = useTransition();

  if (!target) return null;

  const isVisitScheduled = status === "Visit Scheduled";
  const isNotInterested = status === "Not Interested";
  const today = new Date().toISOString().slice(0, 10);
  const nextStepAlreadySet = !!target.nextStepDate && target.nextStepDate >= today;
  const nextStepRequired =
    !isVisitScheduled && !isNotInterested && !target.hasPendingVisit && !nextStepAlreadySet;

  const reset = () => {
    setMethod("Call"); setStatus("No Response"); setComment("");
    setNextStep(""); setNextStepDate(""); setNextStepTime("");
    setScheduledDate(""); setScheduledTime("");
    setLimitPrompt(false); setOopReason("");
  };

  const submit = () =>
    startTransition(async () => {
      const res = await logContact({
        accountId: target.id,
        method,
        status,
        comment: comment || undefined,
        nextStep: nextStep || undefined,
        nextStepDate: nextStepDate || undefined,
        nextStepTime: nextStepTime || undefined,
        scheduledDate: scheduledDate || undefined,
        scheduledTime: scheduledTime || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data?.contactLimitReached) {
        setLimitPrompt(true);
        return;
      }
      toast.success(
        isNotInterested
          ? `"${target.name}" archived — not interested. Its name can't be added again.`
          : isVisitScheduled
            ? `Visit booked for ${scheduledDate} ${scheduledTime} — calendar reminders set 🗓️`
            : `Contact #${res.data?.attempts ?? ""} logged`
      );
      reset();
      onOpenChange(false);
    });

  const markOop = () =>
    startTransition(async () => {
      const res = await setOutOfProcess(
        target.id,
        oopReason || "No answer after 3 contact attempts"
      );
      if (res.ok) toast.success("Account archived (Out of Process)");
      else toast.error(res.error);
      reset();
      onOpenChange(false);
    });

  const keepTrying = () => {
    toast.success("Contact logged — account stays in process");
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        {!limitPrompt ? (
          <>
            <DialogHeader>
              <DialogTitle>Log a contact — {target.name}</DialogTitle>
              <DialogDescription>
                Every attempt counts. After 3 without an answer, the account
                must get an Out-of-Process decision.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>How?</Label>
                  <Select value={method} onValueChange={(v) => setMethod(v as ContactMethod)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          <span className="inline-flex items-center gap-1.5">
                            {m === "Call" ? (
                              <Phone className="size-3.5" />
                            ) : m === "WhatsApp" ? (
                              <WhatsAppIcon className="size-3.5 text-[#25D366]" />
                            ) : (
                              <Mail className="size-3.5" />
                            )}
                            {m}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Result</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as UiStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s === "Visit Scheduled" ? "🗓️ " : ""}{s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isNotInterested ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <p className="font-semibold text-destructive">
                    ⚠️ Saving this archives the account
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    “Not Interested” closes the account automatically: it moves
                    to the archive (Out of Process) and its name can never be
                    added again. Your comment goes on the record as the reason.
                  </p>
                </div>
              ) : null}

              {isVisitScheduled ? (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
                  <p className="mb-2 text-sm font-medium">
                    Visit date &amp; time <span className="text-destructive">*required</span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="date" min={today} value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
                    <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Books the visit exactly like the <b>Schedule visit</b> button —
                    calendar reminders 24h &amp; 1h before included.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label>Comment</Label>
                <Textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="What was said, who you reached…"
                />
              </div>

              {!isVisitScheduled && !isNotInterested ? (
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-sm font-medium">
                    Next step{" "}
                    {nextStepRequired ? (
                      <span className="text-destructive">*required — no visit is scheduled</span>
                    ) : (
                      <span className="text-muted-foreground">(optional)</span>
                    )}
                  </p>
                  <div className="grid gap-2">
                    <Input
                      value={nextStep}
                      onChange={(e) => setNextStep(e.target.value)}
                      placeholder="e.g. Follow-up call with the manager"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="date" min={today} value={nextStepDate} onChange={(e) => setNextStepDate(e.target.value)} />
                      <Input type="time" value={nextStepTime} onChange={(e) => setNextStepTime(e.target.value)} />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                onClick={submit}
                variant={isNotInterested ? "destructive" : "default"}
                disabled={
                  pending ||
                  (isVisitScheduled && (!scheduledDate || !scheduledTime)) ||
                  (nextStepRequired && (!nextStepDate || !nextStep.trim()))
                }
              >
                {pending ? "Saving…" : isNotInterested ? "Log & archive account" : "Log contact"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>⚠️ 3 contacts, no answer</DialogTitle>
              <DialogDescription>
                <b>{target.name}</b> has been contacted 3+ times without a final
                answer. Per LC rules it should be routed for closure — or keep
                it alive deliberately.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label>Reason (goes on the record)</Label>
              <Input
                value={oopReason}
                onChange={(e) => setOopReason(e.target.value)}
                placeholder="No answer after 3 contact attempts"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={keepTrying} disabled={pending}>
                Keep in process
              </Button>
              <Button variant="destructive" onClick={markOop} disabled={pending}>
                {pending ? "Saving…" : "Archive (Out of Process)"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
