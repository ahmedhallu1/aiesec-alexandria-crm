/** ALEX vs MUST (v38.5) — pure, client-safe model of the LC-to-LC race.
 *
 *  AIESEC in Alexandria and AIESEC in MUST race to 150 APPROVALS each (300
 *  between them), from the day the race opened to its deadline — 2 Dec 2026,
 *  day zero of Activate. Whoever reaches the goal FIRST wins. A second, smaller
 *  race runs on SLOTS (opens raised), to 100.
 *
 *  WHERE THE NUMBERS COME FROM
 *   · Approvals — CORE (core.aiesec.org.eg), both LCs' "approved 26/27" total,
 *     minus the count each LC had when the race opened (the BASELINE, kept per
 *     program so the board can say which programs moved). Every time CORE's
 *     number changes, a READING is stored (`race_readings`); the current count,
 *     who crossed the goal first and the trail chart all come from those rows.
 *     The editor can add a reading by hand when CORE is wrong or down.
 *   · Slots — Alexandria's are Sodio's own deals (opens split IGV/IGTa/IGTe)
 *     recorded since the start; MUST logs theirs through a private link with no
 *     login (`race_entries`). The editor can add an entry for either side.
 *
 *  Everything the LC might change — goals, dates, names, colours, baselines,
 *  what the page shows, MUST's link — is `war_campaigns.settings` under the
 *  'alex-vs-must' slug, edited from Sodio's "Alex vs MUST" tab. */

import { addDays, cairoInstant, isIsoDate, splitDuration } from "../war/model";

export const RACE_SLUG = "alex-vs-must";
export const RACE_PUBLIC_PATH = "/alex-vs-must";
/** the in-app editor — deliberately NOT an "alex-vs-must…" path: the proxy's
 *  public prefix match would have made it public too */
export const RACE_EDITOR_PATH = "/lc-race";
export const rivalDeskPath = (token: string) => `${RACE_PUBLIC_PATH}/must/${token}`;

export const PROGRAMS = ["iGV", "iGTa", "iGTe", "oGV", "oGTa", "oGTe"] as const;
export type Program = (typeof PROGRAMS)[number];
export type Side = "home" | "rival";
export const SIDES: Side[] = ["home", "rival"];

export type ProgramCounts = Record<Program, number>;
export const zeroPrograms = (): ProgramCounts => ({ iGV: 0, iGTa: 0, iGTe: 0, oGV: 0, oGTa: 0, oGTe: 0 });
export const sumPrograms = (p: ProgramCounts): number => PROGRAMS.reduce((a, k) => a + (p[k] ?? 0), 0);

export interface RaceSideSettings {
  name: string;
  /** the short tag on the track, e.g. "ALEX" */
  short: string;
  /** #rrggbb */
  color: string;
  /** the LC's id on CORE (/analytics/lc/<id>/) */
  coreId: number;
  /** false = stop reading CORE for this LC (only hand readings count) */
  coreOn: boolean;
  /** CORE's approved count per program when the race opened */
  baseline: ProgramCounts;
}

export interface RaceShow {
  slots: boolean;
  trail: boolean;
  programs: boolean;
  together: boolean;
  feed: boolean;
}

export interface RaceSettings {
  title: string;
  tagline: string;
  /** YYYY-MM-DD (Cairo) — the race counts from the start of this day */
  startDate: string;
  /** YYYY-MM-DD + HH:MM (Cairo) — nothing after this instant counts */
  deadlineDate: string;
  deadlineTime: string;
  approvalsGoal: number;
  slotsGoal: number;
  home: RaceSideSettings;
  rival: RaceSideSettings;
  /** the secret in MUST's private link; "" = no link yet */
  rivalToken: string;
  /** false = MUST's link opens read-only (logging paused) */
  rivalCanLog: boolean;
  finale: string;
  show: RaceShow;
}

export const DEFAULT_RACE: RaceSettings = {
  title: "Race to 150",
  tagline: "Two LCs. One number. Whoever lands 150 approvals first takes it.",
  // the day the race was declared; CORE then read Alexandria 161 · MUST 215
  startDate: "2026-11-04",
  // day zero of Activate 26'
  deadlineDate: "2026-12-02",
  deadlineTime: "23:59",
  approvalsGoal: 150,
  slotsGoal: 100,
  home: {
    name: "Alexandria",
    short: "ALEX",
    color: "#037EF3",
    coreId: 899,
    coreOn: true,
    baseline: { iGV: 50, iGTa: 5, iGTe: 14, oGV: 72, oGTa: 18, oGTe: 2 },
  },
  rival: {
    name: "MUST",
    short: "MUST",
    color: "#FF9F1C",
    coreId: 2818,
    coreOn: true,
    baseline: { iGV: 22, iGTa: 11, iGTe: 0, oGV: 162, oGTa: 19, oGTe: 1 },
  },
  rivalToken: "",
  rivalCanLog: true,
  finale: "Who gets there first?",
  show: { slots: true, trail: true, programs: true, together: true, feed: true },
};

export const RACE_LIMITS = { goal: 10000, baseline: 100000, qty: 500, note: 200, text: 200 } as const;

// ------------------------------------------------------------------ sanitizing

const str = (v: unknown, max: number, fallback = ""): string =>
  typeof v === "string" ? v.trim().slice(0, max) : fallback;
const num = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
const int = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = num(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const whole = (v: unknown, min: number, max: number): boolean => {
  const n = num(v);
  return Number.isInteger(n) && n >= min && n <= max;
};
export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const isHm = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const isRaceToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(v);

function cleanPrograms(v: unknown, fallback: ProgramCounts): ProgramCounts {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!r) return { ...fallback };
  const out = zeroPrograms();
  for (const k of PROGRAMS) out[k] = int(r[k], 0, RACE_LIMITS.baseline, fallback[k]);
  return out;
}

function cleanSide(v: unknown, d: RaceSideSettings): RaceSideSettings {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    name: str(r.name, 30) || d.name,
    short: (str(r.short, 8) || d.short).toUpperCase(),
    color: isHex(r.color) ? r.color.toLowerCase() : d.color,
    coreId: int(r.coreId, 1, 10_000_000, d.coreId),
    coreOn: typeof r.coreOn === "boolean" ? r.coreOn : d.coreOn,
    baseline: cleanPrograms(r.baseline, d.baseline),
  };
}

/** Stored JSON → full settings; every missing or broken key falls back to the
 *  default, so a half-written row can never take the page down. */
export function resolveRaceSettings(raw: unknown): RaceSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_RACE;
  const show = r.show && typeof r.show === "object" ? (r.show as Record<string, unknown>) : {};
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  const startDate = isIsoDate(r.startDate) ? r.startDate : d.startDate;
  let deadlineDate = isIsoDate(r.deadlineDate) ? r.deadlineDate : d.deadlineDate;
  if (deadlineDate < startDate) deadlineDate = startDate;
  return {
    title: str(r.title, 40) || d.title,
    tagline: "tagline" in r ? str(r.tagline, RACE_LIMITS.text) : d.tagline,
    startDate,
    deadlineDate,
    deadlineTime: isHm(r.deadlineTime) ? r.deadlineTime : d.deadlineTime,
    approvalsGoal: int(r.approvalsGoal, 1, RACE_LIMITS.goal, d.approvalsGoal),
    slotsGoal: int(r.slotsGoal, 1, RACE_LIMITS.goal, d.slotsGoal),
    home: cleanSide(r.home, d.home),
    rival: cleanSide(r.rival, d.rival),
    rivalToken: isRaceToken(r.rivalToken) ? r.rivalToken : "",
    rivalCanLog: bool(r.rivalCanLog, d.rivalCanLog),
    finale: "finale" in r ? str(r.finale, 60) : d.finale,
    show: {
      slots: bool(show.slots, d.show.slots),
      trail: bool(show.trail, d.show.trail),
      programs: bool(show.programs, d.show.programs),
      together: bool(show.together, d.show.together),
      feed: bool(show.feed, d.show.feed),
    },
  };
}

/** What Save refuses, said plainly — `resolveRaceSettings` would otherwise
 *  clamp or drop a bad value without a word and the editor would think it
 *  was saved. `stored` is the raw JSON the patch lands on. */
export function raceSettingsProblem(patch: Record<string, unknown>, stored: unknown = {}): string | null {
  for (const [key, what] of [["approvalsGoal", "approvals goal"], ["slotsGoal", "slots goal"]] as const)
    if (key in patch && !whole(patch[key], 1, RACE_LIMITS.goal)) return `The ${what} must be a whole number from 1 to ${RACE_LIMITS.goal}.`;
  for (const [key, what] of [["startDate", "start date"], ["deadlineDate", "deadline"]] as const)
    if (key in patch && !isIsoDate(patch[key])) return `The ${what} isn't a real date.`;
  if ("deadlineTime" in patch && !isHm(patch.deadlineTime)) return "The deadline time isn't valid (HH:MM).";
  if ("title" in patch && !str(patch.title, 40)) return "The race needs a title.";
  for (const side of SIDES) {
    if (!(side in patch)) continue;
    const s = patch[side] && typeof patch[side] === "object" ? (patch[side] as Record<string, unknown>) : null;
    if (!s) return "One of the LCs didn't come through — reload and try again.";
    const who = str(s.name, 30) || (side === "home" ? "Alexandria" : "MUST");
    if (!str(s.name, 30)) return "Every LC needs a name.";
    if ("color" in s && !isHex(s.color)) return `${who}'s colour must look like #037EF3.`;
    if ("coreId" in s && !whole(s.coreId, 1, 10_000_000)) return `${who}'s CORE id must be a whole number.`;
    if ("baseline" in s) {
      const b = s.baseline && typeof s.baseline === "object" ? (s.baseline as Record<string, unknown>) : null;
      if (!b) return `${who}'s start counts didn't come through.`;
      for (const k of PROGRAMS)
        if (!whole(b[k], 0, RACE_LIMITS.baseline)) return `${who}'s ${k} start count must be a whole number (0 or more).`;
    }
  }
  const was = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const start = "startDate" in patch ? patch.startDate : isIsoDate(was.startDate) ? was.startDate : DEFAULT_RACE.startDate;
  const end = "deadlineDate" in patch ? patch.deadlineDate : isIsoDate(was.deadlineDate) ? was.deadlineDate : DEFAULT_RACE.deadlineDate;
  if (isIsoDate(start) && isIsoDate(end) && end < start) return "The deadline can't be before the start.";
  return null;
}

// ------------------------------------------------------------------ CORE

export interface CoreReading {
  total: number;
  programs: ProgramCounts;
}

const PROGRAM_BY_LOWER = new Map(PROGRAMS.map((p) => [p.toLowerCase(), p]));

/** An LC's CORE page (/analytics/lc/<id>/) → its "approved 26/27" panel:
 *  one <h5>program</h5><div>count</div> pair per program, then the Total.
 *  Null when the panel can't be found or carries no numbers. */
export function parseCoreApproved(html: string): CoreReading | null {
  const at = html.search(/<h3[^>]*>\s*approved\s+\d{2}\/\d{2}\s*<\/h3>/i);
  if (at < 0) return null;
  const rest = html.slice(at);
  const next = rest.slice(8).search(/<h3[^>]*panel-title/i);
  const seg = next > 0 ? rest.slice(0, next + 8) : rest.slice(0, 20000);
  const programs = zeroPrograms();
  let found = 0;
  let total: number | null = null;
  for (const m of seg.matchAll(/<h5[^>]*>\s*([^<]+?)\s*<\/h5>\s*<div[^>]*>\s*([\d,]+)\s*<\/div>/gi)) {
    const label = m[1].trim().toLowerCase();
    const n = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (label === "total") total = n;
    const p = PROGRAM_BY_LOWER.get(label);
    if (p) {
      programs[p] = n;
      found++;
    }
  }
  if (found === 0 && total === null) return null;
  return { total: total ?? sumPrograms(programs), programs };
}

// ------------------------------------------------------------------ clock

export interface RaceClock {
  start: number;
  deadline: number;
}

export function raceClock(s: Pick<RaceSettings, "startDate" | "deadlineDate" | "deadlineTime">): RaceClock {
  return { start: cairoInstant(s.startDate), deadline: cairoInstant(s.deadlineDate, s.deadlineTime) };
}

export type RacePhase = "before" | "live" | "over";
export const racePhase = (c: RaceClock, now: number): RacePhase =>
  now < c.start ? "before" : now >= c.deadline ? "over" : "live";

/** MUST may log a slot dated up to the deadline day for a day after it — the
 *  last evening's numbers arrive the next morning. */
export const RIVAL_GRACE_MS = 24 * 3_600_000;

/** Is MUST's desk taking entries right now? */
export function rivalDeskOpen(s: Pick<RaceSettings, "rivalCanLog" | "startDate" | "deadlineDate" | "deadlineTime">, now: number = Date.now()): boolean {
  return s.rivalCanLog && now <= raceClock(s).deadline + RIVAL_GRACE_MS;
}

export function rivalDateWindow(s: Pick<RaceSettings, "startDate" | "deadlineDate">): { min: string; max: string } {
  return { min: s.startDate, max: s.deadlineDate };
}

export { addDays, splitDuration };

// ------------------------------------------------------------------ the snapshot

export interface RaceReading {
  id: string;
  side: Side;
  total: number;
  programs: Partial<ProgramCounts>;
  source: "core" | "manual";
  at: string;
}

export interface RaceEntry {
  id: string;
  side: Side;
  qty: number;
  occurred_on: string;
  created_at: string;
}

/** One Sodio deal, as far as the race needs it (no account, no owner). */
export interface RaceDeal {
  id: string;
  created_at: string;
  igv: number;
  igta: number;
  igte: number;
}

export interface LaneState {
  value: number;
  goal: number;
  /** when the goal was first reached (ISO), inside the race — else null */
  reachedAt: string | null;
}

export interface ApprovalLane extends LaneState {
  /** CORE's whole-term total at the latest reading (null = no reading yet) */
  total: number | null;
  baseline: number;
  byProgram: ProgramCounts;
  readAt: string | null;
  source: "core" | "manual" | null;
}

export interface RaceFeedItem {
  id: string;
  side: Side;
  kind: "approvals" | "slots";
  delta: number;
  /** e.g. "IGV 2 · IGTe 1" for a Sodio deal; "" otherwise */
  detail: string;
  at: string;
}

export interface Verdict {
  /** the side ahead right now (null = level) */
  leader: Side | null;
  /** the side that reached the goal first (null = nobody yet, or a dead heat) */
  winner: Side | null;
}

export type PublicRaceSide = Pick<RaceSideSettings, "name" | "short" | "color">;
export type PublicRaceSettings = Omit<RaceSettings, "home" | "rival" | "rivalToken" | "rivalCanLog"> & {
  home: PublicRaceSide;
  rival: PublicRaceSide;
};

/** What /alex-vs-must renders and every live push carries. Public by design:
 *  counts and times only — never a note, an account, a person or the link. */
export interface RaceSnapshot {
  settings: PublicRaceSettings;
  approvals: { home: ApprovalLane; rival: ApprovalLane } & Verdict;
  slots: { home: LaneState; rival: LaneState } & Verdict;
  /** approvals since the start, over time: one point per change */
  trail: { at: string; home: number; rival: number }[];
  feed: RaceFeedItem[];
  at: string;
}

const TRAIL_MAX = 240;
const FEED_MAX = 30;

function verdict(home: LaneState, rival: LaneState): Verdict {
  const leader = home.value === rival.value ? null : home.value > rival.value ? "home" : "rival";
  const h = home.reachedAt ? Date.parse(home.reachedAt) : null;
  const r = rival.reachedAt ? Date.parse(rival.reachedAt) : null;
  let winner: Side | null = null;
  if (h !== null && (r === null || h < r)) winner = "home";
  else if (r !== null && (h === null || r < h)) winner = "rival";
  else if (h !== null && r !== null) winner = leader; // crossed in the same reading: further past the line
  return { leader, winner };
}

const dealDetail = (d: RaceDeal) =>
  [d.igv ? `IGV ${d.igv}` : "", d.igta ? `IGTa ${d.igta}` : "", d.igte ? `IGTe ${d.igte}` : ""].filter(Boolean).join(" · ");

/** Readings + entries + deals → the board. `now` is when it's built. */
export function buildRaceSnapshot(input: {
  settings: RaceSettings;
  readings: RaceReading[];
  entries: RaceEntry[];
  deals: RaceDeal[];
  now?: number;
  at?: string;
}): RaceSnapshot {
  const s = input.settings;
  const now = input.now ?? Date.now();
  const clock = raceClock(s);
  const cutoff = Math.min(now, clock.deadline);
  const inRace = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t <= clock.deadline;
  };

  // ---- approvals (CORE readings) — oldest first, none after the deadline
  const readings = input.readings
    .filter((r) => inRace(r.at))
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const feed: RaceFeedItem[] = [];
  const lane = (side: Side): ApprovalLane => {
    const base = s[side].baseline;
    const baseTotal = sumPrograms(base);
    const mine = readings.filter((r) => r.side === side);
    let reachedAt: string | null = null;
    let prev = baseTotal;
    for (const r of mine) {
      const t = Date.parse(r.at);
      if (t >= clock.start && r.total !== prev)
        feed.push({ id: `a-${r.id}`, side, kind: "approvals", delta: r.total - prev, detail: "", at: r.at });
      prev = r.total;
      if (!reachedAt && t >= clock.start && r.total - baseTotal >= s.approvalsGoal) reachedAt = r.at;
    }
    const last = mine[mine.length - 1] ?? null;
    const byProgram = zeroPrograms();
    if (last) for (const k of PROGRAMS) byProgram[k] = Math.max(0, (last.programs[k] ?? base[k]) - base[k]);
    return {
      value: last ? Math.max(0, last.total - baseTotal) : 0,
      goal: s.approvalsGoal,
      reachedAt,
      total: last?.total ?? null,
      baseline: baseTotal,
      byProgram,
      readAt: last?.at ?? null,
      source: last?.source ?? null,
    };
  };
  const aHome = lane("home");
  const aRival = lane("rival");

  // ---- the trail: one point per change, both lines carried along
  const trail: RaceSnapshot["trail"] = [{ at: new Date(clock.start).toISOString(), home: 0, rival: 0 }];
  const cur = { home: 0, rival: 0 };
  const base = { home: sumPrograms(s.home.baseline), rival: sumPrograms(s.rival.baseline) };
  for (const r of readings) {
    const t = Date.parse(r.at);
    cur[r.side] = Math.max(0, r.total - base[r.side]);
    if (t < clock.start) continue;
    trail.push({ at: r.at, home: cur.home, rival: cur.rival });
  }
  if (cutoff > clock.start) trail.push({ at: new Date(cutoff).toISOString(), home: cur.home, rival: cur.rival });
  // keep it light on the wire: the first point, then an even spread
  const thin =
    trail.length <= TRAIL_MAX
      ? trail
      : trail.filter((_, i) => i === 0 || i === trail.length - 1 || i % Math.ceil(trail.length / TRAIL_MAX) === 0);

  // ---- slots: Sodio deals + entries, in the order they were recorded
  type Tick = { id: string; side: Side; qty: number; at: string; detail: string };
  const ticks: Tick[] = [];
  for (const d of input.deals) {
    const t = Date.parse(d.created_at);
    const qty = (d.igv || 0) + (d.igta || 0) + (d.igte || 0);
    if (!Number.isFinite(t) || t < clock.start || t > clock.deadline || qty <= 0) continue;
    ticks.push({ id: `d-${d.id}`, side: "home", qty, at: d.created_at, detail: dealDetail(d) });
  }
  for (const e of input.entries) {
    if (e.occurred_on < s.startDate || e.occurred_on > s.deadlineDate || e.qty <= 0) continue;
    ticks.push({ id: `e-${e.id}`, side: e.side, qty: e.qty, at: e.created_at, detail: "" });
  }
  ticks.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const slotLane = (side: Side): LaneState => {
    let value = 0;
    let reachedAt: string | null = null;
    for (const t of ticks) {
      if (t.side !== side) continue;
      value += t.qty;
      if (!reachedAt && value >= s.slotsGoal) reachedAt = t.at;
    }
    return { value, goal: s.slotsGoal, reachedAt };
  };
  const sHome = slotLane("home");
  const sRival = slotLane("rival");
  for (const t of ticks) feed.push({ id: t.id, side: t.side, kind: "slots", delta: t.qty, detail: t.detail, at: t.at });

  const { home, rival, rivalToken: _t, rivalCanLog: _l, ...rest } = s;
  void _t;
  void _l;
  return {
    settings: {
      ...rest,
      home: { name: home.name, short: home.short, color: home.color },
      rival: { name: rival.name, short: rival.short, color: rival.color },
    },
    approvals: { home: aHome, rival: aRival, ...verdict(aHome, aRival) },
    slots: { home: sHome, rival: sRival, ...verdict(sHome, sRival) },
    trail: s.show.trail ? thin : [],
    feed: s.show.feed ? feed.sort((a, b) => b.at.localeCompare(a.at)).slice(0, FEED_MAX) : [],
    at: input.at ?? new Date(now).toISOString(),
  };
}

// ------------------------------------------------------------------ reading the board

/** Approvals per day so far, and what each side needs per day to make it. */
export function pace(lane: LaneState, c: RaceClock, now: number): { perDay: number; needPerDay: number | null; eta: number | null } {
  const DAY = 86_400_000;
  const elapsed = Math.max(0, Math.min(now, c.deadline) - c.start) / DAY;
  const left = Math.max(0, c.deadline - now) / DAY;
  const perDay = elapsed >= 0.5 ? lane.value / elapsed : 0;
  const remaining = Math.max(0, lane.goal - lane.value);
  const needPerDay = remaining === 0 ? 0 : left > 0 ? remaining / Math.max(left, 0.25) : null;
  const eta = remaining === 0 ? null : perDay > 0 ? now + (remaining / perDay) * DAY : null;
  return { perDay, needPerDay, eta };
}
