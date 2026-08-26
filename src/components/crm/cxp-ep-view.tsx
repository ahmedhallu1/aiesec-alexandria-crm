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
import { uploadCxpFile } from "@/server/cxp-actions";
import { toast } from "sonner";

/** One row of the EP's document checklist. */
export interface EpDocRow {
  stageKey: CxpStageKey;
  stage: string;
  requirementKey: string;
  requirementName: string;
  criteria: string;
  uploaded: boolean;
  fileUrl: string | null;
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
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [stageFilter, setStageFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");

  const filtered = useMemo(() => {
    const stages = multi(stageFilter);
    const states = multi(stateFilter);
    return docs.filter((d) => {
      if (stages.length && !stages.includes(d.stageKey)) return false;
      if (states.length && !states.includes(d.uploaded ? "have" : "missing")) return false;
      return true;
    });
  }, [docs, stageFilter, stateFilter]);

  const { sorted, sortKey, dir, toggle } = useTableSort(filtered, {
    stage: (d: EpDocRow) => CXP_STAGE_KEYS.indexOf(d.stageKey),
    document: (d: EpDocRow) => d.requirementName,
    due: (d: EpDocRow) => d.dueDate ?? "",
    state: (d: EpDocRow) => (d.uploaded ? 1 : 0),
  });

  const have = docs.filter((d) => d.uploaded).length;

  const attach = (d: EpDocRow, file: File) => {
    const key = `${d.stageKey}|${d.requirementKey}`;
    setBusy(key);
    const fd = new FormData();
    fd.set("epOppId", header.epOppId);
    fd.set("stageKey", d.stageKey);
    fd.set("requirementKey", d.requirementKey);
    fd.set("file", file);
    startTransition(async () => {
      const r = await uploadCxpFile(fd);
      setBusy(null);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });
  };

  return (
    <div className="grid gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{header.epName || header.epOppId}</h1>
          <Badge variant="secondary">{header.function}</Badge>
          {header.product ? <Badge variant="outline">{header.product}</Badge> : null}
          {header.needsReview ? <Badge variant="outline">needs review</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {header.epOppId}
          {header.opportunityName ? ` · ${header.opportunityName}` : ""}
          {header.status ? ` · ${header.status}` : ""}
        </p>
      </div>

      {/* THE DATES THAT DRIVE EVERY DEADLINE — surfaced because when a
          deadline looks wrong, one of these is the reason */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Approved", header.approvalDate],
            ["Arrival (flight)", header.arrivalDate],
            ["Start", header.startDate],
            ["End", header.endDate],
          ] as [string, string | null][]
        ).map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold">{value ?? "—"}</p>
            </CardContent>
          </Card>
        ))}
      </div>

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
        <div className="ml-auto flex flex-wrap gap-2">
          <ColumnFilter
            label="Stage"
            value={stageFilter}
            onChange={setStageFilter}
            options={CXP_STAGE_KEYS.map((k) => ({ value: k, label: STAGE_BY_KEY[k] }))}
          />
          <ColumnFilter
            label="State"
            value={stateFilter}
            onChange={setStateFilter}
            options={[
              { value: "missing", label: "Missing" },
              { value: "have", label: "Collected" },
            ]}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
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
                  <SortHeader
                    label={label}
                    active={sortKey === key}
                    dir={sortKey === key ? dir : null}
                    onClick={() => toggle(key)}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((d) => (
              <TableRow key={`${d.stageKey}|${d.requirementKey}`}>
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
                  <div className="flex items-center gap-2">
                    {d.uploaded ? (
                      d.fileUrl ? (
                        <a
                          href={d.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-emerald-600 hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <Badge variant="secondary">collected</Badge>
                      )
                    ) : (
                      <Badge variant="destructive">missing</Badge>
                    )}
                    {canEdit ? (
                      <>
                        <input
                          ref={(el) => {
                            inputs.current[`${d.stageKey}|${d.requirementKey}`] = el;
                          }}
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) attach(d, f);
                            e.target.value = "";
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={pending}
                          onClick={() =>
                            inputs.current[`${d.stageKey}|${d.requirementKey}`]?.click()
                          }
                        >
                          {busy === `${d.stageKey}|${d.requirementKey}`
                            ? "Uploading…"
                            : d.uploaded
                              ? "Replace"
                              : "Attach"}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
