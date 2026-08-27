import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** THE THINGS THAT BREAK PHONE NOTIFICATIONS AND THE ANDROID APP SILENTLY (v35).
 *
 *  Every failure this file guards against looks like nothing at all from the
 *  inside: the code is there, no error is thrown, and notifications simply
 *  never arrive — or the app opens with a browser address bar across the top
 *  and everyone reports "it looks like a website". None of them is caught by
 *  a typecheck, and none is visible in a dev session on localhost.
 */

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The live matcher out of src/proxy.ts, as a real RegExp. Reading the source
 *  rather than importing it: proxy.ts pulls in NextAuth, and this test is
 *  about one string in it. */
function proxyMatcher(): RegExp {
  const src = read("src/proxy.ts");
  // [\s\S] rather than the `s` flag: this repo's tsconfig target predates it
  const m = src.match(/"(\/\(\(\?![\s\S]*?)",/);
  expect(m, "the proxy matcher pattern should be findable in src/proxy.ts").toBeTruthy();
  // the source is a TS string literal, so `\\.` in the file is `\.` in the regex
  return new RegExp("^" + m![1].replace(/\\\\/g, "\\") + "$");
}

/** Does the proxy (and therefore the auth redirect to /login) run for this path? */
const guarded = (re: RegExp, path: string) => re.test(path);

describe("the proxy lets the public pieces through", () => {
  const re = proxyMatcher();

  it("does not guard /sw.js — a service worker is fetched by the BROWSER", () => {
    // Guarded, it 307s to /login and registration dies on the MIME type, so
    // push never works anywhere and nothing says why.
    expect(guarded(re, "/sw.js")).toBe(false);
  });

  it("does not guard the Digital Asset Links file", () => {
    // Guarded, Chrome cannot verify the app and the TWA keeps its URL bar.
    expect(guarded(re, "/.well-known/assetlinks.json")).toBe(false);
  });

  it("does not guard /privacy — Play requires a reachable policy URL", () => {
    expect(guarded(re, "/privacy")).toBe(false);
  });

  it("still guards the app itself", () => {
    for (const path of ["/dashboard", "/accounts", "/signups", "/admin", "/profile"])
      expect(guarded(re, path), path).toBe(true);
  });
});

describe("the bell still reaches the phone", () => {
  it("notifyMembers fires the push — the ONLY hook, so nothing can be missed", () => {
    const src = read("src/server/notify.ts");
    expect(src).toContain("sendPushToMembers");
  });

  it("a push is best-effort and never breaks the action that raised it", () => {
    const src = read("src/server/notify.ts");
    // the push block is wrapped, and the delivery promise carries its own catch
    expect(src).toMatch(/catch\s*\(e\)\s*{\s*console\.error\("\[notify\] push unavailable/);
  });

  it("the service worker shows a notification for every push", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain("showNotification");
    expect(sw).toContain("notificationclick");
  });

  it("the service worker caches NOTHING — every page here is per-member", () => {
    // A caching worker over an auth-gated CRM is how one member ends up
    // looking at another member's cached accounts list.
    expect(read("public/sw.js")).not.toMatch(/addEventListener\(\s*["']fetch["']/);
  });

  it("push is off, not broken, when the VAPID keys are missing", () => {
    const src = read("src/server/push.ts");
    expect(src).toContain("pushConfigured");
    expect(src).toMatch(/if \(ids\.length === 0 \|\| !pushConfigured\(\)\) return none;/);
  });

  it("a dead subscription is deleted rather than retried forever", () => {
    const src = read("src/server/push.ts");
    expect(src).toMatch(/code === 404 \|\| code === 410/);
  });
});

describe("the TWA manifest matches what the site actually serves", () => {
  const twa = JSON.parse(read("android/twa-manifest.json")) as Record<string, unknown>;
  const manifest = read("src/app/manifest.ts");

  it("wraps the production host", () => {
    expect(twa.host).toBe("sodio.vercel.app");
    expect(twa.webManifestUrl).toBe("https://sodio.vercel.app/manifest.webmanifest");
  });

  it("keeps the package id the assetlinks route vouches for", () => {
    // A package id is permanent once published — the two must never disagree.
    expect(twa.packageId).toBe("app.sodio.crm");
    expect(read("src/app/.well-known/assetlinks.json/route.ts")).toContain("app.sodio.crm");
  });

  it("has notification delegation ON — it is what puts push in the app's tray", () => {
    expect(twa.enableNotifications).toBe(true);
  });

  it("points at icons the site really has", () => {
    for (const key of ["iconUrl", "maskableIconUrl"] as const) {
      const url = String(twa[key]);
      expect(manifest).toContain(new URL(url).pathname);
    }
  });

  it("the web manifest declares the scope the TWA treats as 'still the app'", () => {
    expect(manifest).toMatch(/scope:\s*"\/"/);
    expect(manifest).toMatch(/display:\s*"standalone"/);
  });
});
