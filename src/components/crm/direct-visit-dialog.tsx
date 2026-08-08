"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Footprints, Loader2 } from "lucide-react";
import { logDirectVisit } from "@/server/actions";
import {
  DIRECT_VISIT_OUTCOMES, IGT_SUB_PRODUCTS, IGV_PROJECTS, INDUSTRIES,
  ACCOUNT_TYPES, type AccountFunction,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** LOG A WALK-IN (v33.24).
 *
 *  The funnel assumes research first. This is the other way round: you found
 *  the place on the street and offered the product at the door. One form —
 *  who, when, what happened — and Sodio writes the account, the contact and
 *  the visit, so the work lands in the pipeline instead of going unrecorded.
 */
export function DirectVisitDialog({
  open, onOpenChange, allowedFns,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allowedFns: AccountFunction[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [fn, setFn] = useState<AccountFunction>(allowedFns[0] ?? "IGV");
  const [name, setName] = useState("");
  const [product, setProduct] = useState("");
  const [project, setProject] = useState("");
  const [accountType, setAccountType] = useState("");
  const [industry, setIndustry] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [visitDate, setVisitDate] = useState(today);
  const [visitTime, setVisitTime] = useState("12:00");
  const [outcome, setOutcome] = useState<string>("presented");
  const [comment, setComment] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("11:00");

  const picked = DIRECT_VISIT_OUTCOMES.find((o) => o.key === outcome)!;
  const needsDate = outcome === "revisit";
  const wantsDate = outcome === "send_info" || outcome === "turned_away";

  const reset = () => {
    setName(""); setProduct(""); setProject(""); setAccountType("");
    setIndustry(""); setPhone(""); setEmail(""); setComment("");
    setNextDate(""); setOutcome("presented"); setVisitDate(today);
  };

  const submit = () =>
    start(async () => {
      const res = await logDirectVisit({
        function: fn,
        name,
        product: fn === "IGT" ? (product as "GTa" | "GTe") || null : null,
        project: fn === "IGV" ? project || null : null,
        account_type: accountType || null,
        industry: industry || null,
        phone: phone || null,
        email: email || null,
        visitDate,
        visitTime,
        outcome: outcome as "turned_away",
        comment,
        nextDate: nextDate || undefined,
        nextTime: nextDate ? nextTime : undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data?.visitDone
          ? "Logged 🚶 — MR, contact and a completed visit"
          : "Logged 🚶 — MR, contact and the visit attempt"
      );
      reset();
      onOpenChange(false);
      router.push(`/accounts/${res.data!.slug}`);
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Footprints className="size-5" /> Log a direct visit
          </DialogTitle>
          <DialogDescription>
            The walk-in kind: you found them on the street and offered it at the
            door. Sodio records the market research, the contact and the visit
            in one go — no need to add the account first.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {allowedFns.length > 1 ? (
              <div className="grid gap-1.5">
                <Label>Function *</Label>
                <Select value={fn} onValueChange={(v) => setFn(v as AccountFunction)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allowedFns.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className={cn("grid gap-1.5", allowedFns.length > 1 ? "" : "sm:col-span-2")}>
              <Label>Company / place *</Label>
              <Input
                dir="auto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="The name on the door"
                maxLength={120}
              />
            </div>
          </div>

          {fn === "IGT" ? (
            <div className="grid gap-1.5">
              <Label>Sub product</Label>
              <Select value={product || undefined} onValueChange={setProduct}>
                <SelectTrigger><SelectValue placeholder="GTa or GTe" /></SelectTrigger>
                <SelectContent>
                  {IGT_SUB_PRODUCTS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {fn === "IGV" ? (
            <div className="grid gap-1.5">
              <Label>Project *</Label>
              <Select value={project || undefined} onValueChange={setProject}>
                <SelectTrigger><SelectValue placeholder="Which project" /></SelectTrigger>
                <SelectContent>
                  {IGV_PROJECTS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={accountType || undefined} onValueChange={setAccountType}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Industry</Label>
              <Select value={industry || undefined} onValueChange={setIndustry}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Phone you collected</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid gap-1.5">
              <Label>Email you collected</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>When you went *</Label>
              <Input
                type="date"
                max={today}
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Time</Label>
              <Input type="time" value={visitTime} onChange={(e) => setVisitTime(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>How did it end? *</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIRECT_VISIT_OUTCOMES.map((o) => (
                  <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{picked.hint}</p>
          </div>

          {needsDate || wantsDate ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>
                  {needsDate ? "Going back on *" : "Follow up on"}
                </Label>
                <Input
                  type="date"
                  value={nextDate}
                  onChange={(e) => setNextDate(e.target.value)}
                />
              </div>
              {nextDate ? (
                <div className="grid gap-1.5">
                  <Label>Time</Label>
                  <Input type="time" value={nextTime} onChange={(e) => setNextTime(e.target.value)} />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label>What happened? *</Label>
            <Textarea
              dir="auto"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Who you spoke to, what you offered, how they reacted…"
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={
              pending ||
              name.trim().length < 2 ||
              comment.trim().length < 2 ||
              (fn === "IGV" && !project) ||
              (needsDate && !nextDate)
            }
            onClick={submit}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Footprints className="size-4" />}
            Log it
          </Button>
        </div>
        {outcome === "deal" ? (
          <p className="text-xs text-muted-foreground">
            The account opens right after — record the deal from there so the
            opens land on the right product.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
