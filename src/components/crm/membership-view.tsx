"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pencil, Plus, RefreshCw, Table2 } from "lucide-react";
import { toast } from "sonner";
import {
  resetMemberPassword,
  runMembershipImport,
  runSheetsExport,
  upsertMember,
} from "@/server/actions";
import {
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

export interface MemberRow {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
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

export function MembershipView({ members }: { members: MemberRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [adding, setAdding] = useState(false);

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
      if (res.ok) toast.success("CRM data exported to the Google Sheets mirrors");
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

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Function</TableHead>
                  <TableHead>Sub function</TableHead>
                  <TableHead>Stakeholder</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id} className={!m.is_active ? "opacity-50" : undefined}>
                    <TableCell className="font-medium">
                      {m.nickname || m.name}
                      {m.team_name ? (
                        <span className="ml-2 text-xs text-muted-foreground">{m.team_name}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
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
          .filter((m) => m.is_active && m.id !== editing?.id)
          .map((m) => m.nickname || m.name)}
        onOpenChange={(o) => {
          if (!o) { setEditing(null); setAdding(false); }
        }}
      />
    </div>
  );
}

function MemberDialog({
  member, open, onOpenChange, stakeholderOptions,
}: {
  member: MemberRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stakeholderOptions: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    name: member?.name ?? "",
    nickname: member?.nickname ?? "",
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

  const emailOk = EMAIL_RE.test(form.email.trim());
  const phoneOk = !form.phone.trim() || PHONE_RE.test(cleanPhone(form.phone));
  const ready = form.name.trim().length >= 2 && emailOk && phoneOk;

  const save = () =>
    start(async () => {
      const res = await upsertMember({
        id: member?.id ?? null,
        name: form.name.trim(),
        nickname: form.nickname.trim() || null,
        email: form.email.trim().toLowerCase(),
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
          `${member.nickname || member.name} can now sign in with any password and will set a new one.`
        );
      else toast.error(res.error);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member ? `Edit ${member.nickname || member.name}` : "Add member"}</DialogTitle>
          <DialogDescription>
            Changes are saved to the CRM and written back to the Membership sheet.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Full name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Nickname</Label>
              <Input value={form.nickname} onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Email *</Label>
              <Input
                value={form.email}
                disabled={!!member}
                inputMode="email"
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
              {form.email && !emailOk ? (
                <p className="text-xs text-destructive">Valid email required.</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                inputMode="tel"
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
              {!phoneOk ? <p className="text-xs text-destructive">Numbers only.</p> : null}
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
              <Input value={form.team_name} onChange={(e) => setForm((f) => ({ ...f, team_name: e.target.value }))} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Function (multi-select)</Label>
            <div className="flex flex-wrap gap-1.5">
              {LC_FUNCTIONS.map((fn) => (
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
              {SUB_FUNCTIONS.map((sf) => (
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
              <Label>Stakeholder</Label>
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
