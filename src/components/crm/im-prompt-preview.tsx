"use client";

import { useState } from "react";
import { AlarmClock, Eye } from "lucide-react";
import { toast } from "sonner";
import { defaultResponseLabel, type ImPromptResponseKind } from "@/lib/im-prompt";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Stars } from "./pending-prompt";

/** WHAT THE LC ACTUALLY SEES (v34.9).
 *
 *  The admin composes an IM prompt blind — title, an optional body, a
 *  response kind — and had no way to check it before 80 people met it as a
 *  blocking dialog. This renders EXACTLY what `PendingPrompt` renders for an
 *  `im_prompt` row: same `Stars` widget (imported, not re-implemented), same
 *  classes, same button labels and same fallback copy for an empty body —
 *  so "preview" cannot quietly drift from "the real thing".
 *
 *  Nothing here talks to the server. Skip and Submit are inert — they show a
 *  toast saying so and close — because this dialog was never filed as a real
 *  `pending_prompts` row and answering it for real would mean either faking a
 *  response from the admin or silently doing nothing on a button that looks
 *  live either way. */
interface PreviewProps {
  onOpenChange: (o: boolean) => void;
  title: string;
  body: string;
  responseKind: ImPromptResponseKind;
  responseLabel: string;
  dismissible: boolean;
}

export function ImPromptPreviewDialog({ open, ...rest }: PreviewProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto p-4 sm:max-w-md sm:p-6">
        {/* mounted only while open, so `stars`/`note` below start fresh every
            time — a member meeting the real prompt never carries state from
            a previous look, and neither should this */}
        {open ? <PreviewBody {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  onOpenChange, title, body, responseKind, responseLabel, dismissible,
}: PreviewProps) {
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState("");

  const label = title.trim() || "(no title yet)";
  const wants = responseKind;
  const shownLabel = responseLabel.trim() || defaultResponseLabel(wants) || "";

  const inert = (msg: string) => {
    toast.info(msg);
    onOpenChange(false);
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-center gap-1.5 rounded-md bg-primary/10 py-1.5 text-xs font-semibold text-primary">
        <Eye className="size-3.5" /> Preview — this is what the LC will see
      </div>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2" dir="auto">
          <AlarmClock className="size-5 text-primary" />
          {label}
        </DialogTitle>
        <DialogDescription dir="auto" className="whitespace-pre-wrap">
          {body}
        </DialogDescription>
      </DialogHeader>

      {wants === "rating" ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{shownLabel}</p>
          <Stars value={stars} onPick={setStars} />
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Anything to add? (optional)"
          />
        </div>
      ) : null}

      {wants === "text" ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{shownLabel}</p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Type your answer…"
          />
        </div>
      ) : null}

      <DialogFooter>
        {dismissible ? (
          <Button variant="ghost" onClick={() => inert("In the real thing, Skip files the answer and moves on.")}>
            Skip
          </Button>
        ) : null}
        <Button
          onClick={() => inert("In the real thing, this sends the answer and closes it.")}
          disabled={(wants === "rating" && stars < 1) || (wants === "text" && !note.trim())}
        >
          {wants === "none" || wants === "acknowledge" ? "Got it" : "Send"}
        </Button>
      </DialogFooter>
      <p className="text-center text-[11px] text-muted-foreground">
        {dismissible
          ? "Skip and we ask once more tomorrow — then never again. 💜"
          : "They can't skip this one — you turned that off below."}
      </p>
    </>
  );
}
