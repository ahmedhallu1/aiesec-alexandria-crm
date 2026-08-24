import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEMBER_SETTINGS_DEFAULTS,
  SECTION_META,
  SETTINGS_INDEX,
  foldSearch,
  resolveMemberSettings,
  searchSettings,
  visibleSettings,
  type MemberSettingKey,
  type SettingsContext,
} from "@/lib/member-settings";

/**
 * MY SETTINGS.
 *
 * Two properties matter more than anything else on this screen:
 *
 *  1. **A member who never opens it cannot tell it exists.** Every default is
 *     the behaviour that shipped before, and a stored blob only overrides the
 *     keys it really carries — so adding a setting later cannot silently
 *     change what an existing member receives.
 *
 *  2. **No dead toggles.** Every switch in the index is read by real code on
 *     a real send path. The last block here goes and checks that, because a
 *     settings panel full of switches that do nothing is worse than no panel:
 *     people turn things off, keep getting the emails, and stop trusting it.
 */

const ALL: SettingsContext = { ogx: true, leadsFunction: true, hasPassword: true };
const NOBODY: SettingsContext = { ogx: false, leadsFunction: false, hasPassword: false };

describe("defaults", () => {
  it("has every setting default to ON — the pre-0067 behaviour", () => {
    for (const [k, v] of Object.entries(MEMBER_SETTINGS_DEFAULTS)) {
      expect(v, k).toBe(true);
    }
  });

  it("fills the defaults in around an empty, missing or junk blob", () => {
    for (const raw of [null, undefined, {}, "nonsense", 42, []]) {
      expect(resolveMemberSettings(raw)).toEqual(MEMBER_SETTINGS_DEFAULTS);
    }
  });

  it("honours only the keys actually stored", () => {
    const r = resolveMemberSettings({ emailShoutouts: false });
    expect(r.emailShoutouts).toBe(false);
    expect(r.emailPeriodReports).toBe(true);
    expect(r.bellVisitAnnouncements).toBe(true);
  });

  it("ignores non-boolean and unknown keys instead of storing them", () => {
    const r = resolveMemberSettings({
      emailShoutouts: "false",
      emailPeriodReports: 0,
      somethingElse: true,
    });
    expect(r).toEqual(MEMBER_SETTINGS_DEFAULTS);
    expect(Object.keys(r)).toEqual(Object.keys(MEMBER_SETTINGS_DEFAULTS));
  });
});

describe("the index", () => {
  it("gives every row a unique id, a real section and a description", () => {
    const ids = new Set<string>();
    for (const e of SETTINGS_INDEX) {
      expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(SECTION_META[e.section], e.id).toBeTruthy();
      expect(e.description.length, e.id).toBeGreaterThan(20);
      expect(e.keywords.length, e.id).toBeGreaterThan(0);
    }
  });

  it("points every toggle at a key that exists in the shape", () => {
    for (const e of SETTINGS_INDEX) {
      if (e.kind.type !== "toggle") continue;
      expect(
        Object.prototype.hasOwnProperty.call(MEMBER_SETTINGS_DEFAULTS, e.kind.key),
        `${e.id} toggles "${e.kind.key}", which is not a setting`
      ).toBe(true);
    }
  });

  it("offers a row for EVERY setting in the shape — no orphan keys", () => {
    // a stored setting with no row is a preference nobody can reach
    const shown = new Set(
      SETTINGS_INDEX.flatMap((e) => (e.kind.type === "toggle" ? [e.kind.key] : []))
    );
    for (const k of Object.keys(MEMBER_SETTINGS_DEFAULTS) as MemberSettingKey[]) {
      expect(shown.has(k), `"${k}" has no row in the settings panel`).toBe(true);
    }
  });

  it("gives every 'locked' row a reason", () => {
    for (const e of SETTINGS_INDEX) {
      if (e.kind.type === "locked") expect(e.kind.reason.length, e.id).toBeGreaterThan(5);
    }
  });

  it("hides module rows from people they don't apply to", () => {
    const forAll = visibleSettings(ALL).map((e) => e.id);
    const forNobody = visibleSettings(NOBODY).map((e) => e.id);
    expect(forAll).toContain("email-streak-nag");
    expect(forAll).toContain("function-defaults");
    expect(forNobody).not.toContain("email-streak-nag");
    expect(forNobody).not.toContain("function-defaults");
    // …but the universal rows survive for everyone
    expect(forNobody).toContain("email-visit-announcements");
    expect(forNobody).toContain("password");
  });
});

describe("search", () => {
  const find = (q: string) => searchSettings(visibleSettings(ALL), q).map((e) => e.id);

  it("returns everything for an empty query", () => {
    expect(find("")).toHaveLength(visibleSettings(ALL).length);
    expect(find("   ")).toHaveLength(visibleSettings(ALL).length);
  });

  it("finds the obvious things by their obvious words", () => {
    expect(find("password")[0]).toBe("password");
    expect(find("dark")[0]).toBe("theme");
    expect(find("avatar")[0]).toBe("avatar");
    expect(find("backup gmail")[0]).toBe("backup-email");
  });

  it("finds settings by what people actually type, not their titles", () => {
    // nobody searches for "visit announcements" — they search for the problem
    expect(find("too many emails").length).toBeGreaterThan(0);
    expect(find("unsubscribe")).toContain("email-must-dos");
    expect(find("bug")).toContain("report-problem");
    expect(find("whatsapp")).toContain("phone");
  });

  it("works in Arabic, either spelling", () => {
    expect(find("اشعارات").length).toBeGreaterThan(0);
    expect(find("كلمة السر")).toContain("password");
    expect(find("مشكلة")).toContain("report-problem");
    // hamza / alef folding: أشعارات must find what اشعارات finds
    expect(find("أشعارات")).toEqual(find("اشعارات"));
  });

  it("finds a row by the PLURAL of a word it spells singular", () => {
    // people type "emails"; the section and half the rows say "email"
    const hits = find("too many emails");
    expect(hits).toContain("email-visit-announcements");
    expect(hits).toContain("email-period-reports");
    expect(hits).toContain("email-shoutouts");
  });

  it("requires EVERY word to match somewhere", () => {
    expect(find("password zzzzz")).toHaveLength(0);
  });

  it("ranks a title hit above a body mention", () => {
    const hits = find("theme");
    expect(hits[0]).toBe("theme");
  });

  it("normalises punctuation and case away", () => {
    expect(foldSearch("  Dark-Mode!  ")).toBe("dark mode");
    expect(foldSearch("إشعارات")).toBe(foldSearch("اشعارات"));
  });
});

describe("no dead toggles — every switch is read by real code", () => {
  // the whole feature's credibility rests on this: a member who turns an
  // email off must stop getting it
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const sources = [
    read("src/server/actions.ts"),
    read("src/app/api/cron/period-reports/route.ts"),
    read("src/app/api/cron/streak-nags/route.ts"),
  ].join("\n");

  for (const key of Object.keys(MEMBER_SETTINGS_DEFAULTS) as MemberSettingKey[]) {
    it(`"${key}" is checked on a real send path`, () => {
      expect(
        sources.includes(key),
        `"${key}" is offered in the settings panel but nothing reads it — either wire it or remove the row`
      ).toBe(true);
    });
  }

  it("keeps the must-do emails un-switchable", () => {
    // if one of these ever becomes a toggle it should be a deliberate act,
    // not a drive-by addition
    const toggleKeys = Object.keys(MEMBER_SETTINGS_DEFAULTS);
    for (const forbidden of ["emailVisitFollowup", "emailAttendance", "emailPodio", "emailPasswordReset"]) {
      expect(toggleKeys, `${forbidden} must not be optional`).not.toContain(forbidden);
    }
  });
});
