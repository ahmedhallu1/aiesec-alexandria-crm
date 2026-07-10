"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, Archive, CalendarClock, FileUp, Loader2, Phone, Plus, Search, X,
} from "lucide-react";
import type { PipelineRow } from "@/server/data";
import { productBadge, STAGES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StageBadge } from "./stage-badge";
import { ContactDialog, type ContactTarget } from "./contact-dialog";
import { AddAccountDialog, type MemberOption } from "./add-account-dialog";
import { Hint } from "./hint";
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
  /** members who only ever see their own accounts don't need a Responsible column */
  seesOthers: boolean;
}

function FnBadge({ row, className }: { row: PipelineRow; className?: string }) {
  const b = productBadge(row.function, row.product);
  return (
    <Badge className={cn("border-transparent text-[10px] font-bold", b.bg, b.text, className)}>
      {b.label}
    </Badge>
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
        {!archived ? (
          <FilterSelect
            value={filters.stage} placeholder="Stage"
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
              onClick={() => router.push(`/accounts/${row.id}`)}
            >
              <CardContent className="space-y-2 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{row.name}</p>
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
                  {!row.out_of_process && !row.slot_raised ? (
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
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {viewer.seesOthers ? (
                    <span>👤 {row.responsible_nickname || row.responsible_name}</span>
                  ) : null}
                  <span>📞 {row.attempts} contact{row.attempts === 1 ? "" : "s"}</span>
                  {archived ? (
                    <span className="text-destructive">🗄️ {row.oop_reason ?? "archived"}</span>
                  ) : (
                    <>
                      {row.next_step_date ? <span>⏭️ {row.next_step_date}</span> : null}
                      {row.visit_date ? (
                        <span>🗓️ {row.visit_date}{row.visit_done === true ? " ✓" : ""}</span>
                      ) : null}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block rise-in rise-in-2">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                {viewer.seesOthers ? <TableHead>Responsible</TableHead> : null}
                <TableHead>Stage</TableHead>
                <TableHead className="text-center">Contacts</TableHead>
                {archived ? (
                  <TableHead>Reason</TableHead>
                ) : (
                  <>
                    <TableHead>Next step</TableHead>
                    <TableHead>Visit</TableHead>
                  </>
                )}
                <TableHead></TableHead>
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
                    onClick={() => router.push(`/accounts/${row.id}`)}
                  >
                    <TableCell>
                      <Link
                        href={`/accounts/${row.id}`}
                        className="font-medium hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.name}
                      </Link>
                      <FnBadge row={row} className="ml-2" />
                    </TableCell>
                    {viewer.seesOthers ? (
                      <TableCell className="text-sm">
                        {row.responsible_nickname || row.responsible_name}
                      </TableCell>
                    ) : null}
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
                      <>
                        <TableCell className="text-sm">
                          {row.next_step_missing ? (
                            <Badge variant="destructive" className="font-normal">missing</Badge>
                          ) : row.next_step_date ? (
                            <span className="text-muted-foreground">{row.next_step_date}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.visit_date ? (
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock className="size-3.5" />
                              {row.visit_date}
                              {row.visit_done === true ? " ✓" : ""}
                            </span>
                          ) : "—"}
                        </TableCell>
                      </>
                    )}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {!row.out_of_process && !row.slot_raised ? (
                        <Hint label="Log a call / WhatsApp / email attempt on this account">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setContactTarget(contactFor(row))}
                          >
                            <Phone className="size-3.5" /> Contact
                          </Button>
                        </Hint>
                      ) : null}
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
