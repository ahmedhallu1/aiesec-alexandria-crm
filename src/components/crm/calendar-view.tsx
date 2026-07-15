"use client";

import Link from "next/link";
import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Hint } from "./hint";
import type { CalendarVisit } from "@/server/data";

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

export function CalendarView({
  visits, month, viewerId, openableMemberIds,
}: {
  visits: CalendarVisit[];
  month: string;
  viewerId: string;
  /** member ids whose accounts the viewer may open — null = everyone shown */
  openableMemberIds: string[] | null;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();

  const goMonth = (m: string) =>
    startNav(() => router.replace(`/calendar?m=${m}`));

  // stable member → color assignment (sorted by display name so it doesn't
  // reshuffle when visits change order)
  const legend = useMemo(() => {
    const byMember = new Map<string, { id: string; label: string; count: number }>();
    for (const v of visits) {
      const label = v.member.nickname || v.member.name;
      const cur = byMember.get(v.member.id);
      if (cur) cur.count += 1;
      else byMember.set(v.member.id, { id: v.member.id, label, count: 1 });
    }
    return [...byMember.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((m, i) => ({ ...m, color: MEMBER_COLORS[i % MEMBER_COLORS.length] }));
  }, [visits]);
  const colorOf = useMemo(
    () => new Map(legend.map((l) => [l.id, l.color])),
    [legend]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarVisit[]>();
    for (const v of visits) {
      const list = map.get(v.visit_date) ?? [];
      list.push(v);
      map.set(v.visit_date, list);
    }
    return map;
  }, [visits]);

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

  const today = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();
  const thisMonth = today.slice(0, 7);

  const chip = (v: CalendarVisit, full = false) => {
    const color = colorOf.get(v.member.id) ?? "#037EF3";
    const who = v.member.nickname || v.member.name;
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
        {v.done ? "✓ " : ""}{v.visit_time?.slice(0, 5)} {v.account.name}
        {full ? <span className="opacity-75"> · {who}</span> : null}
      </>
    );
    return (
      <Hint
        key={v.id}
        label={`${v.account.name} — ${who} · ${v.visit_time?.slice(0, 5)} · ${status}`}
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
            <CalendarDays className="size-6 text-primary" /> Visits calendar
            {navPending ? <Loader2 className="size-4 animate-spin text-primary" /> : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            Every visit of your function — one color per member. Click a visit to open its account.
          </p>
        </div>
        <div className="flex items-center gap-1">
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
        <div className="flex flex-wrap gap-1.5 rise-in rise-in-1">
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
                  "min-h-24 rounded-lg border p-1.5",
                  date ? "bg-card" : "border-transparent bg-muted/30",
                  date === today && "border-primary ring-1 ring-primary/40"
                )}
              >
                {date ? (
                  <>
                    <p className={cn(
                      "mb-1 text-right text-xs font-semibold",
                      date === today ? "text-primary" : "text-muted-foreground"
                    )}>
                      {Number(date.slice(8))}
                    </p>
                    <div className="space-y-1">
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
        {[...byDate.entries()].map(([date, list]) => (
          <Card key={date} className={cn(date === today && "border-primary")}>
            <CardContent className="space-y-1.5 p-3">
              <p className={cn("text-sm font-bold", date === today && "text-primary")}>
                {new Date(`${date}T00:00:00`).toLocaleDateString("en", {
                  weekday: "long", day: "numeric", month: "short",
                })}
                {date === today ? " · Today" : ""}
              </p>
              {list.map((v) => chip(v, true))}
            </CardContent>
          </Card>
        ))}
        {byDate.size === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No visits booked in {monthLabel(month)} yet.
          </p>
        ) : null}
      </div>

      {visits.length === 0 ? (
        <p className="hidden py-6 text-center text-sm text-muted-foreground sm:block">
          No visits booked in {monthLabel(month)} — schedule one from any account page. 🗓️
        </p>
      ) : null}
    </div>
  );
}
