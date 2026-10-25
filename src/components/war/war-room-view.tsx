"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check, Copy, ExternalLink, Gift, ListChecks, Loader2, Medal, Minus, Pencil, Plus, Radio, RotateCcw,
  ScrollText, Search, Settings2, Swords, Trash2, Trophy, Undo2, Users, X,
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
  BONUS, COMPETITOR_ROLES, LIMITS, entryPoints, functionStandings, isCompetitor, isIsoDate, kindLabel, rewardFor,
  splitDuration, standings, warClock, warDateWindow, warDay, warPhase,
  type PointGroup, type PointType, type Reward, type WarPerson, type WarSettings,
} from "@/lib/war/model";
import type { WarEntryRow } from "@/server/war";
import {
  deleteWarEntries, logWarEntries, restoreWarEntries, saveWarSettings, updateWarEntry,
} from "@/server/war-actions";
import { ChipPick, PeoplePick, type PickPerson } from "@/components/crm/people-pick";
import { useNow } from "@/components/no-peace/bits";

type Tab = "log" | "standings" | "entries" | "settings";

const TABS: { key: Tab; label: string; short: string; icon: typeof Swords }[] = [
  { key: "log", label: "Log points", short: "Log", icon: Plus },
  { key: "standings", label: "Standings", short: "Standings", icon: Trophy },
  { key: "entries", label: "Entries", short: "Entries", icon: ListChecks },
  { key: "settings", label: "Settings", short: "Settings", icon: Settings2 },
];

/** The dates an entry may carry — the war plus a week of grace either side,
 *  the same window the server checks (the last day's numbers land late). */
function dateWindow(s: Pick<WarSettings, "startDate" | "endDate">): { min: string; max: string } {
  // the model's window — the one place the grace days live
  return warDateWindow(s);
}

/** A whole number in [min, max], typed as text — "" is NOT 0 here. */
function wholeIn(v: string, min: number, max: number): boolean {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
}

const bonusOk = (v: string) => wholeIn(v, -LIMITS.bonus, LIMITS.bonus) && Number(v) !== 0;

/** Every function a person carries (functions + sub-functions), not just the
 *  first. B2B and BD are one crew (AI_CONTEXT §2), so they share one group. */
function allFunctions(p: Pick<WarPerson, "functions" | "sub_functions">): string[] {
  const out = new Set<string>();
  for (const raw of [...p.functions, ...p.sub_functions]) {
    const f = raw.trim();
    if (f) out.add(/^(B2B|BD)$/i.test(f) ? "B2B/BD" : f);
  }
  return out.size ? [...out] : ["—"];
}

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
  const [settingsDirty, setSettingsDirty] = useState(false);
  const live = useMemo(() => entries.filter((e) => !e.deleted_at), [entries]);
  const rows = useMemo(() => standings(people, live, settings), [people, live, settings]);
  const competitors = useMemo(() => people.filter((p) => isCompetitor(p, settings.competitors)), [people, settings]);
  // live entries per point type — Settings won't let a type that still scores be removed
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of live) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [live]);
  const totals = useMemo(
    () => ({
      points: rows.reduce((a, r) => a + r.points, 0),
      enlisted: rows.filter((r) => r.eligible).length,
      entries: live.length,
    }),
    [rows, live]
  );

  // unsaved Settings edits die with the panel — say so before a tab switch or a reload
  const switchTab = (k: Tab) => {
    if (k === tab) return;
    if (tab === "settings" && settingsDirty && !window.confirm("You have unsaved Settings changes. Leave without saving?"))
      return;
    setTab(k);
  };
  useEffect(() => {
    if (!settingsDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [settingsDirty]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <WarHeader settings={settings} totals={{ ...totals, troops: rows.length }} publicUrl={publicUrl} />
      {readOnly ? (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          You&apos;re in a test view — you can look around, but logging is off (it would be credited to someone else).
        </p>
      ) : null}

      {/* four equal cells on a phone (all four tabs visible, 44px tall), a row of pills from sm up */}
      <div className="grid grid-cols-4 gap-1 rounded-xl border bg-card p-1 sm:flex">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => switchTab(t.key)}
            className={cn(
              "flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-xs font-semibold transition-colors sm:shrink-0 sm:flex-row sm:gap-1.5 sm:px-3 sm:py-2 sm:text-sm",
              tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"
            )}
          >
            <t.icon className="size-4" />
            <span className="whitespace-nowrap sm:hidden">{t.short}</span>
            <span className="hidden whitespace-nowrap sm:inline">{t.label}</span>
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
        <SettingsPanel
          settings={settings}
          meta={settingsMeta}
          people={people}
          kindCounts={kindCounts}
          readOnly={readOnly}
          onDirtyChange={setSettingsDirty}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ header

function WarHeader({
  settings, totals, publicUrl,
}: {
  settings: WarSettings;
  totals: { points: number; enlisted: number; entries: number; troops: number };
  publicUrl: string;
}) {
  // null until mounted: the server's render and the first browser render must agree
  const now = useNow();
  const clock = warClock(settings);
  const phase = now === null ? null : warPhase(clock, now);
  const left = now === null ? null : splitDuration((phase === "before" ? clock.start : clock.end) - now);
  const [copied, setCopied] = useState(false);
  return (
    <Card className="overflow-hidden border-0 bg-[linear-gradient(120deg,#1d2b33,#24414a_55%,#5b3b22)] py-0 text-[#f3e6c8] shadow-lg">
      <CardContent className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.3em] text-[#e7c27d] uppercase">
            <Swords className="size-4" /> War Room
            {phase !== null && now !== null ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] tracking-normal",
                  phase === "live" ? "bg-red-600 text-white" : "bg-white/15"
                )}
              >
                {phase === "live" ? `● Live · Day ${warDay(clock, now)} of ${clock.totalDays}` : phase === "before" ? "Not started" : "Over"}
              </span>
            ) : null}
          </p>
          <h1 className="text-3xl font-black tracking-tight break-words uppercase">{settings.name}</h1>
          <p className="text-sm text-[#f3e6c8]/80">
            {phase === "over"
              ? "The war is over — the standings are final."
              : `${phase === "before" ? "Starts" : "Ends"} in ${
                  left
                    ? `${left.d}d ${String(left.h).padStart(2, "0")}h ${String(left.m).padStart(2, "0")}m ${String(left.s).padStart(2, "0")}s`
                    : "—"
                }`}
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
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4 md:grid-cols-2">
          {[
            { k: "War points", v: totals.points },
            { k: "Entries", v: totals.entries },
            { k: "Troops", v: totals.troops },
            { k: "Enlisted", v: totals.enlisted },
          ].map((s) => (
            <div key={s.k} className="min-w-0 rounded-lg bg-black/20 px-3 py-2">
              <p className="font-mono text-xl font-bold tabular-nums">{s.v.toLocaleString("en-GB")}</p>
              <p className="text-[10px] tracking-wider whitespace-nowrap text-[#f3e6c8]/70 uppercase">{s.k}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ log

interface LogBatch {
  who: string[];
  kind: string;
  qty: number;
  bonus: string;
  note: string;
  day: string;
}

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
  // the toast's Undo runs long after this render — it reads the CURRENT picks from here
  const whoRef = useRef(who);
  useEffect(() => {
    whoRef.current = who;
  }, [who]);
  const types = useMemo(() => new Map(settings.pointTypes.map((t) => [t.key, t])), [settings]);
  const isBonus = kind === BONUS;
  const bonusValid = bonusOk(bonus);
  const win = dateWindow(settings);
  const dayValid = isIsoDate(day) && day >= win.min && day <= win.max;
  const tooMany = who.length > LIMITS.batch;
  // no silent rounding: an invalid bonus scores nothing and blocks Log it
  const each = isBonus ? (bonusValid ? Number(bonus) : 0) : (types.get(kind)?.points ?? 0) * qty;
  const fnGroups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of competitors) for (const f of allFunctions(p)) m.set(f, [...(m.get(f) ?? []), p.id]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [competitors]);
  const pickPeople = useMemo(
    () => competitors.map((p) => ({ id: p.id, name: p.name, role: p.role, functions: allFunctions(p) })),
    [competitors]
  );

  const putBack = (b: LogBatch) => {
    setWho(b.who);
    setKind(b.kind);
    setQty(b.qty);
    setBonus(b.bonus);
    setNote(b.note);
    setDay(b.day);
  };

  const submit = () =>
    start(async () => {
      const batch: LogBatch = { who, kind, qty, bonus, note, day };
      const res = await logWarEntries({
        memberIds: who,
        kind,
        qty,
        points: isBonus ? Number(bonus) : undefined,
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
          duration: 10000,
          action: ids.length
            ? {
                label: "Undo",
                onClick: () => {
                  deleteWarEntries(ids).then((r) => {
                    if (!r.ok) {
                      toast.error(r.error);
                      return;
                    }
                    router.refresh();
                    // bring the form back so a wrong batch is one fix away — unless
                    // they've already started picking the next one
                    if (whoRef.current.length === 0) {
                      putBack(batch);
                      toast.success("Undone — the form is back as it was.");
                    } else {
                      toast.success("Undone.", {
                        duration: 10000,
                        action: { label: "Put them back", onClick: () => putBack(batch) },
                      });
                    }
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
    // minmax(0,…) + min-w-0: one long dispatch comment must never widen the page
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="grid size-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">1</span>
            Who scored?
            <span className={cn("ml-auto text-xs font-normal", tooMany ? "text-destructive" : "text-muted-foreground")}>
              {who.length} picked
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 md:gap-1.5">
            <button
              type="button"
              onClick={() => setWho(competitors.map((p) => p.id))}
              className="rounded-full border px-2.5 py-1.5 text-xs font-semibold hover:border-primary md:py-0.5"
            >
              <Users className="mr-1 inline size-3" /> Everyone ({competitors.length})
            </button>
            {fnGroups.map(([f, ids]) => (
              <button
                key={f}
                type="button"
                onClick={() => setWho((w) => [...new Set([...w, ...ids])])}
                className="rounded-full border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-foreground md:py-0.5"
              >
                + all {f} ({ids.length})
              </button>
            ))}
          </div>
          <PeoplePick
            people={pickPeople}
            value={who}
            onChange={setWho}
            placeholder="Search the troops…"
            listHeight="max-h-72"
          />
          {tooMany ? (
            <p className="text-xs text-destructive">
              At most {LIMITS.batch} people per log — split this one in two.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Only people in the race are listed (active, and allowed by Settings → Who competes).
          </p>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
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
                  aria-pressed={kind === t.key}
                  onClick={() => setKind(t.key)}
                  className={cn(
                    "min-w-0 rounded-lg border p-2 text-left transition-all",
                    kind === t.key ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "hover:bg-muted"
                  )}
                >
                  <p className="text-xs font-bold break-words">{t.label}</p>
                  <p className="font-mono text-lg leading-none font-bold text-primary">+{t.points}</p>
                </button>
              ))}
              <button
                type="button"
                aria-pressed={isBonus}
                onClick={() => setKind(BONUS)}
                className={cn(
                  "min-w-0 rounded-lg border border-dashed p-2 text-left transition-all",
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
                <Input
                  id="war-bonus"
                  type="number"
                  step={1}
                  min={-LIMITS.bonus}
                  max={LIMITS.bonus}
                  value={bonus}
                  onChange={(e) => setBonus(e.target.value)}
                  aria-invalid={!bonusValid}
                  aria-describedby="war-bonus-hint"
                  className="font-mono"
                />
                <p id="war-bonus-hint" className={cn("text-xs", bonusValid ? "text-muted-foreground" : "text-destructive")}>
                  A whole number, not 0, from −{LIMITS.bonus} to {LIMITS.bonus}.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Label htmlFor="war-qty" className="mr-auto">How many?</Label>
                <Button size="icon" variant="outline" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="One fewer">
                  <Minus className="size-4" />
                </Button>
                <Input
                  id="war-qty"
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
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="war-note">Comment {isBonus ? "(e.g. “Checkpoint 1 — attendance”)" : "(optional)"}</Label>
                <Input id="war-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.note} />
              </div>
              <div className="grid min-w-0 gap-1.5">
                <Label htmlFor="war-day">Date</Label>
                <Input
                  id="war-day"
                  type="date"
                  min={win.min}
                  max={win.max}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  aria-invalid={!dayValid}
                  aria-describedby={dayValid ? undefined : "war-day-hint"}
                />
              </div>
            </div>
            {dayValid ? null : (
              <p id="war-day-hint" className="text-xs text-destructive">
                Pick a day from {win.min} to {win.max} — the war plus a week either side.
              </p>
            )}
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
              <Button
                onClick={submit}
                disabled={
                  pending || readOnly || who.length === 0 || tooMany || each === 0 || (isBonus && !bonusValid) || !dayValid
                }
              >
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
          <CardContent className="min-w-0 space-y-1.5">
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
  const fnRace = useMemo(() => functionStandings(rows, settings.functionBoard), [rows, settings.functionBoard]);

  return (
    <div className="space-y-4">
      {fnRace.length ? <FunctionRaceCard rows={fnRace} /> : null}
      <Card>
        <CardContent className="space-y-3 pt-4">
          {/* two-up on a phone so the filters don't each take a row */}
          <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
            <div className="relative col-span-2 sm:min-w-48 sm:flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name…" aria-label="Search a name" className="pl-8" />
            </div>
            <Select value={fn} onValueChange={setFn}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Function"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All functions</SelectItem>
                {fns.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <Switch checked={enlistedOnly} onCheckedChange={setEnlistedOnly} /> {settings.minPoints}+ only
            </label>
            <span className="text-right text-xs text-muted-foreground sm:text-left">{shown.length} of {rows.length}</span>
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
                        <p className="font-semibold text-foreground">
                          {/* the keyboard's way in — the row click is for the mouse */}
                          <button
                            type="button"
                            dir="auto"
                            className="text-left hover:underline"
                            aria-label={`${r.name} — open their entries`}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onOpenPerson(r.id);
                            }}
                          >
                            {r.name}
                          </button>
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
    </div>
  );
}

// ------------------------------------------------------------------ entries

const PAGE = 50;

/** The function race (v38.3) — the same table the public page shows: each
 *  function's TOTAL war points, counted under people's main function only. */
function FunctionRaceCard({ rows }: { rows: ReturnType<typeof functionStandings> }) {
  const lead = Math.max(1, rows[0]?.points ?? 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="size-4" /> Function race
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Total war points per function — each person counts for their main function only.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((f) => (
          <div key={f.fn} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3">
            <span className="font-mono text-sm font-bold">{f.points > 0 ? f.rank : "—"}</span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">{f.fn}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {f.scorers}/{f.troops} scored{f.top ? ` · top: ${f.top.name}` : ""}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(Math.max(0, f.points) / lead) * 100}%` }} />
              </div>
            </div>
            <span className="w-12 text-right font-mono text-base font-bold tabular-nums">{f.points}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

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
  // bulk actions touch only ticked rows the filters still show (every page) —
  // a row ticked and then filtered away is never deleted unseen
  const shownIds = new Set(shown.map((e) => e.id));
  const visibleSel = sel.filter((id) => shownIds.has(id));
  const hiddenSel = sel.length - visibleSel.length;
  const pageAll = slice.length > 0 && slice.every((e) => sel.includes(e.id));
  const togglePage = (on: boolean) =>
    setSel(on ? [...new Set([...sel, ...slice.map((e) => e.id)])] : sel.filter((id) => !slice.some((e) => e.id === id)));
  const toggleOne = (id: string, on: boolean) => setSel(on ? [...sel, id] : sel.filter((x) => x !== id));

  const act = (ids: string[], fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Couldn't save.");
      else {
        toast.success(ok);
        setSel((s) => s.filter((id) => !ids.includes(id)));
        router.refresh();
      }
    });
  const restore = (ids: string[], ok: string) => act(ids, () => restoreWarEntries(ids), ok);
  const remove = (ids: string[], ok: string) => act(ids, () => deleteWarEntries(ids), ok);

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
          <div className="relative col-span-2 sm:min-w-48 sm:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
              placeholder="Search a name or comment…"
              aria-label="Search a name or comment"
              className="pl-8"
            />
          </div>
          <Select value={kind} onValueChange={(v) => { setKind(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-36" aria-label="What"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              {settings.pointTypes.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
              <SelectItem value={BONUS}>Bonus</SelectItem>
            </SelectContent>
          </Select>
          <Select value={by} onValueChange={(v) => { setBy(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Logged by"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Logged by anyone</SelectItem>
              {loggers.map(([id, n]) => <SelectItem key={id} value={id}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="sm:w-36" aria-label="From" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="sm:w-36" aria-label="To" />
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <Switch checked={showDeleted} onCheckedChange={(v) => { setShowDeleted(v); setSel([]); setPage(0); }} /> Deleted
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {focus ? (
            <Badge variant="secondary" className="gap-1">
              {names.get(focus) ?? "—"}
              <button
                type="button"
                onClick={() => onFocusChange(null)}
                aria-label="Show everyone"
                className="-my-0.5 -mr-1.5 grid size-6 place-items-center rounded-full hover:bg-foreground/10 md:size-4"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ) : null}
          <span className="text-muted-foreground">
            {shown.length} entries · <b className="font-mono text-foreground">{sum >= 0 ? "+" : ""}{sum}</b> points
          </span>
          {visibleSel.length > 0 && !readOnly ? (
            showDeleted ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => restore(visibleSel, `${visibleSel.length} restored.`)}>
                <Undo2 className="size-4" /> Restore {visibleSel.length}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => remove(visibleSel, `${visibleSel.length} deleted — find them under “Deleted”.`)}
              >
                <Trash2 className="size-4" /> Delete {visibleSel.length}
              </Button>
            )
          ) : null}
          {hiddenSel > 0 && !readOnly ? (
            <span className="text-xs text-muted-foreground">({hiddenSel} ticked but hidden by the filters — left alone)</span>
          ) : null}
        </div>

        {/* phones: one card per entry — name and points, then what · when · comment, then roomy buttons */}
        <div className="space-y-2 sm:hidden">
          {slice.length > 0 && !readOnly ? (
            <label className="flex min-h-10 items-center gap-3 px-2.5 text-sm text-muted-foreground">
              <input type="checkbox" className="size-5 accent-primary" checked={pageAll} onChange={(ev) => togglePage(ev.target.checked)} />
              Select this page ({slice.length})
            </label>
          ) : null}
          {slice.map((e) => {
            const pts = entryPoints(e, types);
            const name = names.get(e.member_id) ?? "—";
            const what = `${kindLabel(e.kind, types)}${e.kind !== BONUS && e.qty > 1 ? ` ×${e.qty}` : ""}`;
            return (
              <div
                key={e.id}
                className={cn("rounded-lg border p-1.5", e.deleted_at && "opacity-60", sel.includes(e.id) && "border-primary bg-primary/5")}
              >
                <div className="flex items-center gap-1">
                  {readOnly ? null : (
                    <label className="grid size-10 shrink-0 place-items-center">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        aria-label={`Select ${name} · ${what}`}
                        checked={sel.includes(e.id)}
                        onChange={(ev) => toggleOne(e.id, ev.target.checked)}
                      />
                    </label>
                  )}
                  <p className={cn("min-w-0 flex-1 truncate font-medium", readOnly && "pl-1")} dir="auto">{name}</p>
                  <span className={cn("shrink-0 pr-1 font-mono font-bold", pts < 0 ? "text-destructive" : "text-primary")}>
                    {pts >= 0 ? "+" : ""}{pts}
                  </span>
                </div>
                <p className={cn("line-clamp-2 pr-1 text-xs break-words text-muted-foreground", readOnly ? "pl-1" : "pl-11")} dir="auto">
                  {what} · {e.occurred_on}
                  {e.note ? ` · ${e.note}` : ""}
                </p>
                {readOnly ? null : (
                  <div className="mt-1.5 flex justify-end gap-2">
                    {e.deleted_at ? (
                      <Button variant="outline" disabled={pending} onClick={() => restore([e.id], "Restored.")}>
                        <Undo2 className="size-4" /> Restore
                      </Button>
                    ) : (
                      <>
                        <Button variant="outline" onClick={() => setEditing(e)}>
                          <Pencil className="size-4" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          className="text-destructive"
                          disabled={pending}
                          onClick={() => remove([e.id], "Deleted — find it under “Deleted”.")}
                        >
                          <Trash2 className="size-4" /> Delete
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {slice.length === 0 ? (
            <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
              {showDeleted ? "Nothing deleted." : "No entries match."}
            </p>
          ) : null}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border sm:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" aria-label="Select this page" checked={pageAll} onChange={(ev) => togglePage(ev.target.checked)} />
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
                        onChange={(ev) => toggleOne(e.id, ev.target.checked)}
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
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => restore([e.id], "Restored.")} aria-label="Restore">
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
                            onClick={() => remove([e.id], "Deleted — find it under “Deleted”.")}
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
          settings={settings}
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
  entry, settings, name, label, onClose, onSaved,
}: {
  entry: WarEntryRow;
  settings: WarSettings;
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
  const win = dateWindow(settings);
  const qtyValid = wholeIn(qty, 1, LIMITS.qty);
  const pointsValid = bonusOk(points);
  // only a CHANGED date is held to the window — an old entry outside it can still get its comment fixed
  const dayChanged = day !== entry.occurred_on;
  const dayValid = !dayChanged || (isIsoDate(day) && day >= win.min && day <= win.max);
  const valid = (isBonus ? pointsValid : qtyValid) && dayValid;
  const save = () =>
    start(async () => {
      const r = await updateWarEntry(entry.id, {
        ...(isBonus ? { points: Number(points) } : { qty: Number(qty) }),
        note,
        ...(dayChanged ? { occurredOn: day } : {}),
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
              <Label htmlFor="war-edit-points">Points</Label>
              <Input
                id="war-edit-points"
                type="number"
                step={1}
                min={-LIMITS.bonus}
                max={LIMITS.bonus}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                aria-invalid={!pointsValid}
                aria-describedby="war-edit-points-hint"
              />
              <p id="war-edit-points-hint" className={cn("text-xs", pointsValid ? "text-muted-foreground" : "text-destructive")}>
                A whole number, not 0, from −{LIMITS.bonus} to {LIMITS.bonus}.
              </p>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="war-edit-qty">How many</Label>
              <Input
                id="war-edit-qty"
                type="number"
                step={1}
                min={1}
                max={LIMITS.qty}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-invalid={!qtyValid}
              />
              {qtyValid ? null : <p className="text-xs text-destructive">A whole number from 1 to {LIMITS.qty}.</p>}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="war-edit-note">Comment</Label>
            <Input id="war-edit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.note} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="war-edit-day">Date</Label>
            <Input
              id="war-edit-day"
              type="date"
              min={win.min}
              max={win.max}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              aria-invalid={!dayValid}
            />
            {dayValid ? null : (
              <p className="text-xs text-destructive">Pick a day from {win.min} to {win.max} — the war plus a week either side.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={pending || !valid}>{pending ? <Loader2 className="size-4 animate-spin" /> : null} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ settings

function Section({
  title, icon: Icon, blurb, children, onSave, pending, saving, readOnly, dirty, error,
}: {
  title: string;
  icon: typeof Swords;
  blurb: string;
  children: React.ReactNode;
  onSave: () => void;
  /** some section is saving — every Save waits */
  pending: boolean;
  /** this section is the one saving */
  saving: boolean;
  readOnly: boolean;
  dirty: boolean;
  /** what's wrong with the form as it stands — Save stays off until it's fixed */
  error: string | null;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4" /> {title}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{blurb}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error ? (
            <p className="mr-auto min-w-0 text-xs text-destructive">{error}</p>
          ) : dirty ? (
            <p className="mr-auto text-xs font-medium text-amber-700 dark:text-amber-400">Unsaved changes</p>
          ) : null}
          <Button size="sm" onClick={onSave} disabled={pending || readOnly || !!error}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type SectionKey = "campaign" | "types" | "rewards" | "rules" | "comp" | "show" | "fnBoard";

/** Form drafts keep numbers as TEXT, so a cleared field is "" (and invalid),
 *  never a silent 0. */
type TypeDraft = Omit<PointType, "points"> & { points: string };
type RewardDraft = Omit<Reward, "rank"> & { rank: string };

const campaignForm = (s: WarSettings) => ({
  name: s.name,
  tagline: s.tagline,
  startDate: s.startDate,
  endDate: s.endDate,
  minPoints: String(s.minPoints),
  activateLabel: s.activateLabel,
  activateDate: s.activateDate,
  activateTime: s.activateTime,
  motto: s.motto,
  heroLines: s.heroLines.join("\n"),
});
type CampaignForm = ReturnType<typeof campaignForm>;
const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);
const campaignPatch = (c: CampaignForm) => ({
  name: c.name,
  tagline: c.tagline,
  startDate: c.startDate,
  endDate: c.endDate,
  minPoints: Number(c.minPoints),
  activateLabel: c.activateLabel,
  activateDate: c.activateDate,
  activateTime: c.activateTime,
  motto: c.motto,
  heroLines: lines(c.heroLines),
});
const toTypeDrafts = (t: PointType[]): TypeDraft[] => t.map((x) => ({ ...x, points: String(x.points) }));
const fromTypeDrafts = (t: TypeDraft[]): PointType[] => t.map((x) => ({ ...x, points: Number(x.points) }));
const toRewardDrafts = (r: Reward[]): RewardDraft[] => r.map((x) => ({ ...x, rank: String(x.rank) }));
const fromRewardDrafts = (r: RewardDraft[]): Reward[] => r.map((x) => ({ ...x, rank: Number(x.rank) }));

/** Key-order-proof JSON, for "does this section differ from what's stored?" */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );

/** A fresh, never-reused key — a positional `new_N` could be handed to a new
 *  type while an old type's deleted entries still carry it. */
const newTypeKey = () => `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function campaignProblem(c: CampaignForm): string | null {
  if (!c.name.trim()) return "The war needs a name.";
  if (!isIsoDate(c.startDate) || !isIsoDate(c.endDate)) return "Pick both war dates.";
  if (c.endDate < c.startDate) return "The war can't end before it starts.";
  if (!wholeIn(c.minPoints, 0, 10000)) return "Points to compete must be a whole number from 0 to 10000.";
  if (!isIsoDate(c.activateDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.activateTime))
    return "Give the countdown a date and a time.";
  return null;
}

function typesProblem(t: TypeDraft[]): string | null {
  if (t.some((x) => !x.label.trim())) return "Every achievement needs a name.";
  const bad = t.find((x) => !wholeIn(x.points, 0, 1000));
  if (bad) return `“${bad.label.trim()}” needs whole points from 0 to 1000.`;
  return null;
}

/** Ranks used more than once — both rows get flagged, not just the second. */
const duplicateRanks = (r: RewardDraft[]): Set<string> => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const x of r) {
    const k = String(Number(x.rank));
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return dup;
};

function rewardsProblem(r: RewardDraft[]): string | null {
  if (r.some((x) => !x.title.trim())) return "Every reward needs a title.";
  if (r.some((x) => !wholeIn(x.rank, 1, 99))) return "Each rank must be a whole number from 1 to 99.";
  const dup = [...duplicateRanks(r)];
  if (dup.length) return `Two rewards share rank ${dup[0]} — give each rank one reward.`;
  return null;
}

function SettingsPanel({
  settings, meta, people, kindCounts, readOnly, onDirtyChange,
}: {
  settings: WarSettings;
  meta: { updatedAt: string | null; updatedBy: string | null };
  people: WarPerson[];
  kindCounts: Map<string, number>;
  readOnly: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saving, setSaving] = useState<SectionKey | null>(null);

  // What's stored, as far as this form knows: the props, or — the moment a save
  // returns — the settings the server actually kept. "Unsaved changes" compares
  // against this, and a refreshed prop (another editor's save) moves it along
  // WITHOUT wiping anyone's unsaved edits in the other sections.
  const [base, setBase] = useState(settings);
  const [seenProp, setSeenProp] = useState(settings);
  if (settings !== seenProp) {
    setSeenProp(settings);
    setBase(settings);
  }

  const [c, setC] = useState(() => campaignForm(settings));
  const [types, setTypes] = useState<TypeDraft[]>(() => toTypeDrafts(settings.pointTypes));
  const [rewards, setRewards] = useState<RewardDraft[]>(() => toRewardDrafts(settings.rewards));
  const [rules, setRules] = useState(settings.rules.join("\n"));
  const [comp, setComp] = useState(settings.competitors);
  const [show, setShow] = useState(settings.show);
  const [fnBoard, setFnBoard] = useState(settings.functionBoard);
  const [pairFn, setPairFn] = useState("TM");
  const [pairRole, setPairRole] = useState("Coordinator");

  const dirty: Record<SectionKey, boolean> = {
    campaign: stable(campaignPatch(c)) !== stable(campaignPatch(campaignForm(base))),
    types: stable(types) !== stable(toTypeDrafts(base.pointTypes)),
    rewards: stable(rewards) !== stable(toRewardDrafts(base.rewards)),
    rules: stable(lines(rules)) !== stable(base.rules),
    comp: stable(comp) !== stable(base.competitors),
    show: stable(show) !== stable(base.show),
    fnBoard: stable(fnBoard) !== stable(base.functionBoard),
  };
  const anyDirty = Object.values(dirty).some(Boolean);
  useEffect(() => {
    onDirtyChange(anyDirty);
  }, [anyDirty, onDirtyChange]);
  // leaving the tab (after the confirm) takes the edits with it
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  /** Save one section. On success the server's STORED settings re-seed that
   *  section only (so a trimmed name or a re-sorted reward list shows as it
   *  really is); the other sections keep their unsaved edits. */
  const save = (
    key: SectionKey,
    patch: Partial<WarSettings>,
    reseed: (s: WarSettings) => void,
    onFail?: () => void
  ) => {
    setSaving(key);
    start(async () => {
      const r = await saveWarSettings(patch as Record<string, unknown>);
      setSaving(null);
      if (!r.ok) {
        toast.error(r.error);
        onFail?.();
        return;
      }
      // `data.settings` is what the server stored; if it's ever missing, the
      // refreshed props bring the truth a moment later instead
      const stored = r.data?.settings;
      if (stored) {
        setBase(stored);
        reseed(stored);
      }
      toast.success("Saved — live on the page.");
      router.refresh();
    });
  };

  const pickPeople = useMemo(
    () =>
      people
        .filter((p) => p.is_active)
        .map((p) => ({ id: p.id, name: p.name, role: p.role, functions: allFunctions(p) })),
    [people]
  );
  // every member, inactive included — so a stored name never shows as "Former member"
  const knownPeople = useMemo<PickPerson[]>(
    () => people.map((p) => ({ id: p.id, name: p.name, role: p.role, functions: allFunctions(p), active: p.is_active })),
    [people]
  );
  const inRace = people.filter((p) => isCompetitor(p, comp)).length;

  const campaignErr = campaignProblem(c);
  const typesErr = typesProblem(types);
  const rewardsErr = rewardsProblem(rewards);
  const dupRanks = duplicateRanks(rewards);
  const setType = (i: number, patch: Partial<TypeDraft>) => setTypes(types.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setReward = (i: number, patch: Partial<RewardDraft>) =>
    setRewards(rewards.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const shared = { pending, readOnly };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section
        title="The campaign"
        icon={Swords}
        blurb="Name, dates and the line people must cross to compete for rewards."
        {...shared}
        saving={saving === "campaign"}
        dirty={dirty.campaign}
        error={campaignErr}
        onSave={() => save("campaign", campaignPatch(c), (s) => setC(campaignForm(s)))}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="war-s-name">
            <Input id="war-s-name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} maxLength={40} aria-invalid={!c.name.trim()} />
          </Field>
          <Field label="Points to compete" htmlFor="war-s-min">
            <Input
              id="war-s-min"
              type="number"
              step={1}
              min={0}
              max={10000}
              value={c.minPoints}
              onChange={(e) => setC({ ...c, minPoints: e.target.value })}
              aria-invalid={!wholeIn(c.minPoints, 0, 10000)}
            />
          </Field>
          <Field label="War starts (Cairo)" htmlFor="war-s-start">
            <Input id="war-s-start" type="date" value={c.startDate} onChange={(e) => setC({ ...c, startDate: e.target.value })} />
          </Field>
          <Field label="War ends (last day, Cairo)" htmlFor="war-s-end">
            <Input
              id="war-s-end"
              type="date"
              min={c.startDate || undefined}
              value={c.endDate}
              onChange={(e) => setC({ ...c, endDate: e.target.value })}
              aria-invalid={isIsoDate(c.startDate) && isIsoDate(c.endDate) && c.endDate < c.startDate}
            />
          </Field>
          <Field label="Countdown to (label)" htmlFor="war-s-alabel">
            <Input id="war-s-alabel" value={c.activateLabel} onChange={(e) => setC({ ...c, activateLabel: e.target.value })} />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
            <Field label="Its date" htmlFor="war-s-adate">
              <Input id="war-s-adate" type="date" value={c.activateDate} onChange={(e) => setC({ ...c, activateDate: e.target.value })} />
            </Field>
            <Field label="Time" htmlFor="war-s-atime">
              <Input id="war-s-atime" type="time" value={c.activateTime} onChange={(e) => setC({ ...c, activateTime: e.target.value })} />
            </Field>
          </div>
        </div>
        <Field label="Tagline" htmlFor="war-s-tagline">
          <Textarea id="war-s-tagline" rows={2} value={c.tagline} onChange={(e) => setC({ ...c, tagline: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hero lines (one per line)" htmlFor="war-s-hero">
            <Textarea id="war-s-hero" rows={3} value={c.heroLines} onChange={(e) => setC({ ...c, heroLines: e.target.value })} />
          </Field>
          <Field label="Motto (footer)" htmlFor="war-s-motto">
            <Input id="war-s-motto" value={c.motto} onChange={(e) => setC({ ...c, motto: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section
        title="The point system"
        icon={Medal}
        blurb="What each achievement is worth. Changing a value re-scores every entry already logged."
        {...shared}
        saving={saving === "types"}
        dirty={dirty.types}
        error={typesErr}
        onSave={() => {
          const was = base.pointTypes;
          const removed = was.filter((t) => !types.some((x) => x.key === t.key));
          save("types", { pointTypes: fromTypeDrafts(types) }, (s) => setTypes(toTypeDrafts(s.pointTypes)), () => {
            // a refused save puts back only the rows it removed — every other edit stays
            if (!removed.length) return;
            setTypes((cur) => {
              const out = [...cur];
              was.forEach((t, i) => {
                if (!out.some((x) => x.key === t.key)) out.splice(Math.min(i, out.length), 0, ...toTypeDrafts([t]));
              });
              return out;
            });
          });
        }}
      >
        <div className="space-y-2">
          {types.map((t, i) => {
            const used = kindCounts.get(t.key) ?? 0;
            const name = t.label.trim() || "this achievement";
            return (
              // phone: name / points · group · remove / hint — a sm+ screen gets it all on one line
              <div
                key={t.key}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_auto]"
              >
                <Input
                  value={t.label}
                  onChange={(e) => setType(i, { label: e.target.value })}
                  placeholder="Achievement name"
                  aria-label="Achievement name"
                  aria-invalid={!t.label.trim()}
                  maxLength={LIMITS.label}
                  className="col-span-3 sm:col-span-1"
                />
                <Input
                  type="number"
                  step={1}
                  min={0}
                  max={1000}
                  value={t.points}
                  onChange={(e) => setType(i, { points: e.target.value })}
                  className="font-mono"
                  aria-label={`Points for ${name}`}
                  aria-invalid={!wholeIn(t.points, 0, 1000)}
                />
                <Select value={t.group} onValueChange={(v) => setType(i, { group: v as PointGroup })}>
                  <SelectTrigger className="w-full" aria-label={`Group for ${name}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["OGX", "ICX", "LC"] as PointGroup[]).map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* a type that still scores can't go (its entries would drop to 0) — say why on tap */}
                <Button
                  size="icon"
                  variant="ghost"
                  className={used ? "text-muted-foreground" : "text-destructive"}
                  aria-disabled={used > 0}
                  aria-label={used ? `Can't remove ${name} — ${used} entries logged` : `Remove ${name}`}
                  onClick={() => {
                    if (used) {
                      toast.error(
                        `“${name}” has ${used} ${used === 1 ? "entry" : "entries"} logged — removing it would zero them. Set its points instead, or delete those entries first.`
                      );
                      return;
                    }
                    setTypes(types.filter((_, j) => j !== i));
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
                <Input
                  value={t.hint}
                  onChange={(e) => setType(i, { hint: e.target.value })}
                  placeholder="One line for the public card"
                  aria-label={`Public card line for ${name}`}
                  className="col-span-full md:text-xs"
                />
              </div>
            );
          })}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={types.length >= LIMITS.pointTypes}
          onClick={() => setTypes([...types, { key: newTypeKey(), label: "", points: "5", group: "LC", hint: "" }])}
        >
          <Plus className="size-4" /> Add an achievement
        </Button>
      </Section>

      <Section
        title="War rewards"
        icon={Gift}
        blurb="Who wins what. The rank is the place among everyone over the points line."
        {...shared}
        saving={saving === "rewards"}
        dirty={dirty.rewards}
        error={rewardsErr}
        onSave={() => save("rewards", { rewards: fromRewardDrafts(rewards) }, (s) => setRewards(toRewardDrafts(s.rewards)))}
      >
        <div className="space-y-2">
          {rewards.map((r, i) => {
            const rankBad = !wholeIn(r.rank, 1, 99) || dupRanks.has(String(Number(r.rank)));
            const name = r.title.trim() || `reward ${i + 1}`;
            return (
              // phone: rank · emoji · remove / title / place / detail; sm+: rank · emoji · title · remove / place · detail
              <div key={i} className="grid grid-cols-[3.5rem_3.5rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-lg border p-2">
                <Input
                  type="number"
                  step={1}
                  min={1}
                  max={99}
                  value={r.rank}
                  aria-label={`Rank for ${name}`}
                  aria-invalid={rankBad}
                  onChange={(e) => setReward(i, { rank: e.target.value })}
                />
                <Input value={r.emoji} aria-label={`Emoji for ${name}`} className="text-center" onChange={(e) => setReward(i, { emoji: e.target.value })} />
                <Input
                  value={r.title}
                  placeholder="Reward"
                  aria-label="Reward title"
                  aria-invalid={!r.title.trim()}
                  className="col-span-4 sm:col-span-1"
                  onChange={(e) => setReward(i, { title: e.target.value })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="col-start-4 row-start-1 text-destructive"
                  onClick={() => setRewards(rewards.filter((_, j) => j !== i))}
                  aria-label={`Remove ${name}`}
                >
                  <Trash2 className="size-4" />
                </Button>
                <Input
                  value={r.place}
                  placeholder="Place, e.g. 1st"
                  aria-label={`Place label for ${name}`}
                  className="col-span-4 sm:col-span-2 md:text-xs"
                  onChange={(e) => setReward(i, { place: e.target.value })}
                />
                <Input
                  value={r.detail}
                  placeholder="Details shown in the pop-up"
                  aria-label={`Details for ${name}`}
                  className="col-span-4 sm:col-span-2 md:text-xs"
                  onChange={(e) => setReward(i, { detail: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={rewards.length >= LIMITS.rewards}
          onClick={() => {
            // after the highest rank in use — `length + 1` re-used a rank once one was removed
            const next = Math.max(0, ...rewards.map((x) => Number(x.rank)).filter(Number.isFinite)) + 1;
            setRewards([...rewards, { rank: String(next), place: `#${next}`, title: "", detail: "", emoji: "🎖️" }]);
          }}
        >
          <Plus className="size-4" /> Add a reward
        </Button>
      </Section>

      <Section
        title="Rules of engagement"
        icon={ScrollText}
        blurb="One rule per line — shown on the page exactly as written."
        {...shared}
        saving={saving === "rules"}
        dirty={dirty.rules}
        error={null}
        onSave={() => save("rules", { rules: lines(rules) }, (s) => setRules(s.rules.join("\n")))}
      >
        <Textarea rows={6} value={rules} onChange={(e) => setRules(e.target.value)} aria-label="Rules, one per line" />
      </Section>

      <Section
        title="Who competes"
        icon={Users}
        blurb={`Active members only, always. ${inRace} people are in the race with these settings.`}
        {...shared}
        saving={saving === "comp"}
        dirty={dirty.comp}
        error={null}
        onSave={() => save("comp", { competitors: comp }, (s) => setComp(s.competitors))}
      >
        <Field label="Roles in the race" group>
          <ChipPick options={COMPETITOR_ROLES} value={comp.roles} onChange={(roles) => setComp({ ...comp, roles })} />
        </Field>
        <Field label="Left out by function + role" group>
          <div className="flex flex-wrap gap-2 md:gap-1.5">
            {comp.excludeFunctionRoles.map((p) => (
              <Badge key={p} variant="secondary" className="gap-1">
                {p.replace(":", " ")}s
                <button
                  type="button"
                  aria-label={`Bring back ${p.replace(":", " ")}s`}
                  className="-my-0.5 -mr-1.5 grid size-6 place-items-center rounded-full hover:bg-foreground/10 md:size-4"
                  onClick={() => setComp({ ...comp, excludeFunctionRoles: comp.excludeFunctionRoles.filter((x) => x !== p) })}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Select value={pairFn} onValueChange={setPairFn}>
              <SelectTrigger className="w-28" aria-label="Function"><SelectValue /></SelectTrigger>
              <SelectContent>{LC_FUNCTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={pairRole} onValueChange={setPairRole}>
              <SelectTrigger className="w-36" aria-label="Role"><SelectValue /></SelectTrigger>
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
        {/* one person, one list: ticking someone here takes them off the other */}
        <Field label="Always out (by name)" group>
          <PeoplePick
            people={pickPeople}
            known={knownPeople}
            value={comp.exclude}
            onChange={(exclude) => setComp({ ...comp, exclude, include: comp.include.filter((id) => !exclude.includes(id)) })}
            listHeight="max-h-36"
          />
        </Field>
        <Field label="Always in (by name)" group>
          <PeoplePick
            people={pickPeople}
            known={knownPeople}
            value={comp.include}
            onChange={(include) => setComp({ ...comp, include, exclude: comp.exclude.filter((id) => !include.includes(id)) })}
            listHeight="max-h-36"
          />
        </Field>
      </Section>

      <Section
        title="Function race"
        icon={Trophy}
        blurb="Functions compete on their TOTAL war points; each person counts for their main function only."
        {...shared}
        saving={saving === "fnBoard"}
        dirty={dirty.fnBoard}
        error={null}
        onSave={() => save("fnBoard", { functionBoard: fnBoard }, (s) => setFnBoard(s.functionBoard))}
      >
        <label className="flex min-h-9 items-center justify-between gap-3 text-sm">
          Show the function race (here and on the public page)
          <Switch checked={fnBoard.enabled} onCheckedChange={(v) => setFnBoard({ ...fnBoard, enabled: v })} />
        </label>
        <Field label="Functions NOT in the race (their people still race as people)" group>
          <ChipPick
            tone="destructive"
            options={[...new Set([...LC_FUNCTIONS, ...people.map((p) => p.functions[0] ?? p.sub_functions[0]).filter(Boolean), ...fnBoard.exclude])] as string[]}
            value={fnBoard.exclude}
            onChange={(exclude) => setFnBoard({ ...fnBoard, exclude })}
          />
        </Field>
      </Section>

      <Section
        title="The public page"
        icon={Radio}
        blurb="What /no-peace shows. Taking the whole page down lives in Settings → Tabs (LCP & admins)."
        {...shared}
        saving={saving === "show"}
        dirty={dirty.show}
        error={null}
        onSave={() => save("show", { show }, (s) => setShow(s.show))}
      >
        {(
          [
            ["national", "Alexandria's national ranking (from CORE)"],
            ["feed", "Live dispatches — who just scored what"],
            ["breakdown", "Each person's breakdown by achievement"],
            ["avatars", "Members' Sodio avatars"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="flex min-h-9 items-center justify-between gap-3 text-sm">
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

/** A labelled form field. `htmlFor` ties the label to one input; `group`
 *  labels a cluster of controls (chips, a people picker) instead. */
function Field({
  label, htmlFor, group, children,
}: {
  label: string;
  htmlFor?: string;
  group?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  if (group)
    return (
      <div className="grid gap-1.5">
        <Label id={id} className="text-xs">{label}</Label>
        <div role="group" aria-labelledby={id} className="grid gap-1.5">
          {children}
        </div>
      </div>
    );
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
