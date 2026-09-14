import { describe, expect, it } from "vitest";
import { LANES, seedPlan } from "@/lib/activation/seed";
import { TIMELINE_KINDS, daysBetween, isIsoDate, sectionColumns, type ActivationSection } from "@/lib/activation/model";

/** The merged sheets, fitted to 25 Sep → 5 Dec (v36.7). The ask: "adjust the
 *  same content on this time span … try not to change the content dates as
 *  possible". These pin exactly that. */
const { sections, rows } = seedPlan();
const rowsOf = (id: string) => rows.filter((r) => r.section_id === id);
const timeline = rowsOf("timeline").map((r) => r.data as Record<string, string | boolean>);
const ROAD_START = "2026-09-25";
const DAY0 = "2026-12-02";
const ROAD_END = "2026-12-05";

describe("the road fits 25 September → 5 December", () => {
  it("every item is inside the road, never backwards, on a real lane and kind", () => {
    const lanes = new Set(LANES.map((l) => l.key));
    for (const t of timeline) {
      expect(isIsoDate(t.start), String(t.title)).toBe(true);
      expect(t.start >= ROAD_START && t.end <= ROAD_END, String(t.title)).toBe(true);
      expect(t.start <= t.end, String(t.title)).toBe(true);
      expect(lanes.has(String(t.lane)), String(t.title)).toBe(true);
      expect((TIMELINE_KINDS as readonly string[]).includes(String(t.kind))).toBe(true);
    }
  });

  it("all the preparation is done before Day 0, and the show is 2 – 5 December", () => {
    const prep = timeline.filter((t) => t.kind !== "show" && t.title !== "Decoration Placement");
    expect(prep.every((t) => t.end < DAY0)).toBe(true);
    const show = timeline.filter((t) => t.kind === "show").map((t) => t.start).sort();
    expect(show).toEqual(["2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]);
  });

  it("the first stretch (bid result → 1st OC meeting) keeps its exact dates", () => {
    const early = timeline.filter((t) => {
      const first = String(t.original).split(" → ")[0];
      return isIsoDate(first) && first <= "2026-10-06";
    });
    expect(early.length).toBeGreaterThanOrEqual(8);
    for (const t of early) expect(t.start, String(t.title)).toBe(String(t.original).split(" → ")[0]);
  });

  it("nothing changes ORDER — only the spacing after 6 October is compressed", () => {
    // preparation only: Day 0 – Day 3 (and the decor placed on Day 0, which the
    // sheet itself dated 2 Dec) are the show, not the road
    const withOriginal = timeline
      .filter((t) => t.kind !== "show" && t.title !== "Decoration Placement")
      .filter((t) => isIsoDate(String(t.original).split(" → ")[0]))
      .map((t) => ({ was: String(t.original).split(" → ")[0], now: String(t.start) }))
      .sort((a, b) => a.was.localeCompare(b.was));
    for (let i = 1; i < withOriginal.length; i++)
      expect(withOriginal[i].now >= withOriginal[i - 1].now, JSON.stringify(withOriginal[i])).toBe(true);
  });
});

describe("the nine checkpoints", () => {
  const cps = rowsOf("checkpoints").map((r) => r.data as Record<string, string | boolean>);
  it("are nine, five days apart, all before Day 0", () => {
    expect(cps).toHaveLength(9);
    const dates = cps.map((c) => String(c.date));
    for (let i = 1; i < dates.length; i++) expect(daysBetween(dates[i - 1], dates[i])).toBe(5);
    expect(dates[0]).toBe("2026-10-18");
    expect(dates[8] < DAY0).toBe(true);
  });
  it("keep the Checkpoints tab's deliverables", () => {
    expect(cps[0].dx).toBe("Theme Idea");
    expect(String(cps[0].logistics)).toContain("Venue shortlist");
  });
});

describe("the rest of the sheets", () => {
  it("the OC structure: coach, OCP and five OCVPs with 21 teamsters", () => {
    const roles = rowsOf("structure").map((r) => r.data);
    expect(roles.filter((r) => r.tier === "OCVP")).toHaveLength(5);
    expect(roles.reduce((n, r) => n + (Number(r.teamsters) || 0), 0)).toBe(21);
  });
  it("the casting list and the run of show came across whole", () => {
    expect(rowsOf("casting")).toHaveLength(93);
    const days = new Set(rowsOf("showtime").map((r) => r.data.day));
    expect([...days].sort()).toEqual(["Day 0", "Day 1", "Day 2", "Day 3"]);
  });
  it("every row only uses its section's columns", () => {
    for (const s of sections as ActivationSection[]) {
      if (s.kind === "hero") continue;
      const keys = new Set([...sectionColumns({ ...s, updated_at: "", updated_by_name: null }).map((c) => c.key), "original"]);
      for (const r of rowsOf(s.id))
        for (const k of Object.keys(r.data)) expect(keys.has(k), `${s.id}.${k}`).toBe(true);
    }
  });
  it("row ids are unique uuids, so seeding twice can never duplicate", () => {
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
  });
});
