import { describe, it, expect } from "vitest";
import type { SignupRow } from "@/lib/types";
import {
  accountScope,
  allowedAccountFunctions,
  canEditAccount,
  canReassignAccount,
  canEditRequestState,
  canFilterUnassigned,
  canSeeCvPool,
  canSeeLcConcerns,
  canSeeUnassigned,
  hasPodioAccess,
  calendarItemScopes,
  canUseAdminTools,
  canViewAccount,
  canViewSignup,
  canWorkSignup,
  considerationFunctions,
  hasConsiderationAccess,
  hasRaisingAccess,
  isClaimableAccount,
  ogxLanes,
  ogxFunctions,
  raisingFunctions,
  scopeFunctions,
  seesEveryLane,
  type Viewer,
} from "@/lib/rbac";

/**
 * THE AUTHORIZATION TESTS.
 *
 * `rbac.ts` is the single engine every read and every mutation passes through,
 * so it is the one place where a silent regression turns into "a Member can
 * read the whole LC". Until now nothing protected it — this file exists so a
 * refactor that widens scope FAILS instead of shipping.
 *
 * These exercise the real predicates with real viewer shapes taken from the
 * live membership. Nothing is mocked: the functions are pure, so the assertions
 * are about actual behaviour, not about a stub returning what we told it to.
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

const account = (over: Partial<{ function: string; responsible_id: string | null; out_of_process: boolean }> = {}) => ({
  function: "IGV",
  responsible_id: "someone-else",
  out_of_process: false,
  ...over,
});

// real archetypes from the LC
const igvRaiser = member({ id: "igv1", functions: ["IGV"], sub_functions: ["Raising"] });
const igvConsid = member({ id: "igv2", functions: ["IGV"], sub_functions: ["Consideration"] });
const igtVp = member({ id: "vp-igt", role: "LCVP", functions: ["IGT"], sub_functions: ["Raising", "Consideration"] });
const igvVp = member({ id: "vp-igv", role: "LCVP", functions: ["IGV"], sub_functions: ["Raising", "Consideration"] });
const b2cDirector = member({ id: "dir-b2c", role: "Director", functions: ["B2C"], sub_functions: ["B2C"] });
const bdDirector = member({ id: "dir-bd", role: "Director", functions: ["BD", "B2B"], sub_functions: ["BD", "B2B"] });
const tmVp = member({ id: "vp-tm", role: "LCVP", functions: ["TM"], sub_functions: ["TM"] });
const flVp = member({ id: "vp-fl", role: "LCVP", functions: ["F&L"], sub_functions: ["F&L"] });
const lcp = member({ id: "lcp", role: "LCP" });
const pureAdmin = member({ id: "admin", role: "Admin" });
const tl = member({ id: "tl", role: "Team Leader", functions: ["IGV"], sub_functions: ["Raising"], teamMemberIds: ["t1", "t2"] });
const ogvMm = member({ id: "ogv", role: "Team Leader", functions: ["OGV"], sub_functions: ["OGX"] });

describe("account scope — the primary boundary", () => {
  it("a plain member sees ONLY their own accounts", () => {
    const s = accountScope(igvRaiser);
    expect(s).toEqual({ kind: "members", ids: ["igv1"] });
  });

  it("a Team Leader sees themselves plus their team, and nobody else", () => {
    const s = accountScope(tl);
    expect(s).toEqual({ kind: "members", ids: ["tl", "t1", "t2"] });
  });

  it("the LCP sees everything", () => {
    expect(accountScope(lcp)).toEqual({ kind: "all" });
  });

  it("a member CANNOT edit another member's account", () => {
    expect(canEditAccount(igvRaiser, account({ responsible_id: "other" }))).toBe(false);
  });

  it("a Team Leader CAN edit a team member's account but not an outsider's", () => {
    expect(canEditAccount(tl, account({ responsible_id: "t1" }))).toBe(true);
    expect(canEditAccount(tl, account({ responsible_id: "stranger" }))).toBe(false);
  });

  it("a VP edits inside their function only — never the other product's", () => {
    expect(canEditAccount(igtVp, account({ function: "IGT" }))).toBe(true);
    expect(canEditAccount(igtVp, account({ function: "IGV" }))).toBe(false);
  });

  it("the ARCHIVE is world-readable but never world-writable", () => {
    const archived = account({ function: "IGT", responsible_id: "x", out_of_process: true });
    expect(canViewAccount(igvRaiser, archived)).toBe(true);
    expect(canEditAccount(igvRaiser, archived)).toBe(false);
  });
});

describe("unowned accounts: MMs and up only (v33.2)", () => {
  const igvTl = member({ id: "tl-igv", role: "Team Leader", functions: ["IGV"], sub_functions: ["Raising"] });
  const igvCoord = member({ id: "co-igv", role: "Coordinator", functions: ["IGV"], sub_functions: ["Raising"] });

  it("an MM can take an account nobody owns, across functions", () => {
    expect(isClaimableAccount(igvTl, account({ function: "IGT", responsible_id: null }))).toBe(true);
    expect(isClaimableAccount(igvCoord, account({ function: "IGT", responsible_id: null }))).toBe(true);
    expect(canSeeUnassigned(igvTl)).toBe(true);
  });

  it("a plain MEMBER cannot — the unowned pool is a distribution problem", () => {
    // 1,300 ownerless names buried in a member's own list stops it being a
    // to-do list; handing them out is their MM's job
    expect(canSeeUnassigned(igvRaiser)).toBe(false);
    expect(isClaimableAccount(igvRaiser, account({ responsible_id: null }))).toBe(false);
  });

  it("the Unassigned FILTER follows who can SEE unowned accounts", () => {
    // if you can work them you can isolate them; if you can't see them at all
    // the option would only ever return nothing
    expect(canFilterUnassigned(igvVp)).toBe(true);
    expect(canFilterUnassigned(lcp)).toBe(true);
    expect(canFilterUnassigned(igvTl)).toBe(true);
    expect(canFilterUnassigned(igvCoord)).toBe(true);
    expect(canFilterUnassigned(igvRaiser)).toBe(false); // a Member sees no pool
  });

  it("an OWNED account is never claimable — this is the IDOR guard", () => {
    expect(isClaimableAccount(igvTl, account({ responsible_id: "other" }))).toBe(false);
    expect(canReassignAccount(igvRaiser, account({ responsible_id: "other" }))).toBe(false);
  });

  it("an ARCHIVED unowned account is not claimable", () => {
    expect(
      isClaimableAccount(igvTl, account({ responsible_id: null, out_of_process: true }))
    ).toBe(false);
  });

  it("someone with no create rights cannot claim anything", () => {
    const outsider = member({ role: "Team Leader", functions: ["CXP"], sub_functions: ["CXP"] });
    expect(isClaimableAccount(outsider, account({ responsible_id: null }))).toBe(false);
  });
});

describe("Podio access is a capability, not a rank (v33.2)", () => {
  const acct = { function: "IGV", responsible_id: "podio-member", out_of_process: false };
  const tagged = member({
    id: "podio-member", functions: ["IGV"], sub_functions: ["Raising"], has_podio: true,
  });
  const untagged = member({ id: "podio-member", functions: ["IGV"], sub_functions: ["Raising"] });

  it("a tagged member may set the Request State on their OWN account", () => {
    expect(hasPodioAccess(tagged)).toBe(true);
    expect(canEditRequestState(tagged, acct)).toBe(true);
  });

  it("an untagged member may not", () => {
    expect(canEditRequestState(untagged, acct)).toBe(false);
  });

  it("the tag never reaches someone else's account", () => {
    expect(canEditRequestState(tagged, { ...acct, responsible_id: "someone-else" })).toBe(false);
  });

  it("the tag is meaningless outside the functions that submit to Podio", () => {
    const tmTagged = member({ functions: ["TM"], sub_functions: ["TM"], has_podio: true });
    expect(hasPodioAccess(tmTagged)).toBe(false);
  });
});

describe("dashboard lanes — nobody sees the other product", () => {
  it("a raising member gets the raising lane only", () => {
    expect(raisingFunctions(igvRaiser)).toEqual(["IGV"]);
    expect(considerationFunctions(igvRaiser)).toEqual([]);
  });

  it("a consideration member gets the consideration lane only", () => {
    expect(raisingFunctions(igvConsid)).toEqual([]);
    expect(considerationFunctions(igvConsid)).toEqual(["IGV"]);
  });

  it("an IGV member never sees IGT lanes, and vice versa", () => {
    expect(raisingFunctions(igvRaiser)).not.toContain("IGT");
    expect(considerationFunctions(igvConsid)).not.toContain("IGT");
    expect(raisingFunctions(igtVp)).not.toContain("IGV");
  });

  it("a VP gets BOTH sides of their own function", () => {
    expect(raisingFunctions(igtVp)).toEqual(["IGT"]);
    expect(considerationFunctions(igtVp)).toEqual(["IGT"]);
  });

  it("TM and F&L leadership read every lane; a B2C Director does not", () => {
    expect(seesEveryLane(tmVp)).toBe(true);
    expect(seesEveryLane(flVp)).toBe(true);
    expect(seesEveryLane(b2cDirector)).toBe(false);
    expect(seesEveryLane(igvRaiser)).toBe(false);
  });
});

describe("overseeing a lane never grants the right to WORK it", () => {
  it("TM's VP reads OGX dashboards but gets no sign-ups module", () => {
    expect(ogxLanes(tmVp)).toEqual(["OGT", "OGV"]);
    expect(ogxFunctions(tmVp)).toEqual([]); // the module gate stays shut
  });

  it("TM's VP reads consideration dashboards but gets no consideration module", () => {
    expect(considerationFunctions(tmVp).length).toBeGreaterThan(0);
    expect(hasConsiderationAccess(tmVp)).toBe(false);
  });
});

describe("the CV pool is IGT-only", () => {
  it("IGT sees it", () => expect(canSeeCvPool(igtVp)).toBe(true));
  it("an IGV consideration member does NOT — CVs are applicants' personal data", () => {
    expect(canSeeCvPool(igvConsid)).toBe(false);
    expect(canSeeCvPool(igvVp)).toBe(false);
  });
  it("a B2C Director does not", () => expect(canSeeCvPool(b2cDirector)).toBe(false));
});

describe("B2C / BD isolation", () => {
  it("a B2C Director never gains IGV/IGT consideration", () => {
    expect(considerationFunctions(b2cDirector)).toEqual([]);
    expect(hasConsiderationAccess(b2cDirector)).toBe(false);
  });

  it("a BD Director never gains IGV/IGT consideration", () => {
    expect(considerationFunctions(bdDirector)).toEqual([]);
  });

  it("a B2C leader's account scope covers B2C, not the raising products", () => {
    expect(scopeFunctions(b2cDirector)).toContain("B2C");
    expect(scopeFunctions(b2cDirector)).not.toContain("IGV");
    expect(scopeFunctions(b2cDirector)).not.toContain("IGT");
  });

  it("an IGV-only member cannot create IGT accounts", () => {
    const allowed = allowedAccountFunctions(igvRaiser);
    expect(allowed).toContain("IGV");
    expect(allowed).not.toContain("IGT");
  });
});

describe("admin is a capability, not a rank", () => {
  // v33.22, by the IM director's own call: Role = "Admin" is the caretaker
  // seat — Health, logs, the change journal — and NOT a key to the LC's data.
  it("a PURE Admin gets the tools and NOT the LC", () => {
    expect(canUseAdminTools(pureAdmin)).toBe(true);
    expect(accountScope(pureAdmin)).not.toEqual({ kind: "all" });
    expect(canSeeLcConcerns(pureAdmin)).toBe(false);
  });

  it("whoever LEADS IM has whole-LC access — it follows the job", () => {
    const imDirector = member({
      id: "im-dir", role: "Director", functions: ["IM"], sub_functions: [],
    });
    expect(accountScope(imDirector)).toEqual({ kind: "all" });
    expect(canSeeLcConcerns(imDirector)).toBe(true);
    // ...but a plain IM member is just a member
    const imMember = member({ id: "im-mem", role: "Member", functions: ["IM"] });
    expect(accountScope(imMember)).not.toEqual({ kind: "all" });
  });

  it("a VP who ALSO keeps the system running keeps only their own modules", () => {
    const vpAdmin = member({
      id: "vp-admin", role: "LCVP", functions: ["IGT"],
      sub_functions: ["Raising", "Consideration", "Admin"],
    });
    expect(canUseAdminTools(vpAdmin)).toBe(true); // tools: yes
    expect(accountScope(vpAdmin).kind).toBe("functions"); // whole LC: no
    expect(canEditAccount(vpAdmin, account({ function: "IGV" }))).toBe(false);
  });

  it("an ordinary member gets no admin tools", () => {
    expect(canUseAdminTools(igvRaiser)).toBe(false);
    expect(canUseAdminTools(igtVp)).toBe(false);
  });
});

describe("the private concerns inbox", () => {
  // v33.22: TM owns people, so the whole TM FUNCTION handles concerns — plus
  // the LCP and whoever leads IM. v33.31 REMOVED F&L's LCVP by the LCP's
  // request: every extra reader is one more person an anonymous author
  // didn't expect to be read by.
  it("is open to TM and the LCP", () => {
    expect(canSeeLcConcerns(lcp)).toBe(true);
    expect(canSeeLcConcerns(tmVp)).toBe(true);
    expect(
      canSeeLcConcerns(member({ id: "tm-mem", role: "Member", functions: ["TM"] }))
    ).toBe(true);
  });
  it("is closed to every other leader and member — F&L's LCVP included (v33.31)", () => {
    expect(canSeeLcConcerns(flVp)).toBe(false);
    expect(canSeeLcConcerns(igtVp)).toBe(false);
    expect(canSeeLcConcerns(b2cDirector)).toBe(false);
    expect(canSeeLcConcerns(igvRaiser)).toBe(false);
    expect(canSeeLcConcerns(pureAdmin)).toBe(false);
    // F&L below its LCVP has LCP-level DATA access but not the people inbox
    expect(
      canSeeLcConcerns(member({ id: "fl-mem", role: "Member", functions: ["F&L"] }))
    ).toBe(false);
  });
});

describe("custom calendar item scopes (v33.31)", () => {
  // the matrix the LCP specified — who a slot can be shared with
  it("a Member, Coordinator or TL reaches themselves, their team and their function", () => {
    for (const role of ["Member", "Coordinator", "Team Leader"] as const) {
      expect(
        calendarItemScopes(member({ id: `c-${role}`, role, functions: ["IGV"] }))
      ).toEqual(["self", "team", "function"]);
    }
  });
  it("an LCVP or Director gets no 'team' — their team IS the function", () => {
    expect(calendarItemScopes(igtVp)).toEqual(["self", "function"]);
    expect(calendarItemScopes(b2cDirector)).toEqual(["self", "function"]);
  });
  it("the LCP gets the EB and the LC, and has no function to share with", () => {
    expect(calendarItemScopes(lcp)).toEqual(["self", "eb", "lc"]);
  });
  it("TM reaches the whole LC — its remit is the LC's people", () => {
    const tmMember = member({ id: "tm-m", role: "Member", functions: ["TM"] });
    expect(calendarItemScopes(tmMember)).toContain("lc");
    expect(calendarItemScopes(tmMember)).toContain("function");
  });
  it("someone with no function is never offered one", () => {
    expect(
      calendarItemScopes(member({ id: "nofn", role: "Member", functions: [] }))
    ).toEqual(["self", "team"]);
  });
  it("an ordinary member can never share with the EB or the whole LC", () => {
    const scopes = calendarItemScopes(igvRaiser);
    expect(scopes).not.toContain("eb");
    expect(scopes).not.toContain("lc");
  });
});

describe("module gates", () => {
  it("a consideration-only member has no raising module", () => {
    expect(hasRaisingAccess(igvConsid)).toBe(false);
  });
  it("a raising member does", () => {
    expect(hasRaisingAccess(igvRaiser)).toBe(true);
  });
  it("an OGX member has OGX and not raising", () => {
    expect(ogxFunctions(ogvMm)).toEqual(["OGV"]);
    expect(hasRaisingAccess(ogvMm)).toBe(false);
  });
});

describe("regression guards for bugs found in this audit", () => {
  it("F-12: a member with no functions never gains scope", () => {
    const nobody = member({ role: "Member" });
    expect(accountScope(nobody)).toEqual({ kind: "members", ids: ["m1"] });
    expect(allowedAccountFunctions(nobody)).toEqual([]);
  });

  it("deactivating someone must not be the only thing standing between them and data", () => {
    // scope is computed from role/functions, so an inactive member with a live
    // session still resolves to their OWN ids only — never a wider scope
    const inactive = member({ ...igvRaiser, is_active: false });
    expect(accountScope(inactive)).toEqual({ kind: "members", ids: ["igv1"] });
  });
});

describe("F&L is LCP-level (v33.16, by the LCP's request)", () => {
  const fnl = member({ id: "fnl1", functions: ["F&L"], role: "Member" });

  it("sees and works the whole LC — every scope, lane and module", () => {
    expect(accountScope(fnl)).toEqual({ kind: "all" });
    expect(hasRaisingAccess(fnl)).toBe(true);
    expect(hasConsiderationAccess(fnl)).toBe(true);
    expect(ogxFunctions(fnl)).toEqual(["OGT", "OGV"]);
    expect(seesEveryLane(fnl)).toBe(true);
    expect(allowedAccountFunctions(fnl)).toEqual(["IGV", "IGT", "B2B", "BD", "B2C"]);
  });

  it("does NOT get the admin tools or the private concerns inbox", () => {
    expect(canUseAdminTools(fnl)).toBe(false);
    expect(canSeeLcConcerns(fnl)).toBe(false);
  });

  it("the grant keys off the FUNCTION column only — 'Finance' in subs is not F&L", () => {
    const financeSub = member({ id: "fin1", sub_functions: ["Finance"] });
    expect(accountScope(financeSub)).toEqual({ kind: "members", ids: ["fin1"] });
  });
});

describe("CIC second calls (v33.19)", () => {
  const ogvMember = member({
    id: "ogv1", role: "Member", functions: ["OGV"], sub_functions: ["OGX"],
  });
  const signup = (over: Partial<SignupRow> = {}): SignupRow =>
    ({
      id: "s1", fn: "OGV", assigned_to: "someone-else", status: null,
      out_of_process: false, cic_assigned_to: null,
      ...over,
    }) as SignupRow;

  it("the SECOND CALLER can open the sign-up handed to them", () => {
    // the row stays the FIRST assignee's, so canWorkSignup is false for the
    // second caller — without the cic clause they saw it in the queue and
    // couldn't open it
    const handed = signup({ cic_assigned_to: "ogv1" });
    expect(canViewSignup(ogvMember, handed)).toBe(true);
  });

  it("but a second caller still can't WORK the first call's fields", () => {
    const handed = signup({ cic_assigned_to: "ogv1" });
    expect(canWorkSignup(ogvMember, handed)).toBe(false);
  });

  it("someone else's CIC row stays invisible", () => {
    expect(canViewSignup(ogvMember, signup({ cic_assigned_to: "other" }))).toBe(false);
  });

  it("never crosses functions", () => {
    const ogtRow = signup({ fn: "OGT", cic_assigned_to: "ogv1" });
    expect(canViewSignup(ogvMember, ogtRow)).toBe(false);
  });
});
