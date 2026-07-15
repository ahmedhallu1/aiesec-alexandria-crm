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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ProdCode = "iGV" | "iGTa" | "iGTe";
/** what the email BODY is written for — B2B = the general all-programs email */
type BodyCode = ProdCode | "B2B";
const B2B_PRODUCTS: ProdCode[] = ["iGV", "iGTa", "iGTe"];

/** ICX Proposal Email — one popup, prefilled from the account; the generated
 *  draft lands in the MEMBER's own Gmail so they review, attach and send.
 *  B2B accounts pick which product the email targets + which PDFs to attach. */
export function ProposalDialog({
  account, open, onOpenChange,
}: {
  account: PipelineRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isB2B = account.function === "B2B";
  const fixedProduct: ProdCode =
    account.function === "IGV" ? "iGV" : account.product === "GTe" ? "iGTe" : "iGTa";
  const firstEmail =
    (account.contacts ?? []).find((c) => c.kind === "email")?.value ?? account.email ?? "";

  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState(firstEmail);
  const [sector, setSector] = useState(account.industry ?? account.sub_product ?? "");
  const [customNote, setCustomNote] = useState("");
  const [attachProposal, setAttachProposal] = useState(true);
  // B2B: the product the email body is written for (default = the general
  // all-programs partnership email) + which PDFs to attach
  const [bodyProduct, setBodyProduct] = useState<BodyCode>("B2B");
  const [attachProducts, setAttachProducts] = useState<ProdCode[]>(["iGV"]);
  const [attachmentsNote, setAttachmentsNote] = useState("");
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const product: BodyCode = isB2B ? bodyProduct : fixedProduct;
  const productLabel = product === "B2B" ? "general (all-programs)" : product;
  const toggleAttach = (p: ProdCode) =>
    setAttachProducts((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));

  const submit = () =>
    start(async () => {
      const res = await createProposalDraft({
        accountId: account.id,
        recipientName,
        recipientEmail,
        sector: sector || null,
        customNote: customNote || null,
        attachmentsNote: attachmentsNote || null,
        attachProposal: isB2B ? false : attachProposal,
        bodyProduct: isB2B ? bodyProduct : null,
        attachProducts: isB2B ? attachProducts : null,
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
                The {productLabel} proposal for <b>{account.name}</b> is waiting in
                your drafts{(isB2B ? attachProducts.length > 0 : attachProposal)
                  ? isB2B
                    ? ` with the ${attachProducts.join(", ")} PDF${attachProducts.length === 1 ? "" : "s"} attached`
                    : " with the official PDF attached"
                  : ""}.{" "}
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
                <FileText className="size-5 text-primary" /> Proposal email · {productLabel}
              </DialogTitle>
              <DialogDescription>
                Generates the ready-to-send <b>{productLabel}</b> outreach draft for{" "}
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

              {isB2B ? (
                <>
                  {/* B2B raises for the whole ICX — pick the product the email
                      is written for + which official PDFs to attach */}
                  <div className="grid gap-1.5">
                    <Label>Proposal written for</Label>
                    <Select value={bodyProduct} onValueChange={(v) => setBodyProduct(v as BodyCode)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="B2B">General — all ICX programs</SelectItem>
                        <SelectItem value="iGV">iGV — Global Volunteer</SelectItem>
                        <SelectItem value="iGTa">iGTa — Global Talent</SelectItem>
                        <SelectItem value="iGTe">iGTe — Global Teacher</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-sm font-medium">Attach official proposal PDFs</p>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Pick any of the three — all selected PDFs ride along in the draft.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {B2B_PRODUCTS.map((p) => {
                        const active = attachProducts.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
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
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Attach the official {product} proposal</p>
                    <p className="text-xs text-muted-foreground">
                      The PDF is added to the draft automatically
                    </p>
                  </div>
                  <Switch checked={attachProposal} onCheckedChange={setAttachProposal} />
                </div>
              )}
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
