"use client";

import { useState, useTransition } from "react";
import { ShieldBan, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addBlacklistEntry, removeBlacklistEntry } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Entry {
  id: string;
  account_name: string;
  project: string | null;
  comments: string | null;
  link: string | null;
  added_by: string | null;
  created_at: string;
}

export function BlacklistView({ entries, canManage }: { entries: Entry[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ accountName: "", project: "", comments: "", link: "" });
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      const res = await addBlacklistEntry(form);
      if (res.ok) {
        toast.success(`"${form.accountName}" black listed`);
        setForm({ accountName: "", project: "", comments: "", link: "" });
        setOpen(false);
      } else toast.error(res.error);
    });

  const remove = (id: string, name: string) =>
    start(async () => {
      const res = await removeBlacklistEntry(id);
      if (res.ok) toast.success(`"${name}" removed from the blacklist`);
      else toast.error(res.error);
    });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldBan className="size-6 text-destructive" /> Blacklist
          </h1>
          <p className="text-sm text-muted-foreground">
            Shared across all ICX. Adding an account with any of these names is blocked.
          </p>
        </div>
        {canManage ? <Button onClick={() => setOpen(true)}>Add to blacklist</Button> : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Added by</TableHead>
                {canManage ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    The blacklist is empty.
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      {e.account_name}
                      {e.link ? (
                        <a href={e.link} target="_blank" rel="noreferrer" className="ml-2 text-xs text-primary hover:underline">
                          link
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.project ?? "—"}</TableCell>
                    <TableCell className="max-w-56 truncate text-sm text-muted-foreground">{e.comments ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.added_by ?? "—"}</TableCell>
                    {canManage ? (
                      <TableCell>
                        <Button
                          variant="ghost" size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={pending}
                          onClick={() => remove(e.id, e.account_name)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to blacklist</DialogTitle>
            <DialogDescription>VPs and the LCP only. This blocks the name across all ICX.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Account name *</Label>
              <Input value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Project / function context</Label>
              <Input value={form.project} onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Why is it black listed?</Label>
              <Textarea rows={2} value={form.comments} onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Link (Podio / social)</Label>
              <Input value={form.link} onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={add} disabled={pending || !form.accountName.trim()}>
              {pending ? "Adding…" : "Black list it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
