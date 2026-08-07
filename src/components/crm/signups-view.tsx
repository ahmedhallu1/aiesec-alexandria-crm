"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Archive, Check, ChevronDown, History, LayoutDashboard, Loader2, Mail, Phone,
  PhoneCall, RefreshCw, RotateCcw,
  Search, UserMinus, UserRound, Users2, X,
} from "lucide-react";
import {
  addSignupComment, assignCicCaller, bulkAssignCicCaller, bulkReassignSignups,
  bulkReviveSignups, claimSignup,
  openSignupDetail,
  reassignSignup, reviveSignup, runSignupsImport, setSignupOop,
  setSignupPotential, updateCicContact, updateSignupContact, updateSignupVpFields,
} from "@/server/actions";
import type { OgxPlanCard, SignupDetail, SignupListRow, StreakStats } from "@/server/data";
import {
  fmtDateTime, SIGNUP_STATUSES,
  type OgxFunction, type SignupLog, type SignupRow,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { CountryInput } from "./country-input";
import {
  ColumnFilter, PageSizePicker, resizableCellStyle, ResizableHead, TableSettings, useTableColumns, type TableColumn,
} from "./data-table-kit";
import { Hint } from "./hint";
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
 *  fall back to the generic GT teal, OGV rows to the GV red. */
function programColor(program: string | null, fn: OgxFunction): { label: string; color: string } {
  const p = (program ?? "").toLowerCase();
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

/** v27 — the OGV contact-streak game: ≥1 sign-up contact action per Cairo day
 *  keeps the flame alive. Dimmed flame until today's save lands. */
function StreakCard({
  streak,
  onScope,
}: {
  streak: StreakStats;
  onScope: (s: string) => void;
}) {
  const medals = ["🥇", "🥈", "🥉"];
  const dayWord = (n: number) => `day${n === 1 ? "" : "s"}`;
  return (
    <Card className="rise-in border-orange-400/40">
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "text-4xl leading-none transition-all",
              !streak.savedToday && "opacity-40 grayscale"
            )}
          >
            🔥
          </span>
          <div className="min-w-0">
            <p className="text-xl font-bold tabular-nums">
              {streak.current}-day streak
            </p>
            <p
              className={cn(
                "text-xs",
                streak.savedToday
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground"
              )}
            >
              {streak.savedToday
                ? `Saved today ✅ — ${streak.todayCount} contact${streak.todayCount === 1 ? "" : "s"}`
                : "Save today's streak — contact a sign-up!"}
            </p>
          </div>
          <p className="ml-auto shrink-0 text-xs text-muted-foreground">
            Best:{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {streak.best}
            </span>{" "}
            {dayWord(streak.best)}
          </p>
        </div>
        <div className="border-t pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {streak.scope} top streaks
            </p>
            {/* one board for all of OGX, narrowed to a side when wanted */}
            {streak.scopes.length > 1 ? (
              <div className="ml-auto flex items-center gap-0.5 rounded-md bg-muted p-0.5">
                {streak.scopes.map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => onScope(sc)}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                      streak.scope === sc
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {sc}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {streak.topStreaks.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {streak.topStreaks.map((t, i) => (
                <p key={`${t.name}-${i}`} className="text-sm">
                  {medals[i] ?? "•"} {t.name}
                  <span className="text-muted-foreground">
                    {" "}
                    — {t.current} {dayWord(t.current)}
                    {t.today > 0 ? ` · ${t.today} today` : ""}
                  </span>
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Nobody has a live streak yet — be the first. 🔥
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface ViewerInfo {
  id: string;
  name: string;
  isLeader: boolean;
  isTl: boolean;
  /** MMs and above — may hand a sign-up to a SECOND caller (seesCicQueue) */
  canCic: boolean;
  canVp: boolean;
}

// ------------------------------------------------- universal table columns

/** Server sort fields (SIGNUP_SORTABLE in data.ts) per column key. */
const SIGNUP_SORT: Record<string, { field: string; dir: "asc" | "desc" }> = {
  signed_up_at: { field: "signed_up_at", dir: "desc" },
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
    { key: "assigned", label: "Assigned" },
    { key: "contacted", label: "Contacted" },
    { key: "interested", label: "Interested" },
    // CIC (v33.19) — the SECOND call, kept beside the first so the two are
    // never confused. Off everywhere but the CIC view.
    { key: "cic_assigned", label: "2nd caller", defaultHidden: !cic },
    { key: "cic_contacted", label: "CIC contacted", defaultHidden: !cic },
    { key: "cic_interested", label: "CIC interested", defaultHidden: !cic },
    { key: "person_status", label: "Person status", defaultHidden: !pool },
    { key: "campaign", label: "Campaign", defaultHidden: !pool },
    { key: "status", label: "Status", defaultHidden: pool },
    { key: "country", label: "Country", defaultHidden: pool },
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

/** Fires right after a sign-up's WhatsApp / call / email link is opened: the
 *  same fields the detail dialog carries (Contacted · Interested · comment),
 *  with the channel already written into the comment. Claims the sign-up on
 *  the way when it came from the unassigned pool — the exact same motion as
 *  the Contact button. "Not now" always gets you out. */
function SignupContactPrompt({
  row, channel, onClose, onOpenDetail,
}: {
  row: SignupRow;
  channel: Channel;
  onClose: () => void;
  onOpenDetail: () => void;
}) {
  const router = useRouter();
  const [contacted, setContacted] = useState("Yes");
  const [interested, setInterested] = useState("__unset");
  const [comment, setComment] = useState(`Reached out on ${channel}.`);
  const [pending, start] = useTransition();

  const unassigned = !row.assigned_to && !row.assigned_name;

  const submit = () =>
    start(async () => {
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
            You just opened <b>{channel}</b>. Log it here — a sign-up contacted
            without a record is a sign-up nobody follows up.
            {unassigned ? " Saving also claims them for you." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
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
            Need the full record (potential, country, archive)? Open the details →
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
  rows, total, page, pageSize, pageSizeOptions, activeView, views, fns, activeFn,
  targets, cicTargets, loadLogs, planCard, streak, viewer, filters, filterOptions,
}: {
  rows: SignupListRow[];
  /** every value each filterable column holds across the WHOLE set — a filter
   *  built from the visible page could only offer what happened to be on it */
  filterOptions: Record<string, string[]>;
  total: number;
  page: number;
  pageSize: number;
  /** the sign-ups-per-page choices (?size param) */
  pageSizeOptions: number[];
  activeView: string;
  views: string[];
  fns: OgxFunction[];
  activeFn: OgxFunction;
  targets: { id: string; label: string }[];
  /** who a CIC second call can be handed to — empty for anyone below an MM */
  cicTargets: { id: string; label: string }[];
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
        ? viewer.canCic
        : viewer.isLeader || viewer.isTl;
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const sortBy = (field: string, defaultDir: "asc" | "desc" = "desc") => {
    if (filters.sort === field)
      setParams({ dir: filters.dir === "asc" ? "desc" : "asc" });
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
          filters.sort === field && "font-bold text-primary"
        )}
        title="Sort by this column"
      >
        {children}
        {filters.sort === field ? (
          <span>{filters.dir === "asc" ? "↑" : "↓"}</span>
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
        return pick("Contacted", filters.contacted ?? "", [["Yes", "Contacted ✓"], ["No", "Not contacted"]],
          (v) => setParams({ contacted: v || null }));
      case "interested":
        return pick("Interested", filters.interested ?? "", [["Yes", "Interested ✓"], ["No", "Not interested"]],
          (v) => setParams({ interested: v || null }));
      case "status":
        return pick("Status", filters.potential ?? "",
          [...SIGNUP_STATUSES.map((st) => [st, st] as [string, string]), ["none", "— None yet"]],
          (v) => setParams({ potential: v || null, status: null }));
      case "assigned": {
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
      const res = await assignCicCaller(r.id, callerId);
      if (res.ok) {
        toast.success(
          `📞 CIC handed to ${cicTargets.find((t) => t.id === callerId)?.label ?? "them"}`
        );
        router.refresh();
      } else toast.error(res.error);
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
            <p className="text-xs text-muted-foreground">EP {r.ep_id}</p>
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
            Two-way synced with the {activeFn} tracker sheet — contact one from
            the unassigned pool, it&apos;s yours, move them down the funnel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Hint label={`The ${activeFn} funnel dashboard — KPIs, conversions, leaderboard`}>
            <Button variant="outline" asChild>
              <Link href={`/dashboard?fn=${activeFn}`}>
                <LayoutDashboard className="size-4" /> Dashboard
              </Link>
            </Button>
          </Hint>
          {viewer.isLeader ? (
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
            {fns.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setParams({ fn: f, program: null })}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-semibold transition-colors",
                  activeFn === f ? "bg-background shadow" : "text-muted-foreground"
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
              onClick={() => setParams({ view: v })}
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
        {viewer.isLeader || viewer.isTl || viewer.canCic ? (
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
            <SelectItem value="Yes">Contacted ✓</SelectItem>
            <SelectItem value="No">Not contacted</SelectItem>
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
              className="cursor-pointer active:bg-muted/40"
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
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r.id)}>
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
            {(cicView ? cicTargets : targets).length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setAssignOpen(true)}
              >
                {cicView ? (
                  <><PhoneCall className="size-3.5" /> Assign 2nd caller…</>
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
              {cicView ? (
                <>
                  📞 CIC — second caller for {selected.size} sign-up
                  {selected.size === 1 ? "" : "s"}
                </>
              ) : (
                <>Assign {selected.size} sign-up{selected.size === 1 ? "" : "s"}</>
              )}
            </DialogTitle>
            <DialogDescription>
              {cicView ? (
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
              {(cicView ? cicTargets : targets).map((t) => (
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
              onClick={() => (cicView ? runBulkCic(assignTarget) : runBulk(assignTarget))}
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
          {detail.canWork || detail.canVp ? (
            <div className="flex items-end gap-2">
              <Textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={detail.canVp ? "VP comment — lands in the VP Comment cell" : "Comment — lands in the Comment cell"}
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
