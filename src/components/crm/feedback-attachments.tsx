"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Paperclip, X } from "lucide-react";
import { requestFeedbackUploads } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface FeedbackAttachment {
  path: string;
  name: string;
}

/** OPTIONAL ATTACHMENTS ON FEEDBACK (v33.13).
 *
 *  A bug is easier shown than described, and a concern about a person is often
 *  a screenshot. Files go browser → private bucket through a signed URL — they
 *  never pass through the server, which caps an action body at ~4.5 MB — and
 *  the caller receives back only the stored paths to submit with the message.
 */
export function FeedbackAttachments({
  value,
  onChange,
  disabled,
}: {
  value: FeedbackAttachment[];
  onChange: (next: FeedbackAttachment[]) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = [...files];
    setBusy(true);
    try {
      const req = await requestFeedbackUploads(
        picked.map((f) => ({ name: f.name, type: f.type, size: f.size }))
      );
      if (!req.ok || !req.data) {
        toast.error(req.ok ? "Could not prepare the upload." : req.error);
        return;
      }
      const done: FeedbackAttachment[] = [];
      for (let i = 0; i < req.data.uploads.length; i += 1) {
        const up = req.data.uploads[i];
        const res = await fetch(up.signedUrl, {
          method: "PUT",
          headers: { "content-type": picked[i].type || "application/octet-stream" },
          body: picked[i],
        });
        if (!res.ok) {
          toast.error(`"${picked[i].name}" didn't upload — try again.`);
          continue;
        }
        done.push({ path: up.path, name: up.name });
      }
      if (done.length > 0) onChange([...value, ...done]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">
        Attachments (optional) — a screenshot usually says it fastest
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm" disabled={disabled || busy}>
          <label className="cursor-pointer">
            <Paperclip className="size-3.5" />
            {busy ? "Uploading…" : "Attach a file"}
            <input
              type="file"
              multiple
              className="hidden"
              disabled={disabled || busy}
              onChange={(e) => {
                void add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </Button>
        {value.map((a) => (
          <span
            key={a.path}
            className="inline-flex max-w-56 items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          >
            <span className="truncate" dir="auto">{a.name}</span>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onChange(value.filter((x) => x.path !== a.path))}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
