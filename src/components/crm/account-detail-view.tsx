"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive, ArchiveRestore, ArrowLeft, CalendarPlus, CheckCircle2, FileText, Loader2, Mail,
  MessageSquareText, Paperclip, Pencil, Phone, Pin, PinOff, Plus, RotateCcw, Sparkles, Trophy,
  Upload, X,
  XCircle,
} from "lucide-react";
import {
  addComment, confirmContractUploads, getContractUrl, getNextWorkingHours, markPodioUpdated,
  reassignAccount, recordDeal, reportVisit, requestContractUploads, reviveAccount,
  scheduleVisit, setOutOfProcess, setPodioUpdateCadence, setPodioUpdateEnabled,
  renameAccount,
  toggleCommentPin, toggleCommentArchive, updateAccount, updateAccountContacts,
  updateComment, updateContactAttempt, updateDeal,
} from "@/server/actions";
import type {
  AccountCreationEntry, CommentWithMember, DealWithMember, PipelineRow,
} from "@/server/data";
import type { AccountFunction, ContactAttempt, ContactMethod, Visit } from "@/lib/types";
import {
  ACCOUNT_TYPES, B2C_CONTRACT_FORM_URL, B2C_TYPES,
  fmtClock12, fmtDateTime, IGT_SUB_PRODUCTS, IGV_PROJECTS, INDUSTRIES,
  OOP_REASONS,
  VISIT_RESULTS, podioDefaultDays, productBadge,
} from "@/lib/types";
import type { AccountContact } from "@/lib/types";
import { FileDrop } from "./file-drop";
import { Hint } from "./hint";
import { MultiPick } from "./multi-pick";
import { ContactsEditor, contactsValid } from "./contacts-editor";
import { QuickActions } from "./quick-actions";
import { WhatsAppIcon } from "./icons";
import { ProposalDialog } from "./proposal-dialog";
import { ConfettiBurst } from "./confetti";
import { cn } from "@/lib/utils";
import { StageBadge } from "./stage-badge";
import { ContactDialog, type ContactTarget } from "./contact-dialog";
import { CopyNameButton } from "./copy-name-button";
import { useAccountNameCheck } from "./use-account-name-check";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type AttemptWithMember = ContactAttempt & { member: { name: string } | null };

interface Caps {
  edit: boolean;
  reassign: boolean;
  requestState: boolean;
  /** the full set of functions the viewer may MOVE this account between —
   *  [] = no move. Generalizes v33.15's B2B↔BD flip (v33.19): whoever may
   *  edit the account and works BOTH functions may relabel it. */
  fnTargets: AccountFunction[];
}

const methodIcon = {
  Call: <Phone className="size-3.5" />,
  WhatsApp: <WhatsAppIcon className="size-3.5" />,
  Email: <Mail className="size-3.5" />,
};

export function AccountDetailView({
  account, attempts, visits, comments, deals, caps, reassignTargets,
  functionMembers, autoReportVisitId, autoOpen, viewerId, viewerName,
}: {
  account: PipelineRow;
  /** the signed-in member — lets them TAKE an unowned account in one click */
  viewerId: string;
  /** their name — the WhatsApp quick action opens with a ready intro */
  viewerName: string;
  attempts: AttemptWithMember[];
  visits: Visit[];
  comments: CommentWithMember[];
  deals: DealWithMember[];
  caps: Caps;
  reassignTargets: { id: string; label: string }[];
  /** everyone in the account's function — the deal opens-split picker (v22) */
  functionMembers: { id: string; label: string }[];
  autoReportVisitId: string | null;
  /** ?open= deep link (Blue Man action chips): open a dialog on arrival */
  autoOpen: "contact" | "visit" | "deal" | "proposal" | null;
}) {
  const pendingVisit = visits.find((v) => v.done === null) ?? null;
  const reportableVisit =
    (autoReportVisitId && visits.find((v) => v.id === autoReportVisitId && v.done === null)) ||
    pendingVisit;

  // ?open= deep links (Blue Man action chips) pre-open a dialog — only when
  // the viewer could click the button themselves (edit rights + active)
  const canAct = caps.edit && !account.out_of_process;
  // the filtered list this account was opened from (v33.10)
  const [backHref, setBackHref] = useState("/accounts");
  useEffect(() => {
    try {
      const q = sessionStorage.getItem("sodio-accounts-query");
      if (q) setBackHref(`/accounts${q}`);
    } catch {
      /* private mode — the plain list is fine */
    }
  }, []);
  const [contactOpen, setContactOpen] = useState(autoOpen === "contact" && canAct);
  // pre-picked when the comment box detected a contact result (v33)
  const [contactStatus, setContactStatus] = useState<string | undefined>(undefined);
  const [visitOpen, setVisitOpen] = useState(autoOpen === "visit" && canAct);
  // which visit the report dialog is open FOR — openable from the top button
  // or from any pending visit row in History
  const [reportVisitId, setReportVisitId] = useState<string | null>(
    autoReportVisitId && reportableVisit ? reportableVisit.id : null
  );
  const reportVisit = visits.find((v) => v.id === reportVisitId && v.done === null) ?? null;
  const [contractsOpen, setContractsOpen] = useState(false);
  const [oopOpen, setOopOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(autoOpen === "deal" && canAct);
  const [proposalOpen, setProposalOpen] = useState(autoOpen === "proposal" && canAct);

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
      {/* BACK, NOT HOME (v33.10). This linked to a bare /accounts, so opening
          an account from a filtered list and coming back dropped the filter —
          you were returned to the top of 1,300 rows having lost your place.
          The list remembers its own query (see `rememberAccountsQuery`), and
          this returns to exactly it. */}
      <Link prefetch={false}
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All accounts
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <h1 dir="auto" className="text-2xl font-bold">{account.name}</h1>
            <CopyNameButton name={account.name} />
            {caps.edit && active ? (
              <RenameButton account={account} />
            ) : null}
          </span>
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
                  🏆 {account.deals_count} deal{account.deals_count === 1 ? "" : "s"}
                  {account.slots_count > 0
                    ? ` · ${account.slots_count} open${account.slots_count === 1 ? "" : "s"}`
                    : ""}
                  {(() => {
                    // BD deals' MOS: total money across this account's deals
                    const egp = deals.reduce((s, d) => s + (d.amount ?? 0), 0);
                    return egp > 0 ? ` · EGP ${egp.toLocaleString()}` : "";
                  })()}
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
            viewerId={viewerId}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {deals.some((d) => (d.contracts ?? []).length > 0) ? (
            <Hint label="View the signed contract(s) of this account's deals — preview & download">
              <Button variant="outline" onClick={() => setContractsOpen(true)}>
                <Paperclip className="size-4" /> Contracts
              </Button>
            </Hint>
          ) : null}
        {caps.edit ? (
          <>
            {active ? (
              <>
                <Hint label="Log a call / WhatsApp / email attempt — every attempt counts">
                  <Button onClick={() => setContactOpen(true)}>
                    <Phone className="size-4" /> Contact
                  </Button>
                </Hint>
                {/* BOOKING A VISIT IS A CONTACT RESULT (v33.24), not a button
                    of its own. A visit is always the outcome of reaching
                    someone — logging it through the contact form keeps the
                    attempt, the result and the booking in one act instead of
                    letting a visit appear with no contact behind it. MOVING an
                    already-booked visit stays here: there is no new contact to
                    log when you only change the time. */}
                {pendingVisit ? (
                  <Hint label="Move the booked visit — the calendar event and the invite follow">
                    <Button variant="outline" onClick={() => setVisitOpen(true)}>
                      <CalendarPlus className="size-4" /> Reschedule visit
                    </Button>
                  </Hint>
                ) : null}
                {account.function !== "B2C" ? (
                  <Hint label="Generate the ICX proposal email as a draft in YOUR Gmail — review & send it yourself">
                    <Button variant="outline" onClick={() => setProposalOpen(true)}>
                      <FileText className="size-4" /> Proposal email
                    </Button>
                  </Hint>
                ) : null}
                {reportableVisit ? (
                  <Hint label="Tell your leaders how the visit went — they're notified instantly">
                    <Button variant="outline" onClick={() => setReportVisitId(reportableVisit.id)}>
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
          </>
        ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ContactInfoCard account={account} canEdit={caps.edit} viewerName={viewerName} />
        <DetailsCard account={account} canEdit={caps.edit} fnTargets={caps.fnTargets} />
        {/* the Podio worklist grant covers BOTH fields (v33.14): "did we
            submit it" and "what came back" are one act, and an MM sent to
            check a name has to be able to record both. */}
        {account.function !== "B2C" ? (
          <PodioCard
            account={account}
            canEdit={caps.edit || caps.requestState}
            canEditState={caps.requestState}
          />
        ) : null}
        {account.function !== "B2B" ? (
          <PodioUpdateCard account={account} canEdit={caps.edit && active} />
        ) : null}
        <NextStepCard account={account} canEdit={caps.edit && active} />
        <CommentsCard
          accountId={account.id}
          comments={comments}
          canComment={caps.edit}
          onLogContact={
            canAct
              ? (status) => { setContactStatus(status); setContactOpen(true); }
              : undefined
          }
        />
      </div>

      <TimelineCard
        attempts={attempts}
        visits={visits}
        deals={deals}
        creation={account.creation ?? null}
        canEdit={caps.edit}
        fn={account.function}
        onReportVisit={caps.edit && active ? setReportVisitId : undefined}
        onMoveVisit={caps.edit && active ? () => setVisitOpen(true) : undefined}
      />

      {/* dialogs */}
      <ContactDialog
        target={contactTarget}
        open={contactOpen}
        onOpenChange={setContactOpen}
        defaultStatus={contactStatus}
      />
      <VisitDialog
        account={account}
        pendingVisit={pendingVisit}
        open={visitOpen}
        onOpenChange={setVisitOpen}
      />
      {reportVisit ? (
        <ReportVisitDialog
          key={reportVisit.id}
          visit={reportVisit}
          open
          onOpenChange={(o) => {
            if (!o) setReportVisitId(null);
          }}
          // 2nd visit or later — a deal is a realistic outcome by then
          isRepeatVisit={visits.length > 1}
          onProposal={canAct ? () => setProposalOpen(true) : undefined}
          onDeal={canAct ? () => setDealOpen(true) : undefined}
          onOop={canAct ? () => setOopOpen(true) : undefined}
        />
      ) : null}
      <ContractsDialog deals={deals} open={contractsOpen} onOpenChange={setContractsOpen} />
      <OopDialog accountId={account.id} open={oopOpen} onOpenChange={setOopOpen} />
      <ProposalDialog account={account} open={proposalOpen} onOpenChange={setProposalOpen} />
      <DealDialog
        accountId={account.id}
        fn={account.function}
        dealNumber={account.deals_count + 1}
        responsibleId={account.responsible_id}
        responsibleLabel={account.responsible_name}
        functionMembers={functionMembers}
        open={dealOpen}
        onOpenChange={setDealOpen}
      />
    </div>
  );
}

/** Responsible: read-only for members; Team Leaders pick between themselves and
 *  their members, VPs across the function, the LCP anywhere. */
/** RENAME (v33.38): a typo in the name used to be forever — the ✏️ beside the
 *  title runs the SAME live check as adding (its own row excluded) and warns
 *  that the account's link changes with the name. */
function RenameButton({ account }: { account: PipelineRow }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { nameCheck, blocked } = useAccountNameCheck(
    open && name.trim() !== account.name ? name : "",
    account.function,
    { excludeId: account.id }
  );
  const unchanged = name.trim() === account.name;
  const canSave =
    !pending && !unchanged && name.trim().length >= 2 &&
    !blocked && nameCheck?.status !== "checking";

  const save = () =>
    start(async () => {
      const res = await renameAccount(account.id, name);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Renamed. Heads-up: the account's link changed with it.");
      setOpen(false);
      if (res.data) router.replace(`/accounts/${res.data.slug}`);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setName(account.name); }}>
      <Hint label="Rename the account">
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          <Pencil className="size-3.5" />
        </Button>
      </Hint>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename “{account.name}”</DialogTitle>
          <DialogDescription>
            The new name goes through the same checks as adding an account, and
            the account&apos;s link changes with it (old links keep working).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            dir="auto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) save(); }}
            autoFocus
          />
          {unchanged || name.trim().length < 2 ? null : nameCheck?.status === "checking" ? (
            <p className="text-xs text-muted-foreground">Checking the name…</p>
          ) : blocked ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              {nameCheck?.message ?? "That name is already taken."}
            </p>
          ) : nameCheck?.status === "free" ? (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              ✅ The name is free.{nameCheck.note ? ` ${nameCheck.note}` : ""}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Rename"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResponsibleRow({
  account, canReassign, targets, viewerId,
}: {
  account: PipelineRow;
  canReassign: boolean;
  targets: { id: string; label: string }[];
  /** so an unowned account can be taken with one click */
  viewerId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // an UNOWNED account you may work: one button takes it, no picker and no
  // leader needed (v32.4) — you did the research, it's yours
  const claimable = !account.responsible_id && !account.out_of_process && canReassign;
  if (claimable) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          Responsible: <b>Unassigned</b> — nobody has taken this one.
        </span>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await reassignAccount(account.id, viewerId);
              if (res.ok) { toast.success("It's yours now 🙌"); router.refresh(); }
              else toast.error(res.error);
            })
          }
        >
          Take it
        </Button>
        {/* OR GIVE IT STRAIGHT TO SOMEONE (v33.11). An MM taking an unowned
            account only to reassign it a second later was two steps for one
            decision — and the account briefly belonged to the wrong person in
            between. The picker is their own people, exactly as everywhere
            else. */}
        {targets.filter((t) => t.id !== viewerId).length > 0 ? (
          <Select
            onValueChange={(id) =>
              start(async () => {
                const res = await reassignAccount(account.id, id);
                if (res.ok) {
                  toast.success("Assigned 🙌");
                  router.refresh();
                } else toast.error(res.error);
              })
            }
          >
            <SelectTrigger className="h-8 w-auto min-w-40">
              <SelectValue placeholder="…or give it to" />
            </SelectTrigger>
            <SelectContent>
              {targets
                .filter((t) => t.id !== viewerId)
                .map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    );
  }

  if (!canReassign || targets.length <= 1) {
    return (
      <p className="text-sm text-muted-foreground">
        Responsible:{" "}
        <b>{account.responsible_name || "Unassigned"}</b>
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
        value={account.responsible_id ?? undefined}
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
          <SelectValue placeholder="Unassigned" />
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
function DetailsCard({
  account, canEdit, fnTargets,
}: { account: PipelineRow; canEdit: boolean; fnTargets: AccountFunction[] }) {
  const [form, setForm] = useState({
    project: account.project ?? "",
    account_type: account.account_type ?? "",
    industry: account.industry ?? "",
    sub_product: account.sub_product ?? "",
    fn: account.function,
  });
  const [dirty, setDirty] = useState(false);
  // only a flip the USER made is ever sent — a refresh that changed
  // account.function underneath must not turn a stale form value into an
  // accidental flip-back
  const [fnTouched, setFnTouched] = useState(false);
  const [pending, start] = useTransition();
  const allOk = true;

  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const save = () =>
    start(async () => {
      const { fn, ...rest } = form;
      const res = await updateAccount(account.id, {
        ...rest,
        // a function MOVE rides the same save — sent only when the USER
        // changed it and it differs from the live value (v33.19: any pair
        // of the viewer's own functions, not just B2B↔BD)
        ...(fnTouched && fn !== account.function && fnTargets.includes(fn)
          ? { function: fn }
          : {}),
      });
      if (res.ok) { toast.success("Saved"); setDirty(false); setFnTouched(false); }
      else toast.error(res.error);
    });

  // the Function select — rendered on BOTH card variants (a B2C account may
  // move to the viewer's other functions too)
  const fnRow =
    fnTargets.length >= 2 ? (
      <div className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center sm:gap-2">
        <Label className="text-xs text-muted-foreground">Function</Label>
        <div className="grid min-w-0 gap-1">
          <Select
            value={fnTouched ? form.fn : account.function}
            onValueChange={(v) => { set("fn")(v); setFnTouched(true); }}
          >
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {fnTargets.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fnTouched && form.fn !== account.function ? (
            <p className="text-[11px] text-muted-foreground">
              Saving moves this account (and its numbers) to the {form.fn} lane.
            </p>
          ) : null}
        </div>
      </div>
    ) : null;

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

  if (account.function === "B2C") {
    // B2C carries ONE Type instead of the account-type/industry pair (v23)
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {fnRow}
          <div className="grid gap-1 sm:grid-cols-[110px_1fr] sm:items-center sm:gap-2">
            <Label className="text-xs text-muted-foreground">Type</Label>
            {canEdit ? (
              <Select
                value={form.account_type || undefined}
                onValueChange={(v) => set("account_type")(v)}
              >
                <SelectTrigger className="h-8"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {B2C_TYPES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="truncate text-sm">{form.account_type || "—"}</p>
            )}
          </div>
          {canEdit && dirty ? (
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save details"}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {fnRow}
        {account.function !== "IGT" ? (
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
  account, canEdit, viewerName,
}: { account: PipelineRow; canEdit: boolean; viewerName: string }) {
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
        <CardDescription>
          {/* The account page had every number and link but no way to USE one
              without copying it out — the quick actions existed only on the
              list. The page you open to work an account is exactly where you
              reach for them (v33.5). */}
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <QuickActions
              contacts={rows}
              max={8}
              viewerName={viewerName}
              accountName={account.name}
            />
          </span>
        </CardDescription>
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

/** Continuous Podio updates (v23 B2C → v24 IGV/IGT/BD too): the account must
 *  be REFRESHED on Podio every N days. Per-account ON/OFF, countdown, an
 *  "Updated on Podio" reset and the cadence editor. The daily cron nags the
 *  responsible + the function's VP/Director when the date arrives (and again,
 *  firmer, a week later). */
function PodioUpdateCard({ account, canEdit }: { account: PipelineRow; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const every = account.podio_update_every_days ?? podioDefaultDays(account.function);
  const [days, setDays] = useState(String(every));
  const anchor = new Date(account.podio_updated_at ?? account.created_at);
  const due = new Date(anchor.getTime() + every * 86400000);
  const msLeft = due.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / 86400000);
  const overdue = daysLeft < 0;
  const dueNow = daysLeft <= 0;

  const markUpdated = () =>
    start(async () => {
      const res = await markPodioUpdated(account.id);
      if (res.ok) toast.success("Countdown reset — next update in " + every + " days 🔄");
      else toast.error(res.error);
    });
  const saveCadence = () =>
    start(async () => {
      const res = await setPodioUpdateCadence(account.id, Number(days) || 0);
      if (res.ok) toast.success("Cadence updated");
      else toast.error(res.error);
    });

  const toggle = (on: boolean) =>
    start(async () => {
      const res = await setPodioUpdateEnabled(account.id, on);
      if (res.ok) toast.success(on ? "Continuous updates ON — countdown started 🔄" : "Continuous updates off");
      else toast.error(res.error);
    });

  if (!account.podio_update_enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Podio — continuous update</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Off — turn on to keep this account refreshed on Podio every{" "}
            {podioDefaultDays(account.function)} days (with reminders).
          </p>
          {canEdit ? <Switch checked={false} onCheckedChange={toggle} disabled={pending} /> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Podio — continuous update
          {canEdit ? (
            <Switch checked onCheckedChange={toggle} disabled={pending} aria-label="Continuous updates on/off" />
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Next Podio refresh</p>
            <p className="text-xs text-muted-foreground">
              This account is refreshed on Podio every {every} days
            </p>
          </div>
          <Badge
            className={cn(
              "border-transparent text-sm font-bold",
              overdue
                ? "bg-destructive/15 text-destructive"
                : dueNow
                  ? "bg-warning/15 text-warning"
                  : "bg-success/15 text-success"
            )}
          >
            {overdue
              ? `${Math.abs(daysLeft)}d overdue ⏰`
              : dueNow
                ? "due today"
                : `${daysLeft}d left`}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Last updated: {account.podio_updated_at ? fmtDateTime(account.podio_updated_at) : "never (since creation)"} ·
          due {due.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Hint label="Refreshed the account on Podio? This resets the countdown">
              <Button size="sm" onClick={markUpdated} disabled={pending}>
                <CheckCircle2 className="size-4" /> Updated on Podio
              </Button>
            </Hint>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              every
              <Input
                type="number"
                min={1}
                max={90}
                className="h-8 w-16"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                aria-label="Update every N days"
              />
              days
              {Number(days) !== every ? (
                <Button size="sm" variant="outline" onClick={saveCadence} disabled={pending}>
                  Save
                </Button>
              ) : null}
            </span>
          </div>
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
            <p className="text-sm font-medium">Podio state</p>
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
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() + 7);
              setDate(
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
              );
              setDirty(true);
            }}
          >
            <CalendarPlus className="size-3.5" /> Next week
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Set the next step to your next working-hours session, so this account comes back exactly when you sit down to work it"
            onClick={async () => {
              const res = await getNextWorkingHours();
              if (!res.ok || !res.data) {
                toast.info("No upcoming working hours are booked for you yet — your TL or VP sets those on the calendar.");
                return;
              }
              const d = new Date(res.data.startsAt);
              setDate(
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
              );
              setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
              if (!step.trim()) setStep("Contact them again during working hours");
              setDirty(true);
              toast.success("Next step set to your next working hours ⏰");
            }}
          >
            <CalendarPlus className="size-3.5" /> Next working hours
          </Button>
        ) : null}
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
/** Comments that are really CONTACT LOGS (v33).
 *
 *  People type "no response" or "wrong number" into the comment box because
 *  it's the nearest text field — and the account then looks untouched: no
 *  contact count, no last-result, no next-step obligation, and the member
 *  shows zero contacts on the leaderboard despite doing the work. The numbers
 *  quietly stop being true.
 *
 *  So when a comment reads like a contact result, we say so and offer the
 *  right button. Never blocking: it's a nudge, the comment still saves, and
 *  plenty of legitimate comments mention these words in passing. */
const CONTACT_RESULT_HINTS: { re: RegExp; status: string }[] = [
  { re: /\b(no|didn'?t|didnt)\s*(response|answer|reply)\b|\bلم يرد\b|\bمردش\b/i, status: "No Response" },
  { re: /\bwrong\s*(number|contact)\b|\bرقم غلط\b/i, status: "Wrong Contact" },
  { re: /\bnot\s*interested\b|\brefused\b|\brejected\b|\bمش مهتم\b/i, status: "Not Interested" },
  { re: /\b(interested|they want|wants? to)\b|\bمهتم\b/i, status: "Interested" },
  { re: /\b(answered|responded|picked up|talked to|spoke)\b|\bرد\b/i, status: "Responded" },
];

function looksLikeContactLog(text: string): string | null {
  const t = (text ?? "").trim();
  // a long note is a real comment that happens to mention a word
  if (t.length < 2 || t.length > 120) return null;
  for (const h of CONTACT_RESULT_HINTS) if (h.re.test(t)) return h.status;
  return null;
}

function CommentsCard({
  accountId, comments, canComment, onLogContact,
}: {
  accountId: string;
  comments: CommentWithMember[];
  canComment: boolean;
  /** opens the real contact form with the detected result pre-picked */
  onLogContact?: (status: string) => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  // v33.19: a comment's TEXT is editable (author or LCP — server-enforced)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [pending, start] = useTransition();

  // number over the FULL list (so #n never shifts when archived ones hide)
  const counters: Record<string, number> = {};
  const numbered = comments.map((c) => {
    counters[c.author_label] = (counters[c.author_label] ?? 0) + 1;
    const n = counters[c.author_label];
    return {
      ...c,
      title: c.author_label === "Member" ? `Comment #${n}` : `${c.author_label} Comment #${n}`,
    };
  });
  const archivedCount = numbered.filter((c) => c.archived).length;
  // hide archived by default; pinned first, then newest
  const ordered = [...numbered]
    .filter((c) => showArchived || !c.archived)
    .sort((a, b) =>
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

  const toggleArchive = (id: string, archived: boolean) =>
    start(async () => {
      const res = await toggleCommentArchive(id, archived);
      if (res.ok) {
        toast.success(archived ? "Comment archived" : "Comment restored");
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="size-4 text-muted-foreground" />
          Comments
          {numbered.length - archivedCount > 0 ? (
            <Badge variant="outline" className="ml-1">{numbered.length - archivedCount}</Badge>
          ) : null}
          {archivedCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setShowArchived((s) => !s)}
            >
              <Archive className="size-3.5" />
              {showArchived ? "Hide archived" : `Archived (${archivedCount})`}
            </Button>
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
                  c.pinned && "border-warning/60 bg-warning/10",
                  c.archived && "border-dashed opacity-60"
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
                    {c.member?.name || "—"} ·{" "}
                    {fmtDateTime(c.created_at)}
                  </span>
                  {canComment ? (
                    <span className="flex shrink-0 items-center">
                      {c.archived ? null : (
                        <Hint label="Edit this comment's text — the label and number stay">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 text-muted-foreground hover:text-foreground"
                            disabled={pending}
                            onClick={() => setEditing({ id: c.id, body: c.body })}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        </Hint>
                      )}
                      {c.archived ? null : (
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
                      )}
                      <Hint label={c.archived ? "Restore this comment" : "Archive — hides it from the default view (kept for the record)"}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-muted-foreground hover:text-foreground"
                          disabled={pending}
                          onClick={() => toggleArchive(c.id, !c.archived)}
                        >
                          {c.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                        </Button>
                      </Hint>
                    </span>
                  ) : null}
                </div>
                <p dir="auto" className="whitespace-pre-wrap text-start">{c.body}</p>
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
            {onLogContact && looksLikeContactLog(body) ? (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs">
                <p className="font-medium text-foreground">
                  That looks like a contact — log it as one?
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  A comment doesn&apos;t count the attempt, set the last result,
                  or ask for a next step — so the account looks untouched and
                  your numbers miss it.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const status = looksLikeContactLog(body);
                      if (status) onLogContact(status);
                    }}
                  >
                    Log the contact instead
                  </Button>
                  <Button size="sm" variant="ghost" onClick={submit} disabled={pending}>
                    No, it&apos;s just a comment
                  </Button>
                </div>
              </div>
            ) : null}
            <Button size="sm" variant="outline" onClick={submit} disabled={pending || body.trim().length < 2}>
              {pending ? "Saving…" : "Add comment"}
            </Button>
          </div>
        ) : null}
      </CardContent>

      {/* v33.19: edit a comment's words — number, label and pin state stay */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit comment</DialogTitle>
            <DialogDescription>
              Only the words change — the label, number and pin stay. Only the
              author (or the LCP) can save.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            dir="auto"
            value={editing?.body ?? ""}
            onChange={(e) =>
              setEditing((cur) => (cur ? { ...cur, body: e.target.value } : cur))
            }
          />
          <DialogFooter>
            <Button
              disabled={pending || !editing || editing.body.trim().length < 2}
              onClick={() =>
                start(async () => {
                  if (!editing) return;
                  const res = await updateComment(editing.id, editing.body);
                  if (res.ok) {
                    toast.success("Comment updated");
                    setEditing(null);
                    router.refresh();
                  } else toast.error(res.error);
                })
              }
            >
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

/** All contracts of the account's deals in one popup: pick a file, preview it
 *  inline (PDFs/images render right in the dialog) and download the original. */
function ContractsDialog({
  deals, open, onOpenChange,
}: {
  deals: DealWithMember[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const files = deals.flatMap((d, i) =>
    (d.contracts ?? []).map((c) => ({ ...c, dealId: d.id, dealNo: deals.length - i }))
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // guards against a slower earlier request overwriting a newer selection
  const seqRef = useRef(0);
  const current = files.find((f) => f.path === selected) ?? files[0] ?? null;

  const load = async (dealId: string, path: string) => {
    const seq = ++seqRef.current;
    setSelected(path);
    setLoading(true);
    setUrl(null);
    const res = await getContractUrl(dealId, path);
    if (seq !== seqRef.current) return; // a newer selection took over
    setLoading(false);
    if (res.ok && res.data) setUrl(res.data.url);
    else toast.error(res.ok ? "Could not open the contract." : res.error);
  };

  // auto-load the first file whenever the popup opens (the open prop is
  // controlled — Radix never calls onOpenChange for programmatic opens)
  const firstDealId = files[0]?.dealId ?? null;
  const firstPath = files[0]?.path ?? null;
  useEffect(() => {
    if (open && firstPath && firstDealId) void load(firstDealId, firstPath);
    if (!open) {
      seqRef.current += 1;
      setSelected(null);
      setUrl(null);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, firstDealId, firstPath]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="size-5 text-primary" /> Deal contracts
          </DialogTitle>
          <DialogDescription>
            Every contract uploaded on this account&apos;s deals — click one to preview, then download.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => load(f.dealId, f.path)}
              className={cn(
                "inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                current?.path === f.path
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:border-primary/50"
              )}
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="truncate">{f.name}</span>
              <span className={cn("shrink-0", current?.path === f.path ? "opacity-80" : "text-muted-foreground")}>
                · Deal #{f.dealNo}
              </span>
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border bg-muted/30">
          {loading ? (
            <div className="flex h-[55vh] items-center justify-center">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : url ? (
            <iframe src={url} title={current?.name ?? "Contract"} className="h-[55vh] w-full bg-white" />
          ) : (
            <div className="flex h-[55vh] items-center justify-center text-sm text-muted-foreground">
              Pick a contract above to preview it.
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <p className="mr-auto self-center text-xs text-muted-foreground">
            {current ? `${current.name} · ${(current.size / 1024 / 1024).toFixed(1)} MB` : ""}
          </p>
          <Button
            disabled={!url || !current}
            onClick={() =>
              url && current &&
              window.open(`${url}&download=${encodeURIComponent(current.name)}`, "_blank", "noopener")
            }
          >
            <FileText className="size-4" /> Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  attempts, visits, deals, creation, canEdit, fn, onReportVisit, onMoveVisit,
}: {
  attempts: AttemptWithMember[];
  visits: Visit[];
  deals: DealWithMember[];
  /** the account's own creation — the oldest entry of the History (v31) */
  creation: AccountCreationEntry | null;
  canEdit: boolean;
  /** the account's function — decides which fields a deal EDIT shows (v33.19) */
  fn: AccountFunction;
  /** present when the viewer may report pending visits — makes their rows clickable */
  onReportVisit?: (visitId: string) => void;
  /** present when the viewer may MOVE a booked visit (v33.18) */
  onMoveVisit?: () => void;
}) {
  // v33.19: History entries are EDITABLE — a wrong click shouldn't need the
  // IM team. The pencil shows for anyone who may edit the account; the
  // server enforces author-or-LCP and a refused click toasts its message.
  const [editAttempt, setEditAttempt] = useState<AttemptWithMember | null>(null);
  const [editDeal, setEditDeal] = useState<{ deal: DealWithMember; no: number } | null>(null);
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
                      Deal #{deals.length - i}
                      {(d.amount ?? 0) > 0 ? (
                        <span className="text-success"> · EGP {(d.amount ?? 0).toLocaleString()}</span>
                      ) : null}
                      {d.slots > 0 || (d.amount ?? 0) === 0
                        ? ` · ${d.slots} open${d.slots === 1 ? "" : "s"}`
                        : ""}
                      {split.length > 0 ? (
                        <span className="font-normal text-muted-foreground"> ({split.join(" · ")})</span>
                      ) : null}
                    </p>
                    {d.benefits ? (
                      <p className="text-muted-foreground">+ {d.benefits}</p>
                    ) : null}
                    {d.note ? <p className="text-muted-foreground">{d.note}</p> : null}
                    {/* v22: the deal's opens split across members (if custom) */}
                    {(d.allocations ?? []).length > 1 ? (
                      <p className="text-xs text-muted-foreground">
                        Opens split:{" "}
                        {(d.allocations ?? [])
                          .map((a) => {
                            const n = a.slots_igv + a.slots_igta + a.slots_igte;
                            return `${a.member?.name || "?"} (${n})`;
                          })
                          .join(" · ")}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {d.member?.name || "—"} · {fmtDateTime(d.created_at)}
                    </p>
                    <DealContracts deal={d} canEdit={canEdit} />
                  </div>
                  {canEdit ? (
                    <Hint label="Edit this deal — note, amount or its opens">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-1 -mt-1 size-6 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setEditDeal({ deal: d, no: deals.length - i })}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </Hint>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {visits.length > 0 ? (
          <div className="mb-4 space-y-2">
            {visits.map((v) => {
              const reportable = v.done === null && !!onReportVisit;
              return (
                <div
                  key={v.id}
                  role={reportable ? "button" : undefined}
                  tabIndex={reportable ? 0 : undefined}
                  onClick={reportable ? () => onReportVisit!(v.id) : undefined}
                  onKeyDown={
                    reportable
                      ? (e) => { if (e.key === "Enter" || e.key === " ") onReportVisit!(v.id); }
                      : undefined
                  }
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-sm",
                    reportable && "cursor-pointer transition-colors hover:border-primary/60 hover:bg-primary/5"
                  )}
                >
                  <CalendarPlus className="mt-0.5 size-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      Visit · {v.visit_date} at {fmtClock12(v.visit_time)}{" "}
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
                  {reportable ? (
                    <span className="mt-0.5 flex shrink-0 flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                        <CheckCircle2 className="size-3.5" /> Report it
                      </span>
                      {/* v33.18: a booked visit can MOVE, not only be reported */}
                      {onMoveVisit ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          onClick={(e) => { e.stopPropagation(); onMoveVisit(); }}
                        >
                          <CalendarPlus className="size-3" /> Move it
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {attempts.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No contact attempts logged yet.</p>
        ) : (
          <div className="space-y-1.5 pb-1">
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
                    {a.member?.name} · {fmtDateTime(a.created_at)}
                  </p>
                </div>
                {/* Visit Scheduled / Not Interested rows carry a side effect
                    (a booked visit / the archive) — the server refuses to
                    rewrite those, so no pencil is offered on them */}
                {canEdit && a.status !== "Visit Scheduled" && a.status !== "Not Interested" ? (
                  <Hint label="Edit this log — method, result or comment">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => setEditAttempt(a)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </Hint>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {/* the oldest entry of them all: the account joining the CRM */}
        {creation ? <CreationEntry creation={creation} /> : null}
      </CardContent>
      {editAttempt ? (
        <AttemptEditDialog
          key={editAttempt.id}
          attempt={editAttempt}
          onOpenChange={(o) => { if (!o) setEditAttempt(null); }}
        />
      ) : null}
      {editDeal ? (
        <DealEditDialog
          key={editDeal.deal.id}
          deal={editDeal.deal}
          dealNo={editDeal.no}
          fn={fn}
          onOpenChange={(o) => { if (!o) setEditDeal(null); }}
        />
      ) : null}
    </Card>
  );
}

/** EDIT a logged contact attempt (v33.19): method, result, comment. Results
 *  that fire side effects (Not Interested → archive, Visit Scheduled → a
 *  booked visit) can only be set by LOGGING a contact — never by an edit. */
const EDITABLE_ATTEMPT_RESULTS = [
  "No Response", "Waiting for response", "Responded", "Interested", "Wrong Contact",
] as const;

function AttemptEditDialog({
  attempt, onOpenChange,
}: { attempt: AttemptWithMember; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [method, setMethod] = useState<ContactMethod>(attempt.method);
  // a legacy status ("Call Scheduled") isn't offered — it stays unless the
  // member picks a real one (the patch simply omits an untouched status)
  const [status, setStatus] = useState<string>(
    (EDITABLE_ATTEMPT_RESULTS as readonly string[]).includes(attempt.status) ? attempt.status : ""
  );
  const [comment, setComment] = useState(attempt.comment ?? "");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await updateContactAttempt(attempt.id, {
        ...(method !== attempt.method ? { method } : {}),
        ...(status && status !== attempt.status ? { status } : {}),
        ...(comment.trim() !== (attempt.comment ?? "") ? { comment: comment.trim() || null } : {}),
      });
      if (res.ok) {
        toast.success("Contact log updated");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit contact log</DialogTitle>
          <DialogDescription>
            Fixes a wrong click — only whoever logged it (or the LCP) can save.
            Archiving and visit results are set by logging a contact, not here.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>Method</Label>
              <Select
                value={method}
                onValueChange={(v) => {
                  const m = v as ContactMethod;
                  setMethod(m);
                  // "Waiting for response" is meaningless on a Call (v33.19)
                  if (m === "Call" && status === "Waiting for response") setStatus("No Response");
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["Call", "WhatsApp", "Email"] as const).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Result</Label>
              <Select value={status || undefined} onValueChange={setStatus}>
                <SelectTrigger><SelectValue placeholder={attempt.status} /></SelectTrigger>
                <SelectContent>
                  {EDITABLE_ATTEMPT_RESULTS
                    .filter((s) => s !== "Waiting for response" || method !== "Call")
                    .map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Comment</Label>
            <Textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What was said, who you reached…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** EDIT a deal (v33.19): note, amount & benefits (BD), and its opens — which
 *  recompute the account's counters server-side. A deal whose opens are SPLIT
 *  across members keeps them locked (rewriting someone else's attribution
 *  needs a corrective deal, not an edit). */
function DealEditDialog({
  deal, dealNo, fn, onOpenChange,
}: {
  deal: DealWithMember;
  dealNo: number;
  fn: AccountFunction;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const customSplit = (deal.allocations ?? []).length > 1;
  const mixed = fn === "B2B" || fn === "BD";
  const isBD = fn === "BD";
  const isB2C = fn === "B2C";
  const showIgv = fn === "IGV" || mixed;
  const showIgta = fn === "IGT" || mixed;
  const showIgte = fn === "IGT" || mixed;
  // B2C deals carry no details; a custom split locks the opens
  const opensEditable = !isB2C && !customSplit;
  // money fields: BD's MOS — also shown when the deal already carries an
  // amount/benefits (e.g. recorded while the account was BD, later moved)
  const showMoney = isBD || (deal.amount ?? 0) > 0 || !!deal.benefits;

  const [igv, setIgv] = useState(String(deal.slots_igv ?? 0));
  const [igta, setIgta] = useState(String(deal.slots_igta ?? 0));
  const [igte, setIgte] = useState(String(deal.slots_igte ?? 0));
  const [amount, setAmount] = useState(deal.amount ? String(deal.amount) : "");
  const [benefits, setBenefits] = useState(deal.benefits ?? "");
  const [note, setNote] = useState(deal.note ?? "");
  const [pending, start] = useTransition();

  const nIgv = showIgv ? Math.max(0, Number(igv) || 0) : (deal.slots_igv ?? 0);
  const nIgta = showIgta ? Math.max(0, Number(igta) || 0) : (deal.slots_igta ?? 0);
  const nIgte = showIgte ? Math.max(0, Number(igte) || 0) : (deal.slots_igte ?? 0);
  const total = nIgv + nIgta + nIgte;
  const opensChanged =
    opensEditable &&
    (nIgv !== (deal.slots_igv ?? 0) ||
      nIgta !== (deal.slots_igta ?? 0) ||
      nIgte !== (deal.slots_igte ?? 0));
  // a non-B2C/BD deal needs at least one open (mirrors the server)
  const totalOk = !opensChanged || isBD || total >= 1;
  const nAmount = amount.trim() === "" ? null : Math.max(0, Number(amount) || 0);

  const submit = () =>
    start(async () => {
      const res = await updateDeal(deal.id, {
        ...(opensChanged ? { slotsIgv: nIgv, slotsIgta: nIgta, slotsIgte: nIgte } : {}),
        ...(showMoney && nAmount !== (deal.amount || null) ? { amount: nAmount } : {}),
        ...(showMoney && benefits.trim() !== (deal.benefits ?? "")
          ? { benefits: benefits.trim() || null }
          : {}),
        ...(note.trim() !== (deal.note ?? "") ? { note: note.trim() || null } : {}),
      });
      if (res.ok) {
        toast.success("Deal updated");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const numField = (label: string, colorClass: string, value: string, onChange: (v: string) => void) => (
    <div className="grid gap-1.5">
      <Label className={colorClass}>{label} opens</Label>
      <Input type="number" min={0} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit deal #{dealNo}</DialogTitle>
          <DialogDescription>
            Fixes a wrong number — the account&apos;s totals recompute from all
            its deals. Only the deal&apos;s owner, their leaders or the LCP can save.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {customSplit ? (
            <p className="rounded-md border border-warning/50 bg-warning/10 px-2.5 py-1.5 text-xs text-muted-foreground">
              This deal&apos;s opens are <b>split across members</b> — they can&apos;t be
              edited here. Record a corrective deal instead; the note{showMoney ? ", amount" : ""} and
              benefits stay editable.
            </p>
          ) : null}
          {opensEditable ? (
            <div className={cn("grid gap-3", mixed ? "grid-cols-3" : showIgta ? "grid-cols-2" : "grid-cols-1")}>
              {showIgv ? numField(isBD ? "IGV (optional)" : "IGV", "text-gv", igv, setIgv) : null}
              {showIgta ? numField(isBD ? "IGTa (optional)" : "IGTa", "text-gt", igta, setIgta) : null}
              {showIgte ? numField(isBD ? "IGTe (optional)" : "IGTe", "text-gte", igte, setIgte) : null}
            </div>
          ) : null}
          {opensEditable && !totalOk ? (
            <p className="text-xs font-medium text-warning">A deal needs at least one open.</p>
          ) : null}
          {showMoney ? (
            <>
              <div className="grid gap-1.5">
                <Label className="text-success">Deal amount (EGP)</Label>
                <Input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 15000"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Other benefits</Label>
                <Input
                  value={benefits}
                  onChange={(e) => setBenefits(e.target.value)}
                  placeholder="e.g. venue for events, media exposure…"
                />
              </div>
            </>
          ) : null}
          <div className="grid gap-1.5">
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. summer peak bulk deal" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !totalOk}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** History entry #0 — the account being added: who, when, and everything that
 *  was filed with it. Rendered in the timeline's own idiom, one shade quieter
 *  than the live entries because it's the account's starting line. */
function CreationEntry({ creation }: { creation: AccountCreationEntry }) {
  const { at, by, via, facts, contacts, comment } = creation;
  return (
    <div className="mt-1 flex items-start gap-3 rounded-lg border border-dashed p-3 text-sm">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          Account added
          {via === "import" ? (
            <Badge variant="outline" className="ml-2 font-normal">bulk import</Badge>
          ) : null}
        </p>
        {facts.length > 0 ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
            {facts.map(([label, value]) => (
              <span key={label} className="min-w-0 break-words">
                <span className="text-xs uppercase tracking-wide">{label}:</span>{" "}
                <span dir="auto">{value}</span>
              </span>
            ))}
          </p>
        ) : null}
        {contacts.length > 0 ? (
          <p className="mt-0.5 break-words text-muted-foreground" dir="auto">
            Contacts added:{" "}
            {contacts.map((c) => `${c.tag || c.kind} ${c.value}`).join(" · ")}
          </p>
        ) : null}
        {comment ? (
          <p className="mt-0.5 break-words text-muted-foreground" dir="auto">
            “{comment}”
          </p>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {by ? `${by} · ` : ""}
          {fmtDateTime(at)}
        </p>
      </div>
    </div>
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
  // RE-SEED when the pending visit changes (v33.18): the fields were filled
  // once at mount, so after a refresh — or when a visit got booked from the
  // contact dialog — "Reschedule" opened on the OLD date, and saving it
  // silently moved the visit back. Adjust-during-render; still hand-editable.
  const [seeded, setSeeded] = useState(pendingVisit?.id ?? null);
  if ((pendingVisit?.id ?? null) !== seeded) {
    setSeeded(pendingVisit?.id ?? null);
    setDate(pendingVisit?.visit_date ?? "");
    setTime(pendingVisit?.visit_time?.slice(0, 5) ?? "");
  }

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
  visit, open, onOpenChange, isRepeatVisit, onProposal, onDeal, onOop,
}: {
  visit: Visit;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** the 2nd visit or later — by then a deal is a realistic outcome (v33) */
  isRepeatVisit?: boolean;
  onProposal?: () => void;
  onDeal?: () => void;
  onOop?: () => void;
}) {
  const [done, setDone] = useState(true);
  const [result, setResult] = useState<string>("");
  const [comment, setComment] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [nextStepDate, setNextStepDate] = useState("");
  const [pending, start] = useTransition();

  // each result decides what the form still needs
  const archives = done && result === "Not interested";
  const wantsProposal = done && result === "I will send the proposal";
  const needsDate = done && result === "Not ready yet";
  // an archived account has no future, so it needs no next step
  const needsStep = !archives && (!done || !!result);
  const ready =
    comment.trim().length >= 2 &&
    (!done || !!result) &&
    (!needsDate || !!nextStepDate) &&
    (!needsStep || !!nextStep.trim() || archives);

  const submit = () =>
    start(async () => {
      const res = await reportVisit({
        visitId: visit.id, done, comment, nextStep, nextStepDate, result: done ? result : undefined,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(
        archives
          ? "Visit reported — the account is archived 🗄️"
          : "Visit reported — your TL & VP were notified 📬"
      );
      onOpenChange(false);
      // hand straight over to the next action so nobody has to hunt for it
      if (wantsProposal) onProposal?.();
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
          {done ? (
            <div className="grid gap-1.5">
              <Label>What came out of it? *</Label>
              <Select value={result || undefined} onValueChange={setResult}>
                <SelectTrigger><SelectValue placeholder="Pick the result…" /></SelectTrigger>
                <SelectContent>
                  {VISIT_RESULTS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {archives ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  This archives the account — its name is blocked afterwards. A
                  TL, VP or the LCP can bring it back.
                </p>
              ) : null}
              {wantsProposal ? (
                <p className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground">
                  Saving opens the proposal email form. It only counts as sent
                  once you actually send the draft from your Gmail.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label>{done ? "Visit comment *" : "Why didn't it happen? *"}</Label>
            <Textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                done
                  ? "How did it go? Who did you meet? Key outcomes…"
                  : "They cancelled, nobody showed, rescheduled…"
              }
            />
          </div>
          {!archives ? (
            <div className="grid gap-1.5">
              <Label>
                Next step {needsDate ? <span className="text-destructive">*with a date</span> : null}
              </Label>
              <Input
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
                placeholder={needsDate ? "e.g. Follow up after their exams" : "e.g. Send the proposal"}
              />
              <Input
                type="date"
                value={nextStepDate}
                onChange={(e) => setNextStepDate(e.target.value)}
                aria-invalid={needsDate && !nextStepDate ? true : undefined}
              />
            </div>
          ) : null}
          {/* both paths can end the account here, and a repeat visit can close
              the deal — neither should send anyone hunting for the button */}
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {isRepeatVisit && onDeal ? (
              <Button
                variant="outline"
                className="text-success"
                onClick={() => { onOpenChange(false); onDeal(); }}
              >
                🏆 Deal signed
              </Button>
            ) : null}
            {onOop ? (
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => { onOpenChange(false); onOop(); }}
              >
                Out of process
              </Button>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !ready}>
            {pending ? "Sending…" : archives ? "Save & archive" : "Save & notify"}
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
  accountId, fn, dealNumber, responsibleId, responsibleLabel, functionMembers,
  open, onOpenChange,
}: {
  accountId: string;
  fn: "IGV" | "IGT" | "B2B" | "BD" | "B2C";
  dealNumber: number;
  responsibleId: string | null;
  responsibleLabel: string | null;
  /** everyone in the account's function — the opens-split picker (v22) */
  functionMembers: { id: string; label: string }[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [igv, setIgv] = useState(fn === "IGV" ? "1" : "0");
  const [igta, setIgta] = useState("0");
  const [igte, setIgte] = useState("0");
  const [amount, setAmount] = useState(""); // BD: the deal's EGP amount (their MOS)
  const [benefits, setBenefits] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [celebrate, setCelebrate] = useState(false);
  const [pending, start] = useTransition();
  // v22: optionally split THIS deal's opens across members (default: 100% to
  // the responsible). Rows are {memberId, igv, igta, igte} as strings.
  const [splitOn, setSplitOn] = useState(false);
  const [splitRows, setSplitRows] = useState<
    { memberId: string; igv: string; igta: string; igte: string }[]
  >([]);

  // which product fields to show for this account
  const mixed = fn === "B2B" || fn === "BD"; // both raise for the whole ICX
  const isBD = fn === "BD"; // BD's MOS is money — opens are optional extras
  const isB2C = fn === "B2C"; // B2C deals carry NO details (v23)
  const showIgv = fn === "IGV" || mixed;
  const showIgta = fn === "IGT" || mixed;
  const showIgte = fn === "IGT" || mixed;
  // v31: a BD deal is money first — the per-product opens breakdown hides
  // behind a switch (OFF by default), so the usual BD prompt is just
  // amount + benefits. Every other function still needs its opens.
  const [opensDetail, setOpensDetail] = useState(false);
  const showOpens = !isBD || opensDetail;
  const dealIgv = showIgv && showOpens ? Number(igv) || 0 : 0;
  const dealIgta = showIgta && showOpens ? Number(igta) || 0 : 0;
  const dealIgte = showIgte && showOpens ? Number(igte) || 0 : 0;
  const total = dealIgv + dealIgta + dealIgte;
  const amountOk = (Number(amount) || 0) >= 1;

  const toggleSplit = (on: boolean) => {
    setSplitOn(on);
    if (on && splitRows.length === 0) {
      // start from the default: everything to the responsible
      setSplitRows([
        {
          memberId: responsibleId ?? "",
          igv: String(dealIgv),
          igta: String(dealIgta),
          igte: String(dealIgte),
        },
      ]);
    }
  };
  const setSplitCell = (
    i: number,
    key: "memberId" | "igv" | "igta" | "igte",
    value: string
  ) => setSplitRows((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const splitSum = (key: "igv" | "igta" | "igte") =>
    splitRows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const splitMatches =
    splitSum("igv") === dealIgv && splitSum("igta") === dealIgta && splitSum("igte") === dealIgte;
  const splitMembersOk =
    splitRows.every((r) => r.memberId) &&
    new Set(splitRows.map((r) => r.memberId)).size === splitRows.length;
  const splitOk = !splitOn || total === 0 || (splitMatches && splitMembersOk);

  const submit = () =>
    start(async () => {
      const res = await recordDeal(
        accountId,
        { igv: dealIgv, igta: dealIgta, igte: dealIgte },
        note,
        isBD ? { amount: Number(amount) || 0, benefits: benefits.trim() || undefined } : undefined,
        splitOn && total > 0
          ? splitRows.map((r) => ({
              memberId: r.memberId,
              igv: Number(r.igv) || 0,
              igta: Number(r.igta) || 0,
              igte: Number(r.igte) || 0,
            }))
          : undefined
      );
      if (res.ok) {
        toast.success(
          (res.data?.slots ?? 0) > 0
            ? `🎉 Deal #${res.data?.deals} recorded — ${res.data?.slots} total open${res.data?.slots === 1 ? "" : "s"} with this account!`
            : `🎉 Deal #${res.data?.deals} recorded with this account!`
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
        setAmount(""); setBenefits(""); setOpensDetail(false);
        setSplitOn(false); setSplitRows([]);
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
            {isB2C
              ? "B2C deals carry no details — just confirm it's signed. Fill the contract form FIRST."
              : isBD
                ? "BD deals are measured in MONEY: the amount (EGP) and any other benefits. Flip the opens switch only if this deal carried opens too."
                : mixed
                  ? "How many opens were signed in THIS deal, per product? e.g. 3 IGV · 2 IGTe · 1 IGTa."
                  : fn === "IGT"
                    ? "Split this deal's opens across IGTa and IGTe."
                    : "How many IGV opens were signed in THIS deal?"}
            {" "}Accounts can close more deals later — every one is counted.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {isB2C ? (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
              <p className="font-semibold">📄 Contract form first</p>
              <p className="mt-1 text-muted-foreground">
                Before marking the deal signed, fill the official contract form
                for this partner:
              </p>
              <Button asChild variant="outline" size="sm" className="mt-2.5">
                <a href={B2C_CONTRACT_FORM_URL} target="_blank" rel="noreferrer">
                  <FileText className="size-4" /> Open the contract form
                </a>
              </Button>
            </div>
          ) : null}
          {isBD ? (
            <>
              <div className="grid gap-1.5">
                <Label className="text-success">Deal amount (EGP) *</Label>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 15000"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Other benefits (optional)</Label>
                <Input
                  value={benefits}
                  onChange={(e) => setBenefits(e.target.value)}
                  placeholder="e.g. venue for events, media exposure…"
                />
              </div>
              <label className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm font-medium">
                <span className="min-w-0">
                  Did this deal also include opens?
                  <span className="block text-xs font-normal text-muted-foreground">
                    {opensDetail
                      ? "Fill the opens per product below."
                      : "Leave it off for a money-only deal."}
                  </span>
                </span>
                <Switch
                  checked={opensDetail}
                  onCheckedChange={(on) => {
                    setOpensDetail(on);
                    if (!on) { setIgv("0"); setIgta("0"); setIgte("0"); }
                  }}
                />
              </label>
            </>
          ) : null}
          {!isB2C && showOpens ? (
          <div className={cn("grid gap-3", mixed ? "grid-cols-3" : showIgta ? "grid-cols-2" : "grid-cols-1")}>
            {showIgv ? numField(isBD ? "IGV (optional)" : "IGV", "text-gv", igv, setIgv) : null}
            {showIgta ? numField(isBD ? "IGTa (optional)" : "IGTa", "text-gt", igta, setIgta) : null}
            {showIgte ? numField(isBD ? "IGTe (optional)" : "IGTe", "text-gte", igte, setIgte) : null}
          </div>
          ) : null}
          {!isB2C && (!isBD || amountOk || total > 0) ? (
          <p className="text-sm text-muted-foreground">
            Total this deal:{" "}
            <b className="text-foreground">
              {isBD && amountOk ? `EGP ${(Number(amount) || 0).toLocaleString()}` : null}
              {isBD && amountOk && total > 0 ? " + " : null}
              {!isBD || total > 0 ? `${total} open${total === 1 ? "" : "s"}` : null}
            </b>
          </p>
          ) : null}

          {/* v22: split the opens across members (default = all to the responsible) */}
          {!isB2C && total > 0 && functionMembers.length > 1 ? (
            <div className="rounded-lg border p-3">
              <label className="flex items-center justify-between gap-2 text-sm font-medium">
                <span>Split the opens between members</span>
                <Switch checked={splitOn} onCheckedChange={toggleSplit} />
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                {splitOn
                  ? "Who gets how many of this deal's opens? The split must add up exactly."
                  : `All ${total} open${total === 1 ? "" : "s"} go to ${responsibleLabel ?? "the account's responsible"}.`}
              </p>
              {splitOn ? (
                <div className="mt-3 grid gap-2">
                  {splitRows.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-1.5">
                      <Select
                        value={r.memberId || undefined}
                        onValueChange={(v) => setSplitCell(i, "memberId", v)}
                      >
                        <SelectTrigger className="h-8 w-36 flex-1">
                          <SelectValue placeholder="Member…" />
                        </SelectTrigger>
                        <SelectContent>
                          {functionMembers.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {showIgv ? (
                        <Input
                          type="number" min={0} inputMode="numeric"
                          aria-label="IGV opens for this member"
                          className="h-8 w-16 text-gv"
                          value={r.igv}
                          onChange={(e) => setSplitCell(i, "igv", e.target.value)}
                        />
                      ) : null}
                      {showIgta ? (
                        <Input
                          type="number" min={0} inputMode="numeric"
                          aria-label="IGTa opens for this member"
                          className="h-8 w-16 text-gt"
                          value={r.igta}
                          onChange={(e) => setSplitCell(i, "igta", e.target.value)}
                        />
                      ) : null}
                      {showIgte ? (
                        <Input
                          type="number" min={0} inputMode="numeric"
                          aria-label="IGTe opens for this member"
                          className="h-8 w-16 text-gte"
                          value={r.igte}
                          onChange={(e) => setSplitCell(i, "igte", e.target.value)}
                        />
                      ) : null}
                      {splitRows.length > 1 ? (
                        <Button
                          type="button" variant="ghost" size="icon" className="size-8"
                          aria-label="Remove this member from the split"
                          onClick={() => setSplitRows((rows) => rows.filter((_, j) => j !== i))}
                        >
                          <X className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  <Button
                    type="button" variant="outline" size="sm" className="w-fit"
                    onClick={() =>
                      setSplitRows((rows) => [...rows, { memberId: "", igv: "0", igta: "0", igte: "0" }])
                    }
                  >
                    <Plus className="size-4" /> Add member
                  </Button>
                  {!splitMatches ? (
                    <p className="text-xs font-medium text-warning">
                      The split must add up to the deal:{" "}
                      {showIgv ? `IGV ${splitSum("igv")}/${dealIgv} ` : ""}
                      {showIgta ? `IGTa ${splitSum("igta")}/${dealIgta} ` : ""}
                      {showIgte ? `IGTe ${splitSum("igte")}/${dealIgte}` : ""}
                    </p>
                  ) : !splitMembersOk ? (
                    <p className="text-xs font-medium text-warning">
                      Pick a member for every row (each one once).
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label>Note (optional)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. summer peak bulk deal" />
          </div>
          {!isB2C ? (
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5">
              <Paperclip className="size-3.5" /> Contract file(s) — optional
            </Label>
            <FileDrop
              multiple
              onFiles={(f) => setFiles(f)}
              label="Drop the contract file(s) here — or click to browse"
              hint="Any format works (PDF, photo, scan, doc…) — you can also add them later from the deal in History."
              fileName={files.length > 0 ? files.map((f) => f.name).join(" · ") : null}
              className="py-4"
            />
          </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || (isB2C ? false : isBD ? !amountOk : total < 1) || !splitOk}
          >
            {pending
              ? "Saving…"
              : isB2C
                ? "Deal signed ✅"
                : files.length > 0
                  ? `Record deal + upload ${files.length} file${files.length === 1 ? "" : "s"}`
                  : "Record deal"}
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
