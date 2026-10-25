import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  BONUS, DEFAULT_WAR, buildSnapshot, cairoInstant, entryPoints, isCompetitor, publicAvatar, resolveWarSettings,
  rewardFor, standings, warClock, warDay, warPhase, type WarEntry, type WarPerson,
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
