import { describe, it, expect } from "vitest";
import {
  COUNTRY_ZONES, countryForZone, isValidZone, whenLabelInZone, zoneCity,
  zoneForCountry, zoneOffsetLabel,
} from "../src/lib/timezones";
import { COUNTRIES } from "../src/lib/countries";

/** The IR side of a booking (v33.22). A wrong time zone here does not throw —
 *  it quietly tells someone abroad the wrong hour, which is how the bug that
 *  prompted this got missed for a month. */

describe("every country the app offers can be turned into a zone", () => {
  it("COUNTRIES ⊆ COUNTRY_ZONES", () => {
    const missing = COUNTRIES.filter((c) => !COUNTRY_ZONES[c]);
    expect(missing).toEqual([]);
  });

  it("and every zone in the table is one the runtime actually knows", () => {
    const bad = Object.values(COUNTRY_ZONES).flat().filter((z) => !isValidZone(z));
    expect(bad).toEqual([]);
  });
});

describe("isValidZone refuses anything it cannot format with", () => {
  it("takes real zones", () => {
    expect(isValidZone("Africa/Cairo")).toBe(true);
    expect(isValidZone("Asia/Kolkata")).toBe(true);
    expect(isValidZone("UTC")).toBe(true);
  });
  it("rejects junk, injection attempts and empties", () => {
    for (const bad of [
      null, undefined, "", "   ", "Mars/Olympus", "'; drop table ir_calls;--",
      "<script>", "Africa/Cairo; rm -rf /", "a".repeat(200),
    ])
      expect(isValidZone(bad as string)).toBe(false);
  });
});

describe("country ⇄ zone", () => {
  it("resolves the countries our partner LCs actually come from", () => {
    expect(zoneForCountry("Turkey")).toBe("Europe/Istanbul");
    expect(zoneForCountry("India")).toBe("Asia/Kolkata");
    expect(zoneForCountry("Indonesia")).toBe("Asia/Jakarta");
    expect(zoneForCountry("Algeria")).toBe("Africa/Algiers");
    expect(zoneForCountry("Pakistan")).toBe("Asia/Karachi");
    expect(zoneForCountry("Azerbaijan")).toBe("Asia/Baku");
  });
  it("is case-insensitive and survives stray spacing", () => {
    expect(zoneForCountry("  turkey ")).toBe("Europe/Istanbul");
  });
  it("returns null rather than guessing", () => {
    expect(zoneForCountry("Wakanda")).toBeNull();
    expect(zoneForCountry("")).toBeNull();
    expect(zoneForCountry(null)).toBeNull();
  });
  it("maps a browser's zone back to a country for the booking form", () => {
    expect(countryForZone("Europe/Istanbul")).toBe("Turkey");
    expect(countryForZone("Asia/Jakarta")).toBe("Indonesia");
    // legacy aliases some platforms still hand out
    expect(countryForZone("Asia/Calcutta")).toBe("India");
    expect(countryForZone("Europe/Kiev")).toBe("Ukraine");
    // unknown → no prefill, never a wrong one
    expect(countryForZone("Mars/Olympus")).toBeNull();
  });
});

describe("the label an IR reads", () => {
  // 2026-08-08T21:00:00Z — Cairo midnight, and the day BEFORE in Algiers.
  const iso = "2026-08-08T21:00:00.000Z";

  it("names the same instant in each reader's own clock", () => {
    expect(whenLabelInZone(iso, "Africa/Cairo")).toContain("12:00 AM");
    expect(whenLabelInZone(iso, "Africa/Cairo")).toContain("Sun, Aug 9");
    // the whole point: same moment, different DAY
    expect(whenLabelInZone(iso, "Africa/Algiers")).toContain("Sat, Aug 8");
    expect(whenLabelInZone(iso, "Africa/Algiers")).toContain("10:00 PM");
    expect(whenLabelInZone(iso, "Asia/Kolkata")).toContain("2:30 AM");
  });

  it("carries the offset and the city, so it can't be mistaken for ours", () => {
    const label = whenLabelInZone(iso, "Asia/Jakarta");
    expect(label).toContain("GMT+7");
    expect(label).toContain("(Jakarta)");
  });

  it("falls back to Cairo instead of throwing on a bad zone", () => {
    expect(() => whenLabelInZone(iso, "Mars/Olympus")).not.toThrow();
    expect(whenLabelInZone(iso, "Mars/Olympus")).toContain("Cairo");
  });

  it("hands back an unparseable instant untouched", () => {
    expect(whenLabelInZone("not-a-date", "Africa/Cairo")).toBe("not-a-date");
  });

  it("computes offsets against the MOMENT, so DST is never assumed", () => {
    // Istanbul is permanently GMT+3; London moves
    expect(zoneOffsetLabel("2026-01-15T12:00:00Z", "Europe/London")).toBe("GMT");
    expect(zoneOffsetLabel("2026-07-15T12:00:00Z", "Europe/London")).toBe("GMT+1");
  });

  it("prints a readable city for multi-word zones", () => {
    expect(zoneCity("America/Sao_Paulo")).toBe("Sao Paulo");
    expect(zoneCity("Africa/Cairo")).toBe("Cairo");
  });
});
