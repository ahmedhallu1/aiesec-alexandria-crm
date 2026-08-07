import { describe, it, expect } from "vitest";
import { IR_ROLES, irProductForMember, normalizePhone } from "../src/lib/types";
import { DIAL_CODES, dialCode, phoneExample } from "../src/lib/dial-codes";
import { resolveCountry } from "../src/lib/timezones";
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
  it("still contains every value the public booking page has ever stored", () => {
    // v29 shipped these four; existing ir_calls.booker_role rows carry them
    for (const legacy of ["Member", "MM (Team Leader / Coordinator)", "LCVP", "LCP"])
      expect(IR_ROLES as readonly string[]).toContain(legacy);
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
