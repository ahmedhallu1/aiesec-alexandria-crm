import { describe, it, expect } from "vitest";
import {
  deduplicate,
  mapFunction,
  parseAllGrids,
  parseSubmissionGrid,
  toIsoDateLoose,
  type Grid,
} from "@/lib/cxp/parser";

/**
 * THE SUBTOOL PARSER TESTS.
 *
 * The ECB SubTool is a horizontal multi-section grid, not a table, and its
 * date column has been observed carrying three different formats at once. A
 * date read wrong shifts a deadline by a day, which is a violation and a fine
 * — so the ambiguous cases below are pinned deliberately.
 */

/** Build a grid in the SubTool's real shape: section labels on row 3,
 *  headers on row 4, data from row 5. */
function grid(
  sections: { at: number; label: string; headers: string[] }[],
  dataRows: Record<number, string>[]
): Grid {
  const width = Math.max(...sections.map((s) => s.at + s.headers.length)) + 1;
  const blank = () => Array.from({ length: width }, () => "");
  const g: Grid = [blank(), blank(), blank(), blank(), blank()];
  for (const s of sections) {
    g[3][s.at] = s.label;
    s.headers.forEach((h, i) => {
      g[4][s.at + i] = h;
    });
  }
  for (const row of dataRows) {
    const r = blank();
    for (const [col, val] of Object.entries(row)) r[Number(col)] = val;
    g.push(r);
  }
  return g;
}

describe("date normalisation — the SubTool's three formats", () => {
  it("reads the real MM/dd/yyyy format", () => {
    // verified against raw cells: "5/15/2026" is 15 May
    expect(toIsoDateLoose("5/15/2026")).toBe("2026-05-15");
    expect(toIsoDateLoose("6/12/2026")).toBe("2026-06-12");
  });

  it("swaps when the first number CANNOT be a month", () => {
    expect(toIsoDateLoose("31/08/2026")).toBe("2026-08-31");
    expect(toIsoDateLoose("31-08-2026")).toBe("2026-08-31");
    expect(toIsoDateLoose("31.08.2026")).toBe("2026-08-31");
  });

  it("repairs yyyy-dd-MM", () => {
    expect(toIsoDateLoose("2026-31-08")).toBe("2026-08-31");
  });

  it("keeps plain ISO, with or without a time", () => {
    expect(toIsoDateLoose("2026-06-02")).toBe("2026-06-02");
    expect(toIsoDateLoose("2026-06-02 21:36:06")).toBe("2026-06-02");
  });

  it("returns null rather than guessing", () => {
    expect(toIsoDateLoose("soon")).toBe(null);
    expect(toIsoDateLoose("")).toBe(null);
    expect(toIsoDateLoose(null)).toBe(null);
    // a real date it cannot place must not become a confident wrong answer
    expect(toIsoDateLoose("2026-13-45")).toBe(null);
  });
});

describe("function mapping", () => {
  it("splits by side and product family", () => {
    expect(mapFunction("ICX", "GV")).toBe("IGV");
    expect(mapFunction("ICX", "GTa")).toBe("IGT");
    expect(mapFunction("ICX", "GTe")).toBe("IGT");
    expect(mapFunction("OGX", "GV")).toBe("OGV");
    expect(mapFunction("OGX", "GTa")).toBe("OGT");
  });

  it("treats an unknown product as the volunteer track", () => {
    expect(mapFunction("ICX", "")).toBe("IGV");
  });
});

describe("parsing a submission grid", () => {
  const g = grid(
    [
      {
        at: 0,
        label: "Approvals",
        headers: ["EP/OPP ID", "EP Name", "Product", "Current Status", "Approval Date", "Passport/ID", "Comment"],
      },
      // a second section, side by side, after a spacer column
      {
        at: 8,
        label: "Realizations",
        headers: ["EP/OPP ID", "EP Name", "Product", "Flight Date", "Slot Start", "Slot End", "Entry Stamp"],
      },
    ],
    [
      {
        0: "111/222", 1: "Amina", 2: "GV", 3: "approved", 4: "5/15/2026", 5: "TRUE", 6: "ID is blurry",
        8: "111/222", 9: "Amina", 10: "GV", 11: "9/2/2026", 12: "9/2/2026", 13: "11/2/2026", 14: "FALSE",
      },
      { 0: "333/444", 1: "Bilal", 2: "GTa", 3: "approved", 4: "6/1/2026", 5: "FALSE" },
    ]
  );

  const result = parseSubmissionGrid(g, "ICX Submissions");

  it("finds both side-by-side sections", () => {
    expect(result.sectionsFound).toEqual([
      "Approvals -> Approval",
      "Realizations -> Realization",
    ]);
  });

  it("produces one row per EP per stage", () => {
    expect(result.rows).toHaveLength(3);
    expect(result.rows.filter((r) => r.epOppId === "111/222")).toHaveLength(2);
  });

  it("maps the function from side + product", () => {
    expect(result.rows.find((r) => r.epName === "Amina")?.function).toBe("IGV");
    expect(result.rows.find((r) => r.epName === "Bilal")?.function).toBe("IGT");
  });

  it("reads the requirement tick-boxes by header name", () => {
    const amina = result.rows.find(
      (r) => r.epName === "Amina" && r.stageKey === "approval"
    );
    expect(amina?.sheetFlags.passport_id).toBe(true);
    const realization = result.rows.find(
      (r) => r.epName === "Amina" && r.stageKey === "realization"
    );
    expect(realization?.sheetFlags.entry_stamp).toBe(false);
  });

  it("normalises the dates", () => {
    const realization = result.rows.find((r) => r.stageKey === "realization");
    expect(realization?.arrivalDate).toBe("2026-09-02");
    expect(realization?.endDate).toBe("2026-11-02");
  });

  it("keeps the ECB comment — the cell that says what to CORRECT", () => {
    expect(result.rows.find((r) => r.stageKey === "approval")?.ecbComment).toBe(
      "ID is blurry"
    );
  });

  it("records provenance so a wrong number is traceable", () => {
    const first = result.rows[0];
    expect(first.sourceSheetName).toBe("ICX Submissions");
    expect(first.sourceSectionName).toBe("Approvals");
    expect(first.sourceRowNumber).toBe(6); // 1-based, as a human sees it
  });

  it("reads the side and past-month flag from the tab name", () => {
    expect(result.rows.every((r) => r.side === "ICX")).toBe(true);
    expect(result.rows.every((r) => r.isPastMonth === false)).toBe(true);

    const past = parseSubmissionGrid(g, "ICX Submissions Past Month");
    expect(past.rows.every((r) => r.isPastMonth)).toBe(true);

    const ogx = parseSubmissionGrid(g, "OGX Submissions");
    expect(ogx.rows.every((r) => r.side === "OGX")).toBe(true);
    expect(ogx.rows.find((r) => r.epName === "Bilal")?.function).toBe("OGT");
  });
});

describe("robustness", () => {
  it("survives a column being inserted — headers are read by NAME", () => {
    const shifted = grid(
      [
        {
          at: 0,
          label: "Approvals",
          headers: ["Something New", "EP/OPP ID", "EP Name", "Product", "Passport/ID"],
        },
      ],
      [{ 0: "junk", 1: "111/222", 2: "Amina", 3: "GV", 4: "TRUE" }]
    );
    const r = parseSubmissionGrid(shifted, "ICX Submissions");
    expect(r.rows[0].epOppId).toBe("111/222");
    expect(r.rows[0].sheetFlags.passport_id).toBe(true);
  });

  it("skips a section with no EP/OPP ID column, and says so", () => {
    const broken = grid(
      [{ at: 0, label: "Approvals", headers: ["EP Name", "Product"] }],
      [{ 0: "Amina", 1: "GV" }]
    );
    const r = parseSubmissionGrid(broken, "ICX Submissions");
    expect(r.rows).toEqual([]);
    expect(r.warnings.join(" ")).toContain("no EP/OPP ID column");
  });

  it("ignores sections it does not recognise", () => {
    const g = grid(
      [{ at: 0, label: "Some Other Thing", headers: ["EP/OPP ID", "EP Name"] }],
      [{ 0: "111/222", 1: "Amina" }]
    );
    expect(parseSubmissionGrid(g, "ICX Submissions").rows).toEqual([]);
  });

  it("skips blank rows inside a block", () => {
    const g = grid(
      [{ at: 0, label: "Approvals", headers: ["EP/OPP ID", "EP Name", "Product"] }],
      [{ 0: "111/222", 1: "Amina", 2: "GV" }, {}, { 0: "333/444", 1: "Bilal", 2: "GV" }]
    );
    expect(parseSubmissionGrid(g, "ICX Submissions").rows).toHaveLength(2);
  });

  it("flags a low-confidence row for review instead of dropping it", () => {
    const g = grid(
      [{ at: 0, label: "Realizations", headers: ["EP/OPP ID", "EP Name", "Product"] }],
      [{ 0: "111/222", 1: "", 2: "GV" }]
    );
    const row = parseSubmissionGrid(g, "ICX Submissions").rows[0];
    // no name (-0.2) and no realization date (-0.15) => 0.65, under the bar
    expect(row.needsReview).toBe(true);
    expect(row.epName).toBe("(unknown)");
    expect(row.parsingWarnings.length).toBeGreaterThan(0);
  });

  it("handles an empty sheet without throwing", () => {
    expect(parseSubmissionGrid([], "ICX Submissions").rows).toEqual([]);
    expect(parseAllGrids([]).rows).toEqual([]);
  });
});

describe("deduplication", () => {
  const row = (over: Record<string, unknown>) =>
    ({
      epOppId: "1/1",
      function: "IGV",
      stageKey: "approval",
      dedupeKey: "1/1|IGV|approval",
      isPastMonth: false,
      confidenceScore: 1,
      needsReview: false,
      parsingWarnings: [],
      sourceRowNumber: 6,
      ...over,
    }) as unknown as Parameters<typeof deduplicate>[0][number];

  it("keeps the most confident of two rows for one EP + stage", () => {
    const { rows, duplicates } = deduplicate([
      row({ epName: "low", confidenceScore: 0.5 }),
      row({ epName: "high", confidenceScore: 1 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(duplicates).toBe(1);
    expect((rows[0] as { epName: string }).epName).toBe("high");
  });

  it("flags the survivor for review when it wins a tie", () => {
    const { rows } = deduplicate([
      row({ epName: "first", confidenceScore: 1 }),
      row({ epName: "second", confidenceScore: 1, sourceRowNumber: 9 }),
    ]);
    expect(rows[0].needsReview).toBe(true);
    expect(rows[0].parsingWarnings.join(" ")).toContain("Duplicate row");
  });

  it("does NOT treat this month and last month as duplicates", () => {
    const { rows, duplicates } = deduplicate([
      row({ isPastMonth: false }),
      row({ isPastMonth: true }),
    ]);
    expect(rows).toHaveLength(2);
    expect(duplicates).toBe(0);
  });
});
