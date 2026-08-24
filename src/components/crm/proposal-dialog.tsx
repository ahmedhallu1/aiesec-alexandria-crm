"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, FileText, Loader2, Send } from "lucide-react";
import { createProposalDraft } from "@/server/actions";
import type { PipelineRow } from "@/server/data";
import {
  PROPOSAL_PDFS, PROPOSAL_PDF_LABEL, PROPOSAL_PDF_MB, attachmentTooBig,
  defaultProposalPdfs, totalAttachmentMb,
  type ProposalPdf, type ProposalProduct,
} from "@/lib/proposal-pdfs";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** ICX Proposal Email — one popup, prefilled from the account.
 *
 *  v34.8: it SENDS by default. Leaving a draft nobody opens was the common
 *  outcome, so "Send it now" is the default and drafting is one switch away
 *  for the times the member wants to re-read it first. Either way it leaves
 *  their OWN Gmail, so the reply comes back to them.
 *
 *  The attachment set follows the email you're writing: the B2B partnership
 *  email carries the B2B proposal, an iGV email carries the iGV deck, and any
 *  of the four can be toggled on top. */
export function ProposalDialog({
  account, open, onOpenChange,
}: {
  account: PipelineRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isBD = account.function === "BD";
  const isB2B = account.function === "B2B" || isBD;
  const fixedProduct: ProposalProduct =
    account.function === "IGV" ? "iGV" : account.product === "GTe" ? "iGTe" : "iGTa";
  const firstEmail =
    (account.contacts ?? []).find((c) => c.kind === "email")?.value ?? account.email ?? "";

  const [recipientEmail, setRecipientEmail] = useState(firstEmail);
  const [sector, setSector] = useState(account.industry ?? account.sub_product ?? "");
  const [customNote, setCustomNote] = useState("");
  // B2B/BD: the product the email body is written for (default = their
  // general variant)
  const [bodyProduct, setBodyProduct] = useState<ProposalProduct>(isBD ? "BD" : "B2B");
  const product: ProposalProduct = isB2B ? bodyProduct : fixedProduct;

  // WHICH DECKS RIDE ALONG. `null` = "still following the body", so switching
  // the body switches the deck with it; the moment the member touches a chip
  // the set becomes theirs and stops moving under them.
  const [picked, setPicked] = useState<ProposalPdf[] | null>(null);
  const attachPdfs = picked ?? defaultProposalPdfs(product);
  const toggleAttach = (p: ProposalPdf) =>
    setPicked(
      attachPdfs.includes(p) ? attachPdfs.filter((x) => x !== p) : [...attachPdfs, p]
    );

  const oversized = attachmentTooBig(attachPdfs);

  const [sendNow, setSendNow] = useState(true);
  const [attachmentsNote, setAttachmentsNote] = useState("");
  const [done, setDone] = useState<{ sent: boolean } | null>(null);
  const [pending, start] = useTransition();

  const productLabel =
    product === "B2B" ? "general (all-programs)"
    : product === "BD" ? "BD (talent solutions)"
    : product;

  const submit = () =>
    start(async () => {
      const res = await createProposalDraft({
        accountId: account.id,
        recipientEmail,
        sector: sector || null,
        customNote: customNote || null,
        attachmentsNote: sendNow ? null : attachmentsNote || null,
        bodyProduct: isB2B ? bodyProduct : null,
        attachPdfs,
        sendNow,
      });
      if (res.ok) {
        setDone({ sent: !!res.data?.sent });
      } else {
        toast.error(res.error);
      }
    });

  const close = (o: boolean) => {
    if (!o) setDone(null);
    onOpenChange(o);
  };

  const attachedLabel =
    attachPdfs.length > 0
      ? ` with the ${attachPdfs.join(", ")} proposal${attachPdfs.length === 1 ? "" : "s"} attached`
      : "";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        {done ? (
          <>
            <DialogHeader>
              <div className="mx-auto mb-1 text-5xl">{done.sent ? "🚀" : "📬"}</div>
              <DialogTitle className="text-center">
                {done.sent ? "Sent — it's on its way" : "Draft ready in YOUR Gmail"}
              </DialogTitle>
              <DialogDescription className="text-center leading-relaxed">
                {done.sent ? (
                  <>
                    The {productLabel} proposal for <b>{account.name}</b> just went out
                    to <b>{recipientEmail}</b>{attachedLabel}, from your own address —
                    so their reply lands in <b>your</b> inbox.
                  </>
                ) : (
                  <>
                    The {productLabel} proposal for <b>{account.name}</b> is waiting in
                    your drafts{attachedLabel}.{" "}
                    <b>
                      Open it, review every line
                      {attachmentsNote ? ", add your extra file(s)" : ""}, and hit send
                    </b>{" "}
                    — it goes out from your own address.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-center">
              <Button variant="outline" onClick={() => close(false)}>
                Done
              </Button>
              <Button asChild>
                <a
                  href={
                    done.sent
                      ? "https://mail.google.com/mail/u/0/#sent"
                      : "https://mail.google.com/mail/u/0/#drafts"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" />
                  {done.sent ? "See it in Sent" : "Open Gmail drafts"}
                </a>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="size-5 text-primary" /> Proposal email · {productLabel}
              </DialogTitle>
              <DialogDescription>
                {sendNow ? (
                  <>
                    Sends the <b>{productLabel}</b> outreach email to{" "}
                    <b>{account.name}</b> straight from <b>your own Gmail</b>.
                  </>
                ) : (
                  <>
                    Puts the <b>{productLabel}</b> outreach draft for{" "}
                    <b>{account.name}</b> in <b>your own Gmail</b> — you review and
                    send it yourself.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Recipient email *</Label>
                <Input
                  value={recipientEmail}
                  inputMode="email"
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="name@company.com"
                />
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

              {isB2B ? (
                /* B2B raises for the whole ICX — pick the product the email
                   body is written for */
                <div className="grid gap-1.5">
                  <Label>Proposal written for</Label>
                  <Select
                    value={bodyProduct}
                    onValueChange={(v) => setBodyProduct(v as ProposalProduct)}
                  >
                    <SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {isBD ? (
                        <SelectItem value="BD">BD — Talent Solutions (general)</SelectItem>
                      ) : (
                        <SelectItem value="B2B">General — all ICX programs</SelectItem>
                      )}
                      <SelectItem value="iGV">iGV — Global Volunteer</SelectItem>
                      <SelectItem value="iGTa">iGTa — Global Talent</SelectItem>
                      <SelectItem value="iGTe">iGTe — Global Teacher</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">Official proposals to attach</p>
                <p className="mb-2 text-xs text-muted-foreground">
                  {picked === null
                    ? "Following the email you're writing — tap to change."
                    : "Your pick. Every selected PDF rides along."}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PROPOSAL_PDFS.map((p) => {
                    const active = attachPdfs.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        title={`${PROPOSAL_PDF_LABEL[p]} · ${PROPOSAL_PDF_MB[p]} MB`}
                        onClick={() => toggleAttach(p)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-muted text-muted-foreground hover:border-primary/50"
                        )}
                      >
                        {active ? "✓ " : ""}{p}
                      </button>
                    );
                  })}
                </div>
                {/* an email has a size limit and these decks are big — say so
                    here, not after Google refuses the send */}
                {oversized ? (
                  <p className="mt-2 text-xs font-medium text-destructive">{oversized}</p>
                ) : attachPdfs.length > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {totalAttachmentMb(attachPdfs).toFixed(1)} MB attached
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Send it now</p>
                  <p className="text-xs text-muted-foreground">
                    {sendNow
                      ? "Goes out immediately from your Gmail."
                      : "Off — it waits in your drafts so you can add files or re-read it."}
                  </p>
                </div>
                <Switch checked={sendNow} onCheckedChange={setSendNow} />
              </div>

              {/* only a DRAFT has a moment in which to add your own files */}
              {!sendNow ? (
                <div className="grid gap-1.5">
                  <Label>Extra attachments you plan to add yourself</Label>
                  <Input
                    value={attachmentsNote}
                    onChange={(e) => setAttachmentsNote(e.target.value)}
                    placeholder="e.g. case study — the draft reminds you to attach it"
                  />
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                onClick={submit}
                disabled={pending || !recipientEmail.includes("@") || !!oversized}
              >
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {sendNow ? "Sending…" : "Creating draft…"}
                  </>
                ) : sendNow ? (
                  <><Send className="size-4" /> Send it now</>
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
