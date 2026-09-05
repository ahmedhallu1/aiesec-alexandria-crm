import "server-only";

import { db } from "@/lib/supabase";
import {
  canFilePdpFor,
  canReadPdp,
  memberIsMm,
  type Viewer,
} from "@/lib/rbac";
import type {
  Member,
  Pdp,
  PdpCycle,
  PdpQuestion,
  PdpSnapshot,
  PdpStep,
  MemberRole,
} from "@/lib/types";
import {
  FUNNEL_STEP_LABEL,
  funnelGap,
  pdpMonthKey,
  pdpWeeks,
  type FunnelCounts,
  type FunnelGap,
  type PdpWeekRange,
} from "@/lib/pdp";
import { monthKeyLabel } from "@/lib/plan";
import { cairoDayIso, cairoWhenLabel, listMembersDirectory } from "./data";
import type { MemberDirectoryEntry } from "./data";

/** THE PDP / O2O MODULE — reads, the shared filing resolver, and the nag pass.
 *
 *  The process this replaces is a Google Sheet: every month a VP or Director
 *  copies a template, one sheet per MM, two tabs in each — an **O2O** tab of
 *  short questions, and a **PDP** tab carrying a personal goal, a professional
 *  goal and last month's numbers with the funnel step that leaked most. The
 *  MMs then do the same for their own members. Migration 0074's header says
 *  why it moved in here; this file is the half that reads it.
 *
 *  ⚠️ EVERY AUTHORITY QUESTION IS ANSWERED IN `src/lib/rbac.ts`, NOT HERE.
 *  `canFilePdpFor` decides who a leader may file for and `canReadPdp` decides
 *  who may read one. This file resolves LISTS and then filters them through
 *  those two predicates — it never invents a rule of its own, which is what
 *  keeps the picker and the save action from disagreeing.
 */

// --------------------------------------------------------------- small helpers

/** The ISO first-of-month key BEFORE `monthIso` — "last month", which is the
 *  window the numbers on a PDP are about. Pure string/UTC arithmetic on a
 *  first-of-month key, so there is no timezone left to get wrong. */
export function prevMonthKey(monthIso: string): string {
  const y = Number(monthIso.slice(0, 4));
  const m0 = Number(monthIso.slice(5, 7)) - 1;
  const d = new Date(Date.UTC(y, m0 - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The last day of the month a first-of-month key names. */
function lastDayOf(monthIso: string): string {
  const y = Number(monthIso.slice(0, 4));
  const m0 = Number(monthIso.slice(5, 7)) - 1;
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  return `${monthIso.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

// -------------------------------------------------------------------- cycles

/** The cycle the LC is currently in: the newest ACTIVE one.
 *
 *  Newest rather than "the one whose month is today", deliberately. TM opens
 *  September's cycle in the first week of September and the filing runs on
 *  into the month; a cycle opened late — or left open a few days past its
 *  month — must not vanish out from under the people still filing into it. */
export async function activePdpCycle(): Promise<PdpCycle | null> {
  const { data, error } = await db()
    .from("pdp_cycles")
    .select("*")
    .eq("active", true)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle<PdpCycle>();
  if (error) {
    console.error("[pdp] cycle query failed:", error.message);
    return null;
  }
  return data ?? null;
}

export async function listPdpCycles(limit = 24): Promise<PdpCycle[]> {
  const { data, error } = await db()
    .from("pdp_cycles")
    .select("*")
    .order("period_start", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[pdp] cycles query failed:", error.message);
    return [];
  }
  return (data ?? []) as PdpCycle[];
}

export async function getPdpCycle(id: string): Promise<PdpCycle | null> {
  const { data } = await db()
    .from("pdp_cycles")
    .select("*")
    .eq("id", id)
    .maybeSingle<PdpCycle>();
  return data ?? null;
}

// ------------------------------------------------------------------ questions

/** THE O2O QUESTIONS TM STARTS FROM.
 *
 *  Seeded, not hard-coded: `pdp_questions` is a table precisely so TM can
 *  rewrite the conversation between peaks without a deploy (migration 0074
 *  says so). These five are only what the table holds on the day it is empty —
 *  the real sheet has not been shared yet, so they are written to be the
 *  questions a leader would ask anyway, and every one of them is editable and
 *  retirable from the PDP page. */
const DEFAULT_QUESTIONS: { prompt: string; hint: string }[] = [
  {
    prompt: "How has this month actually been for you?",
    hint: "Not the numbers — the month. Start here and let them talk.",
  },
  {
    prompt: "What went well that you want to keep doing?",
    hint: "Name it out loud, so it survives into next month on purpose.",
  },
  {
    prompt: "What got in your way?",
    hint: "Time, confidence, a process, another team — whatever it really was.",
  },
  {
    prompt: "What do you need from me, or from the LC?",
    hint: "The half of the conversation the leader has to act on.",
  },
  {
    prompt: "Where do you want to be by the end of the peak?",
    hint: "The answer that makes the personal goal below obvious.",
  },
];

/** Insert the starter questions ONCE, when the table has none.
 *
 *  Idempotent by construction: it counts first and does nothing when anything
 *  at all is there, so a TM crew that deletes four of the five and rewrites
 *  the last one never gets the originals pushed back on top of them. */
export async function ensureDefaultPdpQuestions(): Promise<void> {
  try {
    const { count, error } = await db()
      .from("pdp_questions")
      .select("id", { count: "exact", head: true });
    if (error || (count ?? 0) > 0) return;
    await db().from("pdp_questions").insert(
      DEFAULT_QUESTIONS.map((q, i) => ({
        cycle_id: null, // standing questions: asked every cycle
        idx: i + 1,
        prompt: q.prompt,
        hint: q.hint,
        active: true,
      }))
    );
  } catch (e) {
    // a missing seed is a blank O2O tab, not a broken page
    console.error("[pdp] question seed failed:", e);
  }
}

/** The questions asked in one cycle: the standing set (cycle_id null) plus
 *  anything TM added for this month only. Retired questions are excluded from
 *  the FORM but a PDP that already answered one still renders it (the answers
 *  are keyed by question id — see `pdps.o2o`), which is why the read below
 *  takes an `includeIds` escape hatch. */
export async function pdpQuestions(
  cycleId: string | null,
  opts: { includeInactive?: boolean } = {}
): Promise<PdpQuestion[]> {
  let q = db().from("pdp_questions").select("*");
  q = cycleId ? q.or(`cycle_id.is.null,cycle_id.eq.${cycleId}`) : q.is("cycle_id", null);
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data, error } = await q.order("idx");
  if (error) {
    console.error("[pdp] questions query failed:", error.message);
    return [];
  }
  return (data ?? []) as PdpQuestion[];
}

// ------------------------------------------------------- who a leader files for

export interface PdpTarget {
  id: string;
  name: string;
  role: MemberRole;
  team_name: string | null;
  functions: string[];
  /** a Team Leader or a Coordinator — the cascade's middle layer (v36) */
  isMm: boolean;
  /** how many people report to THEM, so a leader can see the cascade they are
   *  starting: file for this MM, and this MM then owes that many of their own */
  reports: number;
  /** where this person's PDP for the open cycle stands */
  state: "none" | "draft" | "filed";
  pdpId: string | null;
}

export interface PdpFilingTargets {
  /** the cascade proper: the MMs who report to this viewer */
  mms: PdpTarget[];
  /** direct reports who are NOT MMs.
   *
   *  ⚠️ THIS LIST IS USUALLY AN ARTEFACT, AND HIDING IT WOULD BE WORSE THAN
   *  SHOWING IT. `defaultManagerId` (google/sheets.ts) attaches every member
   *  whose Manager cell is blank to their function's VP, so a VP's raw
   *  `teamMemberIds` is not "my MMs" — it is "my MMs, plus everyone nobody
   *  has filed under an MM yet". Those people are still that VP's direct
   *  reports and still owe a conversation; dropping them silently would leave
   *  a member with no PDP and nobody able to file one. So they are separated,
   *  counted apart from the MM count, and labelled. */
  others: PdpTarget[];
  /** TM / the LCP / the break-glass admin: they may file for anyone, to
   *  unstick a cycle when a leader has left mid-month. */
  processOwner: boolean;
}

/** THE ONE RESOLVER — used by the picker AND by the save action.
 *
 *  Modelled on `resolveTouchPointTargets` (server/touch-points.ts), which
 *  exists for exactly this reason: a preview that offers somebody the save
 *  would refuse is a bug the member meets as a shrug, and the only way to make
 *  that impossible is to have one implementation. `savePdp` calls this and
 *  requires its subject to be in the returned set — on top of re-running
 *  `canFilePdpFor`, so neither check can silently become the only one.
 *
 *  ⚠️ `canFilePdpFor` refuses the viewer themselves, whatever their rank. A
 *  self-filed PDP is a to-do list with a formal name.
 */
export async function resolvePdpFilingTargets(
  viewer: Viewer,
  cycleId: string | null
): Promise<PdpFilingTargets> {
  const { data, error } = await db()
    .from("members")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) {
    console.error("[pdp] members query failed:", error.message);
    return { mms: [], others: [], processOwner: false };
  }
  const members = (data ?? []) as Member[];

  // "may I file for this person?" is asked ONCE, by rbac, for every candidate.
  // For an ordinary leader that reduces to the manager link; for TM/LCP/admin
  // it is true of everyone, which is what `processOwner` below reports.
  const allowed = members.filter((m) => canFilePdpFor(viewer, m));
  // a leader who can file for people they do not manage is a process owner;
  // everyone else's list IS their direct reports
  const directs = allowed.filter((m) => m.stakeholder_id === viewer.id);
  const processOwner = allowed.length > directs.length;

  const reportsOf = new Map<string, number>();
  for (const m of members)
    if (m.stakeholder_id)
      reportsOf.set(m.stakeholder_id, (reportsOf.get(m.stakeholder_id) ?? 0) + 1);

  // the state of each candidate's PDP in the open cycle, in ONE query
  const states = new Map<string, { id: string; status: string }>();
  if (cycleId && allowed.length > 0) {
    const { data: rows } = await db()
      .from("pdps")
      .select("id, member_id, status")
      .eq("cycle_id", cycleId)
      .in("member_id", allowed.map((m) => m.id));
    for (const r of (rows ?? []) as { id: string; member_id: string; status: string }[])
      states.set(r.member_id, { id: r.id, status: r.status });
  }

  const toTarget = (m: Member): PdpTarget => {
    const st = states.get(m.id);
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      team_name: m.team_name,
      functions: [...(m.functions ?? [])],
      isMm: memberIsMm(m),
      reports: reportsOf.get(m.id) ?? 0,
      state: st ? (st.status === "filed" ? "filed" : "draft") : "none",
      pdpId: st?.id ?? null,
    };
  };

  // a process owner still sees THEIR OWN cascade first — the whole LC is the
  // fallback for unsticking somebody else's, not their daily list
  const pool = processOwner ? allowed : directs;
  const mms = pool.filter(memberIsMm).map(toTarget);
  const others = pool.filter((m) => !memberIsMm(m)).map(toTarget);
  return { mms, others, processOwner };
}

// ------------------------------------------------------- last month's numbers

/** LAST MONTH'S NUMBERS, READ FROM THE REAL READER.
 *
 *  `listMembersDirectory` is the TM directory's own per-person KPI reader —
 *  the same function, the same date rules, the same window clamping. Writing a
 *  second one here would guarantee that within a peak the PDP and the
 *  directory disagreed about the same member's month, and the leader in the
 *  room would have to guess which was lying.
 *
 *  ⚠️ THE UNIT: contacted / visits / visits done count **ACCOUNTS**, not
 *  events — one account contacted five times is one. That is the directory's
 *  own definition (data.ts says so where it aggregates), and it is
 *  deliberately NOT `buildFunctionReport`'s, which counts EVENTS for the
 *  period email. Both are right for their own question; a PDP is about the
 *  member's own funnel, so accounts — the funnel's own unit — is the honest
 *  one, and `funnelGap` compares like with like because both sides of every
 *  ratio come out of this same read.
 *
 *  ⚠️ THE PRIVILEGED READ. `listMembersDirectory` gates on `hasTmAccess`,
 *  which answers a DIFFERENT question — "may you browse the whole LC's
 *  people?" — and a VP filing for their own MM is not in TM. The authority
 *  question here was already answered by `canFilePdpFor` in the caller, so
 *  this passes a synthetic reader whose only job is to clear that module gate,
 *  and then throws away every row but the ones it was entitled to. It is
 *  narrow on purpose: nothing outside this file ever sees the full list. */
const numbersReader = (v: Viewer): Viewer => ({
  ...v,
  sub_functions: [...new Set([...(v.sub_functions ?? []), "TM"])],
});

/** The whole-LC directory for one month, remembered briefly.
 *
 *  Last month's numbers are HISTORY — the only thing that can still move them
 *  is work logged late — so a few minutes of staleness costs nothing, while
 *  the read itself pages the whole accounts table and every allocation. Module
 *  memory rather than `unstable_cache`, for the v33.46/v33.59 reason:
 *  `revalidatePath("/", "layout")` runs on ~94 write paths and would evict a
 *  Next cache entry continuously, so the cache would exist and never hit. */
const MONTH_CACHE_MS = 5 * 60 * 1000;
let monthCache: { key: string; at: number; rows: MemberDirectoryEntry[] } | null = null;

async function directoryForMonth(
  viewer: Viewer,
  monthIso: string
): Promise<MemberDirectoryEntry[]> {
  if (monthCache && monthCache.key === monthIso && Date.now() - monthCache.at < MONTH_CACHE_MS)
    return monthCache.rows;
  const rows = await listMembersDirectory(numbersReader(viewer), {
    from: monthIso,
    to: lastDayOf(monthIso),
  });
  // a FAILED read is never cached — the directory returns [] both when a
  // member genuinely has no numbers and when the query fell over, and holding
  // the second for five minutes would freeze a whole cycle's PDPs at zero
  if (rows.length > 0) monthCache = { key: monthIso, at: Date.now(), rows };
  return rows;
}

/** The one number a member is actually judged on, and what to call it.
 *  Mirrors the directory's own MOS classification — which is where the class
 *  comes from — so the PDP's "professional" track opens on the metric the
 *  member is already reviewed against instead of asking them to invent one. */
function mosOf(entry: MemberDirectoryEntry): { value: number; label: string } | null {
  switch (entry.mos) {
    case "raising":
      return { value: entry.kpis.slots, label: "Opens" };
    case "bd":
      return { value: Math.round(entry.kpis.egp), label: "EGP signed" };
    case "b2c":
      return { value: entry.kpis.deals, label: "Deals" };
    case "ogx":
      return { value: entry.kpis.signupApprovals, label: "Approvals" };
    case "consideration":
      // v36 (ask #8): a consideration member is judged on what they DID, not
      // on the plan they filed. The live call/partnership numbers belong to
      // the consideration reader; until this track is wired to it the PDP
      // asks the leader for the metric rather than showing a plan and calling
      // it an achievement.
      return null;
    default:
      return null;
  }
}

export interface PdpNumbers {
  /** the month these numbers are about, e.g. "2026-08-01" */
  month: string;
  monthLabel: string;
  snapshot: PdpSnapshot | null;
  /** the function's own rate over the same month — the only honest yardstick */
  gap: FunnelGap | null;
  /** the metric the professional track opens on ("Opens", "Approvals"…) */
  metricLabel: string | null;
  /** why there is no snapshot, when there isn't one */
  note: string | null;
}

/** Build (but do not store) the numbers half of a PDP for one member.
 *
 *  The caller has ALREADY proved it may file for this member. Freezing happens
 *  in `savePdp` — this is what the form shows while the conversation is
 *  happening, and what gets written into `pdps.last_month` when it is filed. */
export async function pdpNumbersFor(
  viewer: Viewer,
  memberId: string,
  cycleMonth: string
): Promise<PdpNumbers> {
  const month = prevMonthKey(cycleMonth);
  const monthLabel = monthKeyLabel(month);
  const rows = await directoryForMonth(viewer, month);
  const mine = rows.find((r) => r.id === memberId) ?? null;

  if (!mine)
    return {
      month,
      monthLabel,
      snapshot: null,
      gap: null,
      metricLabel: null,
      // the directory reviews Members, Coordinators and Team Leaders only —
      // a VP, a Director or one of TM's/CXP's own MMs simply has no row, and
      // saying so is better than showing five zeros
      note: `Sodio has no reviewed numbers for this month — say what you saw instead.`,
    };

  const counts: FunnelCounts = {
    mr: mine.kpis.mr,
    contacted: mine.kpis.contacted,
    visits: mine.kpis.visits,
    visitsDone: mine.kpis.visitsDone,
    deals: mine.kpis.deals,
  };
  const mos = mosOf(mine);
  const snapshot: PdpSnapshot = {
    ...counts,
    ...(mos ? { mos: mos.value, mosLabel: mos.label } : {}),
  };

  // THE BENCHMARK IS THE MEMBER'S OWN FUNCTION, over the same month and out of
  // the same read — so both sides of every ratio are counted the same way.
  // The subject is left IN it: "the function's rate" is the rate the function
  // actually ran at, and pulling one person out of a denominator of dozens
  // would move it by nothing while making the number mean something subtly
  // different from what it says on the card.
  const fns = new Set(mine.functions);
  const bench: FunnelCounts = { mr: 0, contacted: 0, visits: 0, visitsDone: 0, deals: 0 };
  for (const r of rows) {
    if (!r.mosAll.includes("raising")) continue;
    if (!r.functions.some((f) => fns.has(f))) continue;
    bench.mr += r.kpis.mr;
    bench.contacted += r.kpis.contacted;
    bench.visits += r.kpis.visits;
    bench.visitsDone += r.kpis.visitsDone;
    bench.deals += r.kpis.deals;
  }

  // funnelGap() returns null whenever the volume on either side is too thin to
  // support a claim, or the member is at/above their function everywhere. That
  // null is a RESULT, not a miss: the form shows no suggestion and the leader
  // writes what they actually see. Never fabricate one here.
  const gap = mine.mosAll.includes("raising") ? funnelGap(counts, bench) : null;

  return {
    month,
    monthLabel,
    snapshot,
    gap,
    metricLabel: mos?.label ?? null,
    note: null,
  };
}

// --------------------------------------------------------------- reading PDPs

export interface PdpRow extends Pdp {
  member_name: string;
  author_name: string | null;
  steps: PdpStep[];
}

/** The manager link of a set of members, for `canReadPdp`. */
async function managersOf(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return out;
  const { data } = await db()
    .from("members")
    .select("id, name, stakeholder_id")
    .in("id", wanted);
  for (const m of (data ?? []) as { id: string; stakeholder_id: string | null }[])
    out.set(m.id, m.stakeholder_id);
  return out;
}

async function attachSteps(pdps: Pdp[]): Promise<Map<string, PdpStep[]>> {
  const byPdp = new Map<string, PdpStep[]>();
  if (pdps.length === 0) return byPdp;
  const { data } = await db()
    .from("pdp_steps")
    .select("*")
    .in("pdp_id", pdps.map((p) => p.id))
    .order("track")
    .order("week");
  for (const s of (data ?? []) as PdpStep[]) {
    const list = byPdp.get(s.pdp_id) ?? [];
    list.push(s);
    byPdp.set(s.pdp_id, list);
  }
  return byPdp;
}

/** Hydrate raw `pdps` rows into readable ones — names, steps, and the RBAC
 *  filter. Every read in this module funnels through here, so `canReadPdp` is
 *  applied exactly once and cannot be forgotten by a new caller. */
async function hydrate(viewer: Viewer, rows: Pdp[]): Promise<PdpRow[]> {
  if (rows.length === 0) return [];
  const people = await db()
    .from("members")
    .select("id, name, stakeholder_id")
    .in("id", [
      ...new Set([
        ...rows.map((r) => r.member_id),
        ...rows.map((r) => r.author_id).filter((v): v is string => !!v),
      ]),
    ]);
  const byId = new Map(
    ((people.data ?? []) as { id: string; name: string; stakeholder_id: string | null }[]).map(
      (m) => [m.id, m]
    )
  );
  const steps = await attachSteps(rows);
  return rows
    .filter((r) =>
      canReadPdp(
        viewer,
        r.member_id,
        r.author_id ?? "",
        byId.get(r.member_id)?.stakeholder_id ?? null,
        r.author_id ? byId.get(r.author_id)?.stakeholder_id ?? null : null
      )
    )
    .map((r) => ({
      ...r,
      member_name: byId.get(r.member_id)?.name ?? "—",
      author_name: r.author_id ? byId.get(r.author_id)?.name ?? null : null,
      steps: steps.get(r.id) ?? [],
    }));
}

/** One PDP, or null when the viewer may not read it. */
export async function getPdp(viewer: Viewer, id: string): Promise<PdpRow | null> {
  const { data } = await db().from("pdps").select("*").eq("id", id).maybeSingle<Pdp>();
  if (!data) return null;
  const [row] = await hydrate(viewer, [data]);
  return row ?? null;
}

/** The PDP filed FOR this member in one cycle (their own copy). */
export async function myPdp(viewer: Viewer, cycleId: string): Promise<PdpRow | null> {
  const { data } = await db()
    .from("pdps")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("member_id", viewer.id)
    .maybeSingle<Pdp>();
  if (!data) return null;
  const [row] = await hydrate(viewer, [data]);
  return row ?? null;
}

/** Everything ever filed FOR this member, newest cycle first. */
export async function myPdpHistory(viewer: Viewer, limit = 12): Promise<PdpRow[]> {
  const { data } = await db()
    .from("pdps")
    .select("*")
    .eq("member_id", viewer.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return hydrate(viewer, (data ?? []) as Pdp[]);
}

/** What this leader has filed (or half-filed) in one cycle. */
export async function pdpsIAuthored(viewer: Viewer, cycleId: string): Promise<PdpRow[]> {
  const { data } = await db()
    .from("pdps")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("author_id", viewer.id)
    .order("updated_at", { ascending: false });
  return hydrate(viewer, (data ?? []) as Pdp[]);
}

// ---------------------------------------------------------------- compliance

export interface PdpComplianceRow {
  id: string;
  name: string;
  role: MemberRole;
  functions: string[];
  managerName: string | null;
  managerId: string | null;
  state: "none" | "draft" | "filed";
  filedAt: string | null;
}

export interface PdpCompliance {
  rows: PdpComplianceRow[];
  filed: number;
  draft: number;
  missing: number;
}

/** THE LC-WIDE PICTURE — TM's own view, and the reason this left the sheet.
 *
 *  "Who has not had their O2O yet" used to mean reading every tab of a
 *  spreadsheet. It is a query now. Names and states only: `canReadPdp` still
 *  governs opening any individual plan, so TM's leadership can see that a
 *  conversation happened without this list handing anyone its contents.
 *
 *  ⚠️ Gated by the CALLER (`runsPdpProcess`, via `canReadPdp`'s process-owner
 *  branch). Nothing here re-derives that rule. */
export async function pdpCompliance(cycleId: string): Promise<PdpCompliance> {
  const [{ data: memberData }, { data: pdpData }] = await Promise.all([
    db()
      .from("members")
      .select("id, name, role, functions, stakeholder_id")
      .eq("is_active", true)
      .order("name"),
    db().from("pdps").select("member_id, status, filed_at").eq("cycle_id", cycleId),
  ]);
  const members = (memberData ?? []) as {
    id: string;
    name: string;
    role: MemberRole;
    functions: string[] | null;
    stakeholder_id: string | null;
  }[];
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const byMember = new Map(
    ((pdpData ?? []) as { member_id: string; status: string; filed_at: string | null }[]).map(
      (p) => [p.member_id, p]
    )
  );

  // the LCP is not filed FOR: there is nobody above them to hold the
  // conversation, and leaving them on the list would make the LC permanently
  // one short of complete
  const rows = members
    .filter((m) => m.role !== "LCP")
    .map<PdpComplianceRow>((m) => {
      const p = byMember.get(m.id);
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        functions: m.functions ?? [],
        managerId: m.stakeholder_id,
        managerName: m.stakeholder_id ? nameById.get(m.stakeholder_id) ?? null : null,
        state: p ? (p.status === "filed" ? "filed" : "draft") : "none",
        filedAt: p?.filed_at ?? null,
      };
    });

  return {
    rows,
    filed: rows.filter((r) => r.state === "filed").length,
    draft: rows.filter((r) => r.state === "draft").length,
    missing: rows.filter((r) => r.state === "none").length,
  };
}

// ------------------------------------------------------------- the page's data

export interface PdpPageData {
  cycle: PdpCycle | null;
  cycles: PdpCycle[];
  weeks: PdpWeekRange[];
  monthLabel: string;
  deadlineLabel: string | null;
  overdue: boolean;
  questions: PdpQuestion[];
  /** the plan filed FOR me this cycle */
  mine: PdpRow | null;
  myHistory: PdpRow[];
  /** who I owe a conversation, and where each one stands */
  targets: PdpFilingTargets;
  /** what I have filed this cycle */
  authored: PdpRow[];
  /** TM / LCP only */
  compliance: PdpCompliance | null;
  /** may I open a cycle, edit the questions, read the LC-wide list? */
  runsProcess: boolean;
}

/** Everything /pdp renders, in one place — so the page component stays a
 *  gate plus a hand-off and every authority decision is made server-side. */
export async function getPdpPage(viewer: Viewer): Promise<PdpPageData> {
  const runsProcess = canReadPdp(viewer, "", "", null, null);
  if (runsProcess) await ensureDefaultPdpQuestions();

  const [cycle, cycles] = await Promise.all([
    activePdpCycle(),
    runsProcess ? listPdpCycles() : Promise.resolve<PdpCycle[]>([]),
  ]);
  const month = cycle?.period_start ?? pdpMonthKey();

  const [questions, mine, myHistory, targets, authored, compliance] = await Promise.all([
    pdpQuestions(cycle?.id ?? null),
    cycle ? myPdp(viewer, cycle.id) : Promise.resolve(null),
    myPdpHistory(viewer),
    resolvePdpFilingTargets(viewer, cycle?.id ?? null),
    cycle ? pdpsIAuthored(viewer, cycle.id) : Promise.resolve<PdpRow[]>([]),
    cycle && runsProcess ? pdpCompliance(cycle.id) : Promise.resolve(null),
  ]);

  return {
    cycle,
    cycles,
    weeks: pdpWeeks(month),
    monthLabel: monthKeyLabel(month),
    deadlineLabel: cycle ? cairoWhenLabel(cycle.deadline) : null,
    overdue: !!cycle && Date.parse(cycle.deadline) < Date.now(),
    questions,
    mine,
    myHistory,
    targets,
    authored,
    compliance,
    runsProcess,
  };
}

// ------------------------------------------------------------- the nag ladder

/** THE DEADLINE IS A SKIPPABLE NAG, NOT A WALL (ask #3).
 *
 *  ⚠️ AND IT DOES NOT GET ITS OWN CRON. Vercel is at its invocation ceiling
 *  (194% of the Fluid CPU allowance — AI_CONTEXT v33.59), which is why v34.7's
 *  touch-point rating pass rides the existing `touch-point-feedback` job
 *  rather than earning a schedule. This rides `attendance-reminders`, the
 *  nightly job that already exists to chase people about something they owe
 *  TM. The consequence, said out loud: the deadline is a FLOOR, not an alarm —
 *  a leader who misses it at 23:00 hears about it on the next nightly run.
 *
 *  Three nudges, one per Cairo day, and then a `pending_prompts` row — exactly
 *  the ladder attendance uses, because a member who has met one has met both.
 *  The prompt is the LAST rung and it is skippable: `pending_prompts.reminders`
 *  doubles as the skip count the way v34.7 uses it, so it asks, asks once
 *  more tomorrow, and then lets go. A development conversation nagged into
 *  existence is not one worth having.
 *
 *  ⚠️ THE LADDER'S STATE LIVES IN `app_settings`, not on a column. 0074 gave
 *  the cycle no counter, and inventing one would mean a second migration for a
 *  fact that is worth nothing the moment the cycle closes. `app_settings` is
 *  the project's existing key/value store for exactly this class of
 *  bookkeeping (`cron:*`, `sheet:*`, `bookrl:*`).
 */
const NAG_PROMPT_AFTER = 3;
const nagKey = (cycleId: string, memberId: string) => `pdp:nag:${cycleId}:${memberId}`;

interface NagState {
  count: number;
  day: string;
}

async function readNag(key: string): Promise<NagState> {
  const { data } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle<{ value: NagState | null }>();
  const v = data?.value;
  return { count: Number(v?.count) || 0, day: typeof v?.day === "string" ? v.day : "" };
}

async function writeNag(key: string, state: NagState): Promise<void> {
  await db()
    .from("app_settings")
    .upsert({ key, value: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/** The last rung: a prompt on the leader's next app open.
 *
 *  ⚠️ `kind: "pdp"` NEEDS A SELF-HEAL BRANCH IN `openPendingPrompt`
 *  (server/attendance-read.ts). The OLDEST unresolved prompt masks every later
 *  one, so a prompt whose cycle was closed — or whose PDP has since been
 *  filed — would block that member's whole app forever. See this release's
 *  report; the branch is one `if` beside the `attendance` and
 *  `touchpoint_rating` ones. */
async function ensurePdpPrompt(
  memberId: string,
  cycle: PdpCycle,
  owed: number
): Promise<boolean> {
  const { data: existing } = await db()
    .from("pending_prompts")
    .select("id")
    .eq("member_id", memberId)
    .eq("kind", "pdp")
    .eq("ref_id", cycle.id)
    .eq("resolved", false)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (existing) return false;
  const { error } = await db().from("pending_prompts").insert({
    member_id: memberId,
    kind: "pdp",
    ref_id: cycle.id,
    title: `${owed} ${owed === 1 ? "person is" : "people are"} still waiting for their PDP`,
    body: `${monthKeyLabel(cycle.period_start)} · the deadline has passed. Sit down with them, write down what you agreed, and this stops asking. You can skip this — but they'll still be waiting.`,
    link: "/pdp",
  });
  if (error) {
    console.error("[pdp] prompt insert failed:", error.message);
    return false;
  }
  return true;
}

/** Close every open PDP prompt for one leader — called when they file the
 *  last plan they owed, so the ladder stops the moment the work is done
 *  rather than on the next nightly run. */
export async function resolvePdpPrompts(memberId: string, cycleId: string): Promise<void> {
  try {
    await db()
      .from("pending_prompts")
      .update({ resolved: true })
      .eq("member_id", memberId)
      .eq("kind", "pdp")
      .eq("ref_id", cycleId)
      .eq("resolved", false);
  } catch (e) {
    console.error("[pdp] prompt resolve failed:", e);
  }
}

export interface PdpNagResult {
  ok: boolean;
  cycle: string | null;
  nagged: string[];
  prompted: string[];
  errors: string[];
}

/** ONE PASS OF THE LADDER. Called from the existing attendance-reminders cron
 *  (see the ⚠️ above — it must never become a schedule of its own). */
export async function runPdpNags(): Promise<PdpNagResult> {
  const out: PdpNagResult = { ok: true, cycle: null, nagged: [], prompted: [], errors: [] };
  const cycle = await activePdpCycle();
  if (!cycle) return out;
  out.cycle = cycle.period_start;
  // BEFORE the deadline nobody is late, and a reminder sent to someone who is
  // not late is the fastest way to teach a floor to ignore reminders
  if (Date.parse(cycle.deadline) > Date.now()) return out;

  const [{ data: memberData }, { data: pdpData }] = await Promise.all([
    db()
      .from("members")
      .select("id, name, email, fallback_email, role, stakeholder_id")
      .eq("is_active", true),
    db().from("pdps").select("member_id, status").eq("cycle_id", cycle.id),
  ]);
  const members = (memberData ?? []) as {
    id: string;
    name: string;
    email: string | null;
    fallback_email: string | null;
    role: MemberRole;
    stakeholder_id: string | null;
  }[];
  const filedFor = new Set(
    ((pdpData ?? []) as { member_id: string; status: string }[])
      .filter((p) => p.status === "filed")
      .map((p) => p.member_id)
  );

  // WHO OWES WHAT: the manager link, the same link `canFilePdpFor` uses. The
  // LCP is never a subject (nobody is above them to hold the conversation),
  // and a member with no manager on the sheet owes nobody a nag — that is a
  // membership gap for TM to fix, not a person to chase.
  const owed = new Map<string, string[]>();
  for (const m of members) {
    if (m.role === "LCP" || !m.stakeholder_id) continue;
    if (filedFor.has(m.id)) continue;
    const list = owed.get(m.stakeholder_id) ?? [];
    list.push(m.name);
    owed.set(m.stakeholder_id, list);
  }

  const today = cairoDayIso();
  const { notifyMembers } = await import("./notify");
  const { sendEmail } = await import("@/lib/google/gmail");

  for (const [leaderId, names] of owed) {
    const leader = members.find((m) => m.id === leaderId);
    if (!leader) continue;
    try {
      const key = nagKey(cycle.id, leaderId);
      const state = await readNag(key);
      if (state.day === today) continue; // one nudge per Cairo day, whatever else runs

      if (state.count >= NAG_PROMPT_AFTER) {
        // the inbox has had its three goes — the app asks on sight now, and
        // the member may wave it away
        if (await ensurePdpPrompt(leaderId, cycle, names.length))
          out.prompted.push(`${leader.name} → ${names.length}`);
        await writeNag(key, { count: state.count, day: today });
        continue;
      }

      const reminder = state.count + 1;
      const who =
        names.length === 1
          ? names[0]
          : `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`;
      await notifyMembers(
        [leaderId],
        "followup",
        reminder === 1
          ? `🌱 ${names.length} PDP${names.length === 1 ? "" : "s"} still to file`
          : `⏳ Reminder ${reminder}: ${names.length} PDP${names.length === 1 ? "" : "s"} still open`,
        `${monthKeyLabel(cycle.period_start)} · ${who}. Half an hour each, and they know what they're working on.`,
        null,
        "/pdp"
      );

      // the AIESEC address, or the backup Gmail for the fifth of the LC whose
      // @aiesec.net has not landed yet (v33.29) — the bell has already gone
      // out either way, so a member with no inbox at all still hears about it
      const to = leader.email ?? leader.fallback_email;
      if (to) {
        try {
          await sendEmail({ to: [to], ...pdpNagEmail({ leaderName: leader.name, cycle, names, reminder }) });
        } catch (e) {
          out.errors.push(
            `${leader.name}: reminder #${reminder} email failed: ${e instanceof Error ? e.message : e}`
          );
        }
      }
      // stamped AFTER the send, so a Gmail hiccup retries tomorrow instead of
      // burning a rung of the ladder on a message nobody received
      await writeNag(key, { count: reminder, day: today });
      out.nagged.push(`${leader.name} (#${reminder})`);
      if (reminder >= NAG_PROMPT_AFTER && (await ensurePdpPrompt(leaderId, cycle, names.length)))
        out.prompted.push(`${leader.name} → ${names.length}`);
    } catch (e) {
      out.errors.push(`${leader.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------- the email

/** The nag itself. Written to be read by a busy MM at 8am: who is waiting,
 *  how long it takes, one button. It escalates in TONE across the three
 *  rungs and never in threat — the deadline is TM's ask, not a rule with
 *  teeth, and pretending otherwise is how people start deleting the mail. */
function pdpNagEmail(opts: {
  leaderName: string;
  cycle: PdpCycle;
  names: string[];
  reminder: number;
}) {
  const { escapeHtml, emailLayout, button, detailsTable } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@/lib/email/templates") as typeof import("@/lib/email/templates");
  const first = opts.leaderName.split(" ")[0];
  const n = opts.names.length;
  const month = monthKeyLabel(opts.cycle.period_start);
  const lead =
    opts.reminder === 1
      ? `${month}'s PDPs are due, and ${n === 1 ? "one person is" : `${n} people are`} still waiting for theirs.`
      : opts.reminder === 2
        ? `Still ${n === 1 ? "one" : n} to go for ${month}. Half an hour each — that's the whole thing.`
        : `Last nudge from the inbox: ${n === 1 ? "one PDP" : `${n} PDPs`} for ${month} are still open. After this Sodio will ask you inside the app instead — and you can wave that away.`;
  return {
    subject: `🌱 ${n} PDP${n === 1 ? "" : "s"} still to file — ${month}`,
    html: emailLayout({
      preheader: `${n} still waiting · ${month}`,
      body: `
        <h2 style="margin:0 0 12px;font-size:20px;">Hey ${escapeHtml(first)} 👋</h2>
        <p style="margin:0 0 14px;line-height:1.6;">${escapeHtml(lead)}</p>
        ${detailsTable([
          ["Cycle", month],
          ["Waiting", opts.names.join(", ")],
          ["What it is", "Last month's numbers, one personal goal, one professional goal, and four weekly steps for each."],
        ])}
        <p style="margin:0 0 6px;line-height:1.6;">Sodio already has their numbers — you only bring the conversation.</p>
        ${button("Open the PDPs", `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/pdp`)}
      `,
    }),
  };
}

export { FUNNEL_STEP_LABEL };
