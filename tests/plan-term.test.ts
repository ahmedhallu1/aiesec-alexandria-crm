import { describe, it, expect } from "vitest";
import { currentTermFebYear, termStartIso } from "@/lib/plan";

// The AIESEC term runs Feb → Jan. `currentTermFebYear` anchors the term a
// date belongs to; a January date belongs to the term that started the
// PREVIOUS February (v36.9 — introduced for BD/B2B's term-wide goal, which
// is keyed at this same anchor in plan_cells).
describe("currentTermFebYear", () => {
  it("a February date anchors its own year", () => {
    expect(currentTermFebYear(new Date("2026-02-01T12:00:00+02:00"))).toBe(2026);
  });

  it("a mid-term date (e.g. September, the winter peak) anchors the term's own Feb", () => {
    expect(currentTermFebYear(new Date("2026-09-19T12:00:00+02:00"))).toBe(2026);
  });

  it("December still belongs to the term that started in February the same year", () => {
    expect(currentTermFebYear(new Date("2026-12-15T12:00:00+02:00"))).toBe(2026);
  });

  it("January rolls back to the PREVIOUS February's term", () => {
    expect(currentTermFebYear(new Date("2027-01-10T12:00:00+02:00"))).toBe(2026);
  });

  it("reads the date in Cairo time, not UTC — a late-evening UTC instant that is already the next Cairo day", () => {
    // 2026-01-31 22:30 UTC = 2026-02-01 00:30 Cairo (UTC+2), already February
    expect(currentTermFebYear(new Date("2026-01-31T22:30:00Z"))).toBe(2026);
  });
});

describe("termStartIso", () => {
  it("is always February 1st of the anchor year", () => {
    expect(termStartIso(2026)).toBe("2026-02-01");
    expect(termStartIso(2030)).toBe("2030-02-01");
  });
});
