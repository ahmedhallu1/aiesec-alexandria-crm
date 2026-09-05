"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Archive, Check, ChevronDown, History, LayoutDashboard, Loader2, Mail, Pencil, Phone,
  PhoneCall, RefreshCw, RotateCcw,
  MessageSquarePlus,
  Search, UserMinus, UserPlus, UserRound, Users2, X,
} from "lucide-react";
import {
  addSignupComment, addSignupReferral, assignB2cCic, assignCicCaller, bulkAssignB2cCic,
  bulkAssignCicCaller, bulkReassignSignups, clearB2cCic, updateB2cCic,
  bulkReviveSignups, claimSignup, clearCicCaller,
  openSignupDetail,
  reassignSignup, reviveSignup, runSignupsImport, setSignupOop,
  setSignupPotential, updateCicContact, updateReferralDetails, updateSignupContact,
  updateSignupVpFields,
} from "@/server/actions";
import type {
  OgxPlanCard, SignupCicCall, SignupDetail, SignupListRow, StreakStats,
} from "@/server/data";
import {
  fmtDateTime, SIGNUP_STATUSES,
  B2C_CALL_OUTCOMES, b2cOutcomeLabel, b2cOutcomeReached,
  type OgxFunction, type SignupLog, type SignupRow,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { CountryInput } from "./country-input";
import {
  ColumnFilter, PageSizePicker, resizableCellStyle, ResizableHead, TableSettings, useTableColumns, type TableColumn,
} from "./data-table-kit";
import { Hint } from "./hint";
import { StreakCard } from "./streak-card";
import { WhatsAppIcon } from "./icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
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
import { Switch } from "@/components/ui/switch";

const waDigits = (phone: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.startsWith("20") ? d : d.startsWith("0") ? `2${d}` : `20${d}`;
};

/** A usable phone has DIGITS — tracker placeholders like "-" or "deleted
 *  phone number" are truthy strings, and gating on truthiness rendered dead
 *  Call/WhatsApp buttons (tel:-, wa.me/null) on phone-less sign-ups. */
const hasPhone = (phone: string | null) => !!waDigits(phone);

/** The member-movable "potential" pipeline (v28) — "Parents Approval" stays
 *  VP-set and lives only in the VP fields' status select. */

const VIEW_LABELS: Record<string, string> = {
  unassigned: "🆕 Unassigned",
  mine: "My sign-ups",
  team: "My team",
  // CIC — Customer Interview Call (v33.19)
  cic: "📞 CIC",
  // organic referrals — their own tab, because they are worked differently
  // from a tracker sign-up and get lost among thousands of them (v33.32.2)
  referral: "🤝 Referrals",
  all: "All",
  archived: "🗄️ Archived",
};

/** CIC = a SECOND person re-calls a sign-up the first assignee marked
 *  Contacted that never got a status — verifying the first call really
 *  happened, and following up. The first assignee KEEPS the row and their
 *  KPIs/MOS; the second call is recorded separately in the cic_* fields. */
const CIC_BLURB =
  "Customer Interview Calls: a second caller re-calls sign-ups marked Contacted that never got a status — checking the first call really happened and following up. The first assignee keeps the row and the KPIs.";

const VIEW_HINTS: Record<string, string> = {
  unassigned: "Nobody holds these yet — hand them out.",
  mine: "What you answer for.",
  cic: CIC_BLURB,
  referral:
    "People who came to us directly, not through the tracker — added here, worked like any sign-up.",
  all: "Every sign-up in the function.",
  archived: "Out of Process — browsable, revivable by a VP.",
};

// Official AIESEC product colors (same as the accounts module's badges).
const PROGRAM_COLORS: { key: string; label: string; color: string }[] = [
  { key: "gta", label: "GTa", color: "#0CB9C1" },
  { key: "gte", label: "GTe", color: "#F48924" },
  { key: "gv", label: "GV", color: "#F85A40" },
];

/** "GV New" / "GV" → GV red, GTa → teal, GTe → orange; unmatched OGT rows
 *  fall back to the generic GT teal, OGV rows to the GV red.
 *
 *  ⚠️ THE LONG FORMS HAVE TO BE MATCHED EXPLICITLY (v35.1). The abbreviation
 *  test is `includes("gv")`, and **"global volunteer" does not contain the
 *  letters "gv"** — so the 31 referral rows, which store the programme's full
 *  name, fell through to the raw-value branch and rendered a wide red
 *  "Global Volunteer" pill in a column of tidy GV/GTa/GTe badges. Same word,
 *  two different-looking rows, which is exactly how it was reported. */
const PROGRAM_WORDS: [RegExp, string][] = [
  [/global\s*volunteer/, "gv"],
  [/global\s*talent/, "gta"],
  [/global\s*teacher/, "gte"],
];

function programColor(program: string | null, fn: OgxFunction): { label: string; color: string } {
  let p = (program ?? "").toLowerCase();
  for (const [re, key] of PROGRAM_WORDS) if (re.test(p)) p = key;
  for (const { key, label, color } of PROGRAM_COLORS)
    if (p.includes(key)) return { label, color };
  if (program) return { label: program, color: fn === "OGV" ? "#F85A40" : "#0CB9C1" };
  return fn === "OGV"
    ? { label: "GV", color: "#F85A40" }
    : { label: "GT", color: "#0CB9C1" };
}

function ProgramBadge({
  program, fn, className,
}: {
  program: string | null;
  fn: OgxFunction;
  className?: string;
}) {
  const b = programColor(program, fn);
  return (
    <Badge
      className={cn("border-transparent text-white", className)}
      style={{ backgroundColor: b.color }}
    >
      {b.label}
    </Badge>
  );
}

/** Minimal round checkbox for the bulk-selection mode (accounts-list pattern). */
function SelectDot({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:border-primary/60"
      )}
    >
      {checked ? <Check className="size-3.5" /> : null}
    </button>
  );
}

/** The OGX MM's motivation card: this month's filed mm_plan vs their live
 *  sign-up pipeline — Approvals (the MOS) front and center. */
function MmPlanCard({ plan }: { plan: OgxPlanCard }) {
  const monthLabel = new Date(`${plan.month}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const mosPct =
    plan.plan.approvals > 0
      ? Math.min(100, Math.round((plan.actual.approvals / plan.plan.approvals) * 100))
      : plan.actual.approvals > 0
        ? 100
        : 0;
  const pair = (actual: number, planned: number) => (
    <p className="text-lg font-semibold tabular-nums">
      {actual}
      <span className="text-sm font-normal text-muted-foreground"> / {planned}</span>
    </p>
  );
  return (
    <Card className="rise-in border-primary/30">
      <CardContent className="space-y-2.5 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-semibold">🎯 My plan · {monthLabel}</p>
          <p className="text-xs text-muted-foreground">
            your current pipeline vs this month&apos;s plan
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Applicants
            </p>
            {pair(plan.actual.applicants, plan.plan.applicants)}
            <p className="text-[10px] text-muted-foreground">Applied or beyond</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Accepted
            </p>
            {pair(plan.actual.accepted, plan.plan.accepted)}
            <p className="text-[10px] text-muted-foreground">Accepted or beyond</p>
          </div>
          <div className="rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              Approvals · MOS
            </p>
            <p className="text-xl font-bold tabular-nums text-primary">
              {plan.actual.approvals}
              <span className="text-sm font-normal text-primary/70"> / {plan.plan.approvals}</span>
            </p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-primary/15">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${mosPct}%` }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** A COMMENT WITHOUT OPENING THE SIGN-UP (v33.32.2) — the raising list's
 *  quick-comment, for OGX. It lands in the same two-class log as any other
 *  (member comments to the sheet's Comment cell, a VP's to the VP Comment
 *  cell), so nothing about where comments live changes — only how far you
 *  have to travel to leave one. */
function SignupCommentDialog({
  target, onOpenChange,
}: {
  target: { id: string; name: string } | null;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const targetId = target?.id;
  useEffect(() => setBody(""), [targetId]);

  const submit = () =>
    start(async () => {
      if (!target) return;
      const res = await addSignupComment(target.id, body);
      if (res.ok) {
        toast.success("Comment added 💬");
        setBody("");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle dir="auto">💬 Comment on {target?.name}</DialogTitle>
          <DialogDescription>
            Lands in the sign-up&apos;s comment log — stamped with your name and
            the time, and written back to the tracker sheet like any other.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          dir="auto"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What they said / what to know…"
        />
        <DialogFooter>
          <Button onClick={submit} disabled={pending || body.trim().length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <MessageSquarePlus className="size-4" />}
            Add comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ADD AN ORGANIC REFERRAL (v33.32).
 *
 *  A person we can approve who never came through the tracker. Everything
 *  after this dialog is the ordinary sign-up journey — contacted, interested,
 *  Applied → Accepted → Approved — so the form asks only what the tracker
 *  would have carried and nothing more. */
function ReferralDialog({
  open, onOpenChange, fns, activeFn, targets, viewerId, canAssign,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fns: OgxFunction[];
  activeFn: OgxFunction;
  targets: { id: string; label: string }[];
  viewerId: string;
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    fn: activeFn as string,
    name: "",
    phone: "",
    email: "",
    dob: "",
    country: "",
    subProduct: "",
    referredBy: "",
    contacted: "",
    interested: "",
    status: "",
    note: "",
    assignTo: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const ready = form.name.trim().length >= 2 && (!!form.phone.trim() || !!form.email.trim());

  const submit = () =>
    start(async () => {
      const res = await addSignupReferral({
        fn: form.fn,
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        dob: form.dob || null,
        country: form.country || null,
        subProduct: form.subProduct || null,
        referredBy: form.referredBy || null,
        contacted: form.contacted || null,
        interested: form.interested || null,
        status: form.status || null,
        note: form.note || null,
        assignTo: form.assignTo || null,
      });
      if (res.ok) {
        toast.success("Referral added — it's in the funnel now 🤝");
        onOpenChange(false);
        setForm((f) => ({
          ...f, name: "", phone: "", email: "", dob: "", country: "",
          referredBy: "", contacted: "", interested: "", status: "",
          note: "", assignTo: "",
        }));
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>🤝 Add a referral</DialogTitle>
          <DialogDescription>
            Someone who came to us directly instead of through the sign-up
            form. They join the same funnel as everyone else — contact them,
            mark them interested, and take them to Approved. Their numbers
            count on the {form.fn} dashboard exactly like a tracker sign-up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {fns.length > 1 ? (
            <div className="grid gap-1.5">
              <Label>Function</Label>
              <Select value={form.fn} onValueChange={(v) => set("fn", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {fns.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label>Their name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input
                inputMode="tel"
                placeholder="+20 10 1234 5678"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                inputMode="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            One of the two is enough — but without either, nobody can reach them.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Date of birth</Label>
              <Input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={form.dob}
                onChange={(e) => set("dob", e.target.value)}
              />
            </div>
            {form.fn === "OGT" ? (
              <div className="grid gap-1.5">
                <Label>Sub product</Label>
                <Select
                  value={form.subProduct || undefined}
                  onValueChange={(v) => set("subProduct", v)}
                >
                  <SelectTrigger><SelectValue placeholder="GTa / GTe" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GTa">GTa</SelectItem>
                    <SelectItem value="GTe">GTe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label>Country</Label>
            <CountryInput
              value={form.country}
              onChange={(v) => set("country", v)}
              placeholder="Where do they want to go?"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Referred by</Label>
            <Input
              placeholder="Who sent them our way?"
              value={form.referredBy}
              onChange={(e) => set("referredBy", e.target.value)}
            />
          </div>
          {/* THE FUNNEL, FROM THE START (v33.32.2) — whoever logs a referral
              has usually already spoken to them, so the first three steps are
              here rather than one re-open away. All optional. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Contacted</Label>
              <Select
                value={form.contacted || "__none"}
                onValueChange={(v) => set("contacted", v === "__none" ? "" : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Not yet</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Interested</Label>
              <Select
                value={form.interested || "__none"}
                onValueChange={(v) => set("interested", v === "__none" ? "" : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={form.status || "__none"}
                onValueChange={(v) => set("status", v === "__none" ? "" : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None yet</SelectItem>
                  {SIGNUP_STATUSES.map((st) => (
                    <SelectItem key={st} value={st}>{st}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {canAssign && targets.length > 0 ? (
            <div className="grid gap-1.5">
              <Label>Who works it</Label>
              <Select
                value={form.assignTo || "__me"}
                onValueChange={(v) => set("assignTo", v === "__me" ? "" : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__me">Me</SelectItem>
                  {targets
                    .filter((t) => t.id !== viewerId)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label>First note</Label>
            <Textarea
              rows={2}
              placeholder="How they came to us, what they're after…"
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!ready || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Add referral
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** v27 — the OGV contact-streak game: ≥1 sign-up contact action per Cairo day
 *  keeps the flame alive. Dimmed flame until today's save lands. */


interface ViewerInfo {
  id: string;
  name: string;
  isLeader: boolean;
  isTl: boolean;
  /** MMs and above — may hand a sign-up to a SECOND caller (seesCicQueue) */
  canCic: boolean;
  /** B2C MMs+ — may hand out B2C calls per the matrix (v33.29) */
  canB2cCic: boolean;
  /** a pure-B2C viewer: only the CIC view exists for them */
  b2cOnly: boolean;
  canVp: boolean;
  /** may log an organic referral (v33.32) — the function's own rule: the
   *  whole crew, or MMs and above */
  canRefer: boolean;
}

// ------------------------------------------------- universal table columns

/** Server sort fields (SIGNUP_SORTABLE in data.ts) per column key. */
const SIGNUP_SORT: Record<string, { field: string; dir: "asc" | "desc" }> = {
  signed_up_at: { field: "signed_up_at", dir: "desc" },
  // the DEFAULT order of every assigned view (v33.58) — newest hand-out first
  assigned: { field: "assigned_at", dir: "desc" },
  name: { field: "name", dir: "asc" },
  program: { field: "program", dir: "asc" },
  contacted: { field: "contact_status", dir: "asc" },
  interested: { field: "interested", dir: "asc" },
  status: { field: "status", dir: "asc" },
  country: { field: "country", dir: "asc" },
};

const SIGNUP_CELL_CLASS: Record<string, string> = {
  signed_up_at: "whitespace-nowrap text-sm text-muted-foreground",
  assigned: "text-sm",
  contacted: "text-sm",
  interested: "text-sm",
  status: "text-sm",
  country: "text-sm text-muted-foreground",
  person_status: "max-w-40 truncate text-sm text-muted-foreground",
  campaign: "max-w-44 truncate text-sm text-muted-foreground",
  comment: "max-w-[26rem] align-top text-sm",
  email: "max-w-48 truncate text-sm text-muted-foreground",
  phone: "whitespace-nowrap text-sm text-muted-foreground",
  ep_id: "text-sm text-muted-foreground",
  batch: "text-sm text-muted-foreground",
  university: "max-w-44 truncate text-sm text-muted-foreground",
  grad_year: "text-sm text-muted-foreground",
  home_lc: "max-w-40 truncate text-sm text-muted-foreground",
  gender: "text-sm text-muted-foreground",
  referral: "max-w-40 truncate text-sm text-muted-foreground",
  background: "max-w-44 truncate text-sm text-muted-foreground",
  sub_product: "text-sm text-muted-foreground",
  cic_assigned: "text-sm",
  cic_contacted: "text-sm",
  cic_interested: "text-sm",
};

/**
 * The sign-ups table columns. Every field the tracker carries is available in
 * ⚙ Columns; what SHOWS by default depends on the view and the function:
 *  · Unassigned — no Status, no Country (nothing is set there yet) and, for
 *    OGV, no Program (they're all GV) — instead **Person status** + **Campaign**,
 *    the two things that actually help you pick who to call.
 *  · 📞 CIC — the second-caller columns (who is on it, and THEIR
 *    contacted/interested) instead of the pool's intake columns.
 *  · Every other view keeps the classic set.
 *
 * The stored preference is keyed per view × function, so "default hidden
 * outside the CIC view" really is per-view — nothing is force-shown over a
 * member's own ⚙ Columns choice.
 */
function signupColumns(fn: OgxFunction, view: string): TableColumn[] {
  const pool = view === "unassigned";
  const cic = view === "cic";
  return [
    { key: "signed_up_at", label: "Signed up" },
    { key: "name", label: "Sign-up", required: true },
    // OGV sign-ups are ALL GV — the badge is dead weight there (v31)
    { key: "program", label: "Program", defaultHidden: fn === "OGV" },
    { key: "batch", label: "Batch" },
    // v33.14 — the CALL/WHATSAPP/EMAIL links, named as they are on the
    // raising list. Removing the Contact BUTTON took these with it by
    // accident; they are the part people actually use.
    { key: "contact", label: "Quick actions" },
    // ON THE CIC QUEUE THE ASSIGNEE *IS* THE FIRST CALLER (v34.11) — named so
    // it reads as the counterpart of "2nd caller" two columns over
    { key: "assigned", label: cic ? "1st caller" : "Assigned" },
    { key: "contacted", label: "Contacted" },
    { key: "interested", label: "Interested" },
    // CIC (v33.19) — the SECOND call, kept beside the first so the two are
    // never confused. Off everywhere but the CIC view.
    { key: "cic_assigned", label: "2nd caller", defaultHidden: !cic },
    { key: "cic_contacted", label: "CIC contacted", defaultHidden: !cic },
    { key: "cic_interested", label: "CIC interested", defaultHidden: !cic },
    // B2C CIC (v33.29) — the SELLING call, side-tagged so the log always says
    // which side rang. Off everywhere but the CIC view.
    { key: "cic_b2c", label: "B2C caller", defaultHidden: !cic },
    { key: "cic_b2c_contacted", label: "B2C outcome", defaultHidden: !cic },
    { key: "cic_b2c_interested", label: "B2C interested", defaultHidden: !cic },
    { key: "person_status", label: "Person status", defaultHidden: !pool },
    { key: "campaign", label: "Campaign", defaultHidden: !pool },
    { key: "status", label: "Status", defaultHidden: pool },
    { key: "country", label: "Country", defaultHidden: pool },
    // THE THREAD, ON THE LIST (v33.32.2) — same as the raising table: read
    // what was said and leave a line without opening the sign-up
    { key: "comment", label: "Comment" },
    { key: "actions", label: "Actions" },
    { key: "email", label: "Email", defaultHidden: true },
    { key: "phone", label: "Phone", defaultHidden: true },
    { key: "ep_id", label: "EP ID", defaultHidden: true },
    { key: "university", label: "University", defaultHidden: true },
    { key: "grad_year", label: "Grad year", defaultHidden: true },
    { key: "home_lc", label: "Home LC", defaultHidden: true },
    { key: "gender", label: "Gender", defaultHidden: true },
    { key: "referral", label: "Referral", defaultHidden: true },
    { key: "background", label: "Background", defaultHidden: true },
    ...(fn === "OGT"
      ? [{ key: "sub_product", label: "Sub product", defaultHidden: true }]
      : []),
  ];
}

// --------------------------------------------- contact-after-click prompt

type Channel = "WhatsApp" | "Call" | "Email";

/** Which channel a quick-action link stands for. */
function channelFromHref(href: string): Channel | null {
  const h = href.toLowerCase();
  if (h.startsWith("tel:")) return "Call";
  if (h.startsWith("mailto:")) return "Email";
  if (h.includes("wa.me") || h.includes("whatsapp.com")) return "WhatsApp";
  return null;
}

/** Wraps the WhatsApp / call / email links: they open exactly as before, and
 *  the click also raises the "log it" prompt. One prompt per click. */
function ContactLinks({
  onUsed, children,
}: {
  onUsed: (channel: Channel) => void;
  children: React.ReactNode;
}) {
  return (
    <span
      className="contents"
      onClickCapture={(e) => {
        const el = (e.target as HTMLElement | null)?.closest?.("a[href]");
        if (!el) return;
        const channel = channelFromHref(el.getAttribute("href") ?? "");
        if (channel) onUsed(channel);
      }}
    >
      {children}
    </span>
  );
}

/** ⏰ "RING ME AT FOUR" (v35.1) — the one call outcome that is an appointment.
 *
 *  A call-back with no time is a note nobody acts on, so the time is asked for
 *  here and the caller is nudged when it falls due (the reminder rides the
 *  visit-followups pass, so it lands at the next tick after the time — a
 *  floor, not an alarm). Recording the next outcome clears the appointment. */
function CallBackDialog({
  call, name, onClose, onSaved,
}: {
  call: SignupCicCall;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // default: an hour from now, rounded to the next five minutes
  const initial = (() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const [when, setWhen] = useState(call.call_back_at ? call.call_back_at.slice(0, 16) : initial);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      // the input is LOCAL wall-clock; Date turns it into the right instant
      const iso = new Date(when).toISOString();
      const res = await updateB2cCic(call.id, { outcome: "call_back", callBackAt: iso });
      if (res.ok) {
        toast.success("⏰ Call back saved — you'll get a reminder when it's due");
        onSaved();
      } else toast.error(res.error);
    });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>⏰ Call {name} back</DialogTitle>
          <DialogDescription>
            When did they ask you to ring? You&apos;ll get a notification then —
            on your phone too, if you have those switched on.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>When</Label>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending || !when}>
            {pending ? "Saving…" : "Save the call back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Fires right after a sign-up's WhatsApp / call / email link is opened: the
 *  same fields the detail dialog carries (Contacted · Interested · comment),
 *  with the channel already written into the comment. Claims the sign-up on
 *  the way when it came from the unassigned pool — the exact same motion as
 *  the Contact button. "Not now" always gets you out. */
/** ⚠️ v36 — THIS PROMPT SERVES TWO DIFFERENT CALLERS, AND IT USED TO SERVE
 *  ONLY ONE OF THEM.
 *
 *  Tapping Call/WhatsApp on a CIC row opened this dialog for everybody and
 *  saved through `updateSignupContact`, which is gated on `canWorkSignup` —
 *  the sign-up's OWNER. A B2C caller is never the owner: they were handed to
 *  this row to sell a course, not to run the OGX funnel. So pressing "Log it"
 *  returned a flat **"You are not allowed to work this sign-up."** They were
 *  being shown somebody else's form and blamed for using it.
 *
 *  The two calls are genuinely different work and Sodio has said so since
 *  v35.1: an OGX contact moves the sign-up's own funnel, while a B2C selling
 *  call lives in `signup_cic_calls` and must NEVER touch it — otherwise the
 *  OGX crew's numbers move because somebody rang about a course.
 *
 *  So the prompt now asks who is calling and offers the form that person can
 *  actually save: the OGX contact for the owner, the B2C outcome for the B2C
 *  caller. `my_open_b2c_call_id` is resolved on the server beside `can_work`
 *  (see listSignupsPage) so the two can never disagree about who may do what. */
function SignupContactPrompt({
  row, channel, onClose, onOpenDetail,
}: {
  row: SignupListRow;
  channel: Channel;
  onClose: () => void;
  onOpenDetail: () => void;
}) {
  const router = useRouter();
  const [contacted, setContacted] = useState("Yes");
  const [interested, setInterested] = useState("__unset");
  const [comment, setComment] = useState(`Reached out on ${channel}.`);
  const [outcome, setOutcome] = useState("answered");
  const [callBack, setCallBack] = useState("");
  const [pending, start] = useTransition();

  const unassigned = !row.assigned_to && !row.assigned_name;
  // The B2C form is offered only when this viewer CANNOT work the sign-up but
  // DOES owe a B2C call on it. Somebody who is both (a B2C member who also
  // owns the row) keeps the OGX form — it is the one that moves the funnel,
  // and their B2C call is still recordable from the CIC columns.
  const b2cCallId = row.can_work ? null : (row.my_open_b2c_call_id ?? null);
  const isB2cCall = !!b2cCallId;
  const needsTime = isB2cCall && outcome === "call_back";

  const submit = () =>
    start(async () => {
      // ---- the B2C selling call: its own row, never the OGX funnel --------
      if (b2cCallId) {
        if (needsTime && !callBack) {
          toast.error("Pick when to call them back.");
          return;
        }
        const res = await updateB2cCic(b2cCallId, {
          outcome,
          ...(needsTime ? { callBackAt: new Date(callBack).toISOString() } : {}),
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        // The comment lands in B2C's OWN thread (author_class 'b2c') — that is
        // what addSignupComment gives a B2C caller, and it is deliberately not
        // written back to the OGX tracker sheet.
        if (comment.trim()) {
          const c = await addSignupComment(row.id, comment.trim());
          if (!c.ok) toast.error(c.error);
        }
        toast.success(
          needsTime
            ? "⏰ Call back saved — you'll get a reminder when it's due"
            : "B2C call recorded 🛍"
        );
        onClose();
        router.refresh();
        return;
      }

      // ---- the OGX contact: the owner's funnel ---------------------------
      if (unassigned) {
        const claim = await claimSignup(row.id);
        if (!claim.ok) {
          toast.error(claim.error);
          return;
        }
      }
      const res = await updateSignupContact(row.id, {
        contactStatus: contacted,
        interested: interested === "__unset" ? null : interested,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (comment.trim()) {
        const c = await addSignupComment(row.id, comment.trim());
        if (!c.ok) toast.error(c.error);
      }
      toast.success(
        unassigned ? "Logged — and it's yours now ✍️" : "Contact logged ✍️"
      );
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle dir="auto">
            {channel === "WhatsApp" ? "💬" : channel === "Call" ? "📞" : "✉️"} Did you
            reach {row.name}?
          </DialogTitle>
          <DialogDescription>
            {isB2cCall ? (
              <>
                You just opened <b>{channel}</b> for your <b>B2C</b> call. Record
                what happened — this is your selling call, and it stays on your
                own log. It never touches their OGX funnel.
              </>
            ) : (
              <>
                You just opened <b>{channel}</b>. Log it here — a sign-up contacted
                without a record is a sign-up nobody follows up.
                {unassigned ? " Saving also claims them for you." : ""}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {isB2cCall ? (
            <>
              <div className="grid gap-1.5">
                <Label>What happened?</Label>
                <Select value={outcome} onValueChange={setOutcome}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {B2C_CALL_OUTCOMES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {B2C_CALL_OUTCOMES.find((o) => o.value === outcome)?.hint}
                </p>
              </div>
              {needsTime ? (
                <div className="grid gap-1.5">
                  <Label>When should you call back?</Label>
                  <Input
                    type="datetime-local"
                    value={callBack}
                    onChange={(e) => setCallBack(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Cairo time. You&apos;ll get a nudge once it falls due — it is a
                    floor, not an alarm.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Contacted</Label>
              <Select value={contacted} onValueChange={setContacted}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Interested</Label>
              <Select value={interested} onValueChange={setInterested}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">— not yet</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          )}
          <div className="grid gap-1.5">
            <Label>Comment</Label>
            <Textarea
              dir="auto"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What was said…"
            />
          </div>
          <button
            type="button"
            className="text-left text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
            onClick={() => { onClose(); onOpenDetail(); }}
          >
            {isB2cCall
              ? "See everything on this person? Open the details →"
              : "Need the full record (potential, country, archive)? Open the details →"}
          </button>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Not now
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
            Log it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SignupsView({
  rows, total, page, pageSize, pageSizeOptions, activeView, views, fns, activeFn, fnAll = false,
  targets, cicTargets, b2cTargets, loadLogs, planCard, streak, viewer, filters, filterOptions,
  firstCallers = [],
}: {
  rows: SignupListRow[];
  /** every value each filterable column holds across the WHOLE set — a filter
   *  built from the visible page could only offer what happened to be on it */
  filterOptions: Record<string, string[]>;
  /** CIC tab only — the people who made the FIRST call, by member id. Empty
   *  everywhere else, and for anyone who doesn't see the whole queue. */
  firstCallers?: { value: string; label: string }[];
  total: number;
  page: number;
  pageSize: number;
  /** the sign-ups-per-page choices (?size param) */
  pageSizeOptions: number[];
  activeView: string;
  views: string[];
  fns: OgxFunction[];
  activeFn: OgxFunction;
  /** B2C only: no side is picked, so the queue spans BOTH (v33.29) */
  fnAll?: boolean;
  targets: { id: string; label: string }[];
  /** who a CIC second call can be handed to — empty for anyone below an MM */
  cicTargets: { id: string; label: string }[];
  /** who a B2C call can be handed to (the v33.29 matrix) */
  b2cTargets: { id: string; label: string }[];
  /** server function (declared in the page) — one sign-up's edit history */
  loadLogs: (signupId: string) => Promise<SignupLog[]>;
  planCard: OgxPlanCard | null;
  streak: StreakStats | null;
  viewer: ViewerInfo;
  filters: {
    q: string; batch: string; program: string; status: string; potential: string;
    personStatus?: string; assigned?: string; campaign?: string;
    /** CIC tab only — "the second calls handed to me" */
    cicMine?: string;
    /** CIC tab only — first-caller member ids (comma list) */
    firstCaller?: string;
    interested: string; contacted: string; phone: string; sort: string; dir: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(filters.q);
  const [detail, setDetail] = useState<SignupDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  // v31: opening WhatsApp / a call / an email asks to log it right after
  const [quickContact, setQuickContact] =
    useState<{ row: SignupRow; channel: Channel } | null>(null);
  // "ring me at four" needs a time, or the reminder has nothing to fire on
  const [callBack, setCallBack] =
    useState<{ call: SignupCicCall; name: string } | null>(null);

  // bulk selection (TL/VP/Director/LCP-admin): assign to a member or send
  // back to the pool — the archived view is read-only, no selection there
  // bulk selection: leaders/TLs everywhere except the archive — and VPs IN the
  // archive too, where the bulk action is "back to active" (v32.5)
  // the CIC tab's bulk action is a SECOND CALL, never an ownership change
  const cicView = activeView === "cic";
  const canBulk =
    activeView === "archived"
      ? viewer.canVp
      : cicView
        ? viewer.canCic || viewer.canB2cCic
        : viewer.isLeader || viewer.isTl;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [referralOpen, setReferralOpen] = useState(false);
  // leave a comment straight from the list (v33.32.2)
  const [quickComment, setQuickComment] =
    useState<{ id: string; name: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState("");
  const [unassignOpen, setUnassignOpen] = useState(false);
  // a filter/search/page change redefines what "selected" means — start over
  // (order-independent key: re-sorting the same rows must NOT clear it)
  const idsKey = rows.map((r) => r.id).sort().join(",");
  useEffect(() => {
    setSelected(new Set());
  }, [idsKey]);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      params.delete("page");
      startNav(() => router.replace(`/signups?${params.toString()}`));
    },
    [router, searchParams]
  );

  const goPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p + 1));
    startNav(() => router.replace(`/signups?${params.toString()}`));
  };

  // WHAT THE LIST IS ACTUALLY SORTED BY (v33.58). The server picks the order
  // when nobody has clicked a header — assigned_at on the assigned views, the
  // sign-up date on the pool and the CIC queue — so the arrow has to follow
  // that same rule or the header would claim no column is sorted while one
  // plainly is. Mirrors `listSignupsPage`.
  const defaultSortField =
    activeView === "unassigned" || activeView === "cic" ? "signed_up_at" : "assigned_at";
  const sortField = filters.sort || defaultSortField;
  const sortDir = filters.sort ? filters.dir : "desc";

  const sortBy = (field: string, defaultDir: "asc" | "desc" = "desc") => {
    if (sortField === field)
      setParams({ sort: field, dir: sortDir === "asc" ? "desc" : "asc" });
    else setParams({ sort: field, dir: defaultDir });
  };

  const SortHead = ({
    field, defaultDir = "desc", children, className, filter,
  }: {
    field: string;
    defaultDir?: "asc" | "desc";
    children: React.ReactNode;
    className?: string;
    /** the column's funnel button, beside the sortable name */
    filter?: React.ReactNode;
  }) => (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => sortBy(field, defaultDir)}
        className={cn(
          "group/sort -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95",
          sortField === field && "font-bold text-primary"
        )}
        title="Sort by this column"
      >
        {children}
        {sortField === field ? (
          <span>{sortDir === "asc" ? "↑" : "↓"}</span>
        ) : (
          <span
            aria-hidden
            className="-translate-y-0.5 opacity-0 transition-all duration-150 group-hover/sort:translate-y-0 group-hover/sort:opacity-60"
          >
            ↕
          </span>
        )}
      </button>
      {filter}
      </span>
    </TableHead>
  );

  const openDetail = (id: string) => {
    setDetailLoading(id);
    start(async () => {
      const res = await openSignupDetail(id);
      setDetailLoading(null);
      if (res.ok) setDetail(res.data!);
      else toast.error(res.error);
    });
  };

  // Contact = the claim motion: you contact the sign-up, it becomes yours —
  // then the detail dialog opens right away so you log what happened.
  const contact = (row: SignupRow) =>
    start(async () => {
      // an owned sign-up is NOT claimed again — that would quietly take it off
      // whoever has it. Only the unclaimed pool claims (v33.11).
      if (row.assigned_to || row.assigned_name) {
        openDetail(row.id);
        return;
      }
      const res = await claimSignup(row.id);
      if (res.ok) {
        toast.success("It's yours — log the contact ✍️");
        router.refresh();
        openDetail(row.id);
      } else toast.error(res.error);
    });

  /** tell the person they were handed something (v33.11) */
  const [notifyOnAssign, setNotifyOnAssign] = useState(true);
  const runBulk = (memberId: string | null) =>
    start(async () => {
      const ids = [...selected];
      let done = 0;
      let failed = 0;
      // the server caps one call at 50 — feed it in chunks so select-all works
      for (let i = 0; i < ids.length; i += 50) {
        const res = await bulkReassignSignups(
          ids.slice(i, i + 50),
          memberId,
          notifyOnAssign
        );
        if (!res.ok) { toast.error(res.error); return; }
        done += res.data?.done ?? 0;
        failed += res.data?.failed ?? 0;
      }
      const label = memberId
        ? `assigned to ${targets.find((t) => t.id === memberId)?.label ?? "them"} 👥`
        : "back in the pool 🆕";
      toast.success(
        `${done} sign-up${done === 1 ? "" : "s"} ${label}${failed ? ` — ${failed} skipped (outside your scope)` : ""}`
      );
      setSelected(new Set());
      setAssignOpen(false);
      setUnassignOpen(false);
      setAssignTarget("");
      router.refresh();
    });

  // VP-only: bring archived sign-ups back, in bulk (v32.5)
  const runRevive = () =>
    start(async () => {
      const ids = [...selected];
      let done = 0;
      let failed = 0;
      for (let i = 0; i < ids.length; i += 50) {
        const res = await bulkReviveSignups(ids.slice(i, i + 50));
        if (!res.ok) { toast.error(res.error); return; }
        done += res.data?.done ?? 0;
        failed += res.data?.failed ?? 0;
      }
      toast.success(
        `${done} sign-up${done === 1 ? "" : "s"} back in the list ↩️${failed ? ` — ${failed} skipped` : ""}`
      );
      setSelected(new Set());
      router.refresh();
    });

  const syncNow = () =>
    start(async () => {
      const res = await runSignupsImport();
      if (res.ok) {
        toast.success(`Synced — ${res.data?.imported ?? 0} rows checked, ${res.data?.created ?? 0} new`);
        router.refresh();
      } else toast.error(res.error);
    });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  /** THE ROW WEARS ITS CONTACT STATE (v33.37) — a coloured left edge, so
   *  "which of these have we actually reached" is answerable at a glance:
   *  emerald = contacted & answered Yes · amber = contacted, answer No ·
   *  plain = nobody has called yet. */
  const contactTint = (v: string | null | undefined) =>
    v && /^y/i.test(v)
      ? "border-l-4 border-l-emerald-500/70"
      : v && v.trim()
        ? "border-l-4 border-l-amber-500/60"
        : "border-l-4 border-l-transparent";
  const yn = (v: string | null) =>
    v ? (
      /^y/i.test(v) ? (
        <span className="font-medium text-emerald-600 dark:text-emerald-400">Yes</span>
      ) : /^n/i.test(v) ? (
        <span className="text-muted-foreground">No</span>
      ) : (
        v
      )
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  // ⚙ Columns — one preference per view × function: the unassigned pool wants
  // different columns from "My sign-ups", and OGV from OGT
  const cols = useTableColumns(
    `signups-v2:${activeView}:${activeFn}`,
    signupColumns(activeFn, activeView)
  );

  // Which columns carry a funnel button, and what URL param each drives.
  const columnFilter = (key: string): React.ReactNode => {
    const pick = (
      label: string,
      value: string,
      options: [string, string][],
      apply: (v: string) => void
    ) => (
      <ColumnFilter
        label={label}
        value={value}
        options={options.map(([v, l]) => ({ value: v, label: l }))}
        onChange={apply}
      />
    );
    switch (key) {
      case "batch":
        return pick("Batch", filters.batch ?? "", [["new", "New SUs"], ["old", "Old SUs"]],
          (v) => setParams({ batch: v || null }));
      case "program":
        return activeFn === "OGT"
          ? pick("Program", filters.program ?? "", [["GTa", "GTa"], ["GTe", "GTe"]],
              (v) => setParams({ program: v || null }))
          : null;
      case "contacted":
        // THREE STATES, not two (v33.37): Yes and No both mean somebody
        // CALLED; the third is the pile nobody has touched yet.
        return pick(
          "Contacted",
          filters.contacted ?? "",
          [["Yes", "Contacted — Yes"], ["No", "Contacted — No"], ["none", "Not contacted yet"]],
          (v) => setParams({ contacted: v || null })
        );
      case "interested":
        return pick("Interested", filters.interested ?? "", [["Yes", "Interested ✓"], ["No", "Not interested"]],
          (v) => setParams({ interested: v || null }));
      case "status":
        return pick("Status", filters.potential ?? "",
          [...SIGNUP_STATUSES.map((st) => [st, st] as [string, string]), ["none", "— None yet"]],
          (v) => setParams({ potential: v || null, status: null }));
      case "assigned": {
        // ON THE CIC QUEUE, "assigned" MEANS THE FIRST CALLER (v34.11) — and
        // it filters by PERSON, not by the stored name: the trackers hold two
        // spellings of the same caller, so a name pick dropped half their rows.
        if (cicView && firstCallers.length > 0)
          return pick(
            "1st caller",
            filters.firstCaller ?? "",
            firstCallers.map((o) => [o.value, o.label] as [string, string]),
            (v) => setParams({ firstCaller: v || null })
          );
        // v33.14 — who holds it, straight from what's on the page
        const seen = filterOptions.assigned_name ?? [];
        return seen.length > 0
          ? pick(
              "Assigned",
              filters.assigned ?? "",
              [
                ["__none", "🆕 Unassigned"] as [string, string],
                ...seen.map((v) => [v, v] as [string, string]),
              ],
              (v) => setParams({ assigned: v || null })
            )
          : null;
      }
      case "campaign": {
        const seen = filterOptions.campaign ?? [];
        return seen.length > 0
          ? pick(
              "Campaign",
              filters.campaign ?? "",
              seen.map((v) => [v, v] as [string, string]),
              (v) => setParams({ campaign: v || null })
            )
          : null;
      }
      case "person_status": {
        // v33.12 — any column whose values repeat gets a funnel; this one is
        // straight from the tracker, so the options come from what is
        // actually in the page rather than a guessed list.
        const seen = filterOptions.person_status ?? [];
        return seen.length > 0
          ? pick(
              "Person status",
              filters.personStatus ?? "",
              seen.map((v) => [v, v] as [string, string]),
              (v) => setParams({ personStatus: v || null })
            )
          : null;
      }
      // THE PHONE FUNNEL HANGS ON QUICK ACTIONS TOO (v33.23). The Phone COLUMN
      // ships hidden in every view — the number already shows in the quick
      // actions — and a funnel only renders on a visible column, so on desktop
      // the has/missing filter was unreachable in practice. Quick actions is
      // the column that draws the WhatsApp/Call buttons (or prints "no phone"),
      // which is exactly where the question is asked.
      case "contact":
        // never two funnels for one filter: if someone has switched the Phone
        // column on, it carries its own
        if (cols.visible.some((c) => c.key === "phone")) return null;
      // falls through
      case "phone":
        return pick("Phone", filters.phone ?? "", [["has", "✅ Has phone"], ["missing", "📵 Missing phone"]],
          (v) => setParams({ phone: v || null }));
      default:
        return null;
    }
  };

  /** The WhatsApp / call / email shortcuts — every click raises the log prompt. */
  const contactLinks = (r: SignupRow, size: "sm" | "icon" = "icon") => (
    <ContactLinks onUsed={(channel) => setQuickContact({ row: r, channel })}>
      {hasPhone(r.phone) ? (
        <>
          <Hint label={`WhatsApp ${r.phone}`}>
            <Button asChild variant="outline" size={size === "icon" ? "icon" : "sm"} className={size === "icon" ? "size-7" : "flex-1"}>
              <a href={`https://wa.me/${waDigits(r.phone)}`} target="_blank" rel="noreferrer">
                <WhatsAppIcon className={size === "icon" ? "size-3.5" : "size-4"} />
                {size === "icon" ? null : " WhatsApp"}
              </a>
            </Button>
          </Hint>
          <Hint label={`Call ${r.phone}`}>
            <Button asChild variant="outline" size={size === "icon" ? "icon" : "sm"} className={size === "icon" ? "size-7" : "flex-1"}>
              <a href={`tel:${r.phone}`}>
                <Phone className={size === "icon" ? "size-3.5" : "size-4"} />
                {size === "icon" ? null : " Call"}
              </a>
            </Button>
          </Hint>
        </>
      ) : null}
      {r.email ? (
        <Hint label={`Email ${r.email}`}>
          <Button asChild variant="outline" size={size === "icon" ? "icon" : "sm"} className={size === "icon" ? "size-7" : "flex-1"}>
            <a href={`mailto:${r.email}`}>
              <Mail className={size === "icon" ? "size-3.5" : "size-4"} />
              {size === "icon" ? null : " Email"}
            </a>
          </Button>
        </Hint>
      ) : null}
    </ContactLinks>
  );

  // v33.17 — INLINE EDITING on the desktop rows: Contacted / Interested /
  // Status save straight from the table, no dialog round-trip. Same server
  // actions and same rules as the detail dialog; the per-row can_* flags
  // come from listSignupsPage.
  const inlineContact = (
    r: SignupListRow,
    field: "contactStatus" | "interested",
    v: string
  ) =>
    start(async () => {
      const val = v === "__unset" ? null : v;
      const res = await updateSignupContact(
        r.id,
        field === "contactStatus" ? { contactStatus: val } : { interested: val }
      );
      if (res.ok) {
        toast.success("Saved");
        router.refresh();
      } else toast.error(res.error);
    });

  const inlineStatus = (r: SignupListRow, v: string) =>
    start(async () => {
      const res = await setSignupPotential(r.id, v === "__none" ? null : v);
      if (res.ok) {
        toast.success(
          v === "Approved"
            ? "APPROVED — that's the MOS! 🎉"
            : v === "__none"
              ? "Back to plain sign-up"
              : `Moved to ${v} 📈`
        );
        router.refresh();
      } else toast.error(res.error);
    });

  // ---- CIC (v33.19): the SECOND caller. Every rule (who may assign, who the
  // caller may be, whose columns move) is enforced server-side — here we just
  // offer the control and surface whatever comes back.
  const assignCic = (r: SignupListRow, callerId: string) =>
    start(async () => {
      // "__none" takes the second call back — the row returns to the queue
      if (callerId === "__none") {
        const res = await clearCicCaller(r.id);
        if (res.ok) { toast.success("Second call cleared"); router.refresh(); }
        else toast.error(res.error);
        return;
      }
      const res = await assignCicCaller(r.id, callerId);
      if (res.ok) {
        toast.success(
          `📞 CIC handed to ${cicTargets.find((t) => t.id === callerId)?.label ?? "them"}`
        );
        router.refresh();
      } else toast.error(res.error);
    });

  /** B2C CIC (v33.29): the open call is the latest B2C row with no outcome —
   *  assignment replaces its caller, recording closes it, clearing deletes it. */
  const openB2c = (r: SignupListRow) =>
    (r.cic_calls ?? []).find((c) => c.side === "B2C" && !c.contact_status) ?? null;
  const latestB2c = (r: SignupListRow) =>
    (r.cic_calls ?? []).find((c) => c.side === "B2C") ?? null;

  const assignB2c = (r: SignupListRow, callerId: string) =>
    start(async () => {
      if (callerId === "__none") {
        const open = openB2c(r);
        if (!open) return;
        const res = await clearB2cCic(open.id);
        if (res.ok) { toast.success("B2C call taken back"); router.refresh(); }
        else toast.error(res.error);
        return;
      }
      const res = await assignB2cCic(r.id, callerId);
      if (res.ok) {
        toast.success(
          `📞 B2C call handed to ${b2cTargets.find((t) => t.id === callerId)?.label ?? "them"}`
        );
        router.refresh();
      } else toast.error(res.error);
    });

  /** Recording an outcome. A call-back goes through the dialog below, which
   *  supplies the time the reminder needs. */
  const inlineB2cOutcome = (r: SignupListRow, outcome: string, callBackAt?: string) =>
    start(async () => {
      const open = openB2c(r);
      if (!open) return;
      const res = await updateB2cCic(open.id, {
        outcome: outcome || null,
        ...(callBackAt ? { callBackAt } : {}),
      });
      if (res.ok) {
        toast.success(
          outcome === "call_back"
            ? "⏰ Call back saved — you'll get a reminder when it's due"
            : "Outcome recorded"
        );
        router.refresh();
      } else toast.error(res.error);
    });

  const inlineB2c = (r: SignupListRow, field: "contactStatus" | "interested", v: string) =>
    start(async () => {
      const open = openB2c(r);
      if (!open) return;
      const res = await updateB2cCic(
        open.id,
        field === "contactStatus" ? { contactStatus: v } : { interested: v }
      );
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });

  const runBulkB2c = (callerId: string) =>
    start(async () => {
      const ids = [...selected];
      let done = 0, failed = 0;
      let why: string | undefined;
      for (let i = 0; i < ids.length; i += 50) {
        const res = await bulkAssignB2cCic(ids.slice(i, i + 50), callerId);
        if (!res.ok) { toast.error(res.error); return; }
        done += res.data?.done ?? 0;
        failed += res.data?.failed ?? 0;
        why ||= res.data?.why;
      }
      const who = b2cTargets.find((t) => t.id === callerId)?.label ?? "them";
      toast.success(
        `📞 ${done} B2C call${done === 1 ? "" : "s"} handed to ${who}` +
          (failed ? ` — ${failed} skipped${why ? ` (${why})` : ""}` : "")
      );
      setSelected(new Set());
      setAssignOpen(false);
      setAssignTarget("");
      router.refresh();
    });

  /** CIC IN BULK (v33.21) — in the CIC tab the bulk bar hands out SECOND
   *  CALLS. It deliberately does not reuse `runBulk`: that one reassigns the
   *  row itself, which in this tab would take the sign-up (and its numbers)
   *  off the first assignee — the exact opposite of what CIC is for. */
  const runBulkCic = (callerId: string) =>
    start(async () => {
      const ids = [...selected];
      let done = 0;
      let failed = 0;
      let why: string | undefined;
      for (let i = 0; i < ids.length; i += 50) {
        const res = await bulkAssignCicCaller(ids.slice(i, i + 50), callerId, notifyOnAssign);
        if (!res.ok) { toast.error(res.error); return; }
        done += res.data?.done ?? 0;
        failed += res.data?.failed ?? 0;
        why ||= res.data?.why;
      }
      const who = cicTargets.find((t) => t.id === callerId)?.label ?? "them";
      toast.success(
        `📞 ${done} second call${done === 1 ? "" : "s"} handed to ${who}` +
          (failed ? ` — ${failed} skipped${why ? ` (${why})` : ""}` : "")
      );
      setSelected(new Set());
      setAssignOpen(false);
      setAssignTarget("");
      router.refresh();
    });

  const inlineCic = (
    r: SignupListRow,
    field: "contactStatus" | "interested",
    v: string
  ) =>
    start(async () => {
      const val = v === "__unset" ? null : v;
      const res = await updateCicContact(
        r.id,
        field === "contactStatus" ? { contactStatus: val } : { interested: val }
      );
      if (res.ok) {
        toast.success("CIC saved");
        router.refresh();
      } else toast.error(res.error);
    });

  /** Records the second call: the assigned caller themself, or any MM+. */
  const canRecordCic = (r: SignupListRow) =>
    viewer.canCic || r.cic_assigned_to === viewer.id;

  /** Compact Yes/No/— select for the Contacted & Interested cells. */
  const inlineYnSelect = (
    r: SignupListRow,
    field: "contactStatus" | "interested",
    raw: string | null,
    onPick: (v: string) => void = (v) => inlineContact(r, field, v)
  ) => (
    <div onClick={(e) => e.stopPropagation()}>
      <Select
        value={raw && /^y/i.test(raw) ? "Yes" : raw && /^n/i.test(raw) ? "No" : "__unset"}
        onValueChange={onPick}
      >
        <SelectTrigger
          size="sm"
          className="data-[size=sm]:h-7 gap-1 px-2 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__unset">—</SelectItem>
          <SelectItem value="Yes">Yes</SelectItem>
          <SelectItem value="No">No</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  /** One cell of the desktop table, by column key. */
  const signupCell = (r: SignupListRow, key: string): React.ReactNode => {
    switch (key) {
      case "signed_up_at":
        return (
          <>
            {r.signed_up_at ?? "—"}
            <span className="block text-[10px] opacity-70">
              {r.batch === "new" ? "New" : "Old"} SUs
            </span>
          </>
        );
      case "name":
        return (
          <>
            <span className="font-medium" dir="auto">{r.name}</span>
            {/* an organic referral has no tracker row behind it (v33.32) —
                say so, or "EP REF-1A2B" reads like a broken import */}
            {r.source === "referral" ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Badge variant="outline" className="border-primary/50 px-1.5 py-0 text-[10px] text-primary">
                  🤝 Referral
                </Badge>
                {r.referral ? <span dir="auto">by {r.referral}</span> : null}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">EP {r.ep_id}</p>
            )}
          </>
        );
      case "program":
        return <ProgramBadge program={r.program} fn={r.fn} />;
      case "contact":
        return hasPhone(r.phone) || r.email ? (
          <span className="flex items-center gap-1">{contactLinks(r)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">no phone</span>
        );
      case "assigned":
        return r.assigned_to || r.assigned_name ? (
          <span className="flex items-center gap-1 text-muted-foreground" dir="auto">
            <UserRound className="size-3.5 shrink-0" /> {r.assigned_name ?? "assigned"}
          </span>
        ) : (
          <Badge variant="outline" className="border-primary/50 text-primary">
            unassigned
          </Badge>
        );
      case "contacted":
        return r.can_work && !r.out_of_process
          ? inlineYnSelect(r, "contactStatus", r.contact_status)
          : yn(r.contact_status);
      case "interested":
        return r.can_work && !r.out_of_process
          ? inlineYnSelect(r, "interested", r.interested)
          : yn(r.interested);
      case "cic_assigned":
        // MMs+ hand the second call out from the cell; everyone else reads it
        return viewer.canCic && cicTargets.length > 0 && !r.out_of_process ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Select
              value={r.cic_assigned_to ?? undefined}
              onValueChange={(v) => assignCic(r, v)}
            >
              <SelectTrigger
                size="sm"
                className="data-[size=sm]:h-7 w-36 gap-1 px-2 text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <SelectValue placeholder="📞 pick a 2nd caller" />
              </SelectTrigger>
              <SelectContent>
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  CIC — a second call. The sign-up stays with its first assignee.
                </div>
                {r.cic_assigned_to ? (
                  <SelectItem value="__none">— Take the call back</SelectItem>
                ) : null}
                {cicTargets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : r.cic_assigned_name ? (
          <span className="flex items-center gap-1 text-muted-foreground" dir="auto">
            <PhoneCall className="size-3.5 shrink-0" /> {r.cic_assigned_name}
          </span>
        ) : (
          <span className="text-muted-foreground">— not assigned</span>
        );
      case "cic_contacted":
        return canRecordCic(r) && !r.out_of_process
          ? inlineYnSelect(r, "contactStatus", r.cic_contact_status, (v) =>
              inlineCic(r, "contactStatus", v))
          : yn(r.cic_contact_status);
      case "cic_interested":
        return canRecordCic(r) && !r.out_of_process
          ? inlineYnSelect(r, "interested", r.cic_interested, (v) =>
              inlineCic(r, "interested", v))
          : yn(r.cic_interested);
      case "cic_b2c": {
        // the SELLING side's caller — assigned from the cell by B2C MMs+
        const open = openB2c(r);
        const last = latestB2c(r);
        return viewer.canB2cCic && b2cTargets.length > 0 ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Select
              value={open?.caller_id ?? undefined}
              onValueChange={(v) => assignB2c(r, v)}
            >
              <SelectTrigger
                size="sm"
                className="data-[size=sm]:h-7 w-36 gap-1 px-2 text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <SelectValue placeholder="🛍️ pick a B2C caller" />
              </SelectTrigger>
              <SelectContent>
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  B2C sells them a course/event — the OGX funnel is untouched.
                </div>
                {open ? (
                  <SelectItem value="__none">— Take the call back</SelectItem>
                ) : null}
                {b2cTargets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : open || last ? (
          <span className="flex items-center gap-1 text-muted-foreground" dir="auto">
            <PhoneCall className="size-3.5 shrink-0" /> {(open ?? last)!.caller_name}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      }
      case "cic_b2c_contacted": {
        // WHAT HAPPENED, NOT "CALLED YES/NO" (v35.1). Busy, rang out, dead
        // number and "ring me later" are four different situations with four
        // different next moves, and the old control called them all "No".
        const open = openB2c(r);
        const canRec = open && (open.caller_id === viewer.id || viewer.canB2cCic);
        const shown = (open ?? latestB2c(r)) ?? null;
        if (!canRec || !open)
          return shown?.outcome ? (
            <span className="whitespace-nowrap text-xs">
              {b2cOutcomeLabel(shown.outcome)}
              {shown.outcome === "call_back" && shown.call_back_at ? (
                <span className="block text-[10px] text-muted-foreground">
                  {fmtDateTime(shown.call_back_at)}
                </span>
              ) : null}
            </span>
          ) : (
            yn(shown?.contact_status ?? null)
          );
        return (
          <Select
            value={open.outcome ?? "__none"}
            onValueChange={(v) => {
              if (v === "call_back") {
                // an appointment needs a time — ask for it rather than
                // recording a call-back nobody will be reminded about
                setCallBack({ call: open, name: r.name });
                return;
              }
              inlineB2cOutcome(r, v === "__none" ? "" : v);
            }}
          >
            <SelectTrigger
              className="h-7 w-[9.5rem] text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent onClick={(e) => e.stopPropagation()}>
              <SelectItem value="__none">—</SelectItem>
              {B2C_CALL_OUTCOMES.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      case "cic_b2c_interested": {
        const open = openB2c(r);
        const canRec = open && (open.caller_id === viewer.id || viewer.canB2cCic);
        // an opinion only exists when they actually picked up
        const reached = b2cOutcomeReached((open ?? latestB2c(r))?.outcome);
        if (canRec && open && !open.outcome) return <span className="text-muted-foreground">—</span>;
        if (canRec && !reached)
          return <span className="text-xs text-muted-foreground">n/a</span>;
        return canRec
          ? inlineYnSelect(r, "interested", open!.interested, (v) =>
              inlineB2c(r, "interested", v))
          : yn(latestB2c(r)?.interested ?? null);
      }
      case "status": {
        if (r.out_of_process)
          return <span className="text-destructive">🗄️ {r.oop_reason ?? "OOP"}</span>;
        // "Parents Approval" is a VP move BOTH ways — for everyone else the
        // cell is read-only while a sign-up sits there
        const vpLocked = r.status === "Parents Approval" && !r.can_vp;
        if (!r.can_set_status || vpLocked)
          return r.status ? (
            <Badge className={r.status === "Approved" ? "bg-emerald-600" : ""}>{r.status}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Select value={r.status ?? "__none"} onValueChange={(v) => inlineStatus(r, v)}>
              <SelectTrigger
                size="sm"
                className="data-[size=sm]:h-7 gap-1 px-2 text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Sign-up</SelectItem>
                {SIGNUP_STATUSES.filter(
                  (st) => st !== "Parents Approval" || r.can_vp
                ).map((st) => (
                  <SelectItem key={st} value={st}>
                    {st === "Approved" ? "Approved 🏆" : st}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      }
      case "country":
        return r.country ?? "—";
      case "person_status":
        return <span dir="auto">{r.person_status ?? "—"}</span>;
      case "campaign":
        return <span dir="auto">{r.campaign ?? "—"}</span>;
      case "email":
        return <span dir="auto">{r.email ?? "—"}</span>;
      case "phone":
        return r.phone ?? "—";
      case "ep_id":
        return r.ep_id;
      case "batch":
        return r.batch === "new" ? "New" : "Old";
      case "university":
        return <span dir="auto">{r.university ?? "—"}</span>;
      case "grad_year":
        return r.grad_year ?? "—";
      case "home_lc":
        return <span dir="auto">{r.home_lc ?? "—"}</span>;
      case "gender":
        return r.gender ?? "—";
      case "referral":
        return <span dir="auto">{r.referral ?? "—"}</span>;
      case "background":
        return <span dir="auto">{r.background ?? "—"}</span>;
      case "sub_product":
        return r.sub_product ?? "—";
      case "comment": {
        // THE WHOLE THREAD, newest first, full text on hover — and a ➕ for
        // anyone who may work the sign-up or is its VP (v33.32.2). The same
        // shape the raising list has carried since v33.17.
        const all = r.comments_all ?? [];
        // THE B2C CALLER COMMENTS FROM THE LIST TOO (v35.1). They are neither
        // the owner nor a VP, so the two flags above are false for them — but
        // on the CIC queue the row's own calls say whether this one is theirs,
        // and that is already loaded for this view. No extra query.
        const canB2cComment =
          cicView &&
          (viewer.canB2cCic ||
            (r.cic_calls ?? []).some((c) => c.side === "B2C" && c.caller_id === viewer.id));
        const addBtn =
          r.can_work || r.can_vp || canB2cComment ? (
            <Hint label={canB2cComment && !r.can_work && !r.can_vp
              ? "Add a B2C comment — stays in Sodio, never written to the OGX tracker"
              : "Add a comment — right from the list"}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  setQuickComment({ id: r.id, name: r.name });
                }}
              >
                <MessageSquarePlus className="size-3.5" />
              </Button>
            </Hint>
          ) : null;
        if (all.length === 0)
          return <span className="inline-flex items-center gap-1">—{addBtn}</span>;
        const newestFirst = [...all].reverse();
        const full = newestFirst
          .map((c) => `${c.author_name}${
            c.author_class === "vp" ? " (VP)" : c.author_class === "b2c" ? " (B2C)" : ""
          }: ${c.body}`)
          .join("\n\n");
        return (
          <span className="flex items-start gap-1">
            <span dir="auto" title={full} className="block min-w-0 flex-1 space-y-0.5">
              {newestFirst.slice(0, 2).map((c) => (
                <span key={c.id} className="block truncate text-xs leading-tight">
                  {c.author_class === "vp" ? "🎖 " : c.author_class === "b2c" ? "🛍 " : ""}
                  {c.body}
                </span>
              ))}
              {newestFirst.length > 2 ? (
                <span className="block text-[10px] text-muted-foreground">
                  +{newestFirst.length - 2} more
                </span>
              ) : null}
            </span>
            {addBtn}
          </span>
        );
      }
      case "actions":
        // v33.14 — the Contact BUTTON is gone. Tapping the row opens the
        // sign-up, and the call/WhatsApp/email links already sit in the
        // Quick actions column; a third way in was just width.
        return detailLoading === r.id ? <Loader2 className="size-4 animate-spin" /> : null;
      default:
        return null;
    }
  };

  return (
    <div className={cn("mx-auto max-w-6xl space-y-4", navPending && "nav-pending")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sign-ups</h1>
          <p className="text-sm text-muted-foreground">
            {viewer.b2cOnly
              ? "The OGX sign-up pool — people who already answered a first call. Yours are the B2C selling calls; the OGX funnel stays with its own crew."
              : `Two-way synced with the ${activeFn} tracker sheet — contact one from the unassigned pool, it's yours, move them down the funnel.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Hint
            label={
              viewer.b2cOnly
                ? "The B2C dashboard — your lane, including the B2C CIC card"
                : `The ${activeFn} funnel dashboard — KPIs, conversions, leaderboard`
            }
          >
            <Button variant="outline" asChild>
              <Link prefetch={false} href={`/dashboard?fn=${viewer.b2cOnly ? "B2C" : activeFn}`}>
                <LayoutDashboard className="size-4" /> Dashboard
              </Link>
            </Button>
          </Hint>
          {/* ORGANIC REFERRALS (v33.32) — someone we can approve who never
              came through the tracker. Same funnel, same dashboard. */}
          {viewer.canRefer && !viewer.b2cOnly ? (
            <Hint label="Log someone who came to us directly — a friend, a walk-in, an EP another member sent">
              <Button onClick={() => setReferralOpen(true)}>
                <UserPlus className="size-4" /> Add referral
              </Button>
            </Hint>
          ) : null}
          {/* the OGX tracker sync belongs to OGX leaders — the server refuses
              it for anyone else, so showing the button to B2C was a dead end */}
          {viewer.isLeader && !viewer.b2cOnly ? (
            <Button variant="outline" onClick={syncNow} disabled={pending}>
              <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> Sync now
            </Button>
          ) : null}
        </div>
      </div>

      {planCard || streak ? (
        <div className={cn("grid gap-4", planCard && streak && "lg:grid-cols-2")}>
          {planCard ? <MmPlanCard plan={planCard} /> : null}
          {streak ? (
            <div data-tour="signups:streak">
              <StreakCard
                streak={streak}
                onScope={(sc) => setParams({ streak: sc })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* function + view chips */}
      <div className="flex flex-wrap items-center gap-2" data-tour="signups:views">
        {fns.length > 1 ? (
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {/* B2C sells into BOTH sides, so "Both" is their default and the
                side chips only narrow it */}
            {viewer.b2cOnly ? (
              <button
                type="button"
                onClick={() => setParams({ fn: null, program: null, firstCaller: null })}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-semibold transition-colors",
                  fnAll ? "bg-background shadow" : "text-muted-foreground"
                )}
              >
                Both
              </button>
            ) : null}
            {fns.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setParams({ fn: f, program: null, firstCaller: null })}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-semibold transition-colors",
                  activeFn === f && !fnAll ? "bg-background shadow" : "text-muted-foreground"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        ) : null}
        {/* the tab list comes from the server's signupViewsFor — nothing is
            hardcoded here, a new view only needs a label (+ hint) above */}
        {views.map((v) => {
          const chip = (
            <button
              key={v}
              type="button"
              onClick={() => setParams({ view: v, firstCaller: null })}
              className={cn(
                "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                activeView === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50"
              )}
            >
              {VIEW_LABELS[v] ?? v}
            </button>
          );
          return VIEW_HINTS[v] ? (
            <Hint key={v} label={VIEW_HINTS[v]}>{chip}</Hint>
          ) : (
            chip
          );
        })}
      </div>
      {activeView === "cic" ? (
        <p className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs text-muted-foreground">
          <b className="text-foreground">📞 CIC — Customer Interview Calls.</b>{" "}
          {CIC_BLURB}
        </p>
      ) : null}

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setParams({ q }); }}
            onBlur={() => { if (q !== filters.q) setParams({ q }); }}
            placeholder="Name, EP ID, phone…"
            className="h-9 w-52 pl-8"
          />
        </div>
        {/* 🙋 MINE (v33.22) — one tap to your own rows inside a list that
            holds the team's or the function's. In the CIC tab it means the
            second calls handed to YOU, which is a different column. */}
        {viewer.isLeader || viewer.isTl || viewer.canCic || viewer.canB2cCic ? (
          <button
            type="button"
            onClick={() =>
              cicView
                ? setParams({ cicMine: filters.cicMine ? null : "1" })
                : setParams({ assigned: filters.assigned === viewer.name ? null : viewer.name })
            }
            className={cn(
              "h-9 shrink-0 rounded-md border px-3 text-sm font-medium transition-colors",
              (cicView ? !!filters.cicMine : filters.assigned === viewer.name)
                ? "border-primary bg-primary/10 text-primary"
                : "border-input hover:bg-muted"
            )}
          >
            🙋 Mine
          </button>
        ) : null}
        {/* Column-backed filters (Batch · Program · Contacted · Interested ·
            Potential · Phone) live on the COLUMN HEADERS now. The mobile
            card view has no header to hang them on, so it keeps the chips. */}
        <div className="contents md:hidden">
        {cicView && firstCallers.length > 0 ? (
          <Select
            value={
              firstCallers.some((o) => o.value === filters.firstCaller)
                ? filters.firstCaller!
                : "all"
            }
            onValueChange={(v) => setParams({ firstCaller: v === "all" ? null : v })}
          >
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any 1st caller</SelectItem>
              {firstCallers.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select
          value={filters.batch || "all"}
          onValueChange={(v) => setParams({ batch: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">New + Old</SelectItem>
            <SelectItem value="new">New SUs</SelectItem>
            <SelectItem value="old">Old SUs</SelectItem>
          </SelectContent>
        </Select>
        {activeFn === "OGT" ? (
          <Select
            value={filters.program || "all"}
            onValueChange={(v) => setParams({ program: v === "all" ? null : v })}
          >
            <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">GTa + GTe</SelectItem>
              <SelectItem value="GTa">GTa</SelectItem>
              <SelectItem value="GTe">GTe</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        <Select
          value={filters.contacted || "all"}
          onValueChange={(v) => setParams({ contacted: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Contacted: any</SelectItem>
            <SelectItem value="Yes">Contacted — Yes</SelectItem>
            <SelectItem value="No">Contacted — No</SelectItem>
            <SelectItem value="none">Not contacted yet</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.interested || "all"}
          onValueChange={(v) => setParams({ interested: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Interested: any</SelectItem>
            <SelectItem value="Yes">Interested ✓</SelectItem>
            <SelectItem value="No">Not interested</SelectItem>
          </SelectContent>
        </Select>
        {/* Status (v33.13) — the pipeline stage, one field
            filter (same column; "None" = plain sign-ups, no stage yet) */}
        <Select
          value={filters.potential || "all"}
          onValueChange={(v) =>
            setParams({ potential: v === "all" ? null : v, status: null })
          }
        >
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: any</SelectItem>
            {SIGNUP_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
            <SelectItem value="none">— None yet</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.phone || "all"}
          onValueChange={(v) => setParams({ phone: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">📱 Any phone</SelectItem>
            <SelectItem value="has">✅ Has phone</SelectItem>
            <SelectItem value="missing">📵 Missing phone</SelectItem>
          </SelectContent>
        </Select>
        </div>
        <span className="ml-auto text-sm text-muted-foreground">
          {total} sign-up{total === 1 ? "" : "s"}
        </span>
        {/* ⚙ Columns — this view's own layout (the pool ≠ "My sign-ups") */}
        <TableSettings columns={cols} className="hidden md:inline-flex" />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nothing here — try another view or filter.
            </CardContent>
          </Card>
        ) : (
          rows.map((r) => (
            // cursor-pointer is LOAD-BEARING on iOS: Safari only synthesizes
            // click events from taps on elements that look clickable — without
            // it the mobile cards were dead to the touch (v33.17)
            <Card
              key={r.id}
              role="button"
              tabIndex={0}
              className={cn("cursor-pointer active:bg-muted/40", contactTint(r.contact_status))}
              onClick={() => openDetail(r.id)}
            >
              <CardContent className="space-y-1.5 p-3.5">
                <p className="flex items-center gap-2 font-semibold">
                  {canBulk ? (
                    <SelectDot checked={selected.has(r.id)} onToggle={() => toggle(r.id)} />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate" dir="auto">{r.name}</span>
                  {detailLoading === r.id ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <ProgramBadge program={r.program} fn={r.fn} className="text-[10px]" />
                  <Badge variant="outline" className="text-[10px]">{r.batch === "new" ? "New" : "Old"}</Badge>
                  {r.status ? <Badge className="text-[10px]">{r.status}</Badge> : null}
                  <span className="text-muted-foreground">
                    {r.assigned_to || r.assigned_name ? `👤 ${r.assigned_name ?? "assigned"}` : "🆕 unassigned"}
                  </span>
                </div>
                {/* CIC (v33.19) — read-only on phones; the record lives in the
                    detail dialog one tap away */}
                {activeView === "cic" ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <Badge variant="outline" className="text-[10px]" dir="auto">
                      📞 2nd: {r.cic_assigned_name ?? "not assigned"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      CIC contacted: {r.cic_contact_status ?? "—"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      CIC interested: {r.cic_interested ?? "—"}
                    </Badge>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {r.signed_up_at ?? ""} · EP {r.ep_id}
                </p>
                {hasPhone(r.phone) || r.email ? (
                  <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    {contactLinks(r, "sm")}
                  </div>
                ) : null}
                {false ? (
                  <Button
                    size="sm" className="w-full"
                    disabled={pending}
                    onClick={(e) => { e.stopPropagation(); contact(r); }}
                  >
                    <Phone className="size-4" /> Contact
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* desktop table */}
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block rise-in rise-in-2">
        <div className="overflow-x-auto" data-tour="signups:table">
          <Table>
            <TableHeader>
              <TableRow>
                {canBulk ? (
                  <TableHead className="w-8">
                    <SelectDot
                      checked={rows.length > 0 && selected.size >= rows.length}
                      onToggle={() =>
                        setSelected(
                          selected.size >= rows.length
                            ? new Set()
                            : new Set(rows.map((r) => r.id))
                        )
                      }
                    />
                  </TableHead>
                ) : null}
                {cols.visible.map((c) => {
                  const sort = SIGNUP_SORT[c.key];
                  const filter = columnFilter(c.key);
                  return sort ? (
                    <SortHead
                      key={c.key}
                      field={sort.field}
                      defaultDir={sort.dir}
                      filter={filter}
                    >
                      {c.label}
                    </SortHead>
                  ) : (
                    <TableHead key={c.key}>
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {filter}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={cols.visible.length + (canBulk ? 1 : 0)}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Nothing here — try another view or filter.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className={cn("cursor-pointer", contactTint(r.contact_status))}
                    onClick={() => openDetail(r.id)}
                  >
                    {canBulk ? (
                      <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                        <SelectDot checked={selected.has(r.id)} onToggle={() => toggle(r.id)} />
                      </TableCell>
                    ) : null}
                    {cols.visible.map((c) => {
                      const rz = resizableCellStyle(cols, c.key);
                      return (
                      <TableCell
                        key={c.key}
                        className={cn(SIGNUP_CELL_CLASS[c.key], rz.className)}
                        style={rz.style}
                        onClick={
                          c.key === "contact" || c.key === "actions"
                            ? (e) => e.stopPropagation()
                            : undefined
                        }
                      >
                        {signupCell(r, c.key)}
                      </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* pagination + rows per page */}
      {total > Math.min(...pageSizeOptions) ? (
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
          <PageSizePicker
            value={pageSize}
            options={pageSizeOptions}
            label="Sign-ups per page"
            onChange={(n) => setParams({ size: n === 100 ? null : String(n) })}
          />
          {pages > 1 ? (
            <>
              <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => goPage(page - 1)}>
                ← Prev
              </Button>
              <span className="text-muted-foreground">
                Page {page + 1} of {pages}
              </span>
              <Button
                variant="outline" size="sm" disabled={page + 1 >= pages}
                onClick={() => goPage(page + 1)}
              >
                Next →
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {/* bulk-selection action bar — shows once anything is selected */}
      {canBulk && selected.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border bg-card px-4 py-2 shadow-xl">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSelected(
                  selected.size >= rows.length ? new Set() : new Set(rows.map((r) => r.id))
                )
              }
            >
              {selected.size >= rows.length && rows.length > 0
                ? "Clear"
                : `All (${rows.length})`}
            </Button>
            {(cicView ? (viewer.canCic ? cicTargets : b2cTargets) : targets).length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setAssignOpen(true)}
              >
                {cicView ? (
                  viewer.canCic ? (
                    <><PhoneCall className="size-3.5" /> Assign 2nd caller…</>
                  ) : (
                    <><PhoneCall className="size-3.5" /> Assign B2C caller…</>
                  )
                ) : (
                  <><Users2 className="size-3.5" /> Assign to…</>
                )}
              </Button>
            ) : null}
            {activeView === "archived" && viewer.canVp ? (
              <Button size="sm" disabled={pending} onClick={runRevive}>
                ↩️ Back to active
              </Button>
            ) : cicView ? null : (
              // NOT IN THE CIC TAB (v33.21): "Unassign" strips the FIRST
              // assignee, who must keep the row and their numbers.
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setUnassignOpen(true)}
              >
                <UserMinus className="size-3.5" /> Unassign
              </Button>
            )}
            <Button
              size="sm" variant="ghost" aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* bulk assign confirm */}
      <Dialog
        open={assignOpen}
        onOpenChange={(o) => { if (!o) { setAssignOpen(false); setAssignTarget(""); } }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {cicView && !viewer.canCic ? (
                <>
                  🛍️ B2C caller for {selected.size} sign-up
                  {selected.size === 1 ? "" : "s"}
                </>
              ) : cicView ? (
                <>
                  📞 CIC — second caller for {selected.size} sign-up
                  {selected.size === 1 ? "" : "s"}
                </>
              ) : (
                <>Assign {selected.size} sign-up{selected.size === 1 ? "" : "s"}</>
              )}
            </DialogTitle>
            <DialogDescription>
              {cicView && !viewer.canCic ? (
                <>
                  A <b>B2C selling call</b>: pitch them a course, an event, a
                  student activity. The sign-up stays with its OGX assignee and
                  the OGX funnel is never touched — the B2C answers live on
                  their own row, side-tagged in the log.
                </>
              ) : cicView ? (
                <>
                  This is a <b>customer interview call</b>, not a hand-over: the
                  sign-up stays with its first assignee and keeps counting for
                  them. The second caller checks the first call really happened
                  and follows up — their answers are recorded separately.
                </>
              ) : (
                <>
                  They land on the member&apos;s &quot;My sign-ups&quot; list. Every row
                  is re-checked against your scope and synced back to the sheet.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <Select value={assignTarget || undefined} onValueChange={setAssignTarget}>
            <SelectTrigger>
              <SelectValue placeholder={cicView ? "Pick the second caller…" : "Pick a member…"} />
            </SelectTrigger>
            <SelectContent>
              {(cicView ? (viewer.canCic ? cicTargets : b2cTargets) : targets).map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm">
              <Switch checked={notifyOnAssign} onCheckedChange={setNotifyOnAssign} />
              <span className="text-muted-foreground">Let them know</span>
            </label>
            <Button
              variant="outline"
              onClick={() => { setAssignOpen(false); setAssignTarget(""); }}
            >
              Cancel
            </Button>
            <Button
              disabled={!assignTarget || pending}
              onClick={() =>
                cicView
                  ? viewer.canCic
                    ? runBulkCic(assignTarget)
                    : runBulkB2c(assignTarget)
                  : runBulk(assignTarget)
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : cicView ? (
                <PhoneCall className="size-4" />
              ) : (
                <Users2 className="size-4" />
              )}
              {cicView ? "Hand them the call" : "Assign"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SignupCommentDialog
        target={quickComment}
        onOpenChange={(o) => !o && setQuickComment(null)}
      />

      <ReferralDialog
        open={referralOpen}
        onOpenChange={setReferralOpen}
        fns={fns}
        activeFn={activeFn}
        targets={targets}
        viewerId={viewer.id}
        canAssign={viewer.isLeader || viewer.isTl}
      />

      {/* bulk unassign confirm */}
      <Dialog open={unassignOpen} onOpenChange={setUnassignOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Unassign {selected.size} sign-up{selected.size === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              They go back to the 🆕 Unassigned pool — anyone in the function can
              contact them again. Synced back to the sheet row by row.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setUnassignOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={() => runBulk(null)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
              Unassign
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {detail ? (
        <SignupDetailDialog
          key={detail.signup.id}
          detail={detail}
          targets={targets}
          cicTargets={cicTargets}
          viewer={viewer}
          loadLogs={loadLogs}
          onClose={() => setDetail(null)}
          onChanged={(id) => { openDetail(id); router.refresh(); }}
        />
      ) : null}

      {/* the WhatsApp / call / email link opened — now record it (dismissible) */}
      {quickContact ? (
        <SignupContactPrompt
          key={`${quickContact.row.id}:${quickContact.channel}`}
          row={quickContact.row}
          channel={quickContact.channel}
          onClose={() => setQuickContact(null)}
          onOpenDetail={() => openDetail(quickContact.row.id)}
        />
      ) : null}
      {callBack ? (
        <CallBackDialog
          call={callBack.call}
          name={callBack.name}
          onClose={() => setCallBack(null)}
          onSaved={() => { setCallBack(null); router.refresh(); }}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ detail

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm" dir="auto" title={value}>{value}</p>
    </div>
  );
}

/** The sign-up's edit history (v33.19) — collapsed by default, fetched the
 *  first time it's opened through the page's `loadLogs` server function. */
function SignupHistory({
  signupId, loadLogs,
}: {
  signupId: string;
  loadLogs: (signupId: string) => Promise<SignupLog[]>;
}) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<SignupLog[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || logs || loading) return;
    setLoading(true);
    loadLogs(signupId)
      .then((rows) => setLogs(rows))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  };

  const label = (field: string) =>
    ({
      contacted: "contacted",
      interested: "interested",
      status: "status",
      assigned: "assigned",
      cic_assigned: "2nd caller",
      cic_contacted: "CIC contacted",
      cic_interested: "CIC interested",
    } as Record<string, string>)[field] ?? field.replace(/_/g, " ");

  return (
    <div className="space-y-2 border-t pt-3">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 text-sm font-semibold hover:text-primary"
      >
        <History className="size-4" /> History
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </p>
        ) : logs && logs.length > 0 ? (
          <div className="space-y-1">
            {logs.map((l) => (
              <p key={l.id} className="text-xs text-muted-foreground" dir="auto">
                <span className="font-medium text-foreground">{l.member_name}</span>{" "}
                changed {label(l.field)}: {l.old_value ?? "—"} → {l.new_value ?? "—"}{" "}
                · {fmtDateTime(l.at)}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nothing recorded yet — edits from here on show up in this list.
          </p>
        )
      ) : null}
    </div>
  );
}

/** THE REFERRAL'S OWN DETAILS, EDITABLE (v33.41).
 *
 *  Everything here was typed into the Add-referral form by a member — so the
 *  same member can fix it, with the same validation. Sheet-sourced sign-ups
 *  never render this card: their intake columns belong to the tracker. */
function ReferralDetailsCard({
  signup,
  onSaved,
}: {
  signup: SignupRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    name: signup.name ?? "",
    phone: signup.phone ?? "",
    email: signup.email ?? "",
    dob: signup.dob ?? "",
    country: signup.country ?? "",
    subProduct: signup.sub_product ?? "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () =>
    start(async () => {
      const res = await updateReferralDetails(signup.id, {
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        dob: form.dob || null,
        country: form.country || null,
        ...(signup.fn === "OGT" ? { subProduct: form.subProduct || null } : {}),
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Referral updated ✍️");
      setOpen(false);
      onSaved();
    });

  if (!open)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-2.5">
        <span className="text-xs text-muted-foreground">
          🤝 A referral you logged — its details are yours to correct.
        </span>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(true)}>
          <Pencil className="size-3.5" /> Edit details
        </Button>
      </div>
    );

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="text-sm font-semibold">Referral details</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Name *</Label>
          <Input dir="auto" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Date of birth</Label>
          <Input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Phone</Label>
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Email</Label>
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Country</Label>
          <CountryInput value={form.country} onChange={(v) => set("country", v)} />
        </div>
        {signup.fn === "OGT" ? (
          <div className="grid gap-1.5">
            <Label>Sub product</Label>
            <Select
              value={form.subProduct || "__none"}
              onValueChange={(v) => set("subProduct", v === "__none" ? "" : v)}
            >
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                <SelectItem value="GTa">GTa</SelectItem>
                <SelectItem value="GTe">GTe</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        A phone or an email is a must — one of them has to stay filled.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={pending || form.name.trim().length < 2}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
        </Button>
      </div>
    </div>
  );
}

function SignupDetailDialog({
  detail, targets, cicTargets, viewer, loadLogs, onClose, onChanged,
}: {
  detail: SignupDetail | null;
  targets: { id: string; label: string }[];
  cicTargets: { id: string; label: string }[];
  viewer: ViewerInfo;
  loadLogs: (signupId: string) => Promise<SignupLog[]>;
  onClose: () => void;
  onChanged: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [comment, setComment] = useState("");
  const [oopMode, setOopMode] = useState(false);
  const [oopReason, setOopReason] = useState("");
  const [country, setCountry] = useState<string | null>(null);

  if (!detail) return null;
  const s = detail.signup;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        onChanged(s.id);
      } else toast.error(res.error ?? "Something went wrong");
    });

  const memberComments = detail.comments.filter((c) => c.author_class === "member");
  const vpComments = detail.comments.filter((c) => c.author_class === "vp");
  // B2C's own thread (v35.1) — the selling call's notes, kept apart from the
  // OGX log because they are a different conversation with the same person,
  // and deliberately never written to the OGX tracker's cells
  const b2cComments = detail.comments.filter((c) => c.author_class === "b2c");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setOopMode(false); setComment(""); setCountry(null); onClose(); } }}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={(e) => {
          // Escape with the country suggestions open closes THE LIST, not the
          // whole dialog (Radix fires this before React's own handlers)
          const t = e.target as HTMLElement | null;
          if (t?.closest('[role="combobox"][aria-expanded="true"]')) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2" dir="auto">
            <span className="min-w-0 break-words">{s.name}</span>
            <ProgramBadge program={s.program} fn={s.fn} />
            <Badge variant="outline">{s.batch === "new" ? "New" : "Old"} SUs</Badge>
            {s.out_of_process ? (
              <Badge variant="destructive">Out of Process</Badge>
            ) : s.status ? (
              <Badge className={s.status === "Approved" ? "bg-emerald-600" : ""}>{s.status}</Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            EP {s.ep_id} · signed up {s.signed_up_at ?? "—"} · from the {s.fn} tracker
            {s.last_edited_at ? ` · last edit ${fmtDateTime(s.last_edited_at)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {s.out_of_process ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-semibold text-destructive">🗄️ Out of Process</p>
            {s.oop_reason ? (
              <p className="break-words text-muted-foreground" dir="auto">{s.oop_reason}</p>
            ) : null}
            {detail.canVp ? (
              <Button
                size="sm" variant="outline" className="mt-2" disabled={pending}
                onClick={() => run(() => reviveSignup(s.id), "Back in process ↩️")}
              >
                <RotateCcw className="size-3.5" /> Back to active
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* A REFERRAL IS OURS TO CORRECT (v33.41). Every field on it was typed
            by the person who logged it, so whoever works the row fixes it —
            the VP gate belongs to tracker rows, whose columns the sheet owns. */}
        {s.source === "referral" && detail.canWork && !s.out_of_process ? (
          <ReferralDetailsCard signup={s} onSaved={() => onChanged(s.id)} />
        ) : null}

        {/* intake data — read-only, straight from the sign-up */}
        {hasPhone(s.phone) ? (
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`https://wa.me/${waDigits(s.phone)}`} target="_blank" rel="noreferrer">
                <WhatsAppIcon className="size-4" /> WhatsApp
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`tel:${s.phone}`}><Phone className="size-4" /> {s.phone}</a>
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3 sm:grid-cols-3">
          <Field label="Email" value={s.email} />
          <Field label="Gender" value={s.gender} />
          <Field label="Birth date" value={s.dob} />
          <Field label="Person status" value={s.person_status} />
          <Field label="Referral" value={s.referral} />
          <Field label="Grad year" value={s.grad_year} />
          <Field label="University" value={s.university} />
          <Field label="Background" value={s.background} />
          <Field label="Home LC" value={s.home_lc} />
          <Field label="Campaign" value={s.campaign} />
          <Field label="Reasons not to travel" value={s.reasons_not_travel} />
        </div>

        {/* assignment */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Assigned:</span>
          {detail.assignedLabel ? (
            <Badge variant="outline">{detail.assignedLabel}</Badge>
          ) : (
            <Badge variant="outline" className="border-primary/50 text-primary">unassigned</Badge>
          )}
          {!s.assigned_to && !s.assigned_name && !s.out_of_process ? (
            <Button
              size="sm" disabled={pending}
              onClick={() => run(() => claimSignup(s.id), "It's yours — log the contact ✍️")}
            >
              <Phone className="size-4" /> Contact
            </Button>
          ) : null}
          {targets.length > 0 && !s.out_of_process ? (
            <Select
              value={s.assigned_to ?? "__none"}
              onValueChange={(v) =>
                run(() => reassignSignup(s.id, v === "__none" ? null : v), "Re-assigned 👥")
              }
            >
              <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Assign to…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— unassigned</SelectItem>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        {/* member workflow */}
        {detail.canWork && !s.out_of_process ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Contacted</Label>
              <Select
                value={s.contact_status && /^y/i.test(s.contact_status) ? "Yes" : s.contact_status && /^n/i.test(s.contact_status) ? "No" : "__unset"}
                onValueChange={(v) =>
                  run(
                    () => updateSignupContact(s.id, { contactStatus: v === "__unset" ? null : v }),
                    "Saved"
                  )
                }
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">—</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Interested</Label>
              <Select
                value={s.interested && /^y/i.test(s.interested) ? "Yes" : s.interested && /^n/i.test(s.interested) ? "No" : "__unset"}
                onValueChange={(v) =>
                  run(
                    () => updateSignupContact(s.id, { interested: v === "__unset" ? null : v }),
                    "Saved"
                  )
                }
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">—</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {detail.canSetStatus ? (
            <>
            {/* ONE STATUS FIELD (v33.13). Two controls wrote the same column —
                "🎯 Potential" for the owner and "Status" in the VP block — so
                the same sign-up read differently depending which you looked at,
                and nothing said which was authoritative. This is the one, and
                MMs and above set it. "Parents Approval" stays a VP move. */}
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={s.status ?? "__none"}
                onValueChange={(v) =>
                  run(
                    () => setSignupPotential(s.id, v === "__none" ? null : v),
                    v === "Approved"
                      ? "APPROVED — that's the MOS! 🎉"
                      : v === "__none"
                        ? "Back to plain sign-up"
                        : `Moved to ${v} 📈`
                  )
                }
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Sign-up</SelectItem>
                  {SIGNUP_STATUSES.filter(
                    (st) => st !== "Parents Approval" || detail.canVp
                  ).map((st) => (
                    <SelectItem key={st} value={st}>
                      {st === "Approved" ? "Approved 🏆" : st}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {s.status === "Parents Approval" && !detail.canVp ? (
                <p className="text-[10px] text-muted-foreground">
                  Currently &quot;Parents Approval&quot; — VP-set, ask your VP to move it.
                </p>
              ) : null}
            </div>
            </>
            ) : null}
          </div>
        ) : null}

        {/* CIC — the SECOND call (v33.19). A different person re-calls a
            sign-up the first assignee marked Contacted that never got a
            status: did that call really happen, and what came of it. The
            first assignee keeps the row and the KPIs — these fields are
            recorded apart from the funnel's Contacted/Interested. */}
        {!s.out_of_process &&
        (viewer.canCic || s.cic_assigned_to === viewer.id || s.cic_assigned_name) ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">📞 CIC — second call</p>
              <Hint label={CIC_BLURB}>
                <span className="cursor-help text-xs text-muted-foreground underline decoration-dotted">
                  what&apos;s this?
                </span>
              </Hint>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>2nd caller</Label>
                {viewer.canCic && cicTargets.length > 0 ? (
                  <Select
                    value={s.cic_assigned_to ?? undefined}
                    onValueChange={(v) =>
                      run(() => assignCicCaller(s.id, v), "📞 CIC call handed over")
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="— not assigned" /></SelectTrigger>
                    <SelectContent>
                      {cicTargets.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm" dir="auto">
                    {s.cic_assigned_name ?? (
                      <span className="text-muted-foreground">— not assigned</span>
                    )}
                  </p>
                )}
              </div>
              {viewer.canCic || s.cic_assigned_to === viewer.id ? (
                <>
                  <div className="grid gap-1.5">
                    <Label>CIC contacted</Label>
                    <Select
                      value={
                        s.cic_contact_status && /^y/i.test(s.cic_contact_status)
                          ? "Yes"
                          : s.cic_contact_status && /^n/i.test(s.cic_contact_status)
                            ? "No"
                            : "__unset"
                      }
                      onValueChange={(v) =>
                        run(
                          () =>
                            updateCicContact(s.id, {
                              contactStatus: v === "__unset" ? null : v,
                            }),
                          "CIC saved"
                        )
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset">—</SelectItem>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>CIC interested</Label>
                    <Select
                      value={
                        s.cic_interested && /^y/i.test(s.cic_interested)
                          ? "Yes"
                          : s.cic_interested && /^n/i.test(s.cic_interested)
                            ? "No"
                            : "__unset"
                      }
                      onValueChange={(v) =>
                        run(
                          () =>
                            updateCicContact(s.id, {
                              interested: v === "__unset" ? null : v,
                            }),
                          "CIC saved"
                        )
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset">—</SelectItem>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : null}
            </div>
            {s.cic_assigned_at ? (
              <p className="text-[10px] text-muted-foreground">
                Handed over {fmtDateTime(s.cic_assigned_at)}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* VP-only fields */}
        {detail.canVp ? (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-semibold">VP fields</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Country</Label>
                <CountryInput
                  value={country ?? s.country ?? ""}
                  onChange={setCountry}
                  onCommit={(v) => {
                    const next = v.trim();
                    if (next !== (s.country ?? ""))
                      run(() => updateSignupVpFields(s.id, { country: next }), "Country saved 🌍");
                  }}
                />
              </div>
              {s.fn === "OGT" ? (
                <div className="grid gap-1.5">
                  <Label>Sub product</Label>
                  <Select
                    value={s.sub_product ?? "__none"}
                    onValueChange={(v) =>
                      run(
                        () => updateSignupVpFields(s.id, { subProduct: v === "__none" ? null : v }),
                        "Saved"
                      )
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      <SelectItem value="GTa">GTa</SelectItem>
                      <SelectItem value="GTe">GTe</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            {!s.out_of_process ? (
              !oopMode ? (
                <Button
                  size="sm" variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setOopMode(true)}
                >
                  <Archive className="size-3.5" /> Out of Process…
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={oopReason}
                    onChange={(e) => setOopReason(e.target.value)}
                    placeholder="Reason (goes on the sheet too)"
                    className="h-9 flex-1"
                  />
                  <Button
                    size="sm" variant="destructive" disabled={pending}
                    onClick={() =>
                      run(() => setSignupOop(s.id, oopReason), "Archived — out of the sign-ups list 🗄️")
                    }
                  >
                    Archive
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOopMode(false)}>
                    <X className="size-4" />
                  </Button>
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {/* ⚠️ v36 — THE B2C CALL, WHICH THIS DIALOG HAD NO WAY TO RECORD.
            Reported from the floor: "the cic for b2c doesn't have any outcome,
            just a comment nothing else". A B2C caller opening the sign-up they
            were handed got a comment box and nothing else — so the one thing
            they came to write down (what actually happened on the call) could
            only be done from the CIC list's inline cells, and not at all from
            the person they were looking at. It sits ABOVE Comments, because it
            is the reason they opened this. */}
        {detail.canB2c ? (
          <B2cCallSection
            call={detail.b2cCall}
            history={detail.b2cHistory}
            onDone={() => { onChanged(detail.signup.id); router.refresh(); }}
          />
        ) : null}

        {/* comments — the organized two-class log */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">Comments</p>
          {memberComments.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Member / MM</p>
              {memberComments.map((c) => (
                <div key={c.id} className="rounded-lg bg-muted p-2.5 text-sm" dir="auto">
                  <p className="mb-0.5 text-xs text-muted-foreground">
                    {c.author_name}{c.author_name !== "Sheet" ? ` · ${fmtDateTime(c.created_at)}` : " (from the sheet)"}
                  </p>
                  <p className="whitespace-pre-wrap break-words" dir="auto">{c.body}</p>
                </div>
              ))}
            </div>
          ) : null}
          {vpComments.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-primary">VP</p>
              {vpComments.map((c) => (
                <div key={c.id} className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-sm" dir="auto">
                  <p className="mb-0.5 text-xs text-muted-foreground">
                    {c.author_name}{c.author_name !== "Sheet" ? ` · ${fmtDateTime(c.created_at)}` : " (from the sheet)"}
                  </p>
                  <p className="whitespace-pre-wrap break-words" dir="auto">{c.body}</p>
                </div>
              ))}
            </div>
          ) : null}
          {b2cComments.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-warning">B2C</p>
              {b2cComments.map((c) => (
                <div key={c.id} className="rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-sm" dir="auto">
                  <p className="mb-0.5 text-xs text-muted-foreground">
                    {c.author_name} · {fmtDateTime(c.created_at)}
                  </p>
                  <p className="whitespace-pre-wrap break-words" dir="auto">{c.body}</p>
                </div>
              ))}
            </div>
          ) : null}
          {detail.canWork || detail.canVp || detail.canB2c ? (
            <div className="flex items-end gap-2">
              <Textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  detail.canWork || detail.canVp
                    ? detail.canVp
                      ? "VP comment — lands in the VP Comment cell"
                      : "Comment — lands in the Comment cell"
                    : "B2C comment — stays in Sodio, never written to the OGX tracker"
                }
                className="flex-1"
              />
              <Button
                size="sm"
                disabled={pending || !comment.trim()}
                onClick={() =>
                  run(async () => {
                    const res = await addSignupComment(s.id, comment);
                    if (res.ok) setComment("");
                    return res;
                  }, "Comment logged 📝")
                }
              >
                Log
              </Button>
            </div>
          ) : null}
        </div>

        {/* who changed what, and when */}
        <SignupHistory signupId={s.id} loadLogs={loadLogs} />

        <Button variant="outline" onClick={() => { onClose(); router.refresh(); }}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}


/** RECORDING THE B2C CALL FROM THE SIGN-UP ITSELF (v36).
 *
 *  ⚠️ It never touches the OGX funnel. `updateB2cCic` writes `contact_status`
 *  FROM the outcome onto the CALL row (v35.1) — the sign-up's own Contacted
 *  and Interested belong to the OGX crew and stay theirs. That isolation is
 *  the whole reason B2C has its own call row rather than sharing one. */
function B2cCallSection({
  call, history, onDone,
}: {
  call: SignupCicCall | null;
  history: SignupCicCall[];
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState("answered");
  const [interested, setInterested] = useState("__unset");
  const [callBack, setCallBack] = useState("");
  const [note, setNote] = useState("");
  const needsTime = outcome === "call_back";
  const reached = b2cOutcomeReached(outcome);

  const save = () =>
    start(async () => {
      if (!call) return;
      if (needsTime && !callBack) { toast.error("Pick when to call them back."); return; }
      const res = await updateB2cCic(call.id, {
        outcome,
        ...(needsTime ? { callBackAt: new Date(callBack).toISOString() } : {}),
        // "Interested" is only a real answer when they picked up (v35.1 ⑤)
        ...(reached && interested !== "__unset" ? { interested } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(
        needsTime ? "⏰ Call back saved — you'll be reminded" : "B2C call recorded 🛍"
      );
      onDone();
    });

  const done = history.filter((c) => c.outcome || c.contact_status);

  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="text-sm font-semibold text-warning">🛍 Your B2C call</p>
      {call ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">What happened?</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {B2C_CALL_OUTCOMES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* only offered when they actually picked up — "interested" is not
                an answer a busy signal can give (v35.1 ⑤) */}
            {reached ? (
              <div className="grid gap-1.5">
                <Label className="text-xs">Interested?</Label>
                <Select value={interested} onValueChange={setInterested}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unset">— not yet</SelectItem>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          {needsTime ? (
            <div className="grid gap-1.5">
              <Label className="text-xs">When should you call back?</Label>
              <Input
                type="datetime-local"
                className="h-9"
                value={callBack}
                onChange={(e) => setCallBack(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Cairo time. You&apos;ll be nudged once it falls due — a floor, not an alarm.
              </p>
            </div>
          ) : null}
          <Textarea
            rows={2}
            dir="auto"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was said on the call…"
          />
          <p className="text-xs text-muted-foreground">
            This is your selling call — it stays on your own log and never moves
            their OGX funnel.
          </p>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
            Record it
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {done.length > 0
            ? "No open B2C call on this one — the calls below are already recorded."
            : "No B2C call has been handed out for this sign-up yet."}
        </p>
      )}

      {done.length > 0 ? (
        <div className="space-y-1 border-t border-warning/30 pt-2">
          {done.map((c) => (
            <p key={c.id} className="text-xs text-muted-foreground" dir="auto">
              <b className="text-foreground">{c.caller_name}</b>{" "}
              {b2cOutcomeLabel(c.outcome) ?? (c.contact_status === "Yes" ? "✅ Answered" : "— no answer")}
              {c.interested ? ` · interested: ${c.interested}` : ""}
              {c.call_back_at ? ` · call back ${fmtDateTime(c.call_back_at)}` : ""}
              {c.note ? ` — ${c.note}` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
