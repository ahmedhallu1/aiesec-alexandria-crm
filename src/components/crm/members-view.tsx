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

const KPI_COLS = [
  ["mr", "MR"],
  ["contacted", "Cont."],
  ["visits", "Vis."],
  ["visitsDone", "Done"],
  ["deals", "Deals"],
  ["slots", "Opens"],
] as const;

/** email / call / WhatsApp shortcuts for one member. */
function ContactButtons({ m }: { m: MemberDirectoryEntry }) {
  const wa = m.phone?.replace(/\D/g, "") ?? "";
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const btn =
    "inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-primary hover:text-primary sm:size-7";
  return (
    <span className="inline-flex items-center gap-1">
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
    if (role && m.role !== role) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="rise-in">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <UsersRound className="size-6 text-primary" /> Members
        </h1>
        <p className="text-sm text-muted-foreground">
          The whole LC in one view — info, MOS/KPIs and a direct line to everyone.
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
        {filtered.map((m) => (
          <Card key={m.id} className="card-lift">
            <CardContent className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
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
              <div className="grid grid-cols-6 gap-1 rounded-lg bg-muted/50 p-2 text-center">
                {KPI_COLS.map(([key, label]) => (
                  <div key={key}>
                    <p className="text-sm font-bold">{m.kpis[key]}</p>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
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
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Functions</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Manager</TableHead>
                {KPI_COLS.map(([key, label]) => (
                  <TableHead key={key} className="text-center">{label}</TableHead>
                ))}
                <TableHead>Contact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <p className="font-medium">{m.nickname || m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline">{m.role}</Badge></TableCell>
                  <TableCell><FnChips functions={m.functions} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.team_name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.manager ?? "—"}</TableCell>
                  {KPI_COLS.map(([key]) => (
                    <TableCell key={key} className="text-center text-sm font-semibold">
                      {m.kpis[key]}
                    </TableCell>
                  ))}
                  <TableCell><ContactButtons m={m} /></TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
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
