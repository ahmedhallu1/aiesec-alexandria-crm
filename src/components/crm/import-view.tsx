"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, CheckCircle2, Download, FileUp, Loader2, Trash2, XCircle,
} from "lucide-react";
import { importAccountsBulk, type ImportRowResult } from "@/server/actions";
import { cleanPhone, EMAIL_RE, PHONE_RE, URL_RE } from "@/lib/types";
import {
  appliesTo, exampleFor, importFieldsFor, importTemplateRows, isRequired,
  mapImportHeaders, matchFunction, matchOption, matchProduct, toCsv,
  type ImportField, type ImportFn,
} from "@/lib/import-columns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FileDrop } from "./file-drop";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Hint } from "./hint";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface MemberOption { id: string; label: string; functions: string[] }

/** One row of the file, in Sodio's own shape. */
interface DraftRow {
  name: string;
  function: ImportFn;
  product: "" | "GTa" | "GTe";
  project: string;
  sub_product: string;
  account_type: string;
  industry: string;
  phone: string;
  email: string;
  social_link: string;
  website: string;
  comment: string;
  responsible_id: string;
}

const blankRow = (fn: ImportFn, me: string): DraftRow => ({
  name: "", function: fn, product: "", project: "", sub_product: "",
  account_type: "", industry: "", phone: "", email: "",
  social_link: "", website: "", comment: "", responsible_id: me,
});

/** IMPORT MARKET RESEARCH — the columns follow the importer (v34.8).
 *
 *  Every column on this screen, in the downloadable template and in the
 *  header matcher comes from ONE description in `lib/import-columns`, keyed
 *  by the functions this member may actually import into. A B2C member is
 *  asked for a Type and never for a Product; an IGV member is asked for a
 *  Project. The example under each column is a real value, because the single
 *  biggest cause of a rejected row was people guessing at the shape. */
export function ImportView({
  viewer, members,
}: {
  viewer: { id: string; canAssignOthers: boolean; allowedFns: ImportFn[] };
  members: MemberOption[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [results, setResults] = useState<ImportRowResult[] | null>(null);
  const [pending, start] = useTransition();

  const defaultFn = viewer.allowedFns[0] ?? "IGT";
  const fields = useMemo(() => importFieldsFor(viewer.allowedFns), [viewer.allowedFns]);
  // the Responsible column only exists for someone who can hand accounts out
  const columns = fields.filter((f) => f.key !== "responsible" || viewer.canAssignOthers);

  const resolveResponsible = (raw: string): string => {
    const clean = raw.trim().toLowerCase();
    if (!clean) return viewer.id;
    const hit = members.find((m) => m.label.toLowerCase() === clean || m.id === raw);
    return hit && viewer.canAssignOthers ? hit.id : viewer.id;
  };

  const parseFile = async (file: File) => {
    setParsing(true);
    setResults(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1, raw: false, defval: "",
      }) as string[][];
      if (grid.length < 2) {
        toast.error("The file needs a header row + at least one account row.");
        return;
      }
      const colFor = mapImportHeaders(grid[0].map((h) => String(h ?? "").trim()), fields);
      if (![...colFor.values()].includes("name")) {
        toast.error('No "Name" column found — the first row must contain the column titles.');
        return;
      }

      const drafts: DraftRow[] = [];
      for (const line of grid.slice(1)) {
        const draft = blankRow(defaultFn, viewer.id);
        // FUNCTION FIRST: every other column's meaning depends on it (a
        // "Type" is one list for B2C and another for everyone else), so it
        // cannot be resolved in whatever order the file happens to hold.
        const fnCol = [...colFor.entries()].find(([, k]) => k === "function");
        if (fnCol) {
          const hit = matchFunction(String(line[fnCol[0]] ?? "").trim(), viewer.allowedFns);
          if (hit) draft.function = hit;
        }
        colFor.forEach((key, i) => {
          const value = String(line[i] ?? "").trim();
          if (!value || key === "function") return;
          const field = fields.find((f) => f.key === key);
          // a column that doesn't exist for THIS row's function is dropped,
          // not written — an Industry cell must never land on a B2C account
          if (!field || !appliesTo(field, draft.function)) return;

          if (key === "product") draft.product = matchProduct(value);
          else if (key === "responsible") draft.responsible_id = resolveResponsible(value);
          else if (key === "phone") draft.phone = cleanPhone(value);
          else if (field.kind === "pick" && field.options) {
            const opts = field.options(draft.function);
            // an open list keeps what was typed; a closed one only accepts
            // something it can actually resolve
            const hit = matchOption(value, opts);
            draft[key as "project" | "account_type" | "industry" | "sub_product"] =
              hit ?? (field.openList ? value : "");
          } else {
            draft[key as "name" | "email" | "social_link" | "website" | "comment"] = value;
          }
        });
        if (draft.name.trim()) drafts.push(draft);
      }
      if (drafts.length === 0) {
        toast.error("No rows with an account name found.");
        return;
      }
      if (drafts.length > 500) {
        toast.error("Max 500 accounts per import — split the file.");
        return;
      }
      setRows(drafts);
      setFileName(file.name);
      toast.success(`${drafts.length} account${drafts.length === 1 ? "" : "s"} read — review below, then import.`);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't read that file. Use .csv or .xlsx with a header row.");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** The file they should have started from — their own columns, one worked
   *  example row. Built in the browser, so it needs no route. */
  const downloadTemplate = () => {
    const { headers, example } = importTemplateRows(viewer.allowedFns);
    // the BOM is what makes Excel read Arabic comments as Arabic
    const blob = new Blob(["﻿" + toCsv([headers, example])], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Sodio import template — ${viewer.allowedFns.join(", ") || "accounts"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Template downloaded — fill it in and upload it back.");
  };

  const update = (i: number, patch: Partial<DraftRow>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const removeRow = (i: number) => {
    setRows((r) => r.filter((_, j) => j !== i));
    // (v37.8) results are matched to rows BY INDEX — drop the same slot so
    // the imported/blocked badges don't slide onto the wrong account.
    setResults((res) => (res ? res.filter((_, j) => j !== i) : res));
  };

  /** Exactly what the server will refuse, said before the upload. */
  const rowIssue = (r: DraftRow): string | null => {
    if (r.name.trim().length < 2) return "Name required";
    for (const f of fields) {
      if (!isRequired(f, r.function)) continue;
      const v = String(r[f.key === "responsible" ? "responsible_id" : f.key] ?? "").trim();
      if (!v) return `${f.label} required`;
    }
    if (r.phone && !PHONE_RE.test(cleanPhone(r.phone))) return "Bad phone";
    if (r.email && !EMAIL_RE.test(r.email.trim())) return "Bad email";
    if (r.website && !URL_RE.test(r.website.trim())) return "Website needs https://";
    if (r.social_link && !URL_RE.test(r.social_link.trim())) return "Link needs https://";
    return null;
  };
  const invalidCount = rows.filter((r) => rowIssue(r)).length;

  const submit = () =>
    start(async () => {
      // (v37.8) a thrown action (a 500-row import timing out) used to end
      // with no message at all, and people clicked Import twice.
      let res: Awaited<ReturnType<typeof importAccountsBulk>>;
      try {
        res = await importAccountsBulk(
        rows.map((r) => ({
          function: r.function,
          name: r.name.trim(),
          product: r.function === "IGT" ? r.product || null : null,
          project: r.function === "IGV" ? r.project || null : null,
          sub_product: r.function === "IGT" ? r.sub_product || null : null,
          // B2C's Type lives in the same column as an ICX account type, but
          // it is a different list — the server checks it against B2C_TYPES
          account_type: r.function !== "IGT" ? r.account_type || null : null,
          // …and a B2C account carries NO industry at all (v23)
          industry:
            r.function === "IGT" || r.function === "B2C" ? null : r.industry || null,
          phone: r.phone || null,
          email: r.email || null,
          social_link: r.social_link || null,
          website: r.website || null,
          comment: r.comment || null,
          responsible_id: r.responsible_id || null,
        }))
        );
      } catch {
        toast.error("That didn't go through. Check the accounts list before importing again — some rows may already be in.");
        return;
      }
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { results: rr, created } = res.data!;
      setResults(rr);
      if (created === rows.length) {
        toast.success(`All ${created} accounts imported 🎉`);
      } else {
        toast.warning(`${created} imported · ${rows.length - created} blocked — see the rows below.`);
      }
      router.refresh();
    });

  const memberOptionsFor = (fn: ImportFn) =>
    members.filter(
      (m) =>
        m.id === viewer.id ||
        (fn === "B2B" || fn === "BD"
          ? ["B2B", "BD"].some((f) => m.functions.includes(f))
          : m.functions.includes(fn))
    );

  /** One editable cell, rendered from the field's own description. */
  const cellFor = (f: ImportField, r: DraftRow, i: number) => {
    if (!appliesTo(f, r.function)) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    const required = isRequired(f, r.function);

    if (f.key === "function") {
      return (
        <Select value={r.function} onValueChange={(v) => update(i, { function: v as ImportFn })}>
          <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            {viewer.allowedFns.map((fn) => (
              <SelectItem key={fn} value={fn}>{fn}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (f.key === "responsible") {
      return (
        <Select
          value={r.responsible_id}
          onValueChange={(v) => update(i, { responsible_id: v })}
        >
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {memberOptionsFor(r.function).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}{m.id === viewer.id ? " (you)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (f.key === "product") {
      return (
        <Select
          value={r.product || undefined}
          onValueChange={(v) => update(i, { product: v as "GTa" | "GTe" })}
        >
          <SelectTrigger className={cn("h-8 w-24", required && !r.product && "border-warning")}>
            <SelectValue placeholder="GTa/GTe *" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="GTa">GTa</SelectItem>
            <SelectItem value="GTe">GTe</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    // a CLOSED pick-list is a select; an OPEN one stays a text box with the
    // options as a datalist, so an industry nobody listed still survives
    const value = String(r[f.key as keyof DraftRow] ?? "");
    if (f.kind === "pick" && f.options && !f.openList) {
      const opts = f.options(r.function);
      return (
        <Select
          value={value || undefined}
          onValueChange={(v) => update(i, { [f.key]: v } as Partial<DraftRow>)}
        >
          <SelectTrigger className={cn("h-8 w-36", required && !value && "border-warning")}>
            <SelectValue placeholder={required ? `${f.label} *` : f.label} />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    const bad =
      (f.kind === "phone" && value && !PHONE_RE.test(cleanPhone(value))) ||
      (f.kind === "email" && value && !EMAIL_RE.test(value.trim())) ||
      (f.kind === "url" && value && !URL_RE.test(value.trim()));
    const listId = f.openList ? `imp-${f.key}` : undefined;

    return (
      <>
        <Input
          className={cn("h-8 min-w-28", bad && "border-destructive")}
          value={value}
          list={listId}
          inputMode={f.kind === "phone" ? "tel" : f.kind === "email" ? "email" : undefined}
          placeholder={exampleFor(f, r.function)}
          onChange={(e) => update(i, { [f.key]: e.target.value } as Partial<DraftRow>)}
        />
        {listId && f.options ? (
          <datalist id={listId}>
            {f.options(r.function).map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        ) : null}
      </>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Link prefetch={false}
        href="/accounts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All accounts
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 rise-in">
        <div>
          <h1 className="text-2xl font-bold">Import market research</h1>
          <p className="text-sm text-muted-foreground">
            Upload a <b>.csv</b> or <b>.xlsx</b> with a header row — review
            everything before it enters the system.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) parseFile(f);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="size-4" /> Download template
          </Button>
          <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {rows.length > 0 ? "Choose another file" : "Choose file"}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="rise-in rise-in-1">
          <CardContent className="space-y-4 py-8 text-sm">
            <FileDrop
              accept=".csv,.xlsx,.xls"
              onFile={(f) => parseFile(f)}
              disabled={parsing}
              label="Drop your .csv / .xlsx here — or click to browse"
              className="mx-auto max-w-xl"
            />
            <div className="mx-auto max-w-3xl space-y-2">
              <p className="text-center text-muted-foreground">
                These are the columns for{" "}
                <b>{viewer.allowedFns.join(" · ") || "your function"}</b> — any
                order, extra columns are ignored, and everything but the name is
                optional unless marked <b>*</b>.
              </p>
              {/* ONE GUIDE TO WHAT TO WRITE, WITH A REAL VALUE ON EVERY ROW.
                  The old screen printed a bare list of column names with no
                  example anywhere, which is why so many uploads came back
                  rejected a row at a time.

                  ⚠️ CARDS ON A PHONE, table from `sm` up — the house rule
                  since v3, and the exact thing v33.50 had to go back and fix
                  in the Help centre: a three-column table in a 375px card
                  clips its last column with nothing to say it can scroll. */}
              <ColumnGuide fields={fields} allowedFns={viewer.allowedFns} />
              <p className="text-center text-muted-foreground">
                Each row passes the same checks as a hand-added account —
                duplicates and archived names are blocked automatically. Max 500
                rows per file.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rise-in">
            <p className="text-sm text-muted-foreground">
              <b>{fileName}</b> · {rows.length} account{rows.length === 1 ? "" : "s"}
              {invalidCount > 0 ? (
                <span className="ml-2 text-destructive">{invalidCount} row{invalidCount === 1 ? "" : "s"} need fixes</span>
              ) : null}
            </p>
            <Button onClick={submit} disabled={pending || rows.length === 0 || invalidCount > 0}>
              {pending ? (
                <><Loader2 className="size-4 animate-spin" /> Importing…</>
              ) : (
                <>Import {rows.length} account{rows.length === 1 ? "" : "s"}</>
              )}
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card rise-in rise-in-1">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((f) => (
                      <TableHead key={f.key} className="min-w-28">
                        <Hint label={f.hint}>
                          <span className="cursor-help">
                            {f.label}
                            {viewer.allowedFns.some((fn) => isRequired(f, fn)) ? " *" : ""}
                          </span>
                        </Hint>
                      </TableHead>
                    ))}
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => {
                    const issue = rowIssue(r);
                    const result = results?.[i];
                    return (
                      <TableRow key={i} className={cn(result && !result.ok && "bg-destructive/5")}>
                        {columns.map((f) => (
                          <TableCell key={f.key}>{cellFor(f, r, i)}</TableCell>
                        ))}
                        <TableCell>
                          {result ? (
                            result.ok ? (
                              <Badge className="border-transparent bg-success/15 text-success">
                                <CheckCircle2 className="size-3" /> imported
                              </Badge>
                            ) : (
                              <Badge variant="destructive" title={result.error}>
                                <XCircle className="size-3" /> {result.error?.slice(0, 40)}
                              </Badge>
                            )
                          ) : issue ? (
                            <Badge className="border-transparent bg-warning/15 text-warning">{issue}</Badge>
                          ) : (
                            <Badge variant="outline">ready</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            aria-label="Remove row"
                            onClick={() => removeRow(i)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** WHAT EACH COLUMN IS FOR, WITH A REAL VALUE IN IT.
 *
 *  Cards on a phone, the table it always was from `sm` up — the same shape
 *  `HelpTable` uses, and for the same reason: three columns of prose in a
 *  375px card clips the last one, silently, which is how the Help centre
 *  became unreadable on phones until v33.50 went back for it. */
function ColumnGuide({
  fields, allowedFns,
}: {
  fields: ImportField[];
  allowedFns: ImportFn[];
}) {
  const rows = fields.map((f) => {
    const req = allowedFns.filter((fn) => isRequired(f, fn));
    const only = allowedFns.filter((fn) => appliesTo(f, fn));
    return {
      f,
      required: req.length > 0,
      // "* required" is unambiguous when it holds for everything this member
      // imports; otherwise it has to name the functions it holds for
      requiredNote:
        req.length > 0 && req.length < allowedFns.length
          ? `Required for ${req.join(" / ")}.`
          : null,
      onlyNote:
        only.length > 0 && only.length < allowedFns.length ? `${only.join(" / ")} only` : null,
      example: only.map((fn) => exampleFor(f, fn)).find(Boolean) ?? f.example,
    };
  });

  return (
    <>
      {/* phones — one card per column */}
      <div className="space-y-2 sm:hidden">
        {rows.map((r) => (
          <div key={r.f.key} className="rounded-lg border">
            <p className="flex flex-wrap items-baseline gap-1.5 rounded-t-lg bg-muted/60 px-3 py-1.5 text-sm font-semibold">
              {r.f.label}
              {r.required ? <span className="text-destructive">*</span> : null}
              {r.onlyNote ? (
                <span className="text-[10px] font-normal text-muted-foreground">
                  {r.onlyNote}
                </span>
              ) : null}
            </p>
            <div className="space-y-1 px-3 py-2">
              <p className="font-mono text-xs break-words">{r.example}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {r.f.hint}
                {r.requiredNote ? (
                  <b className="text-foreground"> {r.requiredNote}</b>
                ) : null}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* everything wider — the table */}
      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Column</TableHead>
              <TableHead className="w-48">Example</TableHead>
              <TableHead>What it&apos;s for</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.f.key}>
                <TableCell className="align-top font-medium">
                  {r.f.label}
                  {r.required ? <span className="text-destructive"> *</span> : null}
                  {r.onlyNote ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {r.onlyNote}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top font-mono text-xs break-words">
                  {r.example}
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {r.f.hint}
                  {r.requiredNote ? <b className="text-foreground"> {r.requiredNote}</b> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
