import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  PRIVILEGE_GROUPS, PRIVILEGE_REGISTRY, describePrivilege, privilegeAllowed,
  privilegeFromRow, privilegeIsDefault, privilegeOverride, privilegeOverridesFor,
  type PrivilegeRule, type PrivilegeWho,
} from "@/lib/privileges";
import {
  canDeleteWorkedAccount, canHandOverIrCalls, canImportAccounts, canLogDirectVisit,
  canManageArchive, canManagePartnerLcs, canManageTeamIrCalls, canPurgeArchive,
  canReassignAccount, canRecordPastIrCall, canSeeUnownedPool, canSplitDealOpens,
  canWorkArchived, priv, type Viewer,
} from "@/lib/rbac";

/** THE RULE MANAGER (v38.4) — Settings → Rules.
 *
 *  Two things are pinned here, and they are the two ways this feature can
 *  quietly stop being true:
 *
 *   1. the PRECEDENCE a rule resolves by (a named person beats a group, deny
 *      beats allow, the base decides the rest) — the same order the tab
 *      rules use, because two permission screens that disagree is a trap;
 *   2. that every key in the registry is actually WIRED — a switch in the
 *      LCP's settings that changes nothing is worse than no switch at all.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const rule = (over: Partial<PrivilegeRule> = {}): PrivilegeRule => ({
  ...privilegeFromRow({ key: "archive.revive" }),
  ...over,
});

const who: PrivilegeWho = { id: "m1", role: "Member", functions: ["IGV"], sub_functions: [] };

const member = (over: Partial<Viewer> = {}): Viewer =>
  ({
    id: "m1",
    name: "Test Member",
    email: "test@aiesec.net",
    functions: ["IGV"],
    sub_functions: ["Raising"],
    role: "Member",
    is_active: true,
    isAdmin: false,
    teamMemberIds: [],
    ...over,
  }) as Viewer;

const archived = { function: "IGV" as string | null, responsible_id: "x", out_of_process: true };

describe("privilege rules — resolution", () => {
  it("no rule, or an untouched one, leaves the code in charge", () => {
    expect(privilegeOverride(undefined, who)).toBeNull();
    expect(privilegeOverride(rule(), who)).toBeNull();
    expect(privilegeAllowed(true, null)).toBe(true);
    expect(privilegeAllowed(false, null)).toBe(false);
    expect(privilegeIsDefault(undefined)).toBe(true);
    expect(privilegeIsDefault(rule())).toBe(true);
  });

  it("base everyone / nobody", () => {
    expect(privilegeOverride(rule({ base: "everyone" }), who)).toBe("allow");
    expect(privilegeOverride(rule({ base: "nobody" }), who)).toBe("deny");
    expect(privilegeAllowed(false, "allow")).toBe(true);
    expect(privilegeAllowed(true, "deny")).toBe(false);
  });

  it("a named person beats their role and their function, both ways", () => {
    expect(
      privilegeOverride(
        rule({
          deny: { members: [], roles: ["Member"], functions: [] },
          allow: { members: ["m1"], roles: [], functions: [] },
        }),
        who
      )
    ).toBe("allow");
    expect(
      privilegeOverride(
        rule({
          allow: { members: [], roles: [], functions: ["IGV"] },
          deny: { members: ["m1"], roles: [], functions: [] },
        }),
        who
      )
    ).toBe("deny");
  });

  it("on the same level, not-allowed wins", () => {
    const r = rule({
      allow: { members: [], roles: ["Member"], functions: [] },
      deny: { members: [], roles: ["Member"], functions: [] },
    });
    expect(privilegeOverride(r, who)).toBe("deny");
  });

  it("a sub-function counts as a function", () => {
    const r = rule({ allow: { members: [], roles: [], functions: ["Raising"] } });
    const raiser: PrivilegeWho = { ...who, functions: ["IGV"], sub_functions: ["Raising"] };
    expect(privilegeOverride(r, raiser)).toBe("allow");
    expect(privilegeOverride(r, who)).toBeNull();
  });

  it("a rule for a privilege that no longer exists can never change anything", () => {
    const ghost = rule({ key: "something.removed", base: "everyone" });
    expect(privilegeOverride(ghost, who)).toBeNull();
    expect(privilegeOverridesFor([ghost], who)).toEqual({});
  });

  it("a row with junk in it falls to safe values", () => {
    const r = privilegeFromRow({
      key: "archive.revive",
      base: "whatever",
      allow_to: "nonsense",
      deny_from: { roles: [1, "", "Member"] },
      note: "   ",
    });
    expect(r.base).toBe("default");
    expect(r.allow).toEqual({ members: [], roles: [], functions: [] });
    expect(r.deny.roles).toEqual(["Member"]);
    expect(r.note).toBeNull();
  });

  it("describes itself in words", () => {
    const names = new Map([["m1", "Mariam"]]);
    expect(describePrivilege(undefined, names)).toBe("As the code says");
    expect(
      describePrivilege(
        rule({ base: "nobody", allow: { members: ["m1"], roles: [], functions: [] } }),
        names
      )
    ).toBe("Nobody · + Mariam");
  });
});

describe("privilege rules — the registry", () => {
  it("keys are unique and groups are all known", () => {
    const keys = PRIVILEGE_REGISTRY.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const def of PRIVILEGE_REGISTRY) expect(PRIVILEGE_GROUPS).toContain(def.group);
  });

  it("every rule says what it hands over, and who has it today", () => {
    for (const def of PRIVILEGE_REGISTRY) {
      expect(def.label.length).toBeGreaterThan(8);
      expect(def.builtIn.length).toBeGreaterThan(8);
      expect(def.what.length).toBeGreaterThan(20);
    }
  });

  /** THE ONE THAT MATTERS. A switch nobody reads is a lie told in the LCP's
   *  settings — every key must appear in a `priv(…)` call in rbac.ts. */
  it("every switchable rule is actually wired into rbac", () => {
    const rbac = read("src/lib/rbac.ts");
    const wired = new Set([...rbac.matchAll(/priv\(\s*v,\s*"([^"]+)"/g)].map((m) => m[1]));
    const missing = PRIVILEGE_REGISTRY.map((p) => p.key).filter((k) => !wired.has(k));
    expect(missing, `not read by any predicate: ${missing.join(", ")}`).toEqual([]);
  });

  /** …and the other way round: a `priv()` call for a key the manager does
   *  not list is a rule nobody can ever change. */
  it("rbac reads no key the manager cannot show", () => {
    const rbac = read("src/lib/rbac.ts");
    const wired = [...rbac.matchAll(/priv\(\s*v,\s*"([^"]+)"/g)].map((m) => m[1]);
    const known = new Set(PRIVILEGE_REGISTRY.map((p) => p.key));
    expect(wired.filter((k) => !known.has(k))).toEqual([]);
  });

  it("only rbac.ts reads a viewer's privileges — priv() is the one door", () => {
    const files = [
      "src/server/actions.ts",
      "src/server/data.ts",
      "src/components/crm/accounts-view.tsx",
      "src/components/crm/consideration-view.tsx",
    ];
    for (const f of files) expect(read(f).includes("viewer.privileges")).toBe(false);
  });
});

describe("privilege rules — on the real predicates", () => {
  it("priv() leaves the built-in answer alone when nothing is set", () => {
    expect(priv(member(), "archive.revive", true)).toBe(true);
    expect(priv(member(), "archive.revive", false)).toBe(false);
  });

  it("the archive: a Member cannot revive by default, and can once the LC says so", () => {
    const m = member();
    expect(canWorkArchived(m, archived)).toBe(false);
    const allowed = member({ privileges: { "archive.revive": "allow" } });
    expect(canWorkArchived(allowed, archived)).toBe(true);
    // …and it is still only about ARCHIVED rows
    expect(canWorkArchived(allowed, { ...archived, out_of_process: false })).toBe(false);
  });

  it("a rule can take something away from an MM too", () => {
    const tl = member({ role: "Team Leader" });
    expect(canWorkArchived(tl, archived)).toBe(true);
    expect(canManageArchive(tl)).toBe(true);
    const denied = member({
      role: "Team Leader",
      privileges: { "archive.revive": "deny", "archive.manage": "deny" },
    });
    expect(canWorkArchived(denied, archived)).toBe(false);
    expect(canManageArchive(denied)).toBe(false);
  });

  it("an admin keeps every rule, whatever the screen says", () => {
    const admin = member({ isAdmin: true, privileges: { "archive.manage": "deny", "ir.handover": "deny" } });
    expect(canManageArchive(admin)).toBe(true);
    expect(canHandOverIrCalls(admin)).toBe(true);
  });

  it("reassigning never reaches past what the viewer may edit", () => {
    const granted = member({ privileges: { "account.reassign": "allow" } });
    // somebody else's live account: granted or not, it is not theirs
    expect(canReassignAccount(granted, { function: "IGV", responsible_id: "other", out_of_process: false }))
      .toBe(false);
    // their own, which they can already edit
    expect(canReassignAccount(granted, { function: "IGV", responsible_id: "m1", out_of_process: false }))
      .toBe(true);
    // and without the rule, a Member hands on nothing
    expect(canReassignAccount(member(), { function: "IGV", responsible_id: "m1", out_of_process: false }))
      .toBe(false);
  });

  it("the unowned pool can be opened to Members, but never to a crew that does not work the research", () => {
    const b2cOnly = member({ functions: ["B2C"], sub_functions: ["B2C"], privileges: { "account.unownedPool": "allow" } });
    expect(canSeeUnownedPool(b2cOnly)).toBe(false);
    const igvMember = member({ privileges: { "account.unownedPool": "allow" } });
    expect(canSeeUnownedPool(igvMember)).toBe(true);
    expect(canSeeUnownedPool(member())).toBe(false);
  });

  it("the defaults every other switch starts from", () => {
    const m = member();
    const tl = member({ role: "Team Leader" });
    const vp = member({ role: "LCVP" });
    expect(canPurgeArchive(m)).toBe(false);
    expect(canPurgeArchive(tl)).toBe(true);
    expect(canDeleteWorkedAccount(m)).toBe(false);
    expect(canDeleteWorkedAccount(vp)).toBe(true);
    expect(canImportAccounts(m)).toBe(true);
    expect(canLogDirectVisit(m)).toBe(true);
    expect(canSplitDealOpens(m)).toBe(true);
    expect(canManageTeamIrCalls(m)).toBe(false);
    expect(canManageTeamIrCalls(tl)).toBe(true);
    expect(canHandOverIrCalls(m)).toBe(false);
    expect(canHandOverIrCalls(tl)).toBe(true);
    expect(canManagePartnerLcs(m)).toBe(false);
    expect(canManagePartnerLcs(tl)).toBe(true);
    // consideration-only rules need the module in the first place
    expect(canRecordPastIrCall(m)).toBe(false);
    expect(canRecordPastIrCall(member({ sub_functions: ["Consideration"] }))).toBe(true);
  });

  it("switching one off really closes it", () => {
    const tl = (key: string) => member({ role: "Team Leader", privileges: { [key]: "deny" } });
    expect(canPurgeArchive(tl("archive.purge"))).toBe(false);
    expect(canImportAccounts(tl("account.import"))).toBe(false);
    expect(canLogDirectVisit(tl("visit.direct"))).toBe(false);
    expect(canSplitDealOpens(tl("deal.split"))).toBe(false);
    expect(canManageTeamIrCalls(tl("ir.manageTeamCalls"))).toBe(false);
    expect(canManagePartnerLcs(tl("lc.manage"))).toBe(false);
  });
});
