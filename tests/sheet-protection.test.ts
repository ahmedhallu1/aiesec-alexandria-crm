import { describe, it, expect } from "vitest";
import { isCellProtected, type ProtectedRangeLite } from "@/lib/google/signups";

/**
 * WRITING AROUND PROTECTED CELLS (v36.2).
 *
 * The hourly export was cancelled on every GitHub run: one protected cell on
 * the tracker's "Old" tab made Google refuse the whole batch, and the fallback
 * then wrote every cell on its own until the 10-minute limit. The export now
 * knows which cells are closed BEFORE writing — these pin how it decides.
 */

const me = "sodio@project.iam.gserviceaccount.com";

describe("isCellProtected", () => {
  it("no protections — everything is open", () => {
    expect(isCellProtected([], 5, 3, me)).toBe(false);
  });

  it("a protected column closes that column only (0-based, end exclusive)", () => {
    const col = [{ range: { startColumnIndex: 7, endColumnIndex: 8 } }];
    expect(isCellProtected(col, 12, 7, me)).toBe(true);
    expect(isCellProtected(col, 12, 6, me)).toBe(false);
    expect(isCellProtected(col, 12, 8, me)).toBe(false);
  });

  it("a whole-sheet protection closes every cell but its unprotected holes", () => {
    const sheet: ProtectedRangeLite[] = [
      { range: {}, unprotectedRanges: [{ startColumnIndex: 2, endColumnIndex: 4, startRowIndex: 1 }] },
    ];
    expect(isCellProtected(sheet, 10, 0, me)).toBe(true);
    expect(isCellProtected(sheet, 10, 3, me)).toBe(false);
    expect(isCellProtected(sheet, 0, 3, me)).toBe(true); // the header row isn't in the hole
  });

  it("a range that only WARNS doesn't stop a write", () => {
    expect(isCellProtected([{ range: {}, warningOnly: true }], 4, 4, me)).toBe(false);
  });

  it("a range this service account may edit is open to it — case-insensitively", () => {
    const shared = [{ range: {}, editors: { users: ["owner@aiesec.net", "Sodio@Project.iam.gserviceaccount.com"] } }];
    expect(isCellProtected(shared, 4, 4, me)).toBe(false);
    expect(isCellProtected(shared, 4, 4, "someone-else@x.com")).toBe(true);
    // no idea who we are → a protected range counts as closed
    expect(isCellProtected(shared, 4, 4, null)).toBe(true);
  });

  it("rows bound it too", () => {
    const rows = [{ range: { startRowIndex: 0, endRowIndex: 1 } }]; // just the header
    expect(isCellProtected(rows, 0, 9, me)).toBe(true);
    expect(isCellProtected(rows, 1, 9, me)).toBe(false);
  });
});
