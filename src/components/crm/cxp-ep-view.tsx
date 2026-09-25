"use client";

import { useMemo, useRef, useState, useTransition } from "react";
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
  useTableSort,
} from "./data-table-kit";
import { CXP_STAGE_KEYS, STAGE_BY_KEY, type CxpStageKey } from "@/lib/cxp/types";
import { Button } from "@/components/ui/button";
import {
  clearCxpRequirement,
  confirmCxpUpload,
  requestCxpUpload,
} from "@/server/cxp-actions";
import { MAX_UPLOAD_BYTES } from "@/lib/cxp/drive";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, Copy, Download, Eye, FileArchive, Trash2, UploadCloud } from "lucide-react";

/** PUT the file straight to the signed storage URL, reporting progress. XHR,
 *  not fetch, because fetch still cannot report UPLOAD progress — and a 15 MB
 *  scan on a phone connection with no progress looks exactly like the bug this
 *  replaces. */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(file);
  });
}

/** Where one document can be read. Sodio streams it — the Drive file itself
 *  is not shared with most of the people who need to see it. */
function fileHref(epOppId: string, d: { stageKey: string; requirementKey: string }, download: boolean) {
  const p = new URLSearchParams({ ep: epOppId, stage: d.stageKey, req: d.requirementKey });
  if (download) p.set("dl", "1");
  return `/api/cxp/file?${p.toString()}`;
}

/** One row of the EP's document checklist. */
export interface EpDocRow {
  stageKey: CxpStageKey;
  stage: string;
  requirementKey: string;
  requirementName: string;
  criteria: string;
  uploaded: boolean;
  /** a real file sits behind it, so it can be viewed and downloaded */
  hasFile: boolean;
  /** collected only per the ECB sheet's tick — no file in Sodio */
  fromSheetOnly: boolean;
  dueDate: string | null;
  window: string | null;
  /** which input date drove the deadline — so a wrong one is traceable */
  basedOn: string | null;
  note: string | null;
}

export interface EpHeader {
  epName: string;
  epOppId: string;
  product: string;
  function: string;
  side: string;
  status: string;
  approvalDate: string | null;
  startDate: string | null;
  endDate: string | null;
  arrivalDate: string | null;
  hostLc: string | null;
  homeLc: string | null;
  opportunityName: string | null;
  comments: { stage: string; comment: string }[];
  needsReview: boolean;
}

/**
 * ONE EP's SUBMISSION FILE.
 *
 * The checklist across every stage, with each document's own deadline and the
 * ECB's comments on what needs correcting. The old app had this too; what it
 * lacked was any way to sort or filter it, so a 26-row checklist was read top
 * to bottom every time.
 */
export function CxpEpView({
  header,
  docs,
  canEdit,
}: {
  header: EpHeader;
  docs: EpDocRow[];
  /** may this viewer attach documents? decided server-side, re-checked there */
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  /** per row: upload progress 0–100, "saving" while it moves to Drive */
  const [busy, setBusy] = useState<Record<string, number | "saving">>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [colFilter, setColFilter] = useState<Record<string, string>>({});

  const copy = (value: string, label: string) => async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      toast.success(`Copied ${label}.`);
      setTimeout(() => setCopied((c) => (c === value ? null : c)), 1200);
    } catch {
      toast.error("Could not copy — your browser blocked clipboard access.");
    }
  };

  /** What a document row presents to each column's filter. */
  const docFilterValue = (d: EpDocRow, key: string): string => {
    switch (key) {
      case "stage":
        return d.stageKey;
      case "document":
        return d.requirementName;
      case "due":
        // grouped, because a filter listing 26 distinct dates is a list
        return d.dueDate || d.window ? "dated" : "no date";
      case "state":
        return d.uploaded ? "have" : "missing";
      default:
        return "";
    }
  };

  const docLabel = (key: string, v: string) => {
    if (key === "stage") return STAGE_BY_KEY[v as CxpStageKey] ?? v;
    if (key === "state") return v === "have" ? "Collected" : "Missing";
    if (key === "due") return v === "dated" ? "Has a deadline" : "No fixed date";
    return v;
  };

  /** Options per column, from the rows themselves. */
  const docOptions = useMemo(() => {
    const out: Record<string, { value: string; label: string }[]> = {};
    for (const key of ["stage", "document", "due", "state"]) {
      const seen = new Set<string>();
      for (const d of docs) {
        const v = docFilterValue(d, key);
        if (v) seen.add(v);
      }
      out[key] = [...seen]
        .sort((a, b) =>
          key === "stage"
            ? CXP_STAGE_KEYS.indexOf(a as CxpStageKey) - CXP_STAGE_KEYS.indexOf(b as CxpStageKey)
            : a.localeCompare(b)
        )
        .map((v) => ({ value: v, label: docLabel(key, v) }));
    }
    return out;
     
  }, [docs]);

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      for (const [key, raw] of Object.entries(colFilter)) {
        const picked = multi(raw);
        if (picked.length && !picked.includes(docFilterValue(d, key))) return false;
      }
      return true;
    });
     
  }, [docs, colFilter]);

  const { sorted, sortKey, dir, toggle } = useTableSort(filtered, {
    stage: (d: EpDocRow) => CXP_STAGE_KEYS.indexOf(d.stageKey),
    document: (d: EpDocRow) => d.requirementName,
    due: (d: EpDocRow) => d.dueDate ?? "",
    state: (d: EpDocRow) => (d.uploaded ? 1 : 0),
  });

  const have = docs.filter((d) => d.uploaded).length;

  const setRow = (key: string, v: number | "saving" | null) =>
    setBusy((prev) => {
      const next = { ...prev };
      if (v === null) delete next[key];
      else next[key] = v;
      return next;
    });

  /** THE TWO-STEP UPLOAD. The file goes straight to storage (no size wall),
   *  then the server moves it into the EP's Drive folder. Every failure lands
   *  in a toast that says what happened — the old path threw inside a
   *  transition and simply stopped. */
  const attach = async (d: EpDocRow, file: File) => {
    const key = `${d.stageKey}|${d.requirementKey}`;
    if (busy[key] !== undefined) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${
          MAX_UPLOAD_BYTES / 1024 / 1024
        } MB. Compress it and try again.`
      );
      return;
    }
    setRow(key, 0);
    try {
      const ticket = await requestCxpUpload({
        epOppId: header.epOppId,
        stageKey: d.stageKey,
        requirementKey: d.requirementKey,
        fileName: file.name,
        size: file.size,
      });
      if (!ticket.ok || !ticket.signedUrl || !ticket.path) {
        toast.error(ticket.message || "Could not prepare the upload.");
        return;
      }
      const put = await putWithProgress(ticket.signedUrl, file, (pct) => setRow(key, pct));
      if (!put) {
        toast.error("The upload was interrupted — check your connection and try again.");
        return;
      }
      setRow(key, "saving");
      const r = await confirmCxpUpload({
        epOppId: header.epOppId,
        stageKey: d.stageKey,
        requirementKey: d.requirementKey,
        path: ticket.path,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
      });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? `Upload failed: ${err.message}`
          : "Upload failed — try again."
      );
    } finally {
      setRow(key, null);
    }
  };

  const remove = (d: EpDocRow) => {
    setConfirmRemove(null);
    startTransition(async () => {
      try {
        const r = await clearCxpRequirement(header.epOppId, d.stageKey, d.requirementKey);
        if (r.ok) toast.success(r.message);
        else toast.error(r.message);
      } catch {
        toast.error("Could not remove it — try again.");
      }
    });
  };

  const withFile = docs.filter((d) => d.hasFile).length;

  /** The actions a document offers — the same on a card and in a table row. */
  const docActions = (d: EpDocRow) => {
    const rowKey = `${d.stageKey}|${d.requirementKey}`;
    const state = busy[rowKey];
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {state !== undefined ? (
          <div className="flex min-w-32 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${state === "saving" ? 100 : state}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {state === "saving" ? "Saving to Drive…" : `${state}%`}
            </span>
          </div>
        ) : d.uploaded ? (
          d.hasFile ? (
            <>
              <a
                href={fileHref(header.epOppId, d, false)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              >
                <Eye className="h-3.5 w-3.5" />
                View
              </a>
              <a
                href={fileHref(header.epOppId, d, true)}
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-muted"
                title="Download this document"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="sr-only sm:not-sr-only">Download</span>
              </a>
            </>
          ) : (
            <Badge variant="secondary" title="Ticked as collected on the ECB sheet — no file was attached in Sodio">
              collected · ECB sheet
            </Badge>
          )
        ) : dragOver === rowKey ? (
          <Badge variant="outline" className="border-primary text-primary">
            <UploadCloud className="mr-1 h-3 w-3" />
            Drop to attach
          </Badge>
        ) : (
          <Badge variant="destructive">missing</Badge>
        )}
        {canEdit && state === undefined ? (
          <>
            <input
              ref={(el) => {
                inputs.current[rowKey] = el;
              }}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void attach(d, f);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={pending}
              onClick={() => inputs.current[rowKey]?.click()}
            >
              <UploadCloud className="mr-1 h-3.5 w-3.5" />
              {d.hasFile ? "Replace" : "Attach"}
            </Button>
            {d.uploaded && !d.fromSheetOnly ? (
              confirmRemove === rowKey ? (
                <span className="inline-flex items-center gap-1 text-xs">
                  Remove it?
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={pending}
                    onClick={() => remove(d)}
                  >
                    Yes
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setConfirmRemove(null)}
                  >
                    No
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                  disabled={pending}
                  title="Wrong file? Mark it as not collected (the file stays in Drive)"
                  onClick={() => setConfirmRemove(rowKey)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Remove</span>
                </Button>
              )
            ) : null}
          </>
        ) : null}
      </div>
    );
  };

  const dropProps = (d: EpDocRow) => {
    const rowKey = `${d.stageKey}|${d.requirementKey}`;
    if (!canEdit) return {};
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(rowKey);
      },
      onDragLeave: () => setDragOver((k) => (k === rowKey ? null : k)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(null);
        const f = e.dataTransfer.files?.[0];
        if (f) void attach(d, f);
      },
    };
  };

  // ONE FIELD, whichever side populated it. The parser only ever fills one of
  // hostLc/homeLc (OGX -> hostLc, ICX -> homeLc) — showing both as separate
  // boxes meant one was always an empty box next to a full one, which is
  // exactly the "some barely visible" complaint.
  const partnerLc = header.side === "OGX" ? header.hostLc : header.homeLc;
  const partnerLcLabel = header.side === "OGX" ? "Hosting entity" : "Sending LC";

  // EVERY FACT IN ONE EVEN GRID. Four separate Card components of the same
  // fixed height LOOK even, but adding a fact meant either a fifth box that
  // broke the grid or burying it in the subtitle (opportunity name, the
  // partner LC — both were invisible before this). One grid, one row height,
  // every field the same size as its neighbour; a missing value reads as "—",
  // never as a differently-sized box.
  const infoFields: [string, string | null][] = [
    ["Product", header.product || null],
    ["Status", header.status || null],
    [partnerLcLabel, partnerLc],
    ["Opportunity", header.opportunityName],
    ["Approved", header.approvalDate],
    ["Arrival (flight)", header.arrivalDate],
    ["Start", header.startDate],
    ["End", header.endDate],
  ];

  return (
    <div className="grid gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{header.epName || header.epOppId}</h1>
          {header.epName ? (
            <button
              type="button"
              onClick={copy(header.epName, "EP name")}
              title="Copy name"
              className="rounded p-1 text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
            >
              {copied === header.epName ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          ) : null}
          <Badge variant="secondary">{header.function}</Badge>
          {header.needsReview ? <Badge variant="outline">needs review</Badge> : null}
        </div>
        <button
          type="button"
          onClick={copy(header.epOppId, "EP/OPP ID")}
          title="Click to copy"
          className="inline-flex items-center gap-1 rounded px-1 -mx-1 font-mono text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {header.epOppId}
          {copied === header.epOppId ? (
            <Check className="h-3 w-3 text-emerald-600" />
          ) : (
            <Copy className="h-3 w-3 opacity-50" />
          )}
        </button>
      </div>

      {/* THE FACTS THAT DRIVE EVERY DEADLINE, and everything else about the
          EP — one even grid instead of separate boxes of separate sizes */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:grid-cols-4">
          {infoFields.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 truncate text-sm font-semibold" title={value ?? undefined}>
                {value ?? "—"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* THE ECB'S OWN COMMENTS — what to correct, not just what is absent */}
      {header.comments.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            ECB comments
          </p>
          <ul className="mt-2 grid gap-1">
            {header.comments.map((c, i) => (
              <li key={i} className="text-sm text-amber-900 dark:text-amber-200">
                <span className="font-medium">{c.stage}:</span> {c.comment}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Documents</h2>
        <Badge variant="outline">
          {have}/{docs.length} collected
        </Badge>
        {withFile > 0 ? (
          <a
            href={`/api/cxp/zip?ep=${encodeURIComponent(header.epOppId)}`}
            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-muted"
            title="Every collected document for this EP, in one ZIP, sorted by stage"
          >
            <FileArchive className="h-3.5 w-3.5" />
            Download all ({withFile})
          </a>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {docs.length} shown
        </span>
        {Object.values(colFilter).some(Boolean) ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => setColFilter({})}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {/* PHONES GET CARDS — a four-column checklist with buttons in the last
          column was a sideways scroll on every row */}
      <div className="grid gap-2 md:hidden">
        {sorted.map((d) => {
          const rowKey = `${d.stageKey}|${d.requirementKey}`;
          return (
            <div
              key={rowKey}
              className={cn(
                "grid gap-2 rounded-lg border p-3",
                dragOver === rowKey && "bg-primary/5",
                !d.uploaded && "border-l-4 border-l-destructive/60"
              )}
              {...dropProps(d)}
            >
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{d.stage}</p>
                <p className="break-words font-medium">{d.requirementName}</p>
                <p className="break-words text-xs text-muted-foreground">{d.criteria}</p>
                <p className="mt-1 text-xs">
                  <span className="text-muted-foreground">Due: </span>
                  {d.window ?? d.dueDate ?? "no fixed date"}
                </p>
              </div>
              {docActions(d)}
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {(
                [
                  ["stage", "Stage"],
                  ["document", "Document"],
                  ["due", "Deadline"],
                  ["state", "State"],
                ] as [string, string][]
              ).map(([key, label]) => (
                <TableHead key={key}>
                  <div className="flex items-center gap-1">
                    <SortHeader
                      label={label}
                      active={sortKey === key}
                      dir={sortKey === key ? dir : null}
                      onClick={() => toggle(key)}
                    />
                    {(docOptions[key]?.length ?? 0) > 1 ? (
                      <ColumnFilter
                        label={label}
                        value={colFilter[key] ?? ""}
                        options={docOptions[key]}
                        onChange={(v) =>
                          setColFilter((prev) => ({ ...prev, [key]: v }))
                        }
                        allLabel={`All ${label.toLowerCase()}`}
                      />
                    ) : null}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((d) => {
              const rowKey = `${d.stageKey}|${d.requirementKey}`;
              return (
                <TableRow
                  key={rowKey}
                  className={cn(dragOver === rowKey && "bg-primary/5")}
                  // THE WHOLE ROW IS A DROP TARGET when editable — drag a file
                  // from Finder/Explorer straight onto its requirement
                  {...dropProps(d)}
                >
                  <TableCell className="text-xs text-muted-foreground">{d.stage}</TableCell>
                  <TableCell>
                    <span className="font-medium">{d.requirementName}</span>
                    <p className="text-xs text-muted-foreground">{d.criteria}</p>
                  </TableCell>
                  <TableCell className="text-xs">
                    {d.window ?? d.dueDate ?? (
                      <span className="text-muted-foreground">no fixed date</span>
                    )}
                    {d.basedOn ? (
                      <p className="text-[10px] text-muted-foreground">from {d.basedOn}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {docActions(d)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
