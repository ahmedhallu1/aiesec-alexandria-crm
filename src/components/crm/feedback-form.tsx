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
import { adminWhatsAppLink, FEEDBACK_CATEGORIES } from "@/lib/types";
import { WhatsAppIcon } from "./icons";
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
        {/* min-w-0 on the columns + w-full triggers (v33.38): a grid item's
            min-width is auto, so the long "Enhancement — make it better" label
            stretched its trigger INTO the second column — the two selects
            rendered jammed against each other inside the dialog. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => pickType(v as typeof type)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Bug">🐞 Bug — something is broken</SelectItem>
                <SelectItem value="Enhancement">✨ Enhancement — make it better</SelectItem>
                <SelectItem value="Other">💬 Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-2">
            <Label>What kind exactly?</Label>
            <Select value={category || undefined} onValueChange={setCategory}>
              <SelectTrigger className="w-full">
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={submit} disabled={pending || message.trim().length < 3}>
              {pending ? "Sending…" : "Send feedback"}
            </Button>
            {/* THE ONE-TAP HUMAN (v33.58). A form is the right shape for most
                reports — it carries the page, the type and the attachments,
                and it lands somewhere it can't be lost. But some things are
                faster said than written: a member who is blocked right now, or
                whose bug needs a screen shared and three questions asked, will
                give up on a textarea long before they give up on WhatsApp. The
                opener already names Sodio and the page they were on, so the
                chat starts with the context the form would have collected. */}
            <Button asChild variant="outline">
              <a
                href={adminWhatsAppLink(
                  `Hey Ahmed! I'm on Sodio (${page}) and wanted to reach out directly about: `
                )}
                target="_blank"
                rel="noreferrer"
              >
                <WhatsAppIcon className="size-4" /> Or WhatsApp me directly
              </a>
            </Button>
          </div>
          {showInboxLink ? (
            <Link
              href="/feedback/inbox"
              prefetch={false}
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
