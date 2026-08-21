import { describe, expect, it } from "vitest";
import { checkVisitTime, visitHour } from "@/lib/visit-time";

describe("when a visit may be booked", () => {
  it("refuses the dead hours, 3:00 to 6:59", () => {
    for (const t of ["03:00", "03:30", "04:15", "05:59", "06:00", "06:59"]) {
      const v = checkVisitTime(t);
      expect(v.ok, `${t} should be refused`).toBe(false);
    }
  });

  it("bounds the block exactly: 02:59 is legal, 03:00 is not, 07:00 is legal again", () => {
    expect(checkVisitTime("02:59").ok).toBe(true);
    expect(checkVisitTime("03:00").ok).toBe(false);
    expect(checkVisitTime("06:59").ok).toBe(false);
    expect(checkVisitTime("07:00").ok).toBe(true);
  });

  it("warns after midnight and before 9, without blocking", () => {
    for (const t of ["00:00", "01:30", "02:59"]) {
      const v = checkVisitTime(t);
      expect(v.ok).toBe(true);
      expect(v.ok && v.warning).toMatch(/after midnight/i);
    }
    for (const t of ["07:00", "08:59"]) {
      const v = checkVisitTime(t);
      expect(v.ok).toBe(true);
      expect(v.ok && v.warning).toMatch(/before 9/i);
    }
  });

  it("says nothing at all about a normal working hour", () => {
    for (const t of ["09:00", "11:30", "14:00", "18:45", "21:00", "23:59"]) {
      expect(checkVisitTime(t)).toEqual({ ok: true, warning: null });
    }
  });

  it("tolerates seconds and single-digit hours", () => {
    expect(visitHour("9:30")).toBe(9);
    expect(visitHour("14:00:00")).toBe(14);
    expect(checkVisitTime("04:00:00").ok).toBe(false);
  });

  it("stays out of the way when the value is not a time — the schema owns that", () => {
    for (const t of ["", null, undefined, "nonsense", "99:99", "12:99"]) {
      expect(checkVisitTime(t)).toEqual({ ok: true, warning: null });
    }
  });
});
