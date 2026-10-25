"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, CalendarClock, ExternalLink, EyeOff, Globe, Loader2, Pencil, RotateCcw, Trash2, Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtDateTime, LC_FUNCTIONS, MEMBER_ROLES } from "@/lib/types";
import {
  TAB_REGISTRY, describeRule, publicTwinLive, tabIsGone,
  type TabAudience, type TabBase, type TabDef, type TabRule,
} from "@/lib/tabs";
import { resetTabRule, restoreTab, retireTab, saveTabOrder, saveTabRule } from "@/server/tab-actions";
import { ChipPick, PeoplePick, type PickPerson } from "./people-pick";

/** SETTINGS → TABS (v38) — the LCP and the admins decide who sees which
 *  sidebar tab, rename it, order it, open/close it on dates and retire it.
 *  The rule engine is src/lib/tabs.ts; this is only its editor. */

const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

export function TabManager({ rules, people }: { rules: TabRule[]; people: PickPerson[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<TabDef | null>(null);
  const [retiring, setRetiring] = useState<TabDef | null>(null);
  const byHref = useMemo(() => new Map(rules.map((r) => [r.href, r])), [rules]);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);

  const ordered = useMemo(() => {
    const pos = (t: TabDef, i: number) => byHref.get(t.href)?.position ?? 1000 + i;
    return TAB_REGISTRY.map((t, i) => ({ t, k: pos(t, i) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.t);
  }, [byHref]);
  // one clock per render pass — set once, the list is refreshed on every save
  const [now] = useState(() => Date.now());
  const live = ordered.filter((t) => !byHref.get(t.href) || !tabIsGone(byHref.get(t.href)!, now));
  const gone = ordered.filter((t) => byHref.get(t.href) && tabIsGone(byHref.get(t.href)!, now));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Couldn't save.");
      else {
        toast.success(okMsg);
        router.refresh();
      }
    });

  const move = (href: string, dir: -1 | 1) => {
    const hrefs = ordered.map((t) => t.href);
    const i = hrefs.indexOf(href);
    const j = i + dir;
    if (j < 0 || j >= hrefs.length) return;
    [hrefs[i], hrefs[j]] = [hrefs[j], hrefs[i]];
    run(() => saveTabOrder(hrefs), "Order saved — new sidebars start like this.");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-1.5 pt-4">
          <p className="pb-2 text-xs text-muted-foreground">
            Every tab follows its rule in the code until you set one here. A tab you hide is gone from
            the sidebar <b>and</b> its page sends that person home. A tab you show to someone the code
            would refuse opens the page for them, but what&apos;s inside still follows their role, so
            a data module can look empty to them. Members can still arrange their own sidebar; the
            order here is where a fresh sidebar starts.
          </p>
          {live.map((t, i) => {
            const rule = byHref.get(t.href);
            const custom = !!rule && (rule.base !== "default" || rule.label || rule.visibleFrom || rule.removeAt ||
              rule.show.members.length + rule.show.roles.length + rule.show.functions.length +
              rule.hide.members.length + rule.hide.roles.length + rule.hide.functions.length > 0 ||
              rule.publicOff);
            const removeSoon = rule?.removeAt && Date.parse(rule.removeAt) > now;
            const notYet = rule?.visibleFrom && Date.parse(rule.visibleFrom) > now;
            return (
              <div
                key={t.href}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg border p-2.5",
                  custom && "border-primary/40 bg-primary/5"
                )}
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label={`Move ${t.label} up`}
                    disabled={pending || i === 0}
                    onClick={() => move(t.href, -1)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${t.label} down`}
                    disabled={pending || i === live.length - 1}
                    onClick={() => move(t.href, 1)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    {rule?.label ?? t.label}
                    {rule?.label ? <span className="text-xs font-normal text-muted-foreground">(was {t.label})</span> : null}
                    <code className="text-[11px] font-normal text-muted-foreground">{t.href}</code>
                    {notYet ? (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <CalendarClock className="size-3" /> opens {fmtDateTime(rule!.visibleFrom!)}
                      </Badge>
                    ) : null}
                    {removeSoon ? (
                      <Badge variant="outline" className="gap-1 border-amber-500/60 text-[10px] text-amber-700 dark:text-amber-400">
                        <CalendarClock className="size-3" /> removed {fmtDateTime(rule!.removeAt!)}
                      </Badge>
                    ) : null}
                    {t.publicHref ? (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Globe className="size-3" /> {t.publicHref} {publicTwinLive(rule, now) ? "live" : "down"}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {describeRule(rule, names, now)}
                    {!custom ? ` — ${t.builtIn}` : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(t)} disabled={pending}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRetiring(t)}
                    disabled={pending}
                    aria-label={`Retire ${t.label}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {gone.length > 0 ? (
        <Card>
          <CardContent className="space-y-1.5 pt-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <EyeOff className="size-4" /> Retired tabs
            </p>
            <p className="text-xs text-muted-foreground">
              Hidden from everyone. Their data is untouched — restoring brings the tab back as it was.
            </p>
            {gone.map((t) => {
              const rule = byHref.get(t.href)!;
              return (
                <div key={t.href} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2.5 opacity-80">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{rule.label ?? t.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.retiredAt
                        ? `Retired ${fmtDateTime(rule.retiredAt)}`
                        : `Removed on ${fmtDateTime(rule.removeAt!)}`}
                      {rule.updatedBy ? ` · by ${rule.updatedBy}` : ""}
                      {t.publicHref ? ` · ${t.publicHref} ${publicTwinLive(rule, now) ? "still live" : "down"}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => restoreTab(t.href), `${t.label} is back.`)}>
                    <Undo2 className="size-3.5" /> Restore
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {editing ? (
        <EditTabDialog
          def={editing}
          rule={byHref.get(editing.href)}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {retiring ? (
        <RetireDialog
          def={retiring}
          pending={pending}
          onClose={() => setRetiring(null)}
          onConfirm={(publicToo) => {
            const t = retiring;
            setRetiring(null);
            run(() => retireTab(t.href, publicToo), `${t.label} retired. Restore it any time below.`);
          }}
        />
      ) : null}
    </div>
  );
}

function RetireDialog({
  def, pending, onClose, onConfirm,
}: {
  def: TabDef;
  pending: boolean;
  onClose: () => void;
  onConfirm: (publicToo: boolean) => void;
}) {
  const [publicToo, setPublicToo] = useState(true);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retire “{def.label}”?</DialogTitle>
          <DialogDescription>
            It disappears from every sidebar and its page sends people home. Nothing is deleted from the
            database, so you can restore it later from “Retired tabs”.
          </DialogDescription>
        </DialogHeader>
        {def.publicHref ? (
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>
              Also take the public page <code>{def.publicHref}</code> down
            </span>
            <Switch checked={publicToo} onCheckedChange={setPublicToo} />
          </label>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={pending} onClick={() => onConfirm(publicToo)}>
            <Trash2 className="size-4" /> Retire
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FUNCTION_CHOICES = [...LC_FUNCTIONS, "Raising", "Consideration", "ICX", "OGX", "Finance"];

function AudienceBlock({
  title, hint, value, onChange, people, tone,
}: {
  title: string;
  hint: string;
  value: TabAudience;
  onChange: (a: TabAudience) => void;
  people: PickPerson[];
  tone: "primary" | "destructive";
}) {
  return (
    <div className={cn("grid gap-2 rounded-lg border p-3", tone === "destructive" ? "border-destructive/30" : "border-primary/30")}>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Label className="text-xs">Roles</Label>
      <ChipPick tone={tone} options={MEMBER_ROLES} value={value.roles} onChange={(roles) => onChange({ ...value, roles })} />
      <Label className="text-xs">Functions</Label>
      <ChipPick tone={tone} options={FUNCTION_CHOICES} value={value.functions} onChange={(functions) => onChange({ ...value, functions })} />
      <Label className="text-xs">People</Label>
      <PeoplePick people={people} value={value.members} onChange={(members) => onChange({ ...value, members })} listHeight="max-h-40" />
    </div>
  );
}

function EditTabDialog({
  def, rule, people, onClose, onSaved,
}: {
  def: TabDef;
  rule: TabRule | undefined;
  people: PickPerson[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [label, setLabel] = useState(rule?.label ?? "");
  const [base, setBase] = useState<TabBase>(rule?.base ?? "default");
  const [show, setShow] = useState<TabAudience>(rule?.show ?? { members: [], roles: [], functions: [] });
  const [hide, setHide] = useState<TabAudience>(rule?.hide ?? { members: [], roles: [], functions: [] });
  const [visibleFrom, setVisibleFrom] = useState(toLocalInput(rule?.visibleFrom ?? null));
  const [removeAt, setRemoveAt] = useState(toLocalInput(rule?.removeAt ?? null));
  const [publicLive, setPublicLive] = useState(!(rule?.publicOff ?? false));
  const [publicWithTab, setPublicWithTab] = useState(rule?.publicWithTab ?? false);
  const [note, setNote] = useState(rule?.note ?? "");

  const save = () =>
    start(async () => {
      const res = await saveTabRule({
        href: def.href,
        label,
        base,
        show,
        hide,
        visibleFrom: fromLocalInput(visibleFrom),
        removeAt: fromLocalInput(removeAt),
        publicOff: !publicLive,
        publicWithTab,
        note,
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`${label || def.label} saved.`);
        onSaved();
      }
    });
  const reset = () =>
    start(async () => {
      const res = await resetTabRule(def.href);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(`${def.label} follows the code again.`);
        onSaved();
      }
    });

  const BASES: { v: TabBase; title: string; hint: string }[] = [
    { v: "default", title: "As the code says", hint: def.builtIn },
    { v: "everyone", title: "Everyone", hint: "Every signed-in member" },
    { v: "nobody", title: "Nobody", hint: "Only the people / groups you add below" },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit tab — {def.label}</DialogTitle>
          <DialogDescription>
            A person named below always wins over a role or function; on the same level, hiding wins
            over showing.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="tab-label">Name in the sidebar</Label>
            <Input id="tab-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={def.label} maxLength={40} />
          </div>

          <div className="grid gap-1.5">
            <Label>Who sees it, to start with</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {BASES.map((b) => (
                <button
                  key={b.v}
                  type="button"
                  onClick={() => setBase(b.v)}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors",
                    base === b.v ? "border-primary bg-primary/10" : "hover:bg-muted"
                  )}
                >
                  <p className="text-sm font-semibold">{b.title}</p>
                  <p className="text-xs text-muted-foreground">{b.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <AudienceBlock
            title="Also show it to"
            hint="Opens the tab for these, even if the code wouldn't."
            value={show}
            onChange={setShow}
            people={people}
            tone="primary"
          />
          <AudienceBlock
            title="Hide it from"
            hint="Takes the tab away from these, and blocks its page."
            value={hide}
            onChange={setHide}
            people={people}
            tone="destructive"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tab-from">Show from (optional)</Label>
              <Input id="tab-from" type="datetime-local" value={visibleFrom} onChange={(e) => setVisibleFrom(e.target.value)} />
              <p className="text-xs text-muted-foreground">Hidden for everyone until then.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tab-until">Remove on (optional)</Label>
              <Input id="tab-until" type="datetime-local" value={removeAt} onChange={(e) => setRemoveAt(e.target.value)} />
              <p className="text-xs text-muted-foreground">Retires itself at that moment — e.g. after a bid is done.</p>
            </div>
          </div>

          {def.publicHref ? (
            <div className="grid gap-2 rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Globe className="size-4" /> Public page
                <a href={def.publicHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-normal text-primary underline">
                  {def.publicHref} <ExternalLink className="size-3" />
                </a>
              </p>
              <label className="flex items-center justify-between gap-3 text-sm">
                Live for anyone with the link
                <Switch checked={publicLive} onCheckedChange={setPublicLive} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                Goes down when this tab is retired or removed
                <Switch checked={publicWithTab} onCheckedChange={setPublicWithTab} />
              </label>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="tab-note">Note for the other admins (optional)</Label>
            <Textarea id="tab-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={reset} disabled={pending || !rule}>
            <RotateCcw className="size-4" /> Back to the code&apos;s rule
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
