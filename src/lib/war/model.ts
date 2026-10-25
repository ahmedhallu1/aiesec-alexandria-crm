/** THE "NO PEACE" WAR (v38) — pure, client-safe model.
 *
 *  AIESEC in Alexandria's points race, 25 Oct → 25 Nov 2026. The F&L VP logs
 *  what people achieved in the War Room (/war-room); /no-peace shows the
 *  standings live. Everything the LC might want to change — the point table,
 *  the rewards, the rules, the dates, who competes — lives in
 *  `war_campaigns.settings` and is edited from the War Room, never in code.
 *
 *  SCORING: an achievement entry is (kind × qty) and its points come from the
 *  point table AT READ TIME, so correcting "IGT OPEN = 15" re-scores every
 *  entry. A bonus entry (attendance, engagement, anything) carries its own
 *  number and an optional comment. Points belong to the person who earned
 *  them and to nobody else — "members' achievements are not their MMs'
 *  achievements" — so there is no roll-up of any kind. */

export const WAR_SLUG = "no-peace";
export const WAR_PUBLIC_PATH = "/no-peace";
export const WAR_ROOM_PATH = "/war-room";
export const BONUS = "bonus";

export type PointGroup = "OGX" | "ICX" | "LC";

export interface PointType {
  key: string;
  label: string;
  points: number;
  group: PointGroup;
  /** one line on the public page's arsenal card */
  hint: string;
}

export interface Reward {
  /** the rank this reward goes to (1 = first) */
  rank: number;
  place: string;
  title: string;
  detail: string;
  emoji: string;
}

export interface WarCompetitors {
  /** roles that compete by default */
  roles: string[];
  /** "FUNCTION:Role" pairs left out, e.g. "TM:Coordinator" */
  excludeFunctionRoles: string[];
  /** people left out by name, whatever their role */
  exclude: string[];
  /** people let in by name (still only while active) */
  include: string[];
}

/** THE FUNCTION RACE (v38.3). Each competitor's points go to their MAIN
 *  function only (the first one listed — the same label shown beside their
 *  name), so the function totals add up to the LC total minus the excluded
 *  functions. B2B and BD race separately (BD signs deals, B2B raises opens).
 *  Ranked on TOTAL points, as the LC asked — bigger functions are meant to
 *  carry more. */
export interface FunctionBoardSettings {
  enabled: boolean;
  /** functions that don't take part (their people still race as people) */
  exclude: string[];
}

export interface WarSettings {
  name: string;
  tagline: string;
  /** YYYY-MM-DD, Cairo, inclusive both ends */
  startDate: string;
  endDate: string;
  activateLabel: string;
  activateDate: string;
  /** HH:MM, Cairo */
  activateTime: string;
  minPoints: number;
  pointTypes: PointType[];
  rewards: Reward[];
  rules: string[];
  heroLines: string[];
  motto: string;
  competitors: WarCompetitors;
  show: { national: boolean; feed: boolean; breakdown: boolean; avatars: boolean };
  /** v38.3 — functions race each other on total points (see functionStandings) */
  functionBoard: FunctionBoardSettings;
}

export const DEFAULT_POINT_TYPES: PointType[] = [
  { key: "ogv_apd", label: "OGV APD", points: 7, group: "OGX", hint: "An OGV approval" },
  { key: "ogt_apd", label: "OGT APD", points: 12, group: "OGX", hint: "An OGT approval" },
  { key: "sus_10", label: "10 SUs", points: 2, group: "OGX", hint: "Every 10 sign-ups" },
  { key: "igv_apd", label: "IGV APD", points: 6, group: "ICX", hint: "An IGV approval" },
  { key: "igt_apd", label: "IGT APD", points: 10, group: "ICX", hint: "An IGT approval" },
  { key: "igv_open", label: "IGV OPEN", points: 10, group: "ICX", hint: "An IGV open raised" },
  { key: "igt_open", label: "IGT OPEN", points: 15, group: "ICX", hint: "An IGT open raised" },
  { key: "partner", label: "PARTNER", points: 20, group: "LC", hint: "A partnership signed" },
  { key: "pr_deal", label: "PR DEAL", points: 12, group: "LC", hint: "A PR deal closed" },
];

export const DEFAULT_WAR: WarSettings = {
  name: "No Peace",
  tagline: "We're declaring war. Our goal: conquer the national plenary — excellence in each and every function.",
  startDate: "2026-10-25",
  endDate: "2026-11-25",
  activateLabel: "Activate 26'",
  // opening morning, as the Activate 26' bid page counts it (hero day0, 09:00)
  activateDate: "2026-12-02",
  activateTime: "09:00",
  minPoints: 35,
  pointTypes: DEFAULT_POINT_TYPES,
  // the LC's own words (the war declaration); details are the F&L VP's to add
  rewards: [
    { rank: 1, place: "1st", title: "Free Activate", detail: "", emoji: "🥇" },
    { rank: 2, place: "2nd", title: "75% discount on Activate", detail: "", emoji: "🥈" },
    { rank: 3, place: "3rd", title: "50% discount on Activate", detail: "", emoji: "🥉" },
    { rank: 4, place: "Runner-up", title: "Free LC hoodie", detail: "", emoji: "🏅" },
  ],
  rules: [
    "To compete for rewards you need at least 35 war points.",
    "Members' achievements are not counted as their MMs' achievements — every point belongs to the one who earned it.",
    "The war points counter runs from 25/10 to 25/11.",
    "Attendance & engagement rate are calculated and added to war points at every checkpoint.",
  ],
  heroLines: ["The city is on alert", "The troops are ready", "The mission is clear"],
  motto: "Make Alexandria great again…",
  competitors: {
    roles: ["Member", "Coordinator", "Team Leader"],
    excludeFunctionRoles: ["TM:Coordinator"],
    exclude: [],
    include: [],
  },
  show: { national: true, feed: true, breakdown: true, avatars: true },
  // the LC's call: CXP, TM, IM and F&L are not part of the function race
  functionBoard: { enabled: true, exclude: ["CXP", "TM", "IM", "F&L"] },
};

export const COMPETITOR_ROLES = ["Member", "Coordinator", "Team Leader", "Director", "LCVP", "LCP"] as const;

export const LIMITS = {
  pointTypes: 24,
  rewards: 10,
  rules: 15,
  text: 300,
  label: 24,
  qty: 1000,
  bonus: 1000,
  note: 300,
  batch: 120,
} as const;

// ------------------------------------------------------------------ sanitizing

const str = (v: unknown, max: number, fallback = ""): string =>
  typeof v === "string" ? v.trim().slice(0, max) : fallback;
const int = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
/** A real calendar date — the round trip refuses "2026-02-31", which
 *  Date.parse would otherwise roll over into March. */
export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
};
const isHm = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

export function slugKey(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "type"
  );
}

function cleanPointTypes(v: unknown): PointType[] {
  if (!Array.isArray(v)) return DEFAULT_POINT_TYPES;
  const seen = new Set<string>();
  const out: PointType[] = [];
  for (const raw of v.slice(0, LIMITS.pointTypes)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const label = str(r.label, LIMITS.label);
    if (!label) continue;
    let key = str(r.key, 24) || slugKey(label);
    if (!/^[a-z0-9_]{1,24}$/.test(key)) key = slugKey(label);
    // "bonus" is the free-points entry's own kind — a type may never take it
    if (key === BONUS) key = "type_bonus";
    while (seen.has(key)) key = `${key.slice(0, 21)}_${seen.size}`;
    seen.add(key);
    const group: PointGroup = r.group === "OGX" || r.group === "ICX" ? r.group : "LC";
    out.push({ key, label, points: int(r.points, 0, 1000, 0), group, hint: str(r.hint, 80) });
  }
  return out;
}

function cleanRewards(v: unknown): Reward[] {
  if (!Array.isArray(v)) return DEFAULT_WAR.rewards;
  return v
    .slice(0, LIMITS.rewards)
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((r, i) => ({
      rank: int(r.rank, 1, 99, i + 1),
      place: str(r.place, 24) || `#${i + 1}`,
      title: str(r.title, 60),
      detail: str(r.detail, LIMITS.text),
      emoji: str(r.emoji, 8) || "🎖️",
    }))
    .filter((r) => r.title)
    .sort((a, b) => a.rank - b.rank);
}

/** Stored JSON → full settings. Every missing or broken key falls back to the
 *  default, so a half-written row can never break the page. */
export function resolveWarSettings(raw: unknown, name?: string | null): WarSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_WAR;
  const comp = r.competitors && typeof r.competitors === "object" ? (r.competitors as Record<string, unknown>) : {};
  const show = r.show && typeof r.show === "object" ? (r.show as Record<string, unknown>) : {};
  const fb = r.functionBoard && typeof r.functionBoard === "object" ? (r.functionBoard as Record<string, unknown>) : {};
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  const startDate = isIsoDate(r.startDate) ? r.startDate : d.startDate;
  let endDate = isIsoDate(r.endDate) ? r.endDate : d.endDate;
  if (endDate < startDate) endDate = startDate;
  const exclude = strList(comp.exclude, 400, 40);
  return {
    name: str(r.name, 40) || str(name, 40) || d.name,
    tagline: "tagline" in r ? str(r.tagline, LIMITS.text) : d.tagline,
    startDate,
    endDate,
    activateLabel: str(r.activateLabel, 30) || d.activateLabel,
    activateDate: isIsoDate(r.activateDate) ? r.activateDate : d.activateDate,
    activateTime: isHm(r.activateTime) ? r.activateTime : d.activateTime,
    minPoints: int(r.minPoints, 0, 10000, d.minPoints),
    pointTypes: "pointTypes" in r ? cleanPointTypes(r.pointTypes) : d.pointTypes,
    rewards: "rewards" in r ? cleanRewards(r.rewards) : d.rewards,
    rules: "rules" in r ? strList(r.rules, LIMITS.rules, LIMITS.text) : d.rules,
    heroLines: "heroLines" in r ? strList(r.heroLines, 5, 60) : d.heroLines,
    motto: "motto" in r ? str(r.motto, 80) : d.motto,
    competitors: {
      roles: "roles" in comp ? strList(comp.roles, 10, 20) : d.competitors.roles,
      excludeFunctionRoles:
        "excludeFunctionRoles" in comp
          ? strList(comp.excludeFunctionRoles, 30, 40).filter((p) => /^[^:]+:[^:]+$/.test(p))
          : d.competitors.excludeFunctionRoles,
      exclude,
      // out wins (isCompetitor) — so a name on both lists is only "out"
      include: strList(comp.include, 400, 40).filter((id) => !exclude.includes(id)),
    },
    functionBoard: {
      enabled: bool(fb.enabled, d.functionBoard.enabled),
      exclude: "exclude" in fb ? strList(fb.exclude, 30, 20) : d.functionBoard.exclude,
    },
    show: {
      national: bool(show.national, d.show.national),
      feed: bool(show.feed, d.show.feed),
      breakdown: bool(show.breakdown, d.show.breakdown),
      avatars: bool(show.avatars, d.show.avatars),
    },
  };
}

/** What Save refuses, said plainly — the server half of the War Room form's
 *  own checks. `resolveWarSettings` would otherwise drop a blank row, clamp a
 *  date or merge two rewards for one rank without a word, and the editor would
 *  believe it was saved. `stored` is the raw stored JSON the patch lands on
 *  (for a start date checked against an end date the patch doesn't carry). */
export function warSettingsProblem(patch: Record<string, unknown>, stored: unknown = {}): string | null {
  const whole = (v: unknown, min: number, max: number): boolean => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isInteger(n) && n >= min && n <= max;
  };
  const rows = (v: unknown) =>
    (v as unknown[]).map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}));

  if ("pointTypes" in patch) {
    if (!Array.isArray(patch.pointTypes)) return "The point table didn't come through — reload and try again.";
    if (patch.pointTypes.length > LIMITS.pointTypes) return `At most ${LIMITS.pointTypes} point types.`;
    for (const t of rows(patch.pointTypes)) {
      if (!str(t.label, LIMITS.label)) return "Every point type needs a name.";
      if (!whole(t.points, 0, 1000)) return `"${str(t.label, LIMITS.label)}" needs whole points from 0 to 1000.`;
    }
  }
  if ("rewards" in patch) {
    if (!Array.isArray(patch.rewards)) return "The rewards didn't come through — reload and try again.";
    if (patch.rewards.length > LIMITS.rewards) return `At most ${LIMITS.rewards} rewards.`;
    const ranks = new Set<number>();
    for (const r of rows(patch.rewards)) {
      if (!str(r.title, 60)) return "Every reward needs a title.";
      if (!whole(r.rank, 1, 99)) return `"${str(r.title, 60)}" needs a whole rank from 1 to 99.`;
      // two rewards for one rank: the board would show one and silently drop the other
      const rank = Number(r.rank);
      if (ranks.has(rank)) return `Two rewards are set for rank ${rank} — give each rank one reward.`;
      ranks.add(rank);
    }
  }
  if ("minPoints" in patch && !whole(patch.minPoints, 0, 10000))
    return "Points to compete must be a whole number from 0 to 10000.";
  for (const [key, what] of [["startDate", "start date"], ["endDate", "end date"], ["activateDate", "countdown date"]] as const)
    if (key in patch && !isIsoDate(patch[key])) return `The ${what} isn't a real date.`;
  if ("activateTime" in patch && !isHm(patch.activateTime)) return "The countdown time isn't valid (HH:MM).";
  const was = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const start = "startDate" in patch ? patch.startDate : isIsoDate(was.startDate) ? was.startDate : DEFAULT_WAR.startDate;
  const end = "endDate" in patch ? patch.endDate : isIsoDate(was.endDate) ? was.endDate : DEFAULT_WAR.endDate;
  if (isIsoDate(start) && isIsoDate(end) && end < start) return "The war can't end before it starts.";
  return null;
}

/** The dates an entry may carry: the war plus a week of grace either side —
 *  the last day's numbers often land late, and a checkpoint can be logged a
 *  little early. One rule for logging AND editing. */
export const WAR_DATE_GRACE_DAYS = 7;

export function warDateWindow(s: Pick<WarSettings, "startDate" | "endDate">): { min: string; max: string } {
  return { min: addDays(s.startDate, -WAR_DATE_GRACE_DAYS), max: addDays(s.endDate, WAR_DATE_GRACE_DAYS) };
}

export function inWarWindow(day: string, s: Pick<WarSettings, "startDate" | "endDate">): boolean {
  const { min, max } = warDateWindow(s);
  return isIsoDate(day) && day >= min && day <= max;
}

// ------------------------------------------------------------------ who competes

export interface WarPerson {
  id: string;
  name: string;
  role: string;
  functions: string[];
  sub_functions: string[];
  is_active: boolean;
  avatar_url?: string | null;
}

/** Active only — always. Then: named out → out; named in → in; else the
 *  role must compete and no "FUNCTION:Role" exclusion may match. */
export function isCompetitor(p: WarPerson, c: WarCompetitors): boolean {
  if (!p.is_active) return false;
  if (c.exclude.includes(p.id)) return false;
  if (c.include.includes(p.id)) return true;
  if (!c.roles.includes(p.role)) return false;
  const fns = [...p.functions, ...p.sub_functions];
  return !c.excludeFunctionRoles.some((pair) => {
    const [fn, role] = pair.split(":");
    return p.role === role && fns.includes(fn);
  });
}

export function primaryFunction(p: Pick<WarPerson, "functions" | "sub_functions">): string {
  return p.functions[0] ?? p.sub_functions[0] ?? "—";
}

// ------------------------------------------------------------------ scoring

export interface WarEntry {
  id: string;
  member_id: string;
  kind: string;
  qty: number;
  points: number | null;
  note: string | null;
  occurred_on: string;
  created_at: string;
}

export function entryPoints(e: Pick<WarEntry, "kind" | "qty" | "points">, types: Map<string, PointType>): number {
  if (e.kind === BONUS) return e.points ?? 0;
  return (types.get(e.kind)?.points ?? 0) * e.qty;
}

export function kindLabel(kind: string, types: Map<string, PointType>): string {
  return kind === BONUS ? "Bonus" : types.get(kind)?.label ?? "Removed type";
}

export interface StandingRow {
  id: string;
  name: string;
  avatar: string | null;
  fn: string;
  role: string;
  points: number;
  rank: number;
  eligible: boolean;
  /** qty per point-type key; bonus points under "bonus" */
  breakdown: Record<string, number>;
  /** when they last scored (ISO) — null if never */
  lastAt: string | null;
}

/** Only a real, short https avatar goes on the public page. An uploaded
 *  avatar can be a 25 KB data: URI, and every live push carries every row —
 *  one of those would outweigh the rest of the snapshot. Initials instead. */
export function publicAvatar(url: string | null | undefined): string | null {
  return url && /^https:\/\//.test(url) && url.length <= 600 ? url : null;
}

/** Ranked standings. Ties SHARE a rank (1, 2, 2, 4) — the LC decides a tie,
 *  the page never invents a tie-break. Inside a tie the order is the one who
 *  got there first, then the name, so the list is stable. */
export function standings(
  people: WarPerson[],
  entries: WarEntry[],
  s: WarSettings,
  opts: { avatars?: boolean } = {}
): StandingRow[] {
  const types = new Map(s.pointTypes.map((t) => [t.key, t]));
  const rows = new Map<string, StandingRow>();
  for (const p of people) {
    if (!isCompetitor(p, s.competitors)) continue;
    rows.set(p.id, {
      id: p.id,
      name: p.name,
      avatar: opts.avatars === false ? null : publicAvatar(p.avatar_url),
      fn: primaryFunction(p),
      role: p.role,
      points: 0,
      rank: 0,
      eligible: false,
      breakdown: {},
      lastAt: null,
    });
  }
  for (const e of entries) {
    const row = rows.get(e.member_id);
    if (!row) continue;
    const pts = entryPoints(e, types);
    row.points += pts;
    if (e.kind === BONUS) row.breakdown[BONUS] = (row.breakdown[BONUS] ?? 0) + (e.points ?? 0);
    else row.breakdown[e.kind] = (row.breakdown[e.kind] ?? 0) + e.qty;
    if (!row.lastAt || e.created_at > row.lastAt) row.lastAt = e.created_at;
  }
  const list = [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      (a.lastAt ?? "~").localeCompare(b.lastAt ?? "~") ||
      a.name.localeCompare(b.name)
  );
  let rank = 0;
  list.forEach((r, i) => {
    if (i === 0 || r.points !== list[i - 1].points) rank = i + 1;
    r.rank = rank;
    r.eligible = r.points >= s.minPoints && r.points > 0;
  });
  return list;
}

/** The reward a rank is in line for — only for someone over the minimum.
 *  The list is sorted by points, so everyone over the minimum sits above
 *  everyone under it and their rank IS their place among the eligible. */
export function rewardFor(row: Pick<StandingRow, "rank" | "eligible">, rewards: Reward[]): Reward | null {
  if (!row.eligible) return null;
  return rewards.find((r) => r.rank === row.rank) ?? null;
}

// ------------------------------------------------------------------ Cairo clock

const DAY_MS = 86_400_000;

/** Africa/Cairo offset (minutes east of UTC) at an instant — Egypt has
 *  summer time again since 2023, so it is never a constant. */
export function cairoOffsetMinutes(at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

/** A Cairo wall-clock date + time → the UTC instant (ms). */
export function cairoInstant(date: string, time = "00:00"): number {
  const guess = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(guess)) return NaN;
  let t = guess - cairoOffsetMinutes(guess) * 60000;
  const again = guess - cairoOffsetMinutes(t) * 60000;
  if (again !== t) t = again;
  return t;
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export interface WarClock {
  start: number;
  /** the first instant AFTER the last day */
  end: number;
  activate: number;
  totalDays: number;
}

export function warClock(s: Pick<WarSettings, "startDate" | "endDate" | "activateDate" | "activateTime">): WarClock {
  const start = cairoInstant(s.startDate);
  const end = cairoInstant(addDays(s.endDate, 1));
  return {
    start,
    end,
    activate: cairoInstant(s.activateDate, s.activateTime),
    totalDays: Math.round((Date.parse(`${s.endDate}T00:00:00Z`) - Date.parse(`${s.startDate}T00:00:00Z`)) / DAY_MS) + 1,
  };
}

export type WarPhase = "before" | "live" | "over";

export function warPhase(c: WarClock, now: number): WarPhase {
  return now < c.start ? "before" : now >= c.end ? "over" : "live";
}

/** The Cairo calendar day an instant falls on, as a day number. */
const cairoDayNumber = (at: number): number => Math.floor((at + cairoOffsetMinutes(at) * 60000) / DAY_MS);

/** 1-based day of the war (clamped), e.g. "Day 3 of 32". Counted in Cairo
 *  CALENDAR days, not 24-hour blocks from the start: once summer time ends
 *  the war's days are 25 h / 23 h apart in UTC, and a block count would turn
 *  the day over an hour early. */
export function warDay(c: WarClock, now: number): number {
  if (now < c.start) return 0;
  return Math.min(c.totalDays, Math.max(1, cairoDayNumber(now) - cairoDayNumber(c.start) + 1));
}

export function warProgress(c: WarClock, now: number): number {
  if (c.end <= c.start) return 0;
  return Math.min(1, Math.max(0, (now - c.start) / (c.end - c.start)));
}

export function splitDuration(ms: number): { d: number; h: number; m: number; s: number } {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

// ------------------------------------------------------------------ the public snapshot

export interface FeedItem {
  id: string;
  memberId: string;
  name: string;
  kind: string;
  label: string;
  qty: number;
  points: number;
  at: string;
}

export interface NationalCell {
  program: string;
  rank: number | null;
  count: number | null;
  leader: { lc: string; count: number } | null;
  listed: number;
}

export interface NationalStanding {
  stages: { stage: "approved" | "realized" | "completed"; label: string; cells: NationalCell[] }[];
  fetchedAt: string;
}

export interface FunctionRow {
  fn: string;
  points: number;
  /** shared on ties, like people */
  rank: number;
  /** people from this function in the race */
  troops: number;
  /** how many of them have scored */
  scorers: number;
  /** their best scorer (null until someone scores) */
  top: { name: string; points: number } | null;
}

/** The function race: every competitor's points summed under their MAIN
 *  function (`StandingRow.fn`), excluded functions left out. Functions with
 *  people in the race but no points yet still appear, at the bottom. */
export function functionStandings(rows: StandingRow[], fb: FunctionBoardSettings): FunctionRow[] {
  if (!fb.enabled) return [];
  const out = new Map<string, FunctionRow>();
  for (const r of rows) {
    if (!r.fn || r.fn === "—" || fb.exclude.includes(r.fn)) continue;
    const f = out.get(r.fn) ?? { fn: r.fn, points: 0, rank: 0, troops: 0, scorers: 0, top: null };
    f.points += r.points;
    f.troops += 1;
    if (r.points > 0) {
      f.scorers += 1;
      if (!f.top || r.points > f.top.points) f.top = { name: r.name, points: r.points };
    }
    out.set(r.fn, f);
  }
  const list = [...out.values()].sort((a, b) => b.points - a.points || a.fn.localeCompare(b.fn));
  let rank = 0;
  list.forEach((f, i) => {
    if (i === 0 || f.points !== list[i - 1].points) rank = i + 1;
    f.rank = rank;
  });
  return list;
}

/** What /no-peace renders and what every live update carries. Public by
 *  design: names (the LC chose full names), points, what they scored. Never
 *  an email, a phone, a note or who logged it. */
export interface WarSnapshot {
  settings: Omit<WarSettings, "competitors">;
  rows: StandingRow[];
  feed: FeedItem[];
  /** the function race (empty when switched off) */
  functions: FunctionRow[];
  totals: { points: number; entries: number; troops: number; enlisted: number; byKind: Record<string, { qty: number; points: number }> };
  at: string;
}

export function buildSnapshot(
  people: WarPerson[],
  entries: WarEntry[],
  s: WarSettings,
  feedSize = 40,
  /** when the reads were made — the caller stamps it BEFORE reading, so a
   *  page can trust "newer `at`" to mean "newer data" */
  at: string = new Date().toISOString()
): WarSnapshot {
  const types = new Map(s.pointTypes.map((t) => [t.key, t]));
  const rows = standings(people, entries, s, { avatars: s.show.avatars });
  const inRace = new Map(rows.map((r) => [r.id, r]));
  const counted = entries.filter((e) => inRace.has(e.member_id));
  const byKind: Record<string, { qty: number; points: number }> = {};
  for (const e of counted) {
    const k = (byKind[e.kind] ??= { qty: 0, points: 0 });
    k.qty += e.kind === BONUS ? 1 : e.qty;
    k.points += entryPoints(e, types);
  }
  const feed = s.show.feed
    ? [...counted]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, feedSize)
        .map((e) => ({
          id: e.id,
          memberId: e.member_id,
          name: inRace.get(e.member_id)!.name,
          kind: e.kind,
          label: kindLabel(e.kind, types),
          qty: e.qty,
          points: entryPoints(e, types),
          at: e.created_at,
        }))
    : [];
  const { competitors: _c, ...pub } = s;
  void _c;
  return {
    settings: pub,
    rows: s.show.breakdown ? rows : rows.map((r) => ({ ...r, breakdown: {} })),
    feed,
    functions: functionStandings(rows, s.functionBoard),
    totals: {
      points: rows.reduce((a, r) => a + r.points, 0),
      entries: counted.length,
      troops: rows.length,
      enlisted: rows.filter((r) => r.eligible).length,
      byKind,
    },
    at,
  };
}
