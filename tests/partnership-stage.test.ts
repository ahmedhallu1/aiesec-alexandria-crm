import { describe, it, expect } from "vitest";
import {
  PARTNERSHIP_STAGES, effectiveStage, isPartnershipStage,
  stageFromCalls, stageIsAutomatic, stageLabel, stageRank,
} from "../src/lib/partnership-stage";

/** THE ROAD TO A PARTNERSHIP (v35.1).
 *
 *  The rule that needs pinning is the merge: automatic movement is FORWARD
 *  ONLY. A cancelled call must never drag a stage backwards, and a human must
 *  always be able to push ahead of what the calls prove — that is the whole
 *  contract between "make it smart" and "let me correct it".
 */

describe("the ladder", () => {
  it("runs contacted → answered → scheduled → done → group made", () => {
    expect(PARTNERSHIP_STAGES.map((s) => s.value)).toEqual([
      "contacted", "answered", "call_scheduled", "call_done", "group_made",
    ]);
  });

  it("ranks in order, and -1 for nothing yet", () => {
    expect(stageRank(null)).toBe(-1);
    expect(stageRank("contacted")).toBeLessThan(stageRank("answered"));
    expect(stageRank("call_scheduled")).toBeLessThan(stageRank("call_done"));
    expect(stageRank("call_done")).toBeLessThan(stageRank("group_made"));
  });

  it("refuses anything that isn't a stage", () => {
    for (const bad of ["", "done", "DROP TABLE", null, 3, undefined])
      expect(isPartnershipStage(bad)).toBe(false);
    expect(isPartnershipStage("call_done")).toBe(true);
    expect(stageLabel("group_made")).toContain("WhatsApp");
  });
});

describe("what the IR calls prove", () => {
  it("a booked call is 'scheduled'; a completed one is 'done'", () => {
    expect(stageFromCalls([{ status: "scheduled", product: "GV" }], "GV")).toBe("call_scheduled");
    expect(stageFromCalls([{ status: "completed", product: "GV" }], "GV")).toBe("call_done");
  });

  it("reads the programme, not just the LC", () => {
    const calls = [{ status: "completed", product: "GT" }];
    expect(stageFromCalls(calls, "GV")).toBeNull();
    expect(stageFromCalls(calls, "GT")).toBe("call_done");
  });

  it("counts an untagged legacy call for either programme", () => {
    // ir_calls.product only exists since v33.23 — null means "we don't know",
    // never "hide it"
    expect(stageFromCalls([{ status: "scheduled", product: null }], "GV")).toBe("call_scheduled");
  });

  it("a cancelled call proves nothing", () => {
    expect(stageFromCalls([{ status: "cancelled", product: "GV" }], "GV")).toBeNull();
  });
});

describe("the merge — forward only", () => {
  const calls = [{ status: "completed", product: "GV" }];

  it("takes the calls when nobody has set anything", () => {
    expect(effectiveStage({ product: "GV", calls })).toBe("call_done");
  });

  it("takes the human's stage when it is further along", () => {
    expect(effectiveStage({ manual: "group_made", product: "GV", calls })).toBe("group_made");
  });

  it("does NOT let a manual stage below the calls stick", () => {
    // the calls are facts; a control that quietly contradicted them would be
    // worse than one that overrides
    expect(effectiveStage({ manual: "contacted", product: "GV", calls })).toBe("call_done");
  });

  it("a call cancelled AFTER the stage advanced never pulls it back", () => {
    const after = [{ status: "cancelled", product: "GV" }];
    expect(effectiveStage({ manual: "call_done", product: "GV", calls: after })).toBe("call_done");
  });

  it("a made partnership is at the finish line whatever else says", () => {
    expect(effectiveStage({ manual: null, product: "GV", calls: [], done: true })).toBe("group_made");
    expect(effectiveStage({ manual: "contacted", product: "GV", calls: [], done: true })).toBe("group_made");
  });

  it("nothing at all is null, not a stage", () => {
    expect(effectiveStage({ product: "GV", calls: [] })).toBeNull();
  });
});

describe("saying WHO decided", () => {
  it("marks a stage the calls supplied", () => {
    expect(stageIsAutomatic({ product: "GV", calls: [{ status: "scheduled" }] })).toBe(true);
  });

  it("does not claim credit for a human's further stage", () => {
    expect(
      stageIsAutomatic({ manual: "call_done", product: "GV", calls: [{ status: "scheduled" }] })
    ).toBe(false);
  });

  it("a recorded partnership is never 'auto'", () => {
    expect(stageIsAutomatic({ product: "GV", calls: [{ status: "completed" }], done: true })).toBe(false);
  });
});
