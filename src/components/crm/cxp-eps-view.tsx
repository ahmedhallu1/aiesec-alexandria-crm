"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { CxpEpSummary, CxpSide } from "@/lib/cxp/types";
import { CXP_STAGE_KEYS, STAGE_BY_KEY } from "@/lib/cxp/types";
import { ExportButton } from "./export-button";

/**
 * THE EP SUBMISSIONS TABLE.
 *
 * EVERY COLUMN CARRIES ITS OWN FILTER, in its own header, next to its own sort
 * control — the same funnel the members directory uses. An earlier version put
 * three fixed dropdowns in a toolbar strip above a nine-column table, which
 * gave no way to tell which control belonged to which column and left most
 * columns unfilterable.
 *
 * Options are derived from the rows on screen, so a filter never offers a value
 * that would return nothing.
 *
 * CURRENT MONTH BY DEFAULT; last month's INCOMPLETE rows are a button, not part
 * of the list — the old system's logic, kept, just no longer mixed in.
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

/** The value a row presents to a given column's filter. */
export function epFilterValue(r: CxpEpSummary, colKey: string): string {
  switch (colKey) {
    case "ep":
      return r.epName || "—";
    case "id":
      return r.epOppId;
    case "function":
      return r.function;
    case "product":
      return r.product || "—";
    case "stage":
      return r.stageKey;
    case "status":
      return r.status || "—";
    case "docs":
      return r.missingCount === 0 ? "complete" : "incomplete";
    case "dates":
      // by MONTH: a filter offering 76 distinct start dates is a list, not a
      // filter — the month is the grouping anyone actually wants
      return r.startDate ? r.startDate.slice(0, 7) : "—";
    case "comment":
      return r.comment ? "has" : "none";
    default:
      return "";
  }
}

/** How an option is labelled, where it differs from the raw value. */
function optionLabel(colKey: string, value: string): string {
  if (colKey === "stage") return STAGE_BY_KEY[value as keyof typeof STAGE_BY_KEY] ?? value;
  if (colKey === "docs") return value === "complete" ? "Complete" : "Incomplete";
  if (colKey === "comment") return value === "has" ? "Has a comment" : "No comment";
  return value;
}

/** Copy some text to the clipboard, with a toast and a brief checkmark.
 *  `navigator.clipboard` needs a secure context, which the deployed app always
 *  is — but a courteous try/catch beats a dead button on an odd browser. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (value: string, label: string) => async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      toast.success(`Copied ${label}.`);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 1200);
    } catch {
      toast.error("Could not copy — your browser blocked clipboard access.");
    }
  };
  return { copied, copy };
}

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
  const router = useRouter();
  // opening an EP is a navigation — show that the click landed (house rule,
  // pinned by tests/nav-pending.test.ts)
  const [navPending, startNav] = useTransition();
  const [q, setQ] = useState(search);
  const [colFilter, setColFilter] = useState<Record<string, string>>({});
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const cols = useTableColumns(`cxp-eps:${side ?? "all"}`, COLUMNS);

  /** Options per column, built from the rows themselves. */
  const options = useMemo(() => {
    const out: Record<string, { value: string; label: string }[]> = {};
    for (const c of COLUMNS) {
      const seen = new Set<string>();
      for (const r of rows) {
        const v = epFilterValue(r, c.key);
        if (v) seen.add(v);
      }
      out[c.key] = [...seen]
        .sort((a, b) =>
          c.key === "stage"
            ? CXP_STAGE_KEYS.indexOf(a as never) - CXP_STAGE_KEYS.indexOf(b as never)
            : a.localeCompare(b, undefined, { numeric: true })
        )
        .map((v) => ({ value: v, label: optionLabel(c.key, v) }));
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      for (const [colKey, raw] of Object.entries(colFilter)) {
        const picked = multi(raw);
        if (picked.length && !picked.includes(epFilterValue(r, colKey))) return false;
      }
      if (needle) {
        const hay = `${r.epName} ${r.epOppId} ${r.product} ${r.comment ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, colFilter, q]);

  const { sorted, sortKey, dir, toggle } = useTableSort(filtered, SORTERS);
  const page = sorted.slice(0, pageSize);
  const anyFilter = Object.values(colFilter).some(Boolean) || q.trim() !== "";

  const setCol = (key: string) => (v: string) =>
    setColFilter((prev) => ({ ...prev, [key]: v }));

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

  const epHref = (r: CxpEpSummary) => `/cxp/ep/${encodeURIComponent(r.epOppId)}`;
  const openEp = (r: CxpEpSummary) => startNav(() => router.push(epHref(r)));
  const { copied, copy } = useCopy();

  return (
    <div className="grid gap-4">
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

      {/* title on the left, the month toggle on the top RIGHT — it was
          previously buried between the title and the search box, which read
          as an odd place for the single most-clicked control on the page */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {scope === "previous" ? "Last month — still incomplete" : "This month's submissions"}
          </h2>
          <p className="text-xs text-muted-foreground">{monthLabel}</p>
        </div>

        <ExportButton kind="cxp" params={{ side, scope, q: search }} />
        <Link
          prefetch={false}
          href={href({ scope: scope === "previous" ? "current" : "previous" })}
          scroll={false}
        >
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
      </div>

      {/* search on the LEFT; everything else that acts on the visible set
          (count, clear, columns, page size) grouped on the right */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search EP or ID…"
          className="h-8 w-full max-w-56 text-sm"
        />
        {anyFilter ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setColFilter({});
              setQ("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {rows.length} EP(s)
        </span>
        <div className="ml-auto flex items-center gap-2">
          <PageSizePicker value={pageSize} options={PAGE_SIZES} onChange={setPageSize} />
          <TableSettings columns={cols} />
        </div>
      </div>

      <div className={cn("overflow-x-auto rounded-lg border", navPending && "nav-pending")}>
        <Table>
          <TableHeader>
            <TableRow>
              {cols.visible.map((c) => (
                <TableHead key={c.key}>
                  {/* sort AND filter, per column, side by side */}
                  <div className="flex items-center gap-1">
                    <SortHeader
                      label={c.label}
                      active={sortKey === c.key}
                      dir={sortKey === c.key ? dir : null}
                      onClick={() => toggle(c.key)}
                    />
                    {(options[c.key]?.length ?? 0) > 1 ? (
                      <ColumnFilter
                        label={c.label}
                        value={colFilter[c.key] ?? ""}
                        options={options[c.key]}
                        onChange={setCol(c.key)}
                        allLabel={`All ${c.label.toLowerCase()}`}
                      />
                    ) : null}
                  </div>
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
                // THE WHOLE ROW OPENS THE EP — not just the name. The name
                // stays a real <a> too, so ctrl/middle-click opens a new tab
                // and the row is still reachable by keyboard.
                <TableRow
                  key={`${r.epOppId}|${r.function}|${r.stageKey}`}
                  onClick={() => openEp(r)}
                  className="cursor-pointer"
                >
                  {cols.visible.map((c) => (
                    <TableCell key={c.key}>
                      {cell(r, c.key, epHref(r), copy, copied)}
                    </TableCell>
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

type CopyFn = (value: string, label: string) => (e: React.MouseEvent) => Promise<void>;

function cell(
  r: CxpEpSummary,
  key: string,
  href: string,
  copy: CopyFn,
  copied: string | null
): React.ReactNode {
  switch (key) {
    case "ep":
      return (
        <div className="flex items-center gap-1">
          <Link
            prefetch={false}
            href={href}
            className="font-medium hover:underline"
            // the row handler already navigates — don't do it twice
            onClick={(e) => e.stopPropagation()}
          >
            {r.epName || "—"}
          </Link>
          {r.epName ? (
            <button
              type="button"
              onClick={copy(r.epName, "EP name")}
              title="Copy name"
              className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
            >
              {copied === r.epName ? (
                <Check className="h-3 w-3 text-emerald-600" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          ) : null}
          {r.needsReview ? (
            <Badge variant="outline" className="text-[10px]">
              needs review
            </Badge>
          ) : null}
        </div>
      );
    case "id":
      // CLICK TO COPY — the whole cell is the control, since the ID is
      // otherwise never typed anywhere, only pasted
      return (
        <button
          type="button"
          onClick={copy(r.epOppId, "EP/OPP ID")}
          title="Click to copy"
          className="inline-flex items-center gap-1 rounded px-1 -mx-1 font-mono text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {r.epOppId}
          {copied === r.epOppId ? (
            <Check className="h-3 w-3 text-emerald-600" />
          ) : (
            <Copy className="h-3 w-3 opacity-50" />
          )}
        </button>
      );
    case "function":
      return <Badge variant="secondary">{r.function}</Badge>;
    case "product":
      return r.product || "—";
    case "stage":
      return <span className="text-sm">{r.stage}</span>;
    case "status":
      // CLAMPED: an un-clamped EXPA status string was one of the two things
      // making some rows towering boxes next to barely-there empty ones
      return (
        <span
          className="line-clamp-2 max-w-48 text-sm text-muted-foreground"
          title={r.status || undefined}
        >
          {r.status || "—"}
        </span>
      );
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
      // THE OTHER SOURCE OF UNEVEN ROWS: the ECB's comment is free text and
      // some run to several sentences. It is the single most actionable cell
      // here — it says what to CORRECT — so it stays visible, just clamped
      // to two lines with the full text on hover/title instead of stretching
      // the row to fit.
      return r.comment ? (
        <span
          className="line-clamp-2 max-w-64 text-xs text-amber-700 dark:text-amber-400"
          title={r.comment}
        >
          {r.comment}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      );
    default:
      return null;
  }
}
