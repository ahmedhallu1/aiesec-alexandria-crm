import { describe, it, expect } from "vitest";
import {
  FUNNEL_STEPS, FUNNEL_STEP_LABEL, PDP_MIN_GAP_POINTS, PDP_MIN_VOLUME, PDP_WEEKS,
  funnelGap, isFunnelStep, pdpMonthKey, pdpWeekOf, pdpWeeks,
  type FunnelCounts,
} from "../src/lib/pdp";
import { sprintOf } from "../src/lib/plan";

/** THE PDP HELPERS (v36).
 *
 *  Two things are pinned here, and they are the two things that would do real
 *  damage if they drifted:
 *   ① a PDP week is NOT a sprint — the day it becomes one, every member's
 *     four agreed checkpoints silently become two;
 *   ② `funnelGap` says nothing when it doesn't know. A leader quoting an
 *     invented weakness in a development conversation is worse than a leader
 *     with no auto-filled gap at all, so the low-volume path is tested as
 *     hard as the happy one.
 */

describe("the month's four weeks", () => {
  it("gives 7/7/7/7 in a plain February", () => {
    // 2026 is not a leap year — 28 days divide exactly
    const w = pdpWeeks("2026-02-01");
    expect(w.map((x) => [x.start, x.end])).toEqual([
      ["2026-02-01", "2026-02-07"],
      ["2026-02-08", "2026-02-14"],
      ["2026-02-15", "2026-02-21"],
      ["2026-02-22", "2026-02-28"],
    ]);
  });

  it("gives 7/7/7/8 in a leap February", () => {
    const w = pdpWeeks("2024-02-01");
    expect(w[3].start).toBe("2024-02-22");
    expect(w[3].end).toBe("2024-02-29");
  });

  it("gives 7/7/7/9 in a 30-day month", () => {
    const w = pdpWeeks("2026-09-01");
    expect(w[3].end).toBe("2026-09-30");
  });

  it("gives 7/7/7/10 in a 31-day month — the last week absorbs the remainder", () => {
    const w = pdpWeeks("2026-08-01");
    expect(w.map((x) => x.start)).toEqual([
      "2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22",
    ]);
    expect(w[3].end).toBe("2026-08-31");
  });

  it("covers every month of a decade with no gap, no overlap and no overrun", () => {
    for (let y = 2020; y <= 2030; y++)
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, "0")}-01`;
        const w = pdpWeeks(key);
        expect(w).toHaveLength(4);
        expect(w[0].start).toBe(key);
        // contiguous: each week starts the day after the previous one ended
        for (let i = 1; i < w.length; i++) {
          const prevEnd = new Date(`${w[i - 1].end}T12:00:00Z`);
          prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
          expect(w[i].start).toBe(prevEnd.toISOString().slice(0, 10));
        }
        // the last day is the last day of the month, whatever length it is
        const eom = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        expect(w[3].end).toBe(eom);
        // and no week is empty or backwards
        for (const x of w) expect(x.start <= x.end).toBe(true);
      }
  });

  it("is DELIBERATELY not a sprint — the sprint boundary falls inside week 3", () => {
    // plan.ts models exactly two sprints a month (1–15, 16–EOM). If a later
    // reader "aligns" these, four agreed checkpoints become two. The proof
    // that they are different periods: no PDP week ends on the 15th and none
    // starts on the 16th, so sprint 2's first day lands mid-week-3.
    const august = pdpWeeks("2026-08-01");
    expect(august.some((w) => w.end === "2026-08-15")).toBe(false);
    expect(august.some((w) => w.start === "2026-08-16")).toBe(false);
    const sprint = sprintOf(new Date("2026-08-20T09:00:00Z"));
    expect(sprint.start).toBe("2026-08-16");
    expect(pdpWeekOf("2026-08-01", sprint.start)).toBe(3);
  });

  it("takes a month key or any day inside the month", () => {
    expect(pdpWeeks("2026-09")).toEqual(pdpWeeks("2026-09-01"));
    expect(pdpWeeks("2026-09-23")).toEqual(pdpWeeks("2026-09-01"));
  });

  it("throws on anything that isn't a month, rather than rendering nothing", () => {
    for (const bad of ["", "2026", "2026-13-01", "September", "26-09-01"])
      expect(() => pdpWeeks(bad)).toThrow(/not a month/);
  });

  it("labels the week the way a member reads it", () => {
    expect(pdpWeeks("2026-09-01")[0].label).toBe("Week 1 · 1–7 Sep");
    expect(pdpWeeks("2026-08-01")[3].label).toBe("Week 4 · 22–31 Aug");
    expect(PDP_WEEKS).toEqual([1, 2, 3, 4]);
  });
});

describe("which week a day falls in", () => {
  it("finds the week, and refuses a day outside the month", () => {
    expect(pdpWeekOf("2026-09-01", "2026-09-01")).toBe(1);
    expect(pdpWeekOf("2026-09-01", "2026-09-07")).toBe(1);
    expect(pdpWeekOf("2026-09-01", "2026-09-08")).toBe(2);
    expect(pdpWeekOf("2026-09-01", "2026-09-30")).toBe(4);
    expect(pdpWeekOf("2026-09-01", "2026-10-01")).toBeNull();
    expect(pdpWeekOf("2026-09-01", "2026-08-31")).toBeNull();
  });

  it("accepts a full timestamp and reads its day", () => {
    expect(pdpWeekOf("2026-09-01", "2026-09-16T21:00:00.000Z")).toBe(3);
  });
});

describe("the month key is Cairo, not UTC", () => {
  it("files a cycle opened just after Cairo midnight under the new month", () => {
    // 22:00 UTC on 31 Aug is already 1 September in Cairo (UTC+2 or +3)
    expect(pdpMonthKey(new Date("2026-08-31T22:00:00Z"))).toBe("2026-09-01");
    // and the same instant read as UTC would have said August
    expect(new Date("2026-08-31T22:00:00Z").toISOString().slice(0, 7)).toBe("2026-08");
  });

  it("stays in the month for an ordinary daytime instant", () => {
    expect(pdpMonthKey(new Date("2026-09-15T09:00:00Z"))).toBe("2026-09-01");
    expect(pdpMonthKey(new Date("2026-09-30T21:00:00Z"))).toBe("2026-10-01");
  });
});

/* ------------------------------------------------------------------ */

const counts = (c: Partial<FunnelCounts>): FunnelCounts =>
  ({ mr: 0, contacted: 0, visits: 0, visitsDone: 0, deals: 0, ...c });

describe("the weakest funnel step", () => {
  it("names the transition furthest below the function", () => {
    const mine = counts({ mr: 100, contacted: 80, visits: 8, visitsDone: 6, deals: 3 });
    const bench = counts({ mr: 1000, contacted: 850, visits: 340, visitsDone: 272, deals: 122 });
    // contacted 80/100 = 80% vs 85% → 5 points behind
    // visits     8/80  = 10% vs 40% → 30 points behind  ← the weakest
    // visitsDone 6/8   = 75% vs 80% → 5 points behind
    // deals      3/6   = 50% vs ~45% → ahead
    const gap = funnelGap(mine, bench);
    expect(gap).not.toBeNull();
    expect(gap!.step).toBe("visits");
    expect(gap!.mine).toBe(10);
    expect(gap!.benchmark).toBe(40);
  });

  it("writes a note carrying the raw counts as well as both rates", () => {
    const gap = funnelGap(
      counts({ mr: 100, contacted: 80, visits: 8, visitsDone: 6, deals: 3 }),
      counts({ mr: 1000, contacted: 850, visits: 340, visitsDone: 272, deals: 122 }),
    )!;
    // a leader has to be able to check the claim without opening the dashboard
    expect(gap.note).toBe(
      "You booked a visit on 8 of the 80 accounts you contacted — 10%. The function books 40%.",
    );
    // and it must read like a person wrote it: no jargon, no metric names
    expect(gap.note).not.toMatch(/conversion|delta|funnel|KPI/i);
  });
});

describe("it says nothing when it does not know", () => {
  it("REFUSES to invent a gap from three accounts", () => {
    // the whole reason this function can return null. 1 of 3 contacted is
    // "33%" and it means nothing at all.
    const gap = funnelGap(
      counts({ mr: 3, contacted: 1 }),
      counts({ mr: 1000, contacted: 800 }),
    );
    expect(gap).toBeNull();
  });

  it("refuses right up to the volume floor, and answers one above it", () => {
    const bench = counts({ mr: 1000, contacted: 800 }); // 80%
    const thin = counts({ mr: PDP_MIN_VOLUME - 1, contacted: 1 });
    const enough = counts({ mr: PDP_MIN_VOLUME, contacted: 1 });
    expect(funnelGap(thin, bench)).toBeNull();
    expect(funnelGap(enough, bench)?.step).toBe("contacted");
  });

  it("refuses when the BENCHMARK is thin too — two guesses are not a finding", () => {
    const mine = counts({ mr: 100, contacted: 20 });
    const bench = counts({ mr: 5, contacted: 4 });
    expect(funnelGap(mine, bench)).toBeNull();
  });

  it("honours a caller's own minVolume", () => {
    const mine = counts({ mr: 12, contacted: 2 });
    const bench = counts({ mr: 1000, contacted: 800 });
    expect(funnelGap(mine, bench, 20)).toBeNull();
    expect(funnelGap(mine, bench, 5)?.step).toBe("contacted");
  });

  it("returns null when the member is at or above the function everywhere", () => {
    const mine = counts({ mr: 100, contacted: 90, visits: 45, visitsDone: 40, deals: 20 });
    const bench = counts({ mr: 1000, contacted: 800, visits: 320, visitsDone: 256, deals: 100 });
    expect(funnelGap(mine, bench)).toBeNull();
  });

  it("treats a couple of points as the noise it is", () => {
    // 60% vs 62% is one phone call at this volume, not a month's development plan
    const mine = counts({ mr: 100, contacted: 60, visits: 30, visitsDone: 20, deals: 10 });
    const bench = counts({ mr: 1000, contacted: 620, visits: 300, visitsDone: 190, deals: 90 });
    expect(funnelGap(mine, bench)).toBeNull();
    expect(PDP_MIN_GAP_POINTS).toBeGreaterThan(2);
  });

  it("survives empty, negative and non-numeric counts without inventing anything", () => {
    const empty = counts({});
    expect(funnelGap(empty, empty)).toBeNull();
    const junk = { mr: -5, contacted: NaN, visits: null, visitsDone: undefined, deals: "3" };
    expect(funnelGap(junk as unknown as FunnelCounts, counts({ mr: 100, contacted: 80 }))).toBeNull();
  });
});

describe("conversions are capped at 100%", () => {
  it("never reports a rate above 100, on either side", () => {
    // deals count DEALS while "visits held" counts ACCOUNTS, and one account
    // can close several — so 200% is real data, not bad data, and the house
    // has capped it everywhere since v22.
    const mine = counts({ mr: 100, contacted: 100, visits: 100, visitsDone: 100, deals: 10 });
    const bench = counts({ mr: 100, contacted: 100, visits: 100, visitsDone: 100, deals: 200 });
    const gap = funnelGap(mine, bench)!;
    expect(gap.step).toBe("deals");
    expect(gap.benchmark).toBe(100);
    expect(gap.mine).toBe(10);
  });

  it("a member outperforming their function is never a gap", () => {
    const mine = counts({ mr: 20, contacted: 20, visits: 20, visitsDone: 20, deals: 40 });
    const bench = counts({ mr: 100, contacted: 100, visits: 100, visitsDone: 100, deals: 60 });
    expect(funnelGap(mine, bench)).toBeNull();
  });
});

describe("the step vocabulary", () => {
  it("names the WORK at each step, not the metric", () => {
    for (const s of FUNNEL_STEPS) expect(FUNNEL_STEP_LABEL[s]).toBeTruthy();
    expect(FUNNEL_STEP_LABEL.deals).toBe("Closing deals");
  });

  it("guards pdps.gap_step, which is free text arriving from a form", () => {
    expect(isFunnelStep("visitsDone")).toBe(true);
    for (const bad of ["", "visits_done", "DROP TABLE", null, 4, undefined])
      expect(isFunnelStep(bad)).toBe(false);
  });
});
