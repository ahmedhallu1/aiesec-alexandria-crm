import { describe, it, expect } from "vitest";
import {
  addRowLane, allTimeWork, didAnything, emptyStats, laneAllocSlots, laneWorkSlots,
  noWork, rowInLane, type LaneRow, type RowWork } from "@/lib/dashboard-funnel";

/**
 * THE DASHBOARD'S FUNNEL — LANES, AND THE DATE EACH KPI IS JUDGED ON.
 *
 * The bug these tests exist for (v33.49): the date filter narrowed the
 * ACCOUNTS by `created_at` and every KPI was then counted off that narrowed
 * set — so "this month" meant "on accounts added this month", and a quarter of
 * the month's real work (contacts, visits and deals on older accounts) was
 * counted as zero in front of the people who had done it.
 *
 * The rule now: MR is the account's own birthday, contacted is the attempt's
 * timestamp, a visit is when it was BOOKED, done is when it was HELD, and
 * deals/opens are when the deal was signed.
 */

const row = (r: Partial<LaneRow> & { function: string }): LaneRow => r;
const work = (w: Partial<RowWork>): RowWork => ({ ...noWork(), ...w });

describe("lanes — which accounts a lane counts", () => {
  it("All ICX holds every raising function but never B2C", () => {
    for (const fn of ["IGV", "IGT", "B2B", "BD"])
      expect(rowInLane(row({ function: fn }), "all")).toBe(true);
    expect(rowInLane(row({ function: "B2C" }), "all")).toBe(false);
  });

  it("IGTa and IGTe are IGT rows split by product", () => {
    const gta = row({ function: "IGT", product: "GTa" });
    expect(rowInLane(gta, "IGTa")).toBe(true);
    expect(rowInLane(gta, "IGTe")).toBe(false);
    expect(rowInLane(gta, "IGT")).toBe(true);
  });

  it("B2B and BD are separate lanes (v32.6)", () => {
    expect(rowInLane(row({ function: "BD" }), "B2B")).toBe(false);
    expect(rowInLane(row({ function: "B2B" }), "BD")).toBe(false);
  });
});

describe("opens follow the DEAL's product split, not the account's function", () => {
  const b2b = row({ function: "B2B" });
  const w = work({ deals: 1, slots: 6, igv: 3, igta: 2, igte: 1 });

  it("a B2B deal feeds each product lane its own opens", () => {
    expect(laneWorkSlots(b2b, w, "IGV")).toBe(3);
    expect(laneWorkSlots(b2b, w, "IGTa")).toBe(2);
    expect(laneWorkSlots(b2b, w, "IGTe")).toBe(1);
    expect(laneWorkSlots(b2b, w, "IGT")).toBe(3);
    expect(laneWorkSlots(b2b, w, "B2B")).toBe(6);
    expect(laneWorkSlots(b2b, w, "all")).toBe(6);
  });

  it("BD opens never land in the B2B lane and vice versa", () => {
    expect(laneWorkSlots(row({ function: "BD" }), w, "B2B")).toBe(0);
    expect(laneWorkSlots(b2b, w, "BD")).toBe(0);
  });

  it("B2C has no opens at all (v23)", () => {
    expect(laneWorkSlots(row({ function: "B2C" }), work({ slots: 4 }), "all")).toBe(0);
  });

  it("a pre-0009 deal with no split falls back to the account's own lane", () => {
    const igv = row({ function: "IGV" });
    const old = work({ deals: 1, slots: 5, split: false });
    expect(laneWorkSlots(igv, old, "IGV")).toBe(5);
    expect(laneWorkSlots(igv, old, "IGTa")).toBe(0);
  });

  it("allocations split the same way, per member", () => {
    const al = { slots_igv: 3, slots_igta: 0, slots_igte: 2 };
    expect(laneAllocSlots(al, "IGV", "B2B")).toBe(3);
    expect(laneAllocSlots(al, "IGTe", "B2B")).toBe(2);
    expect(laneAllocSlots(al, "IGT", "B2B")).toBe(2);
    expect(laneAllocSlots(al, "B2B", "B2B")).toBe(5);
    expect(laneAllocSlots(al, "B2B", "BD")).toBe(0);
  });
});

describe("every KPI is counted on its OWN date", () => {
  const igv = row({ function: "IGV" });

  it("a contact made in the window counts even when the account is older", () => {
    // the exact case the LC reported: name imported in July, called in August
    const s = emptyStats();
    addRowLane(s, igv, work({ mr: false, contacted: true }), "IGV");
    expect(s.contacted).toBe(1);
    expect(s.mr).toBe(0); // …and it is NOT market research done this month
  });

  it("an account added in the window counts as MR before anyone touches it", () => {
    const s = emptyStats();
    addRowLane(s, igv, work({ mr: true }), "IGV");
    expect(s).toMatchObject({ mr: 1, contacted: 0, visitScheduled: 0 });
  });

  it("a visit booked in the window counts now, even if it is held later", () => {
    const s = emptyStats();
    addRowLane(s, igv, work({ visitBooked: true }), "IGV");
    expect(s.visitScheduled).toBe(1);
    expect(s.visitDone).toBe(0);
  });

  it("a visit HELD in the window counts as done even if it was booked before it", () => {
    const s = emptyStats();
    addRowLane(s, igv, work({ visitDone: true }), "IGV");
    expect(s).toMatchObject({ visitScheduled: 0, visitDone: 1 });
  });

  it("a deal signed in the window brings its opens with it", () => {
    const s = emptyStats();
    addRowLane(s, igv, work({ deals: 1, slots: 3, igv: 3 }), "IGV");
    expect(s).toMatchObject({ deals: 1, dealAccounts: 1, slots: 3 });
  });

  it("an account nobody touched in the window contributes nothing anywhere", () => {
    const w = noWork();
    expect(didAnything(w)).toBe(false);
    const s = emptyStats();
    addRowLane(s, igv, w, "IGV");
    expect(s).toEqual(emptyStats());
  });

  it("the state flags follow the accounts ADDED in the window", () => {
    const archived = row({ function: "IGV", out_of_process: true });
    const inside = emptyStats();
    addRowLane(inside, archived, work({ mr: true }), "IGV");
    expect(inside.outOfProcess).toBe(1);
    // worked this month, added long ago: it is not part of this month's intake
    const outside = emptyStats();
    addRowLane(outside, archived, work({ contacted: true }), "IGV");
    expect(outside.outOfProcess).toBe(0);
  });
});

describe("all time — the account's own counters, unchanged", () => {
  it("reads the running counters off the row", () => {
    const w = allTimeWork(
      row({
        function: "IGT", product: "GTa", attempts: 4, visit_id: "v1", visit_done: true,
        deals_count: 2, slots_count: 5, slots_igv_count: 0, slots_igta_count: 5,
        slots_igte_count: 0,
      })
    );
    expect(w).toMatchObject({
      mr: true, contacted: true, visitBooked: true, visitDone: true,
      deals: 2, slots: 5, igta: 5, split: true,
    });
  });

  it("an untouched account is still market research", () => {
    expect(allTimeWork(row({ function: "IGV" }))).toMatchObject({
      mr: true, contacted: false, deals: 0, slots: 0,
    });
  });

  it("no per-product counters (pre-0009) means no split", () => {
    expect(allTimeWork(row({ function: "IGV", slots_count: 3 })).split).toBe(false);
  });
});

describe("B2C is deals-only (v23)", () => {
  it("counts its deals off the account and never any opens", () => {
    const s = emptyStats();
    addRowLane(s, row({ function: "B2C" }), work({ mr: true, deals: 2 }), "B2C");
    expect(s).toMatchObject({ mr: 1, deals: 2, dealAccounts: 1, slots: 0 });
  });
});
