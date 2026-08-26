"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ColumnFilter,
  multi,
  PageSizePicker,
  SortHeader,
  TableSettings,
  useTableColumns,
  useTableSort,
  type TableColumn,
} from "./data-table-kit";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@/lib/page-size";
import type { CxpEpSummary, CxpFunction, CxpSide } from "@/lib/cxp/types";
import { CXP_STAGE_KEYS, SIDE_FUNCTIONS, STAGE_BY_KEY } from "@/lib/cxp/types";

/**
 * THE EP SUBMISSIONS TABLE.
 *
 * Two things the product owner asked for, and one thing the old app got wrong:
 *
 *   1. EVERY COLUMN FILTERS AND SORTS. It came from Google Sheets, where that
 *      is free; the standalone app had a function tab and nothing else, so
 *      finding "the realized IGT EPs still missing a passport" meant reading
 *      the whole page. Sodio's table kit gives it for real.
 *
 *   2. CURRENT MONTH BY DEFAULT. Last month's INCOMPLETE rows are a button,
 *      not part of the list — the old logic, kept, just no longer mixed in.
 *      The count rides on the button so nobody clicks into an empty view.
 *
 * The side sections (ICX / OGX) only appear for someone who reads both. For
 * everyone else there is nothing to switch between and the tabs would be a
 * control with one option.
 */

const COLUMNS: TableColumn[] = [
  { key: "ep", label: "EP", required: true },
  { key: "id", label: "EP/OPP ID" },
  { key: "function", label: "Function" },
  { key: "product", label: "Product" },
  { key: "stage", label: "Stage" },
  { key: "status", label: "EXPA status" },
  { key: "docs", label: "Documents" },
  { key: "dates", label: "Dates", defaultHidden: true },
  { key: "comment", label: "ECB comment" },
];

const SORTERS = {
  ep: (r: CxpEpSummary) => r.epName,
  id: (r: CxpEpSummary) => r.epOppId,
  function: (r: CxpEpSummary) => r.function,
  product: (r: CxpEpSummary) => r.product,
  stage: (r: CxpEpSummary) => CXP_STAGE_KEYS.indexOf(r.stageKey),
  status: (r: CxpEpSummary) => r.status,
  // sorting by "documents" means sorting by what is OUTSTANDING — the number
  // anyone opening this table is actually looking for
  docs: (r: CxpEpSummary) => r.missingCount,
  dates: (r: CxpEpSummary) => r.startDate ?? "",
  comment: (r: CxpEpSummary) => r.comment ?? "",
};

export function CxpEpsView({
  rows,
  sides,
  side,
  scope,
  month,
  previousIncompleteCount,
  search,
}: {
  rows: CxpEpSummary[];
  sides: CxpSide[];
  side: CxpSide | null;
  scope: "current" | "previous";
  month: string;
  previousIncompleteCount: number;
  search: string;
}) {
  const [q, setQ] = useState(search);
  const [fnFilter, setFnFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [docsFilter, setDocsFilter] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const cols = useTableColumns(`cxp-eps:${side ?? "all"}`, COLUMNS);

  const filtered = useMemo(() => {
    const fns = multi(fnFilter);
    const stages = multi(stageFilter);
    const docs = multi(docsFilter);
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fns.length && !fns.includes(r.function)) return false;
      if (stages.length && !stages.includes(r.stageKey)) return false;
      if (docs.length) {
        const state = r.missingCount === 0 ? "complete" : "incomplete";
        if (!docs.includes(state)) return false;
      }
      if (needle) {
        const hay = `${r.epName} ${r.epOppId} ${r.product} ${r.comment ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, fnFilter, stageFilter, docsFilter, q]);

  const { sorted, sortKey, dir, toggle } = useTableSort(filtered, SORTERS);
  const page = sorted.slice(0, pageSize);

  const fnOptions = (side ? SIDE_FUNCTIONS[side] : (["IGV", "IGT", "OGV", "OGT"] as CxpFunction[]))
    .map((f) => ({ value: f, label: f }));

  const monthLabel = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const href = (next: Partial<{ side: string; scope: string }>) => {
    const p = new URLSearchParams();
    if (next.side ?? side) p.set("side", (next.side ?? side)!);
    const s = next.scope ?? scope;
    if (s === "previous") p.set("scope", "previous");
    const qs = p.toString();
    return qs ? `/cxp?${qs}` : "/cxp";
  };

  return (
    <div className="grid gap-4">
      {/* the two sides, for whoever reads both */}
      {sides.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          {sides.map((s) => (
            <Link prefetch={false} key={s} href={href({ side: s })} scroll={false}>
              <Button variant={s === side ? "default" : "outline"} size="sm">
                {s === "ICX" ? "ICX — incoming" : "OGX — outgoing"}
              </Button>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {scope === "previous" ? "Last month — still incomplete" : "This month's submissions"}
          </h2>
          <p className="text-xs text-muted-foreground">{monthLabel}</p>
        </div>

        {/* THE MONTH TOGGLE — the old past-month view, behind a button */}
        <Link prefetch={false} href={href({ scope: scope === "previous" ? "current" : "previous" })} scroll={false}>
          <Button variant="outline" size="sm">
            {scope === "previous" ? (
              "← Back to this month"
            ) : (
              <>
                Last month&apos;s incomplete
                {previousIncompleteCount > 0 ? (
                  <Badge variant="secondary" className="ml-2">
                    {previousIncompleteCount}
                  </Badge>
                ) : null}
              </>
            )}
          </Button>
        </Link>

        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search EP or ID…"
          className="h-8 w-full max-w-56 text-sm sm:ml-auto"
        />
        <TableSettings columns={cols} />
      </div>

      {/* per-column filters, in the toolbar so they never scroll away */}
      <div className="flex flex-wrap items-center gap-2">
        <ColumnFilter
          label="Function"
          value={fnFilter}
          onChange={setFnFilter}
          options={fnOptions}
        />
        <ColumnFilter
          label="Stage"
          value={stageFilter}
          onChange={setStageFilter}
          options={CXP_STAGE_KEYS.map((k) => ({ value: k, label: STAGE_BY_KEY[k] }))}
        />
        <ColumnFilter
          label="Documents"
          value={docsFilter}
          onChange={setDocsFilter}
          options={[
            { value: "incomplete", label: "Incomplete" },
            { value: "complete", label: "Complete" },
          ]}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {rows.length} EP(s)
        </span>
        <PageSizePicker value={pageSize} options={PAGE_SIZES} onChange={setPageSize} />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.visible.map((c) => (
                <TableHead key={c.key}>
                  <SortHeader
                    label={c.label}
                    active={sortKey === c.key}
                    dir={sortKey === c.key ? dir : null}
                    onClick={() => toggle(c.key)}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={cols.visible.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {scope === "previous"
                    ? "Nothing left over from last month. 🎉"
                    : "No submissions match these filters."}
                </TableCell>
              </TableRow>
            ) : (
              page.map((r) => (
                <TableRow key={`${r.epOppId}|${r.function}|${r.stageKey}`}>
                  {cols.visible.map((c) => (
                    <TableCell key={c.key}>{cell(r, c.key)}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function cell(r: CxpEpSummary, key: string): React.ReactNode {
  switch (key) {
    case "ep":
      return (
        <Link prefetch={false}
          href={`/cxp/ep/${encodeURIComponent(r.epOppId)}`}
          className="font-medium hover:underline"
        >
          {r.epName || "—"}
          {r.needsReview ? (
            <Badge variant="outline" className="ml-2 text-[10px]">
              needs review
            </Badge>
          ) : null}
        </Link>
      );
    case "id":
      return <span className="text-xs text-muted-foreground">{r.epOppId}</span>;
    case "function":
      return <Badge variant="secondary">{r.function}</Badge>;
    case "product":
      return r.product || "—";
    case "stage":
      return <span className="text-sm">{r.stage}</span>;
    case "status":
      return <span className="text-sm text-muted-foreground">{r.status || "—"}</span>;
    case "docs":
      return (
        <span
          className={
            r.missingCount === 0 ? "text-sm font-medium text-emerald-600" : "text-sm font-medium"
          }
        >
          {r.uploadedCount}/{r.totalCount}
          {r.missingCount > 0 ? (
            <span className="ml-1 text-muted-foreground">({r.missingCount} missing)</span>
          ) : null}
        </span>
      );
    case "dates":
      return (
        <span className="text-xs text-muted-foreground">
          {r.startDate ?? "—"} → {r.endDate ?? "—"}
        </span>
      );
    case "comment":
      // the ECB's own note is the single most actionable cell here: it says
      // what to CORRECT, not just what is absent
      return r.comment ? (
        <span className="text-xs text-amber-700 dark:text-amber-400">{r.comment}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      );
    default:
      return null;
  }
}
