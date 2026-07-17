"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle, Archive, Check, CheckCircle2, CheckSquare, CircleAlert, ClipboardList,
  Copy, FileUp, Loader2, Phone, Pin, Plus, Search, Send, Trash2, Users2, X, XCircle,
} from "lucide-react";
import type { PipelineRow } from "@/server/data";
import {
  addArchivedAccount, bulkArchiveAccounts, bulkReassignAccounts, importArchivedBulk,
  removeArchivedEntry, requestPodioSubmit, updateAccount,
} from "@/server/actions";
import {
  accountSlug, fmtDateTime, fmtTime, IGV_PROJECTS, OOP_REASONS, productBadge,
  STAGES,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { StageBadge } from "./stage-badge";
import { ContactDialog, type ContactTarget } from "./contact-dialog";
import { AddAccountDialog, type MemberOption } from "./add-account-dialog";
import { Hint } from "./hint";
import { QuickActions } from "./quick-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

/** Contact results offered in the "Last result" filter (matches the log
 *  dialog; "Call Scheduled" is legacy and kept only for old rows). */
const LAST_STATUS_OPTIONS = [
  "No Response", "Responded", "Interested", "Not Interested",
  "Wrong Contact", "Visit Scheduled",
] as const;

interface ViewerInfo {
  id: string;
  role: string;
  isAdmin: boolean;
  canAssignOthers: boolean;
  canViewArchive: boolean;
  canRemoveArchived: boolean;
  allowedFns: ("IGV" | "IGT" | "B2B" | "BD")[];
  showFnFilter: boolean;
  seesOthers: boolean;
  /** B2B/BD MMs + Director/VP (+LCP/admin): the Podio submission worklist */
  canPodioSubmit: boolean;
}

interface ManualEntry {
  id: string;
  name: string;
  reason: string | null;
  createdAt: string;
  addedBy: string | null;
}

/** Rich hover: tooltip with detail rows (label → value). */
function DetailHint({
  rows, children, side = "bottom",
}: {
  rows: [string, string | null | undefined][];
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const filled = rows.filter(([, v]) => v);
  if (filled.length === 0) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="max-w-64">
          <div className="grid gap-0.5 py-0.5 text-left">
            {filled.map(([label, value]) => (
              <p key={label} className="text-xs">
                <span className="opacity-70">{label}: </span>
                <span className="font-medium">{value}</span>
              </p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FnBadge({ row, className }: { row: PipelineRow; className?: string }) {
  const b = productBadge(row.function, row.product);
  return (
    <DetailHint
      rows={
        row.function === "IGV"
          ? [["Project", row.project], ["Type", row.account_type], ["Industry", row.industry]]
          : row.function === "B2B" || row.function === "BD"
            ? [["Product", `${row.function} — raises for the whole ICX`], ["Type", row.account_type], ["Industry", row.industry]]
            : [["Sub product", row.sub_product]]
      }
    >
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <Badge className={cn("border-transparent text-[10px] font-bold", b.bg, b.text)}>
          {b.label}
        </Badge>
        {row.function === "IGV" && row.project ? (
          <span className="text-xs text-muted-foreground">{row.project}</span>
        ) : null}
      </span>
    </DetailHint>
  );
}

/** Status badge with the CURRENT state's details on hover (deal totals, visit
 *  date/result, last contact, archive reason…). */
function StatusCell({ row }: { row: PipelineRow }) {
  const rows: [string, string | null | undefined][] =
    row.stage === "Deal Done"
      ? [
          ["Deals", `${row.deals_count}`],
          ["Opens", `${row.slots_count}`],
          ["Last deal", row.last_deal_at ? `${row.last_deal_slots ?? "?"} opens · ${fmtDateTime(row.last_deal_at)}` : null],
          ["Note", row.last_deal_note],
        ]
      : row.stage === "Visit Done"
        ? [
            ["Visit", row.visit_date ? `${row.visit_date} ${row.visit_time?.slice(0, 5) ?? ""}` : null],
            ["Result", row.visit_comment],
          ]
        : row.stage === "Visit Scheduled"
          ? [
              ["Visit on", row.visit_date ? `${row.visit_date} at ${row.visit_time?.slice(0, 5) ?? ""}` : null],
            ]
          : row.stage === "Out of Process"
            ? [
                ["Reason", row.oop_reason],
                ["Archived", fmtDateTime(row.oop_at)],
              ]
            : row.stage === "Contacted"
              ? [
                  ["Attempts", `${row.attempts}`],
                  ["Last result", row.last_contact_status],
                  ["Last contact", fmtDateTime(row.last_contact_at)],
                ]
              : [["Added", fmtDateTime(row.created_at)], ["Contacts", "none yet"]];
  return (
    <DetailHint rows={rows}>
      <span className="inline-flex">
        <StageBadge stage={row.stage} />
      </span>
    </DetailHint>
  );
}

/** Contacts count + the LAST contact result, details on hover. */
function ContactsCell({ row }: { row: PipelineRow }) {
  return (
    <DetailHint
      rows={[
        ["Attempts", `${row.attempts}`],
        ["Last result", row.last_contact_status],
        ["Via", row.last_contact_method],
        ["When", row.last_contact_at ? fmtDateTime(row.last_contact_at) : null],
      ]}
    >
      <span className="inline-flex flex-col items-center gap-0.5 leading-none">
        <span className="inline-flex items-center gap-1 text-sm">
          {row.attempts}
          {row.contact_limit_reached ? (
            <AlertTriangle className="size-3.5 text-warning" />
          ) : null}
        </span>
        {row.last_contact_status ? (
          <span
            className={cn(
              "text-[10px]",
              row.last_contact_status === "No Response"
                ? "text-warning"
                : row.last_contact_status === "Not Interested"
                  ? "text-destructive"
                  : row.last_contact_status === "Interested"
                    ? "text-success"
                    : "text-muted-foreground"
            )}
          >
            {row.last_contact_status}
          </span>
        ) : null}
      </span>
    </DetailHint>
  );
}

/** ❗ sign for accounts carrying a pinned note — hover shows the note so nobody
 *  contacts the account without reading it first. */
function PinSign({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Hint label={`❗ ${text}`} side="bottom">
      <span className="inline-flex cursor-help text-warning">
        <CircleAlert className="size-4 animate-pulse" />
      </span>
    </Hint>
  );
}

/** Tiny copy-the-name button (the Podio form wants the exact account name). */
function CopyNameButton({ name }: { name: string }) {
  return (
    <Hint label="Copy the account name — paste it into the Podio form">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(name);
          toast.success(`"${name}" copied.`);
        }}
        className="inline-flex shrink-0 rounded-md border p-1 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        aria-label={`Copy ${name}`}
      >
        <Copy className="size-3" />
      </button>
    </Hint>
  );
}

/** Shown to the OWNER on accounts a leader asked them to submit on Podio. */
function PodioPinBadge() {
  return (
    <Hint label="Your leader asked you to submit this account on Podio — it stays pinned on top until you do (set Requested / a request state on the account page)">
      <Badge className="border-transparent bg-warning/15 text-[10px] font-bold text-warning">
        <Pin className="size-3 fill-current" /> Submit on Podio
      </Badge>
    </Hint>
  );
}

/** Inline tools on each row of the "Podio pending" worklist: set the request
 *  state from outside the account, or ask the owner to submit it (in-app
 *  notification + pins the account on their list). */
function PodioRowTools({ row }: { row: PipelineRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asked, setAsked] = useState(!!row.podio_submit_requested_at);
  // Rejected archives the account — never without a confirmation
  const [confirmReject, setConfirmReject] = useState(false);

  const save = (v: "Checking" | "Approved" | "Rejected") =>
    start(async () => {
      const res = await updateAccount(row.id, {
        requested_podio: true,
        request_state: v,
      });
      if (res.ok) {
        toast.success(
          v === "Rejected"
            ? `"${row.name}" archived — Podio request rejected.`
            : `"${row.name}" → ${v}.`
        );
        router.refresh();
      } else toast.error(res.error);
    });

  const setState = (v: string) => {
    if (v === "Rejected") setConfirmReject(true);
    else save(v as "Checking" | "Approved");
  };

  const ask = () =>
    start(async () => {
      const res = await requestPodioSubmit(row.id);
      if (res.ok) {
        setAsked(true);
        toast.success(
          `${row.responsible_nickname || row.responsible_name} was asked to submit "${row.name}" — it's pinned on their list.`
        );
      } else toast.error(res.error);
    });

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <Select value="__set" onValueChange={setState} disabled={pending}>
        <SelectTrigger className="h-7 w-auto min-w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__set" disabled>Set request state…</SelectItem>
          <SelectItem value="Checking">Checking</SelectItem>
          <SelectItem value="Approved">Approved</SelectItem>
          <SelectItem value="Rejected">Rejected (archives)</SelectItem>
        </SelectContent>
      </Select>
      <Dialog open={confirmReject} onOpenChange={setConfirmReject}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>⚠️ Reject the Podio request?</DialogTitle>
            <DialogDescription>
              A rejected Podio request closes the account: <b>{row.name}</b> moves
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
                setConfirmReject(false);
                save("Rejected");
              }}
            >
              Reject &amp; archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Hint
        label={
          asked
            ? "Already asked — the account is pinned on the owner's list"
            : "Tell the owner to submit it on Podio (in-app notification, no email) and pin it on their accounts list"
        }
      >
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs"
          disabled={pending || asked}
          onClick={ask}
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
          {asked ? "Asked ✓" : "Ask to submit"}
        </Button>
      </Hint>
    </div>
  );
}

/** Minimal round checkbox for the bulk-selection mode. */
function SelectDot({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:border-primary/60"
      )}
    >
      {checked ? <Check className="size-3.5" /> : null}
    </button>
  );
}

export function AccountsView({
  rows, manualArchived, members, respOptions, viewer, filters,
}: {
  rows: PipelineRow[];
  manualArchived: ManualEntry[];
  members: MemberOption[];
  respOptions: { id: string; label: string }[];
  viewer: ViewerInfo;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [contactTarget, setContactTarget] = useState<ContactTarget | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addArchivedOpen, setAddArchivedOpen] = useState(false);
  const [importArchivedOpen, setImportArchivedOpen] = useState(false);
  const [navPending, startNav] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      startNav(() => router.replace(`/accounts?${params.toString()}`));
    },
    [router, searchParams]
  );

  useEffect(() => {
    if (q === filters.q) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setParam("q", q), 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, filters.q, setParam]);

  const archived = filters.archived === "1";
  const podioMode = filters.podio === "1";
  // bulk selection: pick accounts → archive or reassign them in one go
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);
  const [rowArchive, setRowArchive] = useState<PipelineRow | null>(null);
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };
  // a filter/tab switch changes what "selected" would even mean — always reset
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, [filterKey]);
  const anyFilter = Object.values(filters).some(Boolean);
  const stageOptions = STAGES.filter((s) => s !== "Out of Process");
  const today = new Date().toISOString().slice(0, 10);

  // accounts a leader asked THIS viewer to submit on Podio pin to the top
  const isPinnedForMe = (row: PipelineRow) =>
    !!row.podio_submit_requested_at &&
    row.responsible_id === viewer.id &&
    !row.requested_podio &&
    !row.request_state;
  const orderedRows = [...rows].sort(
    (a, b) => Number(isPinnedForMe(b)) - Number(isPinnedForMe(a))
  );

  const hrefFor = (row: PipelineRow) => `/accounts/${accountSlug(row.name)}`;
  const contactFor = (row: PipelineRow): ContactTarget => ({
    id: row.id,
    name: row.name,
    hasPendingVisit: !!row.visit_id && row.visit_done === null,
    nextStepDate: row.next_step_date,
  });

  // archive = OOP accounts + manually added names, newest first
  const archivedItems: (
    | { kind: "account"; date: string; row: PipelineRow }
    | { kind: "manual"; date: string; entry: ManualEntry }
  )[] = archived
    ? [
        ...rows.map((row) => ({
          kind: "account" as const,
          date: row.oop_at ?? row.updated_at ?? row.created_at,
          row,
        })),
        ...manualArchived
          .filter((e) => !q || e.name.toLowerCase().includes(q.trim().toLowerCase()))
          .map((entry) => ({ kind: "manual" as const, date: entry.createdAt, entry })),
      ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    : [];

  const archivedCount = archivedItems.length;

  return (
    <div className={cn("mx-auto max-w-7xl space-y-4", navPending && "nav-pending")}>
      <div className="flex flex-wrap items-center justify-between gap-3 rise-in">
        <div>
          <h1 className="text-2xl font-bold">
            {archived ? "Archived accounts" : "Accounts"}
            {navPending ? <Loader2 className="ml-2 inline size-4 animate-spin text-primary" /> : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            {archived
              ? `${archivedCount} archived name${archivedCount === 1 ? "" : "s"} — none of them can ever be re-added`
              : `${rows.length} account${rows.length === 1 ? "" : "s"} in your scope`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!archived && rows.length > 0 ? (
            <Hint label="Select several accounts, then archive or reassign them in one go">
              <Button
                variant={selectMode ? "default" : "outline"}
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              >
                <CheckSquare className="size-4" /> {selectMode ? "Done" : "Select"}
              </Button>
            </Hint>
          ) : null}
          {viewer.canPodioSubmit && !archived ? (
            <Hint label="B2B/BD accounts not yet requested on Podio — copy names, set the request state, or ask the owner to submit">
              <Button
                variant={podioMode ? "default" : "outline"}
                onClick={() => setParam("podio", podioMode ? "" : "1")}
              >
                <ClipboardList className="size-4" /> Podio pending
              </Button>
            </Hint>
          ) : null}
          {viewer.canViewArchive ? (
            <Hint label="Out-of-process accounts live here — hidden from lists but their names stay blocked">
              <Button
                variant={archived ? "default" : "outline"}
                onClick={() => setParam("archived", archived ? "" : "1")}
              >
                <Archive className="size-4" /> {archived ? "Back to active" : "Archive"}
              </Button>
            </Hint>
          ) : null}
          {archived ? (
            <>
              <Hint label="Import a whole sheet of archived names (Name + Reason) — blocked from ever being added">
                <Button variant="outline" onClick={() => setImportArchivedOpen(true)}>
                  <FileUp className="size-4" /> Import archived
                </Button>
              </Hint>
              <Hint label="Add one archived name by hand — for companies burned before the CRM existed">
                <Button onClick={() => setAddArchivedOpen(true)}>
                  <Plus className="size-4" /> Add archived
                </Button>
              </Hint>
            </>
          ) : (
            <>
              <Hint label="Got a sheet of market research? Import a whole CSV/Excel at once">
                <Button variant="outline" asChild>
                  <Link href="/accounts/import">
                    <FileUp className="size-4" /> Import
                  </Link>
                </Button>
              </Hint>
              <Hint label="Add one account — checked against all ICX data and the archive">
                <Button onClick={() => setAddOpen(true)} disabled={viewer.allowedFns.length === 0}>
                  <Plus className="size-4" /> Add account
                </Button>
              </Hint>
            </>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rise-in rise-in-1">
        <div className="relative min-w-40 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search accounts…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {viewer.showFnFilter ? (
          <FilterSelect
            value={filters.fn} placeholder="Function"
            onChange={(v) => setParam("fn", v)}
            options={viewer.allowedFns.map((f) => [f, f])}
          />
        ) : null}
        {(!filters.fn || filters.fn === "IGT") && viewer.allowedFns.includes("IGT") ? (
          <FilterSelect
            value={filters.product} placeholder="Product"
            onChange={(v) => setParam("product", v)}
            options={[["GTa", "IGTa"], ["GTe", "IGTe"]]}
          />
        ) : null}
        {(!filters.fn || filters.fn === "IGV") && viewer.allowedFns.includes("IGV") ? (
          <FilterSelect
            value={filters.project} placeholder="Project"
            onChange={(v) => setParam("project", v)}
            options={IGV_PROJECTS.map((p) => [p, p])}
          />
        ) : null}
        {!archived ? (
          <FilterSelect
            value={filters.stage} placeholder="Status"
            onChange={(v) => setParam("stage", v)}
            options={stageOptions.map((s) => [s, s])}
          />
        ) : null}
        {!archived ? (
          <FilterSelect
            value={filters.lastStatus} placeholder="Last result"
            onChange={(v) => setParam("lastStatus", v)}
            options={LAST_STATUS_OPTIONS.map((s) => [s, s])}
          />
        ) : null}
        {viewer.seesOthers && respOptions.length > 0 ? (
          // only members who HAVE accounts in the current view (any other
          // filter applied first) — not the whole membership list
          <FilterSelect
            value={filters.resp} placeholder="Responsible"
            onChange={(v) => setParam("resp", v)}
            options={respOptions.map((m) => [m.id, m.label])}
          />
        ) : null}
        {!archived ? (
          <FilterSelect
            value={filters.flag} placeholder="Flags"
            onChange={(v) => setParam("flag", v)}
            options={[
              ["contact_limit", "⚠️ 3-contact limit"],
              ["next_step_missing", "🚨 No next step"],
            ]}
          />
        ) : null}
        {/* Date added range — one h-9 group, aligned with the other filters */}
        <div className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30">
          <span className="hidden text-xs font-medium text-muted-foreground min-[400px]:inline">Added</span>
          <Input
            type="date"
            max={today}
            className="h-7 w-[6.6rem] min-[400px]:w-[7.9rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label="Added from"
            value={filters.from}
            onChange={(e) => setParam("from", e.target.value)}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            max={today}
            className="h-7 w-[6.6rem] min-[400px]:w-[7.9rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label="Added to"
            value={filters.to}
            onChange={(e) => setParam("to", e.target.value)}
          />
        </div>
        {anyFilter ? (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); startNav(() => router.replace("/accounts")); }}>
            <X className="size-4" /> Clear
          </Button>
        ) : null}
      </div>

      {archived ? (
        <ArchivedList
          items={archivedItems}
          canRemove={viewer.canRemoveArchived}
          seesOthers={viewer.seesOthers}
          onOpen={(row) => router.push(hrefFor(row))}
        />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-2.5 md:hidden">
            {rows.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No accounts here yet. Add your first one 🚀
                </CardContent>
              </Card>
            ) : (
              orderedRows.map((row, i) => (
                <Card
                  key={row.id}
                  className={cn(
                    "rise-in",
                    i < 4 && `rise-in-${i + 1}`,
                    selected.has(row.id) && "border-primary bg-primary/5"
                  )}
                  onClick={() =>
                    selectMode ? toggleSelected(row.id) : router.push(hrefFor(row))
                  }
                >
                  <CardContent className="space-y-2 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-1.5 font-semibold">
                          <span className="min-w-0 truncate">{row.name}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <PinSign text={row.pinned_comment} />
                            {podioMode ? <CopyNameButton name={row.name} /> : null}
                          </span>
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <FnBadge row={row} />
                          <StageBadge stage={row.stage} className="text-[10px]" />
                          {isPinnedForMe(row) ? <PodioPinBadge /> : null}
                          {row.contact_limit_reached ? (
                            <Badge className="border-transparent bg-warning/15 text-[10px] text-warning">⚠️ 3 contacts</Badge>
                          ) : null}
                          {row.next_step_missing ? (
                            <Badge variant="destructive" className="text-[10px]">🚨 no next step</Badge>
                          ) : null}
                        </div>
                        {podioMode ? <PodioRowTools row={row} /> : null}
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {selectMode ? (
                          <SelectDot
                            checked={selected.has(row.id)}
                            onToggle={() => toggleSelected(row.id)}
                          />
                        ) : null}
                        {!row.out_of_process && !selectMode ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              onClick={(e) => { e.stopPropagation(); setContactTarget(contactFor(row)); }}
                            >
                              <Phone className="size-3.5" /> Contact
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0 text-destructive hover:text-destructive"
                              aria-label="Archive"
                              onClick={(e) => { e.stopPropagation(); setRowArchive(row); }}
                            >
                              <XCircle className="size-3.5" />
                            </Button>
                          </>
                        ) : null}
                      </span>
                    </div>
                    {row.pinned_comment ? (
                      <p className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                        ❗ {row.pinned_comment}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>🗓️ {fmtDateTime(row.created_at)}</span>
                      <span>
                        📞 {row.attempts} contact{row.attempts === 1 ? "" : "s"}
                        {row.last_contact_status ? ` · ${row.last_contact_status}` : ""}
                      </span>
                      {row.next_step_date ? (
                        <span>
                          ⏭️ {row.next_step_date}
                          {row.next_step_time ? ` ${row.next_step_time.slice(0, 5)}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <QuickActions contacts={row.contacts} max={6} />
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Desktop: table — Date added · Account · Product · Status · Contacts · Next step · Quick actions */}
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block rise-in rise-in-2">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {selectMode ? <TableHead className="w-10" /> : null}
                    <TableHead>Date added</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Contacts</TableHead>
                    <TableHead>Next step</TableHead>
                    <TableHead>Quick actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={selectMode ? 8 : 7} className="py-12 text-center text-muted-foreground">
                        No accounts here yet. Add your first one 🚀
                      </TableCell>
                    </TableRow>
                  ) : (
                    orderedRows.map((row) => (
                      <TableRow
                        key={row.id}
                        className={cn("cursor-pointer", selected.has(row.id) && "bg-primary/5")}
                        onClick={() =>
                          selectMode ? toggleSelected(row.id) : router.push(hrefFor(row))
                        }
                      >
                        {selectMode ? (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <SelectDot
                              checked={selected.has(row.id)}
                              onToggle={() => toggleSelected(row.id)}
                            />
                          </TableCell>
                        ) : null}
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          <span className="block leading-tight">{row.created_at?.slice(0, 10)}</span>
                          <span className="block text-[10px] opacity-70">{fmtTime(row.created_at)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5">
                            <Link
                              href={hrefFor(row)}
                              className="font-medium hover:text-primary"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.name}
                            </Link>
                            <PinSign text={row.pinned_comment} />
                            {podioMode ? <CopyNameButton name={row.name} /> : null}
                            {isPinnedForMe(row) ? <PodioPinBadge /> : null}
                          </span>
                          {viewer.seesOthers ? (
                            <p className="text-xs text-muted-foreground">
                              {row.responsible_nickname || row.responsible_name}
                            </p>
                          ) : null}
                          {podioMode ? <PodioRowTools row={row} /> : null}
                        </TableCell>
                        <TableCell><FnBadge row={row} /></TableCell>
                        <TableCell><StatusCell row={row} /></TableCell>
                        <TableCell className="text-center"><ContactsCell row={row} /></TableCell>
                        <TableCell className="max-w-44 text-sm">
                          {row.next_step_missing ? (
                            <Badge variant="destructive" className="font-normal">missing</Badge>
                          ) : row.next_step_date ? (
                            <DetailHint
                              rows={[
                                ["Next step", row.next_step],
                                ["Date", row.next_step_date],
                                ["Time", row.next_step_time?.slice(0, 5) ?? "11:00 (default reminder)"],
                              ]}
                            >
                              <span className="text-muted-foreground">
                                {row.next_step_date}
                                {row.next_step ? ` · ${row.next_step.slice(0, 24)}` : ""}
                              </span>
                            </DetailHint>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <QuickActions contacts={row.contacts} />
                            {!row.out_of_process ? (
                              <>
                                <Hint label="Log a call / WhatsApp / email attempt on this account">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setContactTarget(contactFor(row))}
                                  >
                                    <Phone className="size-3.5" /> Log
                                  </Button>
                                </Hint>
                                <Hint label="Archive this account (Out of Process) — right from the list">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setRowArchive(row)}
                                  >
                                    <XCircle className="size-3.5" />
                                  </Button>
                                </Hint>
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {/* bulk-selection action bar */}
      {selectMode ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border bg-card px-4 py-2 shadow-xl">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(new Set(rows.map((r) => r.id)))}
            >
              All ({rows.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={selected.size === 0}
              onClick={() => setBulkArchiveOpen(true)}
            >
              <Archive className="size-3.5" /> Archive
            </Button>
            {viewer.canAssignOthers ? (
              <Button
                size="sm"
                variant="outline"
                disabled={selected.size === 0}
                onClick={() => setBulkReassignOpen(true)}
              >
                <Users2 className="size-3.5" /> Reassign
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={exitSelect} aria-label="Exit selection">
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
      <BulkArchiveDialog
        ids={rowArchive ? [rowArchive.id] : [...selected]}
        label={rowArchive ? `"${rowArchive.name}"` : `${selected.size} account${selected.size === 1 ? "" : "s"}`}
        open={bulkArchiveOpen || !!rowArchive}
        onOpenChange={(o) => {
          if (!o) {
            setBulkArchiveOpen(false);
            setRowArchive(null);
          }
        }}
        onDone={() => {
          setBulkArchiveOpen(false);
          setRowArchive(null);
          exitSelect();
        }}
      />
      <BulkReassignDialog
        ids={[...selected]}
        members={members}
        open={bulkReassignOpen}
        onOpenChange={setBulkReassignOpen}
        onDone={() => {
          setBulkReassignOpen(false);
          exitSelect();
        }}
      />
      <ContactDialog
        target={contactTarget}
        open={!!contactTarget}
        onOpenChange={(o) => !o && setContactTarget(null)}
      />
      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        viewer={{
          id: viewer.id,
          canAssignOthers: viewer.canAssignOthers,
          allowedFns: viewer.allowedFns,
        }}
        members={members}
      />
      <AddArchivedDialog open={addArchivedOpen} onOpenChange={setAddArchivedOpen} />
      <ImportArchivedDialog open={importArchivedOpen} onOpenChange={setImportArchivedOpen} />
    </div>
  );
}

// ------------------------------------------------------------------ archive

function ArchivedList({
  items, canRemove, seesOthers, onOpen,
}: {
  items: (
    | { kind: "account"; date: string; row: PipelineRow }
    | { kind: "manual"; date: string; entry: ManualEntry }
  )[];
  canRemove: boolean;
  seesOthers: boolean;
  onOpen: (row: PipelineRow) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const remove = (id: string, name: string) =>
    start(async () => {
      const res = await removeArchivedEntry(id);
      if (res.ok) { toast.success(`"${name}" removed from the archive`); router.refresh(); }
      else toast.error(res.error);
    });

  return (
    <>
      {/* Mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {items.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              The archive is empty.
            </CardContent>
          </Card>
        ) : (
          items.map((item) =>
            item.kind === "account" ? (
              <Card key={item.row.id} onClick={() => onOpen(item.row)}>
                <CardContent className="space-y-1.5 p-3.5">
                  <p className="flex items-center gap-1.5 font-semibold">{item.row.name}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FnBadge row={item.row} />
                    <span className="text-xs text-destructive">🗄️ {item.row.oop_reason ?? "archived"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(item.date)}</p>
                </CardContent>
              </Card>
            ) : (
              <Card key={item.entry.id}>
                <CardContent className="space-y-1.5 p-3.5">
                  <p className="flex items-center justify-between gap-2 font-semibold">
                    {item.entry.name}
                    {canRemove ? (
                      <Button
                        variant="ghost" size="icon" disabled={pending}
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(item.entry.id, item.entry.name)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">added manually</Badge>
                    <span className="text-xs text-destructive">🗄️ {item.entry.reason ?? "—"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTime(item.date)}{item.entry.addedBy ? ` · by ${item.entry.addedBy}` : ""}
                  </p>
                </CardContent>
              </Card>
            )
          )
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block rise-in rise-in-2">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Archived</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Source</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    The archive is empty.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) =>
                  item.kind === "account" ? (
                    <TableRow
                      key={item.row.id}
                      className="cursor-pointer"
                      onClick={() => onOpen(item.row)}
                    >
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        <span className="block leading-tight">{item.date?.slice(0, 10)}</span>
                        <span className="block text-[10px] opacity-70">{fmtTime(item.date)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{item.row.name}</span>
                        {seesOthers ? (
                          <p className="text-xs text-muted-foreground">
                            {item.row.responsible_nickname || item.row.responsible_name}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell><FnBadge row={item.row} /></TableCell>
                      <TableCell className="max-w-64 truncate text-sm text-muted-foreground">
                        {item.row.oop_reason ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        worked, then archived
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ) : (
                    <TableRow key={item.entry.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        <span className="block leading-tight">{item.date?.slice(0, 10)}</span>
                        <span className="block text-[10px] opacity-70">{fmtTime(item.date)}</span>
                      </TableCell>
                      <TableCell className="font-medium">{item.entry.name}</TableCell>
                      <TableCell><span className="text-muted-foreground">—</span></TableCell>
                      <TableCell className="max-w-64 truncate text-sm text-muted-foreground">
                        {item.entry.reason ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        added manually{item.entry.addedBy ? ` · ${item.entry.addedBy}` : ""}
                      </TableCell>
                      <TableCell>
                        {canRemove ? (
                          <Hint label="Remove this manual entry (typo / wrong import)">
                            <Button
                              variant="ghost" size="icon" disabled={pending}
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() => remove(item.entry.id, item.entry.name)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </Hint>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                )
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}

/** Reason picker: the curated list, "Other" opens free text. */
function ReasonField({
  value, onChange, compact,
}: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  const inList = (OOP_REASONS as readonly string[]).includes(value);
  const [other, setOther] = useState(!!value && !inList);
  return (
    <div className="grid gap-1.5">
      <Select
        value={other ? "Other" : value || undefined}
        onValueChange={(v) => {
          if (v === "Other") { setOther(true); onChange(""); }
          else { setOther(false); onChange(v); }
        }}
      >
        <SelectTrigger className={compact ? "h-8" : undefined}>
          <SelectValue placeholder="Why is it archived?" />
        </SelectTrigger>
        <SelectContent>
          {OOP_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          <SelectItem value="Other">Other…</SelectItem>
        </SelectContent>
      </Select>
      {other ? (
        <Input
          className={compact ? "h-8" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type the reason…"
        />
      ) : null}
    </div>
  );
}

/** Archive one or many accounts with a single reason — the reason applies to
 *  every selected account; RBAC runs per account on the server. */
function BulkArchiveDialog({
  ids, label, open, onOpenChange, onDone,
}: {
  ids: string[];
  label: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await bulkArchiveAccounts(ids, reason);
      if (res.ok) {
        const { done, failed } = res.data!;
        toast.success(
          `Archived ${done} account${done === 1 ? "" : "s"}${failed ? ` · ${failed} skipped (no access / already archived)` : ""}.`
        );
        setReason("");
        onDone();
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>🗄️ Archive {label}?</DialogTitle>
          <DialogDescription>
            Out of Process closes the account{ids.length === 1 ? "" : "s"} — the
            name{ids.length === 1 ? " goes" : "s go"} to the archive and can
            never be added again.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>Reason *</Label>
          <ReasonField value={reason} onChange={setReason} />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={pending || ids.length === 0 || reason.trim().length < 2}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
            Archive {ids.length === 1 ? "it" : `${ids.length} accounts`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Move many accounts to one member — RBAC + function rules run per account. */
function BulkReassignDialog({
  ids, members, open, onOpenChange, onDone,
}: {
  ids: string[];
  members: MemberOption[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await bulkReassignAccounts(ids, target);
      if (res.ok) {
        const { done, failed } = res.data!;
        toast.success(
          `Reassigned ${done} account${done === 1 ? "" : "s"}${failed ? ` · ${failed} skipped (no access / wrong function)` : ""}.`
        );
        onDone();
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>👥 Reassign {ids.length} account{ids.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            The chosen member becomes the Responsible — deals, visits and
            leaderboard numbers follow them from here on.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>New responsible *</Label>
          <Select value={target || undefined} onValueChange={setTarget}>
            <SelectTrigger><SelectValue placeholder="Pick a member…" /></SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                  {m.functions.length ? ` · ${m.functions.join(", ")}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || ids.length === 0 || !target}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Users2 className="size-4" />}
            Reassign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddArchivedDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await addArchivedAccount({ name, reason });
      if (res.ok) {
        toast.success(`"${name.trim()}" is archived — it can never be added.`);
        setName(""); setReason("");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>🗄️ Add an archived account</DialogTitle>
          <DialogDescription>
            For companies that were burned before the CRM existed — the name
            goes straight to the archive and can never be added as an account.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Account name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company / organization name" />
          </div>
          <div className="grid gap-1.5">
            <Label>Reason (optional)</Label>
            <ReasonField value={reason} onChange={setReason} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || name.trim().length < 2}>
            {pending ? "Saving…" : "Archive it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ArchivedDraft { name: string; reason: string }

function ImportArchivedDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ArchivedDraft[]>([]);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; error?: string }[] | null>(null);
  const [pending, start] = useTransition();

  const parseFile = async (file: File) => {
    setParsing(true);
    setResults(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1, raw: false, defval: "",
      }) as string[][];
      if (grid.length < 2) {
        toast.error("The file needs a header row + at least one name row.");
        return;
      }
      const headers = grid[0].map((h) => String(h ?? "").trim().toLowerCase());
      let nameCol = headers.findIndex((h) => /name|company|account/.test(h));
      let reasonCol = headers.findIndex((h) => /reason|why|comment/.test(h));
      if (nameCol < 0) nameCol = 0;
      if (reasonCol < 0 || reasonCol === nameCol) reasonCol = nameCol === 0 ? 1 : 0;
      const drafts: ArchivedDraft[] = grid
        .slice(1)
        .map((line) => ({
          name: String(line[nameCol] ?? "").trim(),
          // free-form reasons from old sheets are kept as-is
          reason: String(line[reasonCol] ?? "").trim(),
        }))
        .filter((d) => d.name);
      if (drafts.length === 0) {
        toast.error("No rows with a name found.");
        return;
      }
      if (drafts.length > 1000) {
        toast.error("Max 1000 archived names per import — split the file.");
        return;
      }
      setRows(drafts);
      setFileName(file.name);
      toast.success(`${drafts.length} name${drafts.length === 1 ? "" : "s"} read — review, edit, then import.`);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't read that file. Use .csv or .xlsx with a header row.");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const update = (i: number, patch: Partial<ArchivedDraft>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const removeRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  // only the name is required — reasons are optional in the archive
  const invalid = rows.filter((r) => r.name.trim().length < 2).length;

  const submit = () =>
    start(async () => {
      const res = await importArchivedBulk(rows.map((r) => ({ name: r.name.trim(), reason: r.reason.trim() })));
      if (!res.ok) { toast.error(res.error); return; }
      const { results: rr, created } = res.data!;
      setResults(rr);
      if (created === rows.length) toast.success(`All ${created} names archived 🗄️`);
      else toast.warning(`${created} archived · ${rows.length - created} blocked — see the rows.`);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setRows([]); setResults(null); setFileName(""); } onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>🗄️ Import archived accounts</DialogTitle>
          <DialogDescription>
            A <b>.csv</b> / <b>.xlsx</b> with <b>Name</b> and <b>Reason</b> columns —
            edit anything below before it enters the archive. Reasons outside the
            standard list are kept as they are.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) parseFile(f);
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {rows.length > 0 ? "Choose another file" : "Choose file"}
          </Button>
          {rows.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              <b>{fileName}</b> · {rows.length} name{rows.length === 1 ? "" : "s"}
              {invalid > 0 ? <span className="ml-2 text-destructive">{invalid} need fixes</span> : null}
            </p>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <div className="max-h-80 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-40">Name *</TableHead>
                  <TableHead className="min-w-48">Reason *</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const result = results?.[i];
                  return (
                    <TableRow key={i} className={cn(result && !result.ok && "bg-destructive/5")}>
                      <TableCell>
                        <Input className="h-8" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <ReasonField compact value={r.reason} onChange={(v) => update(i, { reason: v })} />
                      </TableCell>
                      <TableCell>
                        {result ? (
                          result.ok ? (
                            <Badge className="border-transparent bg-success/15 text-success">
                              <CheckCircle2 className="size-3" /> archived
                            </Badge>
                          ) : (
                            <Badge variant="destructive" title={result.error}>
                              <XCircle className="size-3" /> {result.error?.slice(0, 32)}
                            </Badge>
                          )
                        ) : r.name.trim().length < 2 || !r.reason.trim() ? (
                          <Badge className="border-transparent bg-warning/15 text-warning">incomplete</Badge>
                        ) : (
                          <Badge variant="outline">ready</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost" size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRow(i)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Expected columns: <b>Name</b> · <b>Reason</b> (any order, extra columns ignored)
          </p>
        )}

        <DialogFooter>
          <Button onClick={submit} disabled={pending || rows.length === 0 || invalid > 0}>
            {pending ? (
              <><Loader2 className="size-4 animate-spin" /> Importing…</>
            ) : (
              <>Archive {rows.length || ""} name{rows.length === 1 ? "" : "s"}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterSelect({
  value, placeholder, options, onChange,
}: {
  value: string;
  placeholder: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value || "__all"} onValueChange={(v) => onChange(v === "__all" ? "" : v)}>
      <SelectTrigger className="h-9 w-auto min-w-28">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{placeholder}: all</SelectItem>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
