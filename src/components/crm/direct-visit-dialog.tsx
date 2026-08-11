"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Footprints, Loader2 } from "lucide-react";
import { logDirectVisit } from "@/server/actions";
import {
  ACCOUNT_TYPES, B2C_TYPES, DIRECT_VISIT_OUTCOMES, IGT_SUB_PRODUCTS,
  IGV_PROJECTS, INDUSTRIES, OOP_REASONS, PODIO_FORM_URL,
  type AccountContact, type AccountFunction,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContactsEditor, contactsValid } from "./contacts-editor";
import { useAccountNameCheck } from "./use-account-name-check";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** LOG A WALK-IN (v33.24, rebuilt v33.25).
 *
 *  The funnel assumes research first. This is the other way round: you found
 *  the place on the street and offered the product at the door. One form —
 *  the account, when you went, how it ended — and Sodio writes the account,
 *  the contact and the visit, so the work lands in the pipeline instead of
 *  going unrecorded.
 *
 *  It creates a REAL account through the real door: the same live name check
 *  against every function and the archive, the same Podio look-up, the same
 *  tagged contact rows. A walk-in is not a lesser kind of account.
 */
export function DirectVisitDialog({
  open, onOpenChange, allowedFns, canSetRequestState,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allowedFns: AccountFunction[];
  canSetRequestState: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [fn, setFn] = useState<AccountFunction>(allowedFns[0] ?? "IGV");
  const [name, setName] = useState("");
  const [product, setProduct] = useState("");
  const [subProduct, setSubProduct] = useState("");
  const [project, setProject] = useState("");
  const [accountType, setAccountType] = useState("");
  const [industry, setIndustry] = useState("");
  const [contacts, setContacts] = useState<AccountContact[]>([]);
  const [requestedPodio, setRequestedPodio] = useState(false);
  const [requestState, setRequestState] = useState("");
  const [visitDate, setVisitDate] = useState(today);
  const [visitTime, setVisitTime] = useState("12:00");
  const [outcome, setOutcome] = useState<string>("presented");
  const [comment, setComment] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("11:00");
  const [oop, setOop] = useState(false);
  const [oopReason, setOopReason] = useState("Not Interested");

  const { nameCheck, blocked, podio, retryPodio } = useAccountNameCheck(name, fn);
  const picked = DIRECT_VISIT_OUTCOMES.find((o) => o.key === outcome)!;
  // AN ARCHIVED NAME NO LONGER BLOCKS A DIRECT VISIT (v33.37): the walk-in
  // already happened. Logging it brings the account back — unless they turned
  // you away, in which case it stays archived and the attempt is logged on it.
  const archivedHit = nameCheck?.status === "archived";
  const hardBlocked = blocked && !archivedHit;
  // "come back another time" can be general ("they said pass by again") or a
  // real booking — date AND time are optional; a date makes it a calendar
  // visit (11:00 unless a time is picked) (v33.37)
  const wantsDate =
    outcome === "revisit" || outcome === "send_info" || outcome === "presented";

  const reset = () => {
    setName(""); setProduct(""); setSubProduct(""); setProject("");
    setAccountType(""); setIndustry(""); setContacts([]); setComment("");
    setNextDate(""); setOutcome("presented"); setVisitDate(today);
    setRequestedPodio(false); setRequestState(""); setOop(false);
  };

  const submit = () =>
    start(async () => {
      const res = await logDirectVisit({
        function: fn,
        name,
        product: fn === "IGT" ? ((product as "GTa" | "GTe") || null) : null,
        sub_product: fn === "IGT" ? subProduct || null : null,
        project: fn === "IGV" ? project || null : null,
        account_type: fn !== "IGT" ? accountType || null : null,
        industry: fn !== "IGT" && fn !== "B2C" ? industry || null : null,
        contacts,
        requested_podio: requestedPodio,
        request_state: (requestState || null) as "Checking" | "Approved" | null,
        visitDate,
        visitTime,
        outcome: outcome as "turned_away",
        comment,
        nextDate: nextDate || undefined,
        nextTime: nextDate ? nextTime : undefined,
        outOfProcess: oop && outcome === "turned_away",
        oopReason: oop ? oopReason : undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data?.visitDone
          ? "Logged 🚶 — research, contact and a completed visit"
          : "Logged 🚶 — research, contact and the visit attempt"
      );
      const slug = res.data!.slug;
      reset();
      onOpenChange(false);
      // a deal closed at the door is recorded on the account, where the opens
      // split lives — open it straight onto the deal form (v33.25)
      router.push(`/accounts/${slug}${outcome === "deal" ? "?open=deal" : ""}`);
    });

  const canSubmit =
    !pending &&
    !hardBlocked &&
    name.trim().length >= 2 &&
    comment.trim().length >= 2 &&
    contactsValid(contacts) &&
    // a revived archived account keeps its own fields — nothing to require
    (archivedHit ||
      ((fn !== "IGV" || !!project) &&
        (fn !== "IGT" || !!product) &&
        (fn !== "B2C" || !!accountType)));

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
            together — this creates a normal account, checked like any other.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {/* THE NAME IS THE FIRST THING (v33.26). It is what the three live
              checks below are ABOUT, so it belongs top-left, above them —
              reading a verdict before you have read the field it judges is
              backwards. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={cn("grid gap-1.5", allowedFns.length > 1 ? "" : "sm:col-span-2")}>
              <Label>Account name *</Label>
              <Input
                dir="auto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Exactly as the LC would write it"
                maxLength={120}
                autoFocus
              />
            </div>
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
          </div>

          {/* the same three live checks the Add-account form runs */}
          {nameCheck?.status === "checking" ? (
            <p className="text-xs text-muted-foreground">Checking the name…</p>
          ) : archivedHit ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              🗄️ This name is in the archive — and you were AT their door, so
              that&apos;s fine: logging the visit <b>brings the account back to
              you</b>. If the outcome is &quot;turned away&quot;, it stays
              archived and your attempt is logged on it instead.
            </p>
          ) : hardBlocked ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              {nameCheck?.message ??
                "That name already exists — open the account instead of adding it twice."}
            </p>
          ) : nameCheck?.status === "free" && nameCheck.note ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              {nameCheck.note}
            </p>
          ) : nameCheck?.status === "free" && name.trim().length >= 2 ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              ✅ The name is free.
            </p>
          ) : null}
          {!blocked && podio === "checking" ? (
            <p className="text-xs text-muted-foreground">Asking Podio…</p>
          ) : !blocked && podio && podio !== "checking" && podio.status === "exists" ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              ⚠️ Already on Podio as “{podio.match}” — don&apos;t submit a duplicate.
            </p>
          ) : !blocked && podio && podio !== "checking" && podio.status === "free" ? (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-700 dark:text-emerald-400">
              🔎 Not on Podio —{" "}
              {PODIO_FORM_URL ? (
                <a
                  href={PODIO_FORM_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  submit it on the national form ↗
                </a>
              ) : (
                "submit it there."
              )}
              <label className="mt-1.5 flex cursor-pointer items-center gap-2">
                <Switch checked={requestedPodio} onCheckedChange={setRequestedPodio} />
                <span>I already submitted it</span>
              </label>
            </div>
          ) : !blocked && podio === null && name.trim().length >= 2 ? (
            <button
              type="button"
              onClick={retryPodio}
              className="w-fit text-xs text-muted-foreground underline"
            >
              Podio didn&apos;t answer — try again
            </button>
          ) : null}

          {fn === "IGT" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Product *</Label>
                <Select value={product || undefined} onValueChange={setProduct}>
                  <SelectTrigger><SelectValue placeholder="GTa or GTe" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GTa">GTa — Global Talent</SelectItem>
                    <SelectItem value="GTe">GTe — Global Teacher</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Sub product</Label>
                <Select value={subProduct || undefined} onValueChange={setSubProduct}>
                  <SelectTrigger><SelectValue placeholder="Their field" /></SelectTrigger>
                  <SelectContent>
                    {IGT_SUB_PRODUCTS.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
          {fn !== "IGT" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                {/* B2C CARRIES ITS OWN THREE TYPES (v23, missed in v33.24) —
                    Courses / Events / Student activities, not the raising
                    account types. It has no industry either. */}
                <Label>Type{fn === "B2C" ? " *" : ""}</Label>
                <Select value={accountType || undefined} onValueChange={setAccountType}>
                  <SelectTrigger>
                    <SelectValue placeholder={fn === "B2C" ? "What is it?" : "Optional"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(fn === "B2C" ? B2C_TYPES : ACCOUNT_TYPES).map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {fn !== "B2C" ? (
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
              ) : null}
            </div>
          ) : null}

          {canSetRequestState ? (
            <div className="grid gap-1.5">
              <Label>Podio request state</Label>
              <Select value={requestState || undefined} onValueChange={setRequestState}>
                <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Checking">Checking</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* the real contacts editor — tags, phone normalization, link kinds */}
          <div className="grid gap-1.5">
            <Label>What you collected at the door</Label>
            <ContactsEditor rows={contacts} onChange={setContacts} />
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

          {wantsDate ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>
                  {outcome === "revisit" ? "Going back on (optional)" : "Follow up on"}
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

          {outcome === "turned_away" ? (
            <div className="grid gap-2 rounded-lg border p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch checked={oop} onCheckedChange={setOop} />
                <span>Archive it — this one isn&apos;t worth another try</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Leave this OFF to keep them in your pipeline: a receptionist
                blocking you today is not a dead partner.
              </p>
              {oop ? (
                <Select value={oopReason} onValueChange={setOopReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OOP_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
          <Button disabled={!canSubmit} onClick={submit}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Footprints className="size-4" />}
            {outcome === "deal" ? "Log it & record the deal" : "Log it"}
          </Button>
        </div>
        {outcome === "deal" ? (
          <p className="text-xs text-muted-foreground">
            The account opens straight onto the deal form — that&apos;s where the
            opens split per product.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
