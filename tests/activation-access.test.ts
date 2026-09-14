import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  it("every member reaches it, module or not", () => {
    expect(read("src/components/crm/gate-client.tsx")).toContain('"/activation"');
    expect(read("src/components/crm/app-shell.tsx")).toContain('href: "/activation"');
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
