"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, CalendarPlus, CheckCircle2, FileText, Loader2, Mail, MessageSquareText,
  Paperclip, Phone, Pin, PinOff, RotateCcw, Trophy, Upload, XCircle,
} from "lucide-react";
import {
  addComment, confirmContractUploads, getContractUrl, reassignAccount, recordDeal,
  reportVisit, requestContractUploads, reviveAccount, scheduleVisit, setOutOfProcess,
  toggleCommentPin, updateAccount, updateAccountContacts,
} from "@/server/actions";
import type { CommentWithMember, DealWithMember, PipelineRow } from "@/server/data";
import type { ContactAttempt, Visit } from "@/lib/types";
import {
  ACCOUNT_TYPES, fmtDateTime, IGT_SUB_PRODUCTS, IGV_PROJECTS, INDUSTRIES,
  OOP_REASONS, productBadge,
} from "@/lib/types";
import type { AccountContact } from "@/lib/types";
import { Hint } from "./hint";
import { MultiPick } from "./multi-pick";
import { ContactsEditor, contactsValid } from "./contacts-editor";
import { WhatsAppIcon } from "./icons";
import { ProposalDialog } from "./proposal-dialog";
import { ConfettiBurst } from "./confetti";
import { cn } from "@/lib/utils";
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
  requestState: boolean;
}

const methodIcon = {
  Call: <Phone className="size-3.5" />,
  WhatsApp: <WhatsAppIcon className="size-3.5" />,
  Email: <Mail className="size-3.5" />,
};

export function AccountDetailView({
  account, attempts, visits, comments, deals, caps, reassignTargets, autoReportVisitId,
}: {
  account: PipelineRow;
  attempts: AttemptWithMember[];
  visits: Visit[];
  comments: CommentWithMember[];
  deals: DealWithMember[];
  caps: Caps;
  reassignTargets: { id: string; label: string }[];
  autoReportVisitId: string | null;
}) {
  const pendingVisit = visits.find((v) => v.done === null) ?? null;
  const reportableVisit =
    (autoReportVisitId && visits.find((v) => v.id === autoReportVisitId && v.done === null)) ||
    pendingVisit;

  const [contactOpen, setContactOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(!!autoReportVisitId && !!reportableVisit);
  const [oopOpen, setOopOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);

  const contactTarget: ContactTarget = {
    id: account.id,
    name: account.name,
    hasPendingVisit: !!pendingVisit,
    nextStepDate: account.next_step_date,
  };

  const active = !account.out_of_process;
  const fnBadge = productBadge(account.function, account.product);

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
            <Badge className={cn("border-transparent font-semibold", fnBadge.bg, fnBadge.text)}>
              {fnBadge.label}
            </Badge>
            {account.function === "IGV" && account.project ? (
              <Badge variant="outline">{account.project}</Badge>
            ) : null}
            <StageBadge stage={account.stage} />
            {account.deals_count > 0 ? (
              <Hint
                label={[
                  account.slots_igv_count ? `${account.slots_igv_count} IGV` : null,
                  account.slots_igta_count ? `${account.slots_igta_count} IGTa` : null,
                  account.slots_igte_count ? `${account.slots_igte_count} IGTe` : null,
                ].filter(Boolean).join(" · ") || "opens"}
              >
                <Badge className="border-transparent bg-success/15 text-success">
                  🏆 {account.deals_count} deal{account.deals_count === 1 ? "" : "s"} · {account.slots_count} open{account.slots_count === 1 ? "" : "s"}
                </Badge>
              </Hint>
            ) : null}
            {account.contact_limit_reached ? (
              <Badge className="border-transparent bg-warning/15 text-warning">⚠️ 3-contact limit</Badge>
            ) : null}
            {account.next_step_missing ? (
              <Badge variant="destructive">🚨 next step missing</Badge>
            ) : null}
          </div>
          <ResponsibleRow
            account={account}
            canReassign={caps.reassign}
            targets={reassignTargets}
          />
        </div>

        {caps.edit ? (
          <div className="flex flex-wrap gap-2">
            {active ? (
              <>
                <Hint label="Log a call / WhatsApp / email attempt — every attempt counts">
                  <Button onClick={() => setContactOpen(true)}>
                    <Phone className="size-4" /> Contact
                  </Button>
                </Hint>
                <Hint label="Book the company visit — reminders land on the responsible's calendar 24h & 1h before">
                  <Button variant="outline" onClick={() => setVisitOpen(true)}>
                    <CalendarPlus className="size-4" />
                    {pendingVisit ? "Reschedule visit" : "Schedule visit"}
                  </Button>
                </Hint>
                <Hint label="Generate the ICX proposal email as a draft in YOUR Gmail — review & send it yourself">
                  <Button variant="outline" onClick={() => setProposalOpen(true)}>
                    <FileText className="size-4" /> Proposal email
                  </Button>
                </Hint>
                {reportableVisit ? (
                  <Hint label="Tell your leaders how the visit went — they're notified instantly">
                    <Button variant="outline" onClick={() => setReportOpen(true)}>
                      <CheckCircle2 className="size-4" /> Report visit
                    </Button>
                  </Hint>
                ) : null}
                <Hint label="Deal signed! Record it — accounts can close many deals over time">
                  <Button
                    variant="outline"
                    className="text-success hover:text-success"
                    onClick={() => setDealOpen(true)}
                  >
                    <Trophy className="size-4" />
                    {account.deals_count > 0 ? "New deal" : "Deal signed"}
                  </Button>
                </Hint>
              </>
            ) : null}
            {active ? (
              <Hint label="Close & archive this account — its name can never be added again">
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setOopOpen(true)}
                >
                  <XCircle className="size-4" /> Out of process
                </Button>
              </Hint>
            ) : caps.reassign ? (
              <ReviveButton accountId={account.id} />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ContactInfoCard account={account} canEdit={caps.edit} />
        <DetailsCard account={account} canEdit={caps.edit} />
        <PodioCard account={account} canEdit={caps.edit} canEditState={caps.requestState} />
        <NextStepCard account={account} canEdit={caps.edit && active} />
        <CommentsCard accountId={account.id} comments={comments} canComment={caps.edit} />
      </div>

      <TimelineCard attempts={attempts} visits={visits} deals={deals} canEdit={caps.edit} />

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
      <OopDialog accountId={account.id} open={oopOpen} onOpenChange={setOopOpen} />
      <ProposalDialog account={account} open={proposalOpen} onOpenChange={setProposalOpen} />
      <DealDialog
        accountId={account.id}
        fn={account.function}
        dealNumber={account.deals_count + 1}
        open={dealOpen}
        onOpenChange={setDealOpen}
      />
    </div>
  );
}

/** Responsible: read-only for members; Team Leaders pick between themselves and
 *  their members, VPs across the function, the LCP anywhere. */
function ResponsibleRow({
  account, canReassign, targets,
}: {
  account: PipelineRow;
  canReassign: boolean;
  targets: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (!canReassign || targets.length <= 1) {
    return (
      <p className="text-sm text-muted-foreground">
        Responsible: <b>{account.responsible_nickname || account.responsible_name}</b>
        {account.out_of_process && account.oop_reason ? (
          <span className="text-destructive"> · Archived: {account.oop_reason}</span>
        ) : null}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>Responsible:</span>
      <Select
        value={account.responsible_id}
        disabled={pending}
        onValueChange={(v) =>
          start(async () => {
            const res = await reassignAccount(account.id, v);
            if (res.ok) { toast.success("Responsibility changed"); router.refresh(); }
            else toast.error(res.error);
          })
        }
      >
        <SelectTrigger className="h-8 w-auto min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {targets.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {account.out_of_process && account.oop_reason ? (
        <span className="text-destructive">Archived: {account.oop_reason}</span>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ cards

/** Details: type / industry / sub-product (multi-select). All phones, emails
 *  and links live in the tagged Contact info card. */
function DetailsCard({ account, canEdit }: { account: PipelineRow; canEdit: boolean }) {
  const [form, setForm] = useState({
    project: account.project ?? "",
    account_type: account.account_type ?? "",
    industry: account.industry ?? "",
    sub_product: account.sub_product ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const allOk = true;

  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const save = () =>
    start(async () => {
      const res = await updateAccount(account.id, form);
      if (res.ok) { toast.success("Saved"); setDirty(false); }
      else toast.error(res.error);
    });

  const listRow = (label: string, key: "account_type") => {
    const value = form[key];
    const inList = (ACCOUNT_TYPES as readonly string[]).includes(value);
    return (
      <div key={key} className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center sm:gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {canEdit ? (
          <div className="grid min-w-0 gap-1">
            <Select
              value={value ? (inList ? value : "Other") : undefined}
              onValueChange={(v) => set(key)(v === "Other" ? (inList ? "" : value) : v)}
            >
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            {value && !inList ? (
              <Input
                className="h-8"
                value={value}
                onChange={(e) => set(key)(e.target.value)}
                placeholder={`Other ${label.toLowerCase()}…`}
              />
            ) : null}
          </div>
        ) : (
          <p className="truncate text-sm">{value || "—"}</p>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {account.function === "IGV" || account.function === "B2B" ? (
          <>
            {account.function === "IGV" ? (
              <div className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center sm:gap-2">
                <Label className="text-xs text-muted-foreground">Project</Label>
                {canEdit ? (
                  <Select
                    value={form.project || undefined}
                    onValueChange={(v) => set("project")(v)}
                  >
                    <SelectTrigger className="h-8"><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>
                      {IGV_PROJECTS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="truncate text-sm">{form.project || "—"}</p>
                )}
              </div>
            ) : null}
            {listRow("Account type", "account_type")}
            {canEdit ? (
              <MultiPick
                label="Industry"
                options={INDUSTRIES}
                value={form.industry}
                onChange={set("industry")}
                compact
              />
            ) : (
              <div className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center sm:gap-2">
                <Label className="text-xs text-muted-foreground">Industry</Label>
                <p className="truncate text-sm">{form.industry || "—"}</p>
              </div>
            )}
          </>
        ) : canEdit ? (
          <MultiPick
            label="Sub product"
            options={IGT_SUB_PRODUCTS}
            value={form.sub_product}
            onChange={set("sub_product")}
            compact
          />
        ) : (
          <div className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center sm:gap-2">
            <Label className="text-xs text-muted-foreground">Sub product</Label>
            <p className="truncate text-sm">{form.sub_product || "—"}</p>
          </div>
        )}
        {canEdit && dirty ? (
          <Button size="sm" onClick={save} disabled={pending || !allOk}>
            {pending ? "Saving…" : "Save details"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Tagged phones, emails & links — add as many as the account needs. */
function ContactInfoCard({
  account, canEdit,
}: { account: PipelineRow; canEdit: boolean }) {
  const initial: AccountContact[] =
    account.contacts && account.contacts.length > 0
      ? account.contacts
      : ([
          ...(account.phone ? [{ tag: "Contact", kind: "phone", value: account.phone }] : []),
          ...(account.email ? [{ tag: "Contact", kind: "email", value: account.email }] : []),
          ...(account.social_link ? [{ tag: "Other", kind: "link", value: account.social_link }] : []),
          ...(account.website ? [{ tag: "Website", kind: "link", value: account.website }] : []),
        ] as AccountContact[]);
  const [rows, setRows] = useState<AccountContact[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await updateAccountContacts(account.id, rows);
      if (res.ok) { toast.success("Contact info saved"); setDirty(false); }
      else toast.error(res.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contact info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <ContactsEditor
          rows={rows}
          disabled={!canEdit}
          onChange={(r) => { setRows(r); setDirty(true); }}
        />
        {canEdit && dirty ? (
          <Button size="sm" onClick={save} disabled={pending || !contactsValid(rows)}>
            {pending ? "Saving…" : "Save contact info"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PodioCard({
  account, canEdit, canEditState,
}: { account: PipelineRow; canEdit: boolean; canEditState: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [requested, setRequested] = useState(account.requested_podio);
  const [state, setState] = useState(account.request_state ?? "");
  const [confirmReject, setConfirmReject] = useState(false);

  const save = (patch: { requested_podio?: boolean; request_state?: "Checking" | "Approved" | "Rejected" }) =>
    start(async () => {
      const res = await updateAccount(account.id, patch);
      if (!res.ok) { toast.error(res.error); return; }
      if (patch.request_state === "Rejected") {
        toast.success(`"${account.name}" archived — Podio request rejected.`);
        router.refresh();
      }
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
            <p className="text-xs text-muted-foreground">
              Set by TL / Coordinator / VP · Rejected = archived
            </p>
          </div>
          <Select
            value={state || "__none"}
            disabled={!canEditState || pending}
            onValueChange={(v) => {
              const val = v === "__none" ? "" : v;
              if (val === "Rejected") { setConfirmReject(true); return; }
              setState(val);
              if (val) save({ request_state: val as "Checking" | "Approved" });
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
      </CardContent>

      {/* Rejected on Podio closes the account — confirm first */}
      <Dialog open={confirmReject} onOpenChange={setConfirmReject}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>⚠️ Reject the Podio request?</DialogTitle>
            <DialogDescription>
              A rejected Podio request closes the account: <b>{account.name}</b> moves
              to the archive (Out of Process) and its name can never be added
              again — exactly like &quot;Not Interested&quot;.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmReject(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setState("Rejected");
                setConfirmReject(false);
                save({ request_state: "Rejected" });
              }}
            >
              Reject & archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

/** Numbered comments: everyone logs as many as needed. TL/VP/LCP comments carry
 *  their label ("VP Comment #2"); numbering is automatic per label. */
function CommentsCard({
  accountId, comments, canComment,
}: {
  accountId: string;
  comments: CommentWithMember[];
  canComment: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  // chronological numbering per label class
  const counters: Record<string, number> = {};
  const numbered = comments.map((c) => {
    counters[c.author_label] = (counters[c.author_label] ?? 0) + 1;
    const n = counters[c.author_label];
    return {
      ...c,
      title: c.author_label === "Member" ? `Comment #${n}` : `${c.author_label} Comment #${n}`,
    };
  });
  // pinned first, then newest
  const ordered = [...numbered].sort((a, b) =>
    a.pinned === b.pinned
      ? b.created_at.localeCompare(a.created_at)
      : a.pinned
        ? -1
        : 1
  );

  const submit = () =>
    start(async () => {
      const res = await addComment(accountId, body);
      if (res.ok) {
        toast.success("Comment logged");
        setBody("");
        router.refresh();
      } else toast.error(res.error);
    });

  const togglePin = (id: string, pinned: boolean) =>
    start(async () => {
      const res = await toggleCommentPin(id, pinned);
      if (res.ok) {
        toast.success(pinned ? "📌 Pinned — it now shows on the accounts list" : "Unpinned");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="size-4 text-muted-foreground" />
          Comments
          {numbered.length > 0 ? (
            <Badge variant="outline" className="ml-1">{numbered.length}</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ordered.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">
            No comments yet.
          </p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {ordered.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "rounded-lg border p-2.5 text-sm",
                  c.pinned && "border-warning/60 bg-warning/10"
                )}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  {c.pinned ? <Pin className="size-3.5 fill-current text-warning" /> : null}
                  <Badge
                    className={cn(
                      "border-transparent",
                      c.author_label === "Member"
                        ? "bg-muted text-muted-foreground"
                        : c.author_label === "TL"
                          ? "bg-chart-4/15 text-chart-4"
                          : c.author_label === "Admin"
                            ? "bg-gt/15 text-gt"
                            : "bg-primary/15 text-primary"
                    )}
                  >
                    {c.title}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {c.member?.nickname || c.member?.name || "—"} ·{" "}
                    {fmtDateTime(c.created_at)}
                  </span>
                  {canComment ? (
                    <Hint label={c.pinned ? "Unpin this comment" : "Pin — highlights it AND shows a 📌 on the accounts list"}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-warning"
                        disabled={pending}
                        onClick={() => togglePin(c.id, !c.pinned)}
                      >
                        {c.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                      </Button>
                    </Hint>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
          </div>
        )}
        {canComment ? (
          <div className="space-y-2">
            <Textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Log a new comment — it gets numbered automatically"
            />
            <Button size="sm" variant="outline" onClick={submit} disabled={pending || body.trim().length < 2}>
              {pending ? "Saving…" : "Add comment"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Uploads contract files straight to the private Storage bucket via signed
 *  URLs (the bytes never pass through a server action), then records them. */
async function uploadContracts(
  dealId: string,
  files: File[]
): Promise<{ ok: boolean; error?: string; uploaded?: number }> {
  const metas = files.map((f) => ({
    name: f.name,
    type: f.type || "application/octet-stream",
    size: f.size,
  }));
  const req = await requestContractUploads(dealId, metas);
  if (!req.ok) return { ok: false, error: req.error };

  const done: { path: string; name: string; type: string; size: number }[] = [];
  for (let i = 0; i < (req.data?.uploads.length ?? 0); i++) {
    const u = req.data!.uploads[i];
    const f = files[i];
    try {
      const put = await fetch(u.signedUrl, {
        method: "PUT",
        headers: { "content-type": f.type || "application/octet-stream" },
        body: f,
      });
      if (put.ok) done.push({ path: u.path, name: f.name, type: f.type || "application/octet-stream", size: f.size });
    } catch {
      // fall through — reported below
    }
  }
  if (done.length === 0) return { ok: false, error: "The file upload failed — check your connection and try again." };
  const confirm = await confirmContractUploads(dealId, done);
  if (!confirm.ok) return { ok: false, error: confirm.error };
  return { ok: true, uploaded: done.length };
}

/** Contract chips on a deal + the (optional, any-time) upload button. */
function DealContracts({ deal, canEdit }: { deal: DealWithMember; canEdit: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const contracts = deal.contracts ?? [];

  const openContract = async (path: string) => {
    setOpening(path);
    const res = await getContractUrl(deal.id, path);
    setOpening(null);
    if (res.ok && res.data) window.open(res.data.url, "_blank", "noopener");
    else toast.error(res.ok ? "Could not open the contract." : res.error);
  };

  const onPick = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setBusy(true);
    const res = await uploadContracts(deal.id, files);
    setBusy(false);
    if (res.ok) {
      toast.success(`📎 ${res.uploaded} contract file${res.uploaded === 1 ? "" : "s"} uploaded.`);
      router.refresh();
    } else toast.error(res.error);
    if (fileRef.current) fileRef.current.value = "";
  };

  if (contracts.length === 0 && !canEdit) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {contracts.map((c) => (
        <button
          key={c.path}
          type="button"
          onClick={() => openContract(c.path)}
          className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-success/40 bg-background px-2.5 py-0.5 text-xs font-medium hover:border-success hover:bg-success/10"
          title={`Open ${c.name}`}
        >
          {opening === c.path ? (
            <Loader2 className="size-3 shrink-0 animate-spin" />
          ) : (
            <Paperclip className="size-3 shrink-0" />
          )}
          <span className="truncate">{c.name}</span>
        </button>
      ))}
      {canEdit ? (
        <>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />
          <Hint label={contracts.length > 0 ? "Add more contract files" : "Upload the signed contract(s) — any file format"}>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
              {contracts.length > 0 ? "Add contract" : "Upload contract"}
            </button>
          </Hint>
        </>
      ) : null}
    </div>
  );
}

function TimelineCard({
  attempts, visits, deals, canEdit,
}: {
  attempts: AttemptWithMember[];
  visits: Visit[];
  deals: DealWithMember[];
  canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
      <CardContent>
        {deals.length > 0 ? (
          <div className="mb-4 space-y-2">
            {deals.map((d, i) => {
              const split = [
                d.slots_igv ? `${d.slots_igv} IGV` : null,
                d.slots_igta ? `${d.slots_igta} IGTa` : null,
                d.slots_igte ? `${d.slots_igte} IGTe` : null,
              ].filter(Boolean);
              return (
                <div key={d.id} className="flex items-start gap-3 rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
                  <Trophy className="mt-0.5 size-4 text-success" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      Deal #{deals.length - i} · {d.slots} open{d.slots === 1 ? "" : "s"}
                      {split.length > 0 ? (
                        <span className="font-normal text-muted-foreground"> ({split.join(" · ")})</span>
                      ) : null}
                    </p>
                    {d.note ? <p className="text-muted-foreground">{d.note}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {d.member?.nickname || d.member?.name || "—"} · {fmtDateTime(d.created_at)}
                    </p>
                    <DealContracts deal={d} canEdit={canEdit} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
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
                    <span
                      className={
                        a.status === "No Response"
                          ? "text-warning"
                          : a.status === "Call Scheduled"
                            ? "text-primary"
                            : "text-success"
                      }
                    >
                      {a.status === "Call Scheduled" ? "📅 " : ""}{a.status}
                    </span>
                  </p>
                  {a.comment ? <p className="text-muted-foreground">{a.comment}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {a.member?.nickname || a.member?.name} · {fmtDateTime(a.created_at)}
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
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setFailed(false);
      const res = await scheduleVisit({ accountId: account.id, visitDate: date, visitTime: time, notes });
      if (!res.ok) { toast.error(res.error); return; }
      if (res.data?.inviteSent) {
        const shared = res.data.sharedCount;
        toast.success(
          `Visit scheduled — a calendar invite is in the responsible's inbox${shared ? ` and shared with ${shared} leader${shared === 1 ? "" : "s"}` : ""}. Reminders 24h & 1h before 🗓️`
        );
        onOpenChange(false);
      } else {
        // the invite email couldn't go out (mail pipeline) — visit is still saved
        toast.message("Visit saved ✅ — but the calendar invite couldn't be emailed. Check with the IM team.");
        setFailed(true);
      }
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setFailed(false); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{pendingVisit ? "Reschedule visit" : "Schedule visit"} — {account.name}</DialogTitle>
          <DialogDescription>
            A calendar invite is emailed to the responsible and shared with their
            Team Leader &amp; VP — with reminders 24 hours and 1 hour before.
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
            <Label>Notes (go on the calendar invite)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Address, who to meet…" />
          </div>

          {failed ? (
            <div className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
              <p className="font-medium text-warning">⚠️ Invite email didn&apos;t send</p>
              <p className="mt-1 text-muted-foreground">
                The visit is saved, but the calendar invite couldn&apos;t be emailed
                right now — the IM mailbox may be rate-limited. Try again in a minute.
              </p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !date || !time}>
            {pending ? "Scheduling…" : failed ? "Try again" : pendingVisit ? "Reschedule" : "Schedule"}
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

function OopDialog({
  accountId, open, onOpenChange,
}: { accountId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [other, setOther] = useState(false);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await setOutOfProcess(accountId, reason);
      if (res.ok) { toast.success("Account archived (Out of Process)"); onOpenChange(false); }
      else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark Out of Process</DialogTitle>
          <DialogDescription>
            The account leaves the active pipeline and is archived — its name
            can never be added again. A TL, VP or the LCP can bring it back.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>Reason *</Label>
          <Select
            value={other ? "Other" : reason || undefined}
            onValueChange={(v) => {
              if (v === "Other") { setOther(true); setReason(""); }
              else { setOther(false); setReason(v); }
            }}
          >
            <SelectTrigger><SelectValue placeholder="Why is it out?" /></SelectTrigger>
            <SelectContent>
              {OOP_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              <SelectItem value="Other">Other…</SelectItem>
            </SelectContent>
          </Select>
          {other ? (
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Type the reason…" />
          ) : null}
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

/** Records a deal's opens PER PRODUCT. IGV accounts sign IGV opens; IGT accounts
 *  split IGTa + IGTe; B2B accounts mix all three (e.g. 3 IGV + 2 IGTe + 1 IGTa). */
function DealDialog({
  accountId, fn, dealNumber, open, onOpenChange,
}: {
  accountId: string;
  fn: "IGV" | "IGT" | "B2B";
  dealNumber: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [igv, setIgv] = useState(fn === "IGV" ? "1" : "0");
  const [igta, setIgta] = useState("0");
  const [igte, setIgte] = useState("0");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [celebrate, setCelebrate] = useState(false);
  const [pending, start] = useTransition();

  // which product fields to show for this account
  const showIgv = fn === "IGV" || fn === "B2B";
  const showIgta = fn === "IGT" || fn === "B2B";
  const showIgte = fn === "IGT" || fn === "B2B";
  const total =
    (showIgv ? Number(igv) || 0 : 0) +
    (showIgta ? Number(igta) || 0 : 0) +
    (showIgte ? Number(igte) || 0 : 0);

  const submit = () =>
    start(async () => {
      const res = await recordDeal(
        accountId,
        {
          igv: showIgv ? Number(igv) || 0 : 0,
          igta: showIgta ? Number(igta) || 0 : 0,
          igte: showIgte ? Number(igte) || 0 : 0,
        },
        note
      );
      if (res.ok) {
        toast.success(
          `🎉 Deal #${res.data?.deals} recorded — ${res.data?.slots} total open${(res.data?.slots ?? 0) === 1 ? "" : "s"} with this account!`
        );
        // contracts are optional — the deal is already saved even if this fails,
        // and files can always be added later from the deal's history entry
        if (files.length > 0 && res.data?.dealId) {
          const up = await uploadContracts(res.data.dealId, files);
          if (up.ok) toast.success(`📎 ${up.uploaded} contract file${up.uploaded === 1 ? "" : "s"} attached to the deal.`);
          else toast.error(`The deal is saved, but the contract upload failed: ${up.error} You can upload it any time from the deal in History.`);
        }
        setCelebrate(true);
        setIgv(fn === "IGV" ? "1" : "0"); setIgta("0"); setIgte("0"); setNote(""); setFiles([]);
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const numField = (label: string, colorClass: string, value: string, onChange: (v: string) => void) => (
    <div className="grid gap-1.5">
      <Label className={colorClass}>{label} opens</Label>
      <Input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  return (
    <>
    {celebrate ? <ConfettiBurst onDone={() => setCelebrate(false)} /> : null}
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>🏆 Deal #{dealNumber}</DialogTitle>
          <DialogDescription>
            {fn === "B2B"
              ? "How many opens were signed in THIS deal, per product? e.g. 3 IGV · 2 IGTe · 1 IGTa."
              : fn === "IGT"
                ? "Split this deal's opens across IGTa and IGTe."
                : "How many IGV opens were signed in THIS deal?"}
            {" "}Accounts can close more deals later — every one is counted.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className={cn("grid gap-3", fn === "B2B" ? "grid-cols-3" : showIgta ? "grid-cols-2" : "grid-cols-1")}>
            {showIgv ? numField("IGV", "text-gv", igv, setIgv) : null}
            {showIgta ? numField("IGTa", "text-gt", igta, setIgta) : null}
            {showIgte ? numField("IGTe", "text-gte", igte, setIgte) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Total this deal: <b className="text-foreground">{total} open{total === 1 ? "" : "s"}</b>
          </p>
          <div className="grid gap-1.5">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. summer peak bulk deal" />
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5">
              <Paperclip className="size-3.5" /> Contract file(s) — optional
            </Label>
            <Input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <p className="text-xs text-muted-foreground">
              Any format works (PDF, photo, scan, doc…). You can also add them later from the deal in History.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || total < 1}>
            {pending ? "Saving…" : files.length > 0 ? `Record deal + upload ${files.length} file${files.length === 1 ? "" : "s"}` : "Record deal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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
