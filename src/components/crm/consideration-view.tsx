"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarClock, Check, ChevronDown, ClipboardCheck, Copy, ExternalLink,
  FileText, Globe2, ImagePlus, Link2, Loader2, Mail, Pencil, Phone, Plus, Send,
  Search, Settings2, Sparkles, Trash2, Upload, Video, X,
} from "lucide-react";
import {
  addPartnerLc, cancelIrCall, completeIrCall, confirmCvUpload, deleteCv,
  createIgtExpectationDraft, deletePartnerLc, getCvFileUrl, previewIgtExpectationMail,
  recordIrCall, requestCvUpload, sendIgtExpectationMail,
  requestIrReschedule, rerunCvExtraction, saveIrBookingSettings,
  updateCvFields, updatePartnerLc,
} from "@/server/actions";
import type {
  PartnerLcDetail,
  CvRow, IrAvailabilityRow, IrCallRow, MyIrBooking, PartnerLc,
} from "@/server/data";
import { normalizePhone, fmtDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CountryInput } from "./country-input";
import {
  PageSizePicker, SortHeader, TableSettings, useTableColumns, useTableSort,
  type TableColumn,
} from "./data-table-kit";
import { FileDrop } from "./file-drop";
import { Hint } from "./hint";
import { WalkingLoader } from "./walking-loader";
import { WhatsAppIcon } from "./icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";


const IR_SHOT_MAX = 3 * 1024 * 1024; // 3 MB — base64 rides the action body
const CV_MAX = 25 * 1024 * 1024;

/** UI copy of the extractor's pick-list (server validates against the real
 *  one in src/lib/cv-extract.ts — keep in sync). Doubles as the in-call
 *  "What is their demand?" domain chips (v27). */
const INDUSTRY_OPTIONS = [
  "Marketing", "IT/Software", "Engineering", "Education", "Healthcare",
  "Law", "Finance", "Business", "Design", "Other",
];

/** Saturday-first, like every Sodio calendar. Values = 0-Sunday…6-Saturday
 *  (the ir_booking_settings jsonb shape). */
const WEEK_DAYS: { value: number; label: string }[] = [
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
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

interface CallsData extends PageData<IrCallRow> {
  scheduled: IrCallRow[];
}

interface ViewerInfo {
  id: string;
  isVp: boolean;
  showCvs: boolean;
  showExpectation: boolean;
}

// -------------------------------------------- IGT expectation mail (v33.3)

/** THE INCOMING EXPECTATION MAIL.
 *
 *  The LC's formal promise to an arriving EP — project, visa, pickup,
 *  accommodation, departure support — and the first thing they read from us.
 *  It used to be retyped per EP, which is how a link rots in one copy and not
 *  another. Here only the four things that actually differ are typed; the
 *  standing text and every hyperlink come from the template.
 *
 *  Two steps on purpose: BUILD, then review the real email and edit it freely
 *  before it goes anywhere. It leaves from the VP's own Gmail, so the EP's
 *  reply reaches a person. */
function IgtExpectationTab() {
  const [form, setForm] = useState({
    epName: "",
    projectName: "",
    year: String(new Date().getFullYear()),
    toEp: "",
    toIr: "",
  });
  const [built, setBuilt] = useState<{ subject: string; html: string } | null>(null);
  const [subject, setSubject] = useState("");
  const [pending, start] = useTransition();
  const bodyRef = useRef<HTMLDivElement>(null);

  const build = () =>
    start(async () => {
      const res = await previewIgtExpectationMail({
        epName: form.epName,
        projectName: form.projectName,
        year: form.year,
      });
      if (!res.ok || !res.data) {
        toast.error(res.ok ? "Could not build the email." : res.error);
        return;
      }
      setBuilt(res.data);
      setSubject(res.data.subject);
    });

  /** whatever the VP edited in the preview is what goes out — verbatim */
  const reviewed = () => ({
    subject: subject.trim(),
    html: bodyRef.current?.innerHTML ?? built?.html ?? "",
    toEp: form.toEp.trim(),
    toIr: form.toIr.trim(),
  });

  const send = () =>
    start(async () => {
      const res = await sendIgtExpectationMail(reviewed());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sent from your Gmail ✉️");
      setBuilt(null);
      setForm((f) => ({ ...f, epName: "", toEp: "", toIr: "" }));
    });

  const draft = () =>
    start(async () => {
      const res = await createIgtExpectationDraft(reviewed());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Saved as a draft in your Gmail — review and send it there.");
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Incoming EP — expectation mail</CardTitle>
          <CardDescription>
            The standing text, the visa &amp; invitation-letter links and your signature are
            filled in for you. It goes to the EP, with{" "}
            <span className="font-medium">customer.support@aiesec.net.eg</span> always on Cc.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>EP name *</Label>
            <Input
              value={form.epName}
              onChange={(e) => setForm((f) => ({ ...f, epName: e.target.value }))}
              placeholder="Yusra Irfan"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Project name *</Label>
            <Input
              value={form.projectName}
              onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))}
              placeholder="English Teacher"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Year *</Label>
            <Input
              value={form.year}
              onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
              placeholder="2026"
              inputMode="numeric"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>EP email * (To)</Label>
            <Input
              type="email"
              value={form.toEp}
              onChange={(e) => setForm((f) => ({ ...f, toEp: e.target.value }))}
              placeholder="ep@example.com"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>IR email (Cc — optional)</Label>
            <Input
              type="email"
              value={form.toIr}
              onChange={(e) => setForm((f) => ({ ...f, toIr: e.target.value }))}
              placeholder="Their home LC's IR — leave blank if there isn't one"
            />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={build} disabled={pending}>
              {pending && !built ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Build the email
            </Button>
          </div>
        </CardContent>
      </Card>

      {built ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review before it leaves</CardTitle>
            <CardDescription>
              Edit anything below — the text is live. What you see is exactly what the EP gets.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-1.5">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            {/* WHO IT GOES TO — visible at the moment of review, because
                "send" is irreversible and the addresses were typed a scroll
                ago. Editable here too: catching a typo shouldn't mean
                rebuilding the email (v33.4). */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>To — the EP</Label>
                <Input
                  type="email"
                  value={form.toEp}
                  onChange={(e) => setForm((f) => ({ ...f, toEp: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Cc — the IR (optional)</Label>
                <Input
                  type="email"
                  value={form.toIr}
                  onChange={(e) => setForm((f) => ({ ...f, toIr: e.target.value }))}
                  placeholder="Leave blank if there isn't one"
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                <span className="font-medium">customer.support@aiesec.net.eg</span> is always
                on Cc — the EP&apos;s fallback when this term ends.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label>Body</Label>
              {/* The email carries its OWN colours (dark text, for the white
                  background every mail client renders it on). Dropping that
                  onto a dark app surface made it near-invisible, so the
                  preview is a sheet of white paper in both themes — which is
                  also exactly what the EP will see. */}
              <div
                ref={bodyRef}
                contentEditable
                suppressContentEditableWarning
                dir="auto"
                style={{ backgroundColor: "#ffffff", color: "#1f2937" }}
                className="max-h-[55vh] overflow-y-auto rounded-lg border p-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                dangerouslySetInnerHTML={{ __html: built.html }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={send} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send now
              </Button>
              <Button variant="outline" onClick={draft} disabled={pending}>
                Save as draft instead
              </Button>
              <Button variant="ghost" onClick={() => setBuilt(null)} disabled={pending}>
                Start over
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ partner LC picker

/** Branded combobox over the partner LCs with an inline "+ Add new LC" and
 *  (v28) an optional ⚙ manage affordance opening the registry dialog. */
function PartnerLcPicker({
  lcs, value, onChange, onCreated, allowNone, manage,
}: {
  lcs: (PartnerLc | PartnerLcDetail)[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (lc: PartnerLc) => void;
  allowNone?: boolean;
  /** shows the ⚙ Partner-LCs dialog; canEdit unlocks rename/delete (VP+) */
  manage?: { canEdit: boolean };
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [managing, setManaging] = useState(false);
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
      <div className="flex items-center gap-1.5">
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
        {manage ? (
          <Hint label="Manage the partner LCs list">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setManaging(true)}
            >
              <Settings2 className="size-4" />
            </Button>
          </Hint>
        ) : null}
      </div>
      {adding ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2">
          <Input
            dir="auto"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="LC name (e.g. AIESEC in Tunis)"
            className="h-9 min-w-40 flex-1"
          />
          <CountryInput
            value={country}
            onChange={setCountry}
            placeholder="Country (optional)"
            className="h-9 w-36"
          />
          <Button type="button" size="sm" onClick={create} disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </div>
      ) : null}
      {manage ? (
        <PartnerLcManageDialog
          open={managing}
          onClose={() => setManaging(false)}
          lcs={lcs}
          canEdit={manage.canEdit}
          onCreated={onCreated}
        />
      ) : null}
    </div>
  );
}

/** The Partner-LCs registry (v28): everyone browses + adds; VP/Director/LCP
 *  rename (name/country) and delete unused entries — an LC with IR calls or
 *  CVs on record refuses to go (friendly server error). */
function PartnerLcManageDialog({
  open, onClose, lcs, canEdit, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  lcs: (PartnerLc | PartnerLcDetail)[];
  canEdit: boolean;
  onCreated: (lc: PartnerLc) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [newName, setNewName] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<PartnerLc | null>(null);

  const startEdit = (lc: PartnerLc) => {
    setEditingId(lc.id);
    setName(lc.name);
    setCountry(lc.country ?? "");
  };

  const saveEdit = () => {
    if (!editingId) return;
    start(async () => {
      const res = await updatePartnerLc(editingId, { name, country: country || null });
      if (res.ok) {
        toast.success("Partner LC updated.");
        setEditingId(null);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const doDelete = () => {
    if (!confirmDelete) return;
    start(async () => {
      const res = await deletePartnerLc(confirmDelete.id);
      if (res.ok) {
        toast.success(`"${confirmDelete.name}" removed from the list.`);
        setConfirmDelete(null);
        router.refresh();
      } else {
        toast.error(res.error);
        setConfirmDelete(null);
      }
    });
  };

  const add = () =>
    start(async () => {
      const res = await addPartnerLc({ name: newName, country: newCountry || null });
      if (res.ok && res.data) {
        toast.success(`Partner LC "${res.data.name}" added 🌍`);
        onCreated(res.data);
        setNewName("");
        setNewCountry("");
        router.refresh();
      } else if (!res.ok) toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setEditingId(null); setConfirmDelete(null); onClose(); } }}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Partner LCs</DialogTitle>
          <DialogDescription>
            The shared registry behind every IR call and CV.
            {canEdit
              ? " Rename or remove entries — deleting only works when nothing references the LC."
              : " Ask a VP/Director to fix or remove an entry."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {lcs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No partner LCs yet — add the first one below. 🌍
            </p>
          ) : (
            lcs.map((lc) =>
              editingId === lc.id ? (
                <div key={lc.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 p-2">
                  <Input
                    dir="auto"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-9 min-w-36 flex-1"
                    maxLength={120}
                    aria-label="LC name"
                  />
                  <CountryInput
                    value={country}
                    onChange={setCountry}
                    placeholder="Country"
                    className="h-9 w-32"
                  />
                  <Button size="sm" onClick={saveEdit} disabled={pending || !name.trim()}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <div key={lc.id} className="flex items-start justify-between gap-2 rounded-lg border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" dir="auto">
                      {lc.name}
                      {lc.country ? (
                        <span className="text-muted-foreground"> · {lc.country}</span>
                      ) : null}
                    </p>
                    {"calls" in lc ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {(lc as PartnerLcDetail).calls} call
                        {(lc as PartnerLcDetail).calls === 1 ? "" : "s"} ·{" "}
                        {(lc as PartnerLcDetail).cvs} CV
                        {(lc as PartnerLcDetail).cvs === 1 ? "" : "s"}
                        {(lc as PartnerLcDetail).lastCallAt
                          ? ` · last ${fmtDateTime((lc as PartnerLcDetail).lastCallAt!).slice(0, 12)}`
                          : ""}
                      </p>
                    ) : null}
                    {"contacts" in lc && (lc as PartnerLcDetail).contacts.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {(lc as PartnerLcDetail).contacts.map((c, i) => (
                          <li key={i} className="truncate text-xs text-muted-foreground" dir="auto">
                            👤 {c.name || "—"}
                            {c.role ? ` · ${c.role}` : ""}
                            {c.email ? (
                              <>
                                {" · "}
                                <a href={`mailto:${c.email}`} className="text-primary hover:underline">
                                  {c.email}
                                </a>
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Hint label="Edit the name / country">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => startEdit(lc)}>
                          <Pencil className="size-3.5" />
                        </Button>
                      </Hint>
                      <Hint label="Delete (only when unused)">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setConfirmDelete(lc)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </Hint>
                    </div>
                  ) : null}
                </div>
              )
            )
          )}
        </div>
        {confirmDelete ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p dir="auto">
              Delete <b>{confirmDelete.name}</b> from the registry? Only works
              when no IR calls or CVs reference it.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
                Keep it
              </Button>
              <Button variant="destructive" size="sm" onClick={doDelete} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Delete
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2">
          <Input
            dir="auto"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New LC name (e.g. AIESEC in Tunis)"
            className="h-9 min-w-40 flex-1"
            maxLength={120}
          />
          <Input
            dir="auto"
            value={newCountry}
            onChange={(e) => setNewCountry(e.target.value)}
            placeholder="Country (optional)"
            className="h-9 w-36"
            maxLength={60}
          />
          <Button type="button" size="sm" onClick={add} disabled={pending || !newName.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ main view

export function ConsiderationView({
  pageSize,
  pageSizeOptions,
  tab, lcs, calls, cvs, q, viewer, booking, origin,
}: {
  tab: "calls" | "cvs" | "expectation";
  lcs: (PartnerLc | PartnerLcDetail)[];
  calls: CallsData;
  cvs: PageData<CvRow>;
  q: string;
  pageSize: number;
  pageSizeOptions: number[];
  viewer: ViewerInfo;
  booking: MyIrBooking | null;
  origin: string;
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

  const tabs = [
    { key: "calls", label: "IR calls", icon: Globe2 },
    ...(viewer.showCvs ? [{ key: "cvs", label: "CVs", icon: FileText }] : []),
    ...(viewer.showExpectation
      ? [{ key: "expectation", label: "Expectation mail", icon: Mail }]
      : []),
  ] as const;

  return (
    <div className={cn("rise-in mx-auto max-w-6xl space-y-4", navPending && "nav-pending")}>
      <div>
        <h1 className="text-2xl font-bold">Consideration</h1>
        <p className="text-sm text-muted-foreground">
          International Relations calls with partner LCs abroad
          {viewer.showCvs ? " + the shared CV pool" : ""} — market our opens,
          book the calls{viewer.showCvs ? ", collect the CVs, let the AI read them" : ""}.
        </p>
      </div>

      {/* segmented tab control (like the accounts mobile view switcher) */}
      <div className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
        {tabs.map((t) => (
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

      {/* the tab content — the walking man walks while a tab/page/filter
          switch is in flight (v27) */}
      <div className="relative">
        {navPending ? (
          <div className="absolute inset-0 z-10 flex items-start justify-center rounded-xl bg-background/60 pt-10 backdrop-blur-[1px]">
            <WalkingLoader label="Loading…" />
          </div>
        ) : null}
        {tab === "expectation" && viewer.showExpectation ? (
          <IgtExpectationTab />
        ) : tab === "calls" || !viewer.showCvs ? (
          <IrCallsTab
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            onPageSize={(n) => setParams({ size: String(n), page: null })}
            data={calls}
            lcs={allLcs}
            onLcCreated={lcAdded}
            goPage={(p) => setParams({ page: String(p + 1) })}
            viewer={viewer}
            booking={booking}
            origin={origin}
          />
        ) : (
          <CvsTab
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            data={cvs}
            lcs={allLcs}
            onLcCreated={lcAdded}
            q={q}
            viewer={viewer}
            setParams={setParams}
          />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ demand chips

/** "What is their demand?" — multi-pick domain chips + an Other free text. */
function DemandPicker({
  picks, setPicks, other, setOther,
}: {
  picks: string[];
  setPicks: (v: string[]) => void;
  other: string;
  setOther: (v: string) => void;
}) {
  const toggle = (p: string) =>
    setPicks(picks.includes(p) ? picks.filter((x) => x !== p) : [...picks, p]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {INDUSTRY_OPTIONS.map((p) => {
          const on = picks.includes(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {on ? <Check className="mr-1 inline size-3" /> : null}
              {p === "Other" ? "Other…" : p}
            </button>
          );
        })}
      </div>
      {picks.includes("Other") ? (
        <Input
          dir="auto"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="What else are they looking for?"
          className="h-9"
          maxLength={200}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ booking link card

/** Option lists for the scheduling controls (v28 — Google-Calendar parity).
 *  A stored custom value not in the list is appended so it never disappears. */
const SLOT_CHOICES = [15, 30, 45, 60, 90, 120];
const BUFFER_CHOICES = [0, 5, 10, 15, 30];
const NOTICE_CHOICES: { value: number; label: string }[] = [
  { value: 15, label: "15 minutes" },
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "1 day" },
];
const ADVANCE_CHOICES = [7, 14, 30, 60];

const withCurrent = (choices: number[], current: number) =>
  choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);

const todayYmd = () =>
  // Cairo-pinned — the browser's local date is the wrong calendar here
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

/** "My booking link" — the member's public /book/<slug> page: slug, slot
 *  length, availability (weekly rows + one-off dates) and — v28 — buffer,
 *  minimum notice, maximum advance, an active date range and the guests-can-
 *  invite toggle. All times Cairo. */
function BookingLinkCard({ booking, origin }: { booking: MyIrBooking; origin: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const s = booking.settings;
  const [slug, setSlug] = useState(s?.slug ?? booking.suggestedSlug);
  const [slot, setSlot] = useState(String(s?.slot_minutes ?? 30));
  const [rows, setRows] = useState<IrAvailabilityRow[]>(
    s?.availability?.length ? s.availability : [{ day: 6, from: "18:00", to: "21:00" }]
  );
  const [active, setActive] = useState(s?.active ?? true);
  const [buffer, setBuffer] = useState(String(s?.buffer_minutes ?? 0));
  const [notice, setNotice] = useState(String(s?.min_notice_minutes ?? 60));
  const [advance, setAdvance] = useState(String(s?.max_advance_days ?? 14));
  const [startDate, setStartDate] = useState(s?.start_date ?? "");
  const [endDate, setEndDate] = useState(s?.end_date ?? "");
  const [guestsInvite, setGuestsInvite] = useState(s?.guests_can_invite ?? true);
  const [open, setOpen] = useState(!s); // first-timers see the setup expanded
  const [copied, setCopied] = useState(false);

  const savedLink = s ? `${origin}/book/${s.slug}` : null;

  const setRow = (i: number, patch: Partial<IrAvailabilityRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setRowMode = (i: number, mode: "weekly" | "date") =>
    setRows(
      rows.map((r, j) =>
        j === i
          ? mode === "date"
            ? { date: r.date ?? todayYmd(), from: r.from, to: r.to }
            : { day: r.day ?? 6, from: r.from, to: r.to }
          : r
      )
    );

  const copy = async () => {
    if (!savedLink) return;
    try {
      await navigator.clipboard.writeText(savedLink);
      setCopied(true);
      toast.success("Booking link copied — send it to the IRs abroad 🌍");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — long-press / select the link instead.");
    }
  };

  const save = () =>
    start(async () => {
      const res = await saveIrBookingSettings({
        slug,
        slotMinutes: Number(slot),
        availability: rows,
        active,
        bufferMinutes: Number(buffer),
        minNoticeMinutes: Number(notice),
        maxAdvanceDays: Number(advance),
        startDate: startDate || null,
        endDate: endDate || null,
        guestsCanInvite: guestsInvite,
      });
      if (res.ok) {
        toast.success(active ? "Booking link saved — it's live ✨" : "Booking link saved (switched off).");
        router.refresh();
      } else toast.error(res.error);
    });

  const noticeChoices = NOTICE_CHOICES.some((c) => c.value === Number(notice))
    ? NOTICE_CHOICES
    : [...NOTICE_CHOICES, { value: Number(notice), label: `${notice} minutes` }].sort(
        (a, b) => a.value - b.value
      );

  return (
    <Card className="rise-in">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4 text-primary" /> My booking link
            {s ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  s.active
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {s.active ? "Live" : "Off"}
              </span>
            ) : null}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : s ? "Edit" : "Set up"}
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          IRs abroad pick a free slot on your public page — the call lands here
          as <b>scheduled</b>, on your Google Calendar with a <b>Meet link</b>,
          and they get the invite by email. Times are Cairo time.
        </p>
        {savedLink ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <code className="max-w-full truncate rounded-md bg-muted px-2.5 py-1.5 text-xs font-semibold">
              {savedLink}
            </code>
            <Hint label="Copy the link">
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                Copy
              </Button>
            </Hint>
            <Hint label="Open your public booking page">
              <a
                href={savedLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <ExternalLink className="size-3.5" /> Open
              </a>
            </Hint>
          </div>
        ) : null}
      </CardHeader>
      {open ? (
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bk-slug">Link name</Label>
              <div className="flex items-center gap-1">
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {origin.replace(/^https?:\/\//, "")}/book/
                </span>
                <Input
                  id="bk-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="your-name"
                  className="h-9"
                  maxLength={40}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                3–40 characters: lowercase letters, numbers and dashes.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Slot length</Label>
              <Select value={slot} onValueChange={setSlot}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {withCurrent(SLOT_CHOICES, Number(slot)).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* v28 scheduling controls — Google-Calendar appointment parity */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Buffer between calls</Label>
              <Select value={buffer} onValueChange={setBuffer}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {withCurrent(BUFFER_CHOICES, Number(buffer)).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 0 ? "No buffer" : `${m} minutes`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Minimum notice</Label>
              <Select value={notice} onValueChange={setNotice}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {noticeChoices.map((c) => (
                    <SelectItem key={c.value} value={String(c.value)}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Book up to</Label>
              <Select value={advance} onValueChange={setAdvance}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {withCurrent(ADVANCE_CHOICES, Number(advance)).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} days ahead
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bk-start">Schedule starts (optional)</Label>
              <Input
                id="bk-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-end">Schedule ends (optional)</Label>
              <Input
                id="bk-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Availability (Cairo time)</Label>
            <div className="space-y-2">
              {rows.map((r, i) => {
                const isDate = r.date != null;
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Select
                      value={isDate ? "date" : "weekly"}
                      onValueChange={(v) => setRowMode(i, v as "weekly" | "date")}
                    >
                      <SelectTrigger className="h-9 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Every week</SelectItem>
                        <SelectItem value="date">One date only</SelectItem>
                      </SelectContent>
                    </Select>
                    {isDate ? (
                      <Input
                        type="date"
                        value={r.date ?? ""}
                        onChange={(e) => setRow(i, { date: e.target.value })}
                        className="h-9 w-36"
                        aria-label="Date"
                      />
                    ) : (
                      <Select
                        value={String(r.day ?? 6)}
                        onValueChange={(v) => setRow(i, { day: Number(v) })}
                      >
                        <SelectTrigger className="h-9 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEK_DAYS.map((d) => (
                            <SelectItem key={d.value} value={String(d.value)}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Input
                      type="time"
                      step={900}
                      value={r.from}
                      onChange={(e) => setRow(i, { from: e.target.value })}
                      className="h-9 w-28"
                      aria-label="From"
                    />
                    <span className="text-sm text-muted-foreground">→</span>
                    <Input
                      type="time"
                      step={900}
                      value={r.to}
                      onChange={(e) => setRow(i, { to: e.target.value })}
                      className="h-9 w-28"
                      aria-label="To"
                    />
                    <Hint label="Remove this window">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground hover:text-destructive"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      >
                        <X className="size-4" />
                      </Button>
                    </Hint>
                  </div>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRows([...rows, { day: 6, from: "18:00", to: "21:00" }])}
                disabled={rows.length >= 21}
              >
                <Plus className="size-4" /> Add hours
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={guestsInvite} onCheckedChange={setGuestsInvite} />
                Guests can invite others to the Meet
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={active} onCheckedChange={setActive} />
                {active ? "Link is ON — bookable" : "Link is OFF — nobody can book"}
              </label>
            </div>
            <Hint label="Saves the link — the public page updates instantly">
              <Button onClick={save} disabled={pending || !slug.trim()}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Save link
              </Button>
            </Hint>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------ IR calls

const CALL_STATUS_CHIP: Record<
  IrCallRow["status"],
  { label: string; className: string }
> = {
  scheduled: { label: "Scheduled", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  completed: { label: "Completed", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground line-through" },
};

// ------------------------------------------------- universal table columns

/** The IR call log's columns — the classic five plus everything the booking
 *  flow collects, one checkbox away in ⚙ Columns. */
const CALL_COLUMNS: TableColumn[] = [
  { key: "when", label: "When" },
  { key: "lc", label: "Partner LC", required: true },
  { key: "by", label: "By" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
  { key: "screenshot", label: "Screenshot" },
  { key: "demand", label: "Demand", defaultHidden: true },
  { key: "campaigns", label: "B2C campaigns", defaultHidden: true },
  { key: "booker", label: "Booked by", defaultHidden: true },
  { key: "booker_email", label: "Booker email", defaultHidden: true },
  { key: "booker_phone", label: "Booker phone", defaultHidden: true },
  { key: "duration", label: "Duration", defaultHidden: true },
];

const CALL_CELL_CLASS: Record<string, string> = {
  when: "whitespace-nowrap text-sm",
  lc: "font-medium",
  notes: "max-w-64",
  screenshot: "text-right",
  demand: "max-w-40 truncate text-xs",
  campaigns: "max-w-40 truncate text-xs text-muted-foreground",
  booker: "max-w-40 truncate text-sm",
  booker_email: "max-w-48 truncate text-xs text-muted-foreground",
  duration: "whitespace-nowrap text-sm text-muted-foreground",
};

const CALL_SORTERS: Record<string, (c: IrCallRow) => string | number | null> = {
  when: (c) => c.called_at,
  lc: (c) => c.partner_lc_name,
  by: (c) => c.member_name,
  status: (c) => c.status,
  notes: (c) => c.notes,
  demand: (c) => c.demand,
  campaigns: (c) => c.b2c_campaigns,
  booker: (c) => c.booker_name,
  booker_email: (c) => c.booker_email,
  booker_phone: (c) => c.booker_phone,
  duration: (c) => c.duration_minutes,
  screenshot: (c) => (c.screenshot_link ? 1 : 0),
};

/** The CV pool's columns (the desktop table — phones keep the cards). */
const CV_COLUMNS: TableColumn[] = [
  { key: "person", label: "Person", required: true },
  { key: "lc", label: "Partner LC" },
  { key: "industry", label: "Industry" },
  { key: "skills", label: "Skills" },
  { key: "summary", label: "Summary" },
  { key: "status", label: "AI status" },
  { key: "contact", label: "Contact" },
  { key: "created", label: "Uploaded" },
  { key: "actions", label: "Actions" },
  { key: "uploader", label: "Uploaded by", defaultHidden: true },
  { key: "email", label: "Email", defaultHidden: true },
  { key: "phone", label: "Phone", defaultHidden: true },
  { key: "file", label: "File name", defaultHidden: true },
];

const CV_CELL_CLASS: Record<string, string> = {
  person: "max-w-48",
  lc: "max-w-36 truncate text-sm text-muted-foreground",
  skills: "max-w-56",
  summary: "max-w-64",
  created: "whitespace-nowrap text-xs text-muted-foreground",
  uploader: "max-w-36 truncate text-sm text-muted-foreground",
  email: "max-w-48 truncate text-sm text-muted-foreground",
  phone: "whitespace-nowrap text-sm text-muted-foreground",
  file: "max-w-48 truncate text-xs text-muted-foreground",
  actions: "text-right",
};

const CV_SORTERS: Record<string, (c: CvRow) => string | number | null> = {
  person: (c) => c.person_name || c.file_name,
  lc: (c) => c.partner_lc_name,
  industry: (c) => c.industry,
  skills: (c) => c.skills,
  summary: (c) => c.summary,
  status: (c) => c.extraction_status,
  created: (c) => c.created_at,
  uploader: (c) => c.uploader_name,
  email: (c) => c.email,
  phone: (c) => c.phone,
  file: (c) => c.file_name,
};

function IrCallsTab({
  data, lcs, onLcCreated, goPage, viewer, booking, origin,
  pageSize, pageSizeOptions, onPageSize,
}: {
  pageSize: number;
  pageSizeOptions: number[];
  onPageSize: (n: number) => void;
  data: CallsData;
  lcs: (PartnerLc | PartnerLcDetail)[];
  onLcCreated: (lc: PartnerLc) => void;
  goPage: (p: number) => void;
  viewer: ViewerInfo;
  booking: MyIrBooking | null;
  origin: string;
}) {
  const [completing, setCompleting] = useState<IrCallRow | null>(null);
  const [cancelling, setCancelling] = useState<IrCallRow | null>(null);
  const [rescheduling, setRescheduling] = useState<IrCallRow | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const canTouch = (c: IrCallRow) => viewer.isVp || c.member_id === viewer.id;
  const pages = Math.max(1, Math.ceil(data.total / pageSize));

  // ⚙ Columns + click-to-sort over the page in hand
  const cols = useTableColumns("consideration-calls", CALL_COLUMNS);
  const { sorted: sortedCalls, sortKey, dir, toggle: toggleSort } =
    useTableSort(data.rows, CALL_SORTERS);

  /** One call-log cell, by column key. */
  const callCell = (c: IrCallRow, key: string): React.ReactNode => {
    const chip = CALL_STATUS_CHIP[c.status] ?? CALL_STATUS_CHIP.completed;
    switch (key) {
      case "when":
        return fmtDateTime(c.called_at);
      case "lc":
        return <span dir="auto">{c.partner_lc_name}</span>;
      case "by":
        return <span dir="auto">{c.member_name}</span>;
      case "status":
        return (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", chip.className)}>
            {chip.label}
          </span>
        );
      case "notes":
        return (
          <>
            {c.demand && !cols.isVisible("demand") ? (
              <p className="line-clamp-1 text-xs font-medium" dir="auto">
                Demand: {c.demand}
              </p>
            ) : null}
            <span className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
              {c.notes || (c.demand ? "" : "—")}
            </span>
          </>
        );
      case "screenshot":
        return c.screenshot_link ? (
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
        );
      case "demand":
        return <span dir="auto">{c.demand ?? "—"}</span>;
      case "campaigns":
        return <span dir="auto">{c.b2c_campaigns ?? "—"}</span>;
      case "booker":
        return <span dir="auto">{c.booker_name ?? "—"}</span>;
      case "booker_email":
        return c.booker_email ?? "—";
      case "booker_phone":
        return c.booker_phone ? (
          <a
            href={`https://wa.me/${c.booker_phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
          >
            {c.booker_phone}
          </a>
        ) : (
          "—"
        );
      case "duration":
        return c.duration_minutes ? `${c.duration_minutes} min` : "—";
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {booking ? <BookingLinkCard booking={booking} origin={origin} /> : null}

      {data.scheduled.length > 0 ? (
        <Card className="rise-in border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-primary" /> Scheduled calls
              <Badge variant="secondary">{data.scheduled.length}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Booked through the links — soonest first. During the call, open it
              and fill the in-call notes.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.scheduled.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words font-semibold" dir="auto">{c.partner_lc_name}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CALL_STATUS_CHIP.scheduled.className)}>
                      {CALL_STATUS_CHIP.scheduled.label}
                    </span>
                    {c.reschedule_requested_at ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        Reschedule asked
                      </span>
                    ) : null}
                  </div>
                  <p className="break-words text-sm text-muted-foreground">
                    {fmtDateTime(c.called_at)}
                    {c.booker_name ? ` · booked by ${c.booker_name}` : ""}
                    {" · with "}
                    <span dir="auto">{c.member_name}</span>
                  </p>
                  {c.meet_link ? (
                    <a
                      href={c.meet_link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      <Video className="size-3.5" /> Join the Google Meet
                    </a>
                  ) : null}
                </div>
                {canTouch(c) ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* v32.6: the booking collects the IR's number with its
                        country code, so reaching them is one tap */}
                    {c.booker_phone ? (
                      <Hint label={`WhatsApp ${c.booker_name ?? "the IR"} — ${c.booker_phone}`}>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="text-emerald-600 dark:text-emerald-400"
                        >
                          <a
                            href={`https://wa.me/${c.booker_phone.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <WhatsAppIcon className="size-4" /> WhatsApp
                          </a>
                        </Button>
                      </Hint>
                    ) : null}
                    <Hint label="Fill the in-call notes — demand, notes, screenshot">
                      <Button size="sm" onClick={() => setCompleting(c)}>
                        <ClipboardCheck className="size-4" /> Fill call notes
                      </Button>
                    </Hint>
                    {c.has_manage_link && c.booker_email ? (
                      <Hint
                        label={
                          c.reschedule_requested_at
                            ? "Already asked — the IR picks the new time from their email"
                            : "Can't make it? Email the IR to pick a new time"
                        }
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!c.reschedule_requested_at}
                          onClick={() => setRescheduling(c)}
                        >
                          <CalendarClock className="size-4" />
                          {c.reschedule_requested_at ? "Asked ✓" : "Reschedule"}
                        </Button>
                      </Hint>
                    ) : null}
                    <Hint label="Cancel this call — the IR gets your reason by email">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground hover:text-destructive"
                        onClick={() => setCancelling(c)}
                      >
                        <X className="size-4" />
                      </Button>
                    </Hint>
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* manual record — for calls that were never booked */}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setManualOpen((o) => !o)}
          className="w-full justify-between sm:w-auto"
        >
          <span className="flex items-center gap-1.5">
            <Globe2 className="size-4" /> Record a past call manually
          </span>
          <ChevronDown className={cn("size-4 transition-transform", manualOpen && "rotate-180")} />
        </Button>
        {manualOpen ? (
          <div className="mt-2">
            <ManualCallForm lcs={lcs} onLcCreated={onLcCreated} canManageLcs={viewer.isVp} />
          </div>
        ) : null}
      </div>

      <Card className="rise-in">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Call log{data.total ? ` (${data.total})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No completed IR calls yet — book one via your link or record one
              manually above. 🌍
            </p>
          ) : (
            <>
              {/* desktop table */}
              <div className="hidden justify-end md:flex">
                <TableSettings columns={cols} />
              </div>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {cols.visible.map((c) => (
                        <TableHead
                          key={c.key}
                          className={c.key === "screenshot" ? "text-right" : undefined}
                        >
                          <SortHeader
                            label={c.label}
                            onClick={() => toggleSort(c.key, c.key === "when" ? "desc" : "asc")}
                            active={sortKey === c.key}
                            dir={dir}
                          />
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCalls.map((c) => (
                      <TableRow key={c.id}>
                        {cols.visible.map((col) => (
                          <TableCell key={col.key} className={CALL_CELL_CLASS[col.key]}>
                            {callCell(c, col.key)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* mobile cards */}
              <div className="space-y-2 md:hidden">
                {sortedCalls.map((c) => {
                  const chip = CALL_STATUS_CHIP[c.status] ?? CALL_STATUS_CHIP.completed;
                  return (
                    <div key={c.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 break-words font-semibold" dir="auto">
                          {c.partner_lc_name}
                        </p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {fmtDateTime(c.called_at)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", chip.className)}>
                          {chip.label}
                        </span>
                        <p className="min-w-0 break-words text-xs text-muted-foreground" dir="auto">by {c.member_name}</p>
                      </div>
                      {c.demand ? (
                        <p className="mt-1 break-words text-xs font-medium" dir="auto">Demand: {c.demand}</p>
                      ) : null}
                      {c.notes ? (
                        <p className="mt-1 line-clamp-3 break-words text-sm" dir="auto">{c.notes}</p>
                      ) : null}
                      {c.screenshot_link ? (
                        <a
                          href={c.screenshot_link}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 inline-flex max-w-full items-center gap-1 break-words text-sm font-medium text-primary"
                        >
                          <ImagePlus className="size-3.5" /> Open screenshot in Drive
                        </a>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {data.total > 0 ? (
                <div className="flex justify-end border-t pt-3">
                  <PageSizePicker
                    value={pageSize}
                    options={pageSizeOptions}
                    onChange={onPageSize}
                  />
                </div>
              ) : null}
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

      <CompleteCallDialog call={completing} onClose={() => setCompleting(null)} />
      <CancelCallDialog call={cancelling} onClose={() => setCancelling(null)} />
      <RequestRescheduleDialog call={rescheduling} onClose={() => setRescheduling(null)} />
    </div>
  );
}

// ------------------------------------------------------------ manual record form

function ManualCallForm({
  lcs, onLcCreated, canManageLcs,
}: {
  lcs: (PartnerLc | PartnerLcDetail)[];
  onLcCreated: (lc: PartnerLc) => void;
  canManageLcs?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lcId, setLcId] = useState("");
  const [calledAt, setCalledAt] = useState(nowLocal());
  const [notes, setNotes] = useState("");
  const [demand, setDemand] = useState<string[]>([]);
  const [demandOther, setDemandOther] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [shotName, setShotName] = useState("");

  const lcName = lcs.find((l) => l.id === lcId)?.name ?? "";
  const defaultShotName = `IR call — ${lcName || "LC"} — ${(calledAt || "").slice(0, 10)}`;

  const pickFile = (f: File) => {
    if (f.size > IR_SHOT_MAX) {
      toast.error("The screenshot is over 3 MB — compress or crop it, then re-pick.");
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
        demand,
        demandOther: demandOther || null,
        screenshot,
      });
      if (res.ok) {
        toast.success(`IR call with ${lcName} recorded 🌍`);
        if (res.data?.screenshotWarning) toast(res.data.screenshotWarning);
        setNotes("");
        setDemand([]);
        setDemandOther("");
        setFile(null);
        setShotName("");
        setCalledAt(nowLocal());
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Card className="rise-in">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe2 className="size-4 text-primary" /> Record a past call
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          For calls that happened outside the booking link — log every one,
          screenshot included.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Partner LC</Label>
            <PartnerLcPicker
              lcs={lcs}
              value={lcId}
              onChange={setLcId}
              onCreated={onLcCreated}
              manage={{ canEdit: !!canManageLcs }}
            />
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
          <Label>What is their demand? (domains — optional)</Label>
          <DemandPicker picks={demand} setPicks={setDemand} other={demandOther} setOther={setDemandOther} />
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
            <Label>Screenshot (optional, encouraged)</Label>
            <FileDrop
              onFile={pickFile}
              accept="image/*"
              label="Drop the screenshot here — or click to browse"
              hint="image · up to 3 MB"
              fileName={file?.name ?? null}
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
  );
}

// ------------------------------------------------------------ in-call dialogs

/** The in-call notes: fills demand + notes + screenshot and
 *  flips the scheduled call to completed. */
function CompleteCallDialog({ call, onClose }: { call: IrCallRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [demand, setDemand] = useState<string[]>([]);
  const [demandOther, setDemandOther] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // closed → forget which call we loaded, so reopening always rehydrates
  if (!call && loadedFor !== null) setLoadedFor(null);
  if (call && loadedFor !== call.id) {
    setDemand([]);
    setDemandOther("");
    setNotes(call.notes ?? "");
    setFile(null);
    setLoadedFor(call.id);
  }

  const pickFile = (f: File) => {
    if (f.size > IR_SHOT_MAX) {
      toast.error("The screenshot is over 3 MB — compress or crop it, then re-pick.");
      setFile(null);
      return;
    }
    setFile(f);
  };

  const save = () => {
    if (!call) return;
    start(async () => {
      let screenshot: { name: string; mimeType: string; dataBase64: string } | undefined;
      if (file) {
        try {
          screenshot = {
            name: `IR call — ${call.partner_lc_name} — ${call.called_at.slice(0, 10)}`,
            mimeType: file.type || "image/png",
            dataBase64: await fileToBase64(file),
          };
        } catch {
          toast.error("Could not read the screenshot file — try re-picking it.");
          return;
        }
      }
      const res = await completeIrCall(call.id, {
        demand,
        demandOther: demandOther || null,
        notes: notes || null,
        screenshot,
      });
      if (res.ok) {
        toast.success(`Call with ${call.partner_lc_name} completed ✅`);
        if (res.data?.screenshotWarning) toast(res.data.screenshotWarning);
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <Dialog open={!!call} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>In-call notes — {call?.partner_lc_name}</DialogTitle>
          <DialogDescription>
            {call ? fmtDateTime(call.called_at) : ""} · saving marks the call
            completed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>What is their demand?</Label>
            <DemandPicker picks={demand} setPicks={setDemand} other={demandOther} setOther={setDemandOther} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-notes">Notes</Label>
            <Textarea
              id="cc-notes"
              dir="auto"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was discussed, agreements, follow-ups…"
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Screenshot</Label>
            <FileDrop
              onFile={pickFile}
              accept="image/*"
              label="Drop the call screenshot here — or click to browse"
              hint="image · up to 3 MB"
              fileName={file?.name ?? null}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
              Save — mark completed
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CancelCallDialog({ call, onClose }: { call: IrCallRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // reopening always starts with a fresh reason
  if (!call && loadedFor !== null) setLoadedFor(null);
  if (call && loadedFor !== call.id) {
    setReason("");
    setLoadedFor(call.id);
  }

  const cancel = () => {
    if (!call || !reason.trim()) return;
    start(async () => {
      const res = await cancelIrCall(call.id, reason);
      if (res.ok) {
        toast.success("Call cancelled — the slot is free again and the IR was told why.");
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });
  };
  return (
    <Dialog open={!!call} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cancel this call?</DialogTitle>
          <DialogDescription dir="auto">
            The {call ? fmtDateTime(call.called_at) : ""} call with{" "}
            {call?.partner_lc_name} will be cancelled and its slot opens up on
            your booking page again. The calendar event is removed, and the IR
            gets your reason by email with a link to rebook.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cx-reason">Why? (the IR reads this) *</Label>
          <Textarea
            id="cx-reason"
            dir="auto"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. An urgent LC event landed on that evening…"
            rows={2}
            maxLength={500}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Keep it</Button>
          <Button variant="destructive" onClick={cancel} disabled={pending || !reason.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            Cancel the call
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** v28 — "can't make it, let THEM pick": emails the IR their manage link so
 *  they choose the new time from the live availability. */
function RequestRescheduleDialog({
  call, onClose,
}: {
  call: IrCallRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [why, setWhy] = useState("");
  const ask = () => {
    if (!call) return;
    if (why.trim().length < 3) {
      toast.error("Add a short reason — the IR reads it.");
      return;
    }
    start(async () => {
      const res = await requestIrReschedule(call.id, why.trim());
      if (res.ok) {
        toast.success("The IR got an email — they'll pick the new time. 📧");
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });
  };
  return (
    <Dialog open={!!call} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ask to move this call?</DialogTitle>
          <DialogDescription dir="auto">
            {call?.booker_name ? `${call.booker_name} of ` : ""}
            {call?.partner_lc_name} gets an email saying you can&apos;t make{" "}
            {call ? fmtDateTime(call.called_at) : ""} — with a link to pick a
            new time from your live availability. The current time stays booked
            until they choose.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="resched-why">Why? *</Label>
          <Textarea
            id="resched-why"
            dir="auto"
            rows={2}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="e.g. A clash came up on my side — sorry!"
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground">
            This goes to them word for word — be kind and specific.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Never mind</Button>
          <Button onClick={ask} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
            Send the ask
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  pageSize, pageSizeOptions,
}: {
  pageSize: number;
  pageSizeOptions: number[];
  data: PageData<CvRow>;
  lcs: (PartnerLc | PartnerLcDetail)[];
  onLcCreated: (lc: PartnerLc) => void;
  q: string;
  viewer: ViewerInfo;
  setParams: (patch: Record<string, string | null>) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(q);
  // URL is the source of truth — chip clears / back-nav must reflect here
  // (adjust-during-render, no effect: https://react.dev/learn/you-might-not-need-an-effect)
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setSearch(q);
  }
  const [file, setFile] = useState<File | null>(null);
  const [lcId, setLcId] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [editing, setEditing] = useState<CvRow | null>(null);
  const [deleting, setDeleting] = useState<CvRow | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);

  const pickFile = (f: File) => {
    if (f.size > CV_MAX) {
      toast.error(`"${f.name}" is over 25 MB — compress it and try again.`);
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
      if (!lcId) {
        toast.error("Pick the partner LC this CV came from.");
        return;
      }
      setPhase("uploading");
      try {
        // hash the bytes FIRST — an exact duplicate is refused before a byte
        // is stored or a Gemini call is made (v33.2)
        let sha256: string | undefined;
        try {
          const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
          sha256 = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        } catch {
          // no crypto.subtle (very old browser / insecure origin) — upload
          // still works, it just can't be de-duplicated
        }
        const meta = {
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          sha256,
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

  const pages = Math.max(1, Math.ceil(data.total / pageSize));

  // ⚙ Columns + click-to-sort for the desktop table (phones keep the cards)
  const cols = useTableColumns("consideration-cvs", CV_COLUMNS);
  const { sorted: sortedCvs, sortKey, dir, toggle: toggleSort } =
    useTableSort(data.rows, CV_SORTERS);

  /** The WhatsApp / call / email shortcuts of one CV. */
  const cvContacts = (cv: CvRow) => {
    const wa = waDigits(cv.phone);
    const btn =
      "inline-flex size-8 items-center justify-center rounded-md border transition-colors hover:bg-muted";
    return (
      <span className="flex items-center gap-1">
        {wa ? (
          <Hint label={`WhatsApp ${cv.phone}`}>
            <a
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noreferrer"
              className={cn(btn, "text-emerald-600 dark:text-emerald-400")}
              aria-label="WhatsApp"
            >
              <WhatsAppIcon className="size-3.5" />
            </a>
          </Hint>
        ) : null}
        {cv.phone ? (
          <Hint label={`Call ${cv.phone}`}>
            <a href={`tel:${cv.phone}`} className={btn} aria-label="Call">
              <Phone className="size-3.5" />
            </a>
          </Hint>
        ) : null}
        {cv.email ? (
          <Hint label={cv.email}>
            <a href={`mailto:${cv.email}`} className={btn} aria-label="Email">
              <Mail className="size-3.5" />
            </a>
          </Hint>
        ) : null}
        {!cv.phone && !cv.email ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : null}
      </span>
    );
  };

  /** One CV cell of the desktop table, by column key. */
  const cvCell = (cv: CvRow, key: string): React.ReactNode => {
    const canManage = viewer.isVp || cv.uploaded_by === viewer.id;
    switch (key) {
      case "person":
        return (
          <>
            <span className="block truncate font-medium" dir="auto">
              {cv.person_name || cv.file_name}
            </span>
            {cols.isVisible("uploader") ? null : (
              <span className="block truncate text-xs text-muted-foreground" dir="auto">
                by {cv.uploader_name}
              </span>
            )}
          </>
        );
      case "lc":
        return <span dir="auto">{cv.partner_lc_name ?? "—"}</span>;
      case "industry":
        return cv.industry ? <Badge variant="secondary">{cv.industry}</Badge> : "—";
      case "skills":
        return (
          <span className="line-clamp-2 text-xs" dir="auto">
            {cv.skills || "—"}
          </span>
        );
      case "summary":
        return (
          <span className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
            {cv.summary || "—"}
          </span>
        );
      case "status": {
        const chip = STATUS_CHIP[cv.extraction_status];
        return (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", chip.className)}>
            {chip.label}
          </span>
        );
      }
      case "contact":
        return cvContacts(cv);
      case "created":
        return fmtDateTime(cv.created_at);
      case "uploader":
        return <span dir="auto">{cv.uploader_name}</span>;
      case "email":
        return cv.email ?? "—";
      case "phone":
        return cv.phone ?? "—";
      case "file":
        return <span dir="auto">{cv.file_name}</span>;
      case "actions":
        return (
          <span className="flex items-center justify-end gap-1">
            <Hint label="Open the CV file (10-min private link)">
              <Button variant="outline" size="sm" onClick={() => openFile(cv)}>
                <FileText className="size-4" /> Open
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
                </Button>
              </Hint>
            ) : null}
            {canManage ? (
              <>
                <Hint label="Fix the extracted fields">
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(cv)}>
                    <Pencil className="size-4" />
                  </Button>
                </Hint>
                <Hint label="Delete this CV (file included)">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleting(cv)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </Hint>
              </>
            ) : null}
          </span>
        );
      default:
        return null;
    }
  };

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
              <Label>CV file</Label>
              <FileDrop
                onFile={pickFile}
                label="Drop the CV here — or click to browse"
                hint="any format · up to 25 MB"
                fileName={file?.name ?? null}
                disabled={phase !== "idle"}
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
                manage={{ canEdit: viewer.isVp }}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Hint label="Uploads to the private CV pool, then the AI extracts the fields">
              <Button onClick={upload} disabled={pending || !file || !lcId}>
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
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            dir="auto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setParams({ q: search, page: null }); }}
            onBlur={() => { if (search !== q) setParams({ q: search, page: null }); }}
            placeholder="Search: C#, ERP, marketing, a name…"
            className="h-9 w-full pl-8 sm:w-64"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Searches names, skills, industries and the CVs&apos; full text · {data.total} CV{data.total === 1 ? "" : "s"}
        </p>
        {/* ⚙ Columns — the pool reads like a sheet on desktop */}
        <TableSettings columns={cols} className="ml-auto hidden md:inline-flex" />
      </div>

      {data.rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {q ? "No CVs match this search." : "The CV pool is empty — upload the first one above. 📄"}
          </CardContent>
        </Card>
      ) : (
        <>
        {/* desktop: one wide table, columns under the member's control */}
        <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
          <Table>
            <TableHeader>
              <TableRow>
                {cols.visible.map((c) =>
                  c.key === "actions" || c.key === "contact" ? (
                    <TableHead
                      key={c.key}
                      className={c.key === "actions" ? "text-right" : undefined}
                    >
                      {c.label}
                    </TableHead>
                  ) : (
                    <TableHead key={c.key}>
                      <SortHeader
                        label={c.label}
                        onClick={() => toggleSort(c.key, c.key === "created" ? "desc" : "asc")}
                        active={sortKey === c.key}
                        dir={dir}
                      />
                    </TableHead>
                  )
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCvs.map((cv) => (
                <TableRow key={cv.id}>
                  {cols.visible.map((c) => (
                    <TableCell key={c.key} className={CV_CELL_CLASS[c.key]}>
                      {cvCell(cv, c.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* phones: cards */}
        <div className="grid gap-3 md:hidden">
          {sortedCvs.map((cv) => {
            const chip = STATUS_CHIP[cv.extraction_status];
            const wa = waDigits(cv.phone);
            const mine = cv.uploaded_by === viewer.id;
            const canManage = viewer.isVp || mine;
            return (
              <Card key={cv.id} className="rise-in">
                <CardContent className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
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
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
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
        </>
      )}

      {data.total > 0 ? (
        <div className="flex justify-end">
          <PageSizePicker
            value={pageSize}
            options={pageSizeOptions}
            onChange={(n: number) => setParams({ size: String(n), page: null })}
          />
        </div>
      ) : null}
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
  lcs: (PartnerLc | PartnerLcDetail)[];
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
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
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
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto">
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
