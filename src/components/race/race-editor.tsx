"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check, Copy, ExternalLink, Flag, KeyRound, Link2, Loader2, Plus, RefreshCw, RotateCcw, Settings2, Trash2, Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { cairoToday, fmtDateTime } from "@/lib/types";
import {
  PROGRAMS, RACE_LIMITS, SIDES, isHex, raceClock, racePhase, sumPrograms,
  type RaceSettings, type RaceSnapshot, type Side,
} from "@/lib/race/model";
import type { RaceEntryRow, RaceReadingRow } from "@/server/race";
import {
  addRaceEntry, addRaceReading, deleteRaceReading, readCoreNow, renewRivalLink, saveRaceSettings,
  setRaceEntriesDeleted, takeCoreBaseline,
} from "@/server/race-actions";

/** Form drafts keep numbers as TEXT, so a cleared field is "" (and refused),
 *  never a silent 0. */
type SideDraft = { name: string; short: string; color: string; coreId: string; coreOn: boolean; baseline: Record<string, string> };
type Draft = {
  title: string;
  tagline: string;
  finale: string;
  startDate: string;
  deadlineDate: string;
  deadlineTime: string;
  approvalsGoal: string;
  slotsGoal: string;
  rivalCanLog: boolean;
  home: SideDraft;
  rival: SideDraft;
  show: RaceSettings["show"];
};

const toSide = (s: RaceSettings["home"]): SideDraft => ({
  name: s.name,
  short: s.short,
  color: s.color,
  coreId: String(s.coreId),
  coreOn: s.coreOn,
  baseline: Object.fromEntries(PROGRAMS.map((p) => [p, String(s.baseline[p])])),
});
const toDraft = (s: RaceSettings): Draft => ({
  title: s.title,
  tagline: s.tagline,
  finale: s.finale,
  startDate: s.startDate,
  deadlineDate: s.deadlineDate,
  deadlineTime: s.deadlineTime,
  approvalsGoal: String(s.approvalsGoal),
  slotsGoal: String(s.slotsGoal),
  rivalCanLog: s.rivalCanLog,
  home: toSide(s.home),
  rival: toSide(s.rival),
  show: { ...s.show },
});
const fromSide = (d: SideDraft) => ({
  name: d.name,
  short: d.short,
  color: d.color,
  coreId: Number(d.coreId),
  coreOn: d.coreOn,
  baseline: Object.fromEntries(PROGRAMS.map((p) => [p, Number(d.baseline[p])])),
});
const toPatch = (d: Draft) => ({
  title: d.title,
  tagline: d.tagline,
  finale: d.finale,
  startDate: d.startDate,
  deadlineDate: d.deadlineDate,
  deadlineTime: d.deadlineTime,
  approvalsGoal: Number(d.approvalsGoal),
  slotsGoal: Number(d.slotsGoal),
  rivalCanLog: d.rivalCanLog,
  home: fromSide(d.home),
  rival: fromSide(d.rival),
  show: d.show,
});
const wholeIn = (v: string, min: number, max: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

function draftProblem(d: Draft): string | null {
  if (!d.title.trim()) return "The race needs a title.";
  if (!wholeIn(d.approvalsGoal, 1, RACE_LIMITS.goal)) return "The approvals goal must be a whole number.";
  if (!wholeIn(d.slotsGoal, 1, RACE_LIMITS.goal)) return "The slots goal must be a whole number.";
  if (!d.startDate || !d.deadlineDate) return "Both dates are needed.";
  if (d.deadlineDate < d.startDate) return "The deadline can't be before the start.";
  if (!/^\d{2}:\d{2}$/.test(d.deadlineTime)) return "The deadline time isn't valid.";
  for (const side of SIDES) {
    const s = d[side];
    if (!s.name.trim()) return "Every LC needs a name.";
    if (!isHex(s.color)) return `${s.name}'s colour must look like #037EF3.`;
    if (!wholeIn(s.coreId, 1, 10_000_000)) return `${s.name}'s CORE id must be a whole number.`;
    for (const p of PROGRAMS) if (!wholeIn(s.baseline[p], 0, RACE_LIMITS.baseline)) return `${s.name}'s ${p} start count must be a whole number.`;
  }
  return null;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy — select it and copy by hand.");
  }
}

export function RaceEditor({
  settings, meta, snapshot, readings, entries, dealCount, publicUrl, deskUrl, readOnly,
}: {
  settings: RaceSettings;
  meta: { updatedAt: string | null; updatedBy: string | null };
  snapshot: RaceSnapshot;
  readings: RaceReadingRow[];
  entries: RaceEntryRow[];
  dealCount: number;
  publicUrl: string;
  deskUrl: string | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const saved = useMemo(() => JSON.stringify(toDraft(settings)), [settings]);
  const dirty = JSON.stringify(draft) !== saved;
  const problem = draftProblem(draft);
  // a save (or a refresh) brings new settings — take them when nothing is
  // pending here (adjusting state while rendering, React's own pattern)
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    if (JSON.stringify(draft) === seen) setDraft(toDraft(settings));
  }
  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong.");
        return;
      }
      if (done) toast.success(done);
      router.refresh();
    });

  const save = () =>
    start(async () => {
      const res = await saveRaceSettings(toPatch(draft));
      if (!res.ok) return void toast.error(res.error);
      toast.success("Saved — the board has it");
      if (res.data) setDraft(toDraft(res.data.settings));
      router.refresh();
    });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setSide = (side: Side, patch: Partial<SideDraft>) => setDraft((d) => ({ ...d, [side]: { ...d[side], ...patch } }));

  const clock = raceClock(settings);
  const phase = racePhase(clock, openedAt);
  const a = snapshot.approvals;
  const sl = snapshot.slots;

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-24">
      {/* header */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 font-display text-xl font-bold">
              <Flag className="size-5 text-primary" /> {settings.home.name} vs {settings.rival.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {settings.title} · {phase === "over" ? "finished" : phase === "before" ? "not started" : "live"} · deadline{" "}
              {fmtDateTime(new Date(clock.deadline).toISOString())}
              {meta.updatedAt ? ` · last saved ${fmtDateTime(meta.updatedAt)}${meta.updatedBy ? ` by ${meta.updatedBy}` : ""}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => copy(publicUrl, "Public link")}>
              <Copy className="size-4" /> Copy public link
            </Button>
            <Button asChild size="sm">
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Open the board
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
      {readOnly ? (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          You&apos;re in a test view — you can look around, but changes are off.
        </p>
      ) : null}

      {/* the scoreboard */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(["approvals", "slots"] as const).map((metric) => {
          const m = metric === "approvals" ? a : sl;
          return (
            <Card key={metric}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {metric === "approvals" ? `Approvals → ${settings.approvalsGoal}` : `Slots → ${settings.slotsGoal}`}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {SIDES.map((side) => (
                  <div key={side} className="space-y-1">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{settings[side].name}</span>
                      <span className="font-mono text-lg font-semibold">
                        {m[side].value}
                        <span className="text-xs text-muted-foreground">/{m[side].goal}</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (m[side].value / m[side].goal) * 100)}%`, background: settings[side].color }} />
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  {m.winner
                    ? `🏁 ${settings[m.winner].name} reached the goal first.`
                    : m.leader
                      ? `${settings[m.leader].name} leads by ${Math.abs(m.home.value - m.rival.value)}.`
                      : "Level."}
                  {metric === "slots" ? ` ${settings.home.name}'s come from ${dealCount} Sodio deal${dealCount === 1 ? "" : "s"} since the start, plus any entries below.` : ""}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* CORE */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="size-4" /> Approvals from CORE
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Sodio reads both LCs on CORE when the board opens and every hour, and keeps a reading each time a number changes.
            If CORE is wrong, add a reading by hand — or switch CORE off for that LC below so only your readings count.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {SIDES.map((side) => {
              const l = a[side];
              return (
                <div key={side} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{settings[side].name}</p>
                  <p className="text-muted-foreground">
                    CORE total {l.total ?? "—"} · start {l.baseline} · since start <b className="text-foreground">{l.value}</b>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {l.readAt ? `Last reading ${fmtDateTime(l.readAt)} (${l.source === "manual" ? "by hand" : "CORE"})` : "No reading yet"}
                    {!settings[side].coreOn ? " · CORE switched off" : ""}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" variant="outline" disabled={pending || readOnly} onClick={() => run(readCoreNow, "Read CORE — numbers are current")}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Read CORE now
            </Button>
            <ManualReading disabled={pending || readOnly} settings={settings} onAdd={(side, total) => run(() => addRaceReading(side, total), "Reading added")} />
          </div>
        </CardContent>
      </Card>

      {/* MUST's link */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" /> {settings.rival.name}&apos;s private slots link
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {settings.rival.name} opens this link (no login) to add the slots they raise. Anyone holding it can add slots for{" "}
            {settings.rival.name}, so send it to their VP only. Making a new link kills the old one at once.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {deskUrl ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={deskUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(deskUrl, "Link")}>
                  <Copy className="size-4" /> Copy
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={deskUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" /> Open
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No link yet.</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant={deskUrl ? "outline" : "default"}
              disabled={pending || readOnly}
              onClick={() => {
                if (deskUrl && !window.confirm(`Make a new link? The current one stops working for ${settings.rival.name} immediately.`)) return;
                run(renewRivalLink, deskUrl ? "New link made — send it to them" : "Link made — copy it and send it");
              }}
            >
              <Link2 className="size-4" /> {deskUrl ? "Make a new link" : `Create ${settings.rival.name}'s link`}
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.rivalCanLog} onCheckedChange={(v) => set("rivalCanLog", v)} disabled={readOnly} />
              {settings.rival.name} can log slots
            </label>
          </div>
        </CardContent>
      </Card>

      {/* settings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4" /> The race
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Title (a number at the end turns into the big gradient number)">
            <Input value={draft.title} maxLength={40} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Closing line (the big scrolling words)">
            <Input value={draft.finale} maxLength={60} onChange={(e) => set("finale", e.target.value)} />
          </Field>
          <Field label="Tagline" className="sm:col-span-2">
            <Input value={draft.tagline} maxLength={200} onChange={(e) => set("tagline", e.target.value)} />
          </Field>
          <Field label="Counts from (Cairo)">
            <Input type="date" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Field label="Deadline (Cairo)">
              <Input type="date" value={draft.deadlineDate} onChange={(e) => set("deadlineDate", e.target.value)} />
            </Field>
            <Field label="Time">
              <Input type="time" value={draft.deadlineTime} onChange={(e) => set("deadlineTime", e.target.value)} />
            </Field>
          </div>
          <Field label="Approvals goal (each LC)">
            <Input inputMode="numeric" value={draft.approvalsGoal} onChange={(e) => set("approvalsGoal", e.target.value)} />
          </Field>
          <Field label="Slots goal (each LC)">
            <Input inputMode="numeric" value={draft.slotsGoal} onChange={(e) => set("slotsGoal", e.target.value)} />
          </Field>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {SIDES.map((side) => {
          const d = draft[side];
          const startTotal = PROGRAMS.reduce((t, p) => t + (Number(d.baseline[p]) || 0), 0);
          return (
            <Card key={side}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="size-3 rounded-full" style={{ background: isHex(d.color) ? d.color : "#999" }} />
                  {side === "home" ? "Our LC" : "The rival LC"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <Field label="Name">
                    <Input value={d.name} maxLength={30} onChange={(e) => setSide(side, { name: e.target.value })} />
                  </Field>
                  <Field label="Short tag">
                    <Input value={d.short} maxLength={8} onChange={(e) => setSide(side, { short: e.target.value.toUpperCase() })} />
                  </Field>
                </div>
                <div className="grid grid-cols-[3rem_1fr_7rem] items-end gap-2">
                  <Field label="Colour">
                    <input
                      type="color"
                      aria-label={`${d.name} colour`}
                      value={isHex(d.color) ? d.color : "#999999"}
                      onChange={(e) => setSide(side, { color: e.target.value })}
                      className="h-9 w-12 cursor-pointer rounded-md border bg-transparent"
                    />
                  </Field>
                  <Field label="Hex">
                    <Input value={d.color} maxLength={7} onChange={(e) => setSide(side, { color: e.target.value })} className="font-mono" />
                  </Field>
                  <Field label="CORE LC id">
                    <Input inputMode="numeric" value={d.coreId} onChange={(e) => setSide(side, { coreId: e.target.value })} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={d.coreOn} onCheckedChange={(v) => setSide(side, { coreOn: v })} disabled={readOnly} />
                  Read this LC&apos;s approvals from CORE
                </label>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <Label className="text-xs">Start counts (CORE approved, per program) · total {startTotal}</Label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      disabled={pending || readOnly || dirty}
                      title={dirty ? "Save or undo your other changes first" : undefined}
                      onClick={() => {
                        if (!window.confirm(`Restart ${settings[side].name}'s count from today's CORE numbers? Their "since start" goes back to 0.`)) return;
                        run(() => takeCoreBaseline([side]), "Start counts taken from CORE");
                      }}
                    >
                      <RotateCcw className="size-3.5" /> Use today&apos;s CORE
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {PROGRAMS.map((p) => (
                      <Field key={p} label={p}>
                        <Input
                          inputMode="numeric"
                          value={d.baseline[p]}
                          onChange={(e) => setSide(side, { baseline: { ...d.baseline, [p]: e.target.value } })}
                          className="px-2 text-center font-mono"
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">What the board shows</CardTitle>
          <p className="text-xs text-muted-foreground">Taking the whole page down lives in Settings → Tabs (LCP &amp; admins).</p>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["programs", "Where the approvals come from (per program)"],
              ["slots", "The slots race"],
              ["trail", "The trail chart"],
              ["together", "Together to the combined goal"],
              ["feed", "Latest moves"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Switch checked={draft.show[k]} onCheckedChange={(v) => set("show", { ...draft.show, [k]: v })} disabled={readOnly} />
              {label}
            </label>
          ))}
        </CardContent>
      </Card>

      <EntriesCard entries={entries} settings={settings} pending={pending} readOnly={readOnly} run={run} />
      <ReadingsCard readings={readings} settings={settings} pending={pending} readOnly={readOnly} run={run} />

      {/* the save bar */}
      {dirty || problem ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-2">
            <p className={cn("mr-auto min-w-0 text-sm", problem ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
              {problem ?? "Unsaved changes"}
            </p>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDraft(toDraft(settings))}>
              <Undo2 className="size-4" /> Undo
            </Button>
            <Button size="sm" disabled={pending || readOnly || !!problem} onClick={save}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("grid min-w-0 gap-1.5 text-xs font-medium", className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ManualReading({ settings, disabled, onAdd }: { settings: RaceSettings; disabled: boolean; onAdd: (side: Side, total: number) => void }) {
  const [side, setSide] = useState<Side>("home");
  const [total, setTotal] = useState("");
  const ok = /^\d+$/.test(total.trim());
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select value={side} onValueChange={(v) => setSide(v as Side)}>
        <SelectTrigger className="h-9 w-36" aria-label="Which LC">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SIDES.map((s) => (
            <SelectItem key={s} value={s}>
              {settings[s].name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        inputMode="numeric"
        placeholder={`CORE total, e.g. ${sumPrograms(settings[side].baseline) + 5}`}
        value={total}
        onChange={(e) => setTotal(e.target.value)}
        className="h-9 w-56"
        aria-label="Total approvals on CORE"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || !ok}
        onClick={() => {
          onAdd(side, Number(total));
          setTotal("");
        }}
      >
        <Plus className="size-4" /> Add reading by hand
      </Button>
    </div>
  );
}

type Runner = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => void;

function EntriesCard({ entries, settings, pending, readOnly, run }: { entries: RaceEntryRow[]; settings: RaceSettings; pending: boolean; readOnly: boolean; run: Runner }) {
  const [side, setSide] = useState<Side>("rival");
  const [qty, setQty] = useState("1");
  const [day, setDay] = useState(cairoToday());
  const [note, setNote] = useState("");
  const [show, setShow] = useState<"live" | "deleted">("live");
  const list = entries.filter((e) => (show === "live" ? !e.deleted_at : !!e.deleted_at));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Slots entries</CardTitle>
        <p className="text-xs text-muted-foreground">
          {settings.rival.name}&apos;s slots arrive here from their link. Add slots for either LC by hand ({settings.home.name}&apos;s deals in Sodio
          already count on their own — only add slots raised outside Sodio).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[9rem_6rem_10rem_1fr_auto] sm:items-end">
          <Select value={side} onValueChange={(v) => setSide(v as Side)}>
            <SelectTrigger aria-label="Which LC">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIDES.map((s) => (
                <SelectItem key={s} value={s}>
                  {settings[s].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Slots" />
          <Input type="date" value={day} min={settings.startDate} max={cairoToday()} onChange={(e) => setDay(e.target.value)} aria-label="Raised on" />
          <Input value={note} maxLength={RACE_LIMITS.note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional, never public)" />
          <Button
            size="sm"
            disabled={pending || readOnly || !wholeIn(qty, 1, RACE_LIMITS.qty)}
            onClick={() => {
              run(() => addRaceEntry({ side, qty: Number(qty), occurredOn: day, note }), "Slots added");
              setQty("1");
              setNote("");
            }}
          >
            <Plus className="size-4" /> Add
          </Button>
        </div>
        <div className="flex gap-1">
          {(["live", "deleted"] as const).map((k) => (
            <Button key={k} size="sm" variant={show === k ? "secondary" : "ghost"} onClick={() => setShow(k)}>
              {k === "live" ? "Counting" : "Deleted"}
            </Button>
          ))}
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.slice(0, 200).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-sm">
                <Badge style={{ background: settings[e.side].color, color: "#050716" }}>{settings[e.side].short}</Badge>
                <b className="font-mono">+{e.qty}</b>
                <span className="text-muted-foreground">{e.occurred_on}</span>
                <span className="min-w-0 flex-1 truncate">{e.note ?? ""}</span>
                <span className="text-xs text-muted-foreground">
                  {e.source === "link" ? `via ${settings.rival.name}'s link` : `by ${e.created_by_name ?? "an editor"}`} · {fmtDateTime(e.created_at)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  disabled={pending || readOnly}
                  onClick={() => run(() => setRaceEntriesDeleted([e.id], !e.deleted_at), e.deleted_at ? "Restored" : "Deleted — it's off the board")}
                  aria-label={e.deleted_at ? "Restore" : "Delete"}
                >
                  {e.deleted_at ? <Undo2 className="size-4" /> : <Trash2 className="size-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ReadingsCard({ readings, settings, pending, readOnly, run }: { readings: RaceReadingRow[]; settings: RaceSettings; pending: boolean; readOnly: boolean; run: Runner }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Readings ({readings.length})</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Every change Sodio saw on CORE, newest first. Delete one only if it was wrong.</p>
      </CardHeader>
      {open ? (
        <CardContent>
          {readings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No readings yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {readings.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-sm">
                  <Badge style={{ background: settings[r.side].color, color: "#050716" }}>{settings[r.side].short}</Badge>
                  <b className="font-mono">{r.total}</b>
                  <span className="text-muted-foreground">(+{Math.max(0, r.total - sumPrograms(settings[r.side].baseline))} since start)</span>
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {r.source === "manual" ? `by hand${r.created_by_name ? ` · ${r.created_by_name}` : ""}` : "CORE"} · {fmtDateTime(r.at)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    disabled={pending || readOnly}
                    aria-label="Delete reading"
                    onClick={() => {
                      if (!window.confirm("Delete this reading? The board recalculates without it.")) return;
                      run(() => deleteRaceReading(r.id), "Reading deleted");
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
