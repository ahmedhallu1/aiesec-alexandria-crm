"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlarmClock, ArrowRight } from "lucide-react";
import { getMyPendingPrompt } from "@/server/attendance";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/** THE MUST-DO PROMPT (v29) — the last rung of the reminder ladder.
 *
 *  After three ignored reminders the cron files a `pending_prompts` row and
 *  this dialog meets the member on their next app open. It's generic on
 *  purpose (kind + title/body/link): attendance is just the first thing the
 *  LC must not be able to forget.
 *
 *  There is exactly ONE escape per day — "Later today" hides it until the
 *  next Cairo day; after that it comes back until the record lands. */

const SNOOZE_KEY = "sodio-pending-snooze";

/** Cairo's "today" on the client — the LC lives on Cairo wall-clock. */
const cairoToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

interface Prompt {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
}

export function PendingPrompt() {
  const router = useRouter();
  const pathname = usePathname();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [open, setOpen] = useState(false);
  // the landing route, captured once — the effect must run per APP OPEN, not
  // per navigation (a check on every route change would nag them mid-flow)
  const landedOn = useRef(pathname);

  useEffect(() => {
    let alive = true;
    (async () => {
      // already escaped today — leave them alone until tomorrow
      try {
        if (localStorage.getItem(SNOOZE_KEY) === cairoToday()) return;
      } catch {
        /* private mode — the prompt simply always shows */
      }
      const row = await getMyPendingPrompt().catch(() => null);
      if (!alive || !row) return;
      // don't nag them ON the page that clears it
      if (row.link && landedOn.current && row.link.split("?")[0] === landedOn.current) return;
      setPrompt({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        link: row.link,
      });
      setOpen(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, cairoToday());
    } catch {
      /* private mode — it'll ask again on the next navigation */
    }
    setOpen(false);
  };

  if (!prompt) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && snooze()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" dir="auto">
            <AlarmClock className="size-5 text-primary" />
            {prompt.title}
          </DialogTitle>
          <DialogDescription dir="auto">
            {prompt.body ??
              "This one has been waiting a while — it takes a minute, and then it's gone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={snooze}>
            Later today
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              router.push(prompt.link || "/attendance");
            }}
          >
            Take me there <ArrowRight className="size-4" />
          </Button>
        </DialogFooter>
        <p className="text-center text-[11px] text-muted-foreground">
          One postponement a day — after that Sodio asks again. 💙
        </p>
      </DialogContent>
    </Dialog>
  );
}
