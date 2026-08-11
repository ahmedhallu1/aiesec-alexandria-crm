"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { toast } from "sonner";
import { submitFeedback } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FEEDBACK_CATEGORIES } from "@/lib/types";
import { FeedbackAttachments, type FeedbackAttachment } from "./feedback-attachments";

export function FeedbackForm({
  showInboxLink,
  frameless = false,
  page = "/feedback",
  onSent,
}: {
  showInboxLink: boolean;
  /** no Card wrapper — for living inside a dialog (the floating button) */
  frameless?: boolean;
  /** where the reporter WAS — the floating button passes the real page */
  page?: string;
  onSent?: () => void;
}) {
  const [type, setType] = useState<"Bug" | "Enhancement" | "Other">("Enhancement");
  const [category, setCategory] = useState<string>("");
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [pending, startTransition] = useTransition();
  const categories = FEEDBACK_CATEGORIES[type];

  const pickType = (v: typeof type) => {
    setType(v);
    setCategory(""); // the list changes with the type — never keep a stale pick
  };

  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);

  const submit = () =>
    startTransition(async () => {
      const res = await submitFeedback({
        type,
        category: category || undefined,
        message,
        page,
        anonymous,
        attachments,
      });
      if (res.ok) {
        toast.success(
          anonymous
            ? "Sent! Your secret is safe with us 🎭"
            : "Thank you! Your contribution reached the IM team 💙"
        );
        setMessage("");
        setAnonymous(false);
        setAttachments([]);
        onSent?.();
      } else {
        toast.error(res.error);
      }
    });

  const body = (
    <>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => pickType(v as typeof type)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Bug">🐞 Bug — something is broken</SelectItem>
                <SelectItem value="Enhancement">✨ Enhancement — make it better</SelectItem>
                <SelectItem value="Other">💬 Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>What kind exactly?</Label>
            <Select value={category || undefined} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder={type === "Bug" ? "What's broken?" : "Pick a category…"} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label>What happened / what do you wish for?</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="The more detail, the faster the fix…"
          />
          <FeedbackAttachments
            value={attachments}
            onChange={setAttachments}
            disabled={pending}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Send anonymously 🎭</p>
            <p className="text-xs text-muted-foreground">
              No name attached — but also no thank-you credit. Your call.
            </p>
          </div>
          <Switch checked={anonymous} onCheckedChange={setAnonymous} />
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
    </>
  );
  if (frameless) return <div className="grid gap-4">{body}</div>;
  return (
    <Card>
      <CardContent className="grid gap-4 pt-5">{body}</CardContent>
    </Card>
  );
}
