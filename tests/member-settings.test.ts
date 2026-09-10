import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  LEGACY_SETTING_KEYS,
  NOTIFY_TOPICS,
  SECTION_META,
  SETTINGS_INDEX,
  defaultMemberSettings,
  foldSearch,
  resolveMemberSettings,
  searchSettings,
  visibleSettings,
  wants,
  withNotifyPref,
  type NotifyChannel,
  type SettingsContext,
} from "@/lib/member-settings";

/**
 * MY SETTINGS — per topic, per channel (v36.2).
 *
 * Three properties matter more than anything else on this screen:
 *
 *  1. **A member who never opens it cannot tell it exists.** Everything
 *     defaults ON, and a stored blob only overrides the switches it really
 *     carries — so adding a topic later cannot change what anybody receives.
 *
 *  2. **Nobody loses a choice they already made.** The five v34.8 switches
 *     are read into their topics.
 *
 *  3. **No dead toggles.** Every switch is obeyed by a real send, and no send
 *     uses a channel its topic doesn't offer. The last block checks that by
 *     reading the source — a settings page full of switches that do nothing
 *     teaches people to stop trusting it.
 */

const ALL: SettingsContext = {
  ogx: true, leadsFunction: true, hasPassword: true,
  raising: true, consideration: true, signups: true, cxp: true,
};
const NOBODY: SettingsContext = {
  ogx: false, leadsFunction: false, hasPassword: false,
  raising: false, consideration: false, signups: false, cxp: false,
};

describe("defaults", () => {
  it("has every topic ON on both channels — the behaviour before any of this", () => {
    const d = defaultMemberSettings();
    for (const t of NOTIFY_TOPICS) {
      expect(d.notify[t.id], t.id).toEqual({ email: true, bell: true });
    }
  });

  it("fills the defaults in around an empty, missing or junk blob", () => {
    for (const raw of [null, undefined, {}, "nonsense", 42, [], { notify: "x" }]) {
      expect(resolveMemberSettings(raw)).toEqual(defaultMemberSettings());
    }
  });

  it("treats missing settings as YES", () => {
    expect(wants(undefined, "visit_announcements", "email")).toBe(true);
  });

  it("ignores non-boolean values and unknown topics", () => {
    const r = resolveMemberSettings({
      notify: { shoutouts: { email: "false", bell: 0 }, made_up: { email: false } },
      emailPeriodReports: 0,
    });
    expect(r).toEqual(defaultMemberSettings());
  });
});

describe("the v34.8 switches carry over", () => {
  it("reads every old key into its topic and channel", () => {
    for (const [key, [topic, channel]] of Object.entries(LEGACY_SETTING_KEYS)) {
      const r = resolveMemberSettings({ [key]: false });
      expect(r.notify[topic][channel], key).toBe(false);
      const other: NotifyChannel = channel === "email" ? "bell" : "email";
      expect(r.notify[topic][other], `${key} must not touch the other channel`).toBe(true);
    }
  });

  it("lets a v36.2 value win over an old key for the same switch", () => {
    const r = resolveMemberSettings({ emailShoutouts: false, notify: { shoutouts: { email: true } } });
    expect(r.notify.shoutouts.email).toBe(true);
  });
});

describe("saving", () => {
  it("changes exactly one switch", () => {
    const next = withNotifyPref({}, "ir_calls", "bell", false);
    const r = resolveMemberSettings(next);
    expect(r.notify.ir_calls).toEqual({ email: true, bell: false });
    expect(r.notify.partnerships.bell).toBe(true);
  });

  it("'all' flips one channel on every topic that uses it, and nothing else", () => {
    const r = resolveMemberSettings(withNotifyPref({}, "all", "email", false));
    for (const t of NOTIFY_TOPICS) {
      expect(r.notify[t.id].bell, t.id).toBe(true);
      if (t.channels.includes("email")) expect(r.notify[t.id].email, t.id).toBe(false);
    }
  });

  it("folds the old keys in, drops them, and keeps keys it doesn't know", () => {
    const next = withNotifyPref({ emailStreakNag: false, futureKey: 7 }, "podio", "email", false);
    expect(next.emailStreakNag).toBeUndefined();
    expect(next.futureKey).toBe(7);
    const r = resolveMemberSettings(next);
    expect(r.notify.streak.email).toBe(false);
    expect(r.notify.podio.email).toBe(false);
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

  it("offers a row for EVERY topic, and every topic at least one channel", () => {
    const shown = new Set(
      SETTINGS_INDEX.flatMap((e) => (e.kind.type === "notify" ? [e.kind.topic] : []))
    );
    for (const t of NOTIFY_TOPICS) {
      expect(shown.has(t.id), `"${t.id}" has no row`).toBe(true);
      expect(t.channels.length, t.id).toBeGreaterThan(0);
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
    for (const id of ["notify-streak", "notify-ir_calls", "notify-next_steps", "notify-cxp", "function-defaults"]) {
      expect(forAll).toContain(id);
      expect(forNobody).not.toContain(id);
    }
    // …but the universal rows survive for everyone
    for (const id of ["notify-touch_points", "notify-shoutouts", "notify-always-on", "password"]) {
      expect(forNobody).toContain(id);
    }
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
    expect(find("next step")[0]).toBe("notify-next_steps");
  });

  it("finds settings by what people actually type, not their titles", () => {
    const hits = find("too many emails");
    expect(hits).toContain("notify-visit_announcements");
    expect(hits).toContain("notify-period_reports");
    expect(hits).toContain("notify-shoutouts");
    expect(find("unsubscribe")).toContain("notify-visit_announcements");
    expect(find("bug")).toContain("report-problem");
    expect(find("whatsapp")).toContain("phone");
  });

  it("works in Arabic, either spelling", () => {
    expect(find("اشعارات").length).toBeGreaterThan(0);
    expect(find("كلمة السر")).toContain("password");
    expect(find("مشكلة")).toContain("report-problem");
    expect(find("أشعارات")).toEqual(find("اشعارات"));
  });

  it("requires EVERY word to match somewhere", () => {
    expect(find("password zzzzz")).toHaveLength(0);
  });

  it("normalises punctuation and case away", () => {
    expect(foldSearch("  Dark-Mode!  ")).toBe("dark mode");
    expect(foldSearch("إشعارات")).toBe(foldSearch("اشعارات"));
  });
});

describe("no dead toggles — every switch is obeyed by a real send", () => {
  // Read every send in src with the TypeScript parser: the 7th argument of
  // notifyMembers is its topic (bell), and `topic:` in a sendEmail call is the
  // email's. A string search would be fooled by "feedback" or "podio" meaning
  // something else entirely a thousand times over.
  const used = { email: new Set<string>(), bell: new Set<string>() };
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  for (const file of walk(join(process.cwd(), "src"))) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("notifyMembers(") && !src.includes("sendEmail(") && !src.includes("notifyTouchPointAudience(")) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const name = n.expression.text;
        const topicArg = n.arguments[6];
        if (name === "notifyMembers" && topicArg && ts.isStringLiteral(topicArg)) used.bell.add(topicArg.text);
        const obj = n.arguments[0];
        if (name === "sendEmail" && obj && ts.isObjectLiteralExpression(obj)) {
          for (const p of obj.properties) {
            if (ts.isPropertyAssignment(p) && p.name.getText(sf) === "topic" && ts.isStringLiteral(p.initializer))
              used.email.add(p.initializer.text);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  for (const t of NOTIFY_TOPICS) {
    for (const c of t.channels) {
      it(`"${t.id}" really is sent by ${c}`, () => {
        expect(
          used[c].has(t.id),
          `the ${c} switch for "${t.id}" is offered but no send carries that topic — wire it or drop the channel`
        ).toBe(true);
      });
    }
  }

  it("never sends a topic on a channel its row doesn't offer", () => {
    const byId = new Map(NOTIFY_TOPICS.map((t) => [t.id as string, t]));
    for (const c of ["email", "bell"] as const) {
      for (const id of used[c]) {
        const t = byId.get(id);
        expect(t, `"${id}" is not a topic`).toBeTruthy();
        expect(t!.channels.includes(c), `"${id}" is sent by ${c} but has no ${c} switch`).toBe(true);
      }
    }
  });

  it("keeps the password reset un-switchable", () => {
    const src = readFileSync(join(process.cwd(), "src/server/password.ts"), "utf8");
    expect(src).not.toMatch(/topic:/);
    for (const t of NOTIFY_TOPICS) expect(src.includes(`"${t.id}"`), t.id).toBe(false);
  });
});
