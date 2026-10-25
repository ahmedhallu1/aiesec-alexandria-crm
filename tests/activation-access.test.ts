import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canSeeActivationBid, type Viewer } from "@/lib/rbac";

/** "Editable for Sodio users, view-only for everyone else" (v36.7). */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("who can reach the bid page", () => {
  const proxy = read("src/proxy.ts");
  const literal = /"(\/\(\(\?!.*?\)\.\*\))"/.exec(proxy)?.[1];
  const matcher = new RegExp(`^${JSON.parse(`"${literal}"`)}$`);

  it("the public copy needs no session", () => {
    expect(literal).toBeTruthy();
    expect(matcher.test("/activate26")).toBe(false);
    expect(matcher.test("/activate26/opengraph-image")).toBe(false);
  });
  it("the editable board stays behind the sign-in, like every page", () => {
    expect(matcher.test("/activation")).toBe(true);
    expect(matcher.test("/accounts")).toBe(true);
  });
  it("MMs and above reach it — never a plain Member (v36.8)", () => {
    // not in the always-open list any more…
    const gate = read("src/components/crm/gate-client.tsx");
    const always = /const ALWAYS_ALLOWED = \[([^]*?)\];/.exec(gate)?.[1] ?? "";
    expect(always.replace(/\/\/.*$/gm, "")).not.toContain('"/activation"');
    // …but opened by the layout, the nav and the page for exactly them
    // (v38.3: the layout's flags come from navFlagsFor in lib/home-options.ts)
    expect(read("src/lib/home-options.ts")).toContain("activation: canSeeActivationBid(v)");
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toMatch(/activation \? \["\/activation"\]/);
    // v38 — the shell lists every tab with its code rule, and the page asks
    // the tab rule (Settings → Tabs) on top of it
    expect(read("src/components/crm/app-shell.tsx")).toMatch(/href: "\/activation",[^\n]*builtIn: nav\.activation/);
    expect(read("src/app/(app)/activation/page.tsx")).toMatch(/gateTab\(\s*viewer,\s*ACTIVATION_TAB,\s*canSeeActivationBid\(viewer\)/);
  });
});

describe("the MM+ rule itself", () => {
  const v = (role: string, extra: Partial<Viewer> = {}) =>
    ({ role, functions: [], sub_functions: [], isAdmin: false, ...extra }) as unknown as Viewer;
  it("opens for every leadership role and closes for a Member", () => {
    for (const role of ["Coordinator", "Team Leader", "Director", "LCVP", "LCP", "Admin"])
      expect(canSeeActivationBid(v(role)), role).toBe(true);
    expect(canSeeActivationBid(v("Member"))).toBe(false);
  });
  it("the admin always gets in, whatever the membership row says", () => {
    expect(canSeeActivationBid(v("Member", { isAdmin: true }))).toBe(true);
  });
  it("every action — reads included — asks the same rule as the page (v38.3: the tab rule on top)", () => {
    const actions = read("src/server/activation-actions.ts");
    expect(actions).toMatch(/tabAllows\(viewer, ACTIVATION_TAB, canSeeActivationBid\(viewer\)\)/);
    expect(actions).toMatch(/if \(!\(await mayUseBid\(viewer\)\)\) return \{ viewer, error: MM_ONLY \}/);
    expect(actions.match(/if \(!\(await mayUseBid\(viewer\)\)\) return fail\(MM_ONLY\)/g)?.length).toBe(2);
    expect(actions).not.toMatch(/if \(!canSeeActivationBid\(viewer\)\)/);
  });
});

describe("nobody edits without being a signed-in member", () => {
  const actions = read("src/server/activation-actions.ts");
  const fns = [...actions.matchAll(/export async function (\w+)\([^]*?\n\}/g)];
  it("covers every exported action", () => {
    expect(fns.length).toBeGreaterThanOrEqual(10);
  });
  for (const [body, name] of fns) {
    it(`${name} checks the viewer first`, () => {
      expect(body).toMatch(/await editor\(\)|await getViewer\(\)|return setDeleted\(/);
    });
  }
  it("the public page renders read-only, from the public shape of the plan", () => {
    const page = read("src/app/activate26/page.tsx");
    expect(page).toContain("publicView: true");
    expect(page).toContain("editable={false}");
    expect(page).not.toContain("getViewer");
  });
  it("the in-app page reads the full plan", () => {
    expect(read("src/app/(app)/activation/page.tsx")).toContain("publicView: false");
  });
});
