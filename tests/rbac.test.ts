import { describe, it, expect } from "vitest";
import type { SignupRow } from "@/lib/types";
import {
  accountFnTargets,
  accountScope,
  allowedAccountFunctions,
  bookableTouchPointScopes,
  canBookTouchPoint,
  canCheckPodio,
  canEditAccount,
  canFilePdpFor,
  canReadPdp,
  canReassignAccount,
  canEditRequestState,
  canFilterUnassigned,
  canSeeCvPool,
  canSeeLcConcerns,
  canSeeUnassigned,
  canSeeUnownedPool,
  canEditAttendanceRowOf,
  canRecordAttendance,
  canUseMailboxTab,
  claimTargetFunction,
  preferB2bOverBd,
  raisingFunctionsOf,
  hasPodioAccess,
  hasTmAccess,
  calendarItemScopes,
  canUseAdminTools,
  canViewAccount,
  canViewSignup,
  canWorkSignup,
  considerationFunctions,
  hasConsiderationAccess,
  hasRaisingAccess,
  isClaimableAccount,
  isMm,
  leadsTeam,
  memberIsMm,
  ogxLanes,
  ogxFunctions,
  openTargetFunctions,
  openViewFunctions,
  raisingFunctions,
  scopeFunctions,
  seesEveryLane,
  worksIcxRaisingOrB2b,
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

const account = (
  over: Partial<{
    function: string | null;
    responsible_id: string | null;
    out_of_process: boolean;
  }> = {}
) => ({
  function: "IGV" as string | null,
  responsible_id: "someone-else" as string | null,
  out_of_process: false,
  ...over,
});

/** A ROW OF THE UNOWNED RESEARCH POOL (v36): nobody's, and carrying NO
 *  function at all — the shape 229 live accounts took in migration 0073.
 *  Nothing pinned this before, because every fixture in this file passed a
 *  concrete function string, so the whole pool was untested. */
const poolRow = (over: Partial<{ out_of_process: boolean }> = {}) =>
  account({ function: null, responsible_id: null, ...over });

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

  it("a plain MEMBER claims ONE, but never sees the POOL (v33.37)", () => {
    // the 1,300-row unowned pool stays a leader's distribution problem —
    // but claiming one account a Member personally researched takes nothing
    // from anyone (before this, the add-form told them "open it and take it"
    // about an account they could neither open nor take)
    expect(canSeeUnassigned(igvRaiser)).toBe(false);
    expect(isClaimableAccount(igvRaiser, account({ responsible_id: null }))).toBe(true);
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

  it("a TL working a MEMBER's account never takes it (v33.39 auto-claim)", () => {
    // logContact auto-assigns ONLY when nobody owns the row: a Team Leader
    // (or anyone) contacting an account that already belongs to one of their
    // members must leave the responsible exactly as it is
    expect(isClaimableAccount(tl, account({ responsible_id: "t1" }))).toBe(false);
    expect(isClaimableAccount(igvVp, account({ responsible_id: "igv1" }))).toBe(false);
    expect(isClaimableAccount(tl, account({ responsible_id: null }))).toBe(true);
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

/** THE FUNCTION-DEFAULTS WIDENING (v33.32, migration 0054).
 *
 *  A function's LCVP/Director can let a role READ their whole floor. It is the
 *  first thing in the engine that opens a scope from outside the role table,
 *  so these tests pin the two properties that make it safe: it grants READ and
 *  never WRITE, and it never leaves the function it was set on. */
describe("a leader opening their function to a role", () => {
  const openedMember = member({
    id: "igv9",
    functions: ["IGV"],
    sub_functions: ["Raising"],
    openViewFns: ["IGV"],
  });

  it("lets them OPEN a teammate's account in that function", () => {
    expect(canViewAccount(openedMember, account({ function: "IGV", responsible_id: "other" }))).toBe(true);
  });

  it("does NOT let them edit it — read is all that was granted", () => {
    expect(canEditAccount(openedMember, account({ function: "IGV", responsible_id: "other" }))).toBe(false);
  });

  it("does not leak into another function", () => {
    expect(canViewAccount(openedMember, account({ function: "IGT", responsible_id: "other" }))).toBe(false);
    expect(canViewAccount(openedMember, account({ function: "B2C", responsible_id: "other" }))).toBe(false);
  });

  it("leaves the account SCOPE — and so every list query — untouched", () => {
    expect(accountScope(openedMember)).toEqual({ kind: "members", ids: ["igv9"] });
  });

  it("hands the list query the opened function to widen the read with", () => {
    expect(openViewFunctions(openedMember)).toEqual(["IGV"]);
  });

  it("gives a leader nothing extra — their scope already covers the function", () => {
    expect(openViewFunctions(member({ ...igvVp, openViewFns: ["IGV"] } as Partial<Viewer>))).toEqual([]);
  });

  it("changes nothing at all for anyone whose leader hasn't opened it", () => {
    expect(canViewAccount(igvRaiser, account({ function: "IGV", responsible_id: "other" }))).toBe(false);
    expect(openViewFunctions(igvRaiser)).toEqual([]);
  });
});

describe("cross-function attendance — authority follows the MEMBER (v33.40)", () => {
  // an IGV function meeting that INVITED the IGT function
  const tp = {
    scope: "function" as const,
    function_key: "IGV",
    team_name: null,
    owner_id: "vp-igv",
    invited_functions: ["IGT"],
  };
  const igtMember = { id: "x-igt", functions: ["IGT", "Raising"] };
  const igvMember = { id: "x-igv", functions: ["IGV", "Raising"] };

  it("the invited function's VP can open the sheet — and only their slice", () => {
    expect(canRecordAttendance(igtVp, tp)).toBe(true);
    expect(canEditAttendanceRowOf(igtVp, tp, igtMember)).toBe(true);
    expect(canEditAttendanceRowOf(igtVp, tp, igvMember)).toBe(false);
  });

  it("the booking function's crew never fills the invited function's rows", () => {
    expect(canEditAttendanceRowOf(igvVp, tp, igvMember)).toBe(true);
    expect(canEditAttendanceRowOf(igvVp, tp, igtMember)).toBe(false);
    expect(canEditAttendanceRowOf(tl, tp, igtMember)).toBe(false);
  });

  it("a function with no invitation stays off the sheet entirely", () => {
    const uninvited = { ...tp, invited_functions: [] };
    expect(canRecordAttendance(igtVp, uninvited)).toBe(false);
  });

  it("nobody marks themself — the per-row check keeps the LCP's rule", () => {
    expect(
      canEditAttendanceRowOf(igvVp, tp, { id: "vp-igv", functions: ["IGV"] })
    ).toBe(false);
  });

  it("TM core and the LCP keep the whole sheet", () => {
    expect(canEditAttendanceRowOf(lcp, tp, igtMember)).toBe(true);
    expect(canEditAttendanceRowOf(tmVp, tp, igvMember)).toBe(true);
  });
});

describe("the Emails tab belongs to everyone (v33.41)", () => {
  it("a plain member may write from the LC's stationery", () => {
    // the letter still goes out from their OWN Gmail — what they gain is the
    // signature and a starting point, not reach they didn't have
    expect(canUseMailboxTab(igvRaiser)).toBe(true);
    expect(canUseMailboxTab(ogvMm)).toBe(true);
    expect(canUseMailboxTab(lcp)).toBe(true);
  });
});

/** THE UNOWNED POOL CARRIES NO FUNCTION (v36, migration 0073).
 *
 *  Everything above passed a concrete function string, so the pool — 229 live
 *  rows of imported market research — was the one shape the engine had never
 *  been asked about. These pin both halves: a function-less row is still
 *  reachable by the people who distribute it, and it never sneaks through a
 *  test that was written assuming a function is there. */
describe("a row nobody owns and nobody has labelled", () => {
  const igvTl = member({ id: "tl-igv", role: "Team Leader", functions: ["IGV"], sub_functions: ["Raising"] });
  const b2cMember = member({ id: "b2c1", role: "Member", functions: ["B2C"], sub_functions: ["B2C"] });

  it("a VP can still open and work it — a function scope matches no function", () => {
    // the regression this guards: `accountScope` hands a leader a LIST OF
    // FUNCTIONS, and an unowned row belongs to none of them. Before the claim
    // check was hoisted above that branch, the people whose job is to hand the
    // pool out were the only ones locked out of it.
    expect(canViewAccount(igvVp, poolRow())).toBe(true);
    expect(canEditAccount(igvVp, poolRow())).toBe(true);
    expect(canReassignAccount(igvVp, poolRow())).toBe(true);
  });

  it("an MM and a plain Member can each still take one", () => {
    expect(isClaimableAccount(igvTl, poolRow())).toBe(true);
    expect(isClaimableAccount(igvRaiser, poolRow())).toBe(true);
    expect(canEditAccount(igvRaiser, poolRow())).toBe(true);
  });

  it("claiming it STAMPS THE CLAIMER'S function — there is none to keep", () => {
    expect(claimTargetFunction(igvRaiser, poolRow())).toBe("IGV");
    expect(claimTargetFunction(igtVp, poolRow())).toBe("IGT");
    expect(claimTargetFunction(b2cMember, poolRow())).toBe("B2C");
    // somebody who may create nothing claims nothing
    expect(claimTargetFunction(ogvMm, poolRow())).toBe(null);
  });

  // v36.2 — "when an unassigned account is assigned to a B2B and BD user,
  // make it B2B, not BD". The sheet lists the pair in either order, and 50
  // pool accounts handed to one "BD, B2B" member all landed in BD.
  it("somebody in B2B AND BD claims into B2B, in whichever order the sheet lists them", () => {
    const bdFirst = member({ id: "dual1", functions: ["BD", "B2B"], sub_functions: [] });
    const b2bFirst = member({ id: "dual2", functions: ["B2B", "BD"], sub_functions: [] });
    expect(claimTargetFunction(bdFirst, poolRow())).toBe("B2B");
    expect(claimTargetFunction(b2bFirst, poolRow())).toBe("B2B");
    expect(claimTargetFunction(bdDirector, poolRow())).toBe("B2B");
  });

  it("a hand-out to them lands in B2B too — B2B always comes before BD", () => {
    expect(raisingFunctionsOf({ functions: ["BD", "B2B"], sub_functions: [] })[0]).toBe("B2B");
    expect(raisingFunctionsOf({ functions: [], sub_functions: ["BD", "B2B"] })[0]).toBe("B2B");
    // nothing else about the order moves: a primary IGV stays first
    expect(raisingFunctionsOf({ functions: ["IGV", "BD", "B2B"], sub_functions: [] })).toEqual(["IGV", "B2B", "BD"]);
    // and somebody who only does BD still lands in BD
    expect(raisingFunctionsOf({ functions: ["BD"], sub_functions: [] })).toEqual(["BD"]);
    expect(preferB2bOverBd(["BD", "B2C", "B2B"])).toEqual(["B2B", "BD", "B2C"]);
  });

  it("owned accounts are untouched by the hoisted claim check", () => {
    // the claim path can only ever fire on a row with no responsible, so no
    // owned account changed hands as a side effect of making the pool visible
    expect(canEditAccount(igtVp, account({ function: "IGV" }))).toBe(false);
    expect(canEditAccount(igvRaiser, account({ responsible_id: "other" }))).toBe(false);
    expect(canReassignAccount(igvRaiser, account({ responsible_id: "other" }))).toBe(false);
  });

  it("has nothing to relabel, no product to raise for and no Podio errand", () => {
    expect(accountFnTargets(igvVp, poolRow())).toEqual([]);
    expect(openTargetFunctions({ function: null })).toEqual([]);
    // v34.1's rule, carried over: nobody submits a name nobody has been given
    expect(canCheckPodio(igvTl, poolRow())).toBe(false);
  });

  it("an ARCHIVED unowned row stays out of everything", () => {
    expect(isClaimableAccount(igvTl, poolRow({ out_of_process: true }))).toBe(false);
    expect(canEditAccount(igvRaiser, poolRow({ out_of_process: true }))).toBe(false);
  });
});

describe("who sees the unowned pool (v36 — ask #9)", () => {
  const igvTl = member({ id: "tl-igv", role: "Team Leader", functions: ["IGV"], sub_functions: ["Raising"] });
  const igvCoord = member({ id: "co-igv", role: "Coordinator", functions: ["IGV"], sub_functions: ["Raising"] });
  const b2bTl = member({ id: "tl-b2b", role: "Team Leader", functions: ["B2B", "BD"], sub_functions: ["BD"] });
  const b2cCoord = member({ id: "co-b2c", role: "Coordinator", functions: ["B2C"], sub_functions: ["B2C"] });

  it("MMs and the ICX/B2B leaders do", () => {
    expect(canSeeUnownedPool(igvTl)).toBe(true);
    expect(canSeeUnownedPool(igvCoord)).toBe(true);
    expect(canSeeUnownedPool(b2bTl)).toBe(true);
    expect(canSeeUnownedPool(igvVp)).toBe(true);
    expect(canSeeUnownedPool(bdDirector)).toBe(true);
    expect(canSeeUnownedPool(lcp)).toBe(true);
  });

  it("plain Members never do — the pool is a distribution problem", () => {
    expect(canSeeUnownedPool(igvRaiser)).toBe(false);
  });

  it("B2C never does — its accounts are a different world (v23.2)", () => {
    // an unowned row is ICX market research; B2C sells courses and events and
    // has never had one, so putting the queue in front of them is only noise
    expect(canSeeUnownedPool(b2cDirector)).toBe(false);
    expect(canSeeUnownedPool(b2cCoord)).toBe(false);
  });

  it("neither does a consideration-only member or an OGX MM", () => {
    expect(canSeeUnownedPool(igvConsid)).toBe(false);
    expect(canSeeUnownedPool(ogvMm)).toBe(false);
  });

  it("the older name is the SAME rule, so the two can never drift", () => {
    for (const v of [igvTl, igvCoord, igvVp, igvRaiser, b2cDirector, lcp]) {
      expect(canSeeUnassigned(v)).toBe(canSeeUnownedPool(v));
      expect(canFilterUnassigned(v)).toBe(canSeeUnownedPool(v));
    }
  });

  it("names the crews who share the research", () => {
    expect(worksIcxRaisingOrB2b(igvRaiser)).toBe(true);
    expect(worksIcxRaisingOrB2b(igtVp)).toBe(true);   // a leader owns both sides
    expect(worksIcxRaisingOrB2b(bdDirector)).toBe(true);
    expect(worksIcxRaisingOrB2b(igvConsid)).toBe(false); // they work LCs, not companies
    expect(worksIcxRaisingOrB2b(b2cDirector)).toBe(false);
    expect(worksIcxRaisingOrB2b(ogvMm)).toBe(false);
  });
});

/** A COORDINATOR IS AN MM WITH NO TEAM (v36, ask #6).
 *
 *  The product owner's ruling, verbatim: "Exists on the report as MM too but
 *  with no team, cant book touch points." Two questions that used to be one. */
describe("Coordinators", () => {
  const coord = member({ id: "co", role: "Coordinator", functions: ["IGV"], sub_functions: ["Raising"] });

  it("IS an MM — and is counted as one wherever MMs are counted", () => {
    expect(isMm(coord)).toBe(true);
    expect(memberIsMm({ role: "Coordinator" })).toBe(true);
    expect(isMm(tl)).toBe(true);
    expect(memberIsMm({ role: "Team Leader" })).toBe(true);
  });

  it("is not something anyone else is", () => {
    for (const v of [igvRaiser, igvVp, b2cDirector, lcp, pureAdmin]) {
      expect(isMm(v)).toBe(false);
    }
  });

  it("NEVER leads a team — no team card, no rollup, no leaderboard row", () => {
    expect(leadsTeam(coord)).toBe(false);
    expect(leadsTeam(tl)).toBe(true);
    // a leader's team IS the function; they lead no team in this sense
    expect(leadsTeam(igvVp)).toBe(false);
    expect(leadsTeam(lcp)).toBe(false);
  });

  it("a Team Leader with nobody under them still leads a team (the SEAT)", () => {
    // two of the LC's fourteen TLs have no reports today; emptiness is a
    // different question, asked with teamMemberIds.length
    const emptyTl = member({ id: "tl-empty", role: "Team Leader", functions: ["OGT"], teamMemberIds: [] });
    expect(leadsTeam(emptyTl)).toBe(true);
  });

  it("BOOKS NO TOUCH POINT — deliberately, because there is no team to book for", () => {
    expect(bookableTouchPointScopes(coord)).toEqual([]);
    expect(canBookTouchPoint(coord, "team")).toBe(false);
    expect(canBookTouchPoint(coord, "function")).toBe(false);
    expect(canBookTouchPoint(coord, "lc")).toBe(false);
    // …while the Team Leader beside them keeps exactly their one scope
    expect(bookableTouchPointScopes(tl)).toEqual(["team"]);
  });

  it("but a Coordinator inside TM is TM CORE, and books the LC's points", () => {
    // the exception that already existed and must survive the rule above:
    // TM's Coordinator runs LC sessions, which is not their own team
    const tmCoord = member({ id: "co-tm", role: "Coordinator", functions: ["TM"], sub_functions: ["TM"] });
    expect(bookableTouchPointScopes(tmCoord)).toEqual(["lc"]);
  });
});

/** THE PDP / O2O PERMISSIONS (v36, ask #3).
 *
 *  A PDP is a leader writing down what they and one of their people agreed
 *  about that person's month. Who may WRITE one and who may READ one are
 *  different questions, and both are narrower than they look. */
describe("filing a PDP", () => {
  const vp = member({ id: "vp", role: "LCVP", functions: ["IGV"], sub_functions: ["Raising"] });
  const mm = member({ id: "mm", role: "Team Leader", functions: ["IGV"], sub_functions: ["Raising"], stakeholder_id: "vp" });
  const memberOfMm = member({ id: "mem", role: "Member", functions: ["IGV"], sub_functions: ["Raising"], stakeholder_id: "mm" });
  const otherMm = member({ id: "mm2", role: "Team Leader", functions: ["IGT"], sub_functions: ["Raising"], stakeholder_id: "vp" });

  it("the cascade: a VP files for their MMs, an MM for their own members", () => {
    expect(canFilePdpFor(vp, mm)).toBe(true);
    expect(canFilePdpFor(mm, memberOfMm)).toBe(true);
  });

  it("nobody files for somebody else's person", () => {
    expect(canFilePdpFor(otherMm, memberOfMm)).toBe(false);
    expect(canFilePdpFor(memberOfMm, mm)).toBe(false);
    // the VP is the MM's leader, not the member's — the cascade has one step
    expect(canFilePdpFor(vp, memberOfMm)).toBe(false);
  });

  it("NOBODY files their own, whatever their rank", () => {
    // a PDP is a conversation somebody else holds with you; a self-filed one
    // would let a leader tick their own box while their people wait
    expect(canFilePdpFor(mm, mm)).toBe(false);
    expect(canFilePdpFor(lcp, lcp)).toBe(false);
    expect(canFilePdpFor(tmVp, tmVp)).toBe(false);
  });

  it("TM and the LCP can file for anyone — they own the process", () => {
    expect(canFilePdpFor(tmVp, memberOfMm)).toBe(true);
    expect(canFilePdpFor(lcp, mm)).toBe(true);
  });

  it("F&L's LCP-level data access does NOT reach people's plans", () => {
    const fnl = member({ id: "fnl1", role: "Member", functions: ["F&L"] });
    expect(accountScope(fnl)).toEqual({ kind: "all" }); // every account, still
    expect(canFilePdpFor(fnl, memberOfMm)).toBe(false); // and none of this
  });
});

describe("reading a PDP", () => {
  // filed by the MM (author) for their member (subject); the MM answers to a VP
  const read = (v: Viewer) => canReadPdp(v, "mem", "mm", "mm", "vp");
  const vp = member({ id: "vp", role: "LCVP", functions: ["IGV"], sub_functions: ["Raising"] });
  const mm = member({ id: "mm", role: "Team Leader", functions: ["IGV"], sub_functions: ["Raising"] });
  const subject = member({ id: "mem", role: "Member", functions: ["IGV"], sub_functions: ["Raising"] });

  it("the member, their leader and that leader's leader", () => {
    expect(read(subject)).toBe(true);
    expect(read(mm)).toBe(true);
    expect(read(vp)).toBe(true);
  });

  it("a re-parented member's NEW manager reads it even if they didn't write it", () => {
    // the author left mid-cycle and somebody else picked the person up: the
    // plan is still the member's, and their leader has to be able to read it
    const newMm = member({ id: "mm-new", role: "Team Leader", functions: ["IGV"] });
    expect(canReadPdp(newMm, "mem", "old-author", "mm-new", null)).toBe(true);
  });

  it("nobody else in the LC — not a teammate, not another function's VP", () => {
    expect(read(igvRaiser)).toBe(false);
    expect(read(igtVp)).toBe(false);
    expect(read(b2cDirector)).toBe(false);
    expect(read(pureAdmin)).toBe(false);
  });

  it("TM's crew and the LCP, and DELIBERATELY NOT every TM member", () => {
    // hasTmAccess opens the members DIRECTORY to the whole function, which is
    // right for names and KPIs and wrong for someone's own account of what
    // they are struggling with
    expect(read(tmVp)).toBe(true);
    expect(read(lcp)).toBe(true);
    const tmMember = member({ id: "tm-mem", role: "Member", functions: ["TM"] });
    expect(hasTmAccess(tmMember)).toBe(true);
    expect(read(tmMember)).toBe(false);
    const tmCoord = member({ id: "tm-co", role: "Coordinator", functions: ["TM"] });
    expect(read(tmCoord)).toBe(true);
  });

  it("F&L reads every account in the LC and none of its PDPs (v33.31's line)", () => {
    expect(read(flVp)).toBe(false);
    expect(read(member({ id: "fnl2", role: "Member", functions: ["F&L"] }))).toBe(false);
  });
});
