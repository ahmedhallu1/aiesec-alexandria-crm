"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquareWarning } from "lucide-react";
import { FeedbackForm } from "./feedback-form";
import { Hint } from "./hint";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/** REPORT IT FROM WHERE IT BROKE (v33.37).
 *
 *  The system-feedback form lived on its own page, which is exactly where you
 *  are NOT when something goes wrong. This is the Google-style always-there
 *  button: a small floating tab (bottom-left — The Blue Man owns the right),
 *  one tap, the same form in a dialog, and the report carries the page the
 *  reporter was actually on.
 */
export function FloatingFeedback() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <Hint label="Something broken or missing? Report it right here — it reaches the IM team">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Send feedback about Sodio"
          className="fixed bottom-4 left-4 z-40 flex size-11 items-center justify-center rounded-full border bg-background/95 text-muted-foreground shadow-lg backdrop-blur transition-all hover:scale-105 hover:text-primary hover:shadow-xl active:scale-95"
        >
          <MessageSquareWarning className="size-5" />
        </button>
      </Hint>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Report it — right from here 🛠️</DialogTitle>
            <DialogDescription>
              A bug, a missing thing, an idea — it reaches the IM team with the
              page you&apos;re on attached, so they can find it fast.
            </DialogDescription>
          </DialogHeader>
          <FeedbackForm
            showInboxLink={false}
            frameless
            page={pathname ?? "/"}
            onSent={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
