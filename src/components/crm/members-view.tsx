"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Loader2, Mail, Phone, Search, UsersRound, X } from "lucide-react";
import type { MemberDirectoryEntry } from "@/server/data";
import { FUNCTION_COLORS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ColumnFilter, multi,
  resizableCellStyle, ResizableHead, SortHeader, TableSettings, useTableColumns, useTableSort, type SortDir, type TableColumn,
} from "./data-table-kit";
import { Hint } from "./hint";
import { WhatsAppIcon } from "./icons";

/** v21 — each function has its own MOS, so the KPI set adapts per member:
 *  raising (ICX raising / B2B) → the funnel with OPENS as MOS ·
 *  BD → the funnel + MONEY (EGP) as MOS ·
 *  consideration & OGX → APPROVALS (their filed plan — actuals come with the
 *  consideration module) · others (TM/F&L/…) → no numbers yet. */
function mosMetrics(
  m: MemberDirectoryEntry,
  side: MemberDirectoryEntry["mos"] = m.mos
): { label: string; value: string }[] {
  const k = m.kpis;
  const funnel = [
    { label: "MR", value: String(k.mr) },
    { label: "Cont.", value: String(k.contacted) },
    { label: "Vis.", value: String(k.visits) },
    { label: "Done", value: String(k.visitsDone) },
    { label: "Deals", value: String(k.deals) },
  ];
  if (side === "raising") return [...funnel, { label: "Opens ★", value: String(k.slots) }];
  if (side === "b2c") {
    // B2C's MOS = deals signed — the funnel already ends in Deals, star it
    const b2cFunnel = funnel.map((f) =>
      f.label === "Deals" ? { ...f, label: "Deals ★" } : f
    );
    return b2cFunnel;
  }
  if (side === "bd")
    return [...funnel, { label: "Opens", value: String(k.slots) },
      { label: "EGP ★", value: k.egp.toLocaleString("en") }];
  if (side === "ogx")
    // v29: the OGX row IS the dashboard funnel — Sign-ups → Contacted →
    // Interested → Applied → Accepted → Approved (the MOS), all live numbers
    return [
      { label: "SUs", value: String(k.signupTotal) },
      { label: "Cont.", value: String(k.signupContacted) },
      { label: "Int.", value: String(k.signupInterested) },
      { label: "Appl.", value: String(k.signupApplied) },
      { label: "Acc.", value: String(k.signupAccepted) },
      { label: "Approvals ★", value: String(k.signupApprovals) },
    ];
  if (side === "consideration")
    return [
      { label: "APL (plan)", value: String(k.planApplicants) },
      { label: "ACC (plan)", value: String(k.planAccepted) },
      { label: "APD ★ (plan)", value: String(k.planApprovals) },
    ];
  return [];
}

/** v29 — "MMs" is one filter for both middle-management roles (Team Leaders
 *  and Coordinators); the individual roles stay in the list. */
const MM_FILTER = "__mm";
const MM_ROLES = ["Team Leader", "Coordinator"];

/** Short name for a side, shown only when a member has more than one. */
const SIDE_LABEL: Record<string, string> = {
  raising: "Raising",
  consideration: "Consid.",
  bd: "BD",
  b2c: "B2C",
  ogx: "OGX",
};

const MOS_TAG: Record<MemberDirectoryEntry["mos"], string | null> = {
  raising: "MOS: Opens",
  bd: "MOS: Money (EGP)",
  b2c: "MOS: Deals",
  consideration: "MOS: Approvals",
  ogx: "MOS: Approvals",
  other: null,
};

// click-to-sort accessors (v24.3): text columns sort asc by default, the
// MOS column sorts by each member's own star metric (desc by default) —
// opens / EGP / deals / plan approvals depending on their MOS family
const DIRECTORY_SORTERS: Record<string, (m: MemberDirectoryEntry) => string | number | null> = {
  member: (m) => m.name,
  role: (m) => m.role,
  functions: (m) => (m.functions.length ? m.functions.join(", ") : null),
  team: (m) => m.team_name,
  manager: (m) => m.manager,
  mos: (m) =>
    m.mos === "raising" ? m.kpis.slots
    : m.mos === "bd" ? m.kpis.egp
    : m.mos === "b2c" ? m.kpis.deals
    : m.mos === "ogx" ? m.kpis.signupApprovals
    : m.mos === "consideration" ? m.kpis.planApprovals
    : null,
  email: (m) => m.email,
  phone: (m) => m.phone,
  sub_functions: (m) => (m.sub_functions.length ? m.sub_functions.join(", ") : null),
  mr: (m) => m.kpis.mr,
  deals: (m) => m.kpis.deals,
};

/** Every column the directory CAN show — ⚙ Columns picks the order + which. */
const DIRECTORY_COLUMNS: TableColumn[] = [
  { key: "member", label: "Member", required: true },
  { key: "role", label: "Role" },
  { key: "functions", label: "Functions" },
  { key: "team", label: "Team" },
  { key: "manager", label: "Manager" },
  { key: "mos", label: "MOS / KPIs" },
  { key: "contact", label: "Contact" },
  { key: "sub_functions", label: "Sub functions", defaultHidden: true },
  { key: "email", label: "Email", defaultHidden: true },
  { key: "phone", label: "Phone", defaultHidden: true },
  { key: "mr", label: "Market research", defaultHidden: true },
  { key: "deals", label: "Deals", defaultHidden: true },
];

const DIRECTORY_CELL_CLASS: Record<string, string> = {
  team: "text-sm text-muted-foreground",
  manager: "text-sm text-muted-foreground",
  sub_functions: "max-w-40 truncate text-sm text-muted-foreground",
  email: "max-w-48 truncate text-sm text-muted-foreground",
  phone: "whitespace-nowrap text-sm text-muted-foreground",
  mr: "text-sm tabular-nums",
  deals: "text-sm tabular-nums",
};

/** Columns whose header sorts descending on the first click (numbers). */
const DIRECTORY_DESC_FIRST = new Set(["mos", "mr", "deals"]);

/** email / call / WhatsApp shortcuts for one member. */
function ContactButtons({ m }: { m: MemberDirectoryEntry }) {
  const wa = m.phone?.replace(/\D/g, "") ?? "";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const btn =
    "inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-primary hover:text-primary sm:size-7";
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <Hint label={`Email ${m.name}`}>
        <a className={btn} href={`mailto:${m.email}`} onClick={stop} aria-label="Email">
          <Mail className="size-3.5" />
        </a>
      </Hint>
      {m.phone ? (
        <>
          <Hint label={`Call ${m.phone}`}>
            <a className={btn} href={`tel:${m.phone}`} onClick={stop} aria-label="Call">
              <Phone className="size-3.5" />
            </a>
          </Hint>
          <Hint label="WhatsApp">
            <a
              className={btn}
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noreferrer"
              onClick={stop}
              aria-label="WhatsApp"
            >
              <WhatsAppIcon className="size-3.5" />
            </a>
          </Hint>
        </>
      ) : null}
    </span>
  );
}

function FnChips({ functions }: { functions: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {functions.map((f) => {
        const c = FUNCTION_COLORS[f];
        return (
          <Badge
            key={f}
            className={cn(
              "border-transparent text-[10px] font-bold",
              c ? `${c.bg} ${c.text}` : "bg-muted text-muted-foreground"
            )}
          >
            {f}
          </Badge>
        );
      })}
    </span>
  );
}

/** A named date range, computed server-side on the Cairo calendar. */
export interface DirectoryRange {
  from: string;
  to: string;
  label: string;
}

export function MembersView({
  members, filters, ranges,
}: {
  members: MemberDirectoryEntry[];
  /** the ACTIVE window, already clamped by the server */
  filters: { from: string; to: string };
  ranges: { month: DirectoryRange; sprint: DirectoryRange; today: string };
}) {
  const [q, setQ] = useState("");
  /** EVERY FILTER LIVES ON ITS COLUMN (v33.36.2) — the house rule the rest of
   *  the app already follows: if an attribute IS a column, you narrow it from
   *  the column's own funnel, not from a bar above the table. Multi-select
   *  throughout (a comma list means "any of these"), so "show me the TLs and
   *  Coordinators of IGV and IGT" is four taps and no dropdown gymnastics.
   *  Kept in memory — the directory is one page, no round-trip needed. */
  const [colFilter, setColFilter] = useState<Record<string, string>>({});
  const setCol = (k: string) => (v: string) =>
    setColFilter((f) => ({ ...f, [k]: v }));

  // the date window lives in the URL (?from/&to) — it's a SERVER filter: the
  // KPIs themselves are recounted, so it can't be done in the browser
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  const go = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      startNav(() => {
        router.replace(params.size > 0 ? `/members?${params.toString()}` : "/members");
      });
    },
    [router, searchParams]
  );
  const setParam = useCallback(
    (key: string, value: string) => go((p) => (value ? p.set(key, value) : p.delete(key))),
    [go]
  );
  const setRange = (r: DirectoryRange, active: boolean) =>
    go((p) => {
      if (active) { p.delete("from"); p.delete("to"); }
      else { p.set("from", r.from); p.set("to", r.to); }
    });
  const monthActive =
    filters.from === ranges.month.from && filters.to === ranges.month.to;
  const sprintActive =
    filters.from === ranges.sprint.from && filters.to === ranges.sprint.to;
  const dateActive = !!(filters.from || filters.to);
  const windowLabel = !dateActive
    ? "KPIs count everything, all time"
    : monthActive
      ? `KPIs count ${ranges.month.label}`
      : sprintActive
        ? `KPIs count ${ranges.sprint.label}`
        : filters.from && filters.to
          ? `KPIs count work done ${filters.from} → ${filters.to}`
          : filters.from
            ? `KPIs count work done from ${filters.from} onwards`
            : `KPIs count work done up to ${filters.to}`;

  const fns = useMemo(
    () => [...new Set(members.flatMap((m) => m.functions))].sort(),
    [members]
  );
  const roles = useMemo(
    () => [...new Set(members.map((m) => m.role))],
    [members]
  );
  const sides = useMemo(
    () => [...new Set(members.flatMap((m) => m.sub_functions))].filter(Boolean).sort(),
    [members]
  );
  const teams = useMemo(
    () => [...new Set(members.map((m) => m.team_name).filter(Boolean) as string[])].sort(),
    [members]
  );
  const managers = useMemo(
    () => [...new Set(members.map((m) => m.manager).filter(Boolean) as string[])].sort(),
    [members]
  );
  /** What each person is MEASURED on — a real question a TM lead asks
   *  ("show me everyone whose MOS is opens"). */
  const MOS_LABEL: Record<string, string> = {
    raising: "Opens (raising)",
    bd: "Money (BD)",
    b2c: "Deals (B2C)",
    ogx: "Approvals (OGX)",
    consideration: "Approvals (consideration)",
    none: "No tracked MOS",
  };
  const mosOptions = useMemo(
    () =>
      [...new Set(members.map((m) => m.mos || "none"))]
        .sort()
        .map((v) => ({ value: v, label: MOS_LABEL[v] ?? v })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members]
  );

  /** No picks = no filter; several picks = match ANY of them. */
  const anyOf = (raw: string | undefined, pred: (v: string) => boolean) => {
    const picks = multi(raw);
    return picks.length === 0 || picks.some(pred);
  };

  const filtered = members.filter((m) => {
    const needle = q.trim().toLowerCase();
    if (
      needle &&
      ![m.name, "", m.email, m.team_name ?? ""].some((s) =>
        s.toLowerCase().includes(needle)
      )
    )
      return false;
    if (!anyOf(colFilter.fn, (v) => m.functions.includes(v) || m.sub_functions.includes(v)))
      return false;
    // someone who is Raising AND Consideration matches EITHER filter — they
    // really do both, so hiding them from one of the two lists would be a lie
    if (!anyOf(colFilter.sub, (v) => m.sub_functions.includes(v))) return false;
    if (!anyOf(colFilter.role, (v) => (v === MM_FILTER ? MM_ROLES.includes(m.role) : m.role === v)))
      return false;
    if (!anyOf(colFilter.team, (v) => (m.team_name ?? "") === v)) return false;
    if (!anyOf(colFilter.manager, (v) => (m.manager ?? "") === v)) return false;
    if (!anyOf(colFilter.mos, (v) => (m.mos || "none") === v)) return false;
    if (!anyOf(colFilter.email, (v) => (v === "has" ? !!m.email : !m.email))) return false;
    if (!anyOf(colFilter.phone, (v) => (v === "has" ? !!m.phone : !m.phone))) return false;
    if (!anyOf(colFilter.mr, (v) => (v === "any" ? m.kpis.mr > 0 : m.kpis.mr === 0))) return false;
    if (!anyOf(colFilter.deals, (v) => (v === "any" ? m.kpis.deals > 0 : m.kpis.deals === 0)))
      return false;
    return true;
  });

  // click a header to sort the filtered list; mobile cards follow the order
  const { sorted, sortKey, dir, toggle } = useTableSort(filtered, DIRECTORY_SORTERS);
  /** Which columns carry a funnel, and what each one offers. Built from the
   *  DATA in front of you — a filter can never offer a value nobody has. */
  const COL_FILTERS: Record<
    string,
    { key: string; label: string; options: { value: string; label: string }[] }
  > = {
    role: {
      key: "role", label: "Role",
      options: [
        ...(roles.some((r) => MM_ROLES.includes(r))
          ? [{ value: MM_FILTER, label: "MMs (TLs & Coordinators)" }]
          : []),
        ...roles.map((r) => ({ value: r, label: r })),
      ],
    },
    functions: { key: "fn", label: "Function", options: fns.map((f) => ({ value: f, label: f })) },
    sub_functions: {
      key: "sub", label: "Sub function / side",
      options: sides.map((sf) => ({ value: sf, label: sf })),
    },
    team: { key: "team", label: "Team", options: teams.map((t) => ({ value: t, label: t })) },
    manager: {
      key: "manager", label: "Manager",
      options: managers.map((t) => ({ value: t, label: t })),
    },
    mos: { key: "mos", label: "MOS", options: mosOptions },
    email: {
      key: "email", label: "Email",
      options: [
        { value: "has", label: "Has an email" },
        { value: "missing", label: "No email yet" },
      ],
    },
    phone: {
      key: "phone", label: "Phone",
      options: [
        { value: "has", label: "Has a phone" },
        { value: "missing", label: "No phone" },
      ],
    },
    mr: {
      key: "mr", label: "Market research",
      options: [
        { value: "any", label: "Has research" },
        { value: "none", label: "None yet" },
      ],
    },
    deals: {
      key: "deals", label: "Deals",
      options: [
        { value: "any", label: "Has deals" },
        { value: "none", label: "None yet" },
      ],
    },
  };
  /** the funnel for a column, or nothing when it isn't filterable */
  const colFunnel = (colKey: string) => {
    const f = COL_FILTERS[colKey];
    if (!f || f.options.length === 0) return null;
    return (
      <ColumnFilter
        label={f.label}
        value={colFilter[f.key] ?? ""}
        options={f.options}
        onChange={setCol(f.key)}
        allLabel={`All ${f.label.toLowerCase()}`}
      />
    );
  };
  const anyColFilter = Object.values(colFilter).some(Boolean);

  const SortHead = ({
    field, defaultDir = "asc", children, className,
  }: {
    field: string;
    defaultDir?: SortDir;
    children: React.ReactNode;
    className?: string;
  }) => (
    <TableHead className={className}>
      <div className="flex items-center gap-1">
        <SortHeader
          label={children}
          onClick={() => toggle(field, defaultDir)}
          active={sortKey === field}
          dir={dir}
        />
        {colFunnel(field)}
      </div>
    </TableHead>
  );

  // ⚙ Columns — order + visibility, kept in this browser
  const cols = useTableColumns("members-directory", DIRECTORY_COLUMNS);

  /** One directory cell, by column key. */
  const memberCell = (m: MemberDirectoryEntry, key: string): React.ReactNode => {
    switch (key) {
      case "member":
        return (
          <>
            <p className="font-medium" dir="auto">{m.name}</p>
            {cols.isVisible("email") ? null : (
              <p className="text-xs text-muted-foreground">{m.email}</p>
            )}
          </>
        );
      case "role":
        return <Badge variant="outline">{m.role}</Badge>;
      case "functions":
        return <FnChips functions={m.functions} />;
      case "sub_functions":
        return m.sub_functions.length ? m.sub_functions.join(", ") : "—";
      case "team":
        return m.team_name ?? "—";
      case "manager":
        return m.manager ?? "—";
      case "mos": {
        // one row PER SIDE (v33.6). An ICX MM who is "Raising, Consideration"
        // does two jobs; showing one set of numbers hid half of what they are
        // reviewed on. Labelled only when there is more than one, so the
        // single-side rows read exactly as before.
        const sides = (m.mosAll?.length ? m.mosAll : [m.mos]).filter(
          (side) => mosMetrics(m, side).length > 0
        );
        if (sides.length === 0)
          return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="space-y-1">
            {sides.map((side) => (
              <div key={side} className="flex max-w-md flex-wrap items-baseline gap-x-3 gap-y-0.5">
                {sides.length > 1 ? (
                  <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {SIDE_LABEL[side] ?? side}
                  </span>
                ) : null}
                {mosMetrics(m, side).map((c) => (
                  <span key={c.label} className="whitespace-nowrap text-xs text-muted-foreground">
                    {c.label} <b className="text-sm text-foreground">{c.value}</b>
                  </span>
                ))}
              </div>
            ))}
          </div>
        );
      }
      case "contact":
        return <ContactButtons m={m} />;
      case "email":
        return m.email;
      case "phone":
        return m.phone ?? "—";
      case "mr":
        return m.kpis.mr;
      case "deals":
        return m.kpis.deals;
      default:
        return null;
    }
  };

  return (
    <div className={cn("mx-auto max-w-6xl space-y-4", navPending && "nav-pending")}>
      <div className="rise-in">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <UsersRound className="size-6 text-primary" /> Members
          {navPending ? <Loader2 className="size-4 animate-spin text-primary" /> : null}
        </h1>
        <p className="text-sm text-muted-foreground">
          The whole LC in one view — info, MOS/KPIs and a direct line to everyone.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Only the people whose performance is reviewed here are listed — Members,
          Coordinators and Team Leaders. The LCP, every LCVP and Director,
          CXP&apos;s MMs and TM&apos;s own MMs are left out.
        </p>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2 rise-in rise-in-1">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, team…"
            className="h-9 w-56 pl-8"
          />
        </div>
        {/* phones have no table header to hang the funnels off (v33.36.2) */}
        <div className="flex flex-wrap items-center gap-2 md:hidden">
          {(["role", "functions", "sub_functions", "team", "manager", "mos"] as const).map((k) => {
            const f = COL_FILTERS[k];
            if (!f || f.options.length === 0) return null;
            return (
              <span key={k} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {f.label}
                {colFunnel(k)}
              </span>
            );
          })}
        </div>
        <span className="text-sm text-muted-foreground">
          {filtered.length} member{filtered.length === 1 ? "" : "s"}
        </span>
        {anyColFilter || q ? (
          <Button variant="ghost" size="sm" onClick={() => { setColFilter({}); setQ(""); }}>
            <X className="size-4" /> Clear filters
          </Button>
        ) : null}
        {/* ⚙ Columns — the directory is a table like any other now */}
        <TableSettings columns={cols} className="ml-auto hidden md:inline-flex" />
      </div>

      {/* the DATE window — every KPI/MOS number below is recounted for it */}
      <div className="flex flex-wrap items-center gap-2 rise-in rise-in-1">
        <Hint label={`Count only this calendar month's work — ${ranges.month.label}`}>
          <Button
            variant={monthActive ? "default" : "outline"}
            className="h-9"
            size="sm"
            onClick={() => setRange(ranges.month, monthActive)}
          >
            <CalendarRange className="size-4" /> This month
          </Button>
        </Hint>
        <Hint label={`Only this sprint's work — the current half of the month (1–15 / 16–end) · ${ranges.sprint.label}`}>
          <Button
            variant={sprintActive ? "default" : "outline"}
            className="h-9"
            size="sm"
            onClick={() => setRange(ranges.sprint, sprintActive)}
          >
            <CalendarRange className="size-4" /> This sprint
          </Button>
        </Hint>
        {/* one h-9 group so the whole bar sits on a single baseline */}
        <div className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 dark:bg-input/30">
          <span className="hidden text-xs font-medium text-muted-foreground min-[400px]:inline">
            Period
          </span>
          <Input
            type="date"
            max={ranges.today}
            className="h-7 w-[7.6rem] min-[400px]:w-[8.2rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label="Period from"
            value={filters.from}
            onChange={(e) => setParam("from", e.target.value)}
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            max={ranges.today}
            className="h-7 w-[7.6rem] min-[400px]:w-[8.2rem] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label="Period to"
            value={filters.to}
            onChange={(e) => setParam("to", e.target.value)}
          />
        </div>
        {dateActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go((p) => { p.delete("from"); p.delete("to"); })}
          >
            <X className="size-4" /> All time
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">{windowLabel}</span>
      </div>

      {/* phones: cards */}
      <div className="space-y-2 rise-in rise-in-2 md:hidden">
        {sorted.map((m) => (
          <Card key={m.id} className="card-lift">
            <CardContent className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {m.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">{m.role}</Badge>
                    <FnChips functions={m.functions} />
                  </div>
                </div>
                <ContactButtons m={m} />
              </div>
              <p className="text-xs text-muted-foreground">
                {m.team_name ? `${m.team_name} · ` : ""}
                {m.manager ? `Manager: ${m.manager}` : "—"}
              </p>
              {mosMetrics(m).length > 0 ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-muted/50 p-2">
                  {MOS_TAG[m.mos] ? (
                    <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {MOS_TAG[m.mos]}
                    </span>
                  ) : null}
                  {mosMetrics(m).map((c) => (
                    <div key={c.label} className="text-center">
                      <p className="text-sm font-bold">{c.value}</p>
                      <p className="text-[10px] text-muted-foreground">{c.label}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
                  No tracked numbers yet — their module is coming.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No members match.</p>
        ) : null}
      </div>

      {/* desktop: table */}
      <Card className="hidden rise-in rise-in-2 md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {cols.visible.map((c) =>
                  c.key === "contact" ? (
                    <ResizableHead key={c.key} colKey={c.key} cols={cols}>
                      {c.label}
                    </ResizableHead>
                  ) : (
                    <SortHead
                      key={c.key}
                      field={c.key}
                      defaultDir={DIRECTORY_DESC_FIRST.has(c.key) ? "desc" : "asc"}
                    >
                      {c.label}
                    </SortHead>
                  )
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((m) => (
                <TableRow key={m.id}>
                  {cols.visible.map((c) => {
                    const rz = resizableCellStyle(cols, c.key);
                    return (
                    <TableCell
                      key={c.key}
                      className={cn(DIRECTORY_CELL_CLASS[c.key], rz.className)}
                      style={rz.style}
                    >
                      {memberCell(m, c.key)}
                    </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={cols.visible.length}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No members match.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
