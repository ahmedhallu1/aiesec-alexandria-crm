import { describe, it, expect } from "vitest";
import {
  PERIOD_HELP,
  PERIOD_KEYS,
  cairoDay,
  isoWeekday,
  peakOfDay,
  resolvePeriod,
  shiftDay,
  sprintOfDay,
  weekOf,
  type PeriodKey,
} from "@/lib/ask-period";

/**
 * THE ASSISTANT'S DATE ARITHMETIC.
 *
 * The Violet Man answered "how many visits did I schedule this week" with
 * numbers that were simply wrong, because his context carried no dates at all
 * and he had to invent one. Everything he now looks up flows through
 * `resolvePeriod`, so this is the file that decides whether those answers are
 * right — which makes it worth pinning hard, including the edges that only
 * happen twice a year.
 */

describe("day arithmetic", () => {
  it("shifts across month and year boundaries", () => {
    expect(shiftDay("2026-08-24", 1)).toBe("2026-08-25");
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29"); // leap year
  });

  it("survives Egypt's DST transitions", () => {
    // Egypt springs forward on the last Friday of April and back in October.
    // A naive midnight-anchored shift lands on a wall clock that doesn't
    // exist; noon-anchored arithmetic doesn't care.
    expect(shiftDay("2026-04-24", 1)).toBe("2026-04-25");
    expect(shiftDay("2026-10-30", 1)).toBe("2026-10-31");
  });

  it("reads Cairo weekdays correctly", () => {
    expect(isoWeekday("2026-08-22")).toBe(6); // Saturday
    expect(isoWeekday("2026-08-23")).toBe(0); // Sunday
    expect(isoWeekday("2026-08-28")).toBe(5); // Friday
  });

  it("gives a Cairo day for an instant that is still 'yesterday' in UTC", () => {
    // 00:30 Cairo on the 24th = 22:30 UTC on the 23rd. The member asking is
    // asking about the 24th; `.toISOString().slice(0,10)` would say the 23rd.
    expect(cairoDay(new Date("2026-08-23T22:30:00Z"))).toBe("2026-08-24");
  });
});

describe("the week starts on Saturday", () => {
  it("puts Saturday at the START of its own week, not the end", () => {
    // 2026-08-22 is a Saturday
    expect(weekOf("2026-08-22")).toEqual({ from: "2026-08-22", to: "2026-08-28" });
  });

  it("groups Sunday–Friday with the Saturday before them", () => {
    for (const day of [
      "2026-08-23", "2026-08-24", "2026-08-25",
      "2026-08-26", "2026-08-27", "2026-08-28",
    ]) {
      expect(weekOf(day).from, day).toBe("2026-08-22");
    }
  });

  it("starts a NEW week on the next Saturday", () => {
    expect(weekOf("2026-08-29").from).toBe("2026-08-29");
  });

  it("every week is exactly 7 days", () => {
    let day = "2026-01-01";
    for (let i = 0; i < 400; i++) {
      const w = weekOf(day);
      expect(shiftDay(w.from, 6)).toBe(w.to);
      expect(isoWeekday(w.from)).toBe(6);
      day = shiftDay(day, 1);
    }
  });
});

describe("sprints are half-months", () => {
  it("splits at the 15th/16th", () => {
    expect(sprintOfDay("2026-08-01")).toMatchObject({ from: "2026-08-01", to: "2026-08-15" });
    expect(sprintOfDay("2026-08-15")).toMatchObject({ from: "2026-08-01", to: "2026-08-15" });
    expect(sprintOfDay("2026-08-16")).toMatchObject({ from: "2026-08-16", to: "2026-08-31" });
    expect(sprintOfDay("2026-08-31")).toMatchObject({ from: "2026-08-16", to: "2026-08-31" });
  });

  it("ends sprint 2 on the real end of a short month", () => {
    expect(sprintOfDay("2026-02-20").to).toBe("2026-02-28");
    expect(sprintOfDay("2028-02-20").to).toBe("2028-02-29");
    expect(sprintOfDay("2026-04-20").to).toBe("2026-04-30");
  });
});

describe("peaks", () => {
  it("runs summer Feb–Jul and winter Aug–Jan", () => {
    expect(peakOfDay("2026-03-10")).toMatchObject({ from: "2026-02-01", to: "2026-07-31" });
    expect(peakOfDay("2026-08-24")).toMatchObject({ from: "2026-08-01", to: "2027-01-31" });
  });

  it("keeps January with the peak that STARTED the previous August", () => {
    // the classic off-by-a-year: January is month 1, but it is the LAST month
    // of the winter peak, not the first of anything
    expect(peakOfDay("2027-01-15")).toMatchObject({ from: "2026-08-01", to: "2027-01-31" });
  });
});

describe("resolvePeriod", () => {
  const TODAY = "2026-08-24"; // a Monday

  it("resolves every named period without throwing", () => {
    for (const key of PERIOD_KEYS) {
      const r = resolvePeriod(key, TODAY);
      expect(r.label, key).toBeTruthy();
    }
  });

  it("describes every named period in the tool schema", () => {
    for (const key of PERIOD_KEYS) {
      if (key === "custom") continue;
      expect(PERIOD_HELP[key as Exclude<PeriodKey, "custom">], key).toBeTruthy();
    }
  });

  it("this week = the Saturday just gone up to today, never into the future", () => {
    const r = resolvePeriod("this_week", TODAY);
    expect(r.from).toBe("2026-08-22");
    expect(r.to).toBe(TODAY);
  });

  it("last week is the whole previous week, both ends", () => {
    expect(resolvePeriod("last_week", TODAY)).toMatchObject({
      from: "2026-08-15",
      to: "2026-08-21",
    });
  });

  it("this month stops at today; last month is whole", () => {
    expect(resolvePeriod("this_month", TODAY)).toMatchObject({ from: "2026-08-01", to: TODAY });
    expect(resolvePeriod("last_month", TODAY)).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("rolls last_month back across the new year", () => {
    expect(resolvePeriod("last_month", "2026-01-09")).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("last_sprint crosses the month boundary from sprint 1", () => {
    // on the 3rd we are in Aug sprint 1, so the previous sprint is July's 2nd
    expect(resolvePeriod("last_sprint", "2026-08-03")).toMatchObject({
      from: "2026-07-16",
      to: "2026-07-31",
    });
    // on the 20th we are in Aug sprint 2 — previous is Aug sprint 1
    expect(resolvePeriod("last_sprint", "2026-08-20")).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-15",
    });
  });

  it("all_time really is unbounded", () => {
    expect(resolvePeriod("all_time", TODAY)).toMatchObject({ from: null, to: null });
  });

  it("NEVER lets a named period reach into the future", () => {
    for (const key of PERIOD_KEYS) {
      const r = resolvePeriod(key, TODAY);
      if (r.to) expect(r.to <= TODAY, `${key} ended at ${r.to}`).toBe(true);
      if (r.from && r.to) expect(r.from <= r.to, key).toBe(true);
    }
  });

  it("clamps and orders a custom window", () => {
    // backwards
    expect(resolvePeriod("custom", TODAY, { from: "2026-08-20", to: "2026-08-10" }))
      .toMatchObject({ from: "2026-08-10", to: "2026-08-20" });
    // into the future
    expect(resolvePeriod("custom", TODAY, { from: "2026-08-01", to: "2027-01-01" }))
      .toMatchObject({ from: "2026-08-01", to: TODAY });
  });

  it("falls back to the month when 'custom' carries no usable dates", () => {
    // the failure that matters: an unbounded window answering an all-time
    // number under a "this period" label
    for (const bad of [
      undefined,
      { from: null, to: null },
      { from: "not-a-date", to: "" },
    ]) {
      const r = resolvePeriod("custom", TODAY, bad ?? undefined);
      expect(r.from, JSON.stringify(bad)).toBe("2026-08-01");
      expect(r.to).toBe(TODAY);
    }
  });

  it("labels every window with the dates it actually used", () => {
    // the answer has to be able to state its own window — an unlabelled
    // number is how "this week" quietly became "all time"
    for (const key of PERIOD_KEYS) {
      const r = resolvePeriod(key, TODAY);
      if (r.from) expect(r.label, key).toContain(r.from);
    }
  });
});
