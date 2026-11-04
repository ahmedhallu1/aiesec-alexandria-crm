"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bus, Check, Eye, Loader2, Search, Settings2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/types";
import { isHttpsUrl, isIsoDate, primaryFunction, type ActivateSettings, type WarPerson, type WarSettings } from "@/lib/war/model";
import { saveWarSettings, setDelegates } from "@/server/war-actions";
import { ActivatePrompt } from "@/components/crm/activate-prompt";

/** WAR ROOM → ACTIVATE (v38.5). The F&L VP ticks who registered (the bus on
 *  /no-peace fills, the in-app reminder stops for them) and edits every word
 *  of the registration details, the APD goal and the bus's seats. */

type Tick = { member_id: string; marked_at: string; marked_by_name: string | null };
type Draft = Omit<ActivateSettings, "apdGoal" | "seats"> & { apdGoal: string; seats: string };

const toDraft = (a: ActivateSettings): Draft => ({ ...a, apdGoal: String(a.apdGoal), seats: String(a.seats) });
const fromDraft = (d: Draft): ActivateSettings => ({ ...d, apdGoal: Number(d.apdGoal), seats: Number(d.seats), formUrl: d.formUrl.trim() });
const wholeIn = (v: string, min: number, max: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

function problem(d: Draft): string | null {
  if (!d.name.trim()) return "The event needs a name.";
  if (!wholeIn(d.apdGoal, 1, 100000)) return "The APD goal must be a whole number.";
  if (!wholeIn(d.seats, 1, 1000)) return "Seats must be a whole number from 1 to 1000.";
  if (!isIsoDate(d.deadline)) return "The registration deadline isn't a date.";
  if (d.formUrl.trim() && !isHttpsUrl(d.formUrl.trim())) return "The form link must start with https://";
  if (d.announcement.length > 1200) return "The announcement is too long (1200 characters at most).";
  return null;
}

export function ActivatePanel({
  settings, people, ticks, readOnly,
}: {
  settings: WarSettings;
  people: WarPerson[];
  ticks: Tick[];
  readOnly: boolean;
}) {
  return (
    <div className="space-y-4">
      <Delegation people={people} ticks={ticks} seats={settings.activate.seats} readOnly={readOnly} />
      <ActivateSettingsCard activate={settings.activate} seatsTaken={ticks.length} readOnly={readOnly} />
    </div>
  );
}

function Delegation({ people, ticks, seats, readOnly }: { people: WarPerson[]; ticks: Tick[]; seats: number; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "in" | "out">("all");
  // optimistic ticks: the switch moves at once, the server catches up
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const byId = useMemo(() => new Map(ticks.map((t, i) => [t.member_id, { ...t, seat: i + 1 }])), [ticks]);
  // fresh ticks from the server replace the optimistic ones
  const [seenTicks, setSeenTicks] = useState(ticks);
  if (seenTicks !== ticks) {
    setSeenTicks(ticks);
    setLocal({});
  }
  const isIn = (id: string) => local[id] ?? byId.has(id);

  // active members, plus anyone already ticked (an inactive member who paid stays)
  const pool = useMemo(
    () => people.filter((p) => p.is_active || byId.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [people, byId]
  );
  const count = pool.filter((p) => isIn(p.id)).length;
  const needle = q.trim().toLowerCase();
  const list = pool.filter((p) => {
    if (show === "in" && !isIn(p.id)) return false;
    if (show === "out" && isIn(p.id)) return false;
    if (!needle) return true;
    return p.name.toLowerCase().includes(needle) || [...p.functions, ...p.sub_functions, p.role].some((x) => x.toLowerCase().includes(needle));
  });

  const toggle = (ids: string[], on: boolean) => {
    setLocal((l) => ({ ...l, ...Object.fromEntries(ids.map((id) => [id, on])) }));
    start(async () => {
      const res = await setDelegates(ids, on);
      if (!res.ok) {
        toast.error(res.error);
        setLocal((l) => {
          const n = { ...l };
          for (const id of ids) delete n[id];
          return n;
        });
        return;
      }
      if (ids.length > 1) toast.success(on ? `${ids.length} people on the bus` : `${ids.length} people off the bus`);
      router.refresh();
    });
  };

  const notYet = list.filter((p) => !isIn(p.id)).map((p) => p.id);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bus className="size-4" /> Who registered
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Tick someone once their registration (down payment) is confirmed. They get a seat on the bus on /no-peace — in the order
          you tick them — and Sodio stops reminding them to register.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold">{count}</span>
          <span className="text-sm text-muted-foreground">
            of {seats} seats · {pool.filter((p) => p.is_active).length} active members
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (count / seats) * 100)}%` }} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, function or role" className="pl-8" />
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border p-1">
            {(
              [
                ["all", "Everyone"],
                ["in", "Registered"],
                ["out", "Not yet"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={show === k}
                onClick={() => setShow(k)}
                className={cn("min-h-9 rounded-md px-2 text-xs font-semibold", show === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {needle && notYet.length > 1 && notYet.length <= 60 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={readOnly || pending}
            onClick={() => {
              if (window.confirm(`Mark all ${notYet.length} shown as registered?`)) toggle(notYet, true);
            }}
          >
            <Check className="size-4" /> Mark all {notYet.length} shown as registered
          </Button>
        ) : null}
        <ul className="divide-y rounded-lg border">
          {list.length === 0 ? <li className="p-3 text-sm text-muted-foreground">Nobody matches.</li> : null}
          {list.map((p) => {
            const on = isIn(p.id);
            const t = byId.get(p.id);
            return (
              <li key={p.id} className={cn("flex items-center gap-3 p-2.5", on && "bg-primary/5")}>
                <Switch
                  checked={on}
                  onCheckedChange={(v) => toggle([p.id], v)}
                  disabled={readOnly}
                  aria-label={`${p.name} registered`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.name}
                    {!p.is_active ? <span className="ml-1 text-xs text-muted-foreground">(inactive)</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.role} · {primaryFunction(p)}
                    {on && t ? ` · seat #${t.seat} · ticked ${fmtDateTime(t.marked_at)}${t.marked_by_name ? ` by ${t.marked_by_name}` : ""}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function ActivateSettingsCard({ activate, seatsTaken, readOnly }: { activate: ActivateSettings; seatsTaken: number; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState<Draft>(() => toDraft(activate));
  const saved = useMemo(() => JSON.stringify(toDraft(activate)), [activate]);
  const dirty = JSON.stringify(d) !== saved;
  const err = problem(d);
  const [preview, setPreview] = useState(false);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    if (JSON.stringify(d) === seen) setD(toDraft(activate));
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = () =>
    start(async () => {
      const res = await saveWarSettings({ activate: fromDraft(d) });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Saved — /no-peace and the reminder have it");
      if (res.data) setD(toDraft(res.data.settings.activate));
      router.refresh();
    });

  const field = (k: keyof Draft, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium">
      <span>{label}</span>
      <Input value={String(d[k])} onChange={(e) => set(k, e.target.value as never)} {...props} />
    </label>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="size-4" /> Activate on the board &amp; the reminder
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          What /no-peace shows about Activate, and what the reminder says to everyone not ticked yet. The APD goal counts the same
          approvals as Alex vs MUST (from its start date).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={d.enabled} onCheckedChange={(v) => set("enabled", v)} disabled={readOnly} />
            Show Activate on /no-peace
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={d.prompt} onCheckedChange={(v) => set("prompt", v)} disabled={readOnly} />
            Remind everyone not registered when they open Sodio
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {field("name", "Event name")}
          {field("apdGoal", "APD goal", { inputMode: "numeric" })}
          {field("seats", "Seats on the bus", { inputMode: "numeric" })}
          {field("dates", "Dates (as people should read them)")}
          {field("location", "Location")}
          {field("deadline", "Registration deadline (the reminder stops after it)", { type: "date" })}
          {field("fees", "Fees")}
          {field("downPayment", "Down payment")}
          {field("payVia", "Pay through (e.g. InstaPay or Wallet)")}
          {field("payNumber", "Payment number", { inputMode: "tel" })}
          <div className="sm:col-span-2">{field("formUrl", "Registration form link", { type: "url", placeholder: "https://forms.gle/…" })}</div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="act-msg" className="text-xs">
            The COD&apos;s message (shown as written, line breaks kept)
          </Label>
          <Textarea id="act-msg" rows={4} maxLength={1200} value={d.announcement} onChange={(e) => set("announcement", e.target.value)} />
        </div>
        <div className="max-w-sm">{field("signedBy", "Signed by")}</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {err ? (
            <p className="mr-auto text-xs text-destructive">{err}</p>
          ) : dirty ? (
            <p className="mr-auto text-xs font-medium text-amber-700 dark:text-amber-400">Unsaved changes</p>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setPreview(true)} disabled={!!err}>
            <Eye className="size-4" /> Preview the reminder
          </Button>
          {dirty ? (
            <Button size="sm" variant="ghost" onClick={() => setD(toDraft(activate))} disabled={pending}>
              <Undo2 className="size-4" /> Undo
            </Button>
          ) : null}
          <Button size="sm" onClick={save} disabled={pending || readOnly || !!err || !dirty}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
          </Button>
        </div>
      </CardContent>
      {err ? null : (
        <ActivatePrompt
          preview
          open={preview}
          onOpenChange={setPreview}
          data={{ ...fromDraft(d), seatsTaken, seats: Number(d.seats) }}
        />
      )}
    </Card>
  );
}
