"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle, Archive, Check, CheckCircle2, CheckSquare, CircleAlert,
  ChevronDown, Copy, FileUp, Loader2, MessageSquarePlus, Phone, Plus, RotateCcw, Search,
  Trash2, Users2, X,
  XCircle,
} from "lucide-react";
import type { PipelineRow } from "@/server/data";
import {
  addArchivedAccount, addComment, bulkArchiveAccounts, bulkDeleteArchived,
  bulkReassignAccounts,
  bulkReviveAccounts, importArchivedBulk, reassignAccount, removeArchivedEntry,
  updateAccount,
} from "@/server/actions";
import {
  accountSlug, fmtDateTime, fmtTime, IGT_SUB_PRODUCTS, IGV_PROJECTS, OOP_REASONS, productBadge,
  STAGES, type ContactMethod,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { StageBadge } from "./stage-badge";
import { ContactDialog, type ContactTarget } from "./contact-dialog";
import { AddAccountDialog, type MemberOption } from "./add-account-dialog";
import { AskBlueMan } from "./ask-blue-man";
import { FileDrop } from "./file-drop";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "./hint";
import { QuickActions } from "./quick-actions";
import {
  ColumnFilter, ColumnResizer, multi, PageSizePicker, resizableCellStyle, SortHeader,
  TableSettings,
  useTableColumns,
  useTableSort,
  type TableColumn,
} from "./data-table-kit";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { DEFAULT_PAGE_SIZE } from "@/lib/page-size";

/** Contact results offered in the "Last result" filter (matches the log
 *  dialog; "Call Scheduled" is legacy and kept only for old rows). */
const LAST_STATUS_OPTIONS = [
  "No Response", "Waiting for response", "Responded", "Interested", "Not Interested",
  "Wrong Contact", "Visit Scheduled",
] as const;

interface ViewerInfo {
  id: string;
  /** the signed-in member's display name — personalizes the WhatsApp opener */
  name: string;
  role: string;
  isAdmin: boolean;
  canAssignOthers: boolean;
  canSetRequestState: boolean;
  canViewArchive: boolean;
  /** add/import archived names — leaders only (viewing is LC-wide) */
  canManageArchive: boolean;
  canRemoveArchived: boolean;
  allowedFns: ("IGV" | "IGT" | "B2B" | "BD" | "B2C")[];
  showFnFilter: boolean;
  seesOthers: boolean;
  /** B2B/BD MMs + Director/VP (+LCP/admin): the Podio submission worklist */
  /** IGV-only viewer — the Product column shows the PROJECT instead (v22.2) */
  igvOnly: boolean;
  /** B2C-only viewer — the Product column shows the TYPE instead (v24) */
  b2cOnly: boolean;
  /** may see IGT accounts — enables the sub-product filter */
  igtAccess: boolean;
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

function FnBadge({
  row, className, igvOnly, b2cOnly,
}: {
  row: PipelineRow; className?: string; igvOnly?: boolean; b2cOnly?: boolean;
}) {
  const b = productBadge(row.function, row.product);
  // IGV-only viewers: every account is IGV — the badge is dead weight, show
  // the PROJECT in its place (v22.2)
  if (igvOnly && row.function === "IGV") {
    return (
      <DetailHint rows={[["Type", row.account_type], ["Industry", row.industry]]}>
        <Badge variant="outline" className={cn("max-w-40 truncate text-[10px] font-semibold", className)}>
          {row.project || "No project"}
        </Badge>
      </DetailHint>
    );
  }
  // B2C-only viewers: every account is B2C — show the TYPE instead (v24)
  if (b2cOnly && row.function === "B2C") {
    return (
      <Badge variant="outline" className={cn("max-w-40 truncate text-[10px] font-semibold", className)}>
        {row.account_type || "No type"}
      </Badge>
    );
  }
  return (
    <DetailHint
      rows={
        row.function === "IGV"
          ? [["Project", row.project], ["Type", row.account_type], ["Industry", row.industry]]
          : row.function === "B2B" || row.function === "BD"
            ? [["Product", `${row.function} — raises for the whole ICX`], ["Type", row.account_type], ["Industry", row.industry]]
            : row.function === "B2C"
              ? [["Type", row.account_type]]
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
              row.last_contact_status === "No Response" ||
                row.last_contact_status === "Waiting for response"
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


/** A filter that is a WORKLIST: on or off, never a value you pick. */
function FlagToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className="h-9"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

/** Copies an account name to the clipboard — the Podio form wants it typed
 *  exactly, and retyping is how "Al Safwa" becomes "Alsafwa". */
function CopyNameButton({ name }: { name: string }) {
  const [done, setDone] = useState(false);
  return (
    <Hint label={done ? "Copied" : "Copy name"}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground hover:text-primary"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          navigator.clipboard.writeText(name).then(
            () => {
              setDone(true);
              toast.success("Copied");
              setTimeout(() => setDone(false), 1500);
            },
            () => toast.error("Couldn't copy — select the name and copy it by hand.")
          );
        }}
      >
        {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </Hint>
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

// --------------------------------------------- inline list edits (v33.17)

/** The Podio column, editable in place — no need to open the account. The
 *  server re-checks every rule; "Rejected" ARCHIVES the account (like Not
 *  Interested), so it confirms first. Read-only for archived rows, viewers
 *  without edit rights, and a state the viewer has no authority to change. */
function PodioInlineCell({ row }: { row: PipelineRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const canState = !!row.can_request_state;
  const value = row.request_state ?? (row.requested_podio ? "Requested" : "—");
  if (
    row.out_of_process ||
    (!row.can_edit && !canState) ||
    // a state someone with authority set — flipping "requested" under it
    // changes nothing this column shows, and clearing it needs that authority
    (row.request_state && !canState)
  )
    return <>{value}</>;
  const apply = (v: string) => {
    if (v === value) return;
    if (
      v === "Rejected" &&
      !window.confirm(
        `Mark "${row.name}" as Rejected on Podio? Like Not Interested, this ARCHIVES the account — the name goes to the archive and can never be added again.`
      )
    )
      return;
    // request_state only travels when the viewer may set it — the server
    // refuses the key (even null) otherwise
    const patch =
      v === "—"
        ? canState
          ? { requested_podio: false, request_state: null }
          : { requested_podio: false }
        : v === "Requested"
          ? canState
            ? { requested_podio: true, request_state: null }
            : { requested_podio: true }
          : { requested_podio: true, request_state: v as "Checking" | "Approved" | "Rejected" };
    start(async () => {
      const res = await updateAccount(row.id, patch);
      if (res.ok) {
        toast.success(
          v === "Rejected"
            ? `"${row.name}" marked Rejected — archived.`
            : "Podio state saved."
        );
        router.refresh();
      } else toast.error(res.error);
    });
  };
  return (
    <div className="w-fit" onClick={(e) => e.stopPropagation()}>
      <Select value={value} onValueChange={apply} disabled={pending}>
        <SelectTrigger size="sm" className="h-7 gap-1 px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="—">—</SelectItem>
          <SelectItem value="Requested">Requested</SelectItem>
          {canState ? (
            <>
              <SelectItem value="Checking">Checking</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Rejected">Rejected (archives)</SelectItem>
            </>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The Responsible column, editable in place: hand the account over without
 *  opening it. Targets are the viewer's RBAC-correct reassign list; the
 *  server re-checks per account. */
function ResponsibleInlineCell({
  row, targets,
}: {
  row: PipelineRow;
  targets: MemberOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!row.can_reassign || row.out_of_process || targets.length === 0)
    return <span dir="auto">{row.responsible_name || "Unassigned"}</span>;
  const known = row.responsible_id != null && targets.some((m) => m.id === row.responsible_id);
  const apply = (v: string) => {
    if (v === row.responsible_id) return;
    start(async () => {
      const res = await reassignAccount(row.id, v);
      if (res.ok) {
        const t = targets.find((m) => m.id === v);
        toast.success(`"${row.name}" reassigned to ${t?.label ?? "them"}.`);
        router.refresh();
      } else toast.error(res.error);
    });
  };
  return (
    <div className="w-fit" onClick={(e) => e.stopPropagation()}>
      <Select value={row.responsible_id ?? ""} onValueChange={apply} disabled={pending}>
        <SelectTrigger size="sm" className="h-7 max-w-44 gap-1 px-2 text-xs">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          {/* the current responsible may sit outside the viewer's target list
              (e.g. filtered scope) — show them, but only as the current value */}
          {!known && row.responsible_id ? (
            <SelectItem value={row.responsible_id} disabled>
              {row.responsible_name || "Current responsible"}
            </SelectItem>
          ) : null}
          {/* just the name — the inline chip is already scoped to this lane,
              so the function suffix only added noise to the owner cell (v33.19) */}
          {targets.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ------------------------------------------------- universal table columns

/** Which SERVER sort field each column maps to (the list is server-sorted +
 *  paginated — the whitelist lives in buildAccountsQuery). Columns absent from
 *  this map simply render a plain header. */
const ACCOUNT_SORT: Record<string, { field: string; dir: "asc" | "desc" }> = {
  created_at: { field: "created_at", dir: "desc" },
  name: { field: "normalized_name", dir: "asc" },
  product: { field: "function", dir: "asc" },
  stage: { field: "stage", dir: "asc" },
  attempts: { field: "attempts", dir: "desc" },
  next_step: { field: "next_step_date", dir: "asc" },
  deals: { field: "deals_count", dir: "desc" },
  slots: { field: "slots_count", dir: "desc" },
  last_contact: { field: "last_contact_at", dir: "desc" },
  updated_at: { field: "updated_at", dir: "desc" },
};

const ACCOUNT_HEAD_CLASS: Record<string, string> = {
  attempts: "text-center",
  deals: "text-center",
  slots: "text-center",
};

const ACCOUNT_CELL_CLASS: Record<string, string> = {
  created_at: "whitespace-nowrap text-sm text-muted-foreground",
  updated_at: "whitespace-nowrap text-sm text-muted-foreground",
  last_contact: "whitespace-nowrap text-sm text-muted-foreground",
  attempts: "text-center",
  deals: "text-center tabular-nums",
  slots: "text-center tabular-nums",
  next_step: "max-w-44 text-sm",
  responsible: "text-sm text-muted-foreground",
  account_type: "max-w-40 truncate text-sm text-muted-foreground",
  industry: "max-w-40 truncate text-sm text-muted-foreground",
  project: "max-w-40 truncate text-sm text-muted-foreground",
  sub_product: "text-sm text-muted-foreground",
  podio: "text-sm text-muted-foreground",
  proposal: "text-sm text-muted-foreground",
};

/** Every column the accounts list CAN show — the first seven are the classic
 *  layout, the rest are the "I used to have this in my sheet" extras, one
 *  checkbox away in ⚙ Columns. */
function accountColumns(viewer: ViewerInfo): TableColumn[] {
  // THE DEFAULT VIEW (v33.8): Date added · Account · (Product) · (Project) ·
  // Status · Contacts · Quick actions · Comment.
  //
  // Product and Project are DYNAMIC, because a column that reads the same on
  // every row is noise: Product only appears where the viewer's accounts can
  // actually differ (IGV is always IGV, B2B always B2B), and Project exists
  // for IGV alone — for IGT, B2B, BD and B2C there is nothing to put in it.
  const fns = viewer.allowedFns;
  const productVaries = fns.length > 1 || fns.includes("IGT");
  const hasProject = fns.includes("IGV");

  return [
    { key: "created_at", label: "Date added" },
    // WHOSE IS IT comes first for anyone who works through other people
    // (v33.10) — an MM scanning a list reads the owner before the name.
    // Members only ever see their own accounts, so it stays out of their way.
    ...(viewer.seesOthers ? [{ key: "responsible", label: "Responsible" }] : []),
    { key: "name", label: "Account", required: true },
    ...(productVaries
      ? [{ key: "product", label: viewer.b2cOnly ? "Type" : "Product" }]
      : []),
    ...(hasProject ? [{ key: "project", label: "Project" }] : []),
    { key: "stage", label: "Status" },
    { key: "attempts", label: "Contacts" },
    { key: "quick", label: "Quick actions", required: true },
    { key: "comment", label: "Comment" },
    // one tick away, not in the way — the row already wears a badge when a
    // next step is missing, which is the part that needs to be seen
    { key: "next_step", label: "Next step", defaultHidden: true },
    ...(viewer.igtAccess
      ? [{ key: "sub_product", label: "Sub product", defaultHidden: true }]
      : []),
    { key: "account_type", label: "Type", defaultHidden: true },
    { key: "industry", label: "Industry", defaultHidden: true },
    { key: "deals", label: "Deals", defaultHidden: true },
    { key: "slots", label: "Opens", defaultHidden: true },
    { key: "last_contact", label: "Last contact", defaultHidden: true },
    { key: "updated_at", label: "Updated", defaultHidden: true },
    { key: "proposal", label: "Proposal", defaultHidden: true },
    { key: "podio", label: "Podio", defaultHidden: true },
  ];
}

// --------------------------------------------- contact-after-click prompt

/** Which contact method a quick-action link stands for — `null` for the
 *  social links (opening a LinkedIn page is not a contact attempt). */
function methodFromHref(href: string): ContactMethod | null {
  const h = href.toLowerCase();
  if (h.startsWith("tel:")) return "Call";
  if (h.startsWith("mailto:")) return "Email";
  if (h.includes("wa.me") || h.includes("whatsapp.com")) return "WhatsApp";
  return null;
}

/** Wraps the quick-action icons: the link opens EXACTLY as before (never
 *  blocked), and the click also asks "did you contact them?" so nobody works
 *  an account without it landing in the history. One prompt per click. */
function QuickActionsLogged({
  row, viewerName, max, onUsed,
}: {
  row: PipelineRow;
  viewerName: string;
  max?: number;
  onUsed: (method: ContactMethod) => void;
}) {
  return (
    <span
      className="contents"
      onClickCapture={(e) => {
        const el = (e.target as HTMLElement | null)?.closest?.("a[href]");
        if (!el) return;
        const method = methodFromHref(el.getAttribute("href") ?? "");
        if (method) onUsed(method);
      }}
    >
      <QuickActions
        contacts={row.contacts}
        max={max}
        viewerName={viewerName}
        accountName={row.name}
      />
    </span>
  );
}

export function AccountsView({
  rows, total, page, pageSize, pageSizeOptions, manualArchived, members,
  reassignTargets, respOptions, teamOptions, viewer, filters,
}: {
  rows: PipelineRow[];
  /** total matches across ALL pages (the list is paginated since v22) */
  total: number;
  /** 0-based current page + the server's page size */
  page: number;
  pageSize: number;
  /** the accounts-per-page choices (?size param) */
  pageSizeOptions: number[];
  manualArchived: ManualEntry[];
  members: MemberOption[];
  /** members the viewer may reassign accounts TO (RBAC-correct, list-level) */
  reassignTargets: MemberOption[];
  respOptions: { id: string; label: string }[];
  /** the Team Leaders whose teams this viewer may filter by */
  teamOptions: { id: string; label: string }[];
  viewer: ViewerInfo;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [contactTarget, setContactTarget] = useState<ContactTarget | null>(null);
  // the channel the member actually tapped — it pre-selects the method
  const [contactMethod, setContactMethod] = useState<ContactMethod>("Call");
  const [addOpen, setAddOpen] = useState(false);
  // quick comment from the list (v33.17) — one dialog for the whole table
  const [quickComment, setQuickComment] = useState<{ id: string; name: string } | null>(null);
  const [addArchivedOpen, setAddArchivedOpen] = useState(false);
  const [importArchivedOpen, setImportArchivedOpen] = useState(false);
  const [navPending, startNav] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      // changing any filter restarts from the first page
      if (key !== "page") params.delete("page");
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

  // column sorting (v24): click a header to sort by it, click again to flip
  const sortBy = useCallback(
    (field: string, defaultDir: "asc" | "desc") => {
      const params = new URLSearchParams(searchParams.toString());
      if (filters.sort === field) {
        params.set("dir", filters.dir === "asc" ? "desc" : "asc");
      } else {
        params.set("sort", field);
        params.set("dir", defaultDir);
      }
      params.delete("page");
      startNav(() => router.replace(`/accounts?${params.toString()}`));
    },
    [router, searchParams, filters.sort, filters.dir]
  );
  const SortHead = ({
    field, defaultDir = "desc", children, className, filter, style, after,
  }: {
    field: string;
    defaultDir?: "asc" | "desc";
    children: React.ReactNode;
    className?: string;
    /** the column's funnel button, sitting beside the sortable name */
    filter?: React.ReactNode;
    style?: React.CSSProperties;
    /** the resize handle, positioned against the cell (v33.11) */
    after?: React.ReactNode;
  }) => (
    <TableHead className={className} style={style}>
      <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => sortBy(field, defaultDir)}
        className={cn(
          "group/sort -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95",
          filters.sort === field && "font-bold text-primary"
        )}
        title="Sort by this column"
      >
        {children}
        {filters.sort === field ? (
          <span>{filters.dir === "asc" ? "↑" : "↓"}</span>
        ) : (
          // ghost arrows fade + drop in on hover — "you can click me"
          <span
            aria-hidden
            className="-translate-y-0.5 opacity-0 transition-all duration-150 group-hover/sort:translate-y-0 group-hover/sort:opacity-60"
          >
            ↕
          </span>
        )}
      </button>
      {filter}
      </span>
      {after}
    </TableHead>
  );

  const archived = filters.archived === "1";
  // mobile render style (persisted): cards (default) · compact list · table
  const [mobileView, setMobileView] = useState<"cards" | "compact" | "table">("cards");
  useEffect(() => {
    const saved = localStorage.getItem("sodio-accounts-mobile-view");
    if (saved === "cards" || saved === "compact" || saved === "table") setMobileView(saved);
  }, []);
  const pickMobileView = (v: "cards" | "compact" | "table") => {
    setMobileView(v);
    localStorage.setItem("sodio-accounts-mobile-view", v);
  };
  // bulk selection: pick accounts → archive or reassign them in one go.
  // Desktop shows the checkboxes ALWAYS (direct select); mobile enters
  // selection via the Select button.
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
  // a filter/tab/PAGE switch changes what "selected" would even mean — always
  // reset (off-page ids would get bulk-archived invisibly otherwise)
  const filterKey = `${JSON.stringify(filters)}:${page}`;
  useEffect(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, [filterKey]);
  const anyFilter = Object.values(filters).some(Boolean);
  const stageOptions = STAGES.filter((s) => s !== "Out of Process");
  const today = new Date().toISOString().slice(0, 10);

  const orderedRows = rows;

  // Which COLUMNS carry a filter, and what it filters on. A column that maps to
  // a URL param gets the funnel button next to its name (Google Sheets style);
  // everything else in the bar above is a NON-column attribute (search, the
  // function, flags) or a range control (Date added).
  const columnFilter = (key: string): React.ReactNode => {
    const pick = (
      label: string,
      param: string,
      value: string,
      options: [string, string][]
    ) => (
      <ColumnFilter
        label={label}
        value={value}
        options={options.map(([v, l]) => ({ value: v, label: l }))}
        onChange={(v) => setParam(param, v)}
      />
    );
    switch (key) {
      case "product":
        // the Product column shows Project for IGV-only and Type for B2C-only
        // viewers — filter what is actually on screen
        if (viewer.igvOnly)
          return pick("Project", "project", filters.project, IGV_PROJECTS.map((p) => [p, p]));
        if (viewer.b2cOnly) return null;
        if (!viewer.allowedFns.includes("IGT")) return null;
        return pick("Product", "product", filters.product, [["GTa", "IGTa"], ["GTe", "IGTe"]]);
      case "stage":
        return archived
          ? null
          : pick("Status", "stage", filters.stage, stageOptions.map((s) => [s, s]));
      case "last_contact":
        return archived
          ? null
          : pick("Last result", "lastStatus", filters.lastStatus, LAST_STATUS_OPTIONS.map((s) => [s, s]));
      case "responsible":
        return viewer.seesOthers && respOptions.length > 0
          ? pick("Responsible", "resp", filters.resp, respOptions.map((m) => [m.id, m.label]))
          : null;
      case "project":
        return viewer.igvOnly
          ? null
          : pick("Project", "project", filters.project, IGV_PROJECTS.map((p) => [p, p]));
      case "sub_product":
        return viewer.igtAccess
          ? pick("Sub product", "sub", filters.sub, IGT_SUB_PRODUCTS.map((sp) => [sp, sp]))
          : null;
      default:
        return null;
    }
  };

  // archived rows link by UUID (v23.2): a name can exist archived in one
  // world AND active in the other — the slug resolves to the active one
  const hrefFor = (row: PipelineRow) =>
    row.out_of_process ? `/accounts/${row.id}` : `/accounts/${accountSlug(row.name)}`;
  const contactFor = (row: PipelineRow): ContactTarget => ({
    id: row.id,
    name: row.name,
    hasPendingVisit: !!row.visit_id && row.visit_done === null,
    nextStepDate: row.next_step_date,
  });

  // ⚙ Columns — the member's own order + visibility for THIS table
  // v33.7 bumped the id: the default column set changed (Product/Project are
  // dynamic now), and a layout saved against the old defaults would pin the
  // very columns this change removes.
  const cols = useTableColumns("accounts-v4", accountColumns(viewer));

  // REMEMBER THE QUERY (v33.10) so opening an account and coming back returns
  // to the same filtered list rather than the top of everything.
  const searchString = searchParams.toString();
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "sodio-accounts-query",
        searchString ? `?${searchString}` : ""
      );
    } catch {
      /* private mode — the back link just goes to the plain list */
    }
  }, [searchString]);

  /** One cell of the desktop table, by column key. */
  const accountCell = (row: PipelineRow, key: string): React.ReactNode => {
    switch (key) {
      case "created_at":
        return (
          <>
            <span className="block leading-tight">{row.created_at?.slice(0, 10)}</span>
            <span className="block text-[10px] opacity-70">{fmtTime(row.created_at)}</span>
          </>
        );
      case "name":
        return (
          <>
            <span className="inline-flex items-center gap-1.5">
              <Link
                href={hrefFor(row)}
                className="font-medium hover:text-primary"
                dir="auto"
                onClick={(e) => e.stopPropagation()}
              >
                {row.name}
              </Link>
              <PinSign text={row.pinned_comment} />
              {/* copying a name is what you do with it: the Podio form, a
                  WhatsApp message, a search. Always there (v33.10). */}
              <CopyNameButton name={row.name} />
            </span>
            {viewer.seesOthers && !cols.isVisible("responsible") ? (
              <p className="text-xs text-muted-foreground">
                {row.responsible_name || "Unassigned"}
              </p>
            ) : null}
          </>
        );
      case "product":
        return <FnBadge row={row} igvOnly={viewer.igvOnly} b2cOnly={viewer.b2cOnly} />;
      case "stage":
        return <StatusCell row={row} />;
      case "attempts":
        return <ContactsCell row={row} />;
      case "next_step":
        return row.next_step_missing ? (
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
        );
      case "quick":
        return (
          // the WRAPPER stops propagation, not the whole cell: clicking the
          // empty space beside these buttons should still open the account
          // (v33.2 — "let me click anywhere on the row")
          <div
            className="flex w-fit items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <QuickActionsLogged
              row={row}
              viewerName={viewer.name}
              onUsed={(method) => { setContactMethod(method); setContactTarget(contactFor(row)); }}
            />
            {!row.out_of_process ? (
              <>
                <Hint label="Log a call / WhatsApp / email attempt on this account">
                  <Button size="sm" variant="outline" onClick={() => { setContactMethod("Call"); setContactTarget(contactFor(row)); }}>
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
        );
      case "responsible":
        // editable in place (v33.17) — falls back to plain text for archived
        // rows and viewers without the authority to move it
        return <ResponsibleInlineCell row={row} targets={reassignTargets} />;
      case "project":
        return row.project ?? "—";
      case "sub_product":
        return row.sub_product ?? "—";
      case "account_type":
        return row.account_type ?? "—";
      case "industry":
        return row.industry ?? "—";
      case "deals":
        return row.deals_count;
      case "slots":
        return row.slots_count;
      case "last_contact":
        return row.last_contact_at ? (
          <>
            <span className="block leading-tight">{row.last_contact_at.slice(0, 10)}</span>
            <span className="block text-[10px] opacity-70">
              {row.last_contact_status ?? row.last_contact_method ?? ""}
            </span>
          </>
        ) : (
          "—"
        );
      case "comment": {
        // the WHOLE thread, the way a sheet would show it: newest first, each
        // line attributed, the full text on hover. Not just the pinned one.
        const all = row.comments_all ?? [];
        // quick-comment right from the list (v33.17) — edit-gated
        const addBtn = row.can_edit ? (
          <Hint label="Add a comment — right from the list">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                setQuickComment({ id: row.id, name: row.name });
              }}
            >
              <MessageSquarePlus className="size-3.5" />
            </Button>
          </Hint>
        ) : null;
        if (all.length === 0)
          return <span className="inline-flex items-center gap-1">—{addBtn}</span>;
        const newestFirst = [...all].reverse();
        // just the comments themselves — who said it and when is detail that
        // belongs in the account's Comments card, not in a scanning column
        const full = newestFirst.map((c) => c.body).join("\n\n");
        return (
          <span className="flex items-start gap-1">
            <span dir="auto" title={full} className="block min-w-0 max-w-[26rem] flex-1 space-y-0.5">
              {newestFirst.slice(0, 3).map((c, i) => (
                <span key={i} className="block truncate leading-tight">
                  {c.body}
                </span>
              ))}
              {newestFirst.length > 3 ? (
                <span className="block text-[10px] opacity-60">
                  +{newestFirst.length - 3} more — open the account
                </span>
              ) : null}
            </span>
            {addBtn}
          </span>
        );
      }
      case "updated_at":
        return row.updated_at?.slice(0, 10) ?? "—";
      case "proposal":
        return row.proposal_sent ? "✅ sent" : "—";
      case "podio":
        // editable in place (v33.17) — plain text when the viewer can't edit
        return <PodioInlineCell row={row} />;
      default:
        return null;
    }
  };

  // archive = OOP accounts (paginated) + manually added names (shown with the
  // FIRST page only — repeating them on every page would duplicate the list)
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
        ...(page === 0 ? manualArchived : [])
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
            {archived ? "Archived accounts" : "Raising"}
            {navPending ? <Loader2 className="ml-2 inline size-4 animate-spin text-primary" /> : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            {archived
              ? `${(total + manualArchived.length).toLocaleString("en")} archived name${total + manualArchived.length === 1 ? "" : "s"} — none of them can ever be re-added`
              : `${total.toLocaleString("en")} account${total === 1 ? "" : "s"} in your scope`}
          </p>
          {!archived ? (
            <AskBlueMan
              className="mt-1.5"
              hint="Ask The Blue Man for insights — or accounts matching any criteria"
              prefill="Give me the accounts where "
            />
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* desktop selects directly via the always-on row checkboxes; the
              Select toggle is the mobile way into selection */}
          {!archived && rows.length > 0 ? (
            <Hint label="Select several accounts, then archive or reassign them in one go">
              <Button
                className="md:hidden"
                variant={selectMode ? "default" : "outline"}
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              >
                <CheckSquare className="size-4" /> {selectMode ? "Done" : "Select"}
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
          {archived && viewer.canManageArchive ? (
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
          ) : !archived ? (
            <>
              <Hint label="Got a sheet of market research? Import a whole CSV/Excel at once">
                <Button variant="outline" asChild>
                  <Link href="/accounts/import">
                    <FileUp className="size-4" /> Import
                  </Link>
                </Button>
              </Hint>
              <Hint label="Add one account — checked against all ICX data and the archive">
                <Button
                  data-tour="accounts:add"
                  onClick={() => setAddOpen(true)}
                  disabled={viewer.allowedFns.length === 0}
                >
                  <Plus className="size-4" /> Add account
                </Button>
              </Hint>
            </>
          ) : null}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rise-in rise-in-1">
        <div className="relative min-w-40 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-tour="accounts:search"
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
        {/* Column-backed filters (Product · Project · Sub product · Status ·
            Last result · Responsible) live on the COLUMN HEADERS now — the
            Google Sheets affordance. The mobile card views have no header to
            hang them on, so they keep the chips. */}
        <div className="contents md:hidden">
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
        {(!filters.fn || filters.fn !== "IGV") && viewer.igtAccess ? (
          <FilterSelect
            value={filters.sub} placeholder="Sub product"
            onChange={(v) => setParam("sub", v)}
            options={IGT_SUB_PRODUCTS.map((s) => [s, s])}
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
        </div>
        {teamOptions.length > 0 ? (
          <FilterSelect
            value={filters.team} placeholder="Team"
            onChange={(v) => setParam("team", v)}
            options={teamOptions.map((t) => [t.id, t.label])}
          />
        ) : null}
        {/* Needs-Podio-checking is a TOGGLE: a worklist you switch on and
            clear, not an attribute you pick a value for. It also hides unowned
            accounts — nobody submits a name they haven't been given. (The "no
            next step" toggle was dropped in v33.4: the missing-next-step badge
            already shows on the row, so filtering to it added nothing.) */}
        {/* 🙋 MINE (v33.22) — one tap to "just my accounts", for everyone whose
            list holds someone else's rows: a Team Leader's team, a leader's
            function, and a Coordinator's share of the unowned pool. A plain
            Member's list is already only theirs, so they never see it. */}
        {viewer.seesOthers ? (
          <FlagToggle
            active={filters.resp === viewer.id}
            onClick={() => setParam("resp", filters.resp === viewer.id ? "" : viewer.id)}
            label="🙋 Mine"
          />
        ) : null}
        {!archived ? (
          <>
            <FlagToggle
              active={filters.flag === "needs_podio"}
              onClick={() =>
                setParam("flag", filters.flag === "needs_podio" ? "" : "needs_podio")
              }
              label="🔎 Needs Podio checking"
            />
          </>
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
        {/* ⚙ Columns — the table is theirs: reorder, hide, bring back */}
        {!archived ? (
          <TableSettings
            columns={cols}
            className={cn("ml-auto", mobileView !== "table" && "hidden md:inline-flex")}
          />
        ) : null}
      </div>

      {archived ? (
        <ArchivedList
          items={archivedItems}
          canRemove={viewer.canRemoveArchived}
          canManage={viewer.canManageArchive}
          seesOthers={viewer.seesOthers}
          igvOnly={viewer.igvOnly}
          b2cOnly={viewer.b2cOnly}
          onOpen={(row) => router.push(hrefFor(row))}
        />
      ) : (
        <>
          {/* Mobile: view switcher (cards / compact / table) */}
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1 md:hidden">
            {([
              ["cards", "Cards"],
              ["compact", "Compact"],
              ["table", "Table"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => pickMobileView(key)}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                  mobileView === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Mobile: cards */}
          <div className={cn("space-y-2.5 md:hidden", mobileView !== "cards" && "hidden")}>
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
                          </span>
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <FnBadge row={row} igvOnly={viewer.igvOnly} b2cOnly={viewer.b2cOnly} />
                          <StageBadge stage={row.stage} className="text-[10px]" />
                          {row.contact_limit_reached ? (
                            <Badge className="border-transparent bg-warning/15 text-[10px] text-warning">⚠️ 3 contacts</Badge>
                          ) : null}
                          {row.next_step_missing ? (
                            <Badge variant="destructive" className="text-[10px]">🚨 no next step</Badge>
                          ) : null}
                        </div>
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
                              onClick={(e) => { e.stopPropagation(); setContactMethod("Call"); setContactTarget(contactFor(row)); }}
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
                    {/* the logger wrapper is display:contents — the card's
                        space-y needs a real box of its own here */}
                    <div>
                      <QuickActionsLogged
                        row={row}
                        max={6}
                        viewerName={viewer.name}
                        onUsed={(method) => { setContactMethod(method); setContactTarget(contactFor(row)); }}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Mobile: compact list */}
          <div className={cn("md:hidden", mobileView !== "compact" && "hidden")}>
            {rows.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No accounts here yet. Add your first one 🚀
                </CardContent>
              </Card>
            ) : (
              <div className="divide-y rounded-xl border bg-card">
                {orderedRows.map((row) => (
                  <div
                    key={row.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5",
                      selected.has(row.id) && "bg-primary/5"
                    )}
                    onClick={() =>
                      selectMode ? toggleSelected(row.id) : router.push(hrefFor(row))
                    }
                  >
                    {selectMode ? (
                      <SelectDot
                        checked={selected.has(row.id)}
                        onToggle={() => toggleSelected(row.id)}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        <span className="min-w-0 truncate">{row.name}</span>
                        <PinSign text={row.pinned_comment} />
                      </p>
                      {row.next_step_date ? (
                        <p className="truncate text-xs text-muted-foreground">
                          ⏭️ {row.next_step_date}
                          {row.next_step ? ` · ${row.next_step}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <FnBadge row={row} igvOnly={viewer.igvOnly} b2cOnly={viewer.b2cOnly} />
                    <StageBadge stage={row.stage} className="text-[10px]" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Table — desktop always; mobile only in "table" view. Checkboxes are
              ALWAYS present in the table (desktop direct-select). */}
          <div
            className={cn(
              "overflow-hidden rounded-xl border bg-card md:block rise-in rise-in-2",
              mobileView === "table" ? "block" : "hidden md:block"
            )}
          >
            <div className="overflow-x-auto" data-tour="accounts:table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    {cols.visible.map((c) => {
                      const sort = ACCOUNT_SORT[c.key];
                      const filter = columnFilter(c.key);
                      // width + the grab strip on the right edge (v33.11)
                      const w = cols.widths[c.key];
                      // `width` alone is a SUGGESTION under table-layout:auto —
                      // the browser overrides it to fit content, which is why
                      // resizing appeared to do nothing. min+max pin it.
                      const style = w
                        ? { width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px` }
                        : undefined;
                      const resizer = (
                        <ColumnResizer
                          current={w}
                          onCommit={(px) => cols.setWidth(c.key, px)}
                          onReset={() => cols.clearWidth(c.key)}
                        />
                      );
                      return sort ? (
                        <SortHead
                          key={c.key}
                          field={sort.field}
                          defaultDir={sort.dir}
                          className={cn("relative", ACCOUNT_HEAD_CLASS[c.key])}
                          filter={filter}
                          style={style}
                          after={resizer}
                        >
                          {c.label}
                        </SortHead>
                      ) : (
                        <TableHead
                          key={c.key}
                          className={cn("relative", ACCOUNT_HEAD_CLASS[c.key])}
                          style={style}
                        >
                          <span className="inline-flex items-center gap-1">
                            {c.label}
                            {filter}
                          </span>
                          {resizer}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={cols.visible.length + 1}
                        className="py-12 text-center text-muted-foreground"
                      >
                        No accounts here yet. Add your first one 🚀
                      </TableCell>
                    </TableRow>
                  ) : (
                    orderedRows.map((row) => (
                      <TableRow
                        key={row.id}
                        className={cn("cursor-pointer", selected.has(row.id) && "bg-primary/5")}
                        onClick={() => router.push(hrefFor(row))}
                      >
                        <TableCell>
                          <SelectDot
                            checked={selected.has(row.id)}
                            onToggle={() => toggleSelected(row.id)}
                          />
                        </TableCell>
                        {cols.visible.map((c) => {
                          const rz = resizableCellStyle(cols, c.key);
                          return (
                            <TableCell
                              key={c.key}
                              className={cn(ACCOUNT_CELL_CLASS[c.key], rz.className)}
                              style={rz.style}
                            >
                              {accountCell(row, c.key)}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {/* pagination (v22 — the market-research import made the list BIG) */}
      {total > Math.min(...pageSizeOptions) ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            Showing {(page * pageSize + 1).toLocaleString("en")}–
            {Math.min(total, (page + 1) * pageSize).toLocaleString("en")} of{" "}
            {total.toLocaleString("en")}
            <PageSizePicker
              value={pageSize}
              options={pageSizeOptions}
              label="Accounts per page"
              // v33.15 — this cleared the param for 100 because 100 USED to be
              // the default, so picking it silently gave you the new default of
              // 20. Compare against the real default, or better: always set it.
              onChange={(n) =>
                setParam("size", n === DEFAULT_PAGE_SIZE ? "" : String(n))
              }
            />
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || navPending}
              onClick={() => setParam("page", page <= 1 ? "" : String(page))}
            >
              ← Prev
            </Button>
            <span className="tabular-nums">
              Page {page + 1} / {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * pageSize >= total || navPending}
              onClick={() => setParam("page", String(page + 2))}
            >
              Next →
            </Button>
          </div>
        </div>
      ) : null}

      {/* bulk-selection action bar — shows once anything is selected (or in
          the mobile Select mode) */}
      {selectMode || selected.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border bg-card px-4 py-2 shadow-xl">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSelected(
                  selected.size >= rows.length ? new Set() : new Set(rows.map((r) => r.id))
                )
              }
            >
              {selected.size >= rows.length && rows.length > 0
                ? "Clear"
                : `All (${rows.length})`}
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
            {viewer.canAssignOthers && reassignTargets.length > 0 ? (
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
        members={reassignTargets}
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
        defaultMethod={contactMethod}
        onOpenChange={(o) => !o && setContactTarget(null)}
      />
      <QuickCommentDialog
        target={quickComment}
        onOpenChange={(o) => !o && setQuickComment(null)}
      />
      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        viewer={{
          id: viewer.id,
          canAssignOthers: viewer.canAssignOthers,
          canSetRequestState: viewer.canSetRequestState,
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

type ArchivedItem =
  | { kind: "account"; date: string; row: PipelineRow }
  | { kind: "manual"; date: string; entry: ManualEntry };

function ArchivedList({
  items, canRemove, canManage, seesOthers, igvOnly, b2cOnly, onOpen,
}: {
  items: ArchivedItem[];
  canRemove: boolean;
  /** TL+ — can bring archived accounts back to active */
  canManage: boolean;
  seesOthers: boolean;
  igvOnly: boolean;
  b2cOnly: boolean;
  onOpen: (row: PipelineRow) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<
    { mode: "revive" | "delete"; ids: string[]; label: string } | null
  >(null);

  // click-to-sort (v24.3): client-side over the archive items — same
  // affordance as the active list's headers, no server round-trip
  const sorters = useMemo<Record<string, (i: ArchivedItem) => string | number | null>>(
    () => ({
      date: (i) => i.date ?? null,
      name: (i) => (i.kind === "account" ? i.row.name : i.entry.name),
      product: (i) =>
        i.kind !== "account"
          ? null
          : igvOnly
            ? i.row.project ?? null
            : b2cOnly
              ? i.row.account_type ?? null
              : i.row.function ?? null,
      reason: (i) =>
        i.kind === "account" ? i.row.oop_reason ?? null : i.entry.reason ?? null,
      source: (i) => (i.kind === "account" ? "worked, then archived" : "added manually"),
      responsible: (i) =>
        i.kind === "account"
          ? i.row.responsible_nickname || i.row.responsible_name || null
          : null,
    }),
    [igvOnly, b2cOnly]
  );
  const { sorted: sortedItems, sortKey, dir, toggle: toggleSort } = useTableSort(items, sorters);

  // ⚙ Columns for the archive table (client-side list, client-side sort)
  const cols = useTableColumns("accounts-archived", [
    { key: "date", label: "Archived" },
    { key: "name", label: "Account", required: true },
    { key: "product", label: igvOnly ? "Project" : b2cOnly ? "Type" : "Product" },
    { key: "reason", label: "Reason" },
    { key: "source", label: "Source" },
    ...(seesOthers
      ? [{ key: "responsible", label: "Responsible" }]
      : []),
  ]);
  const ARCH_SORT: Record<string, "asc" | "desc"> = {
    date: "desc", name: "asc", product: "asc", reason: "asc", source: "asc",
  };
  const ARCH_CELL_CLASS: Record<string, string> = {
    date: "whitespace-nowrap text-sm text-muted-foreground",
    reason: "max-w-64 truncate text-sm text-muted-foreground",
    source: "text-xs text-muted-foreground",
    responsible: "text-sm text-muted-foreground",
  };

  /** One archive cell — accounts and manual blacklist entries share the grid. */
  const archCell = (item: ArchivedItem, key: string): React.ReactNode => {
    if (key === "date")
      return (
        <>
          <span className="block leading-tight">{item.date?.slice(0, 10)}</span>
          <span className="block text-[10px] opacity-70">{fmtTime(item.date)}</span>
        </>
      );
    if (item.kind === "account") {
      const row = item.row;
      switch (key) {
        case "name":
          return (
            <>
              <span className="font-medium" dir="auto">{row.name}</span>
              {seesOthers && !cols.isVisible("responsible") ? (
                <p className="text-xs text-muted-foreground">
                  {row.responsible_name || "Unassigned"}
                </p>
              ) : null}
            </>
          );
        case "product":
          return <FnBadge row={row} igvOnly={igvOnly} b2cOnly={b2cOnly} />;
        case "reason":
          return row.oop_reason ?? "—";
        case "source":
          return "worked, then archived";
        case "responsible":
          return row.responsible_name || "Unassigned";
        default:
          return null;
      }
    }
    switch (key) {
      case "name":
        return <span className="font-medium" dir="auto">{item.entry.name}</span>;
      case "product":
        return <span className="text-muted-foreground">—</span>;
      case "reason":
        return item.entry.reason ?? "—";
      case "source":
        return `added manually${item.entry.addedBy ? ` · ${item.entry.addedBy}` : ""}`;
      default:
        return <span className="text-muted-foreground">—</span>;
    }
  };

  // selection only makes sense on ACCOUNT rows (manual entries have their own ✕)
  const selectable = canManage || canRemove;
  const accountIds = items.flatMap((i) => (i.kind === "account" ? [i.row.id] : []));
  // a filter/search/page change redefines what "selected" means — start over
  // (order-independent key: re-sorting the same rows must NOT clear it)
  const idsKey = [...accountIds].sort().join(",");
  useEffect(() => {
    setSelected(new Set());
  }, [idsKey]);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = (id: string, name: string) =>
    start(async () => {
      const res = await removeArchivedEntry(id);
      if (res.ok) { toast.success(`"${name}" removed from the archive`); router.refresh(); }
      else toast.error(res.error);
    });

  const runConfirm = () => {
    if (!confirm) return;
    start(async () => {
      // the server caps one call at 50 — feed it in chunks so select-all works
      let done = 0;
      let failed = 0;
      for (let i = 0; i < confirm.ids.length; i += 50) {
        const chunk = confirm.ids.slice(i, i + 50);
        const res =
          confirm.mode === "revive"
            ? await bulkReviveAccounts(chunk)
            : await bulkDeleteArchived(chunk);
        if (!res.ok) { toast.error(res.error); return; }
        done +=
          confirm.mode === "revive"
            ? (res.data as { revived: number }).revived
            : (res.data as { deleted: number }).deleted;
        failed += (res.data as { failed: number }).failed;
      }
      if (confirm.mode === "revive")
        toast.success(`${done} account${done === 1 ? "" : "s"} back in process ↩️${failed ? ` (${failed} skipped)` : ""}`);
      else
        toast.success(`${done} account${done === 1 ? "" : "s"} deleted${failed ? ` (${failed} skipped)` : ""}`);
      setSelected(new Set());
      setConfirm(null);
      router.refresh();
    });
  };

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
          sortedItems.map((item) =>
            item.kind === "account" ? (
              <Card key={item.row.id} onClick={() => onOpen(item.row)}>
                <CardContent className="space-y-1.5 p-3.5">
                  <p className="flex items-center gap-2 font-semibold">
                    {selectable ? (
                      <SelectDot checked={selected.has(item.row.id)} onToggle={() => toggle(item.row.id)} />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{item.row.name}</span>
                    {canManage ? (
                      <Button
                        variant="ghost" size="icon" disabled={pending}
                        className="size-7 shrink-0 text-muted-foreground hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirm({ mode: "revive", ids: [item.row.id], label: `"${item.row.name}"` });
                        }}
                      >
                        <RotateCcw className="size-3.5" />
                      </Button>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FnBadge row={item.row} igvOnly={igvOnly} b2cOnly={b2cOnly} />
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
      <div className="hidden justify-end md:flex">
        <TableSettings columns={cols} />
      </div>
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block rise-in rise-in-2">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {selectable ? (
                  <TableHead className="w-10">
                    <SelectDot
                      checked={accountIds.length > 0 && selected.size >= accountIds.length}
                      onToggle={() =>
                        setSelected(
                          selected.size >= accountIds.length ? new Set() : new Set(accountIds)
                        )
                      }
                    />
                  </TableHead>
                ) : null}
                {cols.visible.map((c) => (
                  <TableHead key={c.key}>
                    <SortHeader
                      label={c.label}
                      onClick={() => toggleSort(c.key, ARCH_SORT[c.key] ?? "asc")}
                      active={sortKey === c.key}
                      dir={dir}
                    />
                  </TableHead>
                ))}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={cols.visible.length + (selectable ? 2 : 1)}
                    className="py-12 text-center text-muted-foreground"
                  >
                    The archive is empty.
                  </TableCell>
                </TableRow>
              ) : (
                sortedItems.map((item) =>
                  item.kind === "account" ? (
                    <TableRow
                      key={item.row.id}
                      className={cn("cursor-pointer", selected.has(item.row.id) && "bg-primary/5")}
                      onClick={() => onOpen(item.row)}
                    >
                      {selectable ? (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <SelectDot checked={selected.has(item.row.id)} onToggle={() => toggle(item.row.id)} />
                        </TableCell>
                      ) : null}
                      {cols.visible.map((c) => (
                        <TableCell key={c.key} className={ARCH_CELL_CLASS[c.key]}>
                          {archCell(item, c.key)}
                        </TableCell>
                      ))}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <span className="flex items-center gap-1">
                          {canManage ? (
                            <Hint label="Back to active — puts it back in the raising process">
                              <Button
                                variant="ghost" size="icon" disabled={pending}
                                className="size-7 text-muted-foreground hover:text-primary"
                                onClick={() =>
                                  setConfirm({ mode: "revive", ids: [item.row.id], label: `"${item.row.name}"` })
                                }
                              >
                                <RotateCcw className="size-3.5" />
                              </Button>
                            </Hint>
                          ) : null}
                          {/* DELETE FOR GOOD (v33.11) — as if it had never been
                              added, so the name is free again. It existed only
                              as a bulk action behind Select mode, which nobody
                              found. Still VP/Director/LCP: this cascades and
                              cannot be undone. */}
                          {canRemove ? (
                            <Hint label="Delete permanently — removes it and frees the name">
                              <Button
                                variant="ghost" size="icon" disabled={pending}
                                className="size-7 text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  setConfirm({ mode: "delete", ids: [item.row.id], label: `"${item.row.name}"` })
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </Hint>
                          ) : null}
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={item.entry.id}>
                      {selectable ? <TableCell /> : null}
                      {cols.visible.map((c) => (
                        <TableCell key={c.key} className={ARCH_CELL_CLASS[c.key]}>
                          {archCell(item, c.key)}
                        </TableCell>
                      ))}
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

      {/* bulk action bar — appears once archived accounts are selected */}
      {selected.size > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <Button
              variant="ghost" size="sm"
              onClick={() =>
                setSelected(selected.size >= accountIds.length ? new Set() : new Set(accountIds))
              }
            >
              {selected.size >= accountIds.length ? "Clear" : `All (${accountIds.length})`}
            </Button>
            {canManage ? (
              <Button
                size="sm" disabled={pending}
                onClick={() =>
                  setConfirm({
                    mode: "revive",
                    ids: [...selected],
                    label: `${selected.size} account${selected.size === 1 ? "" : "s"}`,
                  })
                }
              >
                <RotateCcw className="size-4" /> Back to active
              </Button>
            ) : null}
            {canRemove ? (
              <Button
                variant="destructive" size="sm" disabled={pending}
                onClick={() =>
                  setConfirm({
                    mode: "delete",
                    ids: [...selected],
                    label: `${selected.size} account${selected.size === 1 ? "" : "s"}`,
                  })
                }
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* revive / delete confirmation */}
      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <DialogContent className="sm:max-w-md">
          {confirm?.mode === "revive" ? (
            <>
              <DialogHeader>
                <DialogTitle>↩️ Back to active?</DialogTitle>
                <DialogDescription>
                  {confirm.label} will leave the archive and return to the raising
                  process — status, contacts and history intact. Accounts outside
                  your scope are skipped automatically.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={runConfirm} disabled={pending}>
                  {pending ? "Reviving…" : "Yes, back to active"}
                </Button>
              </DialogFooter>
            </>
          ) : confirm ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-destructive">
                  <AlertTriangle className="mr-1.5 inline size-4" /> Delete permanently?
                </DialogTitle>
                <DialogDescription>
                  {confirm.label} — with all contacts, visits, deals and comments —
                  will be <b>deleted for good</b>. This is NOT archiving: the record
                  disappears and the name becomes addable again. Accounts outside
                  your scope are skipped. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={runConfirm} disabled={pending}>
                  {pending ? "Deleting…" : "Delete permanently"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
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
  const [notify, setNotify] = useState(true);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await bulkReassignAccounts(ids, target, notify);
      if (res.ok) {
        const { done, failed, emailed } = res.data!;
        toast.success(
          `Reassigned ${done} account${done === 1 ? "" : "s"}${failed ? ` · ${failed} skipped (no access / wrong function)` : ""}${done > 0 && notify ? (emailed ? " · they got the news 📬" : " · notified in-app (no email on file)") : ""}.`
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
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
          <SelectDot checked={notify} onToggle={() => setNotify((n) => !n)} />
          <span className="text-sm">
            <span className="font-medium">Email them about it 📬</span>
            <span className="block text-xs text-muted-foreground">
              A bell notification + an email listing the accounts, with a
              button to their accounts list.
            </span>
          </span>
        </label>
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

/** Quick comment from the list (v33.17) — the same numbered, attributed
 *  comment the account page files, without opening the account. */
function QuickCommentDialog({
  target, onOpenChange,
}: {
  target: { id: string; name: string } | null;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  // a fresh account = a fresh comment box
  const targetId = target?.id;
  useEffect(() => setBody(""), [targetId]);

  const submit = () =>
    start(async () => {
      if (!target) return;
      const res = await addComment(target.id, body);
      if (res.ok) {
        toast.success("Comment added 💬");
        setBody("");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle dir="auto">💬 Comment on {target?.name}</DialogTitle>
          <DialogDescription>
            Lands in the account&apos;s Comments card — numbered and attributed
            like any other comment.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          dir="auto"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What happened / what to know…"
        />
        <DialogFooter>
          <Button onClick={submit} disabled={pending || body.trim().length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <MessageSquarePlus className="size-4" />}
            Add comment
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
        <FileDrop
          accept=".csv,.xlsx,.xls"
          onFile={(f) => parseFile(f)}
          disabled={parsing}
          label={rows.length > 0 ? "Drop another file — or click to browse" : "Drop the .csv / .xlsx here — or click to browse"}
          fileName={rows.length > 0 ? fileName : null}
          className="py-4"
        />
        {rows.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {rows.length} name{rows.length === 1 ? "" : "s"}
            {invalid > 0 ? <span className="ml-2 text-destructive">{invalid} need fixes</span> : null}
          </p>
        ) : null}

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

/** The MOBILE filter chip — the phone twin of the desktop column funnel, and
 *  multi-select for the same reason (v33.3). A Radix Select can only hold one
 *  value, so this is a checkbox menu that reports the same comma-joined
 *  string the column filters and the server both speak. */
function FilterSelect({
  value, placeholder, options, onChange,
}: {
  value: string;
  placeholder: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  const picked = multi(value);
  const labelOf = (v: string) => options.find(([ov]) => ov === v)?.[1] ?? v;
  const summary =
    picked.length === 0
      ? placeholder
      : picked.length === 1
        ? `${placeholder}: ${labelOf(picked[0])}`
        : `${placeholder}: ${picked.length}`;
  const toggle = (v: string) =>
    onChange((picked.includes(v) ? picked.filter((p) => p !== v) : [...picked, v]).join(","));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-9 w-auto min-w-28 justify-between font-normal", picked.length > 0 && "border-primary/60")}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-y-auto">
        <DropdownMenuCheckboxItem
          checked={picked.length === 0}
          onCheckedChange={() => onChange("")}
        >
          {placeholder}: all
        </DropdownMenuCheckboxItem>
        {options.map(([v, label]) => (
          <DropdownMenuCheckboxItem
            key={v}
            checked={picked.includes(v)}
            onCheckedChange={() => toggle(v)}
            onSelect={(e) => e.preventDefault()}
          >
            <span className="truncate" dir="auto">{label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
