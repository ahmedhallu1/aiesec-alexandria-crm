"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { logContact, setOutOfProcess } from "@/server/actions";
import type { ContactMethod, ContactStatus } from "@/lib/types";
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

const METHODS: ContactMethod[] = ["Call", "WhatsApp", "Email"];
const STATUSES: ContactStatus[] = [
  "No Response", "Responded", "Interested", "Not Interested", "Wrong Contact",
];

export interface ContactTarget {
  id: string;
  name: string;
  hasPendingVisit: boolean;
  nextStepDate: string | null;
}

/** The Contact button flow: log method + status + comment. Enforces the
 *  next-step obligation and triggers the 3-contact-limit prompt. */
export function ContactDialog({
  target, open, onOpenChange,
}: {
  target: ContactTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [method, setMethod] = useState<ContactMethod>("Call");
  const [status, setStatus] = useState<ContactStatus>("No Response");
  const [comment, setComment] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [nextStepDate, setNextStepDate] = useState("");
  const [nextStepTime, setNextStepTime] = useState("");
  const [limitPrompt, setLimitPrompt] = useState(false);
  const [oopReason, setOopReason] = useState("");
  const [pending, startTransition] = useTransition();

  if (!target) return null;

  const today = new Date().toISOString().slice(0, 10);
  const nextStepAlreadySet = !!target.nextStepDate && target.nextStepDate >= today;
  const nextStepRequired = !target.hasPendingVisit && !nextStepAlreadySet;

  const reset = () => {
    setMethod("Call"); setStatus("No Response"); setComment("");
    setNextStep(""); setNextStepDate(""); setNextStepTime("");
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
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data?.contactLimitReached) {
        setLimitPrompt(true);
        return;
      }
      toast.success(`Contact #${res.data?.attempts ?? ""} logged`);
      reset();
      onOpenChange(false);
    });

  const markOop = () =>
    startTransition(async () => {
      const res = await setOutOfProcess(
        target.id,
        oopReason || "No answer after 3 contact attempts"
      );
      if (res.ok) toast.success("Account marked Out of Process");
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
                          {m === "Call" ? "📞" : m === "WhatsApp" ? "💬" : "✉️"} {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Result</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as ContactStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Comment</Label>
                <Textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="What was said, who you reached…"
                />
              </div>
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
            </div>
            <DialogFooter>
              <Button
                onClick={submit}
                disabled={pending || (nextStepRequired && (!nextStepDate || !nextStep.trim()))}
              >
                {pending ? "Saving…" : "Log contact"}
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
                {pending ? "Saving…" : "Mark Out of Process"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
