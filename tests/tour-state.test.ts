import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tourDecision } from "@/lib/tour-state";

/** The walkthrough opens by itself ONCE per member — first time, and after
 *  that only when asked for from Help (v36.6, the Yassin ElHawash report). */
describe("first-run walkthrough", () => {
  it("opens for a member who has never seen it, and marks it seen right away", () => {
    expect(tourDecision({ serverSeen: false, browserSeen: false, impersonated: false })).toEqual({
      autoOpen: true,
      markSeen: true,
    });
  });

  it("never opens again once the server has it — whatever this browser remembers", () => {
    for (const browserSeen of [true, false]) {
      expect(tourDecision({ serverSeen: true, browserSeen, impersonated: false }).autoOpen).toBe(false);
    }
  });

  it("carries a pre-v36.6 browser flag over to the server instead of re-showing it", () => {
    expect(tourDecision({ serverSeen: false, browserSeen: true, impersonated: false })).toEqual({
      autoOpen: false,
      markSeen: true,
    });
  });

  it("an admin's test view neither opens it nor marks it on the member's behalf", () => {
    expect(tourDecision({ serverSeen: false, browserSeen: false, impersonated: true })).toEqual({
      autoOpen: false,
      markSeen: false,
    });
  });

  it("the component marks it seen when it OPENS, not only when it is closed", () => {
    const src = readFileSync(join(process.cwd(), "src/components/crm/tour.tsx"), "utf8");
    // the old flag-on-close design is exactly what kept re-showing it
    expect(src).toContain("markTourSeen()");
    expect(src).toContain("tourDecision(");
    expect(src).not.toMatch(/useSyncExternalStore/);
    // the layout feeds it the server's answer
    const layout = readFileSync(join(process.cwd(), "src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toMatch(/seen=\{!!viewer\.tour_seen_at\}/);
  });
});
