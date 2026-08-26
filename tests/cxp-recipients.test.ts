import { describe, it, expect } from "vitest";
import {
  routeAll,
  routeForFunction,
  validEmail,
  type RecipientMember,
} from "@/lib/cxp/recipients";

/**
 * THE RECIPIENT TESTS.
 *
 * These reproduce the four lists the CXP directors gave, from a membership
 * that looks like the real one. The point is that NOBODY IS NAMED IN THE CODE:
 * the lists below fall out of the rule "the function's VP(s) + the CXP
 * leadership of that side" applied to membership rows. When the term changes,
 * the sheet changes and these lists change with it.
 *
 * The names here are the real LC's, used as fixtures precisely so that a
 * refactor which breaks the rule produces a visibly wrong list.
 */

const m = (over: Partial<RecipientMember> & { name: string }): RecipientMember => ({
  id: over.name.toLowerCase().replace(/\s+/g, "-"),
  email: `${over.name.toLowerCase().replace(/\s+/g, "")}@aiesec.net`,
  role: "Member",
  functions: [],
  sub_functions: [],
  is_active: true,
  ...over,
});

/** The LC as the directors described it. */
const MEMBERSHIP: RecipientMember[] = [
  // ICX side — one VP across both incoming products, a CXP VP and the CXP director
  m({ name: "Nada", role: "LCVP", functions: ["IGV", "IGT"] }),
  m({ name: "Eldeeb", role: "LCVP", functions: ["CXP"], sub_functions: ["ICX"] }),
  m({ name: "Hallul", role: "Director", functions: ["CXP"], sub_functions: ["ICX"] }),

  // OGX side — a VP for OGV only, plus the CXP VP and director for the side
  m({ name: "Barthinya", role: "LCVP", functions: ["OGV"] }),
  m({ name: "Yassin", role: "LCVP", functions: ["CXP"], sub_functions: ["OGX"] }),
  m({ name: "Farah", role: "Director", functions: ["CXP"], sub_functions: ["OGX"] }),

  // people who must NEVER be on a submission email
  m({ name: "Some Member", functions: ["IGV"], sub_functions: ["Consideration"] }),
  m({ name: "Some TL", role: "Team Leader", functions: ["IGV"] }),
  m({ name: "CXP Member", functions: ["CXP"], sub_functions: ["ICX"] }),
  m({ name: "TM VP", role: "LCVP", functions: ["TM"] }),
  m({ name: "Old VP", role: "LCVP", functions: ["OGV"], is_active: false }),
];

const namesFor = (fn: Parameters<typeof routeForFunction>[1]) =>
  routeForFunction(MEMBERSHIP, fn).recipients.map((r) => r.name);

describe("the four lists the directors specified", () => {
  it("IGV → Nada, Eldeeb, Hallul", () => {
    expect(namesFor("IGV")).toEqual(["Nada", "Eldeeb", "Hallul"]);
  });

  it("IGT → the same three", () => {
    expect(namesFor("IGT")).toEqual(["Nada", "Eldeeb", "Hallul"]);
  });

  it("OGV → Barthinya, Farah, Yassin", () => {
    expect(namesFor("OGV").sort()).toEqual(["Barthinya", "Farah", "Yassin"]);
  });

  it("OGT → Farah, Yassin — there is no OGT VP on the sheet", () => {
    expect(namesFor("OGT").sort()).toEqual(["Farah", "Yassin"]);
  });
});

describe("a CXP row whose Sub Function cell is blank", () => {
  // the real membership: Yassin carries Function "OGT, CXP" and no Sub Function
  const REAL: RecipientMember[] = [
    m({ name: "Barthinya", role: "LCVP", functions: ["OGV"] }),
    m({ name: "Yassin", role: "LCVP", functions: ["OGT", "CXP"] }),
    m({ name: "Farah", role: "Director", functions: ["CXP"], sub_functions: ["OGX"] }),
    m({ name: "Nada", role: "LCVP", functions: ["IGV"] }),
    m({ name: "Hallul", role: "Director", functions: ["IM", "CXP"], sub_functions: ["ICX"] }),
    m({ name: "Eldeeb", role: "LCVP", functions: ["IGT"] }),
  ];
  const names = (fn: Parameters<typeof routeForFunction>[1]) =>
    routeForFunction(REAL, fn).recipients.map((r) => r.name).sort();

  it("puts the OGX CXP VP on BOTH outgoing functions", () => {
    expect(names("OGV")).toEqual(["Barthinya", "Farah", "Yassin"]);
    expect(names("OGT")).toEqual(["Farah", "Yassin"]);
  });

  it("and never lets the inferred side cross to ICX", () => {
    expect(names("IGV")).toEqual(["Hallul", "Nada"]);
    expect(names("IGT")).toEqual(["Eldeeb", "Hallul"]);
  });
});

describe("who is deliberately excluded", () => {
  it("plain members, TLs and CXP members never receive", () => {
    const everyone = routeAll(MEMBERSHIP).flatMap((r) => r.recipients.map((x) => x.name));
    expect(everyone).not.toContain("Some Member");
    expect(everyone).not.toContain("Some TL");
    expect(everyone).not.toContain("CXP Member");
  });

  it("an unrelated VP never receives", () => {
    const everyone = routeAll(MEMBERSHIP).flatMap((r) => r.recipients.map((x) => x.name));
    expect(everyone).not.toContain("TM VP");
  });

  it("an inactive member never receives", () => {
    expect(namesFor("OGV")).not.toContain("Old VP");
  });
});

describe("the sides never leak into each other", () => {
  it("ICX recipients appear on no OGX email", () => {
    for (const fn of ["OGV", "OGT"] as const) {
      const names = namesFor(fn);
      expect(names).not.toContain("Hallul");
      expect(names).not.toContain("Eldeeb");
      expect(names).not.toContain("Nada");
    }
  });

  it("OGX recipients appear on no ICX email", () => {
    for (const fn of ["IGV", "IGT"] as const) {
      const names = namesFor(fn);
      expect(names).not.toContain("Farah");
      expect(names).not.toContain("Yassin");
      expect(names).not.toContain("Barthinya");
    }
  });
});

describe("gaps surface instead of silently shrinking the list", () => {
  it("reports a matched person with no usable address", () => {
    const withGap: RecipientMember[] = [
      ...MEMBERSHIP.filter((x) => x.name !== "Nada"),
      m({ name: "Nada", role: "LCVP", functions: ["IGV", "IGT"], email: "" }),
    ];
    const r = routeForFunction(withGap, "IGV");
    expect(r.recipients.map((x) => x.name)).toEqual(["Eldeeb", "Hallul"]);
    expect(r.missingRecipients).toEqual([{ name: "Nada", reason: "function-vp" }]);
  });

  it("NEVER falls back to an unrelated address when a function has nobody", () => {
    // the old system shipped a hardcoded seed with two live addresses in it
    const r = routeForFunction([m({ name: "TM VP", role: "LCVP", functions: ["TM"] })], "IGV");
    expect(r.recipients).toEqual([]);
    expect(r.missingRecipients).toEqual([]);
  });

  it("rejects malformed addresses", () => {
    expect(validEmail("a@b.co")).toBe("a@b.co");
    expect(validEmail("  Nada@AIESEC.net ")).toBe("nada@aiesec.net");
    expect(validEmail("not-an-email")).toBe(null);
    expect(validEmail(null)).toBe(null);
  });
});

describe("shape", () => {
  it("dedupes two membership rows sharing one address", () => {
    const twice: RecipientMember[] = [
      m({ id: "a", name: "Hallul", role: "Director", functions: ["CXP"], sub_functions: ["ICX"] }),
      m({ id: "b", name: "Hallul", role: "LCVP", functions: ["IGV"] }),
    ];
    expect(routeForFunction(twice, "IGV").recipients).toHaveLength(1);
  });

  it("labels why each person is on the mail", () => {
    const r = routeForFunction(MEMBERSHIP, "IGV");
    expect(r.recipients.map((x) => x.reason)).toEqual([
      "function-vp",
      "cxp-lead",
      "cxp-lead",
    ]);
  });

  it("carries the side, so a send run can be grouped by it", () => {
    expect(routeForFunction(MEMBERSHIP, "IGV").side).toBe("ICX");
    expect(routeForFunction(MEMBERSHIP, "OGT").side).toBe("OGX");
  });
});
