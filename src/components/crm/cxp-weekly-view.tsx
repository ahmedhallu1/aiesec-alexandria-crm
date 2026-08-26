"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Download, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { buildCxpWeeklyFolder, buildCxpWeeklyZip } from "@/server/cxp-actions";
import type { WeeklyEp, WeeklyItem, WeeklySummary } from "@/lib/cxp/weekly";
import type { CxpFunction, CxpSide, CxpWeeklyDeadline } from "@/lib/cxp/types";

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
  canOps,
}: {
  deadlines: CxpWeeklyDeadline[];
  selected: string;
  isPast: boolean;
  summaries: WeeklySummary[];
  eps: Record<string, WeeklyEp[]>;
  side: CxpSide | null;
  sides: CxpSide[];
  /** may this viewer build the weekly Drive folder / ZIP for these functions? */
  canOps: boolean;
}) {
  const router = useRouter();
  // opening an EP is a navigation — show that the click landed
  const [navPending, startNav] = useTransition();
  const [colFilter, setColFilter] = useState<Record<string, string>>({});
  const cols = useTableColumns("cxp-weekly", COLUMNS);

  // THE DOWNLOAD BUTTONS. `folderUrls`/`zipUrls` remember the last link
  // returned for THIS deadline — switching weeks clears them rather than
  // showing a stale link for a different week (the old board's bug: past
  // weeks' links vanished on switch; this is the opposite mistake, and just
  // as wrong, so state is keyed by `${fn}|${selected}`).
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  // `opsPending` isn't read directly — `busy` already drives each button's own
  // label — but it stays a named binding rather than a discarded destructure,
  // per the house rule pinned in tests/nav-pending.test.ts.
  const [opsPending, startOps] = useTransition();
  void opsPending;

  const runOp = (
    fn: CxpFunction,
    kind: "folder" | "zip",
    action: (fn: CxpFunction, deadline: string) => Promise<{ ok: boolean; message: string; url?: string }>
  ) => {
    const key = `${fn}|${kind}`;
    setBusy(key);
    startOps(async () => {
      const r = await action(fn, selected);
      setBusy(null);
      if (r.ok) {
        toast.success(r.message);
        if (r.url) {
          setLinks((prev) => ({ ...prev, [`${fn}|${kind}|${selected}`]: r.url! }));
          window.open(r.url, "_blank", "noopener,noreferrer");
        }
      } else {
        toast.error(r.message);
      }
    });
  };

  const allItems = useMemo(
    () => Object.values(eps).flatMap((list) => list.flatMap((e) => e.items)),
    [eps]
  );

  /** What an item presents to each column's filter. */
  const itemValue = (i: WeeklyItem, key: string): string => {
    switch (key) {
      case "ep":
        return i.epName || i.epOppId;
      case "requirement":
        return i.requirementName;
      case "stage":
        return i.stageKey;
      case "due":
        return i.dueDate ?? "no date";
      case "bucket":
        return i.bucket;
      default:
        return "";
    }
  };

  const itemLabel = (key: string, v: string) =>
    key === "bucket" ? (BUCKET_LABEL[v as WeeklyItem["bucket"]] ?? v) : v;

  const options = useMemo(() => {
    const out: Record<string, { value: string; label: string }[]> = {};
    for (const c of COLUMNS) {
      const seen = new Set<string>();
      for (const i of allItems) {
        const v = itemValue(i, c.key);
        if (v) seen.add(v);
      }
      out[c.key] = [...seen]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((v) => ({ value: v, label: itemLabel(c.key, v) }));
    }
    return out;
     
  }, [allItems]);

  const filtered = useMemo(() => {
    return allItems.filter((i) => {
      for (const [key, raw] of Object.entries(colFilter)) {
        const picked = multi(raw);
        if (picked.length && !picked.includes(itemValue(i, key))) return false;
      }
      return true;
    });
     
  }, [allItems, colFilter]);

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

              {/* THE SUBMISSION DOWNLOAD — the piece the old board led with.
                  Not shown for a past week: those are read from the recorded
                  snapshot, and there is nothing here to bundle. */}
              {canOps && !isPast ? (
                <div className="mt-3 flex gap-2 border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    disabled={busy === `${s.function}|zip`}
                    onClick={() => runOp(s.function, "zip", buildCxpWeeklyZip)}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    {busy === `${s.function}|zip` ? "Building…" : "Download ZIP"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    disabled={busy === `${s.function}|folder`}
                    onClick={() => runOp(s.function, "folder", buildCxpWeeklyFolder)}
                  >
                    <FolderOpen className="mr-1 h-3.5 w-3.5" />
                    {busy === `${s.function}|folder` ? "Building…" : "Open folder"}
                  </Button>
                </div>
              ) : null}
              {(links[`${s.function}|zip|${selected}`] || links[`${s.function}|folder|${selected}`]) ? (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Opened in a new tab.{" "}
                  <a
                    href={links[`${s.function}|zip|${selected}`] || links[`${s.function}|folder|${selected}`]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Open again
                  </a>
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {allItems.length} document(s)
        </span>
        {Object.values(colFilter).some(Boolean) ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setColFilter({})}
          >
            Clear filters
          </Button>
        ) : null}
        <TableSettings columns={cols} className="ml-auto" />
      </div>

      <div className={cn("overflow-x-auto rounded-lg border", navPending && "nav-pending")}>
        <Table>
          <TableHeader>
            <TableRow>
              {cols.visible.map((c) => (
                <TableHead key={c.key}>
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
                        onChange={(v) =>
                          setColFilter((prev) => ({ ...prev, [c.key]: v }))
                        }
                        allLabel={`All ${c.label.toLowerCase()}`}
                      />
                    ) : null}
                  </div>
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
                <TableRow
                  key={`${i.epOppId}|${i.stageKey}|${i.requirementKey}`}
                  onClick={() =>
                    startNav(() =>
                      router.push(`/cxp/ep/${encodeURIComponent(i.epOppId)}`)
                    )
                  }
                  className="cursor-pointer"
                >
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
          onClick={(e) => e.stopPropagation()}
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
