"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { createProposalDraft } from "@/server/actions";
import type { PipelineRow } from "@/server/data";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** ICX Proposal Email — one popup, prefilled from the account; the generated
 *  draft lands in the MEMBER's own Gmail so they review, attach and send. */
export function ProposalDialog({
  account, open, onOpenChange,
}: {
  account: PipelineRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const product =
    account.function === "IGV" ? "iGV" : account.product === "GTe" ? "iGTe" : "iGTa";
  const firstEmail =
    (account.contacts ?? []).find((c) => c.kind === "email")?.value ?? account.email ?? "";

  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState(firstEmail);
  const [sector, setSector] = useState(account.industry ?? account.sub_product ?? "");
  const [customNote, setCustomNote] = useState("");
  const [attachProposal, setAttachProposal] = useState(true);
  const [attachmentsNote, setAttachmentsNote] = useState("");
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await createProposalDraft({
        accountId: account.id,
        recipientName,
        recipientEmail,
        sector: sector || null,
        customNote: customNote || null,
        attachmentsNote: attachmentsNote || null,
        attachProposal,
      });
      if (res.ok) {
        setDone(true);
      } else {
        toast.error(res.error);
      }
    });

  const close = (o: boolean) => {
    if (!o) setDone(false);
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-1 text-5xl">📬</div>
              <DialogTitle className="text-center">Draft ready in YOUR Gmail</DialogTitle>
              <DialogDescription className="text-center leading-relaxed">
                The {product} proposal for <b>{account.name}</b> is waiting in
                your drafts{attachProposal ? " with the official PDF attached" : ""}.{" "}
                <b>Open it, review every line{attachmentsNote ? ", add your extra file(s)" : ""},
                and hit send</b> — it goes out from your own address.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-center">
              <Button variant="outline" onClick={() => close(false)}>
                Done
              </Button>
              <Button asChild>
                <a
                  href="https://mail.google.com/mail/u/0/#drafts"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" /> Open Gmail drafts
                </a>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="size-5 text-primary" /> Proposal email · {product}
              </DialogTitle>
              <DialogDescription>
                Generates the ready-to-send <b>{product}</b> outreach draft for{" "}
                <b>{account.name}</b> in <b>your own Gmail</b> — you review and
                send it yourself.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Recipient name *</Label>
                  <Input
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="e.g. Mr. Ahmed / HR team"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Recipient email *</Label>
                  <Input
                    value={recipientEmail}
                    inputMode="email"
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="name@company.com"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Sector</Label>
                <Input
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  placeholder="Prefilled from the account"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Custom note (goes inside the email)</Label>
                <Textarea
                  rows={2}
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder="Anything specific to this company…"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Attach the official {product} proposal</p>
                  <p className="text-xs text-muted-foreground">
                    The PDF is added to the draft automatically
                  </p>
                </div>
                <Switch checked={attachProposal} onCheckedChange={setAttachProposal} />
              </div>
              <div className="grid gap-1.5">
                <Label>Extra attachments you plan to add yourself</Label>
                <Input
                  value={attachmentsNote}
                  onChange={(e) => setAttachmentsNote(e.target.value)}
                  placeholder="e.g. case study — the draft reminds you to attach it"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={submit}
                disabled={pending || recipientName.trim().length < 2 || !recipientEmail.includes("@")}
              >
                {pending ? (
                  <><Loader2 className="size-4 animate-spin" /> Creating draft…</>
                ) : (
                  "Create draft in my Gmail"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
