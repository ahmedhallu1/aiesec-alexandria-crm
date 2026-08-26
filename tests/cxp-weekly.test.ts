import { describe, it, expect } from "vitest";
import {
  bucketFor,
  isUploaded,
  selectWeeklyEps,
  summarize,
  weeklyItemsFor,
} from "@/lib/cxp/weekly";
import type { CxpEpRecord } from "@/lib/cxp/types";

/**
 * THE WEEK-SELECTOR TESTS.
 *
 * THE BUG THESE EXIST FOR: in the old app the week chips were decorative.
 * `selectWeeklyEPs(records, fn)` took no deadline, the page took no
 * searchParams, and so every week rendered identical numbers and every week's
 * ZIP held an identical file set. There was no filter to fix — the per-week
 * filter had never been written.
 *
 * The old code had NO tests for weekly selection at all, which is exactly why
 * the bug survived: the only tested layer (date arithmetic) was the one that
 * worked. The central assertion here is the one nobody wrote — that TWO
 * DIFFERENT DEADLINES PRODUCE TWO DIFFERENT ANSWERS.
 */

const NOW = new Date("2026-08-26T00:00:00Z");

const rec = (over: Partial<CxpEpRecord> = {}): CxpEpRecord =>
  ({
    id: "r1",
    ep_name: "Test EP",
    ep_opp_id: "111/222",
    product: "GV",
    function: "IGV",
    side: "ICX",
    stage_key: "realization",
    status: "realized",
    approval_date: null,
    start_date: null,
    end_date: null,
    arrival_date: null,
    departure_date: null,
    host_lc: null,
    home_lc: null,
    opportunity_name: null,
    ecb_comment: null,
    submitted_flag: null,
    audited_flag: null,
    excused_flag: null,
    submission_month: "2026-08-01",
    is_past_month: false,
    sheet_flags: {},
    source_sheet_name: "ICX Submissions",
    source_section_name: "Realization",
    source_row_number: 2,
    confidence_score: 1,
    parsing_warnings: [],
    needs_review: false,
    synced_at: NOW.toISOString(),
    ...over,
  }) as CxpEpRecord;

describe("bucketing a due date against a weekly deadline", () => {
  // the deadline 2026-08-20; the one before it is 2026-08-13
  it("is 'current' when due inside (previous, this]", () => {
    expect(bucketFor("2026-08-20", "2026-08-20")).toBe("current");
    expect(bucketFor("2026-08-14", "2026-08-20")).toBe("current");
  });

  it("is 'overdue' when due on or before the previous deadline", () => {
    expect(bucketFor("2026-08-13", "2026-08-20")).toBe("overdue");
    expect(bucketFor("2026-07-01", "2026-08-20")).toBe("overdue");
  });

  it("is 'upcoming' when due after this deadline — NOT part of this week", () => {
    expect(bucketFor("2026-08-21", "2026-08-20")).toBe("upcoming");
  });

  it("is 'ongoing' when the requirement has no deadline at all", () => {
    // a passport is owed continuously and must never hide behind a week
    expect(bucketFor(null, "2026-08-20")).toBe("ongoing");
  });
});

describe("THE FIX: different weeks give different answers", () => {
  // flight tickets are due travel - 20 days. With arrival 2026-09-02 that is
  // 2026-08-13 — so the ticket is 'current' in the week ending 13 Aug and
  // 'overdue' in every week after it.
  const records = [rec({ arrival_date: "2026-09-02", start_date: "2026-09-02" })];

  it("selects the requirement in the week it falls due", () => {
    const items = weeklyItemsFor(records, {}, "IGV", "2026-08-13", NOW);
    const flight = items.find((i) => i.requirementKey === "flight_tickets");
    expect(flight?.bucket).toBe("current");
    expect(flight?.dueDate).toBe("2026-08-13");
  });

  it("carries it as overdue in the following week", () => {
    const items = weeklyItemsFor(records, {}, "IGV", "2026-08-20", NOW);
    expect(items.find((i) => i.requirementKey === "flight_tickets")?.bucket).toBe("overdue");
  });

  it("EXCLUDES it from an earlier week — it is not owed yet", () => {
    const items = weeklyItemsFor(records, {}, "IGV", "2026-08-06", NOW);
    expect(items.find((i) => i.requirementKey === "flight_tickets")).toBeUndefined();
  });

  it("so two adjacent weeks are genuinely NOT the same list", () => {
    const a = weeklyItemsFor(records, {}, "IGV", "2026-08-06", NOW);
    const b = weeklyItemsFor(records, {}, "IGV", "2026-08-13", NOW);
    expect(a.length).not.toBe(b.length);
  });

  it("and the SUMMARY numbers move with the week", () => {
    const early = summarize(records, {}, "IGV", "2026-08-06", NOW);
    const due = summarize(records, {}, "IGV", "2026-08-13", NOW);
    const later = summarize(records, {}, "IGV", "2026-08-20", NOW);
    expect(due.currentCount).toBeGreaterThan(early.currentCount);
    expect(later.overdueCount).toBeGreaterThan(due.overdueCount);
  });
});

describe("what counts as submitted", () => {
  it("an explicit upload satisfies the requirement", () => {
    const r = rec();
    const statusMap = { "111/222|realization|passport": { uploaded: true } };
    expect(isUploaded(r, "passport", statusMap)).toBe(true);
    const items = weeklyItemsFor([r], statusMap, "IGV", "2026-08-20", NOW);
    expect(items.find((i) => i.requirementKey === "passport")).toBeUndefined();
  });

  it("the sheet's own flag satisfies it when there is no upload", () => {
    const r = rec({ sheet_flags: { passport: true } });
    expect(isUploaded(r, "passport", {})).toBe(true);
  });

  it("an explicit NOT-uploaded status overrides the sheet flag", () => {
    // the upload record is the more recent truth
    const r = rec({ sheet_flags: { passport: true } });
    expect(isUploaded(r, "passport", { "111/222|realization|passport": { uploaded: false } })).toBe(
      false
    );
  });
});

describe("scoping", () => {
  it("never mixes another function's EPs in", () => {
    const records = [rec({ function: "IGV" }), rec({ ep_opp_id: "333/444", function: "IGT" })];
    const items = weeklyItemsFor(records, {}, "IGV", "2026-08-20", NOW);
    expect(items.every((i) => i.function === "IGV")).toBe(true);
    expect(items.every((i) => i.epOppId === "111/222")).toBe(true);
  });

  it("excludes past-month rows — they live behind the EP list's toggle", () => {
    const records = [rec({ is_past_month: true })];
    expect(weeklyItemsFor(records, {}, "IGV", "2026-08-20", NOW)).toEqual([]);
  });
});

describe("the EP roll-up", () => {
  const records = [
    rec({ ep_opp_id: "111/222", ep_name: "Zoe", stage_key: "approval" }),
    rec({ ep_opp_id: "111/222", ep_name: "Zoe", stage_key: "realization" }),
    rec({ ep_opp_id: "333/444", ep_name: "Adam", stage_key: "approval" }),
  ];

  it("groups an EP's stage rows under one entry, sorted by name", () => {
    const eps = selectWeeklyEps(records, {}, "IGV", "2026-08-20", NOW);
    expect(eps.map((e) => e.epName)).toEqual(["Adam", "Zoe"]);
  });

  it("represents an EP by its MOST ADVANCED stage", () => {
    const zoe = selectWeeklyEps(records, {}, "IGV", "2026-08-20", NOW).find(
      (e) => e.epName === "Zoe"
    );
    expect(zoe?.stageKey).toBe("realization");
  });

  it("counts EPs and missing docs over the SAME selection", () => {
    // the old app computed these two over different record sets, so every
    // card overstated "docs missing" against its own EP count
    const eps = selectWeeklyEps(records, {}, "IGV", "2026-08-20", NOW);
    const s = summarize(records, {}, "IGV", "2026-08-20", NOW);
    expect(s.epCount).toBe(eps.length);
    expect(s.missingCount).toBe(eps.reduce((n, e) => n + e.missingCount, 0));
  });

  it("drops an EP that owes nothing that week", () => {
    // satisfy every approval requirement for Adam
    const statusMap: Record<string, { uploaded: boolean }> = {};
    for (const key of ["passport_id", "expectations_mail", "op_mail"]) {
      statusMap[`333/444|approval|${key}`] = { uploaded: true };
    }
    const eps = selectWeeklyEps(records, statusMap, "IGV", "2026-08-20", NOW);
    expect(eps.map((e) => e.epName)).toEqual(["Zoe"]);
  });
});
