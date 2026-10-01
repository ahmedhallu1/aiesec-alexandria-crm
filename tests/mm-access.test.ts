import { describe, it, expect } from "vitest";
import type { SignupRow } from "@/lib/types";
import {
  accountScope, actsOverOthers, canEditAccount, canReassignAccount, canWorkSignup, reachIds,
  type Viewer,
} from "@/lib/rbac";
import {
  defaultMmAccess, inMmAccessFloor, mmAccessFunctionsOf, mmAccessKey, resolveMmAccessMap,
  resolveMmReach,
} from "@/lib/mm-access";
import { functionDefaults, resolveFunctionSettings } from "@/lib/function-settings";
import { b2cAssignPlan, b2cCallUnrecorded, currentB2cCall } from "@/lib/b2c-cic";

const v = (over: Partial<Viewer> = {}): Viewer =>
  ({
    id: "mm", name: "MM", nickname: null, email: null, phone: null,
    functions: ["IGV"], sub_functions: ["Raising"], role: "Team Leader",
    stakeholder_name: null, stakeholder_id: null, team_name: null, is_active: true,
    google_refresh_token: null, isAdmin: false, teamMemberIds: ["t1", "t2"], ...over,
  }) as Viewer;
const acct = (responsible_id: string) => ({ function: "IGV", responsible_id, out_of_process: false });
const signup = (assigned_to: string) =>
  ({ fn: "OGV", assigned_to, cic_assigned_to: null }) as unknown as SignupRow;

/** NOTHING SET = EXACTLY THE OLD ROLE RULE (v37.4). An LC that never opens
 *  the MM-access card must not notice it exists. */
describe("MM access defaults", () => {
  it("a Team Leader reaches their team, a Coordinator nobody", () => {
    expect(reachIds(v())).toEqual(["t1", "t2"]);
    expect(reachIds(v({ role: "Coordinator", teamMemberIds: [] }))).toEqual([]);
    expect(defaultMmAccess("Team Leader")).toBe("team");
    expect(defaultMmAccess("Coordinator")).toBe("none");
  });
  it("a plain Member reaches nobody even if a stray reach is attached", () => {
    expect(reachIds(v({ role: "Member", reachMemberIds: ["x"] }))).toEqual([]);
  });
  it("keeps the old account scope for both seats", () => {
    expect(accountScope(v())).toEqual({ kind: "members", ids: ["mm", "t1", "t2"] });
    expect(accountScope(v({ role: "Coordinator", teamMemberIds: [] }))).toEqual({
      kind: "members", ids: ["mm"],
    });
  });
  it("a default Coordinator still cannot hand over even their own account", () => {
    const c = v({ role: "Coordinator", teamMemberIds: [] });
    expect(actsOverOthers(c)).toBe(false);
    expect(canReassignAccount(c, acct("mm"))).toBe(false);
  });
  it("function settings start with no overrides", () => {
    expect(functionDefaults("IGV").mmAccess).toEqual({});
  });
});

describe("what the VP sets is what the MM gets", () => {
  it("'only themself' turns a Team Leader into a Coordinator for access", () => {
    const tl = v({ reachMemberIds: [] });
    expect(accountScope(tl)).toEqual({ kind: "members", ids: ["mm"] });
    expect(canEditAccount(tl, acct("t1"))).toBe(false);
    expect(canReassignAccount(tl, acct("t1"))).toBe(false);
    expect(canWorkSignup({ ...tl, functions: ["OGV"] }, signup("t1"))).toBe(false);
  });
  it("'whole function' lets a Coordinator work the floor", () => {
    const c = v({ role: "Coordinator", teamMemberIds: [], reachMemberIds: ["a", "b"] });
    expect(canEditAccount(c, acct("a"))).toBe(true);
    expect(canReassignAccount(c, acct("b"))).toBe(true);
    expect(canEditAccount(c, acct("stranger"))).toBe(false);
    expect(canWorkSignup({ ...c, functions: ["OGV"] }, signup("a"))).toBe(true);
  });
  it("a Team Leader widened to the function keeps every reach id", () => {
    const tl = v({ reachMemberIds: ["t1", "t2", "x", "y"] });
    expect(canEditAccount(tl, acct("y"))).toBe(true);
  });
});

describe("resolving the reach from stored maps", () => {
  const tl = { id: "mm", role: "Team Leader", functions: ["IGV"], sub_functions: ["Raising"] };
  it("is null (role rule) when nothing was set", () => {
    expect(resolveMmReach(tl, {})).toBeNull();
    expect(resolveMmReach(tl, { IGV: { other: "function" } })).toBeNull();
  });
  it("is null for anyone who isn't an MM", () => {
    expect(resolveMmReach({ ...tl, role: "Member" }, { IGV: { mm: "function" } })).toBeNull();
    expect(resolveMmReach({ ...tl, role: "LCVP" }, { IGV: { mm: "function" } })).toBeNull();
  });
  it("reads each mode", () => {
    expect(resolveMmReach(tl, { IGV: { mm: "team" } })).toEqual({ team: true, functions: [] });
    expect(resolveMmReach(tl, { IGV: { mm: "function" } })).toEqual({ team: false, functions: ["IGV"] });
    expect(resolveMmReach(tl, { IGV: { mm: "none" } })).toEqual({ team: false, functions: [] });
  });
  it("an explicit 'none' is not undone by another function's untouched default", () => {
    const dual = { ...tl, functions: ["IGV", "IGT"] };
    expect(resolveMmReach(dual, { IGV: { mm: "none" } })).toEqual({ team: false, functions: [] });
  });
  it("stores B2B and BD once, under B2B", () => {
    expect(mmAccessKey("BD")).toBe("B2B");
    expect(mmAccessFunctionsOf({ functions: ["BD"], sub_functions: [] })).toEqual(["B2B"]);
    const bd = { id: "mm", role: "Coordinator", functions: ["BD"], sub_functions: [] };
    expect(resolveMmReach(bd, { B2B: { mm: "function" } })?.functions).toEqual(["B2B"]);
  });
  it("leaves the function's leaders and other functions off the floor", () => {
    expect(inMmAccessFloor({ id: "a", role: "Member", functions: ["IGV"] }, "IGV")).toBe(true);
    expect(inMmAccessFloor({ id: "a", role: "LCVP", functions: ["IGV"] }, "IGV")).toBe(false);
    expect(inMmAccessFloor({ id: "a", role: "Member", functions: ["IGT"] }, "IGV")).toBe(false);
    expect(inMmAccessFloor({ id: "a", role: "Member", functions: ["TM"] }, "TM")).toBe(false);
  });
  it("never trusts a malformed stored map", () => {
    expect(resolveMmAccessMap({ "0b9b5c1e-1111-4222-8333-444455556666": "function", x: "team", bad: 1 }))
      .toEqual({ "0b9b5c1e-1111-4222-8333-444455556666": "function" });
    expect(resolveMmAccessMap(["team"])).toEqual({});
    expect(resolveFunctionSettings("IGV", { mmAccess: "nope" }).mmAccess).toEqual({});
  });
});

/** THE B2C CIC LOOP (v37.4): the caller and the outcome cancelled each other. */
describe("B2C CIC — the call on screen is the latest one", () => {
  const recorded = { side: "B2C", caller_id: "salma", outcome: "out_of_service", contact_status: "No" };
  const blank = { side: "B2C", caller_id: "salma", outcome: null, contact_status: null };
  it("a recorded call stays the current call (the caller cell keeps its name)", () => {
    expect(currentB2cCall([recorded])).toBe(recorded);
    expect(b2cCallUnrecorded(recorded)).toBe(false);
  });
  it("ignores the OGX second call", () => {
    const ogx = { side: "OGX", caller_id: "x", outcome: null, contact_status: null };
    expect(currentB2cCall([ogx, recorded])).toBe(recorded);
  });
  it("re-picking the same caller after an outcome creates nothing", () => {
    expect(b2cAssignPlan(recorded, "salma")).toBe("noop");
    expect(b2cAssignPlan(blank, "salma")).toBe("noop");
  });
  it("a blank call is handed over, a recorded one starts a new call for someone else", () => {
    expect(b2cAssignPlan(blank, "ali")).toBe("handover");
    expect(b2cAssignPlan(recorded, "ali")).toBe("new");
    expect(b2cAssignPlan(null, "ali")).toBe("new");
  });
});
