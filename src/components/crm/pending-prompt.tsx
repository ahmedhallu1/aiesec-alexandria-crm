"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlarmClock, ArrowRight } from "lucide-react";
import { getMyPendingPrompt } from "@/server/attendance";
import { answerImPrompt, rateTouchPointFromPrompt, skipPrompt } from "@/server/prompts";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { cairoToday } from "@/lib/types";
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


interface Prompt {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  /** IM prompts only: what (if anything) is captured back */
  responseKind?: "none" | "acknowledge" | "rating" | "text" | null;
  responseLabel?: string | null;
  dismissible?: boolean;
}

/** Five taps, no scale to interpret. Same control as the Feedback page.
 *  Exported so the admin's prompt PREVIEW (im-prompt-preview.tsx) renders the
 *  identical widget rather than a lookalike that can drift from it. */
export function Stars({ value, onPick }: { value: number; onPick: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => {
            // (v37.8) a tap fires an emulated mouseenter that left `hover` stuck on
            // this star, so un-picking (tap it again) still looked filled
            setHover(0);
            onPick(n === value ? 0 : n);
          }}
          className="rounded p-0.5 text-3xl leading-none transition-transform hover:scale-110"
        >
          <span className={(hover || value) >= n ? "opacity-100" : "opacity-30"}>
            {(hover || value) >= n ? "⭐" : "☆"}
          </span>
        </button>
      ))}
    </div>
  );
}

export function PendingPrompt() {
  const router = useRouter();
  const pathname = usePathname();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
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
        responseKind: row.responseKind ?? null,
        responseLabel: row.responseLabel ?? null,
        dismissible: row.dismissible ?? true,
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

  /** THE SKIP LADDER (v34.7). Skipping is not the same as postponing: the
   *  first skip says why the answer matters and the prompt returns TOMORROW;
   *  the second retires it for good. The count lives on the row, so it
   *  survives a new device and a cleared browser. */
  const doSkip = () =>
    start(async () => {
      const res = await skipPrompt(prompt!.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      if (res.comingBack) {
        toast.info(
          "Your feedback is crucial to us 💜 — we'll ask once more tomorrow, then leave it."
        );
      }
    });

  const submitRating = () =>
    start(async () => {
      const res = await rateTouchPointFromPrompt(prompt!.id, stars, note);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success("Thank you — that's it, four seconds. 💜");
    });

  const submitAnswer = () =>
    start(async () => {
      const res = await answerImPrompt(prompt!.id, { rating: stars, text: note });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success("Sent — thank you. 💜");
    });

  if (!prompt) return null;

  const isRating = prompt.kind === "touchpoint_rating";
  const isIm = prompt.kind === "im_prompt";
  // v36 — a PDP nag. It has the shape of a must-do (a link to go and do the
  // thing) but it is SKIPPABLE, deliberately: a one-on-one is a conversation
  // to arrange with another human, not a form to fill in on the spot, and a
  // leader who cannot dismiss it will learn to click past whatever appears in
  // this dialog — which would cost the attendance must-dos their authority too.
  const isPdp = prompt.kind === "pdp";
  const wants = prompt.responseKind ?? "none";
  // an attendance prompt is a must-do and has never been skippable; an IM
  // prompt is skippable only if its author allowed it
  const canSkip = isRating || isPdp || (isIm && prompt.dismissible !== false);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) return;
        if (isRating || isIm || isPdp) doSkip();
        else snooze();
      }}
    >
      <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto p-4 sm:max-w-md sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" dir="auto">
            <AlarmClock className="size-5 text-primary" />
            {prompt.title}
          </DialogTitle>
          <DialogDescription dir="auto" className="whitespace-pre-wrap">
            {/* an IM prompt's TITLE is usually the whole message (v34.8) — the
                detail box is optional, so there is nothing to apologise for
                when it is empty. The nudge line belongs to the must-dos. */}
            {prompt.body ||
              (isIm
                ? ""
                : "This one has been waiting a while — it takes a minute, and then it's gone.")}
          </DialogDescription>
        </DialogHeader>

        {isRating || (isIm && wants === "rating") ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">
              {isRating ? "How was it?" : prompt.responseLabel || "How would you rate it?"}
            </p>
            <Stars value={stars} onPick={setStars} />
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything to add? (optional)"
            />
          </div>
        ) : null}

        {isIm && wants === "text" ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">{prompt.responseLabel || "Your answer"}</p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Type your answer…"
            />
          </div>
        ) : null}

        <DialogFooter>
          {canSkip ? (
            <Button variant="ghost" onClick={doSkip} disabled={pending}>
              Skip
            </Button>
          ) : null}
          {!isRating && !isIm ? (
            <>
              {/* a PDP prompt already has Skip; a second "later" button on the
                  same dialog is two ways to do nothing */}
              {isPdp ? null : (
                <Button variant="ghost" onClick={snooze}>
                  Later today
                </Button>
              )}
              <Button
                onClick={() => {
                  setOpen(false);
                  router.push(prompt.link || "/attendance");
                }}
              >
                Take me there <ArrowRight className="size-4" />
              </Button>
            </>
          ) : null}
          {isRating ? (
            <Button onClick={submitRating} disabled={pending || stars < 1}>
              Send the rating ⭐
            </Button>
          ) : null}
          {isIm ? (
            <Button
              onClick={submitAnswer}
              disabled={pending || (wants === "rating" && stars < 1) || (wants === "text" && !note.trim())}
            >
              {wants === "none" || wants === "acknowledge" ? "Got it" : "Send"}
            </Button>
          ) : null}
        </DialogFooter>
        <p className="text-center text-[11px] text-muted-foreground">
          {isRating || isIm || isPdp
            ? "Skip and we ask once more tomorrow — then never again. 💜"
            : "One postponement a day — after that Sodio asks again. 💜"}
        </p>
      </DialogContent>
    </Dialog>
  );
}
