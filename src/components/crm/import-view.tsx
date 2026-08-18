"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, FileUp, Loader2, Trash2, XCircle } from "lucide-react";
import { importAccountsBulk, type ImportRowResult } from "@/server/actions";
import { cleanPhone, EMAIL_RE, IGV_PROJECTS, PHONE_RE } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FileDrop } from "./file-drop";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface MemberOption { id: string; label: string; functions: string[] }
type ImportFn = "IGV" | "IGT" | "B2B" | "BD" | "B2C";

type Fn = "IGV" | "IGT" | "B2B" | "BD" | "B2C";

interface DraftRow {
  name: string;
  function: Fn;
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

/** Loose header matching so "Account Name", "name", "الاسم"… map correctly. */
const HEADER_MAP: [RegExp, keyof DraftRow][] = [
  [/^(account\s*)?name$|company/i, "name"],
  [/^function$/i, "function"],
  [/^product$/i, "product"],
  [/^project$/i, "project"],
  [/sub\s*product/i, "sub_product"],
  [/account\s*type|^type$/i, "account_type"],
  [/industry/i, "industry"],
  [/phone|number|mobile/i, "phone"],
  [/e-?mail/i, "email"],
  [/social/i, "social_link"],
  [/website|site|url/i, "website"],
  [/comment|note/i, "comment"],
  [/responsible|owner|member/i, "responsible_id"],
];

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

  const resolveResponsible = (raw: string): string => {
    const clean = raw.trim().toLowerCase();
    if (!clean) return viewer.id;
    const hit = members.find(
      (m) => m.label.toLowerCase() === clean || m.id === raw
    );
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
        header: 1,
        raw: false,
        defval: "",
      }) as string[][];
      if (grid.length < 2) {
        toast.error("The file needs a header row + at least one account row.");
        return;
      }
      const headers = grid[0].map((h) => String(h ?? "").trim());
      const colFor = new Map<number, keyof DraftRow>();
      headers.forEach((h, i) => {
        const hit = HEADER_MAP.find(([re]) => re.test(h));
        if (hit && ![...colFor.values()].includes(hit[1])) colFor.set(i, hit[1]);
      });
      if (![...colFor.values()].includes("name")) {
        toast.error('No "Name" column found — the first row must contain the column titles.');
        return;
      }

      const drafts: DraftRow[] = [];
      for (const line of grid.slice(1)) {
        const draft: DraftRow = {
          name: "", function: defaultFn, product: "", project: "", sub_product: "",
          account_type: "", industry: "", phone: "", email: "",
          social_link: "", website: "", comment: "", responsible_id: viewer.id,
        };
        colFor.forEach((key, i) => {
          const value = String(line[i] ?? "").trim();
          if (!value) return;
          if (key === "function") {
            const up = value.toUpperCase();
            const fn = up.includes("B2B") ? "B2B" : up.includes("BD") ? "BD" : up.includes("IGV") ? "IGV" : up.includes("IGT") ? "IGT" : "";
            if (fn && viewer.allowedFns.includes(fn as ImportFn)) draft.function = fn as ImportFn;
          } else if (key === "product") {
            const v = value.toLowerCase();
            draft.product = v.includes("gta") || v.includes("talent") ? "GTa"
              : v.includes("gte") || v.includes("teacher") ? "GTe" : "";
          } else if (key === "project") {
            draft.project =
              IGV_PROJECTS.find((p) => p.toLowerCase().replace(/[^a-z]/g, "") === value.toLowerCase().replace(/[^a-z]/g, "")) ?? value;
          } else if (key === "responsible_id") {
            draft.responsible_id = resolveResponsible(value);
          } else if (key === "phone") {
            draft.phone = cleanPhone(value);
          } else {
            draft[key] = value;
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

  const update = (i: number, patch: Partial<DraftRow>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const removeRow = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  const rowIssue = (r: DraftRow): string | null => {
    if (r.name.trim().length < 2) return "Name required";
    if (r.function === "IGT" && !r.product) return "Pick GTa/GTe";
    if (r.function === "IGV" && !r.project) return "Pick a project";
    // B2B needs neither product nor project
    if (r.phone && !PHONE_RE.test(cleanPhone(r.phone))) return "Bad phone";
    if (r.email && !EMAIL_RE.test(r.email.trim())) return "Bad email";
    return null;
  };
  const invalidCount = rows.filter((r) => rowIssue(r)).length;

  const submit = () =>
    start(async () => {
      const res = await importAccountsBulk(
        rows.map((r) => ({
          function: r.function,
          name: r.name.trim(),
          product: r.product || null,
          project: r.function === "IGV" ? r.project || null : null,
          sub_product: r.function === "IGT" ? r.sub_product || null : null,
          account_type: r.function !== "IGT" ? r.account_type || null : null,
          industry: r.function !== "IGT" ? r.industry || null : null,
          phone: r.phone || null,
          email: r.email || null,
          social_link: r.social_link || null,
          website: r.website || null,
          comment: r.comment || null,
          responsible_id: r.responsible_id || null,
        }))
      );
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
        <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
          {parsing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
          {rows.length > 0 ? "Choose another file" : "Choose file"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="rise-in rise-in-1">
          <CardContent className="space-y-3 py-8 text-center text-sm text-muted-foreground">
            <FileDrop
              accept=".csv,.xlsx,.xls"
              onFile={(f) => parseFile(f)}
              disabled={parsing}
              label="Drop your .csv / .xlsx here — or click to browse"
              className="mx-auto max-w-xl"
            />
            <p>
              Expected columns (any order, extra columns are ignored):
            </p>
            <p className="mx-auto max-w-xl font-mono text-xs leading-relaxed">
              Name* · Function (IGV/IGT) · Product (GTa/GTe) · Project (IGV) ·
              Sub Product · Account Type · Industry · Phone · Email · Social ·
              Website · Comment · Responsible
            </p>
            <p>
              Each row passes the same checks as a hand-added account —
              duplicates and archived names are blocked automatically.
            </p>
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
                    <TableHead className="min-w-44">Name *</TableHead>
                    <TableHead>Function</TableHead>
                    <TableHead className="min-w-28">Product / Type</TableHead>
                    <TableHead className="min-w-32">Industry / Sub product</TableHead>
                    <TableHead className="min-w-32">Phone</TableHead>
                    <TableHead className="min-w-40">Email</TableHead>
                    {viewer.canAssignOthers ? <TableHead className="min-w-36">Responsible</TableHead> : null}
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
                        <TableCell>
                          <Input className="h-8" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={r.function}
                            onValueChange={(v) => update(i, { function: v as ImportFn })}
                            disabled={viewer.allowedFns.length < 2}
                          >
                            <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {viewer.allowedFns.map((f) => (
                                <SelectItem key={f} value={f}>{f}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {r.function === "IGT" ? (
                            <Select
                              value={r.product || undefined}
                              onValueChange={(v) => update(i, { product: v as "GTa" | "GTe" })}
                            >
                              <SelectTrigger className="h-8 w-24"><SelectValue placeholder="GTa/GTe" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="GTa">GTa</SelectItem>
                                <SelectItem value="GTe">GTe</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : r.function === "IGV" ? (
                            <Select
                              value={r.project || undefined}
                              onValueChange={(v) => update(i, { project: v })}
                            >
                              <SelectTrigger className="h-8 w-32"><SelectValue placeholder="Project *" /></SelectTrigger>
                              <SelectContent>
                                {IGV_PROJECTS.map((pj) => (
                                  <SelectItem key={pj} value={pj}>{pj}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">whole ICX</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8"
                            value={r.function === "IGT" ? r.sub_product : r.industry}
                            placeholder={r.function === "IGT" ? "Sub product" : "Industry"}
                            onChange={(e) =>
                              update(i, r.function === "IGT"
                                ? { sub_product: e.target.value }
                                : { industry: e.target.value })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className={cn("h-8", r.phone && !PHONE_RE.test(cleanPhone(r.phone)) && "border-destructive")}
                            value={r.phone}
                            inputMode="tel"
                            onChange={(e) => update(i, { phone: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className={cn("h-8", r.email && !EMAIL_RE.test(r.email.trim()) && "border-destructive")}
                            value={r.email}
                            inputMode="email"
                            onChange={(e) => update(i, { email: e.target.value })}
                          />
                        </TableCell>
                        {viewer.canAssignOthers ? (
                          <TableCell>
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
                          </TableCell>
                        ) : null}
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
