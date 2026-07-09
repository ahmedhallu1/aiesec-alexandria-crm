"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { toast } from "sonner";
import { submitFeedback } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function FeedbackForm({ showInboxLink }: { showInboxLink: boolean }) {
  const [type, setType] = useState<"Bug" | "Enhancement" | "Other">("Enhancement");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const res = await submitFeedback({ type, message, page: "/feedback" });
      if (res.ok) {
        toast.success("Thank you! Your contribution reached the IM team 💙");
        setMessage("");
      } else {
        toast.error(res.error);
      }
    });

  return (
    <Card>
      <CardContent className="grid gap-4 pt-5">
        <div className="grid gap-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Bug">🐞 Bug — something is broken</SelectItem>
              <SelectItem value="Enhancement">✨ Enhancement — make it better</SelectItem>
              <SelectItem value="Other">💬 Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>What happened / what do you wish for?</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="The more detail, the faster the fix…"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button onClick={submit} disabled={pending || message.trim().length < 3}>
            {pending ? "Sending…" : "Send feedback"}
          </Button>
          {showInboxLink ? (
            <Link
              href="/feedback/inbox"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
            >
              <Inbox className="size-4" /> Open the inbox
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
