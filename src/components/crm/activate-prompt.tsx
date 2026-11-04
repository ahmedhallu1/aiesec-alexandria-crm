"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, Copy, ExternalLink, MapPin, Ticket, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cairoInstant, type ActivatePromptData } from "@/lib/war/model";

/** THE ACTIVATE REMINDER (v38.5). Opens once each time somebody opens Sodio
 *  (once per browser session — a fresh app open, not every page) for everyone
 *  the F&L VP hasn't ticked as registered, until the registration deadline.
 *  Skip closes it until the next open; Copy takes the payment number; the form
 *  opens in a new tab. It waits its turn behind any other dialog on screen.
 *  Who sees it and what it says: server/activate-prompt.ts, War Room → Activate. */

const SEEN_KEY = "sodio-activate-reminder";

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export function ActivatePrompt({
  data,
  preview = false,
  open: controlled,
  onOpenChange,
}: {
  data: ActivatePromptData;
  /** the War Room's preview: opened by hand, never remembered */
  preview?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [self, setSelf] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const open = preview ? !!controlled : self;
  const setOpen = (v: boolean) => (preview ? onOpenChange?.(v) : setSelf(v));

  useEffect(() => {
    if (preview) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY) === "1") return;
    } catch {
      /* no storage: show it, once for this page load */
    }
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const attempt = () => {
      // never on top of another dialog (a pending prompt, the tour) — wait
      if (document.querySelector('[role="dialog"]') && tries++ < 30) {
        t = setTimeout(attempt, 2000);
        return;
      }
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* fine */
      }
      setSelf(true);
    };
    t = setTimeout(attempt, 1200);
    return () => clearTimeout(t);
  }, [preview]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.payNumber.replace(/\s+/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* the number is on screen */
    }
  };

  const left = Math.max(0, Math.ceil((cairoInstant(data.deadline, "23:59") - openedAt) / 86_400_000));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Registration is open</p>
          <DialogTitle className="font-display text-2xl">🔥 {data.name}</DialogTitle>
          {data.announcement ? (
            <DialogDescription className="whitespace-pre-line text-left text-sm leading-relaxed text-foreground/90">
              {data.announcement}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Register for {data.name}</DialogDescription>
          )}
        </DialogHeader>

        <ul className="grid gap-2 text-sm">
          {data.dates ? (
            <li className="flex items-start gap-2">
              <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {data.dates}
            </li>
          ) : null}
          {data.location ? (
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {data.location}
            </li>
          ) : null}
          {data.fees || data.downPayment ? (
            <li className="flex items-start gap-2">
              <Ticket className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                {data.fees ? <>Fees {data.fees}</> : null}
                {data.fees && data.downPayment ? " · " : ""}
                {data.downPayment ? <>Down payment {data.downPayment}</> : null}
              </span>
            </li>
          ) : null}
        </ul>

        {data.payNumber ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 p-3">
            <Wallet className="size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">{data.payVia || "Pay to"}</p>
              <p className="font-mono text-lg font-semibold tracking-wide">{data.payNumber}</p>
            </div>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy number"}
            </Button>
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">
          Deadline <b className="text-foreground">{fmtDay(data.deadline)}</b>
          {left > 0 ? ` · ${left} day${left === 1 ? "" : "s"} left` : " · today"}
          {data.seatsTaken > 0 ? ` · ${data.seatsTaken} already on the bus` : ""}.{" "}
          <a href="/no-peace#delegation" target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
            See who&apos;s going
          </a>
        </p>
        {data.signedBy ? <p className="text-xs text-muted-foreground">— {data.signedBy}</p> : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Skip for now
          </Button>
          {data.formUrl ? (
            <Button asChild>
              <a href={data.formUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                <ExternalLink className="size-4" /> Open the form
              </a>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
