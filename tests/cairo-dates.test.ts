import { describe, expect, it } from "vitest";
import { fmtDateTime, fmtDay, fmtTime, cairoToday } from "@/lib/types";

/** THE MIDNIGHT-TO-3AM BUG (v33.45).
 *
 *  Egypt is UTC+2, UTC+3 under DST. Every timestamp in the CRM is stored as
 *  timestamptz (UTC) and every human reading it is on Cairo wall-clock, so
 *  the two disagree about which DAY it is for the first 2–3 hours after Cairo
 *  midnight. Two habits kept reintroducing that gap:
 *
 *    iso.slice(0, 10)                      → the UTC day off the raw string
 *    new Date().toISOString().slice(0,10)  → UTC "today"
 *
 *  Both are correct-looking and both are wrong in exactly the same window,
 *  which is why the CRM was dating late-night work to the previous day. These
 *  tests pin the Cairo answer so the shortcut can't come back unnoticed. */

// 2026-08-12T22:00:00Z is 2026-08-13 01:00 in Cairo (DST, UTC+3).
const AFTER_CAIRO_MIDNIGHT = "2026-08-12T22:00:00Z";
// 2026-01-12T22:00:00Z is 2026-01-13 00:00 in Cairo (no DST, UTC+2).
const WINTER_MIDNIGHT = "2026-01-12T22:00:00Z";

describe("fmtDay — the Cairo calendar day of an instant", () => {
  it("reports the Cairo day, not the UTC day, just after midnight", () => {
    expect(fmtDay(AFTER_CAIRO_MIDNIGHT)).toBe("2026-08-13");
  });

  it("is exactly the case the naive .slice(0, 10) gets wrong", () => {
    // documents the bug this helper exists to prevent
    expect(AFTER_CAIRO_MIDNIGHT.slice(0, 10)).toBe("2026-08-12");
    expect(fmtDay(AFTER_CAIRO_MIDNIGHT)).not.toBe(AFTER_CAIRO_MIDNIGHT.slice(0, 10));
  });

  it("handles the winter offset (UTC+2) too", () => {
    expect(fmtDay(WINTER_MIDNIGHT)).toBe("2026-01-13");
  });

  it("agrees with the UTC day during the rest of the day", () => {
    expect(fmtDay("2026-08-13T09:00:00Z")).toBe("2026-08-13");
  });

  it("survives null and unparseable input without throwing", () => {
    expect(fmtDay(null)).toBe("—");
    expect(fmtDay(undefined)).toBe("—");
    expect(fmtDay("not a date")).toBe("not a date");
  });
});

describe("fmtDateTime / fmtTime — pinned to Cairo, not the runtime clock", () => {
  it("renders the Cairo wall-clock regardless of where it runs", () => {
    // Vercel's runtime is UTC; the browser is Cairo. Both must print this.
    expect(fmtDateTime(AFTER_CAIRO_MIDNIGHT)).toBe("Aug 13, 2026, 1:00 AM");
  });

  it("puts the time on the same day fmtDay reports", () => {
    // the stacked date-over-time cells in the accounts table must not
    // contradict each other
    expect(fmtDay(AFTER_CAIRO_MIDNIGHT)).toBe("2026-08-13");
    expect(fmtTime(AFTER_CAIRO_MIDNIGHT)).toBe("1:00 AM");
  });

  it("still renders an afternoon instant correctly", () => {
    // yomicepa's real last-edit stamp: 14:41 UTC is 17:41 Cairo, same day
    expect(fmtDateTime("2026-08-12T14:41:26Z")).toBe("Aug 12, 2026, 5:41 PM");
  });
});

describe("cairoToday", () => {
  it("returns a well-formed YYYY-MM-DD", () => {
    expect(cairoToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches fmtDay of the current instant", () => {
    expect(cairoToday()).toBe(fmtDay(new Date().toISOString()));
  });
});
