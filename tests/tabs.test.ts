import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  TAB_REGISTRY, publicTwinLive, ruleFromRow, tabIsDown, tabOverride, tabOverridesFor, tabVisible,
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
