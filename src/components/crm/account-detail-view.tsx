"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRightLeft, CalendarPlus, CheckCircle2, Mail, MessageCircle,
  Phone, RotateCcw, Trophy, XCircle,
} from "lucide-react";
import {
  markSlotRaised, reassignAccount, reportVisit, reviveAccount,
  scheduleVisit, setOutOfProcess, updateAccount,
} from "@/server/actions";
import type { PipelineRow } from "@/server/data";
import type { ContactAttempt, Visit } from "@/lib/types";
import { StageBadge } from "./stage-badge";
import { ContactDialog, type ContactTarget } from "./contact-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type AttemptWithMember = ContactAttempt & { member: { name: string; nickname: string | null } | null };

interface Caps {
  edit: boolean;
  reassign: boolean;
  tlComment: boolean;
  vpComment: boolean;
  requestState: boolean;
}

const methodIcon = {
  Call: <Phone className="size-3.5" />,
  WhatsApp: <MessageCircle className="size-3.5" />,
  Email: <Mail className="size-3.5" />,
};

export function AccountDetailView({
  account, attempts, visits, caps, reassignTargets, autoReportVisitId,
}: {
  account: PipelineRow;
  attempts: AttemptWithMember[];
  visits: Visit[];
  caps: Caps;
  reassignTargets: { id: string; label: string; function: string | null }[];
  autoReportVisitId: string | null;
}) {
  const pendingVisit = visits.find((v) => v.done === null) ?? null;
  const reportableVisit =
    (autoReportVisitId && visits.find((v) => v.id === autoReportVisitId && v.done === null)) ||
    pendingVisit;

  const [contactOpen, setContactOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(!!autoReportVisitId && !!reportableVisit);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [oopOpen, setOopOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);

  const contactTarget: ContactTarget = {
    id: account.id,
    name: account.name,
    hasPendingVisit: !!pendingVisit,
    nextStepDate: account.next_step_date,
  };

  const active = !account.out_of_process;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href="/accounts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All accounts
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold">{account.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{account.function}</Badge>
            {account.function === "IGV" && account.project ? (
              <Badge variant="outline">{account.project}</Badge>
            ) : null}
            {account.function === "IGT" && account.product ? (
              <Badge variant="outline">
                {account.product === "GTa" ? "Global Talent" : "Global Teacher"}
              </Badge>
            ) : null}
            <StageBadge stage={account.stage} />
            {account.contact_limit_reached ? (
              <Badge className="border-transparent bg-warning/15 text-warning">⚠️ 3-contact limit</Badge>
            ) : null}
            {account.next_step_missing ? (
              <Badge variant="destructive">🚨 next step missing</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Responsible: <b>{account.responsible_nickname || account.responsible_name}</b>
            {account.out_of_process && account.oop_reason ? (
              <span className="text-destructive"> · OOP: {account.oop_reason}</span>
            ) : null}
          </p>
        </div>

        {caps.edit ? (
          <div className="flex flex-wrap gap-2">
            {active && !account.slot_raised ? (
              <>
                <Button onClick={() => setContactOpen(true)}>
                  <Phone className="size-4" /> Contact
                </Button>
                <Button variant="outline" onClick={() => setVisitOpen(true)}>
                  <CalendarPlus className="size-4" />
                  {pendingVisit ? "Reschedule visit" : "Schedule visit"}
                </Button>
                {reportableVisit ? (
                  <Button variant="outline" onClick={() => setReportOpen(true)}>
                    <CheckCircle2 className="size-4" /> Report visit
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="text-success hover:text-success"
                  onClick={() => setDealOpen(true)}
                >
                  <Trophy className="size-4" /> Slot raised
                </Button>
              </>
            ) : null}
            {caps.reassign ? (
              <Button variant="outline" onClick={() => setReassignOpen(true)}>
                <ArrowRightLeft className="size-4" /> Reassign
              </Button>
            ) : null}
            {active ? (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setOopOpen(true)}
              >
                <XCircle className="size-4" /> Out of process
              </Button>
            ) : caps.reassign ? (
              <ReviveButton accountId={account.id} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailsCard account={account} canEdit={caps.edit} />
        <PodioCard account={account} canEdit={caps.edit} canEditState={caps.requestState} />
        <NextStepCard account={account} canEdit={caps.edit && active} />
        <CommentsCard account={account} caps={caps} />
      </div>

      <TimelineCard attempts={attempts} visits={visits} />

      {/* dialogs */}
      <ContactDialog target={contactTarget} open={contactOpen} onOpenChange={setContactOpen} />
      <VisitDialog
        account={account}
        pendingVisit={pendingVisit}
        open={visitOpen}
        onOpenChange={setVisitOpen}
      />
      {reportableVisit ? (
        <ReportVisitDialog visit={reportableVisit} open={reportOpen} onOpenChange={setReportOpen} />
      ) : null}
      <ReassignDialog
        accountId={account.id}
        currentId={account.responsible_id}
        targets={reassignTargets}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
      />
      <OopDialog accountId={account.id} open={oopOpen} onOpenChange={setOopOpen} />
      <DealDialog accountId={account.id} open={dealOpen} onOpenChange={setDealOpen} />
    </div>
  );
}

// ------------------------------------------------------------------ cards

function DetailsCard({ account, canEdit }: { account: PipelineRow; canEdit: boolean }) {
  const [form, setForm] = useState({
    phone: account.phone ?? "",
    email: account.email ?? "",
    social_link: account.social_link ?? "",
    website: account.website ?? "",
    account_type: account.account_type ?? "",
    industry: account.industry ?? "",
    package_plan: account.package_plan ?? "",
    sub_product: account.sub_product ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setDirty(true);
  };
  const save = () =>
    start(async () => {
      const res = await updateAccount(account.id, form);
      if (res.ok) { toast.success("Saved"); setDirty(false); }
      else toast.error(res.error);
    });

  const rows: [string, keyof typeof form][] =
    account.function === "IGV"
      ? [["Phone", "phone"], ["Email", "email"], ["Social link", "social_link"], ["Website", "website"],
         ["Account type", "account_type"], ["Industry", "industry"], ["Package plan", "package_plan"]]
      : [["Phone", "phone"], ["Email", "email"], ["Social link", "social_link"], ["Website", "website"],
         ["Sub product", "sub_product"]];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map(([label, key]) => (
          <div key={key} className="grid grid-cols-[110px_1fr] items-center gap-2">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            {canEdit ? (
              <Input className="h-8" value={form[key]} onChange={set(key)} />
            ) : (
              <p className="truncate text-sm">{form[key] || "—"}</p>
            )}
          </div>
        ))}
        {canEdit && dirty ? (
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save details"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PodioCard({
  account, canEdit, canEditState,
}: { account: PipelineRow; canEdit: boolean; canEditState: boolean }) {
  const [pending, start] = useTransition();
  const [requested, setRequested] = useState(account.requested_podio);
  const [state, setState] = useState(account.request_state ?? "");

  const save = (patch: { requested_podio?: boolean; request_state?: "Checking" | "Approved" | "Rejected" }) =>
    start(async () => {
      const res = await updateAccount(account.id, patch);
      if (!res.ok) toast.error(res.error);
    });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Podio (AMS)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Requested on Podio?</p>
            <p className="text-xs text-muted-foreground">Filled by the account owner</p>
          </div>
          <Switch
            checked={requested}
            disabled={!canEdit || pending}
            onCheckedChange={(v) => { setRequested(v); save({ requested_podio: v }); }}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Request state</p>
            <p className="text-xs text-muted-foreground">Set by TL / Coordinator / VP</p>
          </div>
          <Select
            value={state || "__none"}
            disabled={!canEditState || pending}
            onValueChange={(v) => {
              const val = v === "__none" ? "" : v;
              setState(val);
              if (val) save({ request_state: val as "Checking" | "Approved" | "Rejected" });
            }}
          >
            <SelectTrigger className="w-36"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">—</SelectItem>
              <SelectItem value="Checking">Checking</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {account.podio_link ? (
          <a
            href={account.podio_link}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm text-primary hover:underline"
          >
            {account.podio_link}
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NextStepCard({ account, canEdit }: { account: PipelineRow; canEdit: boolean }) {
  const [step, setStep] = useState(account.next_step ?? "");
  const [date, setDate] = useState(account.next_step_date ?? "");
  const [time, setTime] = useState(account.next_step_time?.slice(0, 5) ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await updateAccount(account.id, {
        next_step: step, next_step_date: date || null, next_step_time: time || null,
      });
      if (res.ok) { toast.success("Next step saved"); setDirty(false); }
      else toast.error(res.error);
    });

  return (
    <Card className={account.next_step_missing ? "border-destructive/50" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">
          Next step {account.next_step_missing ? <span className="text-sm font-normal text-destructive">— required!</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input
          placeholder="What happens next with this account?"
          value={step}
          disabled={!canEdit}
          onChange={(e) => { setStep(e.target.value); setDirty(true); }}
        />
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={date} disabled={!canEdit}
            onChange={(e) => { setDate(e.target.value); setDirty(true); }} />
          <Input type="time" value={time} disabled={!canEdit}
            onChange={(e) => { setTime(e.target.value); setDirty(true); }} />
        </div>
        {canEdit && dirty ? (
          <Button size="sm" onClick={save} disabled={pending || (!!step && !date)}>
            {pending ? "Saving…" : "Save next step"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CommentsCard({ account, caps }: { account: PipelineRow; caps: Caps }) {
  const [pending, start] = useTransition();
  const fields = [
    { key: "final_comment" as const, label: "Final comment", editable: caps.edit },
    { key: "tl_comment" as const, label: "TL comment", editable: caps.tlComment },
    { key: "vp_comment" as const, label: "VP comment", editable: caps.vpComment },
  ];
  const [values, setValues] = useState<Record<string, string>>({
    final_comment: account.final_comment ?? "",
    tl_comment: account.tl_comment ?? "",
    vp_comment: account.vp_comment ?? "",
  });
  const [dirtyKey, setDirtyKey] = useState<string | null>(null);

  const save = (key: string) =>
    start(async () => {
      const res = await updateAccount(account.id, { [key]: values[key] });
      if (res.ok) { toast.success("Comment saved"); setDirtyKey(null); }
      else toast.error(res.error);
    });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Comments</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{f.label}</Label>
            <Textarea
              rows={2}
              value={values[f.key]}
              disabled={!f.editable}
              onChange={(e) => { setValues((v) => ({ ...v, [f.key]: e.target.value })); setDirtyKey(f.key); }}
            />
            {f.editable && dirtyKey === f.key ? (
              <Button size="sm" variant="outline" onClick={() => save(f.key)} disabled={pending}>
                Save
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TimelineCard({ attempts, visits }: { attempts: AttemptWithMember[]; visits: Visit[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
      <CardContent>
        {visits.length > 0 ? (
          <div className="mb-4 space-y-2">
            {visits.map((v) => (
              <div key={v.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <CalendarPlus className="mt-0.5 size-4 text-primary" />
                <div>
                  <p className="font-medium">
                    Visit · {v.visit_date} at {v.visit_time?.slice(0, 5)}{" "}
                    {v.done === null ? (
                      <Badge variant="outline" className="ml-1">pending</Badge>
                    ) : v.done ? (
                      <Badge className="ml-1 border-transparent bg-success/15 text-success">done</Badge>
                    ) : (
                      <Badge variant="destructive" className="ml-1">not completed</Badge>
                    )}
                  </p>
                  {v.visit_comment ? <p className="text-muted-foreground">{v.visit_comment}</p> : null}
                  {v.next_step ? <p className="text-muted-foreground">Next: {v.next_step}</p> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {attempts.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No contact attempts logged yet.</p>
        ) : (
          <div className="space-y-1.5">
            {attempts.map((a, i) => (
              <div key={a.id} className="flex items-start gap-3 rounded-lg p-2 text-sm hover:bg-muted/50">
                <span className="mt-0.5 text-muted-foreground">{methodIcon[a.method]}</span>
                <div className="min-w-0 flex-1">
                  <p>
                    <b>Contact #{attempts.length - i}</b> · {a.method} ·{" "}
                    <span className={a.status === "No Response" ? "text-warning" : "text-success"}>
                      {a.status}
                    </span>
                  </p>
                  {a.comment ? <p className="text-muted-foreground">{a.comment}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {a.member?.nickname || a.member?.name} · {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ dialogs

function VisitDialog({
  account, pendingVisit, open, onOpenChange,
}: {
  account: PipelineRow;
  pendingVisit: Visit | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [date, setDate] = useState(pendingVisit?.visit_date ?? "");
  const [time, setTime] = useState(pendingVisit?.visit_time?.slice(0, 5) ?? "");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await scheduleVisit({ accountId: account.id, visitDate: date, visitTime: time, notes });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(
        res.data?.calendarLinked
          ? "Visit scheduled — reminders set on the responsible's calendar (24h & 1h before)"
          : "Visit scheduled. Calendar reminder could not be created — the responsible should sign in once to grant calendar access."
      );
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{pendingVisit ? "Reschedule visit" : "Schedule visit"} — {account.name}</DialogTitle>
          <DialogDescription>
            The responsible member gets calendar reminders exactly 24 hours and 1 hour before.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes (go on the calendar event)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Address, who to meet…" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !date || !time}>
            {pending ? "Scheduling…" : pendingVisit ? "Reschedule" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportVisitDialog({
  visit, open, onOpenChange,
}: { visit: Visit; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [done, setDone] = useState(true);
  const [comment, setComment] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [nextStepDate, setNextStepDate] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await reportVisit({ visitId: visit.id, done, comment, nextStep, nextStepDate });
      if (res.ok) {
        toast.success("Visit reported — your TL & VP were notified 📬");
        onOpenChange(false);
      } else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report visit · {visit.visit_date}</DialogTitle>
          <DialogDescription>
            Your TL and VP get an email with this report the moment you save it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={done ? "default" : "outline"} onClick={() => setDone(true)}>
              ✅ Completed
            </Button>
            <Button variant={!done ? "destructive" : "outline"} onClick={() => setDone(false)}>
              ❌ Didn&apos;t happen
            </Button>
          </div>
          <div className="grid gap-1.5">
            <Label>Visit comment *</Label>
            <Textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="How did it go? Who did you meet? Key outcomes…"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Next step</Label>
            <Input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="e.g. Send the proposal" />
            <Input type="date" value={nextStepDate} onChange={(e) => setNextStepDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || comment.trim().length < 2}>
            {pending ? "Sending…" : "Save & notify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReassignDialog({
  accountId, currentId, targets, open, onOpenChange,
}: {
  accountId: string;
  currentId: string;
  targets: { id: string; label: string }[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [target, setTarget] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await reassignAccount(accountId, target);
      if (res.ok) { toast.success("Responsibility changed"); onOpenChange(false); }
      else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change responsibility</DialogTitle>
          <DialogDescription>Move this account to another member in your scope.</DialogDescription>
        </DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger><SelectValue placeholder="Choose a member…" /></SelectTrigger>
          <SelectContent>
            {targets.filter((t) => t.id !== currentId).map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !target}>
            {pending ? "Moving…" : "Reassign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OopDialog({
  accountId, open, onOpenChange,
}: { accountId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await setOutOfProcess(accountId, reason);
      if (res.ok) { toast.success("Marked Out of Process"); onOpenChange(false); }
      else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark Out of Process</DialogTitle>
          <DialogDescription>
            The account leaves the active pipeline. A TL, VP or the LCP can bring it back.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>Reason *</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it out?" />
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={submit} disabled={pending || reason.trim().length < 2}>
            {pending ? "Saving…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DealDialog({
  accountId, open, onOpenChange,
}: { accountId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [slots, setSlots] = useState("1");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await markSlotRaised(accountId, Number(slots));
      if (res.ok) { toast.success("🎉 Deal done — slots counted on the dashboard!"); onOpenChange(false); }
      else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>🏆 Slot raised!</DialogTitle>
          <DialogDescription>How many slots were signed with this account?</DialogDescription>
        </DialogHeader>
        <Input type="number" min={1} value={slots} onChange={(e) => setSlots(e.target.value)} />
        <DialogFooter>
          <Button onClick={submit} disabled={pending || Number(slots) < 1}>
            {pending ? "Saving…" : "Confirm deal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviveButton({ accountId }: { accountId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await reviveAccount(accountId);
          if (res.ok) toast.success("Account is back in process");
          else toast.error(res.error);
        })
      }
    >
      <RotateCcw className="size-4" /> {pending ? "Reviving…" : "Back in process"}
    </Button>
  );
}
