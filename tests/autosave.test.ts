import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveController, type AutosaveStatus, type SaveResult } from "@/lib/autosave";

/** "They edit an account, they get out, and nothing happened" (v36.6). These
 *  pin the promises the account page now makes: an edit saves itself after a
 *  pause, leaving flushes it, a value that can't be saved says why, and a
 *  failure is never silently dropped. */

function harness(results: SaveResult[] = []) {
  const saved: string[] = [];
  const statuses: AutosaveStatus["kind"][] = [];
  let i = 0;
  const ctrl = new AutosaveController<string>({
    delay: 1000,
    save: async (v) => {
      saved.push(v);
      return results[i++] ?? { ok: true };
    },
    onStatus: (s) => statuses.push(s.kind),
  });
  return { ctrl, saved, statuses };
}

describe("autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves once, after the pause, with the LAST value typed", async () => {
    const { ctrl, saved } = harness();
    ctrl.change("n");
    ctrl.change("ne");
    ctrl.change("next step");
    expect(saved).toEqual([]);
    expect(ctrl.status.kind).toBe("pending");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual(["next step"]);
    expect(ctrl.status.kind).toBe("saved");
    expect(ctrl.unsaved).toBe(false);
  });

  it("flush saves immediately — leaving the page does not lose the edit", async () => {
    const { ctrl, saved } = harness();
    ctrl.change("typed then tapped WhatsApp");
    await ctrl.flush();
    expect(saved).toEqual(["typed then tapped WhatsApp"]);
    // and the debounce that was waiting does not send it a second time
    await vi.advanceTimersByTimeAsync(5000);
    expect(saved).toHaveLength(1);
  });

  it("a blocked value is never sent, and says why", async () => {
    const { ctrl, saved } = harness();
    ctrl.change("call them", "add a date");
    await vi.advanceTimersByTimeAsync(5000);
    await ctrl.flush();
    expect(saved).toEqual([]);
    expect(ctrl.status).toEqual({ kind: "blocked", reason: "add a date" });
    expect(ctrl.unsaved).toBe(true);
    // fixing it lets it through
    ctrl.change("call them · 2026-10-01");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual(["call them · 2026-10-01"]);
  });

  it("a failed save is kept, reported, and sent again on retry — never dropped", async () => {
    const { ctrl, saved } = harness([{ ok: false, error: "Gateway Timeout" }, { ok: true }]);
    ctrl.change("v1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctrl.status).toEqual({ kind: "error", error: "Gateway Timeout" });
    expect(ctrl.unsaved).toBe(true);
    // no retry loop on its own
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saved).toEqual(["v1"]);
    await ctrl.flush();
    expect(saved).toEqual(["v1", "v1"]);
    expect(ctrl.status.kind).toBe("saved");
  });

  it("a thrown save (network) becomes an error, not an unhandled rejection", async () => {
    const ctrl = new AutosaveController<string>({
      delay: 10,
      save: async () => {
        throw new Error("Failed to fetch");
      },
    });
    ctrl.change("x");
    await vi.advanceTimersByTimeAsync(10);
    expect(ctrl.status).toEqual({ kind: "error", error: "Failed to fetch" });
  });

  it("an edit made WHILE saving goes out right after, in order", async () => {
    let release: (() => void) | null = null;
    const saved: string[] = [];
    const ctrl = new AutosaveController<string>({
      delay: 100,
      save: (v) =>
        new Promise<SaveResult>((resolve) => {
          saved.push(v);
          release = () => resolve({ ok: true });
        }),
    });
    ctrl.change("first");
    await vi.advanceTimersByTimeAsync(100);
    expect(saved).toEqual(["first"]);
    ctrl.change("second");
    const flushing = ctrl.flush();
    release!();
    await vi.advanceTimersByTimeAsync(0);
    release!();
    await flushing;
    expect(saved).toEqual(["first", "second"]);
    expect(ctrl.unsaved).toBe(false);
  });
});
