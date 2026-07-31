"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Archive, Check, Loader2, Phone, RefreshCw, RotateCcw, Search, UserMinus,
  UserRound, Users2, X,
} from "lucide-react";
import {
  addSignupComment, bulkReassignSignups, claimSignup, openSignupDetail,
  reassignSignup, reviveSignup, runSignupsImport, setSignupOop,
  updateSignupContact, updateSignupVpFields,
} from "@/server/actions";
import type { OgxPlanCard, SignupDetail, StreakStats } from "@/server/data";
import { fmtDateTime, SIGNUP_STATUSES, type OgxFunction, type SignupRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CountryInput } from "./country-input";
import { Hint } from "./hint";
import { WhatsAppIcon } from "./icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const waDigits = (phone: string | null) => {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.startsWith("20") ? d : d.startsWith("0") ? `2${d}` : `20${d}`;
};

const VIEW_LABELS: Record<string, string> = {
  unassigned: "🆕 Unassigned",
  mine: "My sign-ups",
  team: "My team",
  all: "All",
  archived: "🗄️ Archived",
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
function StreakCard({ streak }: { streak: StreakStats }) {
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
                ? "Streak saved for today ✅"
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
        {streak.topStreaks.length > 0 ? (
          <div className="border-t pt-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              LC top streaks
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {streak.topStreaks.map((t, i) => (
                <p key={`${t.name}-${i}`} className="text-sm">
                  {medals[i] ?? "•"} {t.name}
                  <span className="text-muted-foreground">
                    {" "}
                    — {t.current} {dayWord(t.current)}
                  </span>
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface ViewerInfo {
  id: string;
  name: string;
  isLeader: boolean;
  isTl: boolean;
  canVp: boolean;
}

export function SignupsView({
  rows, total, page, pageSize, activeView, views, fns, activeFn, targets, planCard,
  streak, viewer, filters,
}: {
  rows: SignupRow[];
  total: number;
  page: number;
  pageSize: number;
  activeView: string;
  views: string[];
  fns: OgxFunction[];
  activeFn: OgxFunction;
  targets: { id: string; label: string }[];
  planCard: OgxPlanCard | null;
  streak: StreakStats | null;
  viewer: ViewerInfo;
  filters: {
    q: string; batch: string; program: string; status: string;
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

  // bulk selection (TL/VP/Director/LCP-admin): assign to a member or send
  // back to the pool — the archived view is read-only, no selection there
  const canBulk = (viewer.isLeader || viewer.isTl) && activeView !== "archived";
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
    field, defaultDir = "desc", children, className,
  }: {
    field: string;
    defaultDir?: "asc" | "desc";
    children: React.ReactNode;
    className?: string;
  }) => (
    <TableHead className={className}>
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
      const res = await claimSignup(row.id);
      if (res.ok) {
        toast.success("It's yours — log the contact ✍️");
        router.refresh();
        openDetail(row.id);
      } else toast.error(res.error);
    });

  const runBulk = (memberId: string | null) =>
    start(async () => {
      const ids = [...selected];
      let done = 0;
      let failed = 0;
      // the server caps one call at 50 — feed it in chunks so select-all works
      for (let i = 0; i < ids.length; i += 50) {
        const res = await bulkReassignSignups(ids.slice(i, i + 50), memberId);
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
        {viewer.isLeader ? (
          <Button variant="outline" onClick={syncNow} disabled={pending}>
            <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> Sync now
          </Button>
        ) : null}
      </div>

      {planCard || streak ? (
        <div className={cn("grid gap-4", planCard && streak && "lg:grid-cols-2")}>
          {planCard ? <MmPlanCard plan={planCard} /> : null}
          {streak ? <StreakCard streak={streak} /> : null}
        </div>
      ) : null}

      {/* function + view chips */}
      <div className="flex flex-wrap items-center gap-2">
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
        {views.map((v) => (
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
        ))}
      </div>

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
        <Select
          value={filters.status || "all"}
          onValueChange={(v) => setParams({ status: v === "all" ? null : v })}
        >
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: any</SelectItem>
            {SIGNUP_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
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
        <span className="ml-auto text-sm text-muted-foreground">
          {total} sign-up{total === 1 ? "" : "s"}
        </span>
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
            <Card key={r.id} onClick={() => openDetail(r.id)}>
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
                <p className="text-xs text-muted-foreground">
                  {r.signed_up_at ?? ""} · EP {r.ep_id}
                </p>
                {r.phone ? (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <a href={`https://wa.me/${waDigits(r.phone)}`} target="_blank" rel="noreferrer">
                        <WhatsAppIcon className="size-4" /> WhatsApp
                      </a>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <a href={`tel:${r.phone}`}><Phone className="size-4" /> Call</a>
                    </Button>
                  </div>
                ) : null}
                {!r.assigned_to && !r.assigned_name && !r.out_of_process ? (
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
        <div className="overflow-x-auto">
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
                <SortHead field="signed_up_at">Signed up</SortHead>
                <SortHead field="name" defaultDir="asc">Sign-up</SortHead>
                <SortHead field="program" defaultDir="asc">Program</SortHead>
                <TableHead>Contact</TableHead>
                <TableHead>Assigned</TableHead>
                <SortHead field="contact_status" defaultDir="asc">Contacted</SortHead>
                <SortHead field="interested" defaultDir="asc">Interested</SortHead>
                <SortHead field="status" defaultDir="asc">Status</SortHead>
                <SortHead field="country" defaultDir="asc">Country</SortHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canBulk ? 11 : 10} className="py-12 text-center text-muted-foreground">
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
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {r.signed_up_at ?? "—"}
                      <span className="block text-[10px] opacity-70">
                        {r.batch === "new" ? "New" : "Old"} SUs
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium" dir="auto">{r.name}</span>
                      <p className="text-xs text-muted-foreground">EP {r.ep_id}</p>
                    </TableCell>
                    <TableCell>
                      <ProgramBadge program={r.program} fn={r.fn} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {r.phone ? (
                        <span className="flex items-center gap-1">
                          <Hint label={`WhatsApp ${r.phone}`}>
                            <Button asChild variant="outline" size="icon" className="size-7">
                              <a
                                href={`https://wa.me/${waDigits(r.phone)}`}
                                target="_blank" rel="noreferrer"
                              >
                                <WhatsAppIcon className="size-3.5" />
                              </a>
                            </Button>
                          </Hint>
                          <Hint label={`Call ${r.phone}`}>
                            <Button asChild variant="outline" size="icon" className="size-7">
                              <a href={`tel:${r.phone}`}><Phone className="size-3.5" /></a>
                            </Button>
                          </Hint>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">no phone</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.assigned_to || r.assigned_name ? (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <UserRound className="size-3.5" /> {r.assigned_name ?? "assigned"}
                        </span>
                      ) : (
                        <Badge variant="outline" className="border-primary/50 text-primary">
                          unassigned
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{yn(r.contact_status)}</TableCell>
                    <TableCell className="text-sm">{yn(r.interested)}</TableCell>
                    <TableCell className="text-sm">
                      {r.out_of_process ? (
                        <span className="text-destructive">🗄️ {r.oop_reason ?? "OOP"}</span>
                      ) : r.status ? (
                        <Badge className={r.status === "Approved" ? "bg-emerald-600" : ""}>
                          {r.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.country ?? "—"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {!r.assigned_to && !r.assigned_name && !r.out_of_process ? (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => contact(r)}>
                          <Phone className="size-3.5" /> Contact
                        </Button>
                      ) : detailLoading === r.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* pagination */}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-3 text-sm">
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
            {targets.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setAssignOpen(true)}
              >
                <Users2 className="size-3.5" /> Assign to…
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setUnassignOpen(true)}
            >
              <UserMinus className="size-3.5" /> Unassign
            </Button>
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
              Assign {selected.size} sign-up{selected.size === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              They land on the member&apos;s &quot;My sign-ups&quot; list. Every row is
              re-checked against your scope and synced back to the sheet.
            </DialogDescription>
          </DialogHeader>
          <Select value={assignTarget || undefined} onValueChange={setAssignTarget}>
            <SelectTrigger><SelectValue placeholder="Pick a member…" /></SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => { setAssignOpen(false); setAssignTarget(""); }}
            >
              Cancel
            </Button>
            <Button
              disabled={!assignTarget || pending}
              onClick={() => runBulk(assignTarget)}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Users2 className="size-4" />}
              Assign
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
          onClose={() => setDetail(null)}
          onChanged={(id) => { openDetail(id); router.refresh(); }}
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

function SignupDetailDialog({
  detail, targets, onClose, onChanged,
}: {
  detail: SignupDetail | null;
  targets: { id: string; label: string }[];
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
            {s.name}
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
            {s.oop_reason ? <p className="text-muted-foreground">{s.oop_reason}</p> : null}
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
        {s.phone ? (
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
          <div className="grid grid-cols-2 gap-3">
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
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select
                  value={s.status ?? "__none"}
                  onValueChange={(v) =>
                    run(
                      () => updateSignupVpFields(s.id, { status: v === "__none" ? null : v }),
                      v === "Approved" ? "APPROVED — that's the MOS! 🎉" : "Status saved"
                    )
                  }
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {SIGNUP_STATUSES.map((st) => (
                      <SelectItem key={st} value={st}>{st}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                  <p className="whitespace-pre-wrap" dir="auto">{c.body}</p>
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
                  <p className="whitespace-pre-wrap" dir="auto">{c.body}</p>
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

        <Button variant="outline" onClick={() => { onClose(); router.refresh(); }}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
