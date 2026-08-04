"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Plus, RefreshCw, Search, Table2, Trash2, Users2, X } from "lucide-react";
import { toast } from "sonner";
import {
  deleteTeamEntry,
  resetMemberPassword,
  saveTeamEntry,
  runMembershipImport,
  runSheetsExport,
  upsertMember,
} from "@/server/actions";
import { normalizePhone,
  cleanPhone,
  EMAIL_RE,
  FUNCTION_COLORS,
  LC_FUNCTIONS,
  MEMBER_ROLES,
  PHONE_RE,
  SUB_FUNCTIONS,
  type MemberRole,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SortHeader, useTableSort, type SortDir } from "./sort-header";
import { ColumnFilter } from "./data-table-kit";

export interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  functions: string[];
  sub_functions: string[];
  role: string;
  stakeholder_name: string | null;
  team_name: string | null;
  is_active: boolean;
  first_login_at: string | null;
  has_password: boolean;
}

export interface TeamRegistryRow {
  id: string;
  type: string;
  function_key: string;
  name: string;
}

// click-to-sort accessors for the members table (v24.3 — universal sorting)
/** Which columns carry a filter funnel, and what it offers. */
const COL_FILTERS: Record<
  string,
  { key: string; label: string; options: () => { value: string; label: string }[] }
> = {
  role: {
    key: "role",
    label: "Role",
    options: () => MEMBER_ROLES.map((r) => ({ value: r, label: r })),
  },
  function: {
    key: "fn",
    label: "Function",
    options: () => LC_FUNCTIONS.map((f) => ({ value: f, label: f })),
  },
  sub: {
    key: "sub",
    label: "Sub function",
    options: () => SUB_FUNCTIONS.map((f) => ({ value: f, label: f })),
  },
  status: {
    key: "status",
    label: "Status",
    options: () => [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
  },
};

const MEMBER_SORTERS: Record<string, (m: MemberRow) => string | number | null> = {
  member: (m) => m.name,
  email: (m) => m.email,
  role: (m) => m.role,
  function: (m) => (m.functions.length ? m.functions.join(", ") : null),
  sub: (m) => (m.sub_functions.length ? m.sub_functions.join(", ") : null),
  manager: (m) => m.stakeholder_name,
  // rank so asc reads active → never signed in → inactive
  status: (m) => (!m.is_active ? 2 : m.first_login_at ? 0 : 1),
};

export function MembershipView({ members, teams }: { members: MemberRow[]; teams: TeamRegistryRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");

  const needle = q.trim().toLowerCase();
  // COLUMN FILTERS (v32.7) — the same rule as Raising and Sign-ups: an
  // attribute that IS a column gets its funnel next to the column name. This
  // list is in memory, so they filter locally instead of through the URL.
  const [colFilter, setColFilter] = useState<Record<string, string>>({});
  const setCol = (k: string) => (v: string) =>
    setColFilter((f) => ({ ...f, [k]: v }));
  const matchesCols = (m: MemberRow) =>
    (!colFilter.role || m.role === colFilter.role) &&
    (!colFilter.fn || (m.functions ?? []).includes(colFilter.fn)) &&
    (!colFilter.sub || (m.sub_functions ?? []).includes(colFilter.sub)) &&
    (!colFilter.status ||
      (colFilter.status === "active" ? m.is_active : !m.is_active));

  const byCols = members.filter(matchesCols);
  const shown = needle
    ? byCols.filter((m) =>
        [
          m.name,
          "",
          m.email ?? "",
          m.phone ?? "",
          m.role,
          m.team_name ?? "",
          (m.functions ?? []).join(" "),
          (m.sub_functions ?? []).join(" "),
        ].some((v) => v.toLowerCase().includes(needle))
      )
    : byCols;

  // click a header to sort the (already filtered) list; mobile cards follow
  const { sorted, sortKey, dir, toggle: toggleSort } = useTableSort(shown, MEMBER_SORTERS);
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
          onClick={() => toggleSort(field, defaultDir)}
          active={sortKey === field}
          dir={dir}
        />
        {COL_FILTERS[field] ? (
          <ColumnFilter
            label={COL_FILTERS[field].label}
            value={colFilter[COL_FILTERS[field].key] ?? ""}
            options={COL_FILTERS[field].options()}
            onChange={setCol(COL_FILTERS[field].key)}
          />
        ) : null}
      </div>
    </TableHead>
  );

  const importNow = () =>
    start(async () => {
      const res = await runMembershipImport();
      if (res.ok) {
        toast.success(`Membership synced — ${res.data?.imported ?? 0} rows imported`);
        router.refresh();
      } else toast.error(res.error);
    });

  const exportNow = () =>
    start(async () => {
      const res = await runSheetsExport();
      if (res.ok) toast.success("Sodio data exported to the Google Sheets mirrors");
      else toast.error(res.error);
    });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Membership</h1>
          <p className="text-sm text-muted-foreground">
            Edit members right here — every change is also written back to the
            <b> “CRM — Membership”</b> sheet (which still auto-syncs every 30 minutes).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportNow} disabled={pending}>
            <Table2 className="size-4" /> Export mirrors
          </Button>
          <Button variant="outline" onClick={importNow} disabled={pending}>
            <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> Sync from sheet
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add member
          </Button>
        </div>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, team, function…"
          className="h-9 pl-8"
        />
      </div>

      <TeamsCard teams={teams} />

      {/* Mobile: cards */}
      <div className="space-y-2.5 md:hidden">
        {sorted.map((m) => (
          <Card key={m.id} className={!m.is_active ? "opacity-50" : undefined}>
            <CardContent className="space-y-1.5 p-3.5" onClick={() => setEditing(m)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email ?? "no email — phone sign-in"}</p>
                </div>
                <Pencil className="size-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{m.role}</Badge>
                {m.functions.map((f) => (
                  <Badge
                    key={f}
                    className={cn(
                      "border-transparent text-[10px] font-semibold",
                      FUNCTION_COLORS[f]?.bg ?? "bg-primary/15",
                      FUNCTION_COLORS[f]?.text ?? "text-primary"
                    )}
                  >
                    {f}
                  </Badge>
                ))}
                {!m.is_active ? (
                  <Badge variant="destructive" className="text-[10px]">inactive</Badge>
                ) : m.first_login_at ? (
                  <Badge className="border-transparent bg-success/15 text-[10px] text-success">active</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">never signed in</Badge>
                )}
              </div>
              {m.stakeholder_name ? (
                <p className="text-xs text-muted-foreground">Manager: {m.stakeholder_name}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop: table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead field="member">Member</SortHead>
                  <SortHead field="email">Email</SortHead>
                  <SortHead field="role">Role</SortHead>
                  <SortHead field="function">Function</SortHead>
                  <SortHead field="sub">Sub function</SortHead>
                  <SortHead field="manager">Manager</SortHead>
                  <SortHead field="status">Status</SortHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((m) => (
                  <TableRow key={m.id} className={!m.is_active ? "opacity-50" : undefined}>
                    <TableCell className="font-medium">
                      {m.name}
                      {m.team_name ? (
                        <span className="ml-2 text-xs text-muted-foreground">{m.team_name}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.email ?? <span className="italic opacity-70">no email — phone sign-in</span>}</TableCell>
                    <TableCell><Badge variant="outline">{m.role}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {m.functions.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          m.functions.map((f) => (
                            <Badge
                              key={f}
                              className={cn(
                                "border-transparent font-semibold",
                                FUNCTION_COLORS[f]?.bg ?? "bg-primary/15",
                                FUNCTION_COLORS[f]?.text ?? "text-primary"
                              )}
                            >
                              {f}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{m.sub_functions.join(", ") || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.stakeholder_name ?? "—"}</TableCell>
                    <TableCell>
                      {!m.is_active ? (
                        <Badge variant="destructive">inactive</Badge>
                      ) : m.first_login_at ? (
                        <Badge className="border-transparent bg-success/15 text-success">active</Badge>
                      ) : (
                        <Badge variant="outline">never signed in</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit member"
                        onClick={() => setEditing(m)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <MemberDialog
        key={editing?.id ?? (adding ? "new" : "closed")}
        member={editing}
        open={!!editing || adding}
        stakeholderOptions={members
          // a plain Member is never anyone's manager (v24 rule)
          .filter((m) => m.is_active && m.id !== editing?.id && m.role !== "Member")
          .map((m) => m.name)}
        teams={teams}
        onOpenChange={(o) => {
          if (!o) { setEditing(null); setAdding(false); }
        }}
      />
    </div>
  );
}

/** The TEAMS REGISTRY (v24.2): EB manages EVERY named team here — the
 *  5 types are EB & LB (one each), Function & Function leaders (one per
 *  function) and Team (a TL's team — many per function). Add, rename or
 *  remove; the sheet's Teams tab follows automatically. */
const TEAM_TYPE_OPTIONS = ["Team", "Function leaders", "Function", "EB", "LB"] as const;

function TeamsCard({ teams }: { teams: TeamRegistryRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openCard, setOpenCard] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<string>("Team");
  const [fn, setFn] = useState("IGV");
  const [name, setName] = useState("");

  const singleType = type === "EB" || type === "LB";
  const typeLabel = (t: string) => (t === "MM" ? "Function leaders" : t);

  const reset = () => { setEditingId(null); setType("Team"); setFn("IGV"); setName(""); };

  const startEdit = (t: TeamRegistryRow) => {
    setEditingId(t.id);
    setType(typeLabel(t.type));
    setFn(t.function_key || "IGV");
    setName(t.name);
  };

  const save = () =>
    start(async () => {
      const res = await saveTeamEntry({ id: editingId, type, functionKey: fn, name });
      if (res.ok) {
        toast.success(editingId ? `Team renamed to "${name.trim()}" ✏️` : `Team "${name.trim()}" registered 🏷️`);
        reset();
        router.refresh();
      } else toast.error(res.error);
    });

  const del = (id: string, teamName: string) =>
    start(async () => {
      const res = await deleteTeamEntry(id);
      if (res.ok) {
        toast.success(`Team "${teamName}" removed from the registry`);
        if (editingId === id) reset();
        router.refresh();
      } else toast.error(res.error);
    });

  // grouped display, in structure order
  const groups = TEAM_TYPE_OPTIONS.map((t) => ({
    type: t,
    rows: teams.filter((x) => typeLabel(x.type) === t),
  })).filter((g) => g.rows.length > 0);

  return (
    <Card>
      <CardContent className="p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setOpenCard((o) => !o)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Users2 className="size-4 text-primary" /> Teams
            <span className="text-xs font-normal text-muted-foreground">
              {teams.length} registered
            </span>
          </span>
          <span className="text-xs text-muted-foreground">{openCard ? "Hide" : "Manage"}</span>
        </button>
        {openCard ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEAM_TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!singleType ? (
                <div className="grid gap-1">
                  <Label className="text-xs">Function</Label>
                  <Select value={fn} onValueChange={setFn}>
                    <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LC_FUNCTIONS.map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="grid min-w-40 flex-1 gap-1">
                <Label className="text-xs">Team name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={type === "Team" ? "e.g. The Falcons" : "Team name"}
                  className="h-9"
                  onKeyDown={(e) => { if (e.key === "Enter" && name.trim().length >= 2) save(); }}
                />
              </div>
              <Button size="sm" onClick={save} disabled={pending || name.trim().length < 2}>
                {editingId ? <Pencil className="size-4" /> : <Plus className="size-4" />}
                {editingId ? "Save" : "Add team"}
              </Button>
              {editingId ? (
                <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>

            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No teams registered yet — add the team names, then assign each
                member to one from their edit dialog.
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.type} className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">{g.type}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.rows.map((t) => (
                      <span
                        key={t.id}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs font-medium",
                          editingId === t.id && "border-primary bg-primary/10"
                        )}
                      >
                        {t.function_key ? (
                          <span className="text-muted-foreground">{t.function_key}</span>
                        ) : null}
                        {t.name}
                        <button
                          type="button"
                          className="ml-0.5 text-muted-foreground transition-colors hover:text-primary"
                          disabled={pending}
                          onClick={() => startEdit(t)}
                          title="Edit this team"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground transition-colors hover:text-destructive"
                          disabled={pending}
                          onClick={() => del(t.id, t.name)}
                          title="Remove this team"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MemberDialog({
  member, open, onOpenChange, stakeholderOptions, teams,
}: {
  member: MemberRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stakeholderOptions: string[];
  teams: TeamRegistryRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    name: member?.name ?? "",
    email: member?.email ?? "",
    phone: member?.phone ?? "",
    role: (member?.role ?? "Member") as MemberRole,
    functions: member?.functions ?? [],
    sub_functions: member?.sub_functions ?? [],
    stakeholder_name: member?.stakeholder_name ?? "",
    team_name: member?.team_name ?? "",
    is_active: member?.is_active ?? true,
  });

  const toggle = (key: "functions" | "sub_functions", value: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value)
        ? f[key].filter((v) => v !== value)
        : [...f[key], value],
    }));

  // known lists + whatever the sheet already holds (new functions appear automatically)
  const fnOptions = [...LC_FUNCTIONS, ...form.functions.filter((f) => !(LC_FUNCTIONS as readonly string[]).includes(f))];
  const sfOptions = [...SUB_FUNCTIONS, ...form.sub_functions.filter((f) => !(SUB_FUNCTIONS as readonly string[]).includes(f))];

  // email is OPTIONAL (v24) — but a member needs email OR phone to sign in
  const emailOk = !form.email.trim() || EMAIL_RE.test(form.email.trim());
  const phoneOk = !form.phone.trim() || PHONE_RE.test(cleanPhone(form.phone));
  // the SPECIFIC reason, not a flat "Numbers only." — normalizePhone knows
  // whether the shape is wrong or the number is simply too short/long
  const phoneError = (() => {
    if (phoneOk) return null;
    const digits = cleanPhone(form.phone).replace(/\D/g, "");
    if (digits.length < 7) return "Too short — an Egyptian mobile is 11 digits (01…).";
    if (digits.length > 15) return "Too long — looks like more than one number.";
    return normalizePhone(form.phone).error ?? "Use 01… , 03… or a full +international number.";
  })();
  const hasIdentity = !!form.email.trim() || !!form.phone.trim();
  const ready = form.name.trim().length >= 2 && emailOk && phoneOk && hasIdentity;

  // The team picker offers what makes sense for the ROLE — an AUTOMATIC rule,
  // no registry bookkeeping needed (v29.4):
  //   LCP / LCVP  → the EB team
  //   Member      → their function's registered Team rows
  //   Team Leader → the Team rows they can lead **AND** their function's
  //                 "Function leaders" team — a TL IS an MM. (Before v29.4 a
  //                 TL only ever saw type='Team' rows, so in an LC that has
  //                 registered none the picker was EMPTY even though the
  //                 function's leaders team existed.)
  //   Coordinator / Director → their function's "Function leaders" team
  // B2B and BD are ONE function everywhere, so either key matches either label,
  // and 'MM' is the pre-v24.2 alias of the 'Function leaders' type.
  const teamChoices = (() => {
    const isB2bKey = (k: string) => k === "B2B" || k === "BD";
    const own = [...form.functions, ...form.sub_functions];
    const fnMatch = (key: string) =>
      form.functions.length === 0 ||
      own.includes(key) ||
      (isB2bKey(key) && own.some(isB2bKey));
    const pick = (type: "Team" | "Function leaders") =>
      teams
        .filter((t) => {
          const matchesType =
            type === "Function leaders"
              ? t.type === "Function leaders" || t.type === "MM"
              : t.type === type;
          return matchesType && fnMatch(t.function_key);
        })
        .map((t) => t.name);

    if (form.role === "LCP" || form.role === "LCVP")
      return [...new Set(teams.filter((t) => t.type === "EB").map((t) => t.name))];
    if (form.role === "Member") return [...new Set(pick("Team"))];
    if (form.role === "Team Leader")
      return [...new Set([...pick("Team"), ...pick("Function leaders")])];
    return [...new Set(pick("Function leaders"))];
  })();
  // "add a NEW team" is only meaningful for TL teams (Member / Team Leader) —
  // the structural teams (EB, Function leaders…) come from the Teams card
  const canCreateTeam = form.role === "Member" || form.role === "Team Leader";
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamFn, setNewTeamFn] = useState("");

  const save = () =>
    start(async () => {
      const res = await upsertMember({
        id: member?.id ?? null,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase() || null,
        phone: form.phone ? cleanPhone(form.phone) : null,
        role: form.role,
        functions: form.functions,
        sub_functions: form.sub_functions,
        stakeholder_name: form.stakeholder_name || null,
        team_name: form.team_name.trim() || null,
        is_active: form.is_active,
      });
      if (res.ok) {
        toast.success(member ? "Member updated — sheet synced" : "Member added — sheet synced");
        onOpenChange(false);
        router.refresh();
      } else toast.error(res.error);
    });

  const resetPassword = () => {
    if (!member) return;
    start(async () => {
      const res = await resetMemberPassword(member.id);
      if (res.ok)
        toast.success(
          `${member.name} will sign in with Google next time and set a new password.`
        );
      else toast.error(res.error);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member ? `Edit ${member.name}` : "Add member"}</DialogTitle>
          <DialogDescription>
            Changes are saved to Sodio and written back to the Membership sheet.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Full name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Email {member && member.email ? "" : "(optional)"}</Label>
              <Input
                value={form.email}
                disabled={!!member?.email}
                inputMode="email"
                placeholder="none yet? they sign in with their phone"
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
              {form.email && !emailOk ? (
                <p className="text-xs text-destructive">Valid email required.</p>
              ) : null}
              {member && !member.email && form.email && emailOk ? (
                <p className="text-xs text-muted-foreground">
                  Once saved, they should sign in with <b>Google</b> to unlock
                  everything (their phone login closes).
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                inputMode="tel"
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                onBlur={() => {
                  // ALWAYS rewrite the field to what the system actually sees:
                  // on a good number that's the canonical +20… form, on a bad
                  // one it's the stripped digits. Leaving the raw paste in place
                  // used to hide invisible characters, so the member "fixed" a
                  // number that already looked fine and the error never moved.
                  const check = normalizePhone(form.phone ?? "");
                  const next = check.ok ? check.value : cleanPhone(form.phone ?? "");
                  if (next && next !== form.phone)
                    setForm((f) => ({ ...f, phone: next }));
                }}
              />
              {!phoneOk ? (
                <p className="text-xs text-destructive">{phoneError}</p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm((f) => ({ ...f, role: v as MemberRole }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Team name</Label>
              {creatingTeam ? (
                <div className="flex flex-wrap gap-1.5">
                  {form.functions.length !== 1 ? (
                    <Select value={newTeamFn || undefined} onValueChange={setNewTeamFn}>
                      <SelectTrigger className="w-24 shrink-0"><SelectValue placeholder="Fn" /></SelectTrigger>
                      <SelectContent>
                        {(form.functions.length ? form.functions : [...LC_FUNCTIONS]).map((f) => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <Input
                    value={newTeamName}
                    placeholder="New team's name"
                    className="min-w-32 flex-1"
                    onChange={(e) => setNewTeamName(e.target.value)}
                  />
                  <Button
                    type="button" size="sm" className="shrink-0"
                    disabled={pending || newTeamName.trim().length < 2}
                    onClick={() =>
                      start(async () => {
                        const fnKey =
                          form.functions.length === 1 ? form.functions[0] : newTeamFn;
                        if (!fnKey) { toast.error("Pick the team's function."); return; }
                        const res = await saveTeamEntry({
                          type: "Team",
                          functionKey: fnKey,
                          name: newTeamName.trim(),
                        });
                        if (res.ok) {
                          setForm((f) => ({ ...f, team_name: newTeamName.trim() }));
                          toast.success(`Team "${newTeamName.trim()}" registered 🏷️`);
                          setCreatingTeam(false);
                          setNewTeamName("");
                          router.refresh();
                        } else toast.error(res.error);
                      })
                    }
                  >
                    Create
                  </Button>
                  <Button
                    type="button" variant="ghost" size="sm" className="shrink-0 px-2 text-xs"
                    onClick={() => setCreatingTeam(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Select
                  value={form.team_name || "__none"}
                  onValueChange={(v) => {
                    if (v === "__new") { setCreatingTeam(true); return; }
                    setForm((f) => ({ ...f, team_name: v === "__none" ? "" : v }));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {/* a stored name outside the registry stays selectable */}
                    {form.team_name && !teamChoices.includes(form.team_name) ? (
                      <SelectItem value={form.team_name}>{form.team_name}</SelectItem>
                    ) : null}
                    {teamChoices.map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                    {canCreateTeam ? (
                      <SelectItem value="__new">➕ New team…</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Function (multi-select)</Label>
            <div className="flex flex-wrap gap-1.5">
              {fnOptions.map((fn) => (
                <button
                  key={fn}
                  type="button"
                  onClick={() => toggle("functions", fn)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                    form.functions.includes(fn)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted text-muted-foreground hover:border-primary/50"
                  )}
                >
                  {fn}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Sub function (multi-select)</Label>
            <div className="flex flex-wrap gap-1.5">
              {sfOptions.map((sf) => (
                <button
                  key={sf}
                  type="button"
                  onClick={() => toggle("sub_functions", sf)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                    form.sub_functions.includes(sf)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted text-muted-foreground hover:border-primary/50"
                  )}
                >
                  {sf}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Manager</Label>
              <Select
                value={form.stakeholder_name || "__none"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, stakeholder_name: v === "__none" ? "" : v }))
                }
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {stakeholderOptions.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-between gap-3 pb-1">
              <div>
                <Label>Active</Label>
                <p className="text-xs text-muted-foreground">Inactive members can&apos;t sign in</p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {member?.has_password ? (
            <Button variant="outline" onClick={resetPassword} disabled={pending}>
              <KeyRound className="size-4" /> Reset password
            </Button>
          ) : <span />}
          <Button onClick={save} disabled={pending || !ready}>
            {pending ? "Saving…" : member ? "Save changes" : "Add member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
