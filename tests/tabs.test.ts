import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
import {
  TAB_REGISTRY, publicTwinLive, ruleFromRow, tabCanWiden, tabIsDown, tabOverride, tabOverridesFor, tabVisible,
  type TabRule, type TabWho,
} from "@/lib/tabs";

/** THE TAB MANAGER (v38) — the precedence a rule follows, and that every
 *  tab's page actually asks it. */

const rule = (over: Partial<TabRule> = {}): TabRule => ({
  ...ruleFromRow({ href: "/activation" }),
  ...over,
});
const member: TabWho = { id: "m1", role: "Member", functions: ["IGV"], sub_functions: [] };
const coord: TabWho = { id: "c1", role: "Coordinator", functions: ["TM"], sub_functions: [] };
const NOW = Date.parse("2026-11-01T10:00:00Z");

describe("tab rules", () => {
  it("no rule = the code decides", () => {
    expect(tabOverride(undefined, member, NOW)).toBeNull();
    expect(tabOverride(rule(), member, NOW)).toBeNull();
    expect(tabVisible(true, null)).toBe(true);
    expect(tabVisible(false, null)).toBe(false);
  });

  it("base everyone / nobody", () => {
    expect(tabOverride(rule({ base: "everyone" }), member, NOW)).toBe("show");
    expect(tabOverride(rule({ base: "nobody" }), member, NOW)).toBe("hide");
  });

  it("a named person beats their role and function, both ways", () => {
    const r = rule({
      hide: { members: [], roles: ["Member"], functions: [] },
      show: { members: ["m1"], roles: [], functions: [] },
    });
    expect(tabOverride(r, member, NOW)).toBe("show");
    const r2 = rule({
      show: { members: [], roles: [], functions: ["IGV"] },
      hide: { members: ["m1"], roles: [], functions: [] },
    });
    expect(tabOverride(r2, member, NOW)).toBe("hide");
  });

  it("on the same level, hiding wins over showing", () => {
    const r = rule({
      show: { members: [], roles: ["Member"], functions: [] },
      hide: { members: [], roles: [], functions: ["IGV"] },
    });
    expect(tabOverride(r, member, NOW)).toBe("hide");
  });

  it("functions match sub-functions too", () => {
    const r = rule({ base: "nobody", show: { members: [], roles: [], functions: ["Raising"] } });
    expect(tabOverride(r, { ...member, functions: [], sub_functions: ["Raising"] }, NOW)).toBe("show");
    expect(tabOverride(r, coord, NOW)).toBe("hide");
  });

  it("retired, past the remove date, or before the show date → hidden from everyone", () => {
    const everyone = { base: "everyone" as const, show: { members: ["m1"], roles: [], functions: [] } };
    expect(tabOverride(rule({ ...everyone, retiredAt: "2026-10-30T00:00:00Z" }), member, NOW)).toBe("hide");
    expect(tabOverride(rule({ ...everyone, removeAt: "2026-10-31T00:00:00Z" }), member, NOW)).toBe("hide");
    expect(tabOverride(rule({ ...everyone, removeAt: "2026-11-30T00:00:00Z" }), member, NOW)).toBe("show");
    expect(tabOverride(rule({ ...everyone, visibleFrom: "2026-11-05T00:00:00Z" }), member, NOW)).toBe("hide");
    expect(tabIsDown(rule({ visibleFrom: "2026-10-05T00:00:00Z" }), NOW)).toBe(false);
  });

  it("the public twin follows its switches", () => {
    expect(publicTwinLive(undefined, NOW)).toBe(true);
    expect(publicTwinLive(rule({ publicOff: true }), NOW)).toBe(false);
    expect(publicTwinLive(rule({ retiredAt: "2026-10-30T00:00:00Z" }), NOW)).toBe(true);
    expect(publicTwinLive(rule({ retiredAt: "2026-10-30T00:00:00Z", publicWithTab: true }), NOW)).toBe(false);
    expect(publicTwinLive(rule({ removeAt: "2026-10-31T00:00:00Z", publicWithTab: true }), NOW)).toBe(false);
  });

  it("only tabs with a rule appear in a person's overrides", () => {
    const o = tabOverridesFor([rule({ href: "/planning", base: "everyone" }), rule({ href: "/help" })], member, NOW);
    expect(o).toEqual({ "/planning": "show" });
  });

  it("a broken row falls to safe values", () => {
    const r = ruleFromRow({ href: "/help", base: "chaos", show_to: "x", hide_from: { roles: [1, "Member"] }, remove_at: "never" });
    expect(r.base).toBe("default");
    expect(r.show).toEqual({ members: [], roles: [], functions: [] });
    expect(r.hide.roles).toEqual(["Member"]);
    expect(r.removeAt).toBeNull();
  });
});

describe("hide-only tabs (v38.3)", () => {
  const showAll = {
    base: "everyone" as const,
    show: { members: ["m1"], roles: ["Member"], functions: ["IGV"] },
  };
  it("Health & Logs and Membership can be hidden but never shown", () => {
    for (const href of ["/admin", "/membership"]) {
      expect(tabCanWiden(href), href).toBe(false);
      // a row saved before the lock (or by hand) is neutralised
      expect(tabOverride(rule({ href, ...showAll }), member, NOW), href).toBeNull();
      expect(tabOverride(rule({ href, base: "nobody" }), member, NOW), href).toBe("hide");
      // a named "show" no longer beats a role-level hide
      const r = rule({ href, ...showAll, hide: { members: [], roles: ["Member"], functions: [] } });
      expect(tabOverride(r, member, NOW), href).toBe("hide");
      expect(tabOverride(rule({ href, retiredAt: "2026-10-30T00:00:00Z" }), member, NOW), href).toBe("hide");
    }
  });
  it("the War Room and the bid stay widenable — that is how the LC hands them out", () => {
    for (const href of ["/war-room", "/activation", "/planning", "/emails"]) {
      expect(tabCanWiden(href), href).toBe(true);
      expect(tabOverride(rule({ href, ...showAll }), member, NOW), href).toBe("show");
    }
  });
  it("every hide-only tab says why in the manager", () => {
    for (const t of TAB_REGISTRY.filter((x) => x.widen === false)) expect(t.shown, t.href).toBeTruthy();
  });
  it("the server refuses to save a show rule on one, and its page re-checks the role", () => {
    const actions = read("src/server/tab-actions.ts");
    expect(actions).toMatch(/!tabCanWiden\(def\.href\) && \(base === "everyone"/);
    expect(read("src/app/(app)/admin/page.tsx")).toMatch(/if \(!canUseAdminTools\(viewer\)\) redirect\("\/profile"\)/);
    expect(read("src/app/(app)/membership/page.tsx")).toMatch(/if \(!canManageMembership\(viewer\)\) redirect\("\/profile"\)/);
  });
  it("Planning opened by a rule shows only the viewer's own MM plans, and never bounces", () => {
    const page = read("src/app/(app)/planning/page.tsx");
    expect(page).toMatch(/const ownOnly = leads \? undefined : \[viewer\.id\]/);
    expect(page).toMatch(/listMmPlans\(ownOnly, mmScope\)/);
    expect(page).toMatch(/listTlPlans\(ownOnly, mmScope\)/);
    expect(page).not.toMatch(/redirect\(/);
  });
});

describe("the tab writes (v38.3)", () => {
  const actions = read("src/server/tab-actions.ts");
  const body = (name: string) =>
    [...actions.matchAll(/export async function \w+\([^]*?\n\}/g)]
      .map((x) => x[0])
      .find((b) => b.startsWith(`export async function ${name}(`)) ?? "";
  it("retiring makes the public page FOLLOW the tab; restoring never switches a page on", () => {
    expect(body("retireTab")).toMatch(/public_with_tab: publicToo === true/);
    expect(body("retireTab")).not.toMatch(/public_off/);
    expect(body("restoreTab")).not.toMatch(/public_off/);
  });
  it("reordering writes only the position, and a reset keeps it", () => {
    expect(body("saveTabOrder")).toMatch(/\(\{ href, position: i \}\)/);
    expect(body("saveTabOrder")).not.toMatch(/updated_by/);
    expect(body("resetTabRule")).toMatch(/typeof current\?\.position === "number"/);
  });
  it("every write that can flip /no-peace tells the open boards", () => {
    for (const name of ["saveTabRule", "retireTab", "restoreTab", "resetTabRule"]) {
      expect(body(name), name).toMatch(/const before = await twinLive\(/);
      expect(body(name), name).toMatch(/await announceTwin\(/);
    }
    expect(actions).toMatch(/broadcast\(WAR_SLUG, "closed", \{\}\)/);
    expect(actions).toMatch(/broadcast\(WAR_SLUG, "snapshot", await warSnapshot\(\)\)/);
  });
  it("the public pages fail CLOSED when the rules can't be read; signed-in tabs fail open", () => {
    const server = read("src/server/tabs.ts");
    expect(server).toMatch(/if \(!ok\) return false;/);
    expect(server).toMatch(/return \{ rules: \[\], ok: false \}/);
    // a failure is never memoised
    expect(server).not.toMatch(/memo = \{[^}]*ok: false/);
  });
});

describe("every tab is managed end to end", () => {
  it("the sidebar lists exactly the registry's tabs", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/crm/app-shell.tsx"), "utf8");
    for (const t of TAB_REGISTRY) expect(shell, t.href).toContain(`href: "${t.href}"`);
  });

  it("every tab's page asks the tab rule before rendering", () => {
    for (const t of TAB_REGISTRY) {
      const page = readFileSync(join(process.cwd(), `src/app/(app)${t.href}/page.tsx`), "utf8");
      expect(page, t.href).toMatch(/gateTab\(/);
    }
  });

  it("each public twin checks it may be shown", () => {
    for (const t of TAB_REGISTRY.filter((x) => x.publicHref)) {
      const page = readFileSync(join(process.cwd(), `src/app${t.publicHref}/page.tsx`), "utf8");
      expect(page, t.publicHref).toMatch(/publicPageLive\(/);
    }
  });
});
