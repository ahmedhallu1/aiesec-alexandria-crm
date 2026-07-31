"use client";

import { useCallback, useMemo, useRef, useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ExternalLink, FileText, Globe2, ImagePlus, Loader2, Mail, Pencil, Phone,
  Plus, Search, Sparkles, Trash2, Upload,
} from "lucide-react";
import {
  addPartnerLc, confirmCvUpload, deleteCv, getCvFileUrl, recordIrCall,
  requestCvUpload, rerunCvExtraction, updateCvFields,
} from "@/server/actions";
import type { CvRow, IrCallRow, PartnerLc } from "@/server/data";
import {
  normalizePhone, fmtDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Hint } from "./hint";
import { WhatsAppIcon } from "./icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const PAGE_SIZE = 50;
const IR_SHOT_MAX = 3 * 1024 * 1024; // 3 MB — base64 rides the action body
const CV_MAX = 25 * 1024 * 1024;

/** UI copy of the extractor's pick-list (server validates against the real
 *  one in src/lib/cv-extract.ts — keep in sync). */
const INDUSTRY_OPTIONS = [
  "Marketing", "IT/Software", "Engineering", "Education", "Healthcare",
  "Law", "Finance", "Business", "Design", "Other",
];

const waDigits = (phone: string | null) => {
  if (!phone) return null;
  // AI-extracted numbers arrive in every format — canonicalize via the
  // app's phone rule; a number it can't place gets no WhatsApp link
  const n = normalizePhone(phone);
  return n.ok ? n.value.replace(/\D/g, "") : null;
};

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

interface PageData<T> {
  rows: T[];
  total: number;
  page: number;
}

// ------------------------------------------------------------ partner LC picker

/** Branded combobox over the partner LCs with an inline "+ Add new LC". */
function PartnerLcPicker({
  lcs, value, onChange, onCreated, allowNone,
}: {
  lcs: PartnerLc[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (lc: PartnerLc) => void;
  allowNone?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      const res = await addPartnerLc({ name, country: country || null });
      if (res.ok && res.data) {
        toast.success(`Partner LC "${res.data.name}" added 🌍`);
        onCreated(res.data);
        onChange(res.data.id);
        setAdding(false);
        setName("");
        setCountry("");
      } else if (!res.ok) toast.error(res.error);
    });

  return (
    <div className="space-y-2">
      <Select
        value={adding ? "__new" : value || (allowNone ? "__none" : "")}
        onValueChange={(v) => {
          if (v === "__new") setAdding(true);
          else {
            setAdding(false);
            onChange(v === "__none" ? "" : v);
          }
        }}
      >
        <SelectTrigger className="h-9 w-full">
          <SelectValue placeholder="Pick the partner LC…" />
        </SelectTrigger>
        <SelectContent>
          {allowNone ? <SelectItem value="__none">— No LC yet</SelectItem> : null}
          {lcs.map((lc) => (
            <SelectItem key={lc.id} value={lc.id}>
              {lc.name}
              {lc.country ? ` · ${lc.country}` : ""}
            </SelectItem>
          ))}
          <SelectItem value="__new">＋ Add new LC…</SelectItem>
        </SelectContent>
      </Select>
      {adding ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2">
          <Input
            dir="auto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="LC name (e.g. AIESEC in Tunis)"
            className="h-9 min-w-40 flex-1"
          />
          <Input
            dir="auto"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Country (optional)"
            className="h-9 w-36"
          />
          <Button type="button" size="sm" onClick={create} disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ main view

export function ConsiderationView({
  tab, lcs, calls, cvs, q, viewer,
}: {
  tab: "calls" | "cvs";
  lcs: PartnerLc[];
  calls: PageData<IrCallRow>;
  cvs: PageData<CvRow>;
  q: string;
  viewer: { id: string; isVp: boolean };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  // partner LCs added inline this session (before the next server refresh)
  const [addedLcs, setAddedLcs] = useState<PartnerLc[]>([]);
  const allLcs = useMemo(() => {
    const seen = new Set(lcs.map((l) => l.id));
    return [...lcs, ...addedLcs.filter((l) => !seen.has(l.id))];
  }, [lcs, addedLcs]);
  const lcAdded = useCallback(
    (lc: PartnerLc) => setAddedLcs((p) => (p.some((x) => x.id === lc.id) ? p : [...p, lc])),
    []
  );

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      startNav(() => router.replace(`/consideration?${params.toString()}`));
    },
    [router, searchParams]
  );

  return (
    <div className={cn("rise-in mx-auto max-w-6xl space-y-4", navPending && "nav-pending")}>
      <div>
        <h1 className="text-2xl font-bold">Consideration</h1>
        <p className="text-sm text-muted-foreground">
          International Relations calls with partner LCs abroad + the shared CV
          pool — market our opens, collect the CVs, let the AI read them.
        </p>
      </div>

      {/* segmented tab control (like the accounts mobile view switcher) */}
      <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
        {(
          [
            { key: "calls", label: "IR calls", icon: Globe2 },
            { key: "cvs", label: "CVs", icon: FileText },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() =>
              setParams({ tab: t.key === "calls" ? null : t.key, page: null, q: null })
            }
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              tab === t.key ? "bg-background shadow" : "text-muted-foreground"
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "calls" ? (
        <IrCallsTab
          data={calls}
          lcs={allLcs}
          onLcCreated={lcAdded}
          goPage={(p) => setParams({ page: String(p + 1) })}
        />
      ) : (
        <CvsTab
          data={cvs}
          lcs={allLcs}
          onLcCreated={lcAdded}
          q={q}
          viewer={viewer}
          setParams={setParams}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ IR calls

function IrCallsTab({
  data, lcs, onLcCreated, goPage,
}: {
  data: PageData<IrCallRow>;
  lcs: PartnerLc[];
  onLcCreated: (lc: PartnerLc) => void;
  goPage: (p: number) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lcId, setLcId] = useState("");
  const [calledAt, setCalledAt] = useState(nowLocal());
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [shotName, setShotName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const lcName = lcs.find((l) => l.id === lcId)?.name ?? "";
  const defaultShotName = `IR call — ${lcName || "LC"} — ${(calledAt || "").slice(0, 10)}`;

  const pickFile = (f: File | null) => {
    if (f && f.size > IR_SHOT_MAX) {
      toast.error("The screenshot is over 3 MB — compress or crop it, then re-pick.");
      if (fileRef.current) fileRef.current.value = "";
      setFile(null);
      return;
    }
    setFile(f);
  };

  const submit = () =>
    start(async () => {
      if (!lcId) {
        toast.error("Pick the partner LC (or add it) first.");
        return;
      }
      if (!calledAt || Number.isNaN(new Date(calledAt).getTime())) {
        toast.error("Pick the call's date and time.");
        return;
      }
      let screenshot: { name: string; mimeType: string; dataBase64: string } | undefined;
      if (file) {
        try {
          screenshot = {
            name: shotName.trim() || defaultShotName,
            mimeType: file.type || "image/png",
            dataBase64: await fileToBase64(file),
          };
        } catch {
          toast.error("Could not read the screenshot file — try re-picking it.");
          return;
        }
      }
      const res = await recordIrCall({
        partnerLcId: lcId,
        calledAt: new Date(calledAt).toISOString(),
        notes: notes || null,
        screenshot,
      });
      if (res.ok) {
        toast.success(`IR call with ${lcName} recorded 🌍`);
        if (res.data?.screenshotWarning) toast(res.data.screenshotWarning);
        setNotes("");
        setFile(null);
        setShotName("");
        setCalledAt(nowLocal());
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else toast.error(res.error);
    });

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <Card className="rise-in">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe2 className="size-4 text-primary" /> Record an IR call
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Video calls with partner LCs abroad marketing our city&apos;s opens —
            log every one, screenshot included.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Partner LC</Label>
              <PartnerLcPicker lcs={lcs} value={lcId} onChange={setLcId} onCreated={onLcCreated} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ir-when">When</Label>
              <Input
                id="ir-when"
                type="datetime-local"
                value={calledAt}
                max={nowLocal()}
                onChange={(e) => setCalledAt(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ir-notes">Notes (optional)</Label>
            <Textarea
              id="ir-notes"
              dir="auto"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was discussed, agreements, follow-ups…"
              rows={2}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ir-shot">Screenshot (optional, encouraged — image ≤ 3 MB)</Label>
              <Input
                id="ir-shot"
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                className="h-9 pt-1.5"
              />
            </div>
            {file ? (
              <div className="space-y-1.5">
                <Label htmlFor="ir-shot-name">Screenshot name on Drive</Label>
                <Input
                  id="ir-shot-name"
                  dir="auto"
                  value={shotName}
                  onChange={(e) => setShotName(e.target.value)}
                  placeholder={defaultShotName}
                  className="h-9"
                />
              </div>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Hint label="Saves the call — the screenshot lands in the CRM — IR Calls folder on Drive">
              <Button onClick={submit} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Record call
              </Button>
            </Hint>
          </div>
        </CardContent>
      </Card>

      <Card className="rise-in">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Recent calls{data.total ? ` (${data.total})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No IR calls yet — record the first one above. 🌍
            </p>
          ) : (
            <>
              {/* desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Partner LC</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Screenshot</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {fmtDateTime(c.called_at)}
                        </TableCell>
                        <TableCell className="font-medium" dir="auto">
                          {c.partner_lc_name}
                        </TableCell>
                        <TableCell dir="auto">{c.member_name}</TableCell>
                        <TableCell className="max-w-64">
                          <span className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
                            {c.notes || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {c.screenshot_link ? (
                            <a
                              href={c.screenshot_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                            >
                              Open in Drive <ExternalLink className="size-3.5" />
                            </a>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* mobile cards */}
              <div className="space-y-2 md:hidden">
                {data.rows.map((c) => (
                  <div key={c.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold" dir="auto">{c.partner_lc_name}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fmtDateTime(c.called_at)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground" dir="auto">by {c.member_name}</p>
                    {c.notes ? (
                      <p className="mt-1 line-clamp-3 text-sm" dir="auto">{c.notes}</p>
                    ) : null}
                    {c.screenshot_link ? (
                      <a
                        href={c.screenshot_link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-primary"
                      >
                        <ImagePlus className="size-3.5" /> Open screenshot in Drive
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
              {pages > 1 ? (
                <div className="flex items-center justify-between border-t pt-3 text-sm">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page === 0}
                    onClick={() => goPage(data.page - 1)}
                  >
                    Prev
                  </Button>
                  <span className="text-muted-foreground">
                    Page {data.page + 1} of {pages} · {data.total} calls
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page + 1 >= pages}
                    onClick={() => goPage(data.page + 1)}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ CV pool

const STATUS_CHIP: Record<
  CvRow["extraction_status"],
  { label: string; className: string }
> = {
  pending: { label: "AI reading…", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  done: { label: "AI read ✓", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Extraction failed", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
  unsupported: { label: "Manual (format not auto-readable)", className: "bg-muted text-muted-foreground" },
};

function CvsTab({
  data, lcs, onLcCreated, q, viewer, setParams,
}: {
  data: PageData<CvRow>;
  lcs: PartnerLc[];
  onLcCreated: (lc: PartnerLc) => void;
  q: string;
  viewer: { id: string; isVp: boolean };
  setParams: (patch: Record<string, string | null>) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(q);
  // URL is the source of truth — chip clears / back-nav must reflect here
  useEffect(() => {
    setSearch(q);
  }, [q]);
  const [file, setFile] = useState<File | null>(null);
  const [lcId, setLcId] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [editing, setEditing] = useState<CvRow | null>(null);
  const [deleting, setDeleting] = useState<CvRow | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | null) => {
    if (f && f.size > CV_MAX) {
      toast.error(`"${f.name}" is over 25 MB — compress it and try again.`);
      if (fileRef.current) fileRef.current.value = "";
      setFile(null);
      return;
    }
    setFile(f);
  };

  const upload = () =>
    start(async () => {
      if (!file) {
        toast.error("Pick the CV file first.");
        return;
      }
      setPhase("uploading");
      try {
        const meta = {
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
        };
        const req = await requestCvUpload(meta);
        if (!req.ok || !req.data) {
          toast.error(req.ok ? "Could not prepare the upload." : req.error);
          return;
        }
        let putOk = false;
        try {
          const put = await fetch(req.data.signedUrl, {
            method: "PUT",
            headers: { "content-type": meta.type },
            body: file,
          });
          putOk = put.ok;
        } catch {
          putOk = false;
        }
        if (!putOk) {
          toast.error("The file upload failed — check your connection and try again.");
          return;
        }
        setPhase("analyzing");
        const confirm = await confirmCvUpload({
          path: req.data.path,
          ...meta,
          partnerLcId: lcId || null,
        });
        if (!confirm.ok) {
          toast.error(confirm.error);
          return;
        }
        const status = confirm.data?.status;
        if (status === "done") toast.success("CV uploaded — the AI read it ✨");
        else if (status === "unsupported")
          toast(`CV uploaded. ${confirm.data?.note ?? "This format can't be auto-read — fill the fields manually."}`);
        else
          toast(`CV uploaded, but the AI extraction didn't stick: ${confirm.data?.note ?? "try Re-run."}`);
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } finally {
        setPhase("idle");
      }
    });

  const rerun = (cv: CvRow) => {
    setRerunning(cv.id);
    start(async () => {
      try {
        const res = await rerunCvExtraction(cv.id);
        if (res.ok) {
          if (res.data?.status === "done") toast.success("The AI read it this time ✨");
          else toast.error(res.data?.note ?? "Still no luck — fill the fields manually.");
          router.refresh();
        } else toast.error(res.error);
      } catch {
        toast.error("Couldn't reach the server — check your connection and try again.");
      } finally {
        setRerunning(null);
      }
    });
  };

  const openFile = (cv: CvRow) => {
    // open synchronously in the click — Safari blocks window.open after await
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;
    start(async () => {
      const res = await getCvFileUrl(cv.id);
      if (res.ok && res.data) {
        if (win) win.location.href = res.data.url;
        else window.open(res.data.url, "_blank");
      } else if (!res.ok) {
        win?.close();
        toast.error(res.error);
      }
    });
  };

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <Card className="rise-in">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" /> Add a CV to the pool
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Any format, up to 25 MB. PDFs, images and text files are read by the
            AI automatically — name, contacts, industry and skills fill themselves.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cv-file">CV file</Label>
              <Input
                id="cv-file"
                ref={fileRef}
                type="file"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                className="h-9 pt-1.5"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Partner LC (optional)</Label>
              <PartnerLcPicker
                lcs={lcs}
                value={lcId}
                onChange={setLcId}
                onCreated={onLcCreated}
                allowNone
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Hint label="Uploads to the private CV pool, then the AI extracts the fields">
              <Button onClick={upload} disabled={pending || !file}>
                {phase === "idle" ? (
                  <>
                    <Upload className="size-4" /> Upload CV
                  </>
                ) : (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {phase === "uploading" ? "Uploading…" : "AI is reading it…"}
                  </>
                )}
              </Button>
            </Hint>
          </div>
        </CardContent>
      </Card>

      {/* search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            dir="auto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setParams({ q: search, page: null }); }}
            onBlur={() => { if (search !== q) setParams({ q: search, page: null }); }}
            placeholder="Search: C#, ERP, marketing, a name…"
            className="h-9 w-64 pl-8"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Searches names, skills, industries and the CVs&apos; full text · {data.total} CV{data.total === 1 ? "" : "s"}
        </p>
      </div>

      {data.rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {q ? "No CVs match this search." : "The CV pool is empty — upload the first one above. 📄"}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.rows.map((cv) => {
            const chip = STATUS_CHIP[cv.extraction_status];
            const wa = waDigits(cv.phone);
            const mine = cv.uploaded_by === viewer.id;
            const canManage = viewer.isVp || mine;
            return (
              <Card key={cv.id} className="rise-in">
                <CardContent className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold" dir="auto">
                        {cv.person_name || cv.file_name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" dir="auto">
                        {cv.partner_lc_name ? `${cv.partner_lc_name} · ` : ""}
                        uploaded by {cv.uploader_name} · {fmtDateTime(cv.created_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {cv.industry ? <Badge variant="secondary">{cv.industry}</Badge> : null}
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", chip.className)}>
                        {chip.label}
                      </span>
                    </div>
                  </div>

                  {cv.summary ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
                      {cv.summary}
                    </p>
                  ) : null}
                  {cv.skills ? (
                    <p className="line-clamp-2 text-xs" dir="auto">
                      <span className="font-medium text-muted-foreground">Skills: </span>
                      {cv.skills}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {wa ? (
                      <Hint label={`WhatsApp ${cv.phone}`}>
                        <a
                          href={`https://wa.me/${wa}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex size-9 items-center justify-center rounded-md border text-emerald-600 transition-colors hover:bg-muted dark:text-emerald-400"
                          aria-label="WhatsApp"
                        >
                          <WhatsAppIcon className="size-4" />
                        </a>
                      </Hint>
                    ) : null}
                    {cv.phone ? (
                      <Hint label={`Call ${cv.phone}`}>
                        <a
                          href={`tel:${cv.phone}`}
                          className="inline-flex size-9 items-center justify-center rounded-md border transition-colors hover:bg-muted"
                          aria-label="Call"
                        >
                          <Phone className="size-4" />
                        </a>
                      </Hint>
                    ) : null}
                    {cv.email ? (
                      <Hint label={cv.email}>
                        <a
                          href={`mailto:${cv.email}`}
                          className="inline-flex size-9 items-center justify-center rounded-md border transition-colors hover:bg-muted"
                          aria-label="Email"
                        >
                          <Mail className="size-4" />
                        </a>
                      </Hint>
                    ) : null}
                    <div className="ml-auto flex items-center gap-1.5">
                      <Hint label="Open the CV file (10-min private link)">
                        <Button variant="outline" size="sm" onClick={() => openFile(cv)}>
                          <FileText className="size-4" /> Open file
                        </Button>
                      </Hint>
                      {cv.extraction_status !== "done" ? (
                        <Hint label="Ask the AI to read this CV again">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => rerun(cv)}
                            disabled={rerunning === cv.id}
                          >
                            {rerunning === cv.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Sparkles className="size-4" />
                            )}
                            Re-run
                          </Button>
                        </Hint>
                      ) : null}
                      {canManage ? (
                        <>
                          <Hint label="Fix the extracted fields">
                            <Button variant="ghost" size="icon" className="size-9" onClick={() => setEditing(cv)}>
                              <Pencil className="size-4" />
                            </Button>
                          </Hint>
                          <Hint label="Delete this CV (file included)">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-9 text-destructive hover:text-destructive"
                              onClick={() => setDeleting(cv)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </Hint>
                        </>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={data.page === 0}
            onClick={() => setParams({ page: String(data.page) })}
          >
            Prev
          </Button>
          <span className="text-muted-foreground">
            Page {data.page + 1} of {pages} · {data.total} CVs
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={data.page + 1 >= pages}
            onClick={() => setParams({ page: String(data.page + 2) })}
          >
            Next
          </Button>
        </div>
      ) : null}

      <CvEditDialog
        cv={editing}
        lcs={lcs}
        onLcCreated={onLcCreated}
        onClose={() => setEditing(null)}
      />
      <CvDeleteDialog cv={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ dialogs

function CvEditDialog({
  cv, lcs, onLcCreated, onClose,
}: {
  cv: CvRow | null;
  lcs: PartnerLc[];
  onLcCreated: (lc: PartnerLc) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ name: "", phone: "", email: "", industry: "", skills: "", lcId: "" });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // closed → forget which CV we loaded, so reopening always rehydrates
  if (!cv && loadedFor !== null) setLoadedFor(null);
  // (re)hydrate when a different CV opens
  if (cv && loadedFor !== cv.id) {
    setForm({
      name: cv.person_name ?? "",
      phone: cv.phone ?? "",
      email: cv.email ?? "",
      industry: cv.industry ?? "",
      skills: cv.skills ?? "",
      lcId: cv.partner_lc_id ?? "",
    });
    setLoadedFor(cv.id);
  }

  const save = () => {
    if (!cv) return;
    start(async () => {
      const res = await updateCvFields(cv.id, {
        person_name: form.name || null,
        phone: form.phone || null,
        email: form.email || null,
        industry: form.industry || null,
        skills: form.skills || null,
        partnerLcId: form.lcId || null,
      });
      if (res.ok) {
        toast.success("CV updated.");
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <Dialog open={!!cv} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fix the CV&apos;s fields</DialogTitle>
          <DialogDescription dir="auto">
            {cv?.file_name} — correct anything the AI missed or misread.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cv-edit-name">Person name</Label>
            <Input
              id="cv-edit-name"
              dir="auto"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cv-edit-phone">Phone</Label>
              <Input
                id="cv-edit-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+20…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv-edit-email">Email</Label>
              <Input
                id="cv-edit-email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Industry</Label>
            <Select
              value={form.industry || "__none"}
              onValueChange={(v) => setForm((f) => ({ ...f, industry: v === "__none" ? "" : v }))}
            >
              <SelectTrigger className="h-9 w-full"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {INDUSTRY_OPTIONS.map((i) => (
                  <SelectItem key={i} value={i}>{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Partner LC</Label>
            <PartnerLcPicker
              lcs={lcs}
              value={form.lcId}
              onChange={(id) => setForm((f) => ({ ...f, lcId: id }))}
              onCreated={onLcCreated}
              allowNone
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cv-edit-skills">Skills (comma-separated)</Label>
            <Textarea
              id="cv-edit-skills"
              dir="auto"
              rows={2}
              value={form.skills}
              onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))}
              placeholder="C#, ERP, AutoCAD…"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CvDeleteDialog({ cv, onClose }: { cv: CvRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const del = () => {
    if (!cv) return;
    start(async () => {
      const res = await deleteCv(cv.id);
      if (res.ok) {
        toast.success("CV deleted.");
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });
  };
  return (
    <Dialog open={!!cv} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete this CV?</DialogTitle>
          <DialogDescription dir="auto">
            &quot;{cv?.person_name || cv?.file_name}&quot; and its file will be
            permanently removed from the pool. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={del} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
