"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Loader2, Pencil,
  Trash2, UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "./hint";
import { TouchPointManageDialog } from "./touch-point-manage-dialog";
import { TouchPointDialog } from "./touch-point-dialog";
import { TimelineDialog } from "./timeline-dialog";
import { CalendarItemDialog } from "./calendar-item-dialog";
import { deleteCalendarItem } from "@/server/calendar-items";
import type { CalendarVisit } from "@/server/data";
import { fmtClock12 } from "@/lib/types";
import { bookedBy } from "@/lib/touch-point-label";

/** Distinct, readable chip colors — one per member, assigned in a stable order. */
const MEMBER_COLORS = [
  "#037EF3", "#F85A40", "#0CB9C1", "#F48924", "#8E44AD", "#27AE60",
  "#E91E8C", "#795548", "#607D8B", "#C0392B", "#3F51B5", "#00897B",
];

// the Egyptian work week starts on Saturday
const DAY_NAMES = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "Saturday, 2 August 2026" — the day panel's title. */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/** Everything TouchPointDialog needs, minus what the day panel drives itself —
 *  the page hands this over as plain data so the calendar can open the SAME
 *  dialog with a date already filled in. */
export type CalendarBooking = Omit<
  React.ComponentProps<typeof TouchPointDialog>,
  "defaultDate" | "open" | "onOpenChange"
>;

export interface CalendarTouchPoint {
  id: string;
  label: string;
  /** Cairo calendar day, YYYY-MM-DD */
  date: string;
  /** Cairo start, human ("6:30 PM") */
  time: string;
  /** Cairo start, 24h HH:MM — what the manage form edits */
  timeValue: string;
  note: string | null;
  /** lc | function | team — an LC point reads as TM's, not a person's */
  scope: string;
  ownerName: string;
  audience: string;
  cancelled: boolean;
  recorded: boolean;
  /** this viewer may move or cancel it (server-computed via canEditTouchPoint) */
  canEdit: boolean;
  /** the viewer is actually IN this point's audience — "only mine" keeps it */
  mine: boolean;
}

export interface CalendarIrCall {
  id: string;
  date: string;
  time: string;
  partnerLc: string;
  memberName: string;
  memberId: string | null;
  status: string;
}

/** A custom slot/task (v33.16) — invite-shaped, so it is always "mine". */
export interface CalendarCustomItem {
  id: string;
  title: string;
  date: string;
  time: string;
  endTime: string | null;
  note: string | null;
  ownerName: string;
  assigneeNames: string[];
  canDelete: boolean;
}

/** Whose items the calendar shows (v33.19 — replaced the "Only mine" switch). */
type CalScope = "all" | "mine" | "team" | "function";

const SCOPE_OPTIONS: {
  key: CalScope;
  label: string;
  hint: string;
  /** the empty state's subject — "Nothing {…}booked in August yet." */
  empty: string;
}[] = [
  {
    key: "all",
    label: "Everyone",
    hint: "Everything you can see — the whole function's visits, IR calls and touch points",
    empty: "",
  },
  {
    key: "mine",
    label: "Mine",
    hint: "Only what's YOURS — your visits, your IR calls, the touch points you're part of",
    empty: "of yours ",
  },
  {
    key: "team",
    label: "My team",
    hint: "You and your team — their visits and IR calls, and the touch points you're part of",
    empty: "for your team ",
  },
  {
    key: "function",
    label: "My function",
    hint: "Everyone who works one of your functions — plus every touch point you can see",
    empty: "for your function ",
  },
];

const isCalScope = (v: unknown): v is CalScope =>
  v === "all" || v === "mine" || v === "team" || v === "function";

export function CalendarView({
  visits, touchPoints = [], irCalls = [], items = [], month, viewerId,
  teamMemberIds = [], memberFnIds = [], viewerRole = "Member",
  openableMemberIds, showFunction = false, booking = null,
  canAddItems = false, assignables = [], viewerFunctions = [],
}: {
  visits: CalendarVisit[];
  /** TM touch points the viewer belongs to (v29) */
  touchPoints?: CalendarTouchPoint[];
  /** consideration IR calls, for viewers with that access (v29) */
  irCalls?: CalendarIrCall[];
  /** custom slots/tasks the viewer owns or is assigned to (v33.16) */
  items?: CalendarCustomItem[];
  /** what this viewer may book — null when they may book nothing (v29.4) */
  booking?: CalendarBooking | null;
  /** TL and above add custom items (v33.16) */
  canAddItems?: boolean;
  assignables?: { id: string; label: string }[];
  month: string;
  viewerId: string;
  /** the ACCOUNT functions this viewer can see — the Function filter is
   *  offered only when that is more than one (v33.28) */
  viewerFunctions?: string[];
  /** the viewer's direct team (v33.19) — drives the "My team" scope */
  teamMemberIds?: string[];
  /** drives WHICH scopes are offered — see `scopeOptions` */
  viewerRole?: string;
  /** active members sharing a function with the viewer — the "My function" scope */
  memberFnIds?: string[];
  /** member ids whose accounts the viewer may open — null = everyone shown */
  openableMemberIds: string[] | null;
  /** LCP/admin see the whole LC — hovering a visit also names its function */
  showFunction?: boolean;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  // the touch point being moved / cancelled (v29)
  const [manage, setManage] = useState<CalendarTouchPoint | null>(null);
  // the day whose panel is open (Cairo YYYY-MM-DD) — v29.4
  const [day, setDay] = useState<string | null>(null);
  // the day a touch point is being booked ON, driving TouchPointDialog
  const [bookDate, setBookDate] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  // the day a custom item is being added ON, driving CalendarItemDialog
  const [itemDate, setItemDate] = useState<string | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [deletePending, startDelete] = useTransition();
  // WHOSE ITEMS (v33.19, was the v33.16 "Only mine" switch): Everyone · Mine ·
  // My team · My function. Read after mount so SSR and first paint agree.
  const [viewScope, setViewScope] = useState<CalScope>("all");
  useEffect(() => {
    const saved = localStorage.getItem("sodio-calendar-scope");
    if (isCalScope(saved)) setViewScope(saved);
  }, []);
  const pickScope = (s: CalScope) => {
    setViewScope(s);
    try {
      localStorage.setItem("sodio-calendar-scope", s);
    } catch { /* private mode — the choice just won't stick */ }
  };
  // THE SCOPES THAT MEAN SOMETHING FOR *THIS* VIEWER (v33.19.2).
  //
  // The four options were fixed, so a Team Leader got "Mine" and "My team"
  // that return the SAME rows (their team IS them plus their reports), and a
  // VP/Director got both plus "My function" — three chips, one answer. Offer
  // only the distinctions that exist at each level:
  //   Member/Coordinator → Everyone · Mine · My function
  //   Team Leader        → Everyone · My team · My function   (mine == team)
  //   LCVP/Director/LCP  → Everyone · My function             (fn == theirs)
  const scopeOptions = useMemo(() => {
    const lead = ["LCVP", "Director", "LCP", "Admin"].includes(viewerRole);
    const tl = viewerRole === "Team Leader";
    const drop = new Set<CalScope>(
      lead ? ["mine", "team"] : tl ? ["mine"] : teamMemberIds.length > 0 ? [] : ["team"]
    );
    return SCOPE_OPTIONS.filter((o) => !drop.has(o.key));
  }, [viewerRole, teamMemberIds.length]);
  // a stored scope that this viewer no longer has falls back to Everyone
  const effectiveScope = scopeOptions.some((o) => o.key === viewScope) ? viewScope : "all";
  const scopeMeta =
    scopeOptions.find((o) => o.key === effectiveScope) ?? SCOPE_OPTIONS[0];

  /** Which member ids a visit / IR call must belong to — null = no filter. */
  const ownerIds = useMemo(() => {
    if (effectiveScope === "all") return null;
    if (effectiveScope === "mine") return new Set([viewerId]);
    if (effectiveScope === "team") return new Set([viewerId, ...teamMemberIds]);
    return new Set([viewerId, ...memberFnIds]);
  }, [effectiveScope, viewerId, teamMemberIds, memberFnIds]);

  /** WHICH KINDS ARE ON (v33.28) — a month with a working-hours routine in it
   *  drowns the two visits you were looking for. Empty set = everything. */
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const toggleKind = (k: string) =>
    setKinds((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const kindOn = (k: string) => kinds.size === 0 || kinds.has(k);

  /** THE FUNCTION FILTER IS ABOUT THE VIEWER, NOT THE MONTH (v33.28).
   *
   *  The LCP's rule: "an IGT LCVP won't have function tags — he already sees
   *  his only." Deriving the control from the DATA would break that, because a
   *  single cross-function INVITE on one touch point puts a second function in
   *  the month and the control would appear for someone who owns one function.
   *  So it is offered to people whose remit genuinely spans functions, and to
   *  nobody else. */
  const fnOptions = useMemo(
    () => (viewerFunctions.length > 1 ? viewerFunctions : []),
    [viewerFunctions]
  );
  const [fnFilter, setFnFilter] = useState("");
  // a visit's function is the ACCOUNT's (B2B and BD are deliberately distinct
  // there), so it is matched literally and never folded together
  const visitFnOk = (fn: string | null | undefined) => !fnFilter || fn === fnFilter;

  const shownVisits = useMemo(
    () =>
      visits.filter(
        (v) =>
          kindOn("visits") &&
          (!ownerIds || ownerIds.has(v.member.id)) &&
          visitFnOk(v.account.function)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visits, ownerIds, kinds, fnFilter]
  );
  // touch points are already function-scoped server-side, and they have no
  // single "owner" to match a team against — so "My function" keeps everything
  // visible and the two narrower scopes keep the ones the viewer is IN
  const shownTps = useMemo(
    () =>
      (effectiveScope === "mine" || effectiveScope === "team"
        ? touchPoints.filter((t) => t.mine)
        : touchPoints
      ).filter((t) => kindOn("touchPoints")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [touchPoints, viewScope, kinds]
  );
  const shownIr = useMemo(
    () =>
      irCalls.filter(
        (c) => kindOn("irCalls") && (!ownerIds || (c.memberId && ownerIds.has(c.memberId)))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [irCalls, ownerIds, kinds]
  );
  // custom items are already owner/assignee-scoped server-side, and their
  // stored function_key is the OWNER's arbitrary first function — read by
  // nothing else — so they are never filtered BY function, only by kind
  const shownItems = useMemo(
    () => items.filter(() => kindOn("items")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, kinds]
  );

  const removeItem = (it: CalendarCustomItem) => {
    if (!confirm(`Remove "${it.title}" from the calendar?`)) return;
    startDelete(async () => {
      const res = await deleteCalendarItem(it.id);
      if (res.ok) {
        toast.success("Item removed");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  /** Book on a chosen day: hand the date to TouchPointDialog and step out of
   *  the way (two stacked dialogs fight over the focus trap). */
  const bookOn = (date: string) => {
    setBookDate(date);
    setBookOpen(true);
    setDay(null);
  };

  const goMonth = (m: string) =>
    startNav(() => router.replace(`/calendar?m=${m}`));

  // stable member → color assignment (sorted by display name so it doesn't
  // reshuffle when visits change order)
  const legend = useMemo(() => {
    const byMember = new Map<string, { id: string; label: string; count: number }>();
    for (const v of shownVisits) {
      const label = v.member.name;
      const cur = byMember.get(v.member.id);
      if (cur) cur.count += 1;
      else byMember.set(v.member.id, { id: v.member.id, label, count: 1 });
    }
    return [...byMember.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((m, i) => ({ ...m, color: MEMBER_COLORS[i % MEMBER_COLORS.length] }));
  }, [shownVisits]);
  const colorOf = useMemo(
    () => new Map(legend.map((l) => [l.id, l.color])),
    [legend]
  );

  const tpByDate = useMemo(() => {
    const map = new Map<string, CalendarTouchPoint[]>();
    for (const t of shownTps) {
      const list = map.get(t.date) ?? [];
      list.push(t);
      map.set(t.date, list);
    }
    // earliest first — the 24h value sorts lexically, the human one doesn't
    for (const list of map.values())
      list.sort((a, b) => a.timeValue.localeCompare(b.timeValue));
    return map;
  }, [shownTps]);

  const irByDate = useMemo(() => {
    const map = new Map<string, CalendarIrCall[]>();
    for (const c of shownIr) {
      const list = map.get(c.date) ?? [];
      list.push(c);
      map.set(c.date, list);
    }
    return map;
  }, [shownIr]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarVisit[]>();
    for (const v of shownVisits) {
      const list = map.get(v.visit_date) ?? [];
      list.push(v);
      map.set(v.visit_date, list);
    }
    return map;
  }, [shownVisits]);

  // custom items are invite-shaped — always the viewer's own, never filtered
  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarCustomItem[]>();
    for (const it of shownItems) {
      const list = map.get(it.date) ?? [];
      list.push(it);
      map.set(it.date, list);
    }
    return map;
  }, [shownItems]);

  // month grid, Saturday-first
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay(); // 0=Sun … 6=Sat
  const leading = (firstDow + 1) % 7; // offset from Saturday
  const cells: (string | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // CAIRO's today — the grid, the "book ahead" gate and the server all speak
  // Cairo; the browser's local date would disagree for anyone travelling (and
  // with the UTC server render, mid-evening)
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const thisMonth = today.slice(0, 7);

  const dayTps = day ? tpByDate.get(day) ?? [] : [];
  const dayIr = day ? irByDate.get(day) ?? [] : [];
  const dayVisits = day ? byDate.get(day) ?? [] : [];
  const dayItems = day ? itemsByDate.get(day) ?? [] : [];
  const dayCount = dayTps.length + dayIr.length + dayVisits.length + dayItems.length;

  const chip = (v: CalendarVisit, full = false) => {
    const color = colorOf.get(v.member.id) ?? "#037EF3";
    const who = v.member.name;
    const status = v.done === null ? "pending report" : v.done ? "done ✅" : "not completed ❌";
    // members only OPEN their own accounts — teammates' visits stay visible
    // but unlinked (clicking would 404 on the RBAC check)
    const openable = openableMemberIds === null || openableMemberIds.includes(v.member.id);
    const className = cn(
      "block truncate rounded-md border-l-[3px] px-1.5 py-0.5 text-[11px] font-medium leading-4",
      openable && "transition-transform hover:-translate-y-px hover:shadow-sm",
      full && "text-[12px] py-1",
      v.done === false && "opacity-55 line-through"
    );
    const style = { borderLeftColor: color, backgroundColor: `${color}1a`, color };
    const body = (
      <>
        {v.done ? "✓ " : ""}{fmtClock12(v.visit_time)} {v.account.name}
        {full ? <span className="opacity-75"> · {who}</span> : null}
      </>
    );
    return (
      <Hint
        key={v.id}
        label={`${v.account.name} — ${who} · ${fmtClock12(v.visit_time)} · ${status}${
          showFunction ? ` · ${v.account.function}` : ""
        }`}
      >
        {openable ? (
          <Link href={`/accounts/${v.account.id}`} className={className} style={style}>
            {body}
          </Link>
        ) : (
          <span className={className} style={style}>{body}</span>
        )}
      </Hint>
    );
  };

  return (
    <div className={cn("mx-auto max-w-6xl space-y-4", navPending && "nav-pending")}>
      <div className="flex flex-wrap items-center justify-between gap-3 rise-in">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarDays className="size-6 text-primary" /> Calendar
            {navPending ? <Loader2 className="size-4 animate-spin text-primary" /> : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            Everything you&apos;re part of: touch points, visits and IR calls —
            colour-coded. Click any day to see it in full
            {booking ? " and book a touch point on it" : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {/* whose items — one h-9 segmented control on the filter baseline */}
          <div
            role="group"
            aria-label="Whose items to show"
            className="flex h-9 shrink-0 items-center gap-0.5 rounded-md border p-0.5"
          >
            {scopeOptions.map((o) => (
              <Hint key={o.key} label={o.hint}>
                <button
                  type="button"
                  aria-pressed={effectiveScope === o.key}
                  onClick={() => pickScope(o.key)}
                  className={cn(
                    "flex h-8 items-center gap-1 rounded px-2 text-xs font-semibold transition-colors",
                    effectiveScope === o.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {o.key === "mine" ? <UserRound className="size-3.5" /> : null}
                  {o.label}
                </button>
              </Hint>
            ))}
          </div>
          {/* WHICH KINDS (v33.28) — tick nothing to see everything, or narrow
              to the one you came looking for. */}
          <div
            role="group"
            aria-label="Which kinds to show"
            className="flex h-9 shrink-0 items-center gap-0.5 rounded-md border p-0.5"
          >
            {[
              { key: "visits", label: "Visits", dot: "#F85A40" },
              { key: "irCalls", label: "IR calls", dot: "#0CB9C1" },
              { key: "touchPoints", label: "Touch points", dot: "#7c3aed" },
              { key: "items", label: "Items", dot: "#16a34a" },
            ].map((k) => (
              <button
                key={k.key}
                type="button"
                aria-pressed={kinds.has(k.key)}
                onClick={() => toggleKind(k.key)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded px-2 text-xs font-semibold transition-colors",
                  kinds.has(k.key)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: k.dot }}
                />
                {k.label}
              </button>
            ))}
          </div>
          {/* only for people whose remit actually spans functions */}
          {fnOptions.length > 0 ? (
            <Select value={fnFilter || "all"} onValueChange={(v) => setFnFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 w-32 gap-1 px-2">
                <SelectValue placeholder="Function" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All functions</SelectItem>
                {fnOptions.map((f) => (
                  <SelectItem key={f} value={f}>{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {canAddItems ? (
            <CalendarItemDialog assignables={assignables} viewerId={viewerId} />
          ) : null}
          {booking ? <TouchPointDialog {...booking} /> : null}
          {/* the ROUTINE behind the one-offs: book the whole peak at once */}
          {booking ? (
            <TimelineDialog
              scopes={booking.scopes ?? []}
              functionKey={booking.functions?.[0] ?? null}
              teamName={booking.myTeam ?? null}
            />
          ) : null}
          <Button variant="outline" size="icon" className="size-9" onClick={() => goMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant={month === thisMonth ? "default" : "outline"}
            className="h-9 min-w-36 font-semibold"
            onClick={() => goMonth(thisMonth)}
          >
            {monthLabel(month)}
          </Button>
          <Button variant="outline" size="icon" className="size-9" onClick={() => goMonth(shiftMonth(month, 1))} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* legend */}
      {legend.length > 0 ? (
        <div className="stagger flex flex-wrap gap-1.5">
          {legend.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: l.color }} />
              {l.label}
              {l.id === viewerId ? <span className="text-muted-foreground">(you)</span> : null}
              <span className="text-muted-foreground">· {l.count}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* month grid (≥sm) */}
      <Card className="hidden rise-in rise-in-2 sm:block">
        <CardContent className="p-2 sm:p-3">
          <div className="grid grid-cols-7 gap-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="px-1 pb-1 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {d}
              </div>
            ))}
            {cells.map((date, i) => (
              <div
                key={i}
                className={cn(
                  "relative min-h-24 rounded-lg border p-1.5",
                  date ? "bg-card" : "border-transparent bg-muted/30",
                  date === today && "border-primary ring-1 ring-primary/40"
                )}
              >
                {date ? (
                  <>
                    {/* the whole cell opens the day — a SIBLING button under
                        the chips, so the links/buttons above it keep working
                        (no nested interactive elements) */}
                    <Hint
                      label={`${dayLabel(date)} — see everything on this day${
                        booking && date >= today ? " or book a touch point on it" : ""
                      }`}
                    >
                      <button
                        type="button"
                        aria-label={`Open ${dayLabel(date)}`}
                        onClick={() => setDay(date)}
                        className="absolute inset-0 z-0 rounded-lg transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
                      />
                    </Hint>
                    <p className={cn(
                      // above the overlay to stay readable, transparent to
                      // clicks so the day number opens the day too
                      "pointer-events-none relative z-10 mb-1 text-right text-xs font-semibold",
                      date === today ? "text-primary" : "text-muted-foreground"
                    )}>
                      {Number(date.slice(8))}
                    </p>
                    <div className="relative z-10 space-y-1">
                      {(tpByDate.get(date) ?? []).map((t) => {
                        const editable = t.canEdit && !t.cancelled;
                        const cls = cn(
                          "block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-semibold text-white",
                          t.cancelled ? "bg-muted-foreground/50 line-through" : "bg-[#8E44AD]",
                          editable && "transition-transform hover:-translate-y-px hover:shadow-sm"
                        );
                        const body = `${t.time} ${t.label}`;
                        return (
                          <Hint
                            key={t.id}
                            label={`${t.label} · ${t.time} — ${t.audience}${t.note ? ` · ${t.note}` : ""}${
                              t.cancelled ? " (cancelled)" : editable ? " · click to move or cancel" : ""
                            }`}
                          >
                            {editable ? (
                              <button type="button" className={cls} dir="auto" onClick={() => setManage(t)}>
                                {body}
                              </button>
                            ) : (
                              <p className={cls} dir="auto">{body}</p>
                            )}
                          </Hint>
                        );
                      })}
                      {(irByDate.get(date) ?? []).map((c) => (
                        <Hint key={c.id} label={`IR call · ${c.partnerLc} · ${c.memberName}`}>
                          <p
                            className={cn(
                              "truncate rounded px-1.5 py-0.5 text-[11px] font-semibold text-white",
                              c.status === "cancelled"
                                ? "bg-muted-foreground/50 line-through"
                                : "bg-[#0CB9C1]"
                            )}
                            dir="auto"
                          >
                            {c.time} 🌍 {c.partnerLc}
                          </p>
                        </Hint>
                      ))}
                      {(itemsByDate.get(date) ?? []).map((it) => (
                        <Hint
                          key={it.id}
                          label={`${it.title} · ${it.time}${it.endTime ? ` → ${it.endTime}` : ""} — added by ${it.ownerName}${it.note ? ` · ${it.note}` : ""}`}
                        >
                          <p
                            className="truncate rounded bg-[#27AE60] px-1.5 py-0.5 text-[11px] font-semibold text-white"
                            dir="auto"
                          >
                            {it.time} 📌 {it.title}
                          </p>
                        </Hint>
                      ))}
                      {(byDate.get(date) ?? []).map((v) => chip(v))}
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* agenda list (phones) */}
      <div className="space-y-2 rise-in rise-in-2 sm:hidden">
        {[...new Set([
          ...tpByDate.keys(), ...irByDate.keys(), ...byDate.keys(), ...itemsByDate.keys(),
        ])]
          .sort()
          .map((date) => {
            const list = byDate.get(date) ?? [];
            return (
          <Card key={date} className={cn(date === today && "border-primary")}>
            <CardContent className="space-y-1.5 p-3">
              {/* the heading opens the same day panel the grid opens */}
              <button
                type="button"
                onClick={() => setDay(date)}
                className="flex w-full items-center justify-between gap-2 text-start"
              >
                <span className={cn("min-w-0 flex-1 text-sm font-bold", date === today && "text-primary")}>
                  {new Date(`${date}T00:00:00`).toLocaleDateString("en", {
                    weekday: "long", day: "numeric", month: "short",
                  })}
                  {date === today ? " · Today" : ""}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              {(tpByDate.get(date) ?? []).map((t) => (
                <div key={t.id} className="min-w-0 rounded-lg border p-2">
                  <p className="break-words text-sm font-semibold" dir="auto">
                    {t.time} · {t.label}
                    {t.cancelled ? " · cancelled" : ""}
                  </p>
                  <p className="break-words text-xs text-muted-foreground" dir="auto">
                    {t.audience} · booked by {bookedBy(t)}
                  </p>
                  {t.note ? (
                    <p className="mt-0.5 break-words text-xs text-muted-foreground" dir="auto">{t.note}</p>
                  ) : null}
                  {t.canEdit && !t.cancelled ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1.5 h-8"
                      onClick={() => setManage(t)}
                    >
                      <Pencil className="size-3.5" /> Move or cancel
                    </Button>
                  ) : null}
                </div>
              ))}
              {(irByDate.get(date) ?? []).map((c) => (
                <div key={c.id} className="min-w-0 rounded-lg border p-2">
                  <p className="break-words text-sm font-semibold" dir="auto">
                    {c.time} · 🌍 IR call — {c.partnerLc}
                  </p>
                  <p className="break-words text-xs text-muted-foreground" dir="auto">{c.memberName}</p>
                </div>
              ))}
              {(itemsByDate.get(date) ?? []).map((it) => (
                <div key={it.id} className="min-w-0 rounded-lg border border-[#27AE60]/40 p-2">
                  <p className="break-words text-sm font-semibold" dir="auto">
                    {it.time}{it.endTime ? ` → ${it.endTime}` : ""} · 📌 {it.title}
                  </p>
                  <p className="break-words text-xs text-muted-foreground" dir="auto">
                    added by {it.ownerName}
                    {it.assigneeNames.length > 0 ? ` · for ${it.assigneeNames.join(", ")}` : ""}
                  </p>
                  {it.note ? (
                    <p className="mt-0.5 break-words text-xs text-muted-foreground" dir="auto">{it.note}</p>
                  ) : null}
                </div>
              ))}
              {list.map((v) => chip(v, true))}
              {booking && date >= today ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 h-8 w-full"
                  onClick={() => bookOn(date)}
                >
                  <CalendarPlus className="size-3.5" /> Book on this day
                </Button>
              ) : null}
            </CardContent>
          </Card>
            );
          })}
        {byDate.size + tpByDate.size + irByDate.size + itemsByDate.size === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing {scopeMeta.empty}booked in {monthLabel(month)} yet.
          </p>
        ) : null}
      </div>

      {shownVisits.length + shownTps.length + shownIr.length + shownItems.length === 0 ? (
        <p className="hidden py-6 text-center text-sm text-muted-foreground sm:block">
          Nothing {scopeMeta.empty}booked in {monthLabel(month)} yet —
          visits come from account pages{booking ? ", touch points from any day you click" : ""}. 🗓️
        </p>
      ) : null}

      {/* THE DAY PANEL (v29.4): everything on one Cairo day, plus the way to
          book a touch point straight onto it */}
      {day ? (
      <Dialog open onOpenChange={(v) => !v && setDay(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dayLabel(day)}
              {day === today ? " · Today" : ""}
            </DialogTitle>
            <DialogDescription>
              {dayCount === 0
                ? "Nothing booked on this day yet."
                : `${dayCount} thing${dayCount === 1 ? "" : "s"} on this day — Cairo time.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {dayTps.map((t) => (
              <div key={t.id} className="min-w-0 rounded-lg border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="shrink-0 rounded-full bg-[#8E44AD]/15 px-2 py-0.5 text-xs font-bold text-[#8E44AD]">
                    {t.time}
                  </span>
                  <p
                    className={cn(
                      "min-w-0 flex-1 break-words text-sm font-semibold",
                      t.cancelled && "text-muted-foreground line-through"
                    )}
                    dir="auto"
                  >
                    {t.label}
                  </p>
                </div>
                <p className="mt-1 break-words text-xs text-muted-foreground" dir="auto">
                  {t.audience} · booked by {bookedBy(t)}
                  {t.cancelled
                    ? " · cancelled"
                    : t.recorded
                      ? " · attendance taken"
                      : ""}
                </p>
                {t.note ? (
                  <p className="mt-0.5 break-words text-xs text-muted-foreground" dir="auto">
                    {t.note}
                  </p>
                ) : null}
                {t.canEdit && !t.cancelled ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-8"
                    onClick={() => {
                      setDay(null);
                      setManage(t);
                    }}
                  >
                    <Pencil className="size-3.5" /> Move or cancel
                  </Button>
                ) : null}
              </div>
            ))}

            {dayIr.map((c) => (
              <div key={c.id} className="min-w-0 rounded-lg border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="shrink-0 rounded-full bg-[#0CB9C1]/15 px-2 py-0.5 text-xs font-bold text-[#0CB9C1]">
                    {c.time}
                  </span>
                  <p
                    className={cn(
                      "min-w-0 flex-1 break-words text-sm font-semibold",
                      c.status === "cancelled" && "text-muted-foreground line-through"
                    )}
                    dir="auto"
                  >
                    🌍 {c.partnerLc}
                  </p>
                </div>
                <p className="mt-1 break-words text-xs text-muted-foreground" dir="auto">
                  IR call · {c.memberName}
                  {c.status === "cancelled" ? " · cancelled" : ""}
                </p>
              </div>
            ))}

            {dayItems.map((it) => (
              <div key={it.id} className="min-w-0 rounded-lg border border-[#27AE60]/40 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="shrink-0 rounded-full bg-[#27AE60]/15 px-2 py-0.5 text-xs font-bold text-[#27AE60]">
                    {it.time}{it.endTime ? ` → ${it.endTime}` : ""}
                  </span>
                  <p className="min-w-0 flex-1 break-words text-sm font-semibold" dir="auto">
                    📌 {it.title}
                  </p>
                  {it.canDelete ? (
                    <Hint label="Remove this item (assignees get told)">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={deletePending}
                        onClick={() => removeItem(it)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </Hint>
                  ) : null}
                </div>
                <p className="mt-1 break-words text-xs text-muted-foreground" dir="auto">
                  added by {it.ownerName}
                  {it.assigneeNames.length > 0 ? ` · for ${it.assigneeNames.join(", ")}` : " · personal"}
                </p>
                {it.note ? (
                  <p className="mt-0.5 break-words text-xs text-muted-foreground" dir="auto">
                    {it.note}
                  </p>
                ) : null}
              </div>
            ))}

            {dayVisits.map((v) => {
              const color = colorOf.get(v.member.id) ?? "#037EF3";
              const who = v.member.name;
              const openable =
                openableMemberIds === null || openableMemberIds.includes(v.member.id);
              const body = (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
                      style={{ backgroundColor: `${color}1a`, color }}
                    >
                      {fmtClock12(v.visit_time)}
                    </span>
                    <p className="min-w-0 flex-1 break-words text-sm font-semibold" dir="auto">
                      {v.account.name}
                    </p>
                  </div>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    Visit · {who}
                    {showFunction ? ` · ${v.account.function}` : ""} ·{" "}
                    {v.done === null
                      ? "pending report"
                      : v.done
                        ? "done ✅"
                        : "not completed ❌"}
                  </p>
                </>
              );
              return openable ? (
                <Link
                  key={v.id}
                  href={`/accounts/${v.account.id}`}
                  className="block min-w-0 rounded-lg border p-2.5 transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  {body}
                </Link>
              ) : (
                <div key={v.id} className="min-w-0 rounded-lg border p-2.5">
                  {body}
                </div>
              );
            })}

            {dayCount === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                A clean day. 🌤️
              </p>
            ) : null}
          </div>

          {booking || canAddItems ? (
            <DialogFooter className="gap-2 sm:justify-end">
              {day >= today ? (
                <>
                  {canAddItems ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setItemDate(day);
                        setItemOpen(true);
                        setDay(null);
                      }}
                    >
                      <CalendarPlus className="size-4" /> Add item
                    </Button>
                  ) : null}
                  {booking ? (
                    <Button onClick={() => bookOn(day)}>
                      <CalendarPlus className="size-4" /> Book a touch point on this day
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Bookings go ahead — pick today or a later day.
                </p>
              )}
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
      ) : null}

      {/* the SAME booking dialog as the header's, driven by the day panel —
          re-keyed so a new day re-seeds its Date field */}
      {booking ? (
        <TouchPointDialog
          key={bookDate ?? "no-day"}
          {...booking}
          defaultDate={bookDate ?? undefined}
          open={bookOpen}
          onOpenChange={setBookOpen}
        />
      ) : null}

      {/* the day-panel-driven Add-item dialog, re-keyed so a new day re-seeds
          its Date field */}
      {canAddItems ? (
        <CalendarItemDialog
          key={itemDate ?? "no-day"}
          assignables={assignables}
          viewerId={viewerId}
          defaultDate={itemDate ?? undefined}
          open={itemOpen}
          onOpenChange={setItemOpen}
        />
      ) : null}

      {manage ? (
        <TouchPointManageDialog tp={manage} onClose={() => setManage(null)} />
      ) : null}
    </div>
  );
}
