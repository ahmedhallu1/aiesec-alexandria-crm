import { describe, it, expect } from "vitest";
import {
  accountFnTargets,
  allowedAccountFunctions,
  openTargetFunctions,
  type Viewer,
} from "@/lib/rbac";
import { signatureTitle } from "@/lib/email/compose";

/**
 * THE CROSS-FUNCTION OPEN (v34.10).
 *
 * The case this exists for, verbatim from the floor: an IGT member walked into
 * an enabler as IGT, was told no to a teacher and yes to a volunteer, and the
 * open that got signed was an IGV one. Before this the CRM had no way to say
 * that — so the open was either recorded against the wrong programme or never
 * recorded at all.
 *
 * These are the boundary assertions. The rule is deliberately narrow: an ICX
 * raiser may move an account they ALREADY OWN between IGV and IGT, and nothing
 * else widens — creating accounts stays exactly as scoped as it was.
 */

const member = (over: Partial<Viewer> = {}): Viewer =>
  ({
    id: "m1",
    name: "Test Member",
    nickname: null,
    email: "test@aiesec.net",
    phone: null,
    functions: [],
    sub_functions: [],
    role: "Member",
    stakeholder_name: null,
    stakeholder_id: null,
    team_name: null,
    is_active: true,
    google_refresh_token: null,
    isAdmin: false,
    teamMemberIds: [],
    ...over,
  }) as Viewer;

const account = (
  over: Partial<{ function: string; responsible_id: string | null; out_of_process: boolean }> = {}
) => ({
  function: "IGT",
  responsible_id: "igt1",
  out_of_process: false,
  ...over,
});

const igtRaiser = member({ id: "igt1", functions: ["IGT"], sub_functions: ["Raising"] });
const igvRaiser = member({ id: "igv1", functions: ["IGV"], sub_functions: ["Raising"] });
const b2bRaiser = member({ id: "b2b1", functions: ["B2B"], sub_functions: ["B2B"] });
const b2cDirector = member({ id: "dir-b2c", role: "Director", functions: ["B2C"], sub_functions: ["B2C"] });

describe("moving an account to the ICX sibling", () => {
  it("an IGT member may push THEIR OWN IGT account to IGV — the whole point", () => {
    expect(accountFnTargets(igtRaiser, account())).toEqual(
      expect.arrayContaining(["IGT", "IGV"])
    );
  });

  it("…and may push it BACK, once it is sitting in IGV", () => {
    // the account no longer carries a function they "work" — without the
    // sibling rule this returned [] and stranded the account in IGV
    expect(accountFnTargets(igtRaiser, account({ function: "IGV" }))).toEqual(
      expect.arrayContaining(["IGT", "IGV"])
    );
  });

  it("but may NOT touch an ICX account that isn't theirs", () => {
    expect(accountFnTargets(igtRaiser, account({ responsible_id: "someone-else" }))).toEqual([]);
  });

  it("and may NOT create an IGV account out of nowhere — only move one they own", () => {
    expect(allowedAccountFunctions(igtRaiser)).toEqual(["IGT"]);
    expect(allowedAccountFunctions(igvRaiser)).toEqual(["IGV"]);
  });

  it("an archived account moves through revive, never through the picker", () => {
    expect(accountFnTargets(igtRaiser, account({ out_of_process: true }))).toEqual([]);
  });

  it("the sibling rule is ICX-only: B2B/BD keep exactly the pair they had", () => {
    const targets = accountFnTargets(b2bRaiser, account({ function: "B2B", responsible_id: "b2b1" }));
    expect(targets).toEqual(expect.arrayContaining(["B2B", "BD"]));
    expect(targets).not.toContain("IGV");
    expect(targets).not.toContain("IGT");
  });

  it("a B2C director's single function still offers no move at all", () => {
    expect(accountFnTargets(b2cDirector, account({ function: "B2C", responsible_id: "dir-b2c" }))).toEqual([]);
  });
});

describe("which function an open may be raised for", () => {
  it("an IGT account can sign an IGV open, and the reverse", () => {
    expect(openTargetFunctions({ function: "IGT" }).sort()).toEqual(["IGT", "IGV"]);
    expect(openTargetFunctions({ function: "IGV" }).sort()).toEqual(["IGT", "IGV"]);
  });

  it("B2B and BD already mix all three products — they need no widening", () => {
    expect(openTargetFunctions({ function: "B2B" })).toEqual(["B2B"]);
    expect(openTargetFunctions({ function: "BD" })).toEqual(["BD"]);
  });

  it("B2C carries no opens at all", () => {
    expect(openTargetFunctions({ function: "B2C" })).toEqual(["B2C"]);
  });
});

/**
 * THE SIGNATURE (v34.10). It read `functions[0]` and stopped, so the Director
 * of IM *and* of CXP ICX signed every letter as IM alone.
 */
describe("the signature's role line", () => {
  it("carries EVERY function, not just the first", () => {
    expect(signatureTitle("Director", ["IM", "CXP"], { cxpSides: ["ICX"] })).toBe(
      "Director of Information Management & Customer Experience (ICX)"
    );
  });

  it("names which side of CXP — the two are different jobs", () => {
    expect(signatureTitle("LCVP", ["CXP"], { cxpSides: ["OGX"] })).toBe(
      "Local Committee Vice President of Customer Experience (OGX)"
    );
    expect(signatureTitle("LCVP", ["CXP"], { cxpSides: ["ICX", "OGX"] })).toBe(
      "Local Committee Vice President of Customer Experience (ICX & OGX)"
    );
  });

  it("leaves CXP unqualified when no side was resolved", () => {
    expect(signatureTitle("Director", ["CXP"])).toBe("Director of Customer Experience");
  });

  it("still reads the same for the one-function case it always handled", () => {
    expect(signatureTitle("LCVP", ["IGV"])).toBe(
      "Local Committee Vice President of Incoming Global Volunteer"
    );
    expect(signatureTitle("Team Leader", ["IGT"])).toBe(
      "Team Leader — Incoming Global Talent & Teacher"
    );
    expect(signatureTitle("Member", ["OGV"])).toBe(
      "Outgoing Global Volunteer, AIESEC in Alexandria"
    );
  });

  it("the LCP answers for all of it and names none of it", () => {
    expect(signatureTitle("LCP", ["IGV", "IGT", "TM"])).toBe("Local Committee President");
  });

  it("three functions read as a list, and a repeat collapses (B2B/BD are one)", () => {
    expect(signatureTitle("Director", ["B2B", "BD"])).toBe("Director of Business Development");
    expect(signatureTitle("Director", ["IGV", "IGT", "TM"])).toBe(
      "Director of Incoming Global Volunteer, Incoming Global Talent & Teacher & Talent Management"
    );
  });

  it("a member with no function at all still signs for the LC", () => {
    expect(signatureTitle("Member", [])).toBe("AIESEC in Alexandria");
  });
});
