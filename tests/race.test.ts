import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_RACE, buildRaceSnapshot, pace, parseCoreApproved, raceClock, raceSettingsProblem, resolveRaceSettings,
  rivalDeskOpen, sumPrograms,
  type RaceDeal, type RaceEntry, type RaceReading,
} from "@/lib/race/model";
import { DEFAULT_ACTIVATE, buildActivate, resolveWarSettings, warSettingsProblem, type WarPerson } from "@/lib/war/model";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** ALEX vs MUST (v38.5) — the CORE parser, the race's arithmetic, and the
 *  Activate half of the No Peace settings. */

// MUST's real "approved 26/27" panel on 2026-11-04 (whitespace squeezed)
const CORE_PANEL = `<h3 class="panel-title">Approvals vs Goal 26/27</h3><h5 class="mb-5">IGV</h5><div class="fs-36 fw-600 mb-20 counter">157</div>
<h3 class="panel-title">approved 26/27</h3> </div> <div class="panel-body"> <div class="pull-left"> <h5 class="m-0 text-uppercase">iGV</h5> <div class="fs-18 fw-600">22</div> </div>
<div class="pull-left"> <h5 class="m-0 text-uppercase">iGTa</h5> <div class="fs-18 fw-600">11</div> </div> <div class="pull-left"> <h5 class="m-0 text-uppercase">iGTe</h5> <div class="fs-18 fw-600">0</div> </div>
<div class="pull-left"> <h5 class="m-0 text-uppercase">oGV</h5> <div class="fs-18 fw-600">162</div> </div> <div class="pull-left"> <h5 class="m-0 text-uppercase">oGTa</h5> <div class="fs-18 fw-600">19</div> </div>
<div class="pull-left"> <h5 class="m-0 text-uppercase">oGTe</h5> <div class="fs-18 fw-600">1</div> </div> <h5 class="m-0 text-uppercase">Total</h5> <div class="fs-22 fw-600">215</div>
</div></div></div> <div class="panel-heading"> <h3 class="panel-title">realized 26/27</h3> <h5 class="m-0 text-uppercase">iGV</h5> <div class="fs-18 fw-600">14</div>`;

describe("CORE parser", () => {
  it("reads the approved panel — not the goals panel above it, not realized below", () => {
    const r = parseCoreApproved(CORE_PANEL);
    expect(r).toEqual({ total: 215, programs: { iGV: 22, iGTa: 11, iGTe: 0, oGV: 162, oGTa: 19, oGTe: 1 } });
  });
  it("null when the panel isn't there", () => {
    expect(parseCoreApproved("<html>maintenance</html>")).toBeNull();
  });
  it("the default start counts are the numbers the LC gave (Alexandria 161, MUST 215)", () => {
    expect(sumPrograms(DEFAULT_RACE.home.baseline)).toBe(161);
    expect(sumPrograms(DEFAULT_RACE.rival.baseline)).toBe(215);
  });
});

const s = resolveRaceSettings({ rivalToken: "x".repeat(32) });
const c = raceClock(s);
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;
const reading = (id: string, side: "home" | "rival", total: number, at: number): RaceReading => ({
  id, side, total, programs: {}, source: "core", at: iso(at),
});

describe("the race", () => {
  it("approvals = latest reading minus the start count; the first reading past the goal is when they got there", () => {
    const snap = buildRaceSnapshot({
      settings: s,
      readings: [
        reading("1", "home", 200, c.start + 2 * H),
        reading("2", "rival", 300, c.start + 3 * H),
        reading("3", "home", 311, c.start + 5 * H), // 161 + 150
        reading("4", "rival", 370, c.start + 6 * H), // 215 + 155
      ],
      entries: [],
      deals: [],
      now: c.start + 7 * H,
    });
    expect(snap.approvals.home.value).toBe(150);
    expect(snap.approvals.rival.value).toBe(155);
    expect(snap.approvals.home.reachedAt).toBe(iso(c.start + 5 * H));
    // MUST is further ahead, but Alexandria got there FIRST
    expect(snap.approvals.leader).toBe("rival");
    expect(snap.approvals.winner).toBe("home");
  });

  it("nothing after the deadline counts", () => {
    const snap = buildRaceSnapshot({
      settings: s,
      readings: [reading("1", "home", 170, c.deadline - H), reading("2", "home", 400, c.deadline + H)],
      entries: [],
      deals: [],
      now: c.deadline + 2 * H,
    });
    expect(snap.approvals.home.value).toBe(9);
    expect(snap.approvals.winner).toBeNull();
  });

  it("slots: Sodio deals for Alexandria, entries for MUST; test-window rules apply", () => {
    const deals: RaceDeal[] = [
      { id: "d1", created_at: iso(c.start + H), igv: 2, igta: 0, igte: 1 },
      { id: "d0", created_at: iso(c.start - H), igv: 9, igta: 0, igte: 0 }, // before the start
    ];
    const entries: RaceEntry[] = [
      { id: "e1", side: "rival", qty: 4, occurred_on: s.startDate, created_at: iso(c.start + 2 * H) },
      { id: "e2", side: "rival", qty: 7, occurred_on: "2026-10-01", created_at: iso(c.start + 2 * H) }, // dated before
    ];
    const snap = buildRaceSnapshot({ settings: s, readings: [], entries, deals, now: c.start + 3 * H });
    expect(snap.slots.home.value).toBe(3);
    expect(snap.slots.rival.value).toBe(4);
    expect(snap.slots.leader).toBe("rival");
    const deal = snap.feed.find((f) => f.id === "d-d1");
    expect(deal?.detail).toBe("IGV 2 · IGTe 1");
  });

  it("the public snapshot never carries MUST's link", () => {
    const snap = buildRaceSnapshot({ settings: s, readings: [], entries: [], deals: [] });
    expect(JSON.stringify(snap)).not.toContain("x".repeat(32));
    expect("rivalToken" in snap.settings).toBe(false);
  });

  it("a fall on CORE shows as a correction in the feed", () => {
    const snap = buildRaceSnapshot({
      settings: s,
      readings: [reading("1", "rival", 220, c.start + H), reading("2", "rival", 218, c.start + 2 * H)],
      entries: [],
      deals: [],
      now: c.start + 3 * H,
    });
    expect(snap.feed.map((f) => f.delta)).toEqual([-2, 5]);
    expect(snap.approvals.rival.value).toBe(3);
  });

  it("pace and what's needed per day", () => {
    const p = pace({ value: 10, goal: 150, reachedAt: null }, c, c.start + 2 * 86_400_000);
    expect(p.perDay).toBeCloseTo(5);
    expect(p.needPerDay).toBeGreaterThan(5);
  });

  it("settings: refuses what it would otherwise silently fix", () => {
    expect(raceSettingsProblem({ approvalsGoal: 0 })).toMatch(/approvals goal/);
    expect(raceSettingsProblem({ deadlineDate: "2026-02-31" })).toMatch(/deadline/);
    expect(raceSettingsProblem({ startDate: "2026-12-10", deadlineDate: "2026-12-02" })).toMatch(/before the start/);
    expect(raceSettingsProblem({ home: { name: "Alexandria", color: "blue" } })).toMatch(/colour/);
    expect(raceSettingsProblem({ approvalsGoal: 150, slotsGoal: 100 })).toBeNull();
    expect(resolveRaceSettings({ home: { color: "nope" } }).home.color).toBe(DEFAULT_RACE.home.color);
  });

  it("MUST's desk closes a day after the deadline, or when paused", () => {
    expect(rivalDeskOpen(s, c.deadline + 23 * H)).toBe(true);
    expect(rivalDeskOpen(s, c.deadline + 25 * H)).toBe(false);
    expect(rivalDeskOpen({ ...s, rivalCanLog: false }, c.start)).toBe(false);
  });
});

describe("the desk and the editor are guarded", () => {
  const src = read("src/server/race-actions.ts");
  it("every no-login action checks the token and is throttled", () => {
    expect(src).toMatch(/async function desk\(token: string\)[\s\S]*rivalTokenOk\(token\)[\s\S]*underHourlyLimit\("racerl"/);
    for (const fn of ["logRivalSlots", "removeRivalEntry"])
      expect(src).toMatch(new RegExp(`export async function ${fn}\\(token: string[\\s\\S]*?await desk\\(token\\)`));
  });
  it("MUST can only take back its own link entries", () => {
    expect(src).toMatch(/removeRivalEntry[\s\S]*\.eq\("side", "rival"\)[\s\S]*\.eq\("source", "link"\)/);
  });
  it("the token is compared in constant time", () => {
    expect(read("src/server/race.ts")).toMatch(/timingSafeEqual/);
  });
  it("the editor is not under the public prefix", () => {
    const matcher = read("src/proxy.ts").match(/"\/\(\(\?!([^"]+)"/)?.[1] ?? "";
    expect(matcher).toMatch(/\|alex-vs-must\|/);
    expect(matcher).not.toMatch(/lc-race/);
  });
});

describe("Activate on the No Peace board", () => {
  it("defaults are the COD's announcement", () => {
    const w = resolveWarSettings({});
    expect(w.activate.apdGoal).toBe(150);
    expect(w.activate.formUrl).toBe("https://forms.gle/YPQEnkmDRqnXrj3F6");
    expect(w.activate.payNumber).toBe("01555571812");
    expect(w.activate.deadline).toBe("2026-12-05");
  });
  it("a form link that isn't https is refused, and never stored", () => {
    expect(warSettingsProblem({ activate: { ...DEFAULT_ACTIVATE, formUrl: "javascript:alert(1)" } })).toMatch(/https/);
    expect(resolveWarSettings({ activate: { formUrl: "http://x.y" } }).activate.formUrl).toBe("");
    expect(warSettingsProblem({ activate: { ...DEFAULT_ACTIVATE } })).toBeNull();
  });
  it("the bus fills in the order people were ticked", () => {
    const p = (id: string, name: string): WarPerson => ({ id, name, role: "Member", functions: ["IGV"], sub_functions: [], is_active: true });
    const act = buildActivate(
      [p("a", "Aya"), p("b", "Bassel")],
      [
        { member_id: "b", marked_at: "2026-11-05T10:00:00Z" },
        { member_id: "a", marked_at: "2026-11-05T11:00:00Z" },
        { member_id: "gone", marked_at: "2026-11-05T09:00:00Z" },
      ],
      DEFAULT_ACTIVATE,
      { value: 12, readAt: "2026-11-05T12:00:00Z" }
    );
    expect(act.delegates.map((d) => d.name)).toEqual(["Bassel", "Aya"]);
    expect(act.apd).toEqual({ value: 12, goal: 150, readAt: "2026-11-05T12:00:00Z" });
  });
});
