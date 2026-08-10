import { describe, it, expect } from "vitest";
import {
  functionDefaults, isSettableFunction, opensViewTo, resolveFunctionSettings,
  settingGroupsFor, SETTABLE_FUNCTIONS,
} from "../src/lib/function-settings";
import { emailDomainIssue } from "../src/lib/email-check";

/** THE DEFAULTS MUST REPRODUCE WHAT SHIPPED BEFORE 0054 (v33.32). An LC that
 *  never opens the Function-defaults card must not notice it exists. */
describe("function defaults", () => {
  it("keeps createAccount's old Podio rule exactly", () => {
    for (const fn of ["IGV", "B2C", "BD"])
      expect(functionDefaults(fn).podioUpdateDefault).toBe(true);
    for (const fn of ["IGT", "B2B"])
      expect(functionDefaults(fn).podioUpdateDefault).toBe(false);
  });

  it("keeps the 14-day cadence and every behaviour switched on", () => {
    const d = functionDefaults("IGV");
    expect(d.podioUpdateDays).toBe(14);
    expect(d.poolClaimOpen).toBe(true);
    expect(d.cicEnabled).toBe(true);
    expect(d.streakNags).toBe(true);
    expect(d.attendanceReminders).toBe(true);
    expect(d.workingHoursAuto).toBe(true);
    expect(d.workingHoursJudged).toBe(true);
    expect(d.referralsBy).toBe("everyone");
  });

  it("opens nothing to anyone until a leader says so", () => {
    const d = functionDefaults("IGT");
    for (const role of ["Member", "Coordinator", "Team Leader", "LCVP", "LCP"])
      expect(opensViewTo(d, role)).toBe(false);
  });

  it("opens exactly the role the leader switched on, and no other", () => {
    const s = resolveFunctionSettings("IGV", { seeAllMembers: true });
    expect(opensViewTo(s, "Member")).toBe(true);
    expect(opensViewTo(s, "Coordinator")).toBe(false);
    expect(opensViewTo(s, "Team Leader")).toBe(false);
  });
});

describe("stored settings are merged, never trusted", () => {
  it("falls back to the default for a missing or malformed key", () => {
    const s = resolveFunctionSettings("IGV", { podioUpdateDefault: "yes", cicEnabled: 0 });
    expect(s.podioUpdateDefault).toBe(true); // IGV's default, not the string
    expect(s.cicEnabled).toBe(true);
  });

  it("refuses an out-of-range cadence", () => {
    expect(resolveFunctionSettings("IGV", { podioUpdateDays: 0 }).podioUpdateDays).toBe(14);
    expect(resolveFunctionSettings("IGV", { podioUpdateDays: 91 }).podioUpdateDays).toBe(14);
    expect(resolveFunctionSettings("IGV", { podioUpdateDays: 7 }).podioUpdateDays).toBe(7);
    expect(resolveFunctionSettings("IGV", { podioUpdateDays: "30" }).podioUpdateDays).toBe(30);
  });

  it("survives a row that isn't an object at all", () => {
    expect(resolveFunctionSettings("IGV", null).podioUpdateDays).toBe(14);
    expect(resolveFunctionSettings("IGV", "nonsense").podioUpdateDays).toBe(14);
  });

  it("only accepts the two referral audiences", () => {
    expect(resolveFunctionSettings("OGV", { referralsBy: "mms" }).referralsBy).toBe("mms");
    expect(resolveFunctionSettings("OGV", { referralsBy: "nobody" }).referralsBy).toBe("everyone");
  });
});

describe("each function is offered only the switches it can act on", () => {
  it("gives raising functions accounts + visibility, never OGX or TM", () => {
    const g = settingGroupsFor("IGV");
    expect(g.accounts).toBe(true);
    expect(g.visibility).toBe(true);
    expect(g.ogx).toBe(false);
    expect(g.tm).toBe(false);
  });

  it("gives OGX its own group and no Podio cadence", () => {
    const g = settingGroupsFor("OGT");
    expect(g.accounts).toBe(false);
    expect(g.ogx).toBe(true);
    expect(g.visibility).toBe(true);
  });

  it("gives TM only the attendance group", () => {
    const g = settingGroupsFor("TM");
    expect(g.tm).toBe(true);
    expect(g.accounts).toBe(false);
    expect(g.ogx).toBe(false);
  });

  it("recognises every settable function and nothing else", () => {
    for (const fn of SETTABLE_FUNCTIONS) expect(isSettableFunction(fn)).toBe(true);
    expect(isSettableFunction("F&L")).toBe(false);
    expect(isSettableFunction("")).toBe(false);
  });
});

/** THE PRE-BOOKING EMAIL CHECK (v33.32). Only the rules that can be decided
 *  WITHOUT a network call are asserted here — the MX lookup fails open by
 *  design and is not something a test should depend on. */
describe("email addresses we can prove are wrong", () => {
  it("refuses a shape that is not an address", async () => {
    expect(await emailDomainIssue("nodomain")).toBeTruthy();
    expect(await emailDomainIssue(".lead@gmail.com")).toBeTruthy();
    expect(await emailDomainIssue("trail.@gmail.com")).toBeTruthy();
    expect(await emailDomainIssue("double..dot@gmail.com")).toBeTruthy();
    expect(await emailDomainIssue("someone@no-tld")).toBeTruthy();
  });

  it("names the typo it recognises", async () => {
    const issue = await emailDomainIssue("someone@gamil.com");
    expect(issue).toContain("gmail.com");
  });

  it("applies Gmail's own username rules — those mailboxes cannot exist", async () => {
    expect(await emailDomainIssue("a.b@gmail.com")).toBeTruthy(); // under 6 chars
    expect(await emailDomainIssue("with-dash@gmail.com")).toBeTruthy(); // illegal char
    expect(
      await emailDomainIssue("thisusernameisfartoolongforgmailtoaccept@gmail.com")
    ).toBeTruthy();
  });

  it("refuses burner mail — an IR we can never reach again", async () => {
    expect(await emailDomainIssue("someone@mailinator.com")).toBeTruthy();
  });

  it("lets a legitimate Gmail and an AIESEC address through the offline rules", async () => {
    // these still hit DNS, which fails OPEN — so the assertion is that no
    // offline rule rejected them
    expect(await emailDomainIssue("yomna.eldeeb@gmail.com")).toBeNull();
    expect(await emailDomainIssue("someone@aiesec.net")).toBeNull();
  });
});
