"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2, Plus, Search, Sparkles, Trash2, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { cairoToday } from "@/lib/types";
import {
  APPROVAL_SOURCES,
  SOURCE_LABEL,
  functionOfProduct,
  type ApprovalFunction,
  type ApprovalProduct,
  type ApprovalSource,
  type LaneApprovals,
} from "@/lib/icx-approvals";
import {
  deleteIcxApproval,
  logIcxApproval,
  updateIcxApproval,
  type ApprovalInput,
} from "@/server/icx-approval-actions";
import type {
  ApprovalSuggestion,
  CreditTarget,
  IcxApprovalRow,
} from "@/server/icx-approvals";
import { CountryInput } from "./country-input";
import { IcxApprovalsBoard } from "./icx-approvals-board";

export interface ApprovalFormOptions {
  irCalls: { id: string; label: string; lcId: string | null; product: string | null }[];
  cvs: { id: string; label: string }[];
  accounts: { id: string; name: string; function: string }[];
}

type Lc = { id: string; name: string; country: string | null };

const PRODUCT_TONE: Record<ApprovalProduct, string> = {
  GV: "bg-[#F85A40]/15 text-[#c2410c] dark:text-[#fb8a73]",
  GTa: "bg-[#0CB9C1]/15 text-[#0e7490] dark:text-[#5fd6dc]",
  GTe: "bg-[#F48924]/15 text-[#b45309] dark:text-[#f7ad66]",
};

/**
 * 🏆 THE APPROVALS TAB (v37) — the ICX MOS, logged where the consideration
 * floor works.
 *
 *  · the board for each lane the viewer reads (planned vs achieved)
 *  · the ECB SubTool's approvals nobody has logged yet — one tap to claim,
 *    everything the sheet knows prefilled; the claim says WHO made it
 *  · the log itself: searchable, filterable, editable by whoever logged it,
 *    whoever it counts for, their Team Leader, and the function's leaders
 */
export function IcxApprovalsTab({
  rows,
  suggestions,
  boards,
  creditTargets,
  lcs,
  options,
  lanes,
  viewerId,
  mmPlanned,
}: {
  rows: IcxApprovalRow[];
  suggestions: ApprovalSuggestion[];
  boards: Partial<Record<ApprovalFunction, LaneApprovals>>;
  creditTargets: CreditTarget[];
  lcs: Lc[];
  options: ApprovalFormOptions;
  lanes: ApprovalFunction[];
  viewerId: string;
  /** the consideration MMs' filed approvals for this month, per lane */
  mmPlanned: Partial<Record<ApprovalFunction, number | null>>;
}) {
  const [lane, setLane] = useState<ApprovalFunction>(lanes[0] ?? "IGV");
  const [editing, setEditing] = useState<
    { mode: "new"; prefill?: Partial<ApprovalInput> } | { mode: "edit"; row: IcxApprovalRow } | null
  >(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [q, setQ] = useState("");
  const [product, setProduct] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [madeBy, setMadeBy] = useState<string>("");

  const laneRows = useMemo(() => rows.filter((r) => r.function === lane), [rows, lane]);
  const laneSuggestions = useMemo(
    () => suggestions.filter((s) => s.function === lane),
    [suggestions, lane]
  );
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of laneRows) if (r.made_by) m.set(r.made_by, r.made_by_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [laneRows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return laneRows.filter((r) => {
      if (product && r.product !== product) return false;
      if (source && r.source !== source) return false;
      if (madeBy === "__me" ? r.made_by !== viewerId : madeBy && r.made_by !== madeBy) return false;
      if (!needle) return true;
      return [r.ep_name, r.expa_id, r.partner_lc_name, r.country, r.opportunity, r.account_name, r.made_by_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [laneRows, q, product, source, madeBy, viewerId]);

  const board = boards[lane];
  const filtersOn = !!(q || product || source || madeBy);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-lg font-bold">
          <Trophy className="size-5 text-amber-500" /> Approvals
        </h2>
        {lanes.length > 1 ? (
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {lanes.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => {
                  setLane(l);
                  setProduct("");
                }}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-semibold transition-colors",
                  lane === l ? "bg-background shadow" : "text-muted-foreground"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        ) : null}
        <Button className="ml-auto" onClick={() => setEditing({ mode: "new", prefill: { product: lane === "IGV" ? "GV" : undefined } })}>
          <Plus className="size-4" /> Log an approval
        </Button>
      </div>

      {board ? <IcxApprovalsBoard data={board} mmPlanned={mmPlanned[lane] ?? null} /> : null}

      {/* THE SUBTOOL ALREADY KNOWS — claim what nobody logged yet */}
      {laneSuggestions.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60 py-0 dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="px-4 py-3">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              onClick={() => setShowSuggestions((v) => !v)}
            >
              <Sparkles className="size-4 shrink-0 text-amber-600" />
              <span className="flex-1 text-sm font-semibold">
                {laneSuggestions.length} approval{laneSuggestions.length === 1 ? "" : "s"} on the ECB
                SubTool nobody has logged yet
              </span>
              {showSuggestions ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The sheet knows the EP, the date and the LC — it can&apos;t know who made it. Log the
              ones that are yours (or your team&apos;s).
            </p>
            {showSuggestions ? (
              <ul className="mt-3 grid gap-2">
                {laneSuggestions.slice(0, 40).map((s) => (
                  <li
                    key={s.epOppId}
                    className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" dir="auto">
                        {s.epName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.epOppId} · approved {s.approvalDate}
                        {s.homeLc ? ` · from ${s.homeLc}` : ""}
                      </p>
                    </div>
                    {s.product ? (
                      <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", PRODUCT_TONE[s.product])}>
                        {s.product}
                      </span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() =>
                        setEditing({
                          mode: "new",
                          prefill: {
                            product: s.product ?? undefined,
                            epName: s.epName,
                            expaId: s.epOppId,
                            approvedOn: s.approvalDate,
                            partnerLcId: s.partnerLcId,
                            newLcName: s.partnerLcId ? null : s.homeLc,
                            fromSubtool: true,
                          },
                        })
                      }
                    >
                      Log it
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* THE LOG */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search EP, EXPA id, LC, opportunity…"
            className="h-9 pl-8"
          />
        </div>
        {lane === "IGT" ? (
          <FilterSelect
            value={product}
            onChange={setProduct}
            all="All programmes"
            options={[
              { value: "GTa", label: "GTa" },
              { value: "GTe", label: "GTe" },
            ]}
          />
        ) : null}
        <FilterSelect
          value={source}
          onChange={setSource}
          all="Any source"
          options={APPROVAL_SOURCES.map((s) => ({ value: s.value, label: s.label }))}
        />
        <FilterSelect
          value={madeBy}
          onChange={setMadeBy}
          all="Anyone"
          options={[
            { value: "__me", label: "🙋 Mine" },
            ...people.map(([id, name]) => ({ value: id, label: name })),
          ]}
        />
        {filtersOn ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setQ("");
              setProduct("");
              setSource("");
              setMadeBy("");
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {shown.length} of {laneRows.length} {lane} approval{laneRows.length === 1 ? "" : "s"}
      </p>

      {shown.length === 0 ? (
        <Card className="py-0">
          <CardContent className="px-4 py-10 text-center text-sm text-muted-foreground">
            {laneRows.length === 0
              ? "No approvals logged yet. Log the first one — or claim one the SubTool already knows about."
              : "Nothing matches these filters."}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* phones: cards */}
          <div className="grid gap-2 md:hidden">
            {shown.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setEditing({ mode: "edit", row: r })}
                className="grid cursor-pointer gap-1 rounded-lg border p-3 text-left transition hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", PRODUCT_TONE[r.product])}>
                    {r.product}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium" dir="auto">
                    {r.ep_name}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">{r.approved_on}</span>
                </div>
                <p className="break-words text-xs text-muted-foreground" dir="auto">
                  from {r.partner_lc_name ?? "—"}
                  {r.country ? `, ${r.country}` : ""} · {SOURCE_LABEL[r.source]}
                </p>
                <p className="text-xs">
                  🏆 <b>{r.made_by_name}</b>
                  {r.account_name || r.opportunity ? (
                    <span className="text-muted-foreground"> · {r.account_name ?? r.opportunity}</span>
                  ) : null}
                </p>
              </button>
            ))}
          </div>
          {/* desktop: the table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Approved</th>
                  <th className="px-3 py-2 font-medium">EP</th>
                  <th className="px-3 py-2 font-medium">Prog.</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">How</th>
                  <th className="px-3 py-2 font-medium">Opportunity</th>
                  <th className="px-3 py-2 font-medium">Made by</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t transition hover:bg-muted/40"
                    onClick={() => setEditing({ mode: "edit", row: r })}
                  >
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.approved_on}</td>
                    <td className="max-w-56 px-3 py-2">
                      <p className="truncate font-medium" dir="auto">
                        {r.ep_name}
                      </p>
                      {r.expa_id ? (
                        <p className="truncate font-mono text-[11px] text-muted-foreground">{r.expa_id}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", PRODUCT_TONE[r.product])}>
                        {r.product}
                      </span>
                    </td>
                    <td className="max-w-48 px-3 py-2">
                      <p className="truncate" dir="auto">
                        {r.partner_lc_name ?? "—"}
                      </p>
                      {r.country ? <p className="truncate text-[11px] text-muted-foreground">{r.country}</p> : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {SOURCE_LABEL[r.source]}
                      {r.from_subtool ? (
                        <Badge variant="outline" className="ml-1 text-[10px]" title="Claimed from the ECB SubTool">
                          SubTool
                        </Badge>
                      ) : null}
                    </td>
                    <td className="max-w-48 truncate px-3 py-2 text-xs" dir="auto">
                      {r.account_name ?? r.opportunity ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 font-medium" dir="auto">
                      {r.made_by_name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ApprovalDialog
        state={editing}
        onClose={() => setEditing(null)}
        lanes={lanes}
        creditTargets={creditTargets}
        lcs={lcs}
        options={options}
        viewerId={viewerId}
      />
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  all,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  all: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value || "__all"} onValueChange={(v) => onChange(v === "__all" ? "" : v)}>
      <SelectTrigger className="h-9 w-auto min-w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{all}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A search box over a long list, results inline underneath — inline on
 *  purpose: a floating list inside a scrolling dialog is how dropdowns end up
 *  under the dialog's own edge (the v33.39/40 lesson). */
function SearchPick({
  items,
  value,
  onChange,
  placeholder,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  const [q, setQ] = useState("");
  const picked = items.find((i) => i.id === value);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return items.filter((i) => i.label.toLowerCase().includes(n)).slice(0, 6);
  }, [items, q]);
  if (picked) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate" dir="auto">
          {picked.label}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onChange("")}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-9" />
      {matches.length > 0 ? (
        <ul className="max-h-40 overflow-y-auto rounded-md border">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="w-full truncate px-2 py-1.5 text-left text-sm hover:bg-muted"
                dir="auto"
                onClick={() => {
                  onChange(m.id);
                  setQ("");
                }}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim() ? (
        <p className="px-1 text-xs text-muted-foreground">Nothing matches.</p>
      ) : null}
    </div>
  );
}

function ApprovalDialog({
  state,
  onClose,
  lanes,
  creditTargets,
  lcs,
  options,
  viewerId,
}: {
  state:
    | { mode: "new"; prefill?: Partial<ApprovalInput> }
    | { mode: "edit"; row: IcxApprovalRow }
    | null;
  onClose: () => void;
  lanes: ApprovalFunction[];
  creditTargets: CreditTarget[];
  lcs: Lc[];
  options: ApprovalFormOptions;
  viewerId: string;
}) {
  // the form re-seeds whenever a different approval (or suggestion) is opened
  const seedKey =
    state == null ? "closed" : state.mode === "edit" ? state.row.id : `new:${state.prefill?.expaId ?? ""}`;
  return (
    <Dialog open={state != null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {state ? (
          <ApprovalForm
            key={seedKey}
            state={state}
            onClose={onClose}
            lanes={lanes}
            creditTargets={creditTargets}
            lcs={lcs}
            options={options}
            viewerId={viewerId}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ApprovalForm({
  state,
  onClose,
  lanes,
  creditTargets,
  lcs,
  options,
  viewerId,
}: {
  state: { mode: "new"; prefill?: Partial<ApprovalInput> } | { mode: "edit"; row: IcxApprovalRow };
  onClose: () => void;
  lanes: ApprovalFunction[];
  creditTargets: CreditTarget[];
  lcs: Lc[];
  options: ApprovalFormOptions;
  viewerId: string;
}) {
  const row = state.mode === "edit" ? state.row : null;
  const pre = state.mode === "new" ? (state.prefill ?? {}) : {};
  const readOnly = !!row && !row.canEdit;
  const [pending, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const allowedProducts: ApprovalProduct[] = (["GV", "GTa", "GTe"] as ApprovalProduct[]).filter((p) =>
    lanes.includes(functionOfProduct(p))
  );
  const [product, setProduct] = useState<ApprovalProduct | "">(
    row?.product ?? pre.product ?? (allowedProducts.length === 1 ? allowedProducts[0] : "")
  );
  const [epName, setEpName] = useState(row?.ep_name ?? pre.epName ?? "");
  const [expaId, setExpaId] = useState(row?.expa_id ?? pre.expaId ?? "");
  const [approvedOn, setApprovedOn] = useState(row?.approved_on ?? pre.approvedOn ?? cairoToday());
  const [lcId, setLcId] = useState(row?.partner_lc_id ?? pre.partnerLcId ?? "");
  const [newLc, setNewLc] = useState(pre.newLcName ?? "");
  const [addingLc, setAddingLc] = useState(!row && !pre.partnerLcId && !!pre.newLcName);
  const [country, setCountry] = useState(row?.country ?? "");
  const [source, setSource] = useState<ApprovalSource>(row?.source ?? pre.source ?? (pre.fromSubtool ? "expa" : "ir_call"));
  const [irCallId, setIrCallId] = useState(row?.ir_call_id ?? "");
  const [cvId, setCvId] = useState(row?.cv_id ?? "");
  const [accountId, setAccountId] = useState(row?.account_id ?? "");
  const [opportunity, setOpportunity] = useState(row?.opportunity ?? "");
  const [epEmail, setEpEmail] = useState(row?.ep_email ?? "");
  const [epPhone, setEpPhone] = useState(row?.ep_phone ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [madeBy, setMadeBy] = useState(row?.made_by ?? pre.madeBy ?? viewerId);

  // the credit picker: who the viewer may credit, plus the current person on
  // an edit even when the viewer could not have picked them
  const creditList = useMemo(() => {
    const list = [...creditTargets];
    if (row?.made_by && !list.some((t) => t.id === row.made_by)) {
      list.push({ id: row.made_by, name: row.made_by_name, role: "" });
    }
    return list;
  }, [creditTargets, row]);

  const pickedLc = lcs.find((l) => l.id === lcId);
  const lane = product ? functionOfProduct(product) : null;
  const accountItems = useMemo(
    () =>
      options.accounts
        .filter((a) => !lane || a.function === lane || a.function === "B2B" || a.function === "BD")
        .map((a) => ({ id: a.id, label: `${a.name} · ${a.function}` })),
    [options.accounts, lane]
  );

  const input = (): ApprovalInput => ({
    product: product as ApprovalProduct,
    epName,
    expaId: expaId || null,
    approvedOn,
    partnerLcId: addingLc ? null : lcId || null,
    newLcName: addingLc ? newLc : null,
    country: country || null,
    source,
    irCallId: source === "ir_call" ? irCallId || null : null,
    cvId: source === "cv_pool" ? cvId || null : null,
    accountId: accountId || null,
    opportunity: opportunity || null,
    epEmail: epEmail || null,
    epPhone: epPhone || null,
    notes: notes || null,
    madeBy,
    fromSubtool: row ? row.from_subtool : !!pre.fromSubtool,
  });

  const save = () =>
    start(async () => {
      if (!product) {
        toast.error("Pick the programme first.");
        return;
      }
      try {
        const r = row ? await updateIcxApproval(row.id, input()) : await logIcxApproval(input());
        if (r.ok) {
          toast.success(r.message);
          onClose();
        } else toast.error(r.error);
      } catch {
        toast.error("Could not save — try again.");
      }
    });

  const remove = () =>
    start(async () => {
      if (!row) return;
      try {
        const r = await deleteIcxApproval(row.id);
        if (r.ok) {
          toast.success(r.message);
          onClose();
        } else toast.error(r.error);
      } catch {
        toast.error("Could not delete — try again.");
      }
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {row ? (readOnly ? "Approval" : "Edit approval") : "🏆 Log an approval"}
        </DialogTitle>
        <DialogDescription>
          {row
            ? `Logged by ${row.logged_by_name ?? "—"} · counts for ${row.made_by_name}`
            : pre.fromSubtool
              ? "Prefilled from the ECB SubTool — say who made it, how it came and which opportunity."
              : "An EP approved on one of our opportunities — the ICX MOS."}
        </DialogDescription>
      </DialogHeader>

      <fieldset disabled={readOnly || pending} className="grid min-w-0 gap-3">
        <div className="grid gap-1.5">
          <Label>Programme</Label>
          <div className="flex flex-wrap gap-1.5">
            {allowedProducts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProduct(p)}
                className={cn(
                  "rounded-md border px-3 py-1 text-sm font-bold transition",
                  product === p ? cn(PRODUCT_TONE[p], "border-current") : "text-muted-foreground hover:bg-muted"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>Who made it</Label>
          {creditList.length > 1 ? (
            <Select value={madeBy} onValueChange={setMadeBy}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {creditList.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.id === viewerId ? `${t.name} (me)` : t.name}
                    {t.role && t.role !== "Member" ? ` · ${t.role}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">Counts for you.</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            It counts for this person — and for their Team Leader&apos;s total too.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label>EP name</Label>
            <Input dir="auto" value={epName} onChange={(e) => setEpName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label>EXPA id</Label>
            <Input
              value={expaId}
              onChange={(e) => setExpaId(e.target.value)}
              placeholder="EP ID_OPP ID, e.g. 6207212_1334682"
              className="font-mono"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label>Approved on</Label>
            <Input type="date" value={approvedOn} max={cairoToday()} onChange={(e) => setApprovedOn(e.target.value)} />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label>How it came</Label>
            <Select value={source} onValueChange={(v) => setSource(v as ApprovalSource)}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPROVAL_SOURCES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {source === "ir_call" ? (
          <div className="grid gap-1.5">
            <Label>The IR call (optional)</Label>
            <SearchPick
              items={options.irCalls.map((c) => ({ id: c.id, label: c.label }))}
              value={irCallId}
              onChange={(id) => {
                setIrCallId(id);
                // the call already says which LC — use it when none is picked
                const call = options.irCalls.find((c) => c.id === id);
                if (call?.lcId && !lcId && !addingLc) setLcId(call.lcId);
              }}
              placeholder="Search by LC, IR or date…"
            />
          </div>
        ) : source === "cv_pool" ? (
          <div className="grid gap-1.5">
            <Label>The CV (optional)</Label>
            <SearchPick
              items={options.cvs}
              value={cvId}
              onChange={setCvId}
              placeholder="Search the CV pool by name or LC…"
            />
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label>Sending LC — where they came from</Label>
          {addingLc ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                dir="auto"
                value={newLc}
                onChange={(e) => setNewLc(e.target.value)}
                placeholder="AIESEC in …"
                className="h-9 min-w-40 flex-1"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddingLc(false)}>
                Pick from the list
              </Button>
            </div>
          ) : (
            <Select
              value={lcId || ""}
              onValueChange={(v) => {
                if (v === "__new") {
                  setAddingLc(true);
                  setLcId("");
                } else setLcId(v);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Pick the LC…" />
              </SelectTrigger>
              <SelectContent>
                {lcs.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                    {l.country ? ` · ${l.country}` : ""}
                  </SelectItem>
                ))}
                <SelectItem value="__new">＋ An LC that isn&apos;t on the list…</SelectItem>
              </SelectContent>
            </Select>
          )}
          {addingLc || (pickedLc && !pickedLc.country) || (row && !row.partner_lc_id) ? (
            <CountryInput value={country} onChange={setCountry} placeholder="Country" className="h-9" />
          ) : null}
        </div>

        <div className="grid gap-1.5">
          <Label>Our opportunity</Label>
          <SearchPick
            items={accountItems}
            value={accountId}
            onChange={setAccountId}
            placeholder="Search our accounts (the company they were approved on)…"
          />
          <Input
            dir="auto"
            value={opportunity}
            onChange={(e) => setOpportunity(e.target.value)}
            placeholder="Opportunity title on EXPA (optional)"
            className="h-9"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label>EP email</Label>
            <Input type="email" value={epEmail} onChange={(e) => setEpEmail(e.target.value)} placeholder="optional" />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label>EP phone / WhatsApp</Label>
            <Input type="tel" value={epPhone} onChange={(e) => setEpPhone(e.target.value)} placeholder="+… (optional)" />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>Notes</Label>
          <Textarea dir="auto" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
        </div>
      </fieldset>

      <DialogFooter className="gap-2 sm:justify-between">
        {row && row.canEdit ? (
          confirmDelete ? (
            <div className="flex items-center gap-2 text-sm">
              Remove this approval?
              <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
                Yes, remove
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                No
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Remove
            </Button>
          )
        ) : (
          <span />
        )}
        {readOnly ? (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trophy className="size-4" />}
            {row ? "Save" : "Log it"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
