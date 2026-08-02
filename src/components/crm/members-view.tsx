"use client";

import { useMemo, useState } from "react";
import { Mail, Phone, Search, UsersRound } from "lucide-react";
import type { MemberDirectoryEntry } from "@/server/data";
import { FUNCTION_COLORS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Hint } from "./hint";
import { WhatsAppIcon } from "./icons";
import { SortHeader, useTableSort, type SortDir } from "./sort-header";

/** v21 — each function has its own MOS, so the KPI set adapts per member:
 *  raising (ICX raising / B2B) → the funnel with OPENS as MOS ·
 *  BD → the funnel + MONEY (EGP) as MOS ·
 *  consideration & OGX → APPROVALS (their filed plan — actuals come with the
 *  consideration module) · others (TM/F&L/…) → no numbers yet. */
function mosMetrics(m: MemberDirectoryEntry): { label: string; value: string }[] {
  const k = m.kpis;
  const funnel = [
    { label: "MR", value: String(k.mr) },
    { label: "Cont.", value: String(k.contacted) },
    { label: "Vis.", value: String(k.visits) },
    { label: "Done", value: String(k.visitsDone) },
    { label: "Deals", value: String(k.deals) },
  ];
  if (m.mos === "raising") return [...funnel, { label: "Opens ★", value: String(k.slots) }];
  if (m.mos === "b2c") {
    // B2C's MOS = deals signed — the funnel already ends in Deals, star it
    const b2cFunnel = funnel.map((f) =>
      f.label === "Deals" ? { ...f, label: "Deals ★" } : f
    );
    return b2cFunnel;
  }
  if (m.mos === "bd")
    return [...funnel, { label: "Opens", value: String(k.slots) },
      { label: "EGP ★", value: k.egp.toLocaleString("en") }];
  if (m.mos === "ogx")
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
  if (m.mos === "consideration")
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
  member: (m) => m.nickname || m.name,
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
};

/** email / call / WhatsApp shortcuts for one member. */
function ContactButtons({ m }: { m: MemberDirectoryEntry }) {
  const wa = m.phone?.replace(/\D/g, "") ?? "";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const btn =
    "inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-primary hover:text-primary sm:size-7";
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <Hint label={`Email ${m.nickname || m.name}`}>
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

export function MembersView({ members }: { members: MemberDirectoryEntry[] }) {
  const [q, setQ] = useState("");
  const [fn, setFn] = useState("");
  const [role, setRole] = useState("");

  const fns = useMemo(
    () => [...new Set(members.flatMap((m) => m.functions))].sort(),
    [members]
  );
  const roles = useMemo(
    () => [...new Set(members.map((m) => m.role))],
    [members]
  );

  const filtered = members.filter((m) => {
    const needle = q.trim().toLowerCase();
    if (
      needle &&
      ![m.name, m.nickname ?? "", m.email, m.team_name ?? ""].some((s) =>
        s.toLowerCase().includes(needle)
      )
    )
      return false;
    if (fn && !m.functions.includes(fn) && !m.sub_functions.includes(fn)) return false;
    if (role === MM_FILTER) {
      if (!MM_ROLES.includes(m.role)) return false;
    } else if (role && m.role !== role) return false;
    return true;
  });

  // click a header to sort the filtered list; mobile cards follow the order
  const { sorted, sortKey, dir, toggle } = useTableSort(filtered, DIRECTORY_SORTERS);
  const SortHead = ({
    field, defaultDir = "asc", children, className,
  }: {
    field: string;
    defaultDir?: SortDir;
    children: React.ReactNode;
    className?: string;
  }) => (
    <TableHead className={className}>
      <SortHeader
        label={children}
        onClick={() => toggle(field, defaultDir)}
        active={sortKey === field}
        dir={dir}
      />
    </TableHead>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="rise-in">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <UsersRound className="size-6 text-primary" /> Members
        </h1>
        <p className="text-sm text-muted-foreground">
          The whole LC in one view — info, MOS/KPIs and a direct line to everyone.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Only the people whose performance is reviewed here are listed — the
          LCP, the F&amp;L VP/Director, CXP&apos;s MMs &amp; leaders and TM&apos;s own MMs
          are left out.
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
        <Select value={fn || "__all"} onValueChange={(v) => setFn(v === "__all" ? "" : v)}>
          <SelectTrigger className="h-9 w-auto min-w-28">
            <SelectValue placeholder="Function" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Function: all</SelectItem>
            {fns.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={role || "__all"} onValueChange={(v) => setRole(v === "__all" ? "" : v)}>
          <SelectTrigger className="h-9 w-auto min-w-28">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Role: all</SelectItem>
            {roles.some((r) => MM_ROLES.includes(r)) ? (
              <SelectItem value={MM_FILTER}>MMs (Team Leaders &amp; Coordinators)</SelectItem>
            ) : null}
            {roles.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} member{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* phones: cards */}
      <div className="space-y-2 rise-in rise-in-2 md:hidden">
        {sorted.map((m) => (
          <Card key={m.id} className="card-lift">
            <CardContent className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {m.nickname || m.name}
                    {m.nickname ? (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{m.name}</span>
                    ) : null}
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
                <SortHead field="member">Member</SortHead>
                <SortHead field="role">Role</SortHead>
                <SortHead field="functions">Functions</SortHead>
                <SortHead field="team">Team</SortHead>
                <SortHead field="manager">Manager</SortHead>
                <SortHead field="mos" defaultDir="desc">MOS / KPIs</SortHead>
                <TableHead>Contact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <p className="font-medium">{m.nickname || m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline">{m.role}</Badge></TableCell>
                  <TableCell><FnChips functions={m.functions} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.team_name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.manager ?? "—"}</TableCell>
                  <TableCell>
                    {mosMetrics(m).length > 0 ? (
                      <div className="flex max-w-md flex-wrap gap-x-3 gap-y-0.5">
                        {mosMetrics(m).map((c) => (
                          <span key={c.label} className="whitespace-nowrap text-xs text-muted-foreground">
                            {c.label} <b className="text-sm text-foreground">{c.value}</b>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell><ContactButtons m={m} /></TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
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
