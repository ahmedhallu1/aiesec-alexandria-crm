"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { submitFeedback } from "@/server/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** Permanently accessible "Feedback & Enhancements" mini-form. */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"Bug" | "Enhancement" | "Other">("Bug");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();

  const submit = () =>
    startTransition(async () => {
      const res = await submitFeedback({ type, message, page: pathname });
      if (res.ok) {
        toast.success("Thanks! The IM team got it 💙");
        setMessage("");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="icon"
        className="fixed bottom-5 right-5 z-40 size-12 rounded-full shadow-lg"
        title="Feedback & enhancements"
      >
        <MessageSquarePlus className="size-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Feedback & enhancements</DialogTitle>
            <DialogDescription>
              Found a bug or have an idea? It goes straight to the IM team.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bug">🐞 Bug</SelectItem>
                  <SelectItem value="Enhancement">✨ Enhancement</SelectItem>
                  <SelectItem value="Other">💬 Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>What happened / what do you wish for?</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="The more detail, the faster the fix…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || message.trim().length < 3}>
              {pending ? "Sending…" : "Send feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
