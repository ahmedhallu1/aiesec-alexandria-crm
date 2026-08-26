import { describe, it, expect } from "vitest";
import type { Viewer } from "@/lib/rbac";
import {
  canRunCxpOps,
  canViewCxpFunction,
  cxpDefaultFunction,
  cxpDefaultSide,
  cxpEmailFunctions,
  cxpFunctions,
  cxpSides,
  hasCxpAccess,
  hasCxpTag,
  taggedSides,
} from "@/lib/cxp/rbac";

/**
 * THE CXP ACCESS TESTS.
 *
 * The auditing data is the LC's compliance record: who may read it was decided
 * by the LCP and the two CXP directors, and every rule below is one of theirs.
 * This file exists so that a later refactor which quietly widens a scope FAILS
 * here instead of shipping.
 *
 * The predicates are pure functions of the Viewer, so nothing is mocked.
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

// ----------------------------------------------------- real LC archetypes

const lcp = member({ role: "LCP" });
const admin = member({ isAdmin: true });
const fnl = member({ role: "Member", functions: ["F&L"] });
const fnlVp = member({ role: "LCVP", functions: ["F&L"] });

/** Ahmed Hallul's shape: Director of CXP, incoming side. */
const cxpIcxDirector = member({
  role: "Director",
  functions: ["CXP"],
  sub_functions: ["ICX"],
});
/** Farah Shaaban's shape: Director of CXP, outgoing side. */
const cxpOgxDirector = member({
  role: "Director",
  functions: ["CXP"],
  sub_functions: ["OGX"],
});
/** A plain member put on CXP — the tag itself is the decision. */
const cxpIcxMember = member({ functions: ["CXP"], sub_functions: ["ICX"] });

const igvVp = member({ role: "LCVP", functions: ["IGV"] });
const ogvVp = member({ role: "LCVP", functions: ["OGV"] });
const igvConsiderationTl = member({
  role: "Team Leader",
  functions: ["IGV"],
  sub_functions: ["Consideration"],
});
const igvRaisingTl = member({
  role: "Team Leader",
  functions: ["IGV"],
  sub_functions: ["Raising"],
});
const ogtTl = member({ role: "Team Leader", functions: ["OGT"] });
const igvMember = member({ functions: ["IGV"], sub_functions: ["Consideration"] });
const tmVp = member({ role: "LCVP", functions: ["TM"] });

describe("the CXP tag", () => {
  it("is read from either column", () => {
    expect(hasCxpTag(cxpIcxDirector)).toBe(true);
    expect(hasCxpTag(member({ sub_functions: ["CXP"] }))).toBe(true);
    expect(hasCxpTag(igvVp)).toBe(false);
  });

  it("grants ONLY the side it names", () => {
    expect(taggedSides(cxpIcxDirector)).toEqual(["ICX"]);
    expect(taggedSides(cxpOgxDirector)).toEqual(["OGX"]);
  });

  it("grants NOTHING when the sheet names no side AND no function", () => {
    // an empty membership row must fail closed, not open
    const halfTagged = member({ functions: ["CXP"] });
    expect(taggedSides(halfTagged)).toEqual([]);
    expect(hasCxpAccess(halfTagged)).toBe(false);
  });

  it("INFERS the side from the product function when Sub Function is blank", () => {
    // Yassin ElHawash's real row: Function "OGT, CXP", Sub Function empty.
    // Reading that strictly locked the OGX CXP VP out of the side he runs.
    const yassin = member({ role: "LCVP", functions: ["OGT", "CXP"] });
    expect(taggedSides(yassin)).toEqual(["OGX"]);
    expect(cxpFunctions(yassin)).toEqual(["OGV", "OGT"]);
    // and it must NOT reach across to the other side
    expect(canViewCxpFunction(yassin, "IGV")).toBe(false);
  });
});

describe("CXP directors see their own side and no other", () => {
  it("ICX director reads IGV + IGT only", () => {
    expect(cxpFunctions(cxpIcxDirector)).toEqual(["IGV", "IGT"]);
    expect(canViewCxpFunction(cxpIcxDirector, "OGV")).toBe(false);
    expect(canViewCxpFunction(cxpIcxDirector, "OGT")).toBe(false);
  });

  it("OGX director reads OGV + OGT only", () => {
    expect(cxpFunctions(cxpOgxDirector)).toEqual(["OGV", "OGT"]);
    expect(canViewCxpFunction(cxpOgxDirector, "IGV")).toBe(false);
  });

  it("is strict even for a plain Member carrying the tag", () => {
    expect(hasCxpAccess(cxpIcxMember)).toBe(true);
    expect(cxpSides(cxpIcxMember)).toEqual(["ICX"]);
    expect(canViewCxpFunction(cxpIcxMember, "OGT")).toBe(false);
  });
});

describe("VPs read BOTH functions of their own side", () => {
  it("an IGV VP reads IGT too", () => {
    expect(cxpFunctions(igvVp)).toEqual(["IGV", "IGT"]);
  });

  it("an OGV VP reads OGT too — and never crosses to ICX", () => {
    expect(cxpFunctions(ogvVp)).toEqual(["OGV", "OGT"]);
    expect(canViewCxpFunction(ogvVp, "IGV")).toBe(false);
  });
});

describe("MMs read ONLY their own function", () => {
  it("an IGV consideration TL never sees IGT", () => {
    expect(cxpFunctions(igvConsiderationTl)).toEqual(["IGV"]);
    expect(canViewCxpFunction(igvConsiderationTl, "IGT")).toBe(false);
  });

  it("an IGV RAISING TL is not on the submissions floor at all", () => {
    // ICX submissions are Consideration's work; raising is a different job
    expect(hasCxpAccess(igvRaisingTl)).toBe(false);
  });

  it("an OGX MM qualifies without a Consideration tag", () => {
    // the outgoing side has no raising/consideration split on this floor
    expect(cxpFunctions(ogtTl)).toEqual(["OGT"]);
  });
});

describe("plain Members inherit nothing", () => {
  it("a consideration MEMBER of IGV is locked out", () => {
    expect(hasCxpAccess(igvMember)).toBe(false);
    expect(cxpFunctions(igvMember)).toEqual([]);
  });

  it("…unless they carry the CXP tag", () => {
    expect(hasCxpAccess(cxpIcxMember)).toBe(true);
  });
});

describe("whole-LC access follows Sodio's existing master()", () => {
  it("the LCP and admins read everything", () => {
    expect(cxpFunctions(lcp)).toEqual(["IGV", "IGT", "OGV", "OGT"]);
    expect(cxpFunctions(admin)).toEqual(["IGV", "IGT", "OGV", "OGT"]);
  });

  it("the WHOLE F&L function reads everything, at any role", () => {
    expect(cxpFunctions(fnl)).toEqual(["IGV", "IGT", "OGV", "OGT"]);
    expect(cxpFunctions(fnlVp)).toEqual(["IGV", "IGT", "OGV", "OGT"]);
  });

  it("but an unrelated VP gets nothing — TM is not a CXP function", () => {
    expect(hasCxpAccess(tmVp)).toBe(false);
  });
});

describe("the module opens on the viewer's own side", () => {
  it("an OGV VP lands on OGX", () => {
    expect(cxpDefaultSide(ogvVp)).toBe("OGX");
    expect(cxpDefaultFunction(ogvVp)).toBe("OGV");
  });

  it("an ICX director lands on ICX", () => {
    expect(cxpDefaultSide(cxpIcxDirector)).toBe("ICX");
  });

  it("someone with no side at all gets null rather than a wrong guess", () => {
    expect(cxpDefaultSide(igvMember)).toBe(null);
    expect(cxpDefaultFunction(igvMember)).toBe(null);
  });
});

describe("email scope is NARROWER than read scope", () => {
  it("a VP reads both functions but is mailed about their own", () => {
    expect(cxpFunctions(igvVp)).toEqual(["IGV", "IGT"]);
    expect(cxpEmailFunctions(igvVp)).toEqual(["IGV"]);
  });

  it("a CXP director is mailed about their whole side — they answer for it", () => {
    expect(cxpEmailFunctions(cxpIcxDirector)).toEqual(["IGV", "IGT"]);
    expect(cxpEmailFunctions(cxpOgxDirector)).toEqual(["OGV", "OGT"]);
  });

  it("an MM is mailed about their own function", () => {
    expect(cxpEmailFunctions(igvConsiderationTl)).toEqual(["IGV"]);
  });
});

describe("the ops edge", () => {
  it("belongs to leaders and the CXP directors", () => {
    expect(canRunCxpOps(igvVp)).toBe(true);
    expect(canRunCxpOps(cxpIcxDirector)).toBe(true);
    expect(canRunCxpOps(lcp)).toBe(true);
  });

  it("never to a member who merely reads", () => {
    expect(canRunCxpOps(cxpIcxMember)).toBe(false);
    expect(canRunCxpOps(igvMember)).toBe(false);
  });
});
