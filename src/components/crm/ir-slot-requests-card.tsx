"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarPlus, Check, Loader2, X } from "lucide-react";
import { respondToIrSlotRequest } from "@/server/actions";
import type { IrSlotRequest } from "@/server/data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/** "CAN WE DO ANOTHER TIME?" — the asks that have no slot behind them.
 *
 *  The booking page can only offer what a host has already opened, so an IR
 *  eight zones away used to hit a dead end. These are the times they asked
 *  for instead. Accepting books it for real — calendar invite, Meet link, the
 *  same confirmation any other booking sends. Declining tells them, with
 *  whatever you want to say. */
export function IrSlotRequestsCard({
  requests,
  showHost,
}: {
  requests: IrSlotRequest[];
  /** leads see the whole floor's asks, so the row has to say whose it is */
  showHost: boolean;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  if (requests.length === 0) return null;

  const respond = (r: IrSlotRequest, decision: "accept" | "decline") =>
    start(async () => {
      setBusy(r.id);
      const res = await respondToIrSlotRequest(r.id, decision, decision === "decline" ? comment : null);
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpenFor(null);
      setComment("");
      toast.success(
        decision === "accept"
          ? `Booked — ${r.bookerName} has the invite and the Meet link.`
          : `${r.bookerName} has been told, and pointed at your open times.`
      );
    });

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <CalendarPlus className="size-4 text-primary" />
          Times you don&apos;t have open
          <Badge className="border-transparent bg-primary/15 text-primary">{requests.length}</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          None of your open slots worked for them, so they asked for these. Nothing is booked
          until you say yes.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 font-semibold" dir="auto">
                {r.lcName}
              </span>
              {r.country ? (
                <Badge variant="secondary" className="font-normal">{r.country}</Badge>
              ) : null}
              {showHost && r.hostName ? (
                <Badge variant="outline" className="font-normal">for {r.hostName}</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm">
              <b>{r.cairoLabel}</b> <span className="text-muted-foreground">Cairo · {r.minutes} min</span>
            </p>
            {r.theirLabel ? (
              <p className="text-xs text-muted-foreground">{r.theirLabel} their time</p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {r.bookerName}
              {r.bookerRole ? ` · ${r.bookerRole}` : ""} · {r.bookerEmail}
              {r.bookerPhone ? ` · ${r.bookerPhone}` : ""}
            </p>
            {r.note ? (
              <p className="mt-2 rounded-md bg-muted/60 p-2 text-sm" dir="auto">
                {r.note}
              </p>
            ) : null}

            {openFor === r.id ? (
              <div className="mt-3 grid gap-2">
                <Label className="text-xs">
                  Anything to tell them? (optional — it reaches them word for word)
                </Label>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  placeholder="e.g. I'm in class then — any evening that week works."
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="destructive" disabled={busy === r.id}
                    onClick={() => respond(r, "decline")}>
                    {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                    Send the decline
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setOpenFor(null); setComment(""); }}>
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy === r.id} onClick={() => respond(r, "accept")}>
                  {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Accept &amp; book it
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setOpenFor(r.id); setComment(""); }}>
                  <X className="size-4" /> Can&apos;t make it
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
