"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquareWarning } from "lucide-react";
import { FeedbackForm } from "./feedback-form";
import { Hint } from "./hint";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/** REPORT IT FROM WHERE IT BROKE (v33.37, re-homed v33.38).
 *
 *  The always-there feedback button — one tap, the system-feedback form in a
 *  dialog, with the page the reporter was on attached. It lives IN the chrome
 *  (next to Refresh on desktop, next to the bell on mobile) rather than
 *  floating over content: a floating tab bottom-left sat on top of tables and
 *  fought the Blue Man for corner space.
 */
export function FeedbackButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <Hint label="Something broken or missing? Report it right here — it reaches the IM team">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Send feedback about Sodio"
          className={cn("text-muted-foreground hover:text-primary", className)}
        >
          <MessageSquareWarning className="size-5" />
        </Button>
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
