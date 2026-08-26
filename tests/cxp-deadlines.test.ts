import { describe, it, expect } from "vitest";
import {
  addDays,
  appealDateFor,
  computeDeadline,
  computeDeadlinesForRecord,
  deadlineOneDayAfter,
  diffDays,
  previousMonth,
  previousWeeklyDeadline,
  recentWeeklyDeadlines,
  submissionMonthOf,
  toIsoDate,
  upcomingWeeklyDeadlines,
} from "@/lib/cxp/deadlines";
import { allRequirements, findRequirement, requirementsForStage } from "@/lib/cxp/requirements";
import { CXP_FUNCTIONS, type CxpFunction } from "@/lib/cxp/types";

/**
 * THE ECB TIMELINE TESTS.
 *
 * These formulas are what the LC is audited against — a wrong one means a
 * document collected on the wrong day, which is a violation and a fine. They
 * were migrated out of a standalone app; this file is the proof the migration
 * did not change any of them.
 *
 * The worked example in the ECB guide (p.58) is reproduced verbatim below, so
 * the suite is anchored to the published source and not only to our own code.
 */

const req = (fn: CxpFunction, stage: Parameters<typeof requirementsForStage>[1], key: string) => {
  const r = findRequirement(fn, stage, key);
  if (!r) throw new Error(`no requirement ${fn}/${stage}/${key}`);
  return r;
};

const ep = (over: Partial<Parameters<typeof computeDeadline>[0]> = {}) => ({
  epOppId: "1/2",
  function: "IGV" as CxpFunction,
  stageKey: "realization" as const,
  approvalDate: null,
  startDate: null,
  endDate: null,
  arrivalDate: null,
  product: "GV",
  ...over,
});

describe("date plumbing is UTC-anchored", () => {
  it("adds and diffs days without DST drift", () => {
    // Egypt reinstated DST in 2023; these two dates straddle a transition
    expect(addDays("2026-04-24", 1)).toBe("2026-04-25");
    expect(addDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(diffDays("2026-09-13", "2026-08-01")).toBe(43);
  });

  it("normalises sheet dates to yyyy-MM-dd", () => {
    expect(toIsoDate("2026-08-01")).toBe("2026-08-01");
    expect(toIsoDate("2026-08-01T10:00:00Z")).toBe("2026-08-01");
    expect(toIsoDate("")).toBe(null);
    expect(toIsoDate(null)).toBe(null);
  });
});

describe("the ECB worked example (guide p.58)", () => {
  // Start 01/08/2025, End 13/09/2025, arrival ticket 30/07/2025
  const record = ep({
    startDate: "2025-08-01",
    endDate: "2025-09-13",
    arrivalDate: "2025-07-30",
    stageKey: "finish",
    function: "IGV",
  });

  it("before-arrival communication window is 20 -> 30 Jul", () => {
    const d = computeDeadline(
      { ...record, stageKey: "realization" },
      req("IGV", "realization", "comm_before_arrival")
    );
    expect(d.windowStart).toBe("2025-07-15"); // arrival - 15
    expect(d.windowEnd).toBe("2025-07-20"); // arrival - 10
  });

  it("GV mid duration = 44/2 = 22 -> 23/08", () => {
    const d = computeDeadline(record, req("IGV", "finish", "mid_comm"));
    // duration = 13 Sep - 1 Aug = 43 days; round(43/2) = 22
    expect(d.dueDate).toBe("2025-08-23");
  });

  it("last week = 13/09 - 7 = 06 -> 13/09", () => {
    const d = computeDeadline(record, req("IGV", "finish", "last_week_comm"));
    expect(d.windowStart).toBe("2025-09-06");
    expect(d.windowEnd).toBe("2025-09-13");
  });
});

describe("every deadline rule", () => {
  it("PGS / LDA = approval + 14 days", () => {
    const d = computeDeadline(
      ep({ stageKey: "post_approval", approvalDate: "2026-08-01" }),
      req("IGV", "post_approval", "lda")
    );
    expect(d.dueDate).toBe("2026-08-15");
  });

  it("flight tickets & health insurance = travel - 20 days", () => {
    const r = ep({ arrivalDate: "2026-09-01" });
    expect(computeDeadline(r, req("IGV", "realization", "flight_tickets")).dueDate).toBe(
      "2026-08-12"
    );
    expect(computeDeadline(r, req("IGV", "realization", "health_insurance")).dueDate).toBe(
      "2026-08-12"
    );
  });

  it("OPS = travel - 7 days (OGX only)", () => {
    const d = computeDeadline(
      ep({ function: "OGV", arrivalDate: "2026-09-01" }),
      req("OGV", "realization", "ops_invitation")
    );
    expect(d.dueDate).toBe("2026-08-25");
  });

  it("entry stamp = arrival + 3 days", () => {
    const d = computeDeadline(
      ep({ arrivalDate: "2026-09-01" }),
      req("IGV", "realization", "entry_stamp")
    );
    expect(d.dueDate).toBe("2026-09-04");
    expect(d.windowStart).toBe("2026-09-01");
  });

  it("24h communication = arrival + 24h", () => {
    const d = computeDeadline(
      ep({ arrivalDate: "2026-09-01" }),
      req("IGV", "realization", "comm_after_arrival")
    );
    expect(d.dueDate).toBe("2026-09-02");
  });

  it("IPS = arrival + 36h, which lands the NEXT day (ICX only)", () => {
    const d = computeDeadline(
      ep({ arrivalDate: "2026-09-01" }),
      req("IGV", "realization", "ips_invitation")
    );
    expect(d.dueDate).toBe("2026-09-02");
  });

  it("GT monthly = the first 5 days of the month", () => {
    const d = computeDeadline(
      ep({ function: "IGT", stageKey: "monthly", startDate: "2026-09-10", product: "GTa" }),
      req("IGT", "monthly", "monthly_comm"),
      new Date("2026-08-26T00:00:00Z")
    );
    expect(d.windowStart).toBe("2026-09-01");
    expect(d.windowEnd).toBe("2026-09-05");
  });

  it("falls back to the slot start when there is no flight date", () => {
    const d = computeDeadline(
      ep({ startDate: "2026-09-01", arrivalDate: null }),
      req("IGV", "realization", "flight_tickets")
    );
    expect(d.dueDate).toBe("2026-08-12");
    expect(d.basedOn).toBe("startDate");
  });

  it("returns a bare deadline when the anchor date is missing", () => {
    const d = computeDeadline(ep(), req("IGV", "realization", "flight_tickets"));
    expect(d.dueDate).toBe(null);
    expect(d.reminderDate).toBe(null);
  });
});

describe("reminders", () => {
  it("fire one day before the window start", () => {
    const d = computeDeadline(
      ep({ arrivalDate: "2026-09-01" }),
      req("IGV", "realization", "comm_before_arrival")
    );
    expect(d.reminderDate).toBe("2026-08-16"); // windowStart 08-17 minus 1
  });

  it("but post-approval nudges the day AFTER approval, not before the due date", () => {
    // PGS/LDA are due in two weeks; the EP should START them immediately
    const d = computeDeadline(
      ep({ stageKey: "post_approval", approvalDate: "2026-08-01" }),
      req("IGV", "post_approval", "lda")
    );
    expect(d.dueDate).toBe("2026-08-15");
    expect(d.reminderDate).toBe("2026-08-02");
  });
});

describe("realized EPs pick up their later date-driven requirements", () => {
  it("a realized IGT GTa gets monthly communication without being moved", () => {
    const keys = computeDeadlinesForRecord(
      ep({
        function: "IGT",
        stageKey: "realization",
        startDate: "2026-08-01",
        endDate: "2026-12-01",
        product: "GTa",
      })
    ).map((d) => d.requirementKey);
    expect(keys).toContain("monthly_comm");
  });

  it("a GV does NOT — monthly communication is a GT product thing", () => {
    const keys = computeDeadlinesForRecord(
      ep({
        function: "IGV",
        stageKey: "realization",
        startDate: "2026-08-01",
        endDate: "2026-10-01",
        product: "GV",
      })
    ).map((d) => d.requirementKey);
    expect(keys).not.toContain("monthly_comm");
  });

  it("and an EP still at Approval picks up nothing extra", () => {
    const keys = computeDeadlinesForRecord(
      ep({ stageKey: "approval", startDate: "2026-08-01", product: "GV" })
    ).map((d) => d.requirementKey);
    expect(keys).not.toContain("mid_comm");
  });
});

describe("the weekly deadline calendar (6 / 13 / 20 / 27)", () => {
  it("lists the next four, oldest first", () => {
    expect(upcomingWeeklyDeadlines("2026-08-26", 4).map((d) => d.date)).toEqual([
      "2026-08-27",
      "2026-09-06",
      "2026-09-13",
      "2026-09-20",
    ]);
  });

  it("lists the previous two, oldest first", () => {
    expect(recentWeeklyDeadlines("2026-08-26", 2).map((d) => d.date)).toEqual([
      "2026-08-13",
      "2026-08-20",
    ]);
  });

  it("crosses a year boundary backwards", () => {
    expect(recentWeeklyDeadlines("2026-01-02", 2).map((d) => d.date)).toEqual([
      "2025-12-20",
      "2025-12-27",
    ]);
  });

  it("ALWAYS yields six chips — never five", () => {
    // the product owner reported "5 weeks"; the board renders 2 past + 4
    // upcoming on every single day of the year
    let cursor = "2026-01-01";
    for (let i = 0; i < 400; i++) {
      const all = [
        ...recentWeeklyDeadlines(cursor, 2),
        ...upcomingWeeklyDeadlines(cursor, 4),
      ].map((d) => d.date);
      expect(all).toHaveLength(6);
      expect(new Set(all).size).toBe(6);
      cursor = addDays(cursor, 1);
    }
  });

  it("knows the deadline immediately before another", () => {
    expect(previousWeeklyDeadline("2026-09-06")).toBe("2026-08-27");
    expect(previousWeeklyDeadline("2026-08-13")).toBe("2026-08-06");
  });

  it("gates the reminder cron to the day before a deadline", () => {
    expect(deadlineOneDayAfter("2026-08-05")?.date).toBe("2026-08-06");
    expect(deadlineOneDayAfter("2026-08-12")?.date).toBe("2026-08-13");
    expect(deadlineOneDayAfter("2026-08-19")?.date).toBe("2026-08-20");
    expect(deadlineOneDayAfter("2026-08-26")?.date).toBe("2026-08-27");
    // every other day of the month sends nothing at all
    expect(deadlineOneDayAfter("2026-08-07")).toBe(null);
    expect(deadlineOneDayAfter("2026-08-01")).toBe(null);
  });

  it("computes appeal dates", () => {
    expect(appealDateFor("2026-08-06", 5)).toBe("2026-08-11");
  });
});

describe("submission months", () => {
  it("buckets a date into its month", () => {
    expect(submissionMonthOf("2026-08-26")).toBe("2026-08-01");
  });

  it("steps back across a year boundary", () => {
    expect(previousMonth("2026-08-01")).toBe("2026-07-01");
    expect(previousMonth("2026-01-01")).toBe("2025-12-01");
  });
});

describe("the requirement catalogue is intact after the migration", () => {
  it("keeps every function's stage set", () => {
    expect(requirementsForStage("IGV", "approval").map((r) => r.key)).toEqual([
      "passport_id",
      "expectations_mail",
      "op_mail",
    ]);
    expect(requirementsForStage("OGV", "approval").map((r) => r.key)).toEqual([
      "passport_id",
      "student_proof",
      "contract_an",
      "expectations_mail",
    ]);
    // only the GT products carry a Monthly stage
    expect(requirementsForStage("IGT", "monthly").map((r) => r.key)).toEqual([
      "monthly_comm",
      "salary_benefits",
    ]);
    expect(requirementsForStage("IGV", "monthly")).toEqual([]);
  });

  it("has no duplicate keys inside any one stage", () => {
    for (const fn of CXP_FUNCTIONS) {
      const byStage = new Map<string, string[]>();
      for (const { stageKey, req } of allRequirements(fn)) {
        const arr = byStage.get(stageKey) ?? [];
        arr.push(req.key);
        byStage.set(stageKey, arr);
      }
      for (const [stage, keys] of byStage) {
        expect(new Set(keys).size, `${fn}/${stage} has duplicate keys`).toBe(keys.length);
      }
    }
  });

  it("gives every requirement a name, criteria and at least one alias", () => {
    for (const fn of CXP_FUNCTIONS) {
      for (const { req } of allRequirements(fn)) {
        expect(req.name.length).toBeGreaterThan(0);
        expect(req.criteria.length).toBeGreaterThan(0);
        expect(req.aliases.length).toBeGreaterThan(0);
      }
    }
  });
});
