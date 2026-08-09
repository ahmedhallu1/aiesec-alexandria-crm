import { describe, it, expect } from "vitest";
import {
  IR_ROLES, irProductForMember, isKnownIrRole, normalizePhone,
} from "../src/lib/types";
import { DIAL_CODES, dialCode, phoneExample } from "../src/lib/dial-codes";
import { resolveCountry } from "../src/lib/timezones";
import { availabilityIssues, windowIssue } from "../src/lib/availability";
import { COUNTRIES } from "../src/lib/countries";

/** The consideration module's pure rules (v33.23). */

describe("which product an IR call marketed", () => {
  const m = (fns: string[], subs: string[] = []) => ({
    functions: fns,
    sub_functions: subs,
  });

  it("reads the host's product function", () => {
    expect(irProductForMember(m(["IGV"]))).toBe("GV");
    expect(irProductForMember(m(["IGT"]))).toBe("GT");
  });

  it("finds it in sub-functions too — the label lives in either column", () => {
    expect(irProductForMember(m(["Consideration"], ["IGT"]))).toBe("GT");
    expect(irProductForMember(m([], ["IGV"]))).toBe("GV");
  });

  it("records ambiguity AS ambiguity rather than counting a call twice", () => {
    // someone who works both products: nobody guesses on their behalf
    expect(irProductForMember(m(["IGV", "IGT"]))).toBeNull();
    expect(irProductForMember(m(["IGV"], ["IGT"]))).toBeNull();
    // and someone attached to neither
    expect(irProductForMember(m(["Consideration"]))).toBeNull();
    expect(irProductForMember(m([]))).toBeNull();
    expect(irProductForMember({})).toBeNull();
  });
});

describe("the IR role list is one list", () => {
  it("offers exactly the four the LC uses", () => {
    expect([...IR_ROLES]).toEqual(["Member", "MM", "LCVP", "LCP"]);
  });

  it("still ACCEPTS every value already stored on a booking", () => {
    // the picker narrowed in v33.26; a stored role is a snapshot of what
    // someone chose at the time, so validation must not reject it later
    for (const stored of [
      "Member", "MM", "LCVP", "LCP",
      "MM (Team Leader / Coordinator)", "Director", "Alumni / Other",
    ])
      expect(isKnownIrRole(stored)).toBe(true);
    expect(isKnownIrRole("Supreme Leader")).toBe(false);
  });
});

describe("resolving a country from whatever someone typed", () => {
  it("takes the exact name, any case", () => {
    expect(resolveCountry("Turkey", COUNTRIES)).toBe("Turkey");
    expect(resolveCountry("  turkey  ", COUNTRIES)).toBe("Turkey");
  });

  it("takes the endonyms and everyday names people actually write", () => {
    expect(resolveCountry("Türkiye", COUNTRIES)).toBe("Turkey");
    expect(resolveCountry("turkiye", COUNTRIES)).toBe("Turkey");
    expect(resolveCountry("UK", COUNTRIES)).toBe("United Kingdom");
    expect(resolveCountry("USA", COUNTRIES)).toBe("United States");
    expect(resolveCountry("Holland", COUNTRIES)).toBe("Netherlands");
    expect(resolveCountry("Viet Nam", COUNTRIES)).toBe("Vietnam");
    expect(resolveCountry("UAE", COUNTRIES)).toBe("United Arab Emirates");
  });

  it("NEVER guesses — an unknown string is null, not a near match", () => {
    // this is the guard that matters: a wrong country is a wrong time zone
    for (const junk of ["", "   ", "Turk", "Turkeyy", "Georgia Tech", "Wakanda", "New Mexico"])
      expect(resolveCountry(junk, COUNTRIES)).toBeNull();
    expect(resolveCountry(null, COUNTRIES)).toBeNull();
  });
});

describe("the phone example shown in a form", () => {
  it("covers every country the app offers", () => {
    const missing = COUNTRIES.filter((c) => !phoneExample(c));
    expect(missing).toEqual([]);
  });

  it("is a number our own validator ACCEPTS if typed literally", () => {
    // an example the validator rejects is worse than no example at all
    const rejected = Object.keys(DIAL_CODES).filter((c) => {
      const ex = phoneExample(c)!;
      const r = normalizePhone(ex);
      return !r.ok || !r.value.startsWith("+");
    });
    expect(rejected).toEqual([]);
  });

  it("carries the right dial code", () => {
    expect(phoneExample("Turkey")!.startsWith("+90 ")).toBe(true);
    expect(phoneExample("Indonesia")!.startsWith("+62 ")).toBe(true);
    expect(phoneExample("India")!.startsWith("+91 ")).toBe(true);
    expect(dialCode("Egypt")).toBe("20");
  });

  it("returns null for an unknown country so the caller keeps its own copy", () => {
    expect(phoneExample("Wakanda")).toBeNull();
    expect(phoneExample("")).toBeNull();
    expect(phoneExample(null)).toBeNull();
  });
});

describe("availability windows — the rules the form and the server share", () => {
  it("passes an ordinary evening window", () => {
    expect(windowIssue({ day: 6, from: "18:00", to: "21:00" })).toBeNull();
  });

  it("accepts a window that ends at midnight, written either way", () => {
    // "00:00" and the legacy "23:59" workaround both mean the END of the day
    expect(windowIssue({ day: 6, from: "18:00", to: "00:00" })).toBeNull();
    expect(windowIssue({ day: 6, from: "18:00", to: "23:59" })).toBeNull();
  });

  it("rejects a window that is backwards or too short to hold a call", () => {
    expect(windowIssue({ day: 6, from: "21:00", to: "18:00" })).toBeTruthy();
    expect(windowIssue({ day: 6, from: "18:00", to: "18:05" })).toBeTruthy();
  });

  it("asks for the missing piece of a row, naming which piece", () => {
    expect(windowIssue({ day: 6, from: "", to: "21:00" })).toContain("start");
    expect(windowIssue({ date: "", from: "18:00", to: "21:00" })).toContain("date");
    expect(windowIssue({ day: null, from: "18:00", to: "21:00" })).toContain("day");
  });

  it("marks the SECOND of two overlapping windows, not the first", () => {
    const issues = availabilityIssues([
      { day: 6, from: "17:00", to: "20:00" },
      { day: 6, from: "18:00", to: "21:00" },
    ]);
    expect(issues.has(0)).toBe(false);
    expect(issues.get(1)).toContain("overlaps");
  });

  it("lets the same clock hours live on different days", () => {
    const issues = availabilityIssues([
      { day: 6, from: "18:00", to: "21:00" },
      { day: 1, from: "18:00", to: "21:00" },
      { date: "2026-09-01", from: "18:00", to: "21:00" },
    ]);
    expect(issues.size).toBe(0);
  });
});
