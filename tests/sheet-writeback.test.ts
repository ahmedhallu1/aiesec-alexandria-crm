import { describe, it, expect } from "vitest";
import { buildMemberSheetRow, mapColumns } from "@/lib/google/sheet-row";

/**
 * MEMBERSHIP WRITE-BACK ALIGNMENT (v33.15).
 *
 * The corruption this pins down: the write-back used to emit a fixed
 * 10-cell array (with a hardcoded Nickname placeholder at index 1) against
 * whatever layout the sheet actually had. After v33 deleted the Nickname
 * column, every first sign-in appended a row shifted one column right —
 * email under the Phone header, phone under Role — which the import's
 * shifted-row guard then skipped forever, so in-app edits silently reverted.
 *
 * The property: each value lands under its OWN header, whatever the layout.
 */

const MEMBER = {
  name: "Menna Ahmed",
  email: "menna@aiesec.net",
  phone: "+201023477983",
  role: "Team Leader",
  functions: ["OGV"],
  sub_functions: ["OGX"],
  stakeholder_name: "Sama",
  team_name: "Wolves",
  is_active: true,
};

const CURRENT_HEADERS = [
  "Name", "Email", "Phone", "Role (LCP/VP/TL/Coordinator/Member)",
  "Function (IGV/IGT/OGV/OGT)", "Sub Function (Raising/Consideration/ICX/OGX)",
  "Stakeholder", "Team Name", "Active (Yes/No)",
];

const LEGACY_HEADERS = [
  "Name", "Nickname", "Email", "Phone", "Role (LCP/VP/TL/Coordinator/Member)",
  "Function (IGV/IGT/OGV/OGT)", "Sub Function (Raising/Consideration/ICX/OGX)",
  "Stakeholder", "Team Name", "Active (Yes/No)",
];

const valueUnder = (headers: string[], row: string[], header: string) =>
  row[headers.findIndex((h) => h.startsWith(header))];

describe("buildMemberSheetRow", () => {
  for (const [label, headers] of [
    ["current 9-column layout (no Nickname)", CURRENT_HEADERS],
    ["legacy 10-column layout (with Nickname)", LEGACY_HEADERS],
  ] as const) {
    it(`places every field under its own header on the ${label}`, () => {
      const cols = mapColumns([...headers]);
      const row = buildMemberSheetRow(cols, [], MEMBER);
      expect(valueUnder([...headers], row, "Name")).toBe("Menna Ahmed");
      expect(valueUnder([...headers], row, "Email")).toBe("menna@aiesec.net");
      expect(valueUnder([...headers], row, "Phone")).toBe("+201023477983");
      expect(valueUnder([...headers], row, "Role")).toBe("Team Leader");
      expect(valueUnder([...headers], row, "Function (")).toBe("OGV");
      expect(valueUnder([...headers], row, "Sub Function")).toBe("OGX");
      expect(valueUnder([...headers], row, "Stakeholder")).toBe("Sama");
      expect(valueUnder([...headers], row, "Team Name")).toBe("Wolves");
      expect(valueUnder([...headers], row, "Active")).toBe("Yes");
    });
  }

  it("survives a REORDERED sheet — headers decide, never positions", () => {
    const headers = ["Phone", "Active (Yes/No)", "Name", "Email", "Role", "Function", "Sub Function", "Stakeholder", "Team Name"];
    const cols = mapColumns(headers);
    const row = buildMemberSheetRow(cols, [], MEMBER);
    expect(row[0]).toBe("+201023477983");
    expect(row[1]).toBe("Yes");
    expect(row[2]).toBe("Menna Ahmed");
    expect(row[3]).toBe("menna@aiesec.net");
  });

  it("preserves cells in columns it does not know about", () => {
    const headers = [...CURRENT_HEADERS, "Notes (manual)"];
    const cols = mapColumns(headers);
    const existing = new Array(10).fill("");
    existing[9] = "keep me";
    const row = buildMemberSheetRow(cols, existing, MEMBER);
    expect(row[9]).toBe("keep me");
  });

  it("a phone-only member writes an EMPTY email cell, not a shifted row", () => {
    const cols = mapColumns([...CURRENT_HEADERS]);
    const row = buildMemberSheetRow(cols, [], { ...MEMBER, email: null });
    expect(valueUnder(CURRENT_HEADERS, row, "Email")).toBe("");
    expect(valueUnder(CURRENT_HEADERS, row, "Phone")).toBe("+201023477983");
    // the tell-tale of the old bug: an email address under the Phone header
    expect(valueUnder(CURRENT_HEADERS, row, "Phone")).not.toContain("@");
  });
});
