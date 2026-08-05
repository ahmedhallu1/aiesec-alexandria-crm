"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  checkAccountNameLive, checkPodioNameLive, createAccount, removeArchivedEntry,
  reviveAndAssign,
} from "@/server/actions";
import type { PodioCheck } from "@/lib/podio";
import {
  ACCOUNT_TYPES,
  B2C_TYPES,
  IGT_SUB_PRODUCTS,
  IGV_PROJECTS,
  INDUSTRIES,
  PODIO_FORM_URL,
} from "@/lib/types";
import type { AccountContact } from "@/lib/types";
import { Plus } from "lucide-react";
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

type Fn = "IGV" | "IGT" | "B2B" | "BD" | "B2C";

export function AddAccountDialog({
  open, onOpenChange, viewer, members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: {
    id: string;
    canAssignOthers: boolean;
    canSetRequestState: boolean;
    allowedFns: Fn[];
  };
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
  const [requestState, setRequestState] = useState("");
  const [block, setBlock] = useState<BlockInfo | null>(null);
  // freshly-created account → the "open it or add another?" popup
  const [added, setAdded] = useState<{ name: string; slug: string } | null>(null);
  // bump to hard-remount the form — child pickers hold internal state that a
  // plain setForm({}) cannot clear
  const [epoch, setEpoch] = useState(0);
  const [pending, startTransition] = useTransition();

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const setVal = (key: string) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const fieldsOk = contactsValid(contacts);

  // ---- LIVE name check (v22.2): fires while typing so nobody fills the whole
  // form only to learn the name is taken/burned. Stale responses are dropped.
  type NameCheck =
    | { status: "free"; note?: string }
    | { status: "checking" }
    | { status: "duplicate" | "archived" | "blacklisted"; message: string; info: Record<string, string | null> };
  const [nameCheck, setNameCheck] = useState<NameCheck | null>(null);
  const checkSeq = useRef(0);
  const name = (form.name ?? "").trim();
  useEffect(() => {
    if (name.length < 2) {
      checkSeq.current++; // kill any in-flight response for the old text
      setNameCheck(null);
      return;
    }
    setNameCheck({ status: "checking" });
    const seq = ++checkSeq.current;
    const t = setTimeout(async () => {
      // fn matters (v23.2): the archive block is world-aware — B2C is only
      // blocked by its own archive, so switching function re-checks
      const res = await checkAccountNameLive(name, fn);
      if (seq !== checkSeq.current) return; // superseded by more typing
      setNameCheck(res.ok ? (res.data as NameCheck) : null);
    }, 450);
    return () => clearTimeout(t);
  }, [name, fn]);
  const nameBlocked =
    nameCheck != null && nameCheck.status !== "free" && nameCheck.status !== "checking";

  // ---- AUTOMATIC PODIO CHECK (v32): the same question the member used to
  // answer by opening the national form and typing into "Check if your company
  // exists?". Runs alongside the duplicate check, never blocks the form — a
  // partner already on Podio is a WARNING (don't submit a duplicate), and an
  // unreachable Podio just leaves the manual link.
  const [podio, setPodio] = useState<PodioCheck | "checking" | null>(null);
  const podioSeq = useRef(0);
  /** bumped by "Try again" — re-runs the check without retyping the name */
  const [podioNonce, setPodioNonce] = useState(0);
  useEffect(() => {
    if (name.length < 2) {
      podioSeq.current++;
      setPodio(null);
      return;
    }
    setPodio("checking");
    const seq = ++podioSeq.current;
    const t = setTimeout(async () => {
      const res = await checkPodioNameLive(name);
      if (seq !== podioSeq.current) return; // superseded by more typing
      setPodio(res.ok ? (res.data ?? null) : null);
    }, 600);
    return () => clearTimeout(t);
  }, [name, podioNonce]);

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
        industry: fn !== "IGT" && fn !== "B2C" ? form.industry : null,
        contacts,
        requested_podio: requestedPodio,
        request_state: (requestState || null) as "Checking" | "Approved" | null,
        comment: form.comment,
        // only send an owner when one was actually PICKED. Sending the
        // client's own id was how a stale page (rendered before a view-as
        // switch) posted the previous identity and got "You can only assign
        // accounts within your scope" — the server knows who you are.
        responsible_id:
          viewer.canAssignOthers && responsible !== viewer.id ? responsible : null,
      });
      if (!res.ok) {
        if (res.code === "duplicate" || res.code === "archived") {
          setBlock({ kind: res.code, message: res.error, info: res.info ?? {} });
        } else {
          toast.error(res.error);
        }
        return;
      }
      // reset the form and let the member choose: open it, or keep adding
      setForm({});
      setContacts([{ tag: "Contact", kind: "phone", value: "" }]);
      setRequestedPodio(false);
      setResponsible(viewer.id);
      setAdded({ name: form.name ?? "", slug: res.data!.slug });
      onOpenChange(false);
    });

  // B2B & BD are one crew — either label qualifies for either account kind
  const fnMembers = members.filter(
    (m) =>
      m.id === viewer.id ||
      (fn === "B2B" || fn === "BD"
        ? ["B2B", "BD"].some((f) => m.functions.includes(f))
        : m.functions.includes(fn))
  );

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o) setBlock(null); onOpenChange(o); }}>
      <DialogContent key={epoch} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            Names are checked against every function&apos;s accounts and your
            function&apos;s archive.
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
            {/* only worth asking when there IS a choice — a member with one
                function would just be confirming the obvious */}
            {viewer.allowedFns.length > 1 ? (
              <div className="grid gap-2">
                <Label>Function</Label>
                <Select value={fn} onValueChange={(v) => setFn(v as Fn)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {viewer.allowedFns.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
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
            <Input
              data-tour="add:name"
              value={form.name ?? ""}
              onChange={set("name")}
              placeholder="Company / organization name"
              aria-invalid={nameBlocked || undefined}
            />
            {/* live check — bad news arrives BEFORE the rest of the form is filled */}
            {nameCheck?.status === "checking" ? (
              <p className="text-xs text-muted-foreground">Checking the name…</p>
            ) : nameCheck?.status === "free" && nameCheck.note ? (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
                {nameCheck.note}
              </p>
            ) : nameCheck?.status === "free" && name.length >= 3 ? (
              <p className="text-xs font-medium text-success">✓ Name is free — go ahead</p>
            ) : nameBlocked && nameCheck && "message" in nameCheck ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <p className="font-semibold text-destructive">
                  {nameCheck.status === "duplicate" ? "🚫 Already exists" : "🗄️ Archived / blocked"} —{" "}
                  {nameCheck.message}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  {nameCheck.info.open ? (
                    <a
                      href={nameCheck.info.open}
                      className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      {nameCheck.status === "archived"
                        ? "See it in the archive →"
                        : "Open it and take it →"}
                    </a>
                  ) : null}
                  {/* the researcher has fresh information RIGHT NOW — let them
                      act on it here instead of hunting the archive (v33.7) */}
                  {nameCheck.info.revive ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                      onClick={() => {
                        const id = nameCheck.info.revive!;
                        startTransition(async () => {
                          const res = await reviveAndAssign(id);
                          if (!res.ok) {
                            toast.error(res.error);
                            return;
                          }
                          toast.success("Back in process — and it's yours 🙌");
                          router.push(`/accounts/${id}`);
                        });
                      }}
                    >
                      Bring it back and take it
                    </button>
                  ) : null}
                  {nameCheck.info.unblock ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                      onClick={() => {
                        const id = nameCheck.info.unblock!;
                        startTransition(async () => {
                          const res = await removeArchivedEntry(id);
                          if (!res.ok) {
                            toast.error(res.error);
                            return;
                          }
                          toast.success("Unblocked — you can add it now");
                          setNameCheck({ status: "free" });
                        });
                      }}
                    >
                      Unblock this name
                    </button>
                  ) : null}
                </div>
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-foreground">
                  {Object.entries(nameCheck.info)
                    .filter(([k, v]) => v && !["open", "revive", "unblock"].includes(k))
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="font-medium capitalize text-muted-foreground">
                          {k.replace(/_/g, " ")}
                        </dt>
                        <dd dir="auto">{v}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ) : null}

            {/* the Podio verdict — answers "do I have to fill the national
                form?" without leaving the dialog. Never blocks: a partner
                already on Podio is a warning, not a rejection. */}
            {!nameBlocked && podio === "checking" ? (
              <p className="text-xs text-muted-foreground">Checking Podio…</p>
            ) : !nameBlocked && podio && podio !== "checking" && podio.status === "exists" ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                <p className="font-semibold text-warning">
                  ⚠️ Already on Podio as “{podio.match}”
                </p>
                <p className="mt-1 text-foreground">
                  Do <b>not</b> submit it again. Someone already registered it —
                  another LC, or us. Add it here
                  {viewer.canSetRequestState
                    ? " and set its Podio state below once you know whose it is."
                    : " and ask your MM to check whose it is and set its Podio state."}
                </p>
              </div>
            ) : !nameBlocked && podio && podio !== "checking" && podio.status === "free" ? (
              <div className="rounded-lg border p-3 text-xs">
                <p className="font-medium text-foreground">
                  🔎 Not on Podio — you still need to submit it on the form
                </p>
                {podio.similar.length > 0 ? (
                  <p className="mt-1 text-muted-foreground">
                    Podio did return:{" "}
                    <span className="font-medium text-foreground" dir="auto">
                      {podio.similar.join(" · ")}
                    </span>{" "}
                    — check it isn&apos;t the same partner spelled differently.
                  </p>
                ) : null}
                {PODIO_FORM_URL ? (
                  <p className="mt-1">
                    <a
                      href={PODIO_FORM_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Open the Podio form →
                    </a>
                  </p>
                ) : null}
                {/* only meaningful for a name Podio does NOT have — asking
                    "did you request it?" about an existing partner is noise */}
                <label className="mt-2 flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                  <span className="font-medium text-foreground">
                    I already submitted it
                  </span>
                  <Switch checked={requestedPodio} onCheckedChange={setRequestedPodio} />
                </label>
              </div>
            ) : !nameBlocked && podio && podio !== "checking" ? (
              // status "unknown" — Podio didn't answer. This used to render
              // NOTHING, so a failed check looked exactly like a check that
              // never ran, and the member had no idea whether the name was
              // safe to submit (v33.4).
              <div className="rounded-lg border border-dashed p-3 text-xs">
                <p className="font-medium text-foreground">
                  Couldn&apos;t reach Podio just now
                </p>
                <p className="mt-1 text-muted-foreground">
                  Nothing is wrong with the name — the check itself failed. Adding the
                  account here is fine; check the form yourself before submitting it.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => setPodioNonce((n) => n + 1)}
                  >
                    Try again
                  </button>
                  {PODIO_FORM_URL ? (
                    <a
                      href={PODIO_FORM_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Open the Podio form →
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* REQUEST STATE AT CREATION (v33.4).
                It first shipped INSIDE the "not on Podio" box and behind the
                "I already submitted it" switch — two conditions deep, so in
                practice nobody ever saw it. It belongs here, under the Podio
                area, for anyone who may set one: the verdict you most want to
                record a state against is "already on Podio", which was
                precisely the branch that never offered it. */}
            {viewer.canSetRequestState && !nameBlocked ? (
              <div className="grid gap-1.5 rounded-lg border bg-background px-3 py-2.5">
                <Label className="text-xs">Podio state — if you already know</Label>
                <Select
                  value={requestState || "none"}
                  onValueChange={(v) => setRequestState(v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Not heard back yet" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not heard back yet</SelectItem>
                    <SelectItem value="Checking">Checking</SelectItem>
                    <SelectItem value="Approved">Approved</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  Where the name stands on Podio. &quot;Rejected&quot; archives an
                  account, so it isn&apos;t offered here — set that on the account
                  itself if the answer comes back no.
                </span>
              </div>
            ) : null}
          </div>

          {fn === "B2C" ? (
            <div className="grid gap-2">
              <Label>Type *</Label>
              <Select
                value={form.account_type || undefined}
                onValueChange={(v) => setVal("account_type")(v)}
              >
                <SelectTrigger><SelectValue placeholder="Courses / Events / Student activities…" /></SelectTrigger>
                <SelectContent>
                  {B2C_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : fn === "IGT" ? (
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

          <div className="grid gap-2" data-tour="add:contacts">
            <Label>Contact info (phones · emails · links, each with a tag)</Label>
            <ContactsEditor rows={contacts} onChange={setContacts} />
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
              nameBlocked ||
              !fieldsOk ||
              viewer.allowedFns.length === 0 ||
              (fn === "IGT" && !form.product) ||
              (fn === "IGV" && !form.project) ||
              (fn === "B2C" && !form.account_type)
            }
          >
            {pending ? "Checking…" : nameBlocked ? "Name is blocked" : "Add account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* success: open the fresh account, or keep the flow and add another */}
    <Dialog
      open={!!added}
      onOpenChange={(o) => {
        if (!o) {
          setAdded(null);
          onOpenChange(false);
          router.refresh();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>🎉 &quot;{added?.name}&quot; is in!</DialogTitle>
          <DialogDescription>
            The account was added — jump into it now, or keep the form open and
            add the next one.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => {
              // fresh form: clear the popup, hard-remount the form (epoch key
              // resets the pickers' internal state) and REOPEN the dialog
              setAdded(null);
              setEpoch((e) => e + 1);
              setFn(viewer.allowedFns[0] ?? "IGT");
              onOpenChange(true);
            }}
          >
            <Plus className="size-4" /> Add another
          </Button>
          <Button
            onClick={() => {
              const slug = added!.slug;
              setAdded(null);
              onOpenChange(false);
              router.push(`/accounts/${slug}`);
            }}
          >
            Open the account →
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
