import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  functionStandings, BONUS, DEFAULT_WAR, buildSnapshot, cairoInstant, entryPoints, inWarWindow, isCompetitor, isIsoDate, publicAvatar,
  resolveWarSettings, rewardFor, standings, warClock, warDateWindow, warDay, warPhase, warSettingsProblem,
  type WarEntry, type WarPerson,
} from "@/lib/war/model";
import { parseNationalStanding } from "@/lib/core-national";

/** THE NO PEACE WAR (v38) — scoring, who competes, the Cairo clock, what the
 *  public page may carry, and CORE's national table. */

const p = (id: string, role: string, fns: string[] = ["IGV"], active = true): WarPerson => ({
  id, name: id.toUpperCase(), role, functions: fns, sub_functions: [], is_active: active, avatar_url: null,
});
let n = 0;
const e = (member_id: string, kind: string, qty = 1, points: number | null = null, at = "2026-10-26T10:00:00Z"): WarEntry => ({
  id: `e${++n}`, member_id, kind, qty, points, note: "secret note", occurred_on: "2026-10-26", created_at: at,
});

describe("who competes", () => {
  const c = DEFAULT_WAR.competitors;
  it("active Members, Coordinators and Team Leaders — not the EB", () => {
    expect(isCompetitor(p("a", "Member"), c)).toBe(true);
    expect(isCompetitor(p("b", "Team Leader"), c)).toBe(true);
    expect(isCompetitor(p("c", "LCVP"), c)).toBe(false);
    expect(isCompetitor(p("d", "Director"), c)).toBe(false);
    expect(isCompetitor(p("e", "Member", ["IGV"], false), c)).toBe(false);
  });
  it("TM Coordinators are out, other Coordinators in", () => {
    expect(isCompetitor(p("f", "Coordinator", ["TM"]), c)).toBe(false);
    expect(isCompetitor(p("g", "Coordinator", ["OGV"]), c)).toBe(true);
    expect(isCompetitor(p("h", "Member", ["TM"]), c)).toBe(true);
  });
  it("named in / out wins, but inactive never competes", () => {
    const c2 = { ...c, include: ["x", "z"], exclude: ["y"] };
    expect(isCompetitor(p("x", "LCVP"), c2)).toBe(true);
    expect(isCompetitor(p("y", "Member"), c2)).toBe(false);
    expect(isCompetitor(p("z", "LCVP", ["IGV"], false), c2)).toBe(false);
  });
});

describe("scoring", () => {
  const types = new Map(DEFAULT_WAR.pointTypes.map((t) => [t.key, t]));
  it("points come from the table, × quantity; a bonus carries its own", () => {
    expect(entryPoints({ kind: "igt_open", qty: 3, points: null }, types)).toBe(45);
    expect(entryPoints({ kind: BONUS, qty: 1, points: -4 }, types)).toBe(-4);
    expect(entryPoints({ kind: "gone", qty: 2, points: null }, types)).toBe(0);
  });

  it("a member's points never roll up to their MM", () => {
    const people = [p("mem", "Member"), p("tl", "Team Leader")];
    const rows = standings(people, [e("mem", "partner")], DEFAULT_WAR);
    expect(rows.find((r) => r.id === "tl")!.points).toBe(0);
    expect(rows.find((r) => r.id === "mem")!.points).toBe(20);
  });

  it("ties share a rank; the 35-point line decides eligibility and rewards", () => {
    const people = ["a", "b", "c", "d"].map((x) => p(x, "Member"));
    const rows = standings(
      people,
      [e("a", "partner", 2), e("b", "partner", 2), e("c", "igt_open", 2), e("d", "sus_10")],
      DEFAULT_WAR
    );
    expect(rows.map((r) => [r.id, r.points, r.rank])).toEqual([
      ["a", 40, 1], ["b", 40, 1], ["c", 30, 3], ["d", 2, 4],
    ]);
    expect(rows.map((r) => r.eligible)).toEqual([true, true, false, false]);
    expect(rewardFor(rows[1], DEFAULT_WAR.rewards)!.title).toBe("Free Activate");
    expect(rewardFor(rows[2], DEFAULT_WAR.rewards)).toBeNull();
  });

  it("changing a point value re-scores what was already logged", () => {
    const s = resolveWarSettings({ pointTypes: DEFAULT_WAR.pointTypes.map((t) => (t.key === "partner" ? { ...t, points: 25 } : t)) });
    expect(standings([p("a", "Member")], [e("a", "partner", 2)], s)[0].points).toBe(50);
  });
});

describe("settings", () => {
  it("a broken stored value falls back to the defaults", () => {
    const s = resolveWarSettings({ minPoints: "lots", startDate: "soon", pointTypes: "x", rewards: [{ title: "" }] });
    expect(s.minPoints).toBe(35);
    expect(s.startDate).toBe("2026-10-25");
    expect(s.pointTypes).toEqual(DEFAULT_WAR.pointTypes);
    expect(s.rewards).toEqual([]);
  });
  it("point-type keys stay unique and never collide with bonus", () => {
    const s = resolveWarSettings({ pointTypes: [{ label: "Bonus", key: "bonus", points: 3 }, { label: "A" }, { label: "A" }] });
    const keys = s.pointTypes.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(BONUS);
  });
  it("a name on both Always in and Always out is only out", () => {
    const s = resolveWarSettings({ competitors: { include: ["x", "y"], exclude: ["y"] } });
    expect(s.competitors.include).toEqual(["x"]);
    expect(s.competitors.exclude).toEqual(["y"]);
  });
});

describe("what Save refuses (the server half of the form's checks)", () => {
  const types = DEFAULT_WAR.pointTypes;
  const rewards = DEFAULT_WAR.rewards;
  it("the current settings pass", () => {
    expect(warSettingsProblem({ pointTypes: types, rewards, startDate: "2026-10-25", endDate: "2026-11-25", minPoints: 35 })).toBeNull();
  });
  it("no blank point-type name or reward title", () => {
    expect(warSettingsProblem({ pointTypes: [...types, { key: "t_x", label: "  ", points: 5, group: "LC", hint: "" }] })).toMatch(/needs a name/);
    expect(warSettingsProblem({ rewards: [...rewards, { rank: 5, place: "5th", title: "", detail: "", emoji: "" }] })).toMatch(/needs a title/);
  });
  it("ranks are whole numbers 1–99, one reward per rank", () => {
    const one = (rank: unknown) => warSettingsProblem({ rewards: [{ ...rewards[0], rank }] });
    expect(one(0)).toMatch(/whole rank/);
    expect(one(1.5)).toMatch(/whole rank/);
    expect(one(100)).toMatch(/whole rank/);
    expect(one("")).toMatch(/whole rank/);
    expect(one(99)).toBeNull();
    expect(warSettingsProblem({ rewards: [rewards[0], { ...rewards[1], rank: 1 }] })).toMatch(/rank 1/);
  });
  it("points to compete is a whole number 0–10000", () => {
    expect(warSettingsProblem({ minPoints: -1 })).toMatch(/Points to compete/);
    expect(warSettingsProblem({ minPoints: 2.5 })).toMatch(/Points to compete/);
    expect(warSettingsProblem({ minPoints: 0 })).toBeNull();
  });
  it("real dates only, and the war can't end before it starts — against the stored end too", () => {
    expect(warSettingsProblem({ startDate: "2026-02-31" })).toMatch(/start date/);
    expect(warSettingsProblem({ startDate: "2026-11-02", endDate: "2026-11-01" })).toMatch(/end before/);
    expect(warSettingsProblem({ startDate: "2026-12-01" }, { endDate: "2026-11-25" })).toMatch(/end before/);
    expect(warSettingsProblem({ startDate: "2026-11-25" }, { endDate: "2026-11-25" })).toBeNull();
  });
});

describe("the war's dates", () => {
  it("isIsoDate refuses dates that don't exist", () => {
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-10-25")).toBe(true);
  });
  it("an entry may sit a week either side of the war, inclusive", () => {
    expect(warDateWindow(DEFAULT_WAR)).toEqual({ min: "2026-10-18", max: "2026-12-02" });
    expect(inWarWindow("2026-10-18", DEFAULT_WAR)).toBe(true);
    expect(inWarWindow("2026-10-17", DEFAULT_WAR)).toBe(false);
    expect(inWarWindow("2026-12-02", DEFAULT_WAR)).toBe(true);
    expect(inWarWindow("2026-12-03", DEFAULT_WAR)).toBe(false);
    expect(inWarWindow("2026-11-31", DEFAULT_WAR)).toBe(false);
  });
});

describe("the Cairo clock", () => {
  it("knows Egypt's summer time (UTC+3 until the last Thursday of October)", () => {
    expect(new Date(cairoInstant("2026-10-25")).toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(new Date(cairoInstant("2026-11-26")).toISOString()).toBe("2026-11-25T22:00:00.000Z");
  });
  it("25 Oct → 25 Nov is 32 days, inclusive", () => {
    const c = warClock(DEFAULT_WAR);
    expect(c.totalDays).toBe(32);
    expect(warPhase(c, Date.parse("2026-10-24T20:59:00Z"))).toBe("before");
    expect(warDay(c, Date.parse("2026-10-25T08:00:00Z"))).toBe(1);
    expect(warPhase(c, Date.parse("2026-11-25T21:59:00Z"))).toBe("live");
    expect(warPhase(c, Date.parse("2026-11-25T22:00:00Z"))).toBe("over");
  });
  it("counts Cairo calendar days — the last hour of a day after the clocks change is still that day", () => {
    const c = warClock(DEFAULT_WAR);
    // summer time ends as 29 Oct turns over, so 21:30Z is 23:30 Cairo (UTC+2) — still day 5,
    // where a count of 24-hour blocks from the 21:00Z start already said 6
    expect(warDay(c, Date.parse("2026-10-29T21:30:00Z"))).toBe(5);
    expect(warDay(c, Date.parse("2026-10-30T21:30:00Z"))).toBe(6);
    expect(warDay(c, Date.parse("2026-11-24T21:30:00Z"))).toBe(31);
    expect(warDay(c, Date.parse("2026-11-25T21:59:00Z"))).toBe(32);
    expect(warDay(c, Date.parse("2026-10-24T20:59:00Z"))).toBe(0);
  });
});

describe("the public snapshot", () => {
  it("carries names and points — never a note, a contact or who logged it", () => {
    const snap = buildSnapshot([p("a", "Member")], [e("a", "partner"), e("a", BONUS, 1, 3)], DEFAULT_WAR);
    const json = JSON.stringify(snap);
    expect(json).not.toContain("secret note");
    expect(json).not.toContain("competitors");
    expect(snap.rows[0].points).toBe(23);
    expect(snap.feed).toHaveLength(2);
  });
  it("only short https avatars go public (a data: URI would bloat every push)", () => {
    expect(publicAvatar("https://api.dicebear.com/9.x/x/svg?seed=a")).toMatch(/^https/);
    expect(publicAvatar(`data:image/png;base64,${"A".repeat(5000)}`)).toBeNull();
    expect(publicAvatar(null)).toBeNull();
  });
  it("`at` is the caller's stamp (taken before the reads), not the build time", () => {
    const snap = buildSnapshot([p("a", "Member")], [], DEFAULT_WAR, 40, "2026-10-26T10:00:00.000Z");
    expect(snap.at).toBe("2026-10-26T10:00:00.000Z");
    expect(Date.parse(buildSnapshot([], [], DEFAULT_WAR).at)).toBeGreaterThan(0);
  });
  it("non-competitors' entries are not on the page", () => {
    const snap = buildSnapshot([p("a", "LCVP")], [e("a", "partner")], DEFAULT_WAR);
    expect(snap.rows).toHaveLength(0);
    expect(snap.feed).toHaveLength(0);
  });
});

describe("CORE national rankings", () => {
  it("reads Alexandria's place per program and stage from the home page", () => {
    const html = readFileSync(join(process.cwd(), "tests/fixtures/core-home.html"), "utf8");
    const s = parseNationalStanding(html)!;
    expect(s.stages.map((x) => x.stage)).toEqual(["approved", "realized", "completed"]);
    const total = s.stages[0].cells.find((c) => c.program === "Total")!;
    expect(total).toMatchObject({ rank: 6, count: 148, listed: 10 });
    expect(total.leader?.lc).toBe("Ain Shams University");
    // not in the top ten → no rank, never a guess
    expect(s.stages[1].cells.find((c) => c.program === "oGTe")!.rank).toBeNull();
  });
  it("no section → null", () => {
    expect(parseNationalStanding("<html>nothing</html>")).toBeNull();
  });
});

describe("the function race", () => {
  const people = [
    p("a", "Member", ["IGV"]), p("b", "Team Leader", ["IGV"]), p("c", "Member", ["IGT", "B2B"]),
    p("d", "Member", ["B2B"]), p("e", "Member", ["BD"]), p("f", "Member", ["CXP"]), p("g", "Member", ["OGV"]),
  ];
  const rows = standings(people, [e("a", "partner"), e("b", "igv_open"), e("c", "igt_open"), e("d", "igv_open", 2), e("e", "pr_deal"), e("f", "partner", 3)], DEFAULT_WAR);
  const fns = functionStandings(rows, DEFAULT_WAR.functionBoard);
  it("sums each person's points under their MAIN function only", () => {
    expect(fns.find((f) => f.fn === "IGV")).toMatchObject({ points: 30, troops: 2, scorers: 2, top: { name: "A", points: 20 } });
    expect(fns.find((f) => f.fn === "IGT")!.points).toBe(15);
    // c's IGT points never count for B2B
    expect(fns.find((f) => f.fn === "B2B")!.points).toBe(20);
  });
  it("B2B and BD race separately; CXP, TM, IM and F&L are out", () => {
    expect(fns.find((f) => f.fn === "BD")!.points).toBe(12);
    expect(fns.some((f) => f.fn === "CXP")).toBe(false);
  });
  it("ranks on total points, ties share, scoreless functions still listed", () => {
    expect(fns.map((f) => [f.fn, f.points, f.rank])).toEqual([
      ["IGV", 30, 1], ["B2B", 20, 2], ["IGT", 15, 3], ["BD", 12, 4], ["OGV", 0, 5],
    ]);
  });
  it("switched off → no board; the snapshot carries it", () => {
    expect(functionStandings(rows, { enabled: false, exclude: [] })).toEqual([]);
    expect(buildSnapshot(people, [e("a", "partner")], DEFAULT_WAR).functions[0]).toMatchObject({ fn: "IGV", points: 20 });
  });
});
