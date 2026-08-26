import { describe, it, expect } from "vitest";
import { digestItemsFor } from "@/lib/cxp/digest";
import type { CxpEpRecord } from "@/lib/cxp/types";

/**
 * THE DAILY DIGEST TESTS.
 *
 * This is the branded replacement for the old system's per-document Google
 * Calendar notifications: it asks the same question those events answered —
 * "does this document's reminder fire today?" — for a whole function at once
 * instead of one silent calendar ping per EP.
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

describe("what fires today", () => {
  it("picks up a document whose reminder is today — flight tickets, 20 days before travel", () => {
    // arrival 2026-09-15 -> due 2026-08-26 -> reminder 2026-08-25
    const records = [rec({ arrival_date: "2026-09-16", start_date: "2026-09-16" })];
    const items = digestItemsFor(records, {}, "IGV", "2026-08-26", NOW);
    expect(items.some((i) => i.requirementKey === "flight_tickets")).toBe(true);
  });

  it("says nothing about a document whose reminder is a different day", () => {
    const records = [rec({ arrival_date: "2026-10-01", start_date: "2026-10-01" })];
    const items = digestItemsFor(records, {}, "IGV", "2026-08-26", NOW);
    expect(items.some((i) => i.requirementKey === "flight_tickets")).toBe(false);
  });

  it("excludes a document already uploaded", () => {
    const records = [rec({ arrival_date: "2026-09-16", start_date: "2026-09-16" })];
    const statusMap = { "111/222|realization|flight_tickets": { uploaded: true } };
    const items = digestItemsFor(records, statusMap, "IGV", "2026-08-26", NOW);
    expect(items.some((i) => i.requirementKey === "flight_tickets")).toBe(false);
  });

  it("excludes past-month rows", () => {
    const records = [
      rec({ arrival_date: "2026-09-16", start_date: "2026-09-16", is_past_month: true }),
    ];
    expect(digestItemsFor(records, {}, "IGV", "2026-08-26", NOW)).toEqual([]);
  });

  it("never mixes in another function's EPs", () => {
    const records = [
      rec({ function: "IGV", arrival_date: "2026-09-16", start_date: "2026-09-16" }),
      rec({
        ep_opp_id: "333/444",
        function: "IGT",
        arrival_date: "2026-09-16",
        start_date: "2026-09-16",
      }),
    ];
    const items = digestItemsFor(records, {}, "IGV", "2026-08-26", NOW);
    expect(items.every((i) => i.function === "IGV")).toBe(true);
  });

  it("the post-approval nudge fires the day AFTER approval, not near the due date", () => {
    // LDA (ICX post-approval): reminder = approval + 1 day, due = approval + 14
    const post = rec({ stage_key: "post_approval", approval_date: "2026-08-25" });
    const items = digestItemsFor([post], {}, "IGV", "2026-08-26", NOW);
    const lda = items.find((i) => i.requirementKey === "lda");
    expect(lda).toBeDefined();
    expect(lda?.dueDate).toBe("2026-09-08");
    expect(lda?.overdue).toBe(false); // due date is two weeks out
  });

  it("touches a document TWICE — the day before its due date, and the day it is due", () => {
    // flight tickets: due = arrival - 20 days, reminder = due - 1 day.
    // arrival 2026-09-15 -> due 2026-08-26 -> reminder 2026-08-25.
    const records = [rec({ arrival_date: "2026-09-15", start_date: "2026-09-15" })];

    const dayBefore = digestItemsFor(records, {}, "IGV", "2026-08-25", NOW);
    const before = dayBefore.find((i) => i.requirementKey === "flight_tickets");
    expect(before).toBeDefined();
    expect(before?.overdue).toBe(false); // the advance nudge, not urgent yet

    const dayOf = digestItemsFor(records, {}, "IGV", "2026-08-26", NOW);
    const of = dayOf.find((i) => i.requirementKey === "flight_tickets");
    expect(of).toBeDefined();
    expect(of?.overdue).toBe(true); // due TODAY — the urgent touch
  });

  it("does NOT resurface a document on the day after it was due — same as the old calendar events never re-firing", () => {
    const records = [rec({ arrival_date: "2026-09-15", start_date: "2026-09-15" })];
    const dayAfter = digestItemsFor(records, {}, "IGV", "2026-08-27", NOW);
    expect(dayAfter.some((i) => i.requirementKey === "flight_tickets")).toBe(false);
  });

  it("returns an empty list when nothing is due", () => {
    const records = [rec()]; // no dates at all -> no computable deadlines
    expect(digestItemsFor(records, {}, "IGV", "2026-08-26", NOW)).toEqual([]);
  });

  it("sorts by EP name then requirement, for a stable email every day", () => {
    const records = [
      rec({ ep_opp_id: "1/1", ep_name: "Zoe", arrival_date: "2026-09-16", start_date: "2026-09-16" }),
      rec({ ep_opp_id: "2/2", ep_name: "Adam", arrival_date: "2026-09-16", start_date: "2026-09-16" }),
    ];
    const items = digestItemsFor(records, {}, "IGV", "2026-08-26", NOW);
    expect(items[0].epName).toBe("Adam");
  });
});
