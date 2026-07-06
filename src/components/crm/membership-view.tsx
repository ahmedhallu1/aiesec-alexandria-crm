"use client";

import { useTransition } from "react";
import { RefreshCw, Table2 } from "lucide-react";
import { toast } from "sonner";
import { runMembershipImport, runSheetsExport } from "@/server/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Row {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  phone: string | null;
  function: string | null;
  sub_function: string | null;
  role: string;
  stakeholder_email: string | null;
  team_name: string | null;
  is_active: boolean;
  first_login_at: string | null;
}

export function MembershipView({ members }: { members: Row[] }) {
  const [pending, start] = useTransition();

  const importNow = () =>
    start(async () => {
      const res = await runMembershipImport();
      if (res.ok) toast.success(`Membership synced — ${res.data?.imported ?? 0} rows imported`);
      else toast.error(res.error);
    });

  const exportNow = () =>
    start(async () => {
      const res = await runSheetsExport();
      if (res.ok) toast.success("CRM data exported to the Google Sheets mirrors");
      else toast.error(res.error);
    });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Membership</h1>
          <p className="text-sm text-muted-foreground">
            Source of truth: the <b>“CRM — Membership”</b> Google Sheet. Edit there, then sync
            (it also auto-syncs every 30 minutes).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportNow} disabled={pending}>
            <Table2 className="size-4" /> Export mirrors now
          </Button>
          <Button onClick={importNow} disabled={pending}>
            <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} /> Sync membership now
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
                    <TableCell className="text-sm">{m.function ?? "—"}</TableCell>
                    <TableCell className="text-sm">{m.sub_function ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.stakeholder_email ?? "—"}</TableCell>
                    <TableCell>
                      {!m.is_active ? (
                        <Badge variant="destructive">inactive</Badge>
                      ) : m.first_login_at ? (
                        <Badge className="border-transparent bg-success/15 text-success">active</Badge>
                      ) : (
                        <Badge variant="outline">never signed in</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
