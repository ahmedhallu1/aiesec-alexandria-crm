"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Plus, RefreshCw, Search, Table2, Trash2, Upload, Users2, X } from "lucide-react";
import { toast } from "sonner";
import {
  deleteTeamEntry,
  resetMemberPassword,
  saveTeamEntry,
  runMembershipImport,
  runSheetsExport,
  setPrankMode,
  upsertMember,
} from "@/server/actions";
import { normalizePhone,
  cleanPhone,
  EMAIL_RE,
  FUNCTION_COLORS,
  LC_FUNCTIONS,
  MANAGER_ROLES,
  MEMBER_ROLES,
  PHONE_RE,
  PRANK_OPTIONS,
  prankIsOn,
  SUB_FUNCTIONS,
  type MemberRole,
} from "@/lib/types";
import { MEMBER_STATUS_LABEL, memberStatus } from "@/lib/member-fields";
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
import { ColumnFilter, multi } from "./data-table-kit";
import { MembershipUploadDialog } from "./membership-upload-dialog";
import { ExportButton } from "./export-button";
import { mirrorMembershipNow } from "@/server/lc-actions";

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
  has_podio?: boolean | null;
  /** backup Gmail (v33.29) — DB-only, never written to the sheet */
  fallback_email?: string | null;
  /** 🃏 prank mode (v33.51) — DB-only, never on the sheet */
  prank_until?: string | null;
  left_at?: string | null;
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
/** No picks = no filter; several picks = match ANY of them. */
function anyOf(raw: string | undefined, pred: (v: string) => boolean): boolean {
  const picks = multi(raw);
  return picks.length === 0 || picks.some(pred);
}

const COL_FILTERS: Record<
  string,
  {
    key: string;
    label: string;
    /** the live list, for funnels whose options are the DATA (Manager) rather
     *  than a fixed pick-list (Role, Function…) */
    options: (members: MemberRow[]) => { value: string; label: string }[];
  }
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
  /** BY MANAGER (v33.52) — with team names gone from the sheet, a "team" IS
   *  its manager, so this is the funnel that answers "show me X's people".
   *  Options come from the membership itself: a name nobody manages can't be
   *  offered. */
  manager: {
    key: "manager",
    label: "Manager",
    options: (ms) =>
      [...new Set(ms.map((m) => m.stakeholder_name).filter(Boolean))]
        .sort((a, b) => (a as string).localeCompare(b as string))
        .map((n) => ({ value: n as string, label: n as string })),
  },
  status: {
    key: "status",
    label: "Status",
    // THE FUNNEL OFFERS WHAT THE COLUMN SHOWS (v34.4). It used to offer
    // "Left the LC" — a label this column never renders, and one that could
    // not match anybody: nobody in the LC has left_at set. Worse, picking it
    // ALSO emptied whatever else was ticked (see matchesCols below).
    options: () =>
      (["active", "never", "inactive"] as const).map((v) => ({
        value: v,
        label: MEMBER_STATUS_LABEL[v],
      })),
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
  status: (m) =>
    ({ active: 0, never: 1, inactive: 2, left: 3 } as const)[memberStatus(m)],
};

export function MembershipView({
  members,
  teams,
  source = "sodio",
  canRestart = false,
}: {
  members: MemberRow[];
  teams: TeamRegistryRow[];
  /** where membership lives (v37.2) — Sodio, with the sheet as its mirror, or
   *  the old two-way sync */
  source?: "sodio" | "sheet";
  /** the LCP / admins may restart the membership from a file */
  canRestart?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
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
    // multi-select (v33.3): several picks on one column are an OR
    anyOf(colFilter.role, (v) => m.role === v) &&
    anyOf(colFilter.fn, (v) => (m.functions ?? []).includes(v)) &&
    anyOf(colFilter.sub, (v) => (m.sub_functions ?? []).includes(v)) &&
    anyOf(colFilter.manager, (v) => (m.stakeholder_name ?? "") === v) &&
    // ONE COLUMN'S PICKS ARE AN **OR** — ticking a second option ADDS its rows,
    // it does not replace the first. This clause used to be followed by
    //     (!!m.left_at === picks.includes("left"))
    // which is an equality, not a filter: ticking "Left the LC" flipped it to
    // "ONLY people who left", so Active + Left returned 0 instead of both.
    // That is the shape to watch for — an extra AND that is keyed on the picks.
    anyOf(colFilter.status, (v) => memberStatus(m) === v) &&
    // people removed from the sheet are archived — out of the list always, and
    // NOT tied to what is ticked above
    memberStatus(m) !== "left";

  const byCols = members.filter(matchesCols);
  const shown = needle
    ? byCols.filter((m) =>
        [
          m.name,
          "",
          m.email ?? "",
          m.phone ?? "",
          m.role,
          (m.functions ?? []).join(" "),
          (m.sub_functions ?? []).join(" "),
        ].some((v) => v.toLowerCase().includes(needle))
      )
    : byCols;

  // click a header to sort the (already filtered) list; mobile cards follow
  const { sorted, sortKey, dir, toggle: toggleSort } = useTableSort(shown, MEMBER_SORTERS);
  // (v37.8) a render FUNCTION, not a component — as <SortHead/> it remounted
  // every header (and its ColumnFilter menu) on each filter tick.
  const renderSortHead = ({
    field, defaultDir = "asc", children, className,
  }: {
    field: string;
    defaultDir?: SortDir;
    children: React.ReactNode;
    className?: string;
  }) => (
    <TableHead key={field} className={className}>
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
            options={COL_FILTERS[field].options(members)}
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
        // -1 is the "sheet unchanged, skipped" sentinel — never show it as a
        // row count (v33.19 review); the manual button forces, so this is rare
        toast.success(
          (res.data?.imported ?? 0) < 0
            ? "Membership synced — the sheet hadn't changed"
            : `Membership synced — ${res.data?.imported ?? 0} rows imported`
        );
        router.refresh();
      } else toast.error(res.error);
    });

  const mirrorNow = () =>
    start(async () => {
      const res = await mirrorMembershipNow();
      if (res.ok) toast.success(`The Membership sheet now mirrors Sodio — ${res.data?.rows ?? 0} people.`);
      else toast.error(res.error);
    });

  const exportNow = () =>
    start(async () => {
      const res = await runSheetsExport();
      if (res.ok) toast.success("Sodio data exported to the Google Sheets mirrors");
      else toast.error(res.error);
    });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <MembershipUploadDialog
        open={uploading}
        onClose={() => {
          setUploading(false);
          router.refresh();
        }}
        canRestart={canRestart}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Membership</h1>
          <p className="text-sm text-muted-foreground">
            {source === "sodio" ? (
              <>
                <b>Sodio is the membership.</b> Edit people here, or download the list, change
                it in Excel and upload it back. The <b>“CRM — Membership”</b> sheet is a mirror
                Sodio keeps writing — edits made in the sheet are not read back.
              </>
            ) : (
              <>
                Edit members right here — every change is also written back to the
                <b> “CRM — Membership”</b> sheet (which still auto-syncs every 30 minutes).
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setUploading(true)} disabled={pending}>
            <Upload className="size-4" /> Upload
          </Button>
          <ExportButton kind="membership" label="Download" size="default" />
          <Button variant="outline" onClick={exportNow} disabled={pending}>
            <Table2 className="size-4" /> Export mirrors
          </Button>
          {source === "sodio" ? (
            <Button variant="outline" onClick={mirrorNow} disabled={pending}>
              <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> Rewrite the sheet
            </Button>
          ) : (
            <Button variant="outline" onClick={importNow} disabled={pending}>
              <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> Sync from sheet
            </Button>
          )}
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
          placeholder="Search name, email, manager, function…"
          className="h-9 pl-8"
        />
      </div>
      {/* (v37.8) phones have no table header to hang the funnels off — the
          same row the Members directory has had since v33.36.2 */}
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        {Object.entries(COL_FILTERS).map(([k, f]) => (
          <span key={k} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {f.label}
            <ColumnFilter
              label={f.label}
              value={colFilter[f.key] ?? ""}
              options={f.options(members)}
              onChange={setCol(f.key)}
            />
          </span>
        ))}
      </div>

      <TeamsCard teams={teams} />

      {/* Mobile: cards */}
      <div className="space-y-2.5 md:hidden">
        {sorted.map((m) => (
          <Card key={m.id} className={!m.is_active ? "opacity-50" : undefined}>
            <CardContent
              className="space-y-1.5 p-3.5"
              onClick={() => setEditing(m)}
              // (v37.8) the card is the edit button on phones — reachable by keyboard / AT too
              role="button"
              tabIndex={0}
              aria-label={`Edit ${m.name}`}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setEditing(m);
                }
              }}
            >
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
                  {renderSortHead({ field: "member", children: "Member" })}
                  {renderSortHead({ field: "email", children: "AIESEC Mail" })}
                  {renderSortHead({ field: "role", children: "Role" })}
                  {renderSortHead({ field: "function", children: "Function" })}
                  {renderSortHead({ field: "sub", children: "Sub function" })}
                  {renderSortHead({ field: "manager", children: "Manager" })}
                  {renderSortHead({ field: "status", children: "Status" })}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((m) => (
                  <TableRow key={m.id} className={!m.is_active ? "opacity-50" : undefined}>
                    <TableCell className="font-medium">
                      {m.name}

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
          // ONE list, shared with the server (v36). This used to exclude only
          // a plain Member, so a COORDINATOR was still offered — and filing
          // somebody under one made them vanish from every team view, because
          // a Coordinator holds no team. `relinkStakeholders` reads the same
          // MANAGER_ROLES, so the picker can no longer offer a manager the
          // import would silently overwrite half an hour later.
          .filter(
            (m) => m.is_active && m.id !== editing?.id && MANAGER_ROLES.includes(m.role)
          )
          .map((m) => m.name)}
        onOpenChange={(o) => {
          if (!o) { setEditing(null); setAdding(false); }
        }}
      />
    </div>
  );
}

/** THE TWO NAMED BODIES (v33.53 — was the teams registry).
 *
 *  The LC deleted the Teams tab and the Team Name column from the Membership
 *  sheet: teams have no names any more, they have a MANAGER. Only the two
 *  standing bodies keep a name — the EB and the LB — and this card is where
 *  those two are set. Function and Team rows are no longer offered; the ones
 *  already in the table are inert. */
/** The functions that submit partners to Podio at all — the only ones for
 *  which "has Podio access" means anything. */
const PODIO_FUNCTIONS = ["IGV", "IGT", "B2B", "BD", "B2C"];

const TEAM_TYPE_OPTIONS = ["EB", "LB"] as const;

function TeamsCard({ teams }: { teams: TeamRegistryRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openCard, setOpenCard] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<string>("EB");
  const [fn, setFn] = useState("IGV");
  const [name, setName] = useState("");

  const singleType = type === "EB" || type === "LB";
  const typeLabel = (t: string) => (t === "MM" ? "Function leaders" : t);

  const reset = () => { setEditingId(null); setType("EB"); setFn(""); setName(""); };

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
              {/* v33.55 — the count used to be every registry row (24: the
                  retired Function and Function-leaders names). Only the two
                  named bodies are real now. */}
              {teams.filter((t) => t.type === "EB" || t.type === "LB").length === 0
                ? "none set"
                : teams
                    .filter((t) => t.type === "EB" || t.type === "LB")
                    .map((t) => `${t.type}: ${t.name}`)
                    .join(" · ")}
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
                No bodies named yet — set the EB and LB names, then assign each
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
  member, open, onOpenChange, stakeholderOptions,
}: {
  member: MemberRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stakeholderOptions: string[];
  // v33.53 — the dialog took the teams registry for its team picker. There is
  // no picker and no registry to pick from: the Manager field IS the team.
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
    is_active: member?.is_active ?? true,
    has_podio: !!member?.has_podio,
    fallback_email: member?.fallback_email ?? "",
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

  // v33.53 — the whole team PICKER is gone: there are no team names to pick
  // from. A member's team is the Manager field above it.
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
        is_active: form.is_active,
        has_podio: form.has_podio,
        fallback_email: form.fallback_email.trim().toLowerCase() || null,
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
              {/* TWO EMAILS, TWO JOBS (v33.32) — both fields used to say
                  "Email", so the AIESEC one and the personal one were filled
                  interchangeably. This is THE identity: it signs them in and
                  it is what the Membership sheet carries. */}
              <Label>AIESEC Mail {member && member.email ? "" : "(optional)"}</Label>
              <Input
                value={form.email}
                disabled={!!member?.email}
                inputMode="email"
                placeholder="them@aiesec.net — none yet? they sign in with their phone"
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Their <b>@aiesec.net</b> address — this is their sign-in and
                what the Membership sheet holds.
              </p>
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

          {/* BACKUP GMAIL (v33.29) — DB-only (never on the sheet): where
              password resets and IR-call invites reach a member whose
              @aiesec.net hasn't landed yet. Members can also set their own
              on the profile. Never a sign-in. */}
          <div className="grid gap-1.5">
            <Label>Personal Gmail — backup only (no AIESEC Mail yet)</Label>
            <Input
              value={form.fallback_email}
              name="backup-personal-gmail"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              inputMode="email"
              placeholder="them@gmail.com — for resets & calendar invites"
              onChange={(e) => setForm((f) => ({ ...f, fallback_email: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Their own <b>Gmail</b>, not an AIESEC address: password resets and
              IR-call calendar invites reach them here until the AIESEC Mail
              above arrives. Never a sign-in, and never written to the sheet.
            </p>
          </div>

          <div className="grid gap-3">
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
            {/* v33.53 — the Team-name field is gone with the sheet's Team
                Name column. A team is a MANAGER and the people whose Manager
                cell names them; there is nothing left here to type. */}
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
            {/* PODIO ACCESS (v33.2). Only meaningful for the functions that
                submit partners — offering it to TM or OGX would be noise. */}
            {/* MEMBERS ONLY (v33.4): a TL, Coordinator, Director or VP can
                already set a Request State by rank, so offering them a switch
                that grants what they hold would just be a lie you could
                toggle. The tag exists for the member who does the LC's
                submissions without the title. */}
            {form.role === "Member" &&
            PODIO_FUNCTIONS.some(
              (f) => form.functions.includes(f) || form.sub_functions.includes(f)
            ) ? (
              <div className="flex items-end justify-between gap-3 pb-1">
                <div>
                  <Label>Has Podio access</Label>
                  <p className="text-xs text-muted-foreground">
                    They hold the LC&apos;s Podio login — so they can set an account&apos;s
                    Podio state themselves, like an MM
                  </p>
                </div>
                <Switch
                  checked={!!form.has_podio}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, has_podio: v }))}
                />
              </div>
            ) : null}
          </div>

          {/* 🃏 PRANK MODE (v33.51) — existing members only: there is no joy in
              pranking somebody who hasn't signed in yet. Saved on the spot
              (its own action, its own audit row), NOT with the form, because
              it is the one field here that has nothing to do with membership
              and everything to do with the EB's sense of humour. */}
          {member ? <PrankRow member={member} /> : null}
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

/** 🃏 THE PRANK ROW (v33.51) — the EB's sense of humour, with a receipt.
 *
 *  Saved on its own the moment it is picked (not with the form) and audited
 *  under the setter's name, because a prank with no author is just a bug
 *  report waiting to happen. Everything it switches on is cosmetic and lives
 *  in the victim's browser — see prankster.tsx for the rules it obeys and the
 *  escape hatch it always carries. */
function PrankRow({ member }: { member: MemberRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [until, setUntil] = useState<string | null>(member.prank_until ?? null);
  const on = prankIsOn({ prank_until: until });

  const apply = (option: string) =>
    start(async () => {
      const res = await setPrankMode(member.id, option);
      if (!res.ok) { toast.error(res.error); return; }
      setUntil(res.data?.until ?? null);
      const picked = PRANK_OPTIONS.find((o) => o.value === option);
      toast.success(
        option === "off"
          ? `${member.name} is free. 😇`
          : `${member.name} is in a mood — ${picked?.label.replace(/^\S+\s/, "")}. 🃏`
      );
      router.refresh();
    });

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        on ? "border-amber-500/60 bg-amber-500/5" : "border-dashed"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Label className="flex items-center gap-1.5">
            🃏 Prank mode
            {on ? (
              <Badge className="bg-amber-500 text-white hover:bg-amber-500">ON</Badge>
            ) : null}
          </Label>
          <p className="text-xs text-muted-foreground">
            {on
              ? `Sodio is being playfully impossible for them${
                  until && Date.parse(until) < Date.parse("2090-01-01")
                    ? ` until ${new Date(until).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                    : " until you turn it off"
                }.`
              : "A stubborn button, a wrong turn on the way to a tab, the Violet Man strolling past. Never their work — and they can pause it for 10 minutes whenever they actually need to focus."}
          </p>
        </div>
        <Select
          value={on ? "on" : "off"}
          onValueChange={(v) => apply(v)}
          disabled={pending}
        >
          <SelectTrigger className="w-auto min-w-40">
            <SelectValue placeholder="Off" />
          </SelectTrigger>
          <SelectContent>
            {/* the current state, unpickable — the options below are the moves */}
            {on ? <SelectItem value="on" disabled>🃏 Currently ON</SelectItem> : null}
            {PRANK_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
