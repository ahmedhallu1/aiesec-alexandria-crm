"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, Archive, CircleAlert, FileUp, Loader2, Phone, Plus, Search, X,
} from "lucide-react";
import type { PipelineRow } from "@/server/data";
import { accountSlug, IGV_PROJECTS, productBadge, STAGES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StageBadge } from "./stage-badge";
import { ContactDialog, type ContactTarget } from "./contact-dialog";
import { AddAccountDialog, type MemberOption } from "./add-account-dialog";
import { Hint } from "./hint";
import { QuickActions } from "./quick-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface ViewerInfo {
  id: string;
  role: string;
  isAdmin: boolean;
  canAssignOthers: boolean;
  canViewArchive: boolean;
  allowedFns: ("IGV" | "IGT")[];
  showFnFilter: boolean;
  seesOthers: boolean;
}

function FnBadge({ row, className }: { row: PipelineRow; className?: string }) {
  const b = productBadge(row.function, row.product);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Badge className={cn("border-transparent text-[10px] font-bold", b.bg, b.text)}>
        {b.label}
      </Badge>
      {row.function === "IGV" && row.project ? (
        <span className="text-xs text-muted-foreground">{row.project}</span>
      ) : null}
    </span>
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

export function AccountsView({
  rows, members, viewer, filters,
}: {
  rows: PipelineRow[];
  members: MemberOption[];
  viewer: ViewerInfo;
  filters: Record<string, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [contactTarget, setContactTarget] = useState<ContactTarget | null>(null);
  const [addOpen, setAddOpen] = useState(false);
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
  const anyFilter = Object.values(filters).some(Boolean);
  const stageOptions = STAGES.filter((s) => s !== "Out of Process");
  const today = new Date().toISOString().slice(0, 10);

  const hrefFor = (row: PipelineRow) => `/accounts/${accountSlug(row.name)}`;
  const contactFor = (row: PipelineRow): ContactTarget => ({
    id: row.id,
    name: row.name,
    hasPendingVisit: !!row.visit_id && row.visit_done === null,
    nextStepDate: row.next_step_date,
  });

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
              ? `${rows.length} out-of-process account${rows.length === 1 ? "" : "s"} — names here can never be re-added`
              : `${rows.length} account${rows.length === 1 ? "" : "s"} in your scope`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          {!archived ? (
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
          ) : null}
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
        {filters.fn !== "IGV" && viewer.allowedFns.includes("IGT") ? (
          <FilterSelect
            value={filters.product} placeholder="Product"
            onChange={(v) => setParam("product", v)}
            options={[["GTa", "IGTa"], ["GTe", "IGTe"]]}
          />
        ) : null}
        {filters.fn !== "IGT" && viewer.allowedFns.includes("IGV") ? (
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
        {viewer.seesOthers && members.length > 1 ? (
          <FilterSelect
            value={filters.resp} placeholder="Responsible"
            onChange={(v) => setParam("resp", v)}
            options={members.map((m) => [m.id, m.label])}
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
          <span className="text-xs font-medium text-muted-foreground">Added</span>
          <Input
            type="date"
            max={today}
            className="h-7 w-[7.9rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label="Added from"
            value={filters.from}
            onChange={(e) => setParam("from", e.target.value)}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            max={today}
            className="h-7 w-[7.9rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
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

      {/* Mobile: cards */}
      <div className="space-y-2.5 md:hidden">
        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {archived ? "The archive is empty." : "No accounts here yet. Add your first one 🚀"}
            </CardContent>
          </Card>
        ) : (
          rows.map((row, i) => (
            <Card
              key={row.id}
              className={cn("rise-in", i < 4 && `rise-in-${i + 1}`)}
              onClick={() => router.push(hrefFor(row))}
            >
              <CardContent className="space-y-2 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate font-semibold">
                      {row.name} <PinSign text={row.pinned_comment} />
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <FnBadge row={row} />
                      <StageBadge stage={row.stage} className="text-[10px]" />
                      {row.contact_limit_reached ? (
                        <Badge className="border-transparent bg-warning/15 text-[10px] text-warning">⚠️ 3 contacts</Badge>
                      ) : null}
                      {row.next_step_missing ? (
                        <Badge variant="destructive" className="text-[10px]">🚨 no next step</Badge>
                      ) : null}
                    </div>
                  </div>
                  {!row.out_of_process ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={(e) => { e.stopPropagation(); setContactTarget(contactFor(row)); }}
                    >
                      <Phone className="size-3.5" /> Contact
                    </Button>
                  ) : null}
                </div>
                {row.pinned_comment ? (
                  <p className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                    ❗ {row.pinned_comment}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>🗓️ {row.created_at?.slice(0, 10)}</span>
                  <span>📞 {row.attempts} contact{row.attempts === 1 ? "" : "s"}</span>
                  {archived ? (
                    <span className="text-destructive">🗄️ {row.oop_reason ?? "archived"}</span>
                  ) : row.next_step_date ? (
                    <span>⏭️ {row.next_step_date}</span>
                  ) : null}
                </div>
                {!archived ? <QuickActions contacts={row.contacts} max={6} /> : null}
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
                <TableHead>Date added</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Contacts</TableHead>
                {archived ? <TableHead>Reason</TableHead> : <TableHead>Next step</TableHead>}
                <TableHead>{archived ? "" : "Quick actions"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    {archived ? "The archive is empty." : "No accounts here yet. Add your first one 🚀"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => router.push(hrefFor(row))}
                  >
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {row.created_at?.slice(0, 10)}
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
                      </span>
                      {viewer.seesOthers ? (
                        <p className="text-xs text-muted-foreground">
                          {row.responsible_nickname || row.responsible_name}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell><FnBadge row={row} /></TableCell>
                    <TableCell><StageBadge stage={row.stage} /></TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1">
                        {row.attempts}
                        {row.contact_limit_reached ? (
                          <AlertTriangle className="size-3.5 text-warning" />
                        ) : null}
                      </span>
                    </TableCell>
                    {archived ? (
                      <TableCell className="max-w-56 truncate text-sm text-muted-foreground">
                        {row.oop_reason ?? "—"}
                      </TableCell>
                    ) : (
                      <TableCell className="max-w-44 text-sm">
                        {row.next_step_missing ? (
                          <Badge variant="destructive" className="font-normal">missing</Badge>
                        ) : row.next_step_date ? (
                          <span className="text-muted-foreground">
                            {row.next_step_date}
                            {row.next_step ? ` · ${row.next_step.slice(0, 24)}` : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        {!archived ? <QuickActions contacts={row.contacts} /> : null}
                        {!row.out_of_process ? (
                          <Hint label="Log a call / WhatsApp / email attempt on this account">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setContactTarget(contactFor(row))}
                            >
                              <Phone className="size-3.5" /> Log
                            </Button>
                          </Hint>
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
    </div>
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
