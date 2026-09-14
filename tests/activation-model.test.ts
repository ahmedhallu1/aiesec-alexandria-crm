import { describe, expect, it } from "vitest";
import {
  addDays, clampSpan, daysBetween, isIsoDate, mergeDelta, packTracks, parseTsv, positionBetween,
  publicPlan, sanitizeCell, toTsv,
  type ActivationPlan, type ActivationRow, type ActivationSection, type Column,
} from "@/lib/activation/model";

/** The Activate 26' bid page (v36.7): the pure rules the board and the server
 *  both stand on. */

describe("calendar dates", () => {
  it("adds and counts whole days without timezone drift", () => {
    expect(addDays("2026-09-25", 7)).toBe("2026-10-02");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-09-25", "2026-12-05")).toBe(71);
  });
  it("knows a real date", () => {
    expect(isIsoDate("2026-12-02")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("20888-09-17")).toBe(false);
    expect(isIsoDate("12/2/2026")).toBe(false);
  });
  it("keeps a dragged span inside the road and never backwards", () => {
    expect(clampSpan("2026-09-20", "2026-09-27", "2026-09-25", "2026-12-05")).toEqual(["2026-09-25", "2026-10-02"]);
    expect(clampSpan("2026-12-04", "2026-12-09", "2026-09-25", "2026-12-05")).toEqual(["2026-11-30", "2026-12-05"]);
    expect(clampSpan("2026-10-10", "2026-10-01", "2026-09-25", "2026-12-05")).toEqual(["2026-10-10", "2026-10-10"]);
  });
});

describe("lane packing", () => {
  it("never draws two overlapping bars on the same track", () => {
    const items = [
      { id: "a", start: "2026-10-01", end: "2026-10-05" },
      { id: "b", start: "2026-10-03", end: "2026-10-04" },
      { id: "c", start: "2026-10-06", end: "2026-10-06" },
      { id: "d", start: "2026-10-05", end: "2026-10-08" },
    ];
    const packed = packTracks(items);
    for (const x of packed)
      for (const y of packed)
        if (x.item.id !== y.item.id && x.track === y.track)
          expect(x.item.end < y.item.start || y.item.end < x.item.start, `${x.item.id}/${y.item.id}`).toBe(true);
    // a bar that starts after another ends reuses its track: "a" ends 5 Oct,
    // so "c" (6 Oct) goes back on track 0 instead of opening a new one
    expect(packed.find((p) => p.item.id === "c")!.track).toBe(0);
    expect(Math.max(...packed.map((p) => p.track))).toBe(1);
  });
});

describe("paste from Google Sheets", () => {
  it("reads tabs and lines", () => {
    expect(parseTsv("a\tb\nc\td\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("keeps quoted cells with newlines, tabs and doubled quotes", () => {
    expect(parseTsv('"line 1\nline 2"\tx\n"say ""hi"""\t"a\tb"')).toEqual([
      ["line 1\nline 2", "x"],
      ['say "hi"', "a\tb"],
    ]);
  });
  it("round-trips through the copy format", () => {
    const m = [["Name", "Notes"], ["OCP", "two\nlines"], ['He said "go"', "\t"]];
    expect(parseTsv(toTsv(m))).toEqual(m);
  });
});

describe("a cell is checked against its column", () => {
  const col = (type: Column["type"], extra: Partial<Column> = {}): Column => ({ key: "k", label: "K", type, ...extra });
  it("yes/no, numbers and dates", () => {
    expect(sanitizeCell(col("checkbox"), "Yes")).toEqual({ ok: true, value: true });
    expect(sanitizeCell(col("checkbox"), "")).toEqual({ ok: true, value: false });
    expect(sanitizeCell(col("number"), "1,200")).toEqual({ ok: true, value: 1200 });
    expect(sanitizeCell(col("number"), "lots").ok).toBe(false);
    expect(sanitizeCell(col("date"), "2026-10-18")).toEqual({ ok: true, value: "2026-10-18" });
    expect(sanitizeCell(col("date"), "18 Oct").ok).toBe(false);
  });
  it("pick-lists accept a value, its label, or its case — nothing else", () => {
    const lane = col("select", { options: ["marketing", "dx"], labels: { marketing: "Marketing", dx: "DX" } });
    expect(sanitizeCell(lane, "Marketing")).toEqual({ ok: true, value: "marketing" });
    expect(sanitizeCell(lane, "DX")).toEqual({ ok: true, value: "dx" });
    expect(sanitizeCell(lane, "Sales").ok).toBe(false);
  });
  it("refuses a column that doesn't exist and text that is too long", () => {
    expect(sanitizeCell(undefined, "x").ok).toBe(false);
    expect(sanitizeCell(col("text"), "x".repeat(501)).ok).toBe(false);
  });
});

describe("job descriptions read as bullets", () => {
  it("joins the sheet's hand-wrapped lines onto the bullet above", async () => {
    const { jobItems } = await import("@/components/activation/views");
    expect(
      jobItems("CONFERENCE MANAGEMENT:\n• Create a conference plan aligning the\nconference plan to the Agenda\n• Crisis Management")
    ).toEqual([
      { heading: true, text: "CONFERENCE MANAGEMENT" },
      { heading: false, text: "Create a conference plan aligning the conference plan to the Agenda" },
      { heading: false, text: "Crisis Management" },
    ]);
    expect(jobItems("Pushing more partners to the conference")).toEqual([
      { heading: false, text: "Pushing more partners to the conference" },
    ]);
  });
});

describe("row order", () => {
  it("slots a row between two others", () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(1024, null)).toBe(2048);
  });
});

const section = (id: string, extra: Partial<ActivationSection> = {}): ActivationSection => ({
  id, position: 1, kind: "table", title: id, subtitle: "", config: {}, hidden_public: false,
  updated_at: "", updated_by_name: "Someone", ...extra,
});
const row = (id: string, sectionId: string, data: ActivationRow["data"]): ActivationRow => ({
  id, section_id: sectionId, position: 1, data, updated_at: "", updated_by_name: "Someone",
});

describe("the public page", () => {
  const plan: ActivationPlan = {
    syncedAt: "",
    publicView: false,
    sections: [
      section("timeline", { kind: "timeline" }),
      section("secret", { hidden_public: true }),
      section("casting", { config: { view: "people", namesPublic: false } }),
    ],
    rows: [
      row("t1", "timeline", { title: "Bid", original: "2026-12-10" }),
      row("s1", "secret", { item: "budget" }),
      row("p1", "casting", { name: "Somebody", experience: "none", position: "MM", pref1: "OCVP DX" }),
    ],
  };
  const pub = publicPlan(plan);
  it("drops hidden sections and their rows", () => {
    expect(pub.sections.map((s) => s.id)).toEqual(["timeline", "casting"]);
    expect(pub.rows.some((r) => r.section_id === "secret")).toBe(false);
  });
  it("keeps the casting numbers but not the names, unless the LC turns them on", () => {
    const p = pub.rows.find((r) => r.id === "p1")!;
    expect(p.data.name).toBeUndefined();
    expect(p.data.experience).toBeUndefined();
    expect(p.data.pref1).toBe("OCVP DX");
    const shown = publicPlan({
      ...plan,
      sections: plan.sections.map((s) => (s.id === "casting" ? { ...s, config: { view: "people", namesPublic: true } } : s)),
    });
    expect(shown.rows.find((r) => r.id === "p1")!.data.name).toBe("Somebody");
  });
  it("never shows who edited, or the pre-fit sheet dates", () => {
    expect(pub.rows.every((r) => r.updated_by_name === null)).toBe(true);
    expect(pub.sections.every((s) => s.updated_by_name === null)).toBe(true);
    expect(pub.rows.find((r) => r.id === "t1")!.data.original).toBeUndefined();
    expect(pub.publicView).toBe(true);
  });
});

describe("folding in other editors' changes", () => {
  const plan: ActivationPlan = {
    syncedAt: "t0", publicView: false, sections: [section("a")],
    rows: [row("r1", "a", { v: 1 }), row("r2", "a", { v: 2 }), row("r3", "a", { v: 3 })],
  };
  it("updates, adds and removes — but never a row the member is saving", () => {
    const next = mergeDelta(
      plan,
      {
        syncedAt: "t1",
        sections: [],
        rows: [
          row("r1", "a", { v: 10 }),
          { ...row("r2", "a", {}), deleted_at: "now" },
          row("r3", "a", { v: 30 }),
          row("r4", "a", { v: 4 }),
        ],
      },
      new Set(["r3"])
    );
    const byId = new Map(next.rows.map((r) => [r.id, r.data.v]));
    expect(byId.get("r1")).toBe(10);
    expect(byId.has("r2")).toBe(false);
    expect(byId.get("r3")).toBe(3);
    expect(byId.get("r4")).toBe(4);
    expect(next.syncedAt).toBe("t1");
  });
});
