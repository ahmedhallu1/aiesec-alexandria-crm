"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createAccount } from "@/server/actions";
import {
  ACCOUNT_TYPES,
  IGT_SUB_PRODUCTS,
  IGV_PROJECTS,
  INDUSTRIES,
  PODIO_FORM_URL,
  podioCheckUrl,
} from "@/lib/types";
import type { AccountContact } from "@/lib/types";
import { ExternalLink, ShieldQuestion } from "lucide-react";
import { MultiPick } from "./multi-pick";
import { ContactsEditor, contactsValid } from "./contacts-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface MemberOption { id: string; label: string; functions: string[] }

interface BlockInfo {
  kind: "duplicate" | "archived";
  message: string;
  info: Record<string, string | null>;
}

/** Dropdown backed by a curated list where "Other" opens a free-text input. */
function ListOrOther({
  label, options, value, onChange, placeholder,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const inList = options.includes(value);
  const [other, setOther] = useState(!!value && !inList);
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select
        value={other ? "Other" : value || undefined}
        onValueChange={(v) => {
          if (v === "Other") { setOther(true); onChange(""); }
          else { setOther(false); onChange(v); }
        }}
      >
        <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
      {other ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? `Other ${label.toLowerCase()}…`}
        />
      ) : null}
    </div>
  );
}

type Fn = "IGV" | "IGT" | "B2B";

/** National duplicate check: Sodio already blocks names taken inside our LC,
 *  but a company may already be registered with ANOTHER LC on the national
 *  Podio partners form. This opens that form (name prefilled) so the member
 *  verifies before submitting — "if you find the partner in the list, don't
 *  submit it to avoid duplicates". */
function PodioCheck({ name }: { name: string }) {
  const url = podioCheckUrl(name);
  if (!PODIO_FORM_URL) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 text-xs">
      <ShieldQuestion className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <p className="text-muted-foreground">
        Not sure it&apos;s free nationally?{" "}
        <a
          href={url ?? PODIO_FORM_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
        >
          Check on Podio <ExternalLink className="size-3" />
        </a>{" "}
        first — if the company is already in another LC&apos;s list, don&apos;t add it here.
      </p>
    </div>
  );
}

export function AddAccountDialog({
  open, onOpenChange, viewer, members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: { id: string; canAssignOthers: boolean; allowedFns: Fn[] };
  members: MemberOption[];
}) {
  const router = useRouter();
  const [fn, setFn] = useState<Fn>(viewer.allowedFns[0] ?? "IGT");
  const [form, setForm] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<AccountContact[]>([
    { tag: "Contact", kind: "phone", value: "" },
  ]);
  const [requestedPodio, setRequestedPodio] = useState(false);
  const [responsible, setResponsible] = useState(viewer.id);
  const [block, setBlock] = useState<BlockInfo | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const setVal = (key: string) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const fieldsOk = contactsValid(contacts);

  const submit = () =>
    startTransition(async () => {
      setBlock(null);
      const res = await createAccount({
        function: fn,
        name: form.name ?? "",
        product: fn === "IGT" ? ((form.product as "GTa" | "GTe") || null) : null,
        sub_product: fn === "IGT" ? form.sub_product : null,
        project: fn === "IGV" ? form.project : null,
        account_type: fn !== "IGT" ? form.account_type : null,
        industry: fn !== "IGT" ? form.industry : null,
        contacts,
        requested_podio: requestedPodio,
        comment: form.comment,
        responsible_id: responsible,
      });
      if (!res.ok) {
        if (res.code === "duplicate" || res.code === "archived") {
          setBlock({ kind: res.code, message: res.error, info: res.info ?? {} });
        } else {
          toast.error(res.error);
        }
        return;
      }
      toast.success("Account added 🎉");
      setForm({});
      setContacts([{ tag: "Contact", kind: "phone", value: "" }]);
      onOpenChange(false);
      router.push(`/accounts/${res.data!.slug}`);
    });

  const fnMembers = members.filter(
    (m) => m.functions.includes(fn) || m.id === viewer.id
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setBlock(null); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            Names are checked against all ICX accounts and the archive.
          </DialogDescription>
        </DialogHeader>

        {block ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">
              {block.kind === "archived" ? "🗄️ Archived" : "🚫 Already exists"} — {block.message}
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-foreground">
              {Object.entries(block.info)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-medium capitalize text-muted-foreground">{k.replaceAll("_", " ")}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ) : null}

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Function</Label>
              <Select
                value={fn}
                onValueChange={(v) => setFn(v as "IGV" | "IGT")}
                disabled={viewer.allowedFns.length < 2}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {viewer.allowedFns.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {fn === "IGT" ? (
              <div className="grid gap-2">
                <Label>Product *</Label>
                <Select
                  value={form.product ?? ""}
                  onValueChange={setVal("product")}
                >
                  <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GTa">GTa — Global Talent</SelectItem>
                    <SelectItem value="GTe">GTe — Global Teacher</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : fn === "IGV" ? (
              <div className="grid gap-2">
                <Label>Project *</Label>
                <Select
                  value={form.project ?? ""}
                  onValueChange={setVal("project")}
                >
                  <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    {IGV_PROJECTS.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div />
            )}
          </div>

          <div className="grid gap-2">
            <Label>Account name *</Label>
            <Input value={form.name ?? ""} onChange={set("name")} placeholder="Company / organization name" />
            <PodioCheck name={form.name ?? ""} />
          </div>

          {fn === "IGT" ? (
            <MultiPick
              label="Sub product / industry (pick all that apply)"
              options={IGT_SUB_PRODUCTS}
              value={form.sub_product ?? ""}
              onChange={setVal("sub_product")}
            />
          ) : (
            <div className="grid gap-4">
              <ListOrOther
                label="Account type"
                options={ACCOUNT_TYPES}
                value={form.account_type ?? ""}
                onChange={setVal("account_type")}
              />
              <MultiPick
                label="Industry (pick all that apply)"
                options={INDUSTRIES}
                value={form.industry ?? ""}
                onChange={setVal("industry")}
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label>Contact info (phones · emails · links, each with a tag)</Label>
            <ContactsEditor rows={contacts} onChange={setContacts} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Requested on Podio?</p>
              <p className="text-xs text-muted-foreground">Already requested in the AMS</p>
            </div>
            <Switch checked={requestedPodio} onCheckedChange={setRequestedPodio} />
          </div>

          <div className="grid gap-2">
            <Label>Comment</Label>
            <Textarea
              rows={2}
              value={form.comment ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
              placeholder="Anything worth noting about this account (becomes Comment #1)"
            />
          </div>

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
              !fieldsOk ||
              viewer.allowedFns.length === 0 ||
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
