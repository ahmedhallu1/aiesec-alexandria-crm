"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarClock, Phone, Plus, Search, X } from "lucide-react";
import type { PipelineRow } from "@/server/data";
import { IGV_PROJECTS, STAGES } from "@/lib/types";
import { StageBadge } from "./stage-badge";
import { ContactDialog, type ContactTarget } from "./contact-dialog";
import { AddAccountDialog, type MemberOption } from "./add-account-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  function: string | null;
  canAssignOthers: boolean;
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
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.replace(`/accounts?${params.toString()}`);
    },
    [router, searchParams]
  );

  useEffect(() => {
    if (q === filters.q) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setParam("q", q), 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, filters.q, setParam]);

  const masterView = viewer.isAdmin || viewer.role === "LCP";
  const showFnFilter = masterView;
  const activeFn = filters.fn || (masterView ? "" : viewer.function ?? "");
  const anyFilter = Object.values(filters).some(Boolean);

  const fixedFn: "IGV" | "IGT" | null =
    !masterView && (viewer.function === "IGV" || viewer.function === "IGT")
      ? viewer.function
      : null;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} account{rows.length === 1 ? "" : "s"} in your scope
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add account
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search accounts…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {showFnFilter ? (
          <FilterSelect
            value={filters.fn} placeholder="Function"
            onChange={(v) => setParam("fn", v)}
            options={[["IGV", "IGV"], ["IGT", "IGT"]]}
          />
        ) : null}
        {activeFn !== "IGT" ? (
          <FilterSelect
            value={filters.project} placeholder="Project"
            onChange={(v) => setParam("project", v)}
            options={IGV_PROJECTS.map((p) => [p, p])}
          />
        ) : null}
        {activeFn !== "IGV" ? (
          <FilterSelect
            value={filters.product} placeholder="Product"
            onChange={(v) => setParam("product", v)}
            options={[["GTa", "GTa"], ["GTe", "GTe"]]}
          />
        ) : null}
        <FilterSelect
          value={filters.stage} placeholder="Stage"
          onChange={(v) => setParam("stage", v)}
          options={STAGES.map((s) => [s, s])}
        />
        {members.length > 1 ? (
          <FilterSelect
            value={filters.resp} placeholder="Responsible"
            onChange={(v) => setParam("resp", v)}
            options={members.map((m) => [m.id, m.label])}
          />
        ) : null}
        <FilterSelect
          value={filters.flag} placeholder="Flags"
          onChange={(v) => setParam("flag", v)}
          options={[
            ["contact_limit", "⚠️ 3-contact limit"],
            ["next_step_missing", "🚨 No next step"],
          ]}
        />
        {anyFilter ? (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); router.replace("/accounts"); }}>
            <X className="size-4" /> Clear
          </Button>
        ) : null}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Project / Product</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-center">Contacts</TableHead>
                <TableHead>Next step</TableHead>
                <TableHead>Visit</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    No accounts here yet. Add your first one 🚀
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
                      <span className="ml-2 text-xs text-muted-foreground">{row.function}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.function === "IGV" ? row.project : `${row.product ?? ""}${row.sub_product ? ` · ${row.sub_product}` : ""}`}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.responsible_nickname || row.responsible_name}
                    </TableCell>
                    <TableCell><StageBadge stage={row.stage} /></TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1">
                        {row.attempts}
                        {row.contact_limit_reached ? (
                          <AlertTriangle className="size-3.5 text-warning" />
                        ) : null}
                      </span>
                    </TableCell>
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
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {!row.out_of_process && !row.slot_raised ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setContactTarget({
                              id: row.id,
                              name: row.name,
                              hasPendingVisit: !!row.visit_id && row.visit_done === null,
                              nextStepDate: row.next_step_date,
                            })
                          }
                        >
                          <Phone className="size-3.5" /> Contact
                        </Button>
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
        viewer={{ ...viewer, fixedFn }}
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
      <SelectTrigger className="w-auto min-w-32">
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
