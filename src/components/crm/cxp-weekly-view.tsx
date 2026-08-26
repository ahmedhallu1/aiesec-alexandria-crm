"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  SortHeader,
  TableSettings,
  useTableColumns,
  useTableSort,
  type TableColumn,
} from "./data-table-kit";
import { cn } from "@/lib/utils";
import type { WeeklyEp, WeeklyItem, WeeklySummary } from "@/lib/cxp/weekly";
import type { CxpSide, CxpWeeklyDeadline } from "@/lib/cxp/types";

/**
 * THE WEEKLY BOARD.
 *
 * THE BUG THIS REPLACES: the old board rendered week chips and let you click
 * them, and nothing changed — `deadline` reached the POST query string and two
 * cache keys, and never the data. The numbers came from a server component
 * that took no searchParams and called a selector with no deadline parameter.
 * The per-week filter had never been written.
 *
 * Here the chip is a LINK. It puts `?deadline=` in the URL, the page reads it,
 * and the server selects for that week — so a click changes the page, and the
 * URL you land on is the week you can share.
 *
 * The past chips are also no longer grey-on-grey: the product owner counted
 * five weeks on a board that always renders six, because two of them read as
 * decoration.
 */

const COLUMNS: TableColumn[] = [
  { key: "ep", label: "EP", required: true },
  { key: "requirement", label: "Document" },
  { key: "stage", label: "Stage" },
  { key: "due", label: "Due" },
  { key: "bucket", label: "State" },
];

const SORTERS = {
  ep: (i: WeeklyItem) => i.epName,
  requirement: (i: WeeklyItem) => i.requirementName,
  stage: (i: WeeklyItem) => i.stageKey,
  // undated items sort last, which is where "always owed" belongs in a list
  // that is about this week
  due: (i: WeeklyItem) => i.dueDate ?? "",
  bucket: (i: WeeklyItem) => ["overdue", "current", "ongoing"].indexOf(i.bucket),
};

const BUCKET_LABEL: Record<WeeklyItem["bucket"], string> = {
  current: "Due this week",
  overdue: "Overdue",
  ongoing: "Always owed",
  upcoming: "Upcoming",
};

export function CxpWeeklyView({
  deadlines,
  selected,
  isPast,
  summaries,
  eps,
  side,
  sides,
}: {
  deadlines: CxpWeeklyDeadline[];
  selected: string;
  isPast: boolean;
  summaries: WeeklySummary[];
  eps: Record<string, WeeklyEp[]>;
  side: CxpSide | null;
  sides: CxpSide[];
}) {
  const [fnFilter, setFnFilter] = useState("");
  const [bucketFilter, setBucketFilter] = useState("");
  const cols = useTableColumns("cxp-weekly", COLUMNS);

  const allItems = useMemo(
    () => Object.values(eps).flatMap((list) => list.flatMap((e) => e.items)),
    [eps]
  );

  const filtered = useMemo(() => {
    const fns = multi(fnFilter);
    const buckets = multi(bucketFilter);
    return allItems.filter((i) => {
      if (fns.length && !fns.includes(i.function)) return false;
      if (buckets.length && !buckets.includes(i.bucket)) return false;
      return true;
    });
  }, [allItems, fnFilter, bucketFilter]);

  const { sorted, sortKey, dir, toggle } = useTableSort(filtered, SORTERS);

  const chipHref = (date: string) => {
    const p = new URLSearchParams();
    if (side) p.set("side", side);
    p.set("deadline", date);
    return `/cxp/weekly?${p.toString()}`;
  };

  const sideHref = (s: CxpSide) => {
    const p = new URLSearchParams({ side: s, deadline: selected });
    return `/cxp/weekly?${p.toString()}`;
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-4">
      {sides.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {sides.map((s) => (
            <Link prefetch={false}
              key={s}
              href={sideHref(s)}
              scroll={false}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                s === side
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              )}
            >
              {s === "ICX" ? "ICX — incoming" : "OGX — outgoing"}
            </Link>
          ))}
        </div>
      ) : null}

      {/* THE WEEK SELECTOR — six real links, not six decorations */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          ECB deadline
        </p>
        <div className="flex flex-wrap gap-2">
          {deadlines.map((d) => {
            const past = d.date < today;
            const active = d.date === selected;
            return (
              <Link prefetch={false}
                key={d.date}
                href={chipHref(d.date)}
                scroll={false}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition hover:-translate-y-0.5",
                  active && "border-primary bg-primary text-primary-foreground shadow-sm",
                  // past weeks are REVIEWABLE, not decorative: readable
                  // contrast in both themes, and a dashed border to say
                  // "already audited" without whispering it
                  !active && past && "border-dashed border-muted-foreground/60 text-foreground/80",
                  !active && !past && "hover:bg-muted"
                )}
              >
                {d.date}
                {past ? <span className="ml-1 opacity-70">· past</span> : null}
              </Link>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {isPast
            ? "Showing what was actually outstanding at this deadline, from the recorded snapshot."
            : "Showing what is owed at this deadline: documents falling due this week, anything still overdue, and the documents owed continuously."}
        </p>
      </div>

      {/* per-function cards, for the SELECTED week */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaries.map((s) => (
          <Card key={s.function}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{s.function}</span>
                {s.needsReview > 0 ? (
                  <Badge variant="outline" className="text-[10px]">
                    {s.needsReview} to review
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 text-2xl font-bold">{s.missingCount}</p>
              <p className="text-xs text-muted-foreground">
                document(s) missing · {s.epCount} EP(s)
              </p>
              <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                {s.overdueCount > 0 ? (
                  <Badge variant="destructive">{s.overdueCount} overdue</Badge>
                ) : null}
                {s.currentCount > 0 ? (
                  <Badge variant="secondary">{s.currentCount} due now</Badge>
                ) : null}
                {s.ongoingCount > 0 ? (
                  <Badge variant="outline">{s.ongoingCount} always owed</Badge>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ColumnFilter
          label="Function"
          value={fnFilter}
          onChange={setFnFilter}
          options={summaries.map((s) => ({ value: s.function, label: s.function }))}
        />
        <ColumnFilter
          label="State"
          value={bucketFilter}
          onChange={setBucketFilter}
          options={[
            { value: "overdue", label: "Overdue" },
            { value: "current", label: "Due this week" },
            { value: "ongoing", label: "Always owed" },
          ]}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} document(s)
        </span>
        <TableSettings columns={cols} />
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
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={cols.visible.length}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Nothing outstanding for this deadline. 🎉
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((i) => (
                <TableRow key={`${i.epOppId}|${i.stageKey}|${i.requirementKey}`}>
                  {cols.visible.map((c) => (
                    <TableCell key={c.key}>{cell(i, c.key)}</TableCell>
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

function cell(i: WeeklyItem, key: string): React.ReactNode {
  switch (key) {
    case "ep":
      return (
        <Link prefetch={false}
          href={`/cxp/ep/${encodeURIComponent(i.epOppId)}`}
          className="font-medium hover:underline"
        >
          {i.epName || i.epOppId}
        </Link>
      );
    case "requirement":
      return <span className="text-sm">{i.requirementName}</span>;
    case "stage":
      return <span className="text-xs text-muted-foreground">{i.stageKey}</span>;
    case "due":
      return (
        <span className="text-xs text-muted-foreground">{i.dueDate ?? "no fixed date"}</span>
      );
    case "bucket":
      return (
        <Badge
          variant={
            i.bucket === "overdue"
              ? "destructive"
              : i.bucket === "current"
                ? "secondary"
                : "outline"
          }
          className="text-[10px]"
        >
          {BUCKET_LABEL[i.bucket]}
        </Badge>
      );
    default:
      return null;
  }
}
