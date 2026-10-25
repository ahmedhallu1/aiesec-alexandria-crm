"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check, Copy, ExternalLink, Gift, ListChecks, Loader2, Medal, Minus, Pencil, Plus, Radio, RotateCcw,
  ScrollText, Search, Settings2, Swords, Trash2, Trophy, Undo2, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { cairoToday, fmtDateTime, LC_FUNCTIONS } from "@/lib/types";
import {
  BONUS, COMPETITOR_ROLES, LIMITS, entryPoints, isCompetitor, kindLabel, primaryFunction, rewardFor,
  slugKey, splitDuration, standings, warClock, warDay, warPhase,
  type PointGroup, type PointType, type Reward, type WarPerson, type WarSettings,
} from "@/lib/war/model";
import type { WarEntryRow } from "@/server/war";
import {
  deleteWarEntries, logWarEntries, restoreWarEntries, saveWarSettings, updateWarEntry,
} from "@/server/war-actions";
import { ChipPick, PeoplePick } from "@/components/crm/people-pick";

type Tab = "log" | "standings" | "entries" | "settings";

const TABS: { key: Tab; label: string; icon: typeof Swords }[] = [
  { key: "log", label: "Log points", icon: Plus },
  { key: "standings", label: "Standings", icon: Trophy },
  { key: "entries", label: "Entries", icon: ListChecks },
  { key: "settings", label: "Settings", icon: Settings2 },
];

export function WarRoomView({
  settings,
  settingsMeta,
  people,
  entries,
  publicUrl,
  readOnly,
}: {
  settings: WarSettings;
  settingsMeta: { updatedAt: string | null; updatedBy: string | null };
  people: WarPerson[];
  entries: WarEntryRow[];
  publicUrl: string;
  readOnly: boolean;
}) {
  const [tab, setTab] = useState<Tab>("log");
  const [focusPerson, setFocusPerson] = useState<string | null>(null);
  const live = useMemo(() => entries.filter((e) => !e.deleted_at), [entries]);
  const rows = useMemo(() => standings(people, live, settings), [people, live, settings]);
  const competitors = useMemo(() => people.filter((p) => isCompetitor(p, settings.competitors)), [people, settings]);
  const totals = useMemo(
    () => ({
      points: rows.reduce((a, r) => a + r.points, 0),
      enlisted: rows.filter((r) => r.eligible).length,
      entries: live.length,
    }),
    [rows, live]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <WarHeader settings={settings} totals={{ ...totals, troops: rows.length }} publicUrl={publicUrl} />
      {readOnly ? (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          You&apos;re in a test view — you can look around, but logging is off (it would be credited to someone else).
        </p>
      ) : null}

      <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
              tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "log" ? (
        <LogPanel settings={settings} competitors={competitors} entries={live} readOnly={readOnly} />
      ) : tab === "standings" ? (
        <StandingsPanel
          settings={settings}
          rows={rows}
          onOpenPerson={(id) => {
            setFocusPerson(id);
            setTab("entries");
          }}
        />
      ) : tab === "entries" ? (
        <EntriesPanel
          settings={settings}
          people={people}
          entries={entries}
          focus={focusPerson}
          onFocusChange={setFocusPerson}
          readOnly={readOnly}
        />
      ) : (
        <SettingsPanel settings={settings} meta={settingsMeta} people={people} readOnly={readOnly} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ header

function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function WarHeader({
  settings, totals, publicUrl,
}: {
  settings: WarSettings;
  totals: { points: number; enlisted: number; entries: number; troops: number };
  publicUrl: string;
}) {
  const now = useNow();
  const clock = warClock(settings);
  const phase = warPhase(clock, now);
  const left = splitDuration((phase === "before" ? clock.start : clock.end) - now);
  const [copied, setCopied] = useState(false);
  return (
    <Card className="overflow-hidden border-0 bg-[linear-gradient(120deg,#1d2b33,#24414a_55%,#5b3b22)] text-[#f3e6c8] shadow-lg">
      <CardContent className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.3em] text-[#e7c27d] uppercase">
            <Swords className="size-4" /> War Room
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] tracking-normal",
                phase === "live" ? "bg-red-600 text-white" : "bg-white/15"
              )}
            >
              {phase === "live" ? `● Live · Day ${warDay(clock, now)} of ${clock.totalDays}` : phase === "before" ? "Not started" : "Over"}
            </span>
          </p>
          <h1 className="text-3xl font-black tracking-tight uppercase">{settings.name}</h1>
          <p className="text-sm text-[#f3e6c8]/80">
            {phase === "over"
              ? "The war is over — the standings are final."
              : `${phase === "before" ? "Starts" : "Ends"} in ${left.d}d ${String(left.h).padStart(2, "0")}h ${String(left.m).padStart(2, "0")}m ${String(left.s).padStart(2, "0")}s`}
            {" · "}
            {settings.minPoints} points to compete for rewards
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild size="sm" className="bg-[#e7c27d] text-[#1d2b33] hover:bg-[#f0d49a]">
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <Radio className="size-4" /> Open the live page <ExternalLink className="size-3.5" />
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-white/30 bg-transparent text-[#f3e6c8] hover:bg-white/10 hover:text-white"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center md:grid-cols-2">
          {[
            { k: "War points", v: totals.points },
            { k: "Entries", v: totals.entries },
            { k: "Troops", v: totals.troops },
            { k: "Enlisted", v: totals.enlisted },
          ].map((s) => (
            <div key={s.k} className="rounded-lg bg-black/20 px-3 py-2">
              <p className="font-mono text-xl font-bold tabular-nums">{s.v.toLocaleString()}</p>
              <p className="text-[10px] tracking-wider text-[#f3e6c8]/70 uppercase">{s.k}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ log

function LogPanel({
  settings, competitors, entries, readOnly,
}: {
  settings: WarSettings;
  competitors: WarPerson[];
  entries: WarEntryRow[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [who, setWho] = useState<string[]>([]);
  const [kind, setKind] = useState<string>(settings.pointTypes[0]?.key ?? BONUS);
  const [qty, setQty] = useState(1);
  const [bonus, setBonus] = useState("5");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(() => cairoToday());
  const types = useMemo(() => new Map(settings.pointTypes.map((t) => [t.key, t])), [settings]);
  const isBonus = kind === BONUS;
  const each = isBonus ? Math.round(Number(bonus)) || 0 : (types.get(kind)?.points ?? 0) * qty;
  const fnGroups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of competitors) {
      const f = primaryFunction(p);
      m.set(f, [...(m.get(f) ?? []), p.id]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [competitors]);

  const submit = () =>
    start(async () => {
      const res = await logWarEntries({
        memberIds: who,
        kind,
        qty,
        points: Math.round(Number(bonus)),
        note,
        occurredOn: day,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const ids = res.data?.ids ?? [];
      toast.success(
        `${each >= 0 ? "+" : ""}${each} for ${res.data?.count === 1 ? "1 person" : `${res.data?.count} people`} — live on the page.`,
        {
          action: ids.length
            ? {
                label: "Undo",
                onClick: () => {
                  deleteWarEntries(ids).then((r) => {
                    if (r.ok) {
                      toast.success("Undone.");
                      router.refresh();
                    } else toast.error(r.error);
                  });
                },
              }
            : undefined,
        }
      );
      setWho([]);
      setNote("");
      setQty(1);
      router.refresh();
    });

  const recent = entries.slice(0, 8);
  const byId = useMemo(() => new Map(competitors.map((p) => [p.id, p.name])), [competitors]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="grid size-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">1</span>
            Who scored?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setWho(competitors.map((p) => p.id))}
              className="rounded-full border px-2.5 py-0.5 text-xs font-semibold hover:border-primary"
            >
              <Users className="mr-1 inline size-3" /> Everyone ({competitors.length})
            </button>
            {fnGroups.map(([f, ids]) => (
              <button
                key={f}
                type="button"
                onClick={() => setWho((w) => [...new Set([...w, ...ids])])}
                className="rounded-full border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
              >
                + all {f} ({ids.length})
              </button>
            ))}
          </div>
          <PeoplePick
            people={competitors.map((p) => ({ id: p.id, name: p.name, role: p.role, functions: [primaryFunction(p)] }))}
            value={who}
            onChange={setWho}
            placeholder="Search the troops…"
            listHeight="max-h-72"
          />
          <p className="text-xs text-muted-foreground">
            Only people in the race are listed (active, and allowed by Settings → Who competes).
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="grid size-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">2</span>
              What did they do?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {settings.pointTypes.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setKind(t.key)}
                  className={cn(
                    "rounded-lg border p-2 text-left transition-all",
                    kind === t.key ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "hover:bg-muted"
                  )}
                >
                  <p className="text-xs font-bold">{t.label}</p>
                  <p className="font-mono text-lg leading-none font-bold text-primary">+{t.points}</p>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setKind(BONUS)}
                className={cn(
                  "rounded-lg border border-dashed p-2 text-left transition-all",
                  isBonus ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30" : "hover:bg-muted"
                )}
              >
                <p className="text-xs font-bold">Bonus / penalty</p>
                <p className="text-xs text-muted-foreground">attendance, engagement…</p>
              </button>
            </div>

            {isBonus ? (
              <div className="grid gap-1.5">
                <Label htmlFor="war-bonus">Points (use − for a penalty)</Label>
                <Input id="war-bonus" type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} className="font-mono" />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Label className="mr-auto">How many?</Label>
                <Button size="icon" variant="outline" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="One fewer">
                  <Minus className="size-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  max={LIMITS.qty}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(LIMITS.qty, Math.round(Number(e.target.value)) || 1)))}
                  className="w-20 text-center font-mono"
                />
                <Button size="icon" variant="outline" onClick={() => setQty((q) => Math.min(LIMITS.qty, q + 1))} aria-label="One more">
                  <Plus className="size-4" />
                </Button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <div className="grid gap-1.5">
                <Label htmlFor="war-note">Comment {isBonus ? "(e.g. “Checkpoint 1 — attendance”)" : "(optional)"}</Label>
                <Input id="war-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.note} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="war-day">Date</Label>
                <Input id="war-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3">
              <p className="min-w-0 flex-1 text-sm">
                <b>{who.length}</b> {who.length === 1 ? "person" : "people"} ×{" "}
                <b>{isBonus ? "Bonus" : `${kindLabel(kind, types)}${qty > 1 ? ` ×${qty}` : ""}`}</b> ={" "}
                <b className={cn("font-mono", each < 0 ? "text-destructive" : "text-primary")}>
                  {each >= 0 ? "+" : ""}
                  {each}
                </b>{" "}
                each
              </p>
              <Button onClick={submit} disabled={pending || readOnly || who.length === 0 || each === 0}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Swords className="size-4" />} Log it
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="size-4" /> Latest dispatches
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing logged yet — the first points start the war.</p>
            ) : (
              recent.map((e) => {
                const pts = entryPoints(e, types);
                return (
                  <div key={e.id} className="flex items-center gap-2 text-sm">
                    <span className={cn("w-12 shrink-0 text-right font-mono font-bold", pts < 0 ? "text-destructive" : "text-primary")}>
                      {pts >= 0 ? "+" : ""}
                      {pts}
                    </span>
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {byId.get(e.member_id) ?? "—"} · {kindLabel(e.kind, types)}
                      {e.kind !== BONUS && e.qty > 1 ? ` ×${e.qty}` : ""}
                      {e.note ? <span className="text-muted-foreground"> — {e.note}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(e.created_at)}</span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ standings

function StandingsPanel({
  settings, rows, onOpenPerson,
}: {
  settings: WarSettings;
  rows: ReturnType<typeof standings>;
  onOpenPerson: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [fn, setFn] = useState("all");
  const [role, setRole] = useState("all");
  const [enlistedOnly, setEnlistedOnly] = useState(false);
  const fns = useMemo(() => [...new Set(rows.map((r) => r.fn))].sort(), [rows]);
  const roles = useMemo(() => [...new Set(rows.map((r) => r.role))].sort(), [rows]);
  const shown = rows.filter(
    (r) =>
      (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())) &&
      (fn === "all" || r.fn === fn) &&
      (role === "all" || r.role === role) &&
      (!enlistedOnly || r.eligible)
  );
  const max = Math.max(settings.minPoints, ...rows.map((r) => r.points), 1);

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name…" className="pl-8" />
          </div>
          <Select value={fn} onValueChange={setFn}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All functions</SelectItem>
              {fns.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={enlistedOnly} onCheckedChange={setEnlistedOnly} /> {settings.minPoints}+ only
          </label>
          <span className="text-xs text-muted-foreground">{shown.length} of {rows.length}</span>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-right">Points</th>
                <th className="hidden px-2 py-2 text-left md:table-cell">Progress</th>
                {settings.pointTypes.map((t) => (
                  <th key={t.key} className="hidden px-1.5 py-2 text-center whitespace-nowrap xl:table-cell" title={`${t.label} (+${t.points})`}>
                    {t.label}
                  </th>
                ))}
                <th className="hidden px-1.5 py-2 text-center xl:table-cell">Bonus</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const reward = rewardFor(r, settings.rewards);
                return (
                  <tr
                    key={r.id}
                    onClick={() => onOpenPerson(r.id)}
                    className={cn("cursor-pointer border-t hover:bg-muted/40", !r.eligible && "text-muted-foreground")}
                  >
                    <td className="px-2 py-1.5 font-mono font-bold">{r.rank}</td>
                    <td className="px-2 py-1.5">
                      <p className="font-semibold text-foreground" dir="auto">
                        {r.name}
                        {reward ? <span className="ml-1.5" title={reward.title}>{reward.emoji}</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{r.fn} · {r.role}</p>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-base font-bold text-foreground tabular-nums">{r.points}</td>
                    <td className="hidden w-48 px-2 py-1.5 md:table-cell">
                      <div className="relative h-2 rounded-full bg-muted">
                        <div
                          className={cn("absolute inset-y-0 left-0 rounded-full", r.eligible ? "bg-primary" : "bg-muted-foreground/40")}
                          style={{ width: `${Math.max(0, (r.points / max) * 100)}%` }}
                        />
                        <div
                          className="absolute -top-1 h-4 w-0.5 bg-amber-500"
                          style={{ left: `${(settings.minPoints / max) * 100}%` }}
                          title={`${settings.minPoints} to enlist`}
                        />
                      </div>
                    </td>
                    {settings.pointTypes.map((t) => (
                      <td key={t.key} className="hidden px-1.5 py-1.5 text-center font-mono xl:table-cell">
                        {r.breakdown[t.key] || ""}
                      </td>
                    ))}
                    <td className="hidden px-1.5 py-1.5 text-center font-mono xl:table-cell">{r.breakdown[BONUS] || ""}</td>
                  </tr>
                );
              })}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={20} className="p-6 text-center text-muted-foreground">Nobody matches those filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Ties share a rank. The amber mark is the {settings.minPoints}-point line to compete for rewards. Click a row for
          that person&apos;s entries.
        </p>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ entries

const PAGE = 50;

function EntriesPanel({
  settings, people, entries, focus, onFocusChange, readOnly,
}: {
  settings: WarSettings;
  people: WarPerson[];
  entries: WarEntryRow[];
  focus: string | null;
  onFocusChange: (id: string | null) => void;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [by, setBy] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<WarEntryRow | null>(null);
  const types = useMemo(() => new Map(settings.pointTypes.map((t) => [t.key, t])), [settings]);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const loggers = useMemo(
    () => [...new Map(entries.filter((e) => e.created_by).map((e) => [e.created_by!, e.created_by_name ?? "—"])).entries()],
    [entries]
  );
  const term = q.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      (showDeleted ? !!e.deleted_at : !e.deleted_at) &&
      (!focus || e.member_id === focus) &&
      (kind === "all" || e.kind === kind) &&
      (by === "all" || e.created_by === by) &&
      (!from || e.occurred_on >= from) &&
      (!to || e.occurred_on <= to) &&
      (!term || (names.get(e.member_id) ?? "").toLowerCase().includes(term) || (e.note ?? "").toLowerCase().includes(term))
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = shown.slice(cur * PAGE, cur * PAGE + PAGE);
  const sum = shown.reduce((a, e) => a + entryPoints(e, types), 0);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Couldn't save.");
      else {
        toast.success(ok);
        setSel([]);
        router.refresh();
      }
    });

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search a name or comment…" className="pl-8" />
          </div>
          <Select value={kind} onValueChange={(v) => { setKind(v); setPage(0); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              {settings.pointTypes.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
              <SelectItem value={BONUS}>Bonus</SelectItem>
            </SelectContent>
          </Select>
          <Select value={by} onValueChange={(v) => { setBy(v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Logged by anyone</SelectItem>
              {loggers.map(([id, n]) => <SelectItem key={id} value={id}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="w-36" aria-label="From" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="w-36" aria-label="To" />
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={showDeleted} onCheckedChange={(v) => { setShowDeleted(v); setSel([]); setPage(0); }} /> Deleted
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {focus ? (
            <Badge variant="secondary" className="gap-1">
              {names.get(focus) ?? "—"}
              <button type="button" onClick={() => onFocusChange(null)} aria-label="Show everyone">×</button>
            </Badge>
          ) : null}
          <span className="text-muted-foreground">
            {shown.length} entries · <b className="font-mono text-foreground">{sum >= 0 ? "+" : ""}{sum}</b> points
          </span>
          {sel.length > 0 && !readOnly ? (
            showDeleted ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => restoreWarEntries(sel), `${sel.length} restored.`)}>
                <Undo2 className="size-4" /> Restore {sel.length}
              </Button>
            ) : (
              <Button size="sm" variant="destructive" disabled={pending} onClick={() => act(() => deleteWarEntries(sel), `${sel.length} deleted — find them under “Deleted”.`)}>
                <Trash2 className="size-4" /> Delete {sel.length}
              </Button>
            )
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select this page"
                    checked={slice.length > 0 && slice.every((e) => sel.includes(e.id))}
                    onChange={(ev) =>
                      setSel(ev.target.checked ? [...new Set([...sel, ...slice.map((e) => e.id)])] : sel.filter((id) => !slice.some((e) => e.id === id)))
                    }
                  />
                </th>
                <th className="px-2 py-2 text-left">Who</th>
                <th className="px-2 py-2 text-left">What</th>
                <th className="px-2 py-2 text-right">Points</th>
                <th className="hidden px-2 py-2 text-left md:table-cell">Comment</th>
                <th className="hidden px-2 py-2 text-left sm:table-cell">Date</th>
                <th className="hidden px-2 py-2 text-left lg:table-cell">Logged</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {slice.map((e) => {
                const pts = entryPoints(e, types);
                return (
                  <tr key={e.id} className={cn("border-t", e.deleted_at && "opacity-60")}>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label="Select"
                        checked={sel.includes(e.id)}
                        onChange={(ev) => setSel(ev.target.checked ? [...sel, e.id] : sel.filter((x) => x !== e.id))}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-medium" dir="auto">{names.get(e.member_id) ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      {kindLabel(e.kind, types)}
                      {e.kind !== BONUS && e.qty > 1 ? <span className="text-muted-foreground"> ×{e.qty}</span> : null}
                    </td>
                    <td className={cn("px-2 py-1.5 text-right font-mono font-bold", pts < 0 ? "text-destructive" : "text-primary")}>
                      {pts >= 0 ? "+" : ""}{pts}
                    </td>
                    <td className="hidden max-w-60 truncate px-2 py-1.5 text-muted-foreground md:table-cell" title={e.note ?? ""}>{e.note}</td>
                    <td className="hidden px-2 py-1.5 whitespace-nowrap sm:table-cell">{e.occurred_on}</td>
                    <td className="hidden px-2 py-1.5 text-xs whitespace-nowrap text-muted-foreground lg:table-cell">
                      {e.created_by_name ?? "—"} · {fmtDateTime(e.created_at)}
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {readOnly ? null : e.deleted_at ? (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => restoreWarEntries([e.id]), "Restored.")}>
                          <Undo2 className="size-3.5" />
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label="Edit">
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={pending}
                            onClick={() => act(() => deleteWarEntries([e.id]), "Deleted — find it under “Deleted”.")}
                            aria-label="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {slice.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground">
                    {showDeleted ? "Nothing deleted." : "No entries match."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {cur + 1} of {pages}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Prev</Button>
            <Button size="sm" variant="outline" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</Button>
          </div>
        </div>
      </CardContent>

      {editing ? (
        <EditEntryDialog
          entry={editing}
          name={names.get(editing.member_id) ?? "—"}
          label={kindLabel(editing.kind, types)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

function EditEntryDialog({
  entry, name, label, onClose, onSaved,
}: {
  entry: WarEntryRow;
  name: string;
  label: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const isBonus = entry.kind === BONUS;
  const [qty, setQty] = useState(String(entry.qty));
  const [points, setPoints] = useState(String(entry.points ?? 0));
  const [note, setNote] = useState(entry.note ?? "");
  const [day, setDay] = useState(entry.occurred_on);
  const save = () =>
    start(async () => {
      const r = await updateWarEntry(entry.id, {
        ...(isBonus ? { points: Number(points) } : { qty: Number(qty) }),
        note,
        occurredOn: day,
      });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success("Saved — the page moved with it.");
        onSaved();
      }
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit entry</DialogTitle>
          <DialogDescription>{name} · {label}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {isBonus ? (
            <div className="grid gap-1.5">
              <Label>Points</Label>
              <Input type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label>How many</Label>
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Comment</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.note} />
          </div>
          <div className="grid gap-1.5">
            <Label>Date</Label>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : null} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ settings

function Section({
  title, icon: Icon, blurb, children, onSave, pending, readOnly,
}: {
  title: string;
  icon: typeof Swords;
  blurb: string;
  children: React.ReactNode;
  onSave: () => void;
  pending: boolean;
  readOnly: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4" /> {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{blurb}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        <div className="flex justify-end">
          <Button size="sm" onClick={onSave} disabled={pending || readOnly}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsPanel({
  settings, meta, people, readOnly,
}: {
  settings: WarSettings;
  meta: { updatedAt: string | null; updatedBy: string | null };
  people: WarPerson[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = (patch: Partial<WarSettings>, msg = "Saved — live on the page.") =>
    start(async () => {
      const r = await saveWarSettings(patch as Record<string, unknown>);
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(msg);
        router.refresh();
      }
    });

  // campaign
  const [c, setC] = useState({
    name: settings.name,
    tagline: settings.tagline,
    startDate: settings.startDate,
    endDate: settings.endDate,
    minPoints: String(settings.minPoints),
    activateLabel: settings.activateLabel,
    activateDate: settings.activateDate,
    activateTime: settings.activateTime,
    motto: settings.motto,
    heroLines: settings.heroLines.join("\n"),
  });
  const [types, setTypes] = useState<PointType[]>(settings.pointTypes);
  const [rewards, setRewards] = useState<Reward[]>(settings.rewards);
  const [rules, setRules] = useState(settings.rules.join("\n"));
  const [comp, setComp] = useState(settings.competitors);
  const [show, setShow] = useState(settings.show);
  const [pairFn, setPairFn] = useState("TM");
  const [pairRole, setPairRole] = useState("Coordinator");
  const pickPeople = useMemo(
    () =>
      people
        .filter((p) => p.is_active)
        .map((p) => ({ id: p.id, name: p.name, role: p.role, functions: [primaryFunction(p)] })),
    [people]
  );
  const inRace = people.filter((p) => isCompetitor(p, comp)).length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title="The campaign"
        icon={Swords}
        blurb="Name, dates and the line people must cross to compete for rewards."
        pending={pending}
        readOnly={readOnly}
        onSave={() =>
          save({
            name: c.name,
            tagline: c.tagline,
            startDate: c.startDate,
            endDate: c.endDate,
            minPoints: Number(c.minPoints),
            activateLabel: c.activateLabel,
            activateDate: c.activateDate,
            activateTime: c.activateTime,
            motto: c.motto,
            heroLines: c.heroLines.split("\n").map((l) => l.trim()).filter(Boolean),
          })
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} maxLength={40} /></Field>
          <Field label="Points to compete"><Input type="number" min={0} value={c.minPoints} onChange={(e) => setC({ ...c, minPoints: e.target.value })} /></Field>
          <Field label="War starts (Cairo)"><Input type="date" value={c.startDate} onChange={(e) => setC({ ...c, startDate: e.target.value })} /></Field>
          <Field label="War ends (last day, Cairo)"><Input type="date" value={c.endDate} onChange={(e) => setC({ ...c, endDate: e.target.value })} /></Field>
          <Field label="Countdown to (label)"><Input value={c.activateLabel} onChange={(e) => setC({ ...c, activateLabel: e.target.value })} /></Field>
          <div className="grid grid-cols-[1fr_6.5rem] gap-2">
            <Field label="Its date"><Input type="date" value={c.activateDate} onChange={(e) => setC({ ...c, activateDate: e.target.value })} /></Field>
            <Field label="Time"><Input type="time" value={c.activateTime} onChange={(e) => setC({ ...c, activateTime: e.target.value })} /></Field>
          </div>
        </div>
        <Field label="Tagline"><Textarea rows={2} value={c.tagline} onChange={(e) => setC({ ...c, tagline: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hero lines (one per line)"><Textarea rows={3} value={c.heroLines} onChange={(e) => setC({ ...c, heroLines: e.target.value })} /></Field>
          <Field label="Motto (footer)"><Input value={c.motto} onChange={(e) => setC({ ...c, motto: e.target.value })} /></Field>
        </div>
      </Section>

      <Section
        title="The point system"
        icon={Medal}
        blurb="What each achievement is worth. Changing a value re-scores every entry already logged."
        pending={pending}
        readOnly={readOnly}
        onSave={() => save({ pointTypes: types })}
      >
        <div className="space-y-1.5">
          {types.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_4.5rem_5.5rem_auto] items-center gap-1.5">
              <Input
                value={t.label}
                onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Label"
                maxLength={LIMITS.label}
              />
              <Input
                type="number"
                min={0}
                value={t.points}
                onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))}
                className="font-mono"
                aria-label="Points"
              />
              <Select value={t.group} onValueChange={(v) => setTypes(types.map((x, j) => (j === i ? { ...x, group: v as PointGroup } : x)))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["OGX", "ICX", "LC"] as PointGroup[]).map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setTypes(types.filter((_, j) => j !== i))} aria-label="Remove">
                <Trash2 className="size-4" />
              </Button>
              <Input
                value={t.hint}
                onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, hint: e.target.value } : x)))}
                placeholder="One line for the public card"
                className="col-span-4 h-8 text-xs"
              />
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={types.length >= LIMITS.pointTypes}
          onClick={() => setTypes([...types, { key: slugKey(`new_${types.length}`), label: "", points: 5, group: "LC", hint: "" }])}
        >
          <Plus className="size-4" /> Add an achievement
        </Button>
      </Section>

      <Section
        title="War rewards"
        icon={Gift}
        blurb="Who wins what. The rank is the place among everyone over the points line."
        pending={pending}
        readOnly={readOnly}
        onSave={() => save({ rewards })}
      >
        <div className="space-y-2">
          {rewards.map((r, i) => (
            <div key={i} className="grid grid-cols-[3.5rem_3.5rem_1fr_auto] items-center gap-1.5 rounded-lg border p-2">
              <Input type="number" min={1} value={r.rank} aria-label="Rank" onChange={(e) => setRewards(rewards.map((x, j) => (j === i ? { ...x, rank: Number(e.target.value) } : x)))} />
              <Input value={r.emoji} aria-label="Emoji" className="text-center" onChange={(e) => setRewards(rewards.map((x, j) => (j === i ? { ...x, emoji: e.target.value } : x)))} />
              <Input value={r.title} placeholder="Reward" onChange={(e) => setRewards(rewards.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setRewards(rewards.filter((_, j) => j !== i))} aria-label="Remove">
                <Trash2 className="size-4" />
              </Button>
              <Input value={r.place} placeholder="Place label (1st, Runner-up…)" className="col-span-2 h-8 text-xs" onChange={(e) => setRewards(rewards.map((x, j) => (j === i ? { ...x, place: e.target.value } : x)))} />
              <Input value={r.detail} placeholder="Details shown in the pop-up" className="col-span-2 h-8 text-xs" onChange={(e) => setRewards(rewards.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)))} />
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={rewards.length >= LIMITS.rewards}
          onClick={() => setRewards([...rewards, { rank: rewards.length + 1, place: `#${rewards.length + 1}`, title: "", detail: "", emoji: "🎖️" }])}
        >
          <Plus className="size-4" /> Add a reward
        </Button>
      </Section>

      <Section
        title="Rules of engagement"
        icon={ScrollText}
        blurb="One rule per line — shown on the page exactly as written."
        pending={pending}
        readOnly={readOnly}
        onSave={() => save({ rules: rules.split("\n").map((l) => l.trim()).filter(Boolean) })}
      >
        <Textarea rows={6} value={rules} onChange={(e) => setRules(e.target.value)} />
      </Section>

      <Section
        title="Who competes"
        icon={Users}
        blurb={`Active members only, always. ${inRace} people are in the race with these settings.`}
        pending={pending}
        readOnly={readOnly}
        onSave={() => save({ competitors: comp })}
      >
        <Field label="Roles in the race">
          <ChipPick options={COMPETITOR_ROLES} value={comp.roles} onChange={(roles) => setComp({ ...comp, roles })} />
        </Field>
        <Field label="Left out by function + role">
          <div className="flex flex-wrap gap-1.5">
            {comp.excludeFunctionRoles.map((p) => (
              <Badge key={p} variant="secondary" className="gap-1">
                {p.replace(":", " ")}s
                <button type="button" aria-label={`Bring back ${p}`} onClick={() => setComp({ ...comp, excludeFunctionRoles: comp.excludeFunctionRoles.filter((x) => x !== p) })}>×</button>
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={pairFn} onValueChange={setPairFn}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{LC_FUNCTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={pairRole} onValueChange={setPairRole}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{COMPETITOR_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const p = `${pairFn}:${pairRole}`;
                if (!comp.excludeFunctionRoles.includes(p)) setComp({ ...comp, excludeFunctionRoles: [...comp.excludeFunctionRoles, p] });
              }}
            >
              <Plus className="size-4" /> Leave out
            </Button>
          </div>
        </Field>
        <Field label="Always out (by name)">
          <PeoplePick people={pickPeople} value={comp.exclude} onChange={(exclude) => setComp({ ...comp, exclude })} listHeight="max-h-36" />
        </Field>
        <Field label="Always in (by name)">
          <PeoplePick people={pickPeople} value={comp.include} onChange={(include) => setComp({ ...comp, include })} listHeight="max-h-36" />
        </Field>
      </Section>

      <Section
        title="The public page"
        icon={Radio}
        blurb="What /no-peace shows. Taking the whole page down lives in Settings → Tabs (LCP & admins)."
        pending={pending}
        readOnly={readOnly}
        onSave={() => save({ show })}
      >
        {(
          [
            ["national", "Alexandria's national ranking (from CORE)"],
            ["feed", "Live dispatches — who just scored what"],
            ["breakdown", "Each person's breakdown by achievement"],
            ["avatars", "Members' Sodio avatars"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex items-center justify-between gap-3 text-sm">
            {label}
            <Switch checked={show[k]} onCheckedChange={(v) => setShow({ ...show, [k]: v })} />
          </label>
        ))}
        {meta.updatedAt ? (
          <p className="flex items-center gap-1 pt-1 text-xs text-muted-foreground">
            <RotateCcw className="size-3" /> Settings last saved {fmtDateTime(meta.updatedAt)}
            {meta.updatedBy ? ` by ${meta.updatedBy}` : ""}
          </p>
        ) : null}
      </Section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
