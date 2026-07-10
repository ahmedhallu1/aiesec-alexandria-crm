"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, CalendarPlus, CheckCircle2, Mail, MessageCircle, MessageSquareText,
  Phone, Plus, RotateCcw, Trash2, Trophy, XCircle,
} from "lucide-react";
import {
  addComment, markSlotRaised, reassignAccount, reportVisit, reviveAccount,
  scheduleVisit, setOutOfProcess, updateAccount, updateAccountContacts,
} from "@/server/actions";
import type { CommentWithMember, PipelineRow } from "@/server/data";
import type { ContactAttempt, Visit } from "@/lib/types";
import {
  ACCOUNT_TYPES, cleanPhone, EMAIL_RE, IGT_SUB_PRODUCTS,
  INDUSTRIES, PHONE_RE, productBadge, URL_RE,
} from "@/lib/types";
import type { AccountContact } from "@/lib/types";
import { Hint } from "./hint";
import { MultiPick } from "./multi-pick";
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
  WhatsApp: <MessageCircle className="size-3.5" />,
  Email: <Mail className="size-3.5" />,
};

export function AccountDetailView({
  account, attempts, visits, comments, caps, reassignTargets, autoReportVisitId,
}: {
  account: PipelineRow;
  attempts: AttemptWithMember[];
  visits: Visit[];
  comments: CommentWithMember[];
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
            <StageBadge stage={account.stage} />
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
            {active && !account.slot_raised ? (
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
                {reportableVisit ? (
                  <Hint label="Tell your leaders how the visit went — they're notified instantly">
                    <Button variant="outline" onClick={() => setReportOpen(true)}>
                      <CheckCircle2 className="size-4" /> Report visit
                    </Button>
                  </Hint>
                ) : null}
                <Hint label="Deal signed! Record how many slots were raised">
                  <Button
                    variant="outline"
                    className="text-success hover:text-success"
                    onClick={() => setDealOpen(true)}
                  >
                    <Trophy className="size-4" /> Slot raised
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
      <OopDialog accountId={account.id} open={oopOpen} onOpenChange={setOopOpen} />
      <DealDialog accountId={account.id} open={dealOpen} onOpenChange={setDealOpen} />
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

/** Details: links + type/industry (multi-select). Phones & emails live in the
 *  tagged Contact info card. */
function DetailsCard({ account, canEdit }: { account: PipelineRow; canEdit: boolean }) {
  const [form, setForm] = useState({
    social_link: account.social_link ?? "",
    website: account.website ?? "",
    account_type: account.account_type ?? "",
    industry: account.industry ?? "",
    sub_product: account.sub_product ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const socialOk = !form.social_link.trim() || URL_RE.test(form.social_link.trim());
  const websiteOk = !form.website.trim() || URL_RE.test(form.website.trim());
  const allOk = socialOk && websiteOk;

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

  const inputRow = (
    label: string,
    key: keyof typeof form,
    ok: boolean,
    err: string,
    placeholder?: string
  ) => (
    <div key={key} className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center sm:gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {canEdit ? (
        <div className="min-w-0">
          <Input
            className={cn("h-8", !ok && "border-destructive")}
            value={form[key]}
            placeholder={placeholder}
            onChange={(e) => set(key)(e.target.value)}
          />
          {!ok ? <p className="mt-0.5 text-xs text-destructive">{err}</p> : null}
        </div>
      ) : (
        <p className="truncate text-sm">{form[key] || "—"}</p>
      )}
    </div>
  );

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
        {inputRow("Social link", "social_link", socialOk, "Must be a link (https://…).", "https://…")}
        {inputRow("Website", "website", websiteOk, "Must be a link (https://…).", "https://…")}
        {account.function === "IGV" ? (
          <>
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

/** Tagged phones & emails — add as many as the account needs (CEO, HR, …). */
function ContactInfoCard({
  account, canEdit,
}: { account: PipelineRow; canEdit: boolean }) {
  const initial: AccountContact[] =
    account.contacts && account.contacts.length > 0
      ? account.contacts
      : [
          ...(account.phone ? [{ tag: "Contact", kind: "phone" as const, value: account.phone }] : []),
          ...(account.email ? [{ tag: "Contact", kind: "email" as const, value: account.email }] : []),
        ];
  const [rows, setRows] = useState<AccountContact[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const update = (i: number, patch: Partial<AccountContact>) => {
    setRows((r) => r.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    setDirty(true);
  };
  const remove = (i: number) => {
    setRows((r) => r.filter((_, j) => j !== i));
    setDirty(true);
  };
  const add = (kind: "phone" | "email") => {
    setRows((r) => [...r, { tag: "Contact", kind, value: "" }]);
    setDirty(true);
  };

  const rowOk = (c: AccountContact) =>
    !c.value.trim() ||
    (c.kind === "phone" ? PHONE_RE.test(cleanPhone(c.value)) : EMAIL_RE.test(c.value.trim()));
  const allOk = rows.every(rowOk);

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
        {rows.length === 0 ? (
          <p className="py-1 text-center text-sm text-muted-foreground">
            No phones or emails yet.
          </p>
        ) : null}
        {rows.map((c, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-2 shrink-0 text-muted-foreground">
              {c.kind === "phone" ? <Phone className="size-3.5" /> : <Mail className="size-3.5" />}
            </span>
            <Input
              className="h-8 w-24 shrink-0 sm:w-28"
              value={c.tag}
              disabled={!canEdit}
              placeholder="Tag"
              onChange={(e) => update(i, { tag: e.target.value })}
            />
            <div className="min-w-0 flex-1">
              <Input
                className={cn("h-8", !rowOk(c) && "border-destructive")}
                value={c.value}
                disabled={!canEdit}
                inputMode={c.kind === "phone" ? "tel" : "email"}
                placeholder={c.kind === "phone" ? "Numbers only (7–15)" : "name@company.com"}
                onChange={(e) => update(i, { value: e.target.value })}
              />
              {!rowOk(c) ? (
                <p className="mt-0.5 text-xs text-destructive">
                  {c.kind === "phone" ? "Numbers only, 7–15 digits." : "Valid email only."}
                </p>
              ) : null}
            </div>
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                title="Remove"
                onClick={() => remove(i)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => add("phone")}>
              <Plus className="size-3.5" /> Phone
            </Button>
            <Button size="sm" variant="outline" onClick={() => add("email")}>
              <Plus className="size-3.5" /> Email
            </Button>
            {dirty ? (
              <Button size="sm" onClick={save} disabled={pending || !allOk}>
                {pending ? "Saving…" : "Save contact info"}
              </Button>
            ) : null}
          </div>
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

  const submit = () =>
    start(async () => {
      const res = await addComment(accountId, body);
      if (res.ok) {
        toast.success("Comment logged");
        setBody("");
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
        {numbered.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">
            No comments yet.
          </p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {[...numbered].reverse().map((c) => (
              <div key={c.id} className="rounded-lg border p-2.5 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge
                    className={cn(
                      "border-transparent",
                      c.author_label === "Member"
                        ? "bg-muted text-muted-foreground"
                        : c.author_label === "TL"
                          ? "bg-chart-4/15 text-chart-4"
                          : "bg-primary/15 text-primary"
                    )}
                  >
                    {c.title}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {c.member?.nickname || c.member?.name || "—"} ·{" "}
                    {new Date(c.created_at).toLocaleString()}
                  </span>
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
          : "Visit scheduled. Calendar reminder could not be created — the responsible should sign in once with Google to grant calendar access."
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

function OopDialog({
  accountId, open, onOpenChange,
}: { accountId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState("");
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
