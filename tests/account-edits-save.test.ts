import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSaneIsoDate, isSaneTime } from "@/lib/sane-date";

/** "The edits are made on accounts, they get outside and nothing happened"
 *  (v36.6). Every save that reached the database succeeded — the edits were
 *  lost because the account page only saved on a button people didn't press.
 *  These ratchets keep the page's editable cards on autosave. */
const view = readFileSync(
  join(process.cwd(), "src/components/crm/account-detail-view.tsx"),
  "utf8"
);

function body(fn: string): string {
  const start = view.indexOf(`function ${fn}(`);
  expect(start, `${fn} exists`).toBeGreaterThan(-1);
  const next = view.indexOf("\nfunction ", start + 10);
  return view.slice(start, next === -1 ? undefined : next);
}

describe("account edits save themselves", () => {
  for (const card of ["NextStepCard", "DetailsCard", "ContactInfoCard", "PodioUpdateCard"]) {
    it(`${card} autosaves and shows whether it saved`, () => {
      const src = body(card);
      expect(src).toContain("useAutosave");
      expect(src).toContain("<SaveStatus");
    });
  }

  it("no card hides its save behind a button that only appears when something changed", () => {
    // the pre-v36.6 pattern: {canEdit && dirty ? <Button …>Save …</Button> : null}
    for (const label of ["Save next step", "Save details", "Save contact info"]) {
      expect(view, `"${label}" is back`).not.toContain(label);
    }
  });
});

describe("the server refuses a date nobody meant", () => {
  it("accepts real dates", () => {
    for (const d of ["2026-09-25", "2026-12-05", "2028-02-29"]) expect(isSaneIsoDate(d)).toBe(true);
  });
  it("refuses six-digit years, impossible days and junk", () => {
    for (const d of ["20888-09-17", "202990-09-10", "2026-02-30", "2027-02-29", "1999-01-01", "2026-13-01", "tomorrow", ""])
      expect(isSaneIsoDate(d), d).toBe(false);
  });
  it("times are 24-hour HH:MM(:SS)", () => {
    expect(isSaneTime("09:30")).toBe(true);
    expect(isSaneTime("23:59:00")).toBe(true);
    expect(isSaneTime("24:00")).toBe(false);
    expect(isSaneTime("9:30")).toBe(false);
  });
  it("updateAccount's schema uses them", () => {
    const actions = readFileSync(join(process.cwd(), "src/server/actions.ts"), "utf8");
    const schema = actions.slice(actions.indexOf("const editableFields"), actions.indexOf("export async function renameAccount"));
    expect(schema).toContain("isSaneIsoDate");
    expect(schema).toContain("isSaneTime");
  });
});
