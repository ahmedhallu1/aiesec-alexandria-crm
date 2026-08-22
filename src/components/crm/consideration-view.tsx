"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarClock, Check, ChevronDown, ClipboardCheck, Copy, ExternalLink,
  Building2, FileText, Globe2, Handshake, History, ImagePlus, Link2, Loader2, Mail,
  MessageSquare, Pencil, Phone, Plus, RotateCcw, Send,
  Search, Settings2, Sparkles, Trash2, Upload, UserRound, UserRoundPlus, Video, X,
} from "lucide-react";
import {
  addPartnerLc, addPartnerLcComment, cancelIrCall, completeIrCall, confirmCvUpload,
  deleteCv, deletePartnerLcComment,
  addPartnerLcContact, createIgtExpectationDraft, deleteIrCall, deletePartnerLc,
  getCvFileUrl,
  previewIgtExpectationMail,
  assignLcPartnership, clearLcPartnershipTarget,
  recordIrCall, recordLcPartnership, requestCvUpload, sendIgtExpectationMail,
  reassignIrCall, requestIrReschedule, rerunCvExtraction, saveIrBookingSettings,
  updateCvFields, updateIrBookerEmail, updatePartnerLc,
} from "@/server/actions";
import type {
  PartnerLcDetail,
  BookingIssue, BookingIssueField,
  CvRow, IrAvailabilityRow, IrCallRow, MyIrBooking, PartnerLc,
  IrSlotRequest,
} from "@/server/data";
import { IR_ROLES, normalizePhone, fmtDateTime } from "@/lib/types";
import { phoneExample } from "@/lib/dial-codes";
import { whenLabelInZone } from "@/lib/timezones";
import { availabilityIssues } from "@/lib/availability";
import { cn } from "@/lib/utils";
import { CountryInput } from "./country-input";
import {
  ColumnFilter,
  DateRangeFilter, FilterSelect, PageSizePicker, resizableCellStyle, ResizableHead,
  SortHeader, TableSettings, useTableColumns, useTableSort, type TableColumn,
} from "./data-table-kit";
import { FileDrop } from "./file-drop";
import { Hint } from "./hint";
import { WalkingLoader } from "./walking-loader";
import { WhatsAppIcon } from "./icons";
import { Badge } from "@/components/ui/badge";
import { IrSlotRequestsCard } from "./ir-slot-requests-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
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

/** THE CALL LOG'S FILTERS (v33.32) — the log is server-paged, so these live in
 *  the URL and are applied in the query: they filter the whole history, not
 *  the fifty rows in hand. Namespaced params (`call*`) because the CV tab and
 *  the LC registry share this page's query string. */
export interface CallFilterState {
  q?: string;
  product?: string;
  status?: string;
  member?: string;
  lc?: string;
  /** v33.40 — what the call carries: notes / screenshot / cvpool / bounced */
  has?: string;
  /** v33.40 — server-side sort over the WHOLE log, not the page in hand */
  sort?: string;
  dir?: string;
  from?: string;
  to?: string;
}

const CALL_PARAM: Record<string, string> = {
  q: "callq",
  product: "callproduct",
  status: "callstatus",
  member: "callmember",
  lc: "calllc",
  has: "callhas",
  sort: "callsort",
  dir: "calldir",
  from: "callfrom",
  to: "callto",
};

interface ViewerInfo {
  id: string;
  isVp: boolean;
  /** the viewer's own team (v33.33) — a Team Leader answers for their calls
   *  too, so the "needs you" banner counts them */
  teamIds: string[];
  showCvs: boolean;
  showExpectation: boolean;
  /** MMs and above may remove a partner LC from the registry */
  canManageLcs: boolean;
  /** MMs and above hand out 🎯 partnership targets (v33.38) */
  canAssignPartnerships: boolean;
  /** MMs and above may hand a booked IR call to another host (v33.58) */
  canHandOverCalls: boolean;
  /** the record form's product default — the viewer's own side, when single */
  defaultProduct: "GV" | "GT" | null;
}

/** Who a partnership target can be handed to — already narrowed to the
 *  viewer's own authority by the server. */
export interface PartnershipTarget {
  id: string;
  name: string;
  role: string;
}

// ------------------------------------------------ partner LCs & IRs (v33.5)

/** THE PARTNER-LC RECORD.
 *
 *  Everything the IR calls collected already existed — which LCs we talk to,
 *  in which country, how many calls, how many CVs, and the actual PEOPLE on
 *  the other side with their roles and emails — but it lived inside a ⚙ dialog
 *  meant for renaming, so nobody read it. Relationships with partner LCs
 *  outlive the term that built them; this is the page you hand over.
 *
 *  Clicking an LC in the call log lands here, on that LC. */
/** THE PRODUCT TAG (v33.25) — in the LC's own brand colours, not a grey
 *  outline. GV is the Global Volunteer red-orange and GT the Global Talent
 *  teal, the same two the dashboard lanes and the product badges use, so a
 *  GV call reads as GV everywhere in the system. */
export function ProductTag({ product, className }: { product: string; className?: string }) {
  const gv = product === "GV";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold text-white",
        className
      )}
      style={{ backgroundColor: gv ? "#F85A40" : "#0CB9C1" }}
    >
      {product}
    </span>
  );
}

/** A compact "any / one value" filter, the shape the rest of the app uses on
 *  its filter bars. Empty string = no filter. */
function FilterPill({
  value, onChange, placeholder, options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: [string, string][];
}) {
  return (
    <Select value={value || "all"} onValueChange={(v) => onChange(v === "all" ? "" : v)}>
      <SelectTrigger className={cn("h-9 w-auto min-w-36", value && "border-primary text-primary")}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PartnerLcsTab({
  lcs,
  highlight,
  viewer,
  partnershipTargets,
}: {
  lcs: (PartnerLc | PartnerLcDetail)[];
  highlight?: string | null;
  viewer: ViewerInfo;
  partnershipTargets: PartnershipTarget[];
}) {
  const [q, setQ] = useState("");
  const [removing, setRemoving] = useState<PartnerLcDetail | null>(null);
  const [editingLc, setEditingLc] = useState<PartnerLcDetail | null>(null);
  const [addingIrTo, setAddingIrTo] = useState<PartnerLcDetail | null>(null);
  const [notesFor, setNotesFor] = useState<PartnerLcDetail | null>(null);
  /** "lc" or a contact id — what the note composer is pointed at when it opens */
  const [notesAbout, setNotesAbout] = useState("lc");
  // 🤝 partnerships (v33.38): record on an LC (null = pick/create the LC in
  // the dialog), and hand out a target
  const [recordingFor, setRecordingFor] = useState<PartnerLcDetail | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordProduct, setRecordProduct] = useState<"GV" | "GT" | null>(null);
  const [assigningFor, setAssigningFor] = useState<PartnerLcDetail | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [fAssignee, setFAssignee] = useState("");
  const [lcForm, setLcForm] = useState({ name: "", country: "" });
  const [irForm, setIrForm] =
    useState({ name: "", role: "", email: "", phone: "", product: "" });
  // WHAT THE REGISTRY IS ASKED (v33.23): which country, which programme we
  // reached them for, and whether we have actually done anything with them.
  const [fCountry, setFCountry] = useState("");
  const [fProduct, setFProduct] = useState<"" | "GV" | "GT" | "both" | "none">("");
  const [fHas, setFHas] = useState<"" | "calls" | "cvs" | "partnership" | "nothing">("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const detailed = lcs.filter((l): l is PartnerLcDetail => "calls" in l);
  const needle = q.trim().toLowerCase();
  const countryOptions = useMemo(
    () => [...new Set(detailed.map((l) => l.country).filter(Boolean) as string[])].sort(),
    [detailed]
  );
  // WHO WORKS IT (v33.39) — derived from the LC's calls: caller + their TL
  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of detailed)
      for (const a of l.assignedTo ?? []) if (!seen.has(a.id)) seen.set(a.id, a.name);
    return [...seen.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [detailed]);
  const shown = detailed.filter((l) => {
    if (
      needle &&
      !l.name.toLowerCase().includes(needle) &&
      !(l.country ?? "").toLowerCase().includes(needle) &&
      !l.contacts.some((c) => (c.name ?? "").toLowerCase().includes(needle))
    )
      return false;
    if (fCountry && (l.country ?? "") !== fCountry) return false;
    if (fProduct) {
      const p = l.products ?? [];
      if (fProduct === "both" && p.length < 2) return false;
      if (fProduct === "none" && p.length > 0) return false;
      if ((fProduct === "GV" || fProduct === "GT") && !p.includes(fProduct)) return false;
    }
    if (fHas === "calls" && l.calls === 0) return false;
    if (fHas === "cvs" && l.cvs === 0) return false;
    if (fHas === "partnership" && !(l.partnerships ?? []).some((p) => p.status === "done"))
      return false;
    if (fHas === "nothing" && (l.calls > 0 || l.cvs > 0)) return false;
    if (fAssignee && !(l.assignedTo ?? []).some((a) => a.id === fAssignee)) return false;
    return true;
  });
  // the linked-to LC first, so the click lands on it
  const ordered = highlight
    ? [...shown].sort((a, b) => (a.id === highlight ? -1 : b.id === highlight ? 1 : 0))
    : shown;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search an LC, a country or an IR…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <FilterPill
          value={fCountry}
          onChange={setFCountry}
          placeholder="🌍 Country"
          options={countryOptions.map((c) => [c, c])}
        />
        <FilterPill
          value={fProduct}
          onChange={(v) => setFProduct(v as typeof fProduct)}
          placeholder="Reached as"
          options={[
            ["GV", "GV"],
            ["GT", "GT"],
            ["both", "Both"],
            ["none", "Never reached"],
          ]}
        />
        <FilterPill
          value={fHas}
          onChange={(v) => setFHas(v as typeof fHas)}
          placeholder="Anything on file"
          options={[
            ["calls", "📞 Has calls"],
            ["cvs", "📄 Has CVs"],
            ["partnership", "🤝 Partnered"],
            ["nothing", "Nothing yet"],
          ]}
        />
        {assigneeOptions.length > 0 ? (
          <FilterPill
            value={fAssignee}
            onChange={setFAssignee}
            placeholder="👥 Assigned to"
            options={assigneeOptions}
          />
        ) : null}
        {fCountry || fProduct || fHas || fAssignee ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFCountry(""); setFProduct(""); setFHas(""); setFAssignee(""); }}
          >
            <X className="size-4" /> Clear
          </Button>
        ) : null}
        <span className="text-sm text-muted-foreground">
          {ordered.length} of {detailed.length}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {viewer.canAssignPartnerships ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setAssigningFor(null); setAssignOpen(true); }}
            >
              🎯 Set a target
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => { setRecordingFor(null); setRecordProduct(null); setRecordOpen(true); }}
          >
            <Handshake className="size-4" /> Record a partnership
          </Button>
        </span>
      </div>

      {/* 🎯 YOUR TARGETS (v33.38) — the LCs someone asked YOU to partner with */}
      {(() => {
        const mine = detailed.flatMap((l) =>
          (l.partnerships ?? [])
            .filter((pp) => pp.status === "pending" && pp.assignedToId === viewer.id)
            .map((pp) => ({ lc: l, pp }))
        );
        if (mine.length === 0) return null;
        return (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              🎯 Your partnership target{mine.length === 1 ? "" : "s"} — approach
              them, open the WhatsApp group, then record it here.
            </p>
            <div className="mt-2 space-y-1.5">
              {mine.map(({ lc, pp }) => (
                <div key={pp.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 break-words font-medium" dir="auto">{lc.name}</span>
                  <ProductTag product={pp.product} />
                  {(lc.callProducts ?? []).includes(pp.product) ? (
                    <span className="text-xs text-muted-foreground">
                      an IR call already reached them for {pp.product} — the
                      relationship exists, hand the target back
                    </span>
                  ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => {
                      setRecordingFor(lc);
                      setRecordProduct(pp.product);
                      setRecordOpen(true);
                    }}
                  >
                    <Handshake className="size-3.5" /> Record it
                  </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-muted-foreground"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await clearLcPartnershipTarget(pp.id);
                        if (!res.ok) { toast.error(res.error); return; }
                        toast.success("Target cleared");
                        router.refresh();
                      })
                    }
                  >
                    Hand it back
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* EDIT an LC — name and country, the two things that go wrong */}
      <Dialog
        open={!!editingLc}
        onOpenChange={(o) => {
          if (o && editingLc) setLcForm({ name: editingLc.name, country: editingLc.country ?? "" });
          if (!o) setEditingLc(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {editingLc?.name}</DialogTitle>
            <DialogDescription>
              The name appears on every call and CV from this LC — fixing it here fixes
              it everywhere.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={lcForm.name || editingLc?.name || ""}
                onChange={(e) => setLcForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Country</Label>
              <CountryInput
                value={lcForm.country}
                onChange={(v) => setLcForm((f) => ({ ...f, country: v }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingLc(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                const target = editingLc;
                if (!target) return;
                start(async () => {
                  const res = await updatePartnerLc(target.id, {
                    name: lcForm.name || target.name,
                    country: lcForm.country || null,
                  });
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success("Partner LC updated");
                  setEditingLc(null);
                  router.refresh();
                });
              }}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADD AN IR — someone we know at that LC who never booked a call */}
      <Dialog
        open={!!addingIrTo}
        onOpenChange={(o) => {
          if (!o) {
            setAddingIrTo(null);
            setIrForm({ name: "", role: "", email: "", phone: "", product: "" });
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add an IR at {addingIrTo?.name}</DialogTitle>
            <DialogDescription>
              For the people you meet outside the booking link — over WhatsApp, at a
              conference, through another LC.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input
                value={irForm.name}
                onChange={(e) => setIrForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Their name"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                {/* A LIST, not free text (v33.23) — the same one the public
                    booking page validates against, so the registry stops
                    holding "LCVP oGT", "IR Manager" and "uw" in one column. */}
                <Label>Role</Label>
                <Select
                  value={irForm.role || undefined}
                  onValueChange={(v) => setIrForm((f) => ({ ...f, role: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Pick their role…" /></SelectTrigger>
                  <SelectContent>
                    {IR_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>We reach them for</Label>
                <Select
                  value={irForm.product || undefined}
                  onValueChange={(v) => setIrForm((f) => ({ ...f, product: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="GV or GT…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GV">GV</SelectItem>
                    <SelectItem value="GT">GT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={irForm.email}
                  onChange={(e) => setIrForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Phone</Label>
                <Input
                  value={irForm.phone}
                  onChange={(e) => setIrForm((f) => ({ ...f, phone: e.target.value }))}
                  // an example from THEIR country, not a Turkish one (v33.23)
                  placeholder={
                    phoneExample(addingIrTo?.country) ?? "+90… with the country code"
                  }
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddingIrTo(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || !irForm.name.trim()}
              onClick={() => {
                const target = addingIrTo;
                if (!target) return;
                start(async () => {
                  const res = await addPartnerLcContact({
                    partnerLcId: target.id,
                    ...irForm,
                  });
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(`${irForm.name} added to ${target.name}`);
                  setAddingIrTo(null);
                  setIrForm({ name: "", role: "", email: "", phone: "", product: "" });
                  router.refresh();
                });
              }}
            >
              {pending ? "Adding…" : "Add the IR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(o) => { if (!o) setRemoving(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              It disappears from the registry. This only works while nothing points at
              it — an LC with calls or CVs against it stays, because deleting it would
              orphan them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={pending}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                const target = removing;
                if (!target) return;
                start(async () => {
                  const res = await deletePartnerLc(target.id);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(`"${target.name}" removed`);
                  setRemoving(null);
                  router.refresh();
                });
              }}
            >
              {pending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LcNotesDialog
        lc={notesFor}
        initialAbout={notesAbout}
        onClose={() => setNotesFor(null)}
        viewerId={viewer.id}
        canManage={viewer.canManageLcs}
      />

      <RecordPartnershipDialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        lc={recordingFor}
        lcs={detailed}
        initialProduct={recordProduct ?? viewer.defaultProduct}
        targets={partnershipTargets}
        viewerId={viewer.id}
        canAssign={viewer.canAssignPartnerships}
      />
      <AssignPartnershipDialog
        open={assignOpen}
        lc={assigningFor}
        lcs={detailed}
        onClose={() => { setAssignOpen(false); setAssigningFor(null); }}
        targets={partnershipTargets}
        defaultProduct={viewer.defaultProduct}
      />

      {ordered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {detailed.length === 0
              ? "No partner LCs yet — they appear as soon as calls are logged."
              : "Nothing matches that search."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {ordered.map((lc) => (
            <Card
              key={lc.id}
              className={cn(
                "rise-in",
                highlight === lc.id && "border-primary ring-1 ring-primary/40"
              )}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {/* THE NAME OWNS A ROW ON A PHONE. With `flex-1` beside six
                      `shrink-0` badges and buttons, a 375px card left the name
                      a sliver and `break-words` then snapped "AIESEC in ABC"
                      one or two characters per line. Full width below sm, back
                      to sharing the row from sm up. */}
                  <span className="w-full min-w-0 break-words sm:w-auto sm:flex-1" dir="auto">
                    {lc.name}
                  </span>
                  {lc.country ? (
                    <Badge variant="secondary" className="font-normal">{lc.country}</Badge>
                  ) : null}
                  {/* WHICH PROGRAMME WE REACHED THEM FOR (v33.23) — derived
                      from their calls and hand-added IRs, so it can say BOTH */}
                  {(lc.products ?? []).map((p) => (
                    <ProductTag key={p} product={p} />
                  ))}
                  {/* THE LC'S WHOLE STORY (v33.24) — a labelled button, not a
                      bare icon: nobody clicks an unexplained glyph to find out
                      whether we have spoken to these people before. */}
                  <Hint label="Every call, CV and note with this LC">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() => { setNotesAbout("lc"); setNotesFor(lc); }}
                    >
                      <History className="size-3.5" /> History
                      {lc.history?.length ? (
                        <span className="ml-0.5 font-bold">{lc.history.length}</span>
                      ) : null}
                    </Button>
                  </Hint>
                  {viewer.canManageLcs ? (
                    <Hint label="Edit this LC's name or country">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0 text-muted-foreground hover:text-primary"
                        onClick={() => setEditingLc(lc)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </Hint>
                  ) : null}
                  {viewer.canManageLcs ? (
                    <Hint label="Remove this LC — only works when no call or CV still points at it">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoving(lc)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </Hint>
                  ) : null}
                </CardTitle>
                <CardDescription>
                  {lc.calls} call{lc.calls === 1 ? "" : "s"}
                  {viewer.showCvs ? ` · ${lc.cvs} CV${lc.cvs === 1 ? "" : "s"}` : ""}
                  {lc.lastCallAt ? ` · last spoke ${fmtDateTime(lc.lastCallAt)}` : " · never spoken"}
                  {(lc.assignedTo ?? []).length > 0
                    ? ` · 👥 ${(lc.assignedTo ?? []).slice(0, 3).map((a) => a.name).join(", ")}${(lc.assignedTo ?? []).length > 3 ? ` +${(lc.assignedTo ?? []).length - 3}` : ""}`
                    : ""}
                </CardDescription>
                {/* 🤝 THE PARTNERSHIP STATE, per product (v33.38) — a made
                    partnership is the floor's other MOS, so it reads first */}
                {(lc.partnerships ?? []).length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {(lc.partnerships ?? []).map((pp) =>
                      pp.status === "done" ? (
                        <Hint
                          key={pp.id}
                          label={`${pp.product} partnership${pp.partnershipDate ? ` since ${pp.partnershipDate}` : ""}${pp.madeByName ? ` — made by ${pp.madeByName}` : ""}${pp.irName ? ` · IR: ${pp.irName}` : ""}`}
                        >
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                            🤝 {pp.product} partnership
                          </span>
                        </Hint>
                      ) : (
                        <Hint
                          key={pp.id}
                          label={`${pp.product} target${pp.assignedToName ? ` — assigned to ${pp.assignedToName}` : ""} — waiting to be made`}
                        >
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                            🎯 {pp.product} → {pp.assignedToName ?? "—"}
                            {viewer.canAssignPartnerships || pp.assignedToId === viewer.id ? (
                              <button
                                type="button"
                                className="ml-0.5 opacity-70 hover:opacity-100"
                                title="Clear this target"
                                onClick={() =>
                                  start(async () => {
                                    const res = await clearLcPartnershipTarget(pp.id);
                                    if (!res.ok) { toast.error(res.error); return; }
                                    toast.success("Target cleared");
                                    router.refresh();
                                  })
                                }
                              >
                                <X className="size-3" />
                              </button>
                            ) : null}
                          </span>
                        </Hint>
                      )
                    )}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* a product with a made partnership OR real IR CALLS is
                      spoken for — both gone = the buttons stand down (v33.39) */}
                  {(() => {
                    const taken = new Set([
                      ...(lc.partnerships ?? [])
                        .filter((pp) => pp.status === "done")
                        .map((pp) => pp.product),
                      ...(lc.callProducts ?? []),
                    ]);
                    if (taken.size >= 2) return null;
                    return (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => {
                            setRecordingFor(lc);
                            setRecordProduct(null);
                            setRecordOpen(true);
                          }}
                        >
                          <Handshake className="size-3.5" /> Partnership
                        </Button>
                        {viewer.canAssignPartnerships ? (
                          <Hint label="Hand this LC to someone as a partnership target">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7"
                              onClick={() => { setAssigningFor(lc); setAssignOpen(true); }}
                            >
                              🎯 Target
                            </Button>
                          </Hint>
                        ) : null}
                      </>
                    );
                  })()}
                  {viewer.canManageLcs ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-fit"
                      onClick={() => setAddingIrTo(lc)}
                    >
                      <Plus className="size-3.5" /> Add an IR
                    </Button>
                  ) : null}
                </div>
                {lc.contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No named IR yet — add one, or the next booking collects it.
                  </p>
                ) : (
                  lc.contacts.map((c, i) => (
                    <div
                      key={`${c.email ?? c.name ?? i}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="min-w-0 break-words text-sm font-medium" dir="auto">
                          {c.name || "—"}
                        </p>
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" dir="auto">
                          {c.role ? <span>{c.role}</span> : null}
                          {c.product ? <ProductTag product={c.product} /> : null}
                          {c.manualId &&
                          (lc.comments ?? []).some((n) => n.contactId === c.manualId) ? (
                            <span title="has notes">💬</span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {/* NOTES ON THIS PERSON (v33.25) — buried in a dropdown
                            inside the history dialog, nobody found it. */}
                        {c.manualId ? (
                          <Hint label={`Notes about ${c.name ?? "this IR"}`}>
                            <Button
                              size="icon"
                              variant="outline"
                              className="size-7"
                              onClick={() => { setNotesAbout(c.manualId!); setNotesFor(lc); }}
                            >
                              <MessageSquare className="size-3.5" />
                            </Button>
                          </Hint>
                        ) : null}
                        {c.phone ? (
                          <Hint label={`WhatsApp ${c.name ?? "them"} — ${c.phone}`}>
                            <Button asChild size="icon" variant="outline" className="size-7">
                              <a
                                href={`https://wa.me/${c.phone.replace(/[^\d]/g, "")}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <WhatsAppIcon className="size-3.5" />
                              </a>
                            </Button>
                          </Hint>
                        ) : null}
                        {c.email ? (
                          <Button asChild size="sm" variant="outline" className="h-7">
                            <a href={`mailto:${c.email}`}>
                              <Mail className="size-3.5" /> Email
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** NOTES ON AN LC — and on the individual IRs inside it (v33.23).
 *
 *  What the crew learns between calls used to live in one call's notes field,
 *  where the next person never looks. A note is either about the ENTITY ("their
 *  oGV peak starts in March") or about a PERSON ("Sarah is the one who actually
 *  answers"), so the composer asks which. */
function LcNotesDialog({
  lc, initialAbout, onClose, viewerId, canManage,
}: {
  lc: PartnerLcDetail | null;
  /** "lc", or the id of the IR the composer should start pointed at */
  initialAbout: string;
  onClose: () => void;
  viewerId: string;
  canManage: boolean;
}) {
  const [body, setBody] = useState("");
  const [about, setAbout] = useState(initialAbout);
  // opening it from a specific IR's row aims the composer at that person
  const [lastAbout, setLastAbout] = useState(initialAbout);
  if (initialAbout !== lastAbout) {
    setLastAbout(initialAbout);
    setAbout(initialAbout);
  }
  const [pending, start] = useTransition();
  const router = useRouter();
  // every IR has a row since v33.24 — bookers included — so a note can hang
  // on any of them
  const people = (lc?.contacts ?? []).filter((c) => c.manualId);
  const notes = lc?.comments ?? [];
  const nameOf = (id: string | null) =>
    id ? people.find((p) => p.manualId === id)?.name ?? "an IR" : null;

  return (
    <Dialog
      open={!!lc}
      onOpenChange={(o) => { if (!o) { onClose(); setBody(""); } }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle dir="auto">{lc?.name} — history &amp; notes</DialogTitle>
          <DialogDescription>
            Everything that has happened with this LC, and what the next person
            needs to know before they call.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {people.length > 0 ? (
            <Select value={about} onValueChange={setAbout}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lc">About the LC</SelectItem>
                {people.map((p) => (
                  <SelectItem key={p.manualId!} value={p.manualId!}>
                    About {p.name ?? "this IR"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            dir="auto"
            placeholder="Their peak, who answers, what they asked for…"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={pending || body.trim().length < 2}
              onClick={() =>
                start(async () => {
                  if (!lc) return;
                  const res = await addPartnerLcComment({
                    partnerLcId: lc.id,
                    contactId: about === "lc" ? null : about,
                    body,
                  });
                  if (!res.ok) toast.error(res.error);
                  else { setBody(""); toast.success("Noted 📝"); router.refresh(); }
                })
              }
            >
              <Plus className="size-3.5" /> Add the note
            </Button>
          </div>
        </div>

        {/* THE WHOLE STORY (v33.24) — calls, CVs and notes on one timeline.
            "Have we spoken to these people before?" used to mean opening three
            tabs and reading dates. */}
        {(lc?.history ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nothing has happened with this LC yet.
          </p>
        ) : (
          <div className="grid gap-2">
            {(lc?.history ?? []).map((e) => {
              const note = e.kind === "note" ? notes.find((n) => `note-${n.id}` === e.id) : null;
              return (
                <div
                  key={e.id}
                  className={cn(
                    "rounded-lg border p-2.5",
                    e.kind === "note" && "border-primary/30 bg-primary/5"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>{e.kind === "call" ? "📞" : e.kind === "cv" ? "📄" : "📝"}</span>
                    <span className="text-sm font-semibold" dir="auto">{e.title}</span>
                    {e.product ? <ProductTag product={e.product} /> : null}
                    {note?.contactId ? (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]" dir="auto">
                        about {nameOf(note.contactId)}
                      </Badge>
                    ) : null}
                  </div>
                  {e.detail ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm" dir="auto">
                      {e.detail}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {e.who ? `${e.kind === "call" ? "taken by " : ""}${e.who} · ` : ""}
                      {fmtDateTime(e.at)}
                    </p>
                    {note && (note.authorId === viewerId || canManage) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs text-muted-foreground hover:text-destructive"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await deletePartnerLcComment(note.id);
                            if (!res.ok) toast.error(res.error);
                            else router.refresh();
                          })
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
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
            placeholder="Country"
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
            placeholder="Country"
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

/** 🤝 RECORD A PARTNERSHIP (v33.38). The win itself: a new LC approached, the
 *  WhatsApp group open. LC (existing or brand new), programme, the IR who
 *  anchors it (phone or email — one is enough), and the date it happened. */
function RecordPartnershipDialog({
  open, onClose, lc, lcs, initialProduct, targets, viewerId, canAssign,
}: {
  open: boolean;
  onClose: () => void;
  /** preselected LC — null means pick or create one in the dialog */
  lc: PartnerLcDetail | null;
  lcs: PartnerLcDetail[];
  initialProduct: "GV" | "GT" | null;
  /** who it may COUNT FOR (v33.39) — an MM records a member's win */
  targets: PartnershipTarget[];
  viewerId: string;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    lcId: "", newLc: false, newName: "", newCountry: "",
    product: "" as "" | "GV" | "GT",
    irName: "", irPhone: "", irEmail: "", date: todayStr,
    memberId: "",
  });
  // re-seed when the dialog opens on a (different) LC
  const openKey = open ? `${lc?.id ?? "new"}:${initialProduct ?? ""}` : "";
  const [seededKey, setSeededKey] = useState("");
  if (open && seededKey !== openKey) {
    setSeededKey(openKey);
    setForm({
      lcId: lc?.id ?? "", newLc: false, newName: "", newCountry: "",
      product: initialProduct ?? "",
      irName: "", irPhone: "", irEmail: "", date: todayStr,
      memberId: "",
    });
  }
  const chosen = lc ?? lcs.find((l) => l.id === form.lcId) ?? null;
  // a programme is taken by a MADE partnership — or by real IR calls, which
  // ARE the relationship (v33.39)
  const takenProducts = (chosen?.partnerships ?? [])
    .filter((pp) => pp.status === "done")
    .map((pp) => pp.product);
  const calledProducts = chosen?.callProducts ?? [];
  const canSave =
    !pending &&
    (form.newLc ? form.newName.trim().length > 1 : !!(lc?.id || form.lcId)) &&
    (form.product === "GV" || form.product === "GT") &&
    form.irName.trim().length > 0 &&
    (form.irPhone.trim().length > 0 || form.irEmail.trim().length > 0);

  const save = () =>
    start(async () => {
      const res = await recordLcPartnership({
        partnerLcId: form.newLc ? null : lc?.id || form.lcId,
        newLc: form.newLc ? { name: form.newName, country: form.newCountry || null } : null,
        product: form.product as "GV" | "GT",
        irName: form.irName,
        irPhone: form.irPhone || null,
        irEmail: form.irEmail || null,
        date: form.date || null,
        memberId: form.memberId || null,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("🤝 Partnership recorded — it counts on the dashboard.");
      onClose();
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <Handshake className="size-5" /> Record a partnership
              {lc ? <span dir="auto">— {lc.name}</span> : null}
            </span>
          </DialogTitle>
          <DialogDescription>
            Approached an LC and opened the WhatsApp group? That IS the
            partnership — log it and it counts for whoever made it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!lc ? (
            <div className="grid gap-1.5">
              <Label>Partner LC *</Label>
              {form.newLc ? (
                <div className="grid gap-2">
                  <Input
                    dir="auto"
                    value={form.newName}
                    onChange={(e) => setForm((f) => ({ ...f, newName: e.target.value }))}
                    placeholder="AIESEC in …"
                    maxLength={120}
                  />
                  <CountryInput
                    value={form.newCountry}
                    onChange={(v) => setForm((f) => ({ ...f, newCountry: v }))}
                    placeholder="Country"
                  />
                  <button
                    type="button"
                    className="w-fit text-xs text-primary hover:underline"
                    onClick={() => setForm((f) => ({ ...f, newLc: false }))}
                  >
                    ← Pick from the registry instead
                  </button>
                </div>
              ) : (
                <>
                  <Select
                    value={form.lcId || undefined}
                    onValueChange={(v) => setForm((f) => ({ ...f, lcId: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Pick the LC…" /></SelectTrigger>
                    <SelectContent>
                      {lcs.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}{l.country ? ` · ${l.country}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    className="w-fit text-xs text-primary hover:underline"
                    onClick={() => setForm((f) => ({ ...f, newLc: true, lcId: "" }))}
                  >
                    ➕ A brand-new LC — not in the registry yet
                  </button>
                </>
              )}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Programme *</Label>
              <Select
                value={form.product || undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, product: v as "GV" | "GT" }))}
              >
                <SelectTrigger><SelectValue placeholder="GV or GT…" /></SelectTrigger>
                <SelectContent>
                  {(["GV", "GT"] as const).map((pr) => (
                    <SelectItem
                      key={pr}
                      value={pr}
                      disabled={takenProducts.includes(pr) || calledProducts.includes(pr)}
                    >
                      {pr}
                      {takenProducts.includes(pr)
                        ? " — already partnered"
                        : calledProducts.includes(pr)
                          ? " — already reached (IR calls)"
                          : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Partnership date *</Label>
              <Input
                type="date"
                value={form.date}
                max={todayStr}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>IR name *</Label>
            <Input
              dir="auto"
              value={form.irName}
              onChange={(e) => setForm((f) => ({ ...f, irName: e.target.value }))}
              placeholder="Who anchors the partnership on their side"
              maxLength={120}
            />
          </div>
          {canAssign && targets.some((t) => t.id !== viewerId) ? (
            <div className="grid gap-1.5">
              <Label>Counts for</Label>
              <Select
                value={form.memberId || "__me"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, memberId: v === "__me" ? "" : v }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__me">Me — my own win</SelectItem>
                  {targets
                    .filter((t) => t.id !== viewerId)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} · {t.role}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                An MM can record a partnership their member made — it lands on
                the member&apos;s numbers, and they&apos;re told.
              </p>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>WhatsApp</Label>
              <Input
                value={form.irPhone}
                onChange={(e) => setForm((f) => ({ ...f, irPhone: e.target.value }))}
                placeholder={
                  phoneExample(form.newLc ? form.newCountry : chosen?.country) ??
                  "+90… with the country code"
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.irEmail}
                onChange={(e) => setForm((f) => ({ ...f, irEmail: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Phone and email: one of them is a must — a partnership we can&apos;t
            reach isn&apos;t one.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Handshake className="size-4" />}
            Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 🎯 HAND OUT A PARTNERSHIP TARGET (v33.38): an MM or VP points someone at an
 *  LC — "go make this partnership". The member and their Team Leader are
 *  belled, and making it counts for the member. */
function AssignPartnershipDialog({
  open, lc, lcs, onClose, targets, defaultProduct,
}: {
  open: boolean;
  /** preselected LC — null means pick or create one in the dialog (v33.39) */
  lc: PartnerLcDetail | null;
  lcs: PartnerLcDetail[];
  onClose: () => void;
  targets: PartnershipTarget[];
  defaultProduct: "GV" | "GT" | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    lcId: "", newLc: false, newName: "", newCountry: "",
    product: "" as "" | "GV" | "GT",
    memberId: "",
  });
  const openKey = open ? (lc?.id ?? "new") : "";
  const [seededKey, setSeededKey] = useState("");
  if (open && seededKey !== openKey) {
    setSeededKey(openKey);
    setForm({
      lcId: lc?.id ?? "", newLc: false, newName: "", newCountry: "",
      product: defaultProduct ?? "",
      memberId: "",
    });
  }
  const chosen = lc ?? lcs.find((l) => l.id === form.lcId) ?? null;
  const takenProducts = (chosen?.partnerships ?? [])
    .filter((pp) => pp.status === "done")
    .map((pp) => pp.product);
  const calledProducts = chosen?.callProducts ?? [];
  const pendingOn = (pr: string) =>
    (chosen?.partnerships ?? []).find((pp) => pp.status === "pending" && pp.product === pr)
      ?.assignedToName ?? null;
  const canSave =
    !pending &&
    (form.newLc ? form.newName.trim().length > 1 : !!(lc?.id || form.lcId)) &&
    !!form.product && !!form.memberId;

  const save = () =>
    start(async () => {
      const res = await assignLcPartnership({
        partnerLcId: form.newLc ? null : lc?.id || form.lcId,
        newLc: form.newLc ? { name: form.newName, country: form.newCountry || null } : null,
        product: form.product as "GV" | "GT",
        memberId: form.memberId,
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("🎯 Target set — they've been told.");
      onClose();
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            🎯 Set {chosen ? <span dir="auto">{chosen.name}</span> : "an LC"} as a target
          </DialogTitle>
          <DialogDescription>
            Hand an LC to someone: approach them, open the WhatsApp group,
            record the partnership. It counts for the member who makes it — and
            their Team Leader is told too.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!lc ? (
            <div className="grid gap-1.5">
              <Label>Partner LC *</Label>
              {form.newLc ? (
                <div className="grid gap-2">
                  <Input
                    dir="auto"
                    value={form.newName}
                    onChange={(e) => setForm((f) => ({ ...f, newName: e.target.value }))}
                    placeholder="AIESEC in …"
                    maxLength={120}
                  />
                  <CountryInput
                    value={form.newCountry}
                    onChange={(v) => setForm((f) => ({ ...f, newCountry: v }))}
                    placeholder="Country"
                  />
                  <button
                    type="button"
                    className="w-fit text-xs text-primary hover:underline"
                    onClick={() => setForm((f) => ({ ...f, newLc: false }))}
                  >
                    ← Pick from the registry instead
                  </button>
                </div>
              ) : (
                <>
                  <Select
                    value={form.lcId || undefined}
                    onValueChange={(v) => setForm((f) => ({ ...f, lcId: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Pick the LC…" /></SelectTrigger>
                    <SelectContent>
                      {lcs.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}{l.country ? ` · ${l.country}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    className="w-fit text-xs text-primary hover:underline"
                    onClick={() => setForm((f) => ({ ...f, newLc: true, lcId: "" }))}
                  >
                    ➕ A brand-new LC — not in the registry yet
                  </button>
                </>
              )}
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label>Programme *</Label>
            <Select
              value={form.product || undefined}
              onValueChange={(v) => setForm((f) => ({ ...f, product: v as "GV" | "GT" }))}
            >
              <SelectTrigger><SelectValue placeholder="GV or GT…" /></SelectTrigger>
              <SelectContent>
                {(["GV", "GT"] as const).map((pr) => (
                  <SelectItem
                    key={pr}
                    value={pr}
                    disabled={takenProducts.includes(pr) || calledProducts.includes(pr)}
                  >
                    {pr}
                    {takenProducts.includes(pr)
                      ? " — already partnered"
                      : calledProducts.includes(pr)
                        ? " — already reached (IR calls)"
                        : pendingOn(pr)
                          ? ` — currently ${pendingOn(pr)}'s target`
                          : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Who makes it *</Label>
            <Select
              value={form.memberId || undefined}
              onValueChange={(v) => setForm((f) => ({ ...f, memberId: v }))}
            >
              <SelectTrigger><SelectValue placeholder="Pick the member…" /></SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} · {t.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.product && pendingOn(form.product) ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              This {form.product} target currently belongs to {pendingOn(form.product)} —
              assigning it again moves it to the new person.
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Set the target"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ main view

export function ConsiderationView({
  pageSize,
  pageSizeOptions,
  tab, lcs, calls, cvs, q, viewer, booking, origin, highlightLc,
  callFilters, callOptions,
  partnershipTargets = [],
  handoverTargets = [],
  slotRequests = [],
}: {
  tab: "calls" | "cvs" | "expectation" | "lcs";
  /** ?lc=<id> — the LC the log linked to, scrolled to and outlined */
  highlightLc?: string | null;
  lcs: (PartnerLc | PartnerLcDetail)[];
  calls: CallsData;
  cvs: PageData<CvRow>;
  /** the call log's server-side filters + the values the whole set holds */
  callFilters: CallFilterState;
  callOptions: { members: string[]; lcs: string[] };
  q: string;
  pageSize: number;
  pageSizeOptions: number[];
  viewer: ViewerInfo;
  booking: MyIrBooking | null;
  origin: string;
  /** who the viewer may hand a 🎯 partnership target to (v33.38) */
  partnershipTargets?: PartnershipTarget[];
  /** who a booked IR call may be handed to (v33.58) — the consideration crew */
  handoverTargets?: PartnershipTarget[];
  slotRequests?: IrSlotRequest[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  // the CV table's column funnels live in the URL, like every other table's
  const cvFilters = {
    lc: searchParams.get("cvlc") ?? "",
    industry: searchParams.get("industry") ?? "",
    status: searchParams.get("status") ?? "",
    uploader: searchParams.get("uploader") ?? "",
    phone: searchParams.get("cvphone") ?? "",
  };
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
    { key: "lcs", label: "Partner LCs", icon: Building2 },
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
        {tab === "lcs" ? (
          <PartnerLcsTab
            lcs={allLcs}
            highlight={highlightLc}
            viewer={viewer}
            partnershipTargets={partnershipTargets}
          />
        ) : tab === "expectation" && viewer.showExpectation ? (
          <IgtExpectationTab />
        ) : tab === "calls" || !viewer.showCvs ? (
          <>
          {/* asks for times this host never opened — answered before anything
              else on the tab, because the IR is waiting on a person */}
          <IrSlotRequestsCard requests={slotRequests} showHost={viewer.isVp} />
          <IrCallsTab
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            onPageSize={(n) => setParams({ size: String(n), page: null })}
            data={calls}
            lcs={allLcs}
            onLcCreated={lcAdded}
            onOpenLc={(id) => setParams({ tab: "lcs", lc: id, page: null })}
            goPage={(p) => setParams({ page: String(p + 1) })}
            viewer={viewer}
            booking={booking}
            origin={origin}
            handoverTargets={handoverTargets}
            filters={callFilters}
            filterOptions={callOptions}
            onFilter={(patch) =>
              // any filter change resets to page 1 — page 4 of the old result
              // set is meaningless against the new one
              setParams({
                ...Object.fromEntries(
                  Object.entries(patch).map(([k, v]) => [CALL_PARAM[k] ?? k, v || null])
                ),
                page: null,
              })
            }
          />
          </>
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
            cvFilters={cvFilters}
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
const BUFFER_CHOICES = [0, 5, 10, 15, 30, 60, 90, 120];

/** 12-hour time picker in REAL 5-minute steps (v33.17). The native
 *  `<input type="time" step>` was a lie: Chrome's dropdown ignores `step`
 *  and lists every minute — so members kept picking un-alignable times.
 *  Value in/out stays 24h "HH:MM". */
function TimeSelect({
  value, onChange, ariaLabel,
}: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  const [hh, mm] = value.split(":").map(Number);
  const isPm = hh >= 12;
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  const emit = (h12: number, minute: number, pm: boolean) => {
    const h24 = pm ? (h12 % 12) + 12 : h12 % 12;
    onChange(`${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  };
  // snap a legacy minute (e.g. 23:59) onto the 5-min grid for the picker
  const minute5 = Math.min(55, Math.round((mm || 0) / 5) * 5);
  // THE BOXES WERE CLIPPING THEIR OWN VALUES (v33.28) — "00" rendered as "0C"
  // and "PM" as "PN". A shadcn SelectTrigger carries px-3 either side plus a
  // gap and a chevron, roughly 48px of chrome; inside w-16 (64px) that leaves
  // 16px for text that needs 23. Reclaiming the padding costs no layout width.
  // `shrink-0` matters on a phone: these children are fixed width, so any flex
  // squeeze turns straight back into clipping.
  return (
    <div className="flex shrink-0 items-center gap-1" aria-label={ariaLabel}>
      <Select value={String(hour12)} onValueChange={(v) => emit(Number(v), minute5, isPm)}>
        <SelectTrigger className="h-9 w-16 gap-1 px-2"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <SelectItem key={h} value={String(h)}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground">:</span>
      <Select value={String(minute5)} onValueChange={(v) => emit(hour12, Number(v), isPm)}>
        <SelectTrigger className="h-9 w-16 gap-1 px-2"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
            <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={isPm ? "PM" : "AM"} onValueChange={(v) => emit(hour12, minute5, v === "PM")}>
        <SelectTrigger className="h-9 w-[4.5rem] gap-1 px-2"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
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

/** One "why nobody can book you" line. Rendered either in the card header or
 *  directly beneath the control it blames — same look in both places, so a
 *  member who has seen it once in the banner recognises it at the field. */
function IssueNote({ issue }: { issue: BookingIssue }) {
  return (
    <p
      className={cn(
        "rounded-lg border p-2.5 text-xs font-medium",
        issue.level === "blocked"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      )}
    >
      {issue.level === "blocked" ? "⚠️ " : "ℹ️ "}
      {issue.message}
    </p>
  );
}

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
  // the SAME three rules the server enforces, evaluated as they type so the
  // offending ROW is marked instead of one message for the whole form (v33.28)
  const rowIssues = useMemo(() => availabilityIssues(rows), [rows]);
  const [active, setActive] = useState(s?.active ?? true);
  const [buffer, setBuffer] = useState(String(s?.buffer_minutes ?? 0));
  // v33.37 — how many calls one day may hold; "0" renders as No limit
  const [maxPerDay, setMaxPerDay] = useState(String(s?.max_per_day ?? 0));
  // v33.39 — per-weekday exceptions ("3 a day, but Sunday only 1"); "" = follow
  const [dayCaps, setDayCaps] = useState<Record<string, string>>(() => {
    const o = s?.max_per_day_overrides ?? {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) out[k] = String(v);
    return out;
  });
  const [notice, setNotice] = useState(String(s?.min_notice_minutes ?? 60));
  const [advance, setAdvance] = useState(String(s?.max_advance_days ?? 14));
  const [startDate, setStartDate] = useState(s?.start_date ?? "");
  const [endDate, setEndDate] = useState(s?.end_date ?? "");
  const [guestsInvite, setGuestsInvite] = useState(s?.guests_can_invite ?? true);
  const [open, setOpen] = useState(!s); // first-timers see the setup expanded
  const [copied, setCopied] = useState(false);

  // v33.45 — route each issue to the control it blames. Open: `dates`/`hours`
  // print against their own fields and the header keeps the rest. Closed:
  // the header carries every one of them, since no field is on screen to
  // carry it. Issues are derived from the SAVED settings, so an unsaved edit
  // doesn't clear a warning that is still true on the public page.
  const allIssues = booking.issues ?? [];
  const inlineIssues = (field: BookingIssueField) =>
    open ? allIssues.filter((i) => i.field === field) : [];
  const headerIssues = open
    ? allIssues.filter((i) => i.field !== "dates" && i.field !== "hours")
    : allIssues;

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
        maxPerDay: Number(maxPerDay) || null,
        maxPerDayOverrides: Object.fromEntries(
          Object.entries(dayCaps)
            .filter(([, v]) => Number(v) >= 1)
            .map(([k, v]) => [k, Number(v)])
        ),
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
        {/* WHY NOBODY CAN BOOK YOU (v33.44). A member's schedule end date had
            passed, her link offered nothing, and there was no way to tell that
            from a quiet week. Anything that silently empties the grid is said
            here — outside the collapsible body, so it can't be missed.

            v33.45 — but "said out loud" is not the same as "said WHERE YOU FIX
            IT". While the editor is OPEN, every issue that names a control
            (`field`) is printed against that control instead, so the schedule
            warning sits on the date pair it is about. Only the homeless ones
            stay up here. Closed, the banner still carries everything — a
            collapsed card must never hide a dead link. */}
        {headerIssues.length > 0 ? (
          <div className="space-y-1.5 pt-1">
            {headerIssues.map((iss, i) => (
              <IssueNote key={i} issue={iss} />
            ))}
          </div>
        ) : null}
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
                      {m === 0
                        ? "No buffer"
                        : m === 60
                          ? "1 hour"
                          : m === 90
                            ? "1½ hours"
                            : m === 120
                              ? "2 hours"
                              : `${m} minutes`}
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
              <Label>Calls per day</Label>
              <Select value={maxPerDay} onValueChange={setMaxPerDay}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No limit</SelectItem>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} call{n === 1 ? "" : "s"} max
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                A full day stops being offered on your link.
              </p>
              {/* v33.39 — a weekday can carry its OWN cap on top of (or
                  without) the general one: "3 a day, but Sunday only 1" */}
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                {[
                  [6, "Sa"], [0, "Su"], [1, "Mo"], [2, "Tu"], [3, "We"], [4, "Th"], [5, "Fr"],
                ].map(([dow, label]) => (
                  <label key={dow} className="flex flex-col items-center gap-0.5">
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                    <select
                      className="h-7 w-10 rounded-md border bg-transparent text-center text-xs"
                      value={dayCaps[String(dow)] ?? ""}
                      aria-label={`Cap for ${label}`}
                      onChange={(e) =>
                        setDayCaps((prev) => {
                          const next = { ...prev };
                          if (e.target.value) next[String(dow)] = e.target.value;
                          else delete next[String(dow)];
                          return next;
                        })
                      }
                    >
                      <option value="">–</option>
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <option key={n} value={String(n)}>{n}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Per-day exceptions — &ldquo;–&rdquo; follows the cap above.
              </p>
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

          {/* grid-cols-1 = repeat(1, minmax(0,1fr)): a FLEXIBLE track, so the
              native date control's own intrinsic width can't push the card
              off a phone screen (v33.28) */}
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="bk-start">Schedule starts (optional)</Label>
                <Input
                  id="bk-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="bk-end">Schedule ends (optional)</Label>
                <Input
                  id="bk-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={cn(
                    "h-9",
                    // the dead end date is the usual culprit — ring the field
                    // itself, not just the sentence under it
                    inlineIssues("dates").some((i) => i.level === "blocked") &&
                      "border-destructive focus-visible:ring-destructive/40"
                  )}
                />
              </div>
            </div>
            {/* v33.45 — the schedule warning lives HERE, under the two dates it
                is about, so the fix is the next control the eye lands on. */}
            {inlineIssues("dates").map((iss, i) => (
              <IssueNote key={i} issue={iss} />
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>Availability (Cairo time)</Label>
            {/* the whole-grid hours problems ("no hours at all", "every hour
                you set has passed") belong to this list, not to a banner three
                cards up. Per-ROW problems are still marked on their row. */}
            {inlineIssues("hours").map((iss, i) => (
              <IssueNote key={i} issue={iss} />
            ))}
            <div className="space-y-2">
              {rows.map((r, i) => {
                const isDate = r.date != null;
                const issue = rowIssues.get(i);
                return (
                  <div key={i} className="space-y-1">
                  <div className={cn(
                    "flex flex-wrap items-center gap-2 rounded-md",
                    issue && "border border-destructive/50 bg-destructive/5 p-1.5"
                  )}>
                    <Select
                      value={isDate ? "date" : "weekly"}
                      onValueChange={(v) => setRowMode(i, v as "weekly" | "date")}
                    >
                      <SelectTrigger className="h-9 w-36 gap-1 px-2">
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
                        <SelectTrigger className="h-9 w-36 gap-1 px-2">
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
                    <TimeSelect
                      value={r.from}
                      onChange={(v) => setRow(i, { from: v })}
                      ariaLabel="From"
                    />
                    <span className="text-sm text-muted-foreground">→</span>
                    <TimeSelect
                      value={r.to}
                      onChange={(v) => setRow(i, { to: v })}
                      ariaLabel="To"
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
                  {/* THE ROW THAT IS WRONG SAYS SO, WHERE IT IS (v33.28) —
                      one message for the whole form meant hunting for which
                      of eight rows it meant. */}
                  {issue ? (
                    <p className="px-1.5 text-xs font-medium text-destructive">{issue}</p>
                  ) : null}
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
              <p className="text-xs text-muted-foreground">
                Times are Cairo, in 5-minute steps. To run until midnight, set the
                end to <b>12:00 AM</b>. The buffer kicks in around <b>booked</b> calls:
                a 6:00 call with a 10-min buffer makes the next bookable slot 6:40.
              </p>
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
            <Hint
              label={
                rowIssues.size > 0
                  ? "Fix the highlighted availability rows first"
                  : "Saves the link — the public page updates instantly"
              }
            >
              <Button onClick={save} disabled={pending || !slug.trim() || rowIssues.size > 0}>
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
  { key: "product", label: "Product" },
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
  { key: "actions", label: "", required: true },
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

/** "Thu" — the Cairo weekday (v33.18). A date alone doesn't tell you which
 *  DAY a call lands on, which is the thing people actually plan around. */
const dayName = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "Africa/Cairo" });

/** the columns the SERVER can sort (v33.40) — keys of `IR_SORTS` in data.ts */
const CALL_SERVER_SORTS: Record<string, string> = {
  when: "called_at",
  lc: "lc",
  product: "product",
  by: "member",
  status: "status",
  booker: "booker",
};

const CALL_SORTERS: Record<string, (c: IrCallRow) => string | number | null> = {
  when: (c) => c.called_at,
  lc: (c) => c.partner_lc_name,
  product: (c) => c.product,
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
  // the default view (v33.8): who, from where, what they do, when it landed
  { key: "uploader", label: "Uploaded by" },
  { key: "person", label: "Person", required: true },
  { key: "lc", label: "Partner LC" },
  { key: "industry", label: "Industry" },
  { key: "skills", label: "Skills" },
  { key: "created", label: "Uploaded" },
  { key: "status", label: "AI status" },
  { key: "contact", label: "Contact" },
  { key: "actions", label: "Actions" },
  // the summary is long — it belongs in the CV's own page, not a table cell
  { key: "summary", label: "Summary", defaultHidden: true },
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
  pageSize, pageSizeOptions, onPageSize, onOpenLc, filters, filterOptions, onFilter,
  handoverTargets,
}: {
  /** who this call could be handed to instead (v33.58) */
  handoverTargets: PartnershipTarget[];
  pageSize: number;
  pageSizeOptions: number[];
  onPageSize: (n: number) => void;
  /** jump to a partner LC's record from its name in the log */
  onOpenLc: (lcId: string | null) => void;
  data: CallsData;
  lcs: (PartnerLc | PartnerLcDetail)[];
  onLcCreated: (lc: PartnerLc) => void;
  goPage: (p: number) => void;
  viewer: ViewerInfo;
  booking: MyIrBooking | null;
  origin: string;
  filters: CallFilterState;
  filterOptions: { members: string[]; lcs: string[] };
  onFilter: (patch: CallFilterState) => void;
}) {
  const [completing, setCompleting] = useState<IrCallRow | null>(null);
  const [cancelling, setCancelling] = useState<IrCallRow | null>(null);
  const [rescheduling, setRescheduling] = useState<IrCallRow | null>(null);
  // 🤝 v33.58 — same time, different host
  const [handingOver, setHandingOver] = useState<IrCallRow | null>(null);
  // EVERY CALL OPENS (v33.29 part 2): click a scheduled row or a log row for
  // the whole story on one card — who, when (both clocks), why, links, history
  const [detail, setDetail] = useState<IrCallRow | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  // v33.17 — filters over the scheduled list: with a handful of calls booked
  // you scan them; with more, you filter by who takes the call or which LC
  // it's with. Client-side only — the list is already in hand.
  const [schedWith, setSchedWith] = useState("");
  const [schedLc, setSchedLc] = useState("");
  // v33.23 — which programme the call is for; the two floors book different LCs
  const [schedProduct, setSchedProduct] = useState("");
  // v33.18 — "Mine" is the filter everyone reaches for first, so it's a chip,
  // not a dropdown entry. The "With" list therefore leaves the viewer OUT
  // (matched by id, never by name — two members can share a first name).
  const [schedMine, setSchedMine] = useState(false);
  // v33.32 — "show me only the ones that need something from me"
  const [schedNeedy, setSchedNeedy] = useState(false);
  // v33.41 — the scheduled list grew past scanning: sort it, and narrow by
  // WHEN (today / this week / passed) or by what it still carries
  const [schedSort, setSchedSort] = useState<"soonest" | "latest" | "lc" | "with" | "booked">(
    "soonest"
  );
  const [schedWhen, setSchedWhen] = useState<"" | "today" | "week" | "passed" | "upcoming">("");
  const [schedFlag, setSchedFlag] = useState<"" | "bounced" | "note">("");
  // THE CLOCK IS STATE, NOT A RENDER-TIME READ (v33.41): a call whose slot
  // passes while the page is open should start showing as ⏰ passed without a
  // refresh — and a render that reads Date.now() is impure besides.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  /** the slot has passed and the call is still just "scheduled" */
  const pastDue = useCallback(
    (c: IrCallRow) => c.status === "scheduled" && new Date(c.called_at) < new Date(),
    []
  );
  /** WHOSE PROBLEM IS IT? (v33.33)
   *
   *  The banner said "11 calls need you" to everybody, including the members
   *  who had none — so the one number meant to prompt action became wallpaper.
   *  It follows the hierarchy now: a member answers for their own calls, a
   *  Team Leader for their team's, a VP/Director/LCP for the whole floor they
   *  can already see. */
  const mine = useCallback(
    (c: IrCallRow) =>
      viewer.isVp ||
      c.member_id === viewer.id ||
      (!!c.member_id && viewer.teamIds.includes(c.member_id)),
    [viewer.id, viewer.isVp, viewer.teamIds]
  );
  const needsAttention = useMemo(
    () => data.scheduled.filter((c) => mine(c) && (pastDue(c) || c.email_bounced_at)),
    [data.scheduled, pastDue, mine]
  );
  const schedWithOptions = [
    ...new Set(
      data.scheduled.filter((c) => c.member_id !== viewer.id).map((c) => c.member_name)
    ),
  ].sort((a, b) => a.localeCompare(b));
  const schedLcOptions = [...new Set(data.scheduled.map((c) => c.partner_lc_name))].sort(
    (a, b) => a.localeCompare(b)
  );
  const scheduledShown = useMemo(() => {
    const now = nowTs;
    const dayMs = 86_400_000;
    const cairoDay = (iso: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(iso));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(
      new Date(nowTs)
    );
    const rows = data.scheduled.filter((c) => {
      if (schedNeedy && !(mine(c) && (pastDue(c) || !!c.email_bounced_at))) return false;
      if (schedMine && c.member_id !== viewer.id) return false;
      if (schedWith && c.member_name !== schedWith) return false;
      if (schedProduct && c.product !== schedProduct) return false;
      if (schedLc && c.partner_lc_name !== schedLc) return false;
      // WHEN (v33.41) — Cairo days, the clock the crew reads
      if (schedWhen === "today" && cairoDay(c.called_at) !== today) return false;
      if (schedWhen === "week") {
        const t = new Date(c.called_at).getTime();
        if (t < now || t > now + 7 * dayMs) return false;
      }
      if (schedWhen === "passed" && !pastDue(c)) return false;
      if (schedWhen === "upcoming" && new Date(c.called_at).getTime() < now) return false;
      // WHAT IT CARRIES (v33.41)
      // (no has/no-Meet-link filter: every booking creates the event and the
      // link — a call without one is a bug to fix, not a view to offer)
      if (schedFlag === "bounced" && !c.email_bounced_at) return false;
      if (schedFlag === "note" && !c.booker_note) return false;
      return true;
    });
    const cmp: Record<typeof schedSort, (a: IrCallRow, b: IrCallRow) => number> = {
      soonest: (a, b) => a.called_at.localeCompare(b.called_at),
      latest: (a, b) => b.called_at.localeCompare(a.called_at),
      lc: (a, b) => a.partner_lc_name.localeCompare(b.partner_lc_name),
      with: (a, b) => a.member_name.localeCompare(b.member_name),
      booked: (a, b) => (b.booked_at ?? "").localeCompare(a.booked_at ?? ""),
    };
    return [...rows].sort(cmp[schedSort]);
  }, [
    data.scheduled, schedNeedy, schedMine, schedWith, schedProduct, schedLc,
    schedWhen, schedFlag, schedSort, viewer.id, mine, pastDue, nowTs,
  ]);

  const canTouch = (c: IrCallRow) => viewer.isVp || c.member_id === viewer.id;
  const [deleting, setDeleting] = useState<IrCallRow | null>(null);
  const [deletePending, startDelete] = useTransition();
  const router = useRouter();
  const pages = Math.max(1, Math.ceil(data.total / pageSize));

  // ⚙ Columns + click-to-sort over the page in hand
  const cols = useTableColumns("consideration-calls", CALL_COLUMNS);
  const { sorted: sortedCalls, sortKey, dir, toggle: toggleSort } =
    useTableSort(data.rows, CALL_SORTERS);

  // THE LOG'S COLUMN FUNNELS (v33.32). Same house rule as everywhere else —
  // if it is a column, you filter it from the column — and server-side,
  // because the log is paged: a client-side filter would narrow the page and
  // present it as the whole history.
  const callFunnels: Record<string, { label: string; key: keyof CallFilterState; options: { value: string; label: string }[] }> = {
    product: {
      label: "Product",
      key: "product",
      options: [
        { value: "GV", label: "GV" },
        { value: "GT", label: "GT" },
        { value: "none", label: "— untagged" },
      ],
    },
    status: {
      label: "Status",
      key: "status",
      options: [
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
      ],
    },
    by: {
      label: "By",
      key: "member",
      options: filterOptions.members.map((m) => ({ value: m, label: m })),
    },
    lc: {
      label: "Partner LC",
      key: "lc",
      options: filterOptions.lcs.map((l) => ({ value: l, label: l })),
    },
    // WHAT THE CALL CARRIES (v33.40) — notes, a screenshot, a shared CV
    // pool, or a bounced email; several picks OR together server-side
    notes: {
      label: "Carries",
      key: "has",
      options: [
        { value: "notes", label: "📝 Has notes" },
        { value: "screenshot", label: "📸 Has screenshot" },
        { value: "cvpool", label: "📄 Has a CV pool link" },
        { value: "bounced", label: "⚠️ Email bounced" },
      ],
    },
  };
  const callFunnel = (colKey: string) => {
    // the "When" column is a DATE, so its funnel is a range rather than a
    // pick-list (v34.7). Calls can legitimately be in the future, so unlike
    // the accounts list this one is NOT clamped to today.
    if (colKey === "when") {
      return (
        <DateRangeFilter
          label="Called from → to"
          from={filters.from ?? ""}
          to={filters.to ?? ""}
          onChange={({ from, to }) => onFilter({ from, to })}
        />
      );
    }
    const f = callFunnels[colKey];
    if (!f || f.options.length === 0) return null;
    return (
      <ColumnFilter
        label={f.label}
        value={filters[f.key] ?? ""}
        options={f.options}
        onChange={(v) => onFilter({ [f.key]: v })}
        allLabel={`All ${f.label.toLowerCase()}`}
      />
    );
  };
  const [searchDraft, setSearchDraft] = useState(filters.q ?? "");
  const anyCallFilter = Object.values(filters).some(Boolean);

  /** One call-log cell, by column key. */
  const callCell = (c: IrCallRow, key: string): React.ReactNode => {
    const chip = CALL_STATUS_CHIP[c.status] ?? CALL_STATUS_CHIP.completed;
    switch (key) {
      case "when":
        return `${dayName(c.called_at)} · ${fmtDateTime(c.called_at)}`;
      case "lc":
        // the LC name is a link into its own record — who they are, how many
        // calls we've had, which of their IRs we've spoken to (v33.5)
        return (
          <button
            type="button"
            className="text-left font-medium text-primary hover:underline"
            dir="auto"
            onClick={() => onOpenLc(c.partner_lc_id)}
          >
            {c.partner_lc_name}
          </button>
        );
      case "actions":
        return canTouch(c) ? (
          <Hint label="Delete this log — for a duplicate or a mistake">
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={() => setDeleting(c)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </Hint>
        ) : null;
      case "by":
        return <span dir="auto">{c.member_name}</span>;
      case "product":
        // GV / GT, decided when the call was booked (v33.23). "—" means the
        // host works both products, so nobody guessed on their behalf.
        return c.product ? (
          <ProductTag product={c.product} />
        ) : (
          <span className="text-muted-foreground">—</span>
        );
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
              Booked through the links. During the call, open it and fill the
              in-call notes.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* CALLS THAT NEED A HUMAN (v33.32) — a booked call whose time has
                passed and that nobody reported on, or one whose IR email
                bounced. Both used to sit in this list looking identical to a
                call that is simply next week, which is how eleven scheduled
                calls read as eleven upcoming ones. */}
            {needsAttention.length > 0 ? (
              <button
                type="button"
                onClick={() => setSchedNeedy((v) => !v)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-sm transition-colors hover:bg-amber-500/15",
                  schedNeedy && "ring-2 ring-amber-500/40"
                )}
              >
                <CalendarClock className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="min-w-0 flex-1">
                  <b>{needsAttention.length}</b>{" "}
                  {needsAttention.length === 1 ? "call needs" : "calls need"}{" "}
                  {viewer.isVp ? "a report on your floor" : "you"} — the time has
                  passed with no report, or the IR&apos;s email bounced.
                </span>
                <span className="shrink-0 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  {schedNeedy ? "Show all" : "Show them"}
                </span>
              </button>
            ) : null}
            {data.scheduled.length > 3 ? (
              <div className="flex flex-wrap items-center gap-2 pb-1">
                <Hint label="Only the calls you take">
                  <Button
                    variant={schedMine ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      const next = !schedMine;
                      setSchedMine(next);
                      // "With someone else" and "mine" can never both hold
                      if (next) setSchedWith("");
                    }}
                  >
                    <UserRound className="size-3.5" /> Mine
                  </Button>
                </Hint>
                <Select
                  value={schedWith || "__all"}
                  onValueChange={(v) => setSchedWith(v === "__all" ? "" : v)}
                >
                  <SelectTrigger size="sm" className="w-40 text-xs">
                    <SelectValue placeholder="With" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">With — everyone</SelectItem>
                    {schedWithOptions.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={schedLc || "__all"}
                  onValueChange={(v) => setSchedLc(v === "__all" ? "" : v)}
                >
                  <SelectTrigger size="sm" className="w-44 text-xs">
                    <SelectValue placeholder="Partner LC" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Partner LC — all</SelectItem>
                    {schedLcOptions.map((lc) => (
                      <SelectItem key={lc} value={lc}>{lc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={schedProduct || "__all"}
                  onValueChange={(v) => setSchedProduct(v === "__all" ? "" : v)}
                >
                  <SelectTrigger size="sm" className="w-32 text-xs">
                    <SelectValue placeholder="Product" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">GV + GT</SelectItem>
                    <SelectItem value="GV">GV</SelectItem>
                    <SelectItem value="GT">GT</SelectItem>
                  </SelectContent>
                </Select>
                {/* v33.41 — when, what it carries, and the sort */}
                <Select
                  value={schedWhen || "__all"}
                  onValueChange={(v) => setSchedWhen(v === "__all" ? "" : (v as typeof schedWhen))}
                >
                  <SelectTrigger size="sm" className="w-36 text-xs">
                    <SelectValue placeholder="When" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">When — any</SelectItem>
                    <SelectItem value="today">📅 Today</SelectItem>
                    <SelectItem value="week">Next 7 days</SelectItem>
                    <SelectItem value="upcoming">Still ahead</SelectItem>
                    <SelectItem value="passed">⏰ Time passed</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={schedFlag || "__all"}
                  onValueChange={(v) => setSchedFlag(v === "__all" ? "" : (v as typeof schedFlag))}
                >
                  <SelectTrigger size="sm" className="w-40 text-xs">
                    <SelectValue placeholder="Carries" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Carries — any</SelectItem>
                    <SelectItem value="bounced">⚠️ Email bounced</SelectItem>
                    <SelectItem value="note">📝 Has their note</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={schedSort}
                  onValueChange={(v) => setSchedSort(v as typeof schedSort)}
                >
                  <SelectTrigger size="sm" className="w-40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="soonest">Sort: soonest first</SelectItem>
                    <SelectItem value="latest">Sort: latest first</SelectItem>
                    <SelectItem value="lc">Sort: partner LC</SelectItem>
                    <SelectItem value="with">Sort: who takes it</SelectItem>
                    <SelectItem value="booked">Sort: just booked</SelectItem>
                  </SelectContent>
                </Select>
                {schedMine || schedWith || schedLc || schedProduct || schedWhen ||
                schedFlag || schedSort !== "soonest" ? (
                  <Hint label="Clear the filters">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      onClick={() => {
                        setSchedMine(false); setSchedWith("");
                        setSchedLc(""); setSchedProduct("");
                        setSchedWhen(""); setSchedFlag(""); setSchedSort("soonest");
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </Hint>
                ) : null}
              </div>
            ) : null}
            {scheduledShown.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No scheduled calls match these filters.
              </p>
            ) : null}
            {scheduledShown.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/40"
              >
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetail(c)}
                  onKeyDown={(e) => { if (e.key === "Enter") setDetail(c); }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words font-semibold" dir="auto">{c.partner_lc_name}</p>
                    {c.product ? <ProductTag product={c.product} /> : null}
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CALL_STATUS_CHIP.scheduled.className)}>
                      {CALL_STATUS_CHIP.scheduled.label}
                    </span>
                    {c.reschedule_requested_at ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        Reschedule asked
                      </span>
                    ) : null}
                    {c.email_bounced_at ? (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                        ⚠️ Email bounced
                      </span>
                    ) : null}
                    {pastDue(c) ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        ⏰ Time passed — report it
                      </span>
                    ) : null}
                  </div>
                  <p className="break-words text-sm text-muted-foreground">
                    {`${dayName(c.called_at)} · ${fmtDateTime(c.called_at)}`}
                    {c.booker_name ? ` · booked by ${c.booker_name}` : ""}
                    {" · with "}
                    <span dir="auto">{c.member_name}</span>
                  </p>
                  {/* THIS CALL HAS MOVED (v33.28) — said in words anyone can
                      read, because "have they messed us about?" was not an
                      answerable question before. */}
                  {(c.reschedules ?? []).length > 0 ? (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                      <RotateCcw className="size-3.5 shrink-0" />
                      <span>
                        Moved {(c.reschedules ?? []).length}{" "}
                        {(c.reschedules ?? []).length === 1 ? "time" : "times"} —
                        first booked for{" "}
                        <b>{fmtDateTime((c.reschedules ?? [])[0].from)}</b>
                        {(c.reschedules ?? []).length > 1
                          ? `, then ${(c.reschedules ?? [])
                              .slice(1)
                              .map((h) => fmtDateTime(h.from))
                              .join(", ")}`
                          : ""}
                        . Last change by{" "}
                        {(c.reschedules ?? [])[(c.reschedules ?? []).length - 1].by === "ir"
                          ? (c.reschedules ?? [])[(c.reschedules ?? []).length - 1].byName ??
                            "the IR"
                          : "us"}{" "}
                        on{" "}
                        {fmtDateTime(
                          (c.reschedules ?? [])[(c.reschedules ?? []).length - 1].at
                        )}
                        .
                      </span>
                    </p>
                  ) : null}
                  {/* WHAT TIME IT IS FOR THEM (v33.22) — we work in Cairo, the
                      IR works at home. Worth seeing before you wonder why
                      nobody joined at what is 3 AM in Jakarta. */}
                  {c.booker_tz ? (
                    <p className="break-words text-xs text-muted-foreground/80">
                      🌍 {whenLabelInZone(c.called_at, c.booker_tz)} their time
                    </p>
                  ) : null}
                  {c.meet_link ? (
                    <a
                      href={c.meet_link}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
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
                    {/* 🤝 HAND IT ON RATHER THAN CANCEL IT (v33.58). The two
                        buttons beside this one both cost the LC the call —
                        cancelling loses it, "reschedule" makes an entity
                        abroad redo work because of our rota. Keeping the time
                        and changing the host usually loses nobody anything,
                        so it sits FIRST, before the two that do. */}
                    {viewer.canHandOverCalls && handoverTargets.length > 0 ? (
                      <Hint label="Can't make it? Give this call to someone else — same time, new host">
                        <Button variant="outline" size="sm" onClick={() => setHandingOver(c)}>
                          <UserRoundPlus className="size-4" /> Hand over
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
        {/* DELETING A LOG is not the same as cancelling a call: cancelling tells
          the IR and keeps the history, this is for a row that shouldn't
          exist — a duplicate, a mis-click, a test (v33.5). */}
      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this call log?</DialogTitle>
            <DialogDescription>
              {deleting
                ? `The log of the call with ${deleting.partner_lc_name} on ${fmtDateTime(deleting.called_at)} is removed for good, along with its calendar event. Nobody is emailed — to call it OFF and tell the IR, cancel it instead.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deletePending}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={deletePending}
              onClick={() => {
                const target = deleting;
                if (!target) return;
                startDelete(async () => {
                  const res = await deleteIrCall(target.id);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success("Call log deleted");
                  setDeleting(null);
                  router.refresh();
                });
              }}
            >
              {deletePending ? "Deleting…" : "Delete the log"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          {/* SEARCH + THE DATE WINDOW (v33.32) — the two things that aren't
              columns. Everything that IS a column is filtered from its own
              header funnel (and, on phones, from the row beneath). */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-44 flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-8"
                placeholder="Search LC, IR, host or notes…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onFilter({ q: searchDraft.trim() });
                  if (e.key === "Escape") { setSearchDraft(""); onFilter({ q: "" }); }
                }}
                onBlur={() => {
                  if ((searchDraft.trim() || "") !== (filters.q ?? ""))
                    onFilter({ q: searchDraft.trim() });
                }}
              />
            </div>
            <div className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30">
              <span className="hidden text-xs font-medium text-muted-foreground min-[400px]:inline">
                Called
              </span>
              <Input
                type="date"
                aria-label="Called from"
                className="h-7 w-[7.6rem] min-[400px]:w-[8.2rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                value={filters.from ?? ""}
                onChange={(e) => onFilter({ from: e.target.value })}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                aria-label="Called to"
                className="h-7 w-[7.6rem] min-[400px]:w-[8.2rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                value={filters.to ?? ""}
                onChange={(e) => onFilter({ to: e.target.value })}
              />
            </div>
            {/* phones have no table header to hang the funnels off */}
            <div className="flex items-center gap-2 md:hidden">
              {(["product", "status", "by", "lc"] as const).map((k) => {
                const f = callFunnels[k];
                if (!f || f.options.length === 0) return null;
                return (
                  <span key={k} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {f.label}
                    {callFunnel(k)}
                  </span>
                );
              })}
            </div>
            {anyCallFilter ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchDraft("");
                  onFilter({ q: "", product: "", status: "", member: "", lc: "", from: "", to: "" });
                }}
              >
                <X className="size-4" /> Clear filters
              </Button>
            ) : null}
          </div>
          {data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {anyCallFilter
                ? "No calls match these filters — widen them or clear them."
                : "No completed IR calls yet — book one via your link or record one manually above. 🌍"}
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
                        <ResizableHead
                          key={c.key}
                          colKey={c.key}
                          cols={cols}
                          className={c.key === "screenshot" ? "text-right" : undefined}
                        >
                          <span className="inline-flex items-center gap-1">
                            <SortHeader
                              label={c.label}
                              onClick={() => {
                                // v33.40 — the log is PAGED, so the columns
                                // the server can sort re-sort the WHOLE
                                // history; the rest sort the page in hand
                                const sk = CALL_SERVER_SORTS[c.key];
                                if (sk) {
                                  const activeNow =
                                    (filters.sort ?? "called_at") === sk;
                                  const curDir =
                                    filters.dir ??
                                    (sk === "called_at" ? "desc" : "asc");
                                  onFilter({
                                    sort: sk,
                                    dir: activeNow && curDir === "asc" ? "desc" : "asc",
                                  });
                                } else {
                                  toggleSort(c.key, "asc");
                                }
                              }}
                              active={
                                CALL_SERVER_SORTS[c.key]
                                  ? (filters.sort ?? "called_at") === CALL_SERVER_SORTS[c.key] &&
                                    (!!filters.sort || c.key === "when")
                                  : sortKey === c.key
                              }
                              dir={
                                CALL_SERVER_SORTS[c.key]
                                  ? ((filters.dir ?? "desc") as "asc" | "desc")
                                  : dir
                              }
                            />
                            {callFunnel(c.key)}
                          </span>
                        </ResizableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCalls.map((c) => (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a,button")) return;
                          setDetail(c);
                        }}
                      >
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
                    <div
                      key={c.id}
                      className="cursor-pointer rounded-lg border p-3"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a,button")) return;
                        setDetail(c);
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") setDetail(c); }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 break-words font-semibold" dir="auto">
                          {c.partner_lc_name}
                        </p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {`${dayName(c.called_at)} · ${fmtDateTime(c.called_at)}`}
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
      <HandOverCallDialog
        call={handingOver}
        targets={handoverTargets}
        onClose={() => setHandingOver(null)}
      />
      <CancelCallDialog call={cancelling} onClose={() => setCancelling(null)} />
      <RequestRescheduleDialog call={rescheduling} onClose={() => setRescheduling(null)} />
      <IrCallDetailDialog
        call={detail}
        onClose={() => setDetail(null)}
        canFix={detail ? canTouch(detail) : false}
      />
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
/** THE WHOLE CALL ON ONE CARD (v33.29 part 2) — every row in the scheduled
 *  list and the log opens into this: who the IR is (role, email, phone), when
 *  in BOTH clocks, what they want to talk about, the Meet link, the host, the
 *  move history, and — for completed calls — the demand, notes and screenshot.
 *  A bounced email shows its warning here with the fix right next to it:
 *  correcting the address swaps the calendar attendee (Google re-sends the
 *  invite) and re-sends the confirmation with the manage link. */
function IrCallDetailDialog({
  call, onClose, canFix,
}: {
  call: IrCallRow | null;
  onClose: () => void;
  canFix: boolean;
}) {
  const router = useRouter();
  const [fixOpen, setFixOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [pending, start] = useTransition();
  const chip = call ? (CALL_STATUS_CHIP[call.status] ?? CALL_STATUS_CHIP.completed) : null;

  const submitFix = () => {
    if (!call) return;
    start(async () => {
      const res = await updateIrBookerEmail(call.id, newEmail);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        newEmail.trim().toLowerCase() === (call.booker_email ?? "").toLowerCase()
          ? "Re-sent — a fresh invite and confirmation are on their way."
          : "Email fixed — the invite and confirmation were re-sent."
      );
      setFixOpen(false);
      setNewEmail("");
      onClose();
      router.refresh();
    });
  };

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 break-words" dir="auto">{children}</div>
    </div>
  );

  return (
    <Dialog open={!!call} onOpenChange={(o) => { if (!o) { setFixOpen(false); setNewEmail(""); onClose(); } }}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        {call ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words" dir="auto">{call.partner_lc_name}</span>
                {call.product ? <ProductTag product={call.product} /> : null}
                {chip ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", chip.className)}>
                    {chip.label}
                  </span>
                ) : null}
              </DialogTitle>
              <DialogDescription>
                {`${dayName(call.called_at)} · ${fmtDateTime(call.called_at)}`}
                {call.duration_minutes ? ` · ${call.duration_minutes} min` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2.5">
              {call.booker_tz ? (
                <Row label="Their time">
                  🌍 {whenLabelInZone(call.called_at, call.booker_tz)}
                </Row>
              ) : null}
              <Row label="Host">{call.member_name}</Row>
              {call.booker_name ? (
                <Row label="The IR">
                  {call.booker_name}
                  {call.booker_role ? (
                    <span className="text-muted-foreground"> · {call.booker_role}</span>
                  ) : null}
                </Row>
              ) : null}
              {call.booker_email ? (
                <Row label="Email">
                  <span className="break-all">{call.booker_email}</span>
                  {call.email_bounced_at ? (
                    <span className="ml-1.5 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                      ⚠️ bounced — the last email came back
                    </span>
                  ) : null}
                  {canFix && call.status === "scheduled" ? (
                    <button
                      type="button"
                      className="ml-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      onClick={() => { setFixOpen((o) => !o); setNewEmail(call.booker_email ?? ""); }}
                    >
                      <Pencil className="size-3" /> Fix it
                    </button>
                  ) : null}
                  {fixOpen && canFix && call.status === "scheduled" ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="the.correct@address.com"
                        className="h-8 w-64 max-w-full text-sm"
                      />
                      <Button size="sm" className="h-8" disabled={pending || !newEmail.trim()} onClick={submitFix}>
                        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Save &amp; re-invite
                      </Button>
                      <p className="w-full text-xs text-muted-foreground">
                        The Meet invite moves to the new address and the IR gets a
                        fresh confirmation with their manage link. Was the address
                        right all along (their inbox was the problem)? Keep it as
                        is and hit the button — everything is simply re-sent.
                      </p>
                    </div>
                  ) : null}
                </Row>
              ) : null}
              {call.booker_phone ? (
                <Row label="Phone">
                  <a
                    href={`https://wa.me/${call.booker_phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <WhatsAppIcon className="size-3.5" /> {call.booker_phone}
                  </a>
                </Row>
              ) : null}
              {call.booker_note ? <Row label="They asked about">{call.booker_note}</Row> : null}
              {call.meet_link && call.status === "scheduled" ? (
                <Row label="Meet">
                  <a
                    href={call.meet_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <Video className="size-3.5" /> Join the Google Meet
                  </a>
                </Row>
              ) : null}
              {(call.reschedules ?? []).length > 0 ? (
                <Row label="Moves">
                  <div className="space-y-0.5 text-xs">
                    {(call.reschedules ?? []).map((h, i) => (
                      <p key={i}>
                        {fmtDateTime(h.from)} → {fmtDateTime(h.to)}{" "}
                        <span className="text-muted-foreground">
                          ({h.by === "ir" ? h.byName ?? "the IR" : "us"} · {fmtDateTime(h.at)})
                        </span>
                      </p>
                    ))}
                  </div>
                </Row>
              ) : null}
              {call.cancel_reason ? <Row label="Cancelled">{call.cancel_reason}</Row> : null}
              {call.demand ? <Row label="Demand">{call.demand}</Row> : null}
              {call.cv_pool_link ? (
                <Row label="CV pool">
                  <a
                    href={call.cv_pool_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <Link2 className="size-3.5" /> Open their CV pool
                  </a>
                </Row>
              ) : null}
              {call.notes ? <Row label="Notes">{call.notes}</Row> : null}
              {call.screenshot_link ? (
                <Row label="Screenshot">
                  <a
                    href={call.screenshot_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <ImagePlus className="size-3.5" /> Open in Drive
                  </a>
                </Row>
              ) : null}
              <Row label="Logged">{fmtDateTime(call.booked_at ?? call.created_at)}</Row>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CompleteCallDialog({ call, onClose }: { call: IrCallRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [demand, setDemand] = useState<string[]>([]);
  const [demandOther, setDemandOther] = useState("");
  const [notes, setNotes] = useState("");
  const [cvPoolLink, setCvPoolLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // closed → forget which call we loaded, so reopening always rehydrates
  if (!call && loadedFor !== null) setLoadedFor(null);
  if (call && loadedFor !== call.id) {
    setDemand([]);
    setDemandOther("");
    setNotes(call.notes ?? "");
    setCvPoolLink(call.cv_pool_link ?? "");
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
        cvPoolLink: cvPoolLink.trim() || null,
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
          {/* the LC's OWN CV pool, when they offer one (v33.6) — it used to
              go into the notes, where nobody could find it again */}
          <div className="space-y-1.5">
            <Label htmlFor="cc-cvpool">Their CV pool (optional)</Label>
            <Input
              id="cc-cvpool"
              type="url"
              inputMode="url"
              value={cvPoolLink}
              onChange={(e) => setCvPoolLink(e.target.value)}
              placeholder="https://… — a link they shared to their own CVs"
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

/** 🤝 SAME TIME, NEW HOST (v33.58).
 *
 *  The dialog's whole job is to make clear what this is NOT: it is not a
 *  cancellation and it is not a request to the IR. The time doesn't move,
 *  nobody abroad has to do anything, and the person picked here becomes the
 *  one the IR is expecting — calendar invite, Meet room and all. */
function HandOverCallDialog({
  call, targets, onClose,
}: {
  call: IrCallRow | null;
  targets: PartnershipTarget[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [to, setTo] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // reopening always starts with an empty pick — never the last person chosen
  if (!call && loadedFor !== null) setLoadedFor(null);
  if (call && loadedFor !== call.id) {
    setTo("");
    setLoadedFor(call.id);
  }

  // the current host is not a hand-over target
  const options = targets.filter((t) => t.id !== call?.member_id);

  const hand = () => {
    if (!call || !to) return;
    start(async () => {
      const res = await reassignIrCall(call.id, to);
      if (res.ok) {
        const name = options.find((o) => o.id === to)?.name ?? "them";
        // a warning is not a failure — the hand-over happened either way, and
        // whatever didn't follow it (a calendar, the IR's mail) is something
        // a human now has to finish, so it must not be a two-second toast
        if (res.data?.warning) toast.warning(res.data.warning, { duration: 12_000 });
        else
          toast.success(
            `Handed to ${name} 🤝 The IR was told, and the invite moved to their calendar.`
          );
        onClose();
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <Dialog open={!!call} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hand this call to someone else</DialogTitle>
          <DialogDescription dir="auto">
            The {call ? fmtDateTime(call.called_at) : ""} call with{" "}
            {call?.partner_lc_name} keeps its time — only the host changes.
            {call?.booker_name ? ` ${call.booker_name}` : " The IR"} gets an
            email saying who they&apos;ll be meeting, a fresh calendar invite
            goes out, and the old one is withdrawn.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>Who takes it? *</Label>
          <Select value={to || undefined} onValueChange={setTo}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick a member…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} · {t.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            From then on the call is theirs — it counts for them, they fill the
            notes, and the IR&apos;s reschedule link reads their availability.
            {call?.product ? ` It stays a ${call.product} call.` : ""}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Never mind</Button>
          <Button onClick={hand} disabled={pending || !to}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <UserRoundPlus className="size-4" />}
            Hand it over
          </Button>
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
        // v33.48 — never claim "the IR got an email" without knowing they
        // could. A bounced address returns the request saved and the mail
        // withheld, and that has to be said out loud, not celebrated.
        const warning = res.data?.warning;
        if (warning) toast.warning(warning, { duration: 12_000 });
        else toast.success("The IR got an email — they'll pick the new time. 📧");
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
  data, lcs, onLcCreated, q, viewer, setParams, cvFilters,
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
  /** the column funnels' current values, straight from the URL */
  cvFilters: { lc: string; industry: string; status: string; uploader: string; phone: string };
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
  // SEVERAL CVs AT ONCE (v33.37): a call often ends with a folder of five —
  // pick them all, each becomes its own pool row, uploaded one after another
  const [files, setFiles] = useState<File[]>([]);
  const [lcId, setLcId] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");
  const [progress, setProgress] = useState("");
  const [editing, setEditing] = useState<CvRow | null>(null);
  const [deleting, setDeleting] = useState<CvRow | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);

  const pickFiles = (list: File[]) => {
    const ok: File[] = [];
    for (const f of list) {
      if (f.size > CV_MAX) toast.error(`"${f.name}" is over 25 MB — skipped.`);
      else ok.push(f);
    }
    setFiles(ok);
  };

  /** one file through the signed-URL flow — returns a short status word */
  const uploadOne = async (file: File): Promise<string> => {
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
    if (!req.ok || !req.data) throw new Error(req.ok ? "Could not prepare the upload." : req.error);
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
    if (!putOk) throw new Error("The file upload failed — check your connection.");
    setPhase("analyzing");
    const confirm = await confirmCvUpload({
      path: req.data.path,
      ...meta,
      partnerLcId: lcId || null,
    });
    if (!confirm.ok) throw new Error(confirm.error);
    return confirm.data?.status ?? "done";
  };

  const upload = () =>
    start(async () => {
      if (files.length === 0) {
        toast.error("Pick the CV file(s) first.");
        return;
      }
      if (!lcId) {
        toast.error("Pick the partner LC these CVs came from.");
        return;
      }
      setPhase("uploading");
      let done = 0;
      const troubles: string[] = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          setProgress(files.length > 1 ? `${i + 1} of ${files.length} — ${f.name}` : "");
          setPhase("uploading");
          try {
            const status = await uploadOne(f);
            done++;
            if (status === "unsupported")
              troubles.push(`"${f.name}" can't be auto-read — fill its fields manually`);
            else if (status !== "done") troubles.push(`"${f.name}": extraction didn't stick — try Re-run`);
          } catch (e) {
            troubles.push(`"${f.name}": ${e instanceof Error ? e.message : "failed"}`);
          }
        }
        if (done > 0)
          toast.success(
            done === 1 ? "CV uploaded — the AI read it ✨" : `${done} CVs uploaded ✨`
          );
        for (const t of troubles) toast(t);
        if (done > 0) {
          setFiles([]);
          router.refresh();
        }
      } finally {
        setPhase("idle");
        setProgress("");
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
  const cols = useTableColumns("consideration-cvs-v2", CV_COLUMNS);

  /** COLUMN FUNNELS (v33.23) — the same affordance every other table in Sodio
   *  has: a funnel beside the column name, filtering SERVER-side so it filters
   *  the whole pool and not just the page you happen to be on. */
  const uploaderOptions = useMemo(
    () => [...new Set(data.rows.map((r) => r.uploader_name).filter(Boolean))].sort(),
    [data.rows]
  );
  const lcOptions = useMemo(
    () => lcs.map((l) => ({ value: l.id, label: l.name })),
    [lcs]
  );
  const cvFilter = (key: string) => {
    const pick = (
      label: string,
      value: string,
      options: { value: string; label: string }[],
      param: string
    ) => (
      <ColumnFilter
        label={label}
        value={value}
        options={options}
        onChange={(v) => setParams({ [param]: v || null, page: null })}
      />
    );
    switch (key) {
      case "industry":
        return pick(
          "Industry", cvFilters.industry,
          INDUSTRY_OPTIONS.map((i) => ({ value: i, label: i })), "industry"
        );
      case "status":
        return pick(
          "AI status", cvFilters.status,
          [
            { value: "done", label: "Done" },
            { value: "pending", label: "Pending" },
            { value: "failed", label: "Failed" },
            { value: "unsupported", label: "Unsupported" },
          ],
          "status"
        );
      case "uploader":
        // v33.52 — `|| the active pick`: an options list built from the rows on
        // screen shrinks to one the moment you filter by it, and the funnel
        // that could clear it disappeared with it
        return uploaderOptions.length > 1 || cvFilters.uploader
          ? pick(
              "Uploaded by", cvFilters.uploader,
              uploaderOptions.map((u) => ({ value: u, label: u })), "uploader"
            )
          : null;
      case "lc":
        return lcOptions.length > 1 || cvFilters.lc
          ? pick("Partner LC", cvFilters.lc, lcOptions, "cvlc")
          : null;
      // the phone funnel hangs on Contact, the column that DRAWS the number —
      // Phone itself ships hidden, exactly as on the sign-ups table
      case "contact":
        if (cols.visible.some((c) => c.key === "phone")) return null;
      // falls through
      case "phone":
        return pick(
          "Phone", cvFilters.phone,
          [
            { value: "has", label: "✅ Has a number" },
            { value: "missing", label: "📵 No number" },
          ],
          "cvphone"
        );
      default:
        return null;
    }
  };
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
              <Label>CV file(s)</Label>
              <FileDrop
                multiple
                onFiles={pickFiles}
                label="Drop one or several CVs — or click to browse"
                hint="any format · up to 25 MB each"
                fileName={files.length > 0 ? files.map((f) => f.name).join(" · ") : null}
                disabled={phase !== "idle"}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Partner LC</Label>
              {/* NO LC MANAGEMENT FROM HERE (v33.23, the LCP: "if I want to
                  edit them I will go to partner LCs"). Uploading a CV is not
                  the moment to rename or delete an entity — the ⚙ dialog is
                  one tab away. Creating a new LC inline STAYS: a CV can
                  legitimately arrive from an LC we have never called. */}
              <PartnerLcPicker
                lcs={lcs}
                value={lcId}
                onChange={setLcId}
                onCreated={onLcCreated}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Hint label="Uploads to the private CV pool, then the AI extracts the fields">
              <Button onClick={upload} disabled={pending || files.length === 0 || !lcId}>
                {phase === "idle" ? (
                  <>
                    <Upload className="size-4" />
                    {files.length > 1 ? `Upload ${files.length} CVs` : "Upload CV"}
                  </>
                ) : (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {progress || (phase === "uploading" ? "Uploading…" : "AI is reading it…")}
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

      {/* THE POOL IS FILTERABLE ON A PHONE TOO (v33.50). Every CV funnel hung
          on a column HEADER, and phones get cards — so the whole pool was
          search-only there: no industry, no AI status, no uploader, no partner
          LC, no has-a-number. These are the same five filters, the same URL
          params and the same server-side query; they just carry their own
          names because there is no header to sit on. */}
      <div className="flex flex-wrap gap-2 md:hidden">
        <FilterSelect
          value={cvFilters.industry}
          placeholder="Industry"
          onChange={(v) => setParams({ industry: v || null, page: null })}
          options={INDUSTRY_OPTIONS.map((i) => [i, i] as [string, string])}
        />
        <FilterSelect
          value={cvFilters.status}
          placeholder="AI status"
          onChange={(v) => setParams({ status: v || null, page: null })}
          options={[
            ["done", "Done"], ["pending", "Pending"],
            ["failed", "Failed"], ["unsupported", "Unsupported"],
          ]}
        />
        <FilterSelect
          value={cvFilters.phone}
          placeholder="Phone"
          onChange={(v) => setParams({ cvphone: v || null, page: null })}
          options={[["has", "✅ Has a number"], ["missing", "📵 No number"]]}
        />
        {lcOptions.length > 1 ? (
          <FilterSelect
            value={cvFilters.lc}
            placeholder="Partner LC"
            onChange={(v) => setParams({ cvlc: v || null, page: null })}
            options={lcOptions.map((o) => [o.value, o.label] as [string, string])}
          />
        ) : null}
        {uploaderOptions.length > 1 ? (
          <FilterSelect
            value={cvFilters.uploader}
            placeholder="Uploaded by"
            onChange={(v) => setParams({ uploader: v || null, page: null })}
            options={uploaderOptions.map((u) => [u, u] as [string, string])}
          />
        ) : null}
        {[cvFilters.industry, cvFilters.status, cvFilters.phone, cvFilters.lc, cvFilters.uploader]
          .some(Boolean) ? (
          <Button
            variant="ghost"
            className="h-9"
            onClick={() =>
              setParams({
                industry: null, status: null, cvphone: null, cvlc: null,
                uploader: null, page: null,
              })
            }
          >
            Clear
          </Button>
        ) : null}
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
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {cvFilter(c.key)}
                      </span>
                    </TableHead>
                  ) : (
                    <TableHead key={c.key}>
                      <span className="inline-flex items-center gap-1">
                        <SortHeader
                          label={c.label}
                          onClick={() => toggleSort(c.key, c.key === "created" ? "desc" : "asc")}
                          active={sortKey === c.key}
                          dir={dir}
                        />
                        {cvFilter(c.key)}
                      </span>
                    </TableHead>
                  )
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCvs.map((cv) => (
                // the whole row opens the CV — everything you can do to it
                // lives inside, so there is no separate "edit" trip (v33.8)
                <TableRow
                  key={cv.id}
                  className="cursor-pointer"
                  onClick={() => setEditing(cv)}
                >
                  {cols.visible.map((c) => (
                    <TableCell
                      key={c.key}
                      className={CV_CELL_CLASS[c.key]}
                      onClick={
                        c.key === "actions" || c.key === "contact"
                          ? (e) => e.stopPropagation()
                          : undefined
                      }
                    >
                      {cvCell(cv, c.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* phones: cards */}
        {/* A GRID WITH NO TEMPLATE PUTS ITS CHILDREN IN AN IMPLICIT `auto`
            TRACK (v33.28), and a grid item keeps `min-width: auto` — so the
            track is sized by its widest child's MIN-CONTENT and the cards grew
            to 797px inside a 343px phone. `grid-cols-1` is
            repeat(1, minmax(0,1fr)): a flexible track, minimum 0. */}
        <div className="grid grid-cols-1 gap-3 md:hidden">
          {sortedCvs.map((cv) => {
            const chip = STATUS_CHIP[cv.extraction_status];
            const wa = waDigits(cv.phone);
            const mine = cv.uploaded_by === viewer.id;
            const canManage = viewer.isVp || mine;
            return (
              <Card key={cv.id} className="min-w-0 rise-in">
                <CardContent className="space-y-2.5 p-4 px-4">
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
                    {/* "Manual (format not auto-readable)" was eating 202 of
                        293px on a phone (v33.28) */}
                    <div className="flex max-w-[45%] shrink-0 flex-col items-end gap-1">
                      {cv.industry ? <Badge variant="secondary">{cv.industry}</Badge> : null}
                      <span className={cn("rounded-full px-2 py-0.5 text-end text-[11px] font-medium", chip.className)}>
                        {chip.label}
                      </span>
                    </div>
                  </div>

                  {cv.summary ? (
                    <p className="line-clamp-2 break-words text-sm text-muted-foreground" dir="auto">
                      {cv.summary}
                    </p>
                  ) : null}
                  {cv.skills ? (
                    <p className="line-clamp-2 break-words text-xs" dir="auto">
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
  const [form, setForm] = useState({
    name: "", phone: "", email: "", industry: "", skills: "", summary: "", lcId: "",
  });
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
      summary: cv.summary ?? "",
      lcId: cv.partner_lc_id ?? "",
    });
    setLoadedFor(cv.id);
  }

  /** Open or download the file, named for the person (v33.8). The window is
   *  opened BEFORE the await — Safari blocks a popup that arrives later. */
  const openFile = (download: boolean) => {
    if (!cv) return;
    const w = window.open("", "_blank");
    start(async () => {
      const res = await getCvFileUrl(cv.id, download);
      if (!res.ok || !res.data) {
        w?.close();
        toast.error(res.ok ? "Could not open the file." : res.error);
        return;
      }
      if (w) w.location.href = res.data.url;
      else window.location.href = res.data.url;
    });
  };

  const save = () => {
    if (!cv) return;
    start(async () => {
      const res = await updateCvFields(cv.id, {
        person_name: form.name || null,
        phone: form.phone || null,
        email: form.email || null,
        industry: form.industry || null,
        skills: form.skills || null,
        summary: form.summary || null,
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
                placeholder="+90… — with the country code"
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
          {/* THE SUMMARY (v33.8) — the AI writes a paragraph about the person
              and it had nowhere to be read: too long for a table cell, and
              this dialog didn't show it. It's the fastest way to judge whether
              a CV is worth forwarding. */}
          <div className="space-y-1.5">
            <Label htmlFor="cv-edit-summary">Summary</Label>
            <Textarea
              id="cv-edit-summary"
              dir="auto"
              rows={4}
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
              placeholder="What the AI made of this CV — edit freely."
            />
          </div>

          {/* everything you can DO with a CV, where you're already looking */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => openFile(false)}>
              <FileText className="size-4" /> Open the file
            </Button>
            <Button variant="outline" size="sm" onClick={() => openFile(true)}>
              <Upload className="size-4 rotate-180" /> Download
            </Button>
            {form.phone ? (
              <Button asChild variant="outline" size="sm">
                <a
                  href={`https://wa.me/${form.phone.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <WhatsAppIcon className="size-4" /> WhatsApp
                </a>
              </Button>
            ) : null}
            {form.email ? (
              <Button asChild variant="outline" size="sm">
                <a href={`mailto:${form.email}`}>
                  <Mail className="size-4" /> Email
                </a>
              </Button>
            ) : null}
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
