"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createAccount } from "@/server/actions";
import { IGV_PROJECTS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface MemberOption { id: string; label: string; function: string | null }

interface BlockInfo {
  kind: "duplicate" | "blacklisted";
  message: string;
  info: Record<string, string | null>;
}

export function AddAccountDialog({
  open, onOpenChange, viewer, members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: { id: string; function: string | null; canAssignOthers: boolean; fixedFn: "IGV" | "IGT" | null };
  members: MemberOption[];
}) {
  const router = useRouter();
  const [fn, setFn] = useState<"IGV" | "IGT">(viewer.fixedFn ?? "IGT");
  const [form, setForm] = useState<Record<string, string>>({});
  const [responsible, setResponsible] = useState(viewer.id);
  const [block, setBlock] = useState<BlockInfo | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = () =>
    startTransition(async () => {
      setBlock(null);
      const res = await createAccount({
        function: fn,
        name: form.name ?? "",
        product: fn === "IGT" ? ((form.product as "GTa" | "GTe") || null) : null,
        sub_product: form.sub_product,
        project: fn === "IGV" ? form.project : null,
        account_type: form.account_type,
        industry: form.industry,
        package_plan: form.package_plan,
        phone: form.phone,
        email: form.email,
        social_link: form.social_link,
        website: form.website,
        podio_link: form.podio_link,
        responsible_id: responsible,
      });
      if (!res.ok) {
        if (res.code === "duplicate" || res.code === "blacklisted") {
          setBlock({ kind: res.code, message: res.error, info: res.info ?? {} });
        } else {
          toast.error(res.error);
        }
        return;
      }
      toast.success("Account added 🎉");
      setForm({});
      onOpenChange(false);
      router.push(`/accounts/${res.data!.id}`);
    });

  const fnMembers = members.filter((m) => m.function === fn || m.id === viewer.id);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setBlock(null); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            Names are checked against all ICX accounts and the blacklist.
          </DialogDescription>
        </DialogHeader>

        {block ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">
              {block.kind === "blacklisted" ? "⛔ Black listed" : "🚫 Already exists"} — {block.message}
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-foreground">
              {Object.entries(block.info)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-medium capitalize text-muted-foreground">{k.replace("_", " ")}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ) : null}

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Function</Label>
              <Select
                value={fn}
                onValueChange={(v) => setFn(v as "IGV" | "IGT")}
                disabled={!!viewer.fixedFn}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IGV">IGV</SelectItem>
                  <SelectItem value="IGT">IGT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {fn === "IGT" ? (
              <div className="grid gap-2">
                <Label>Product *</Label>
                <Select
                  value={form.product ?? ""}
                  onValueChange={(v) => setForm((f) => ({ ...f, product: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GTa">GTa — Global Talent</SelectItem>
                    <SelectItem value="GTe">GTe — Global Teacher</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label>Project *</Label>
                <Select
                  value={form.project ?? ""}
                  onValueChange={(v) => setForm((f) => ({ ...f, project: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    {IGV_PROJECTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label>Account name *</Label>
            <Input value={form.name ?? ""} onChange={set("name")} placeholder="Company / organization name" />
          </div>

          {fn === "IGT" ? (
            <div className="grid gap-2">
              <Label>Sub product / industry</Label>
              <Input value={form.sub_product ?? ""} onChange={set("sub_product")} placeholder="Engineering, Marketing, IT…" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Account type</Label>
                <Input value={form.account_type ?? ""} onChange={set("account_type")} placeholder="Startup, Course Center…" />
              </div>
              <div className="grid gap-2">
                <Label>Industry</Label>
                <Input value={form.industry ?? ""} onChange={set("industry")} placeholder="Education, Architecture…" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={form.phone ?? ""} onChange={set("phone")} inputMode="tel" />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input value={form.email ?? ""} onChange={set("email")} inputMode="email" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Social link</Label>
              <Input value={form.social_link ?? ""} onChange={set("social_link")} placeholder="LinkedIn / Facebook / Instagram" />
            </div>
            <div className="grid gap-2">
              <Label>Website</Label>
              <Input value={form.website ?? ""} onChange={set("website")} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Podio link</Label>
            <Input value={form.podio_link ?? ""} onChange={set("podio_link")} />
          </div>
          {fn === "IGV" ? (
            <div className="grid gap-2">
              <Label>Package plan details</Label>
              <Input value={form.package_plan ?? ""} onChange={set("package_plan")} />
            </div>
          ) : null}

          {viewer.canAssignOthers ? (
            <div className="grid gap-2">
              <Label>Responsible</Label>
              <Select value={responsible} onValueChange={setResponsible}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {fnMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}{m.id === viewer.id ? " (you)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={
              pending ||
              !(form.name ?? "").trim() ||
              (fn === "IGT" && !form.product) ||
              (fn === "IGV" && !form.project)
            }
          >
            {pending ? "Checking…" : "Add account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
