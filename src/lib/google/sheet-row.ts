/** PURE membership-sheet row logic — header resolution and row building.
 *
 *  Split out of sheets.ts (which pulls in googleapis and the sandbox) so the
 *  property that broke production twice can be unit-tested: "each value lands
 *  under its OWN header, whatever the sheet's column layout is".
 */

/** COLUMN INDEX BY HEADER NAME (v33).
 *
 *  The importer used to destructure the row positionally, so deleting or
 *  reordering ONE column on the Membership sheet silently shifted every field
 *  after it — deleting "Nickname" would have written emails into the nickname
 *  slot and phones into email for all 77 members, twice an hour, with no
 *  error. Columns are now found by their header, so the sheet's layout is free
 *  to change and the code doesn't have to be redeployed in lockstep.
 *
 *  Matching is loose (case, spaces and punctuation ignored) because the real
 *  headers carry parenthetical hints like "Role (LCP/VP/TL/Coordinator/Member)". */
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ["name", "fullname"],
  email: ["email", "aiesecemail"],
  phone: ["phone", "phonenumber", "mobile"],
  role: ["role"],
  functions: ["function", "functions"],
  subs: ["subfunction", "subfunctions"],
  stakeholder: ["stakeholder", "manager"],
  team: ["teamname", "team"],
  active: ["active", "activeyesno"],
};

const normHeader = (h: string) => (h ?? "").toLowerCase().replace(/[^a-z]/g, "");

export type ColumnMap = Record<string, number>;

/** Builds field → column index from the sheet's own header row. */
export function mapColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  header.forEach((cell, i) => {
    const h = normHeader(cell);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (map[field] !== undefined) continue;
      // startsWith so "rolelcpvptlcoordinatormember" still matches "role"
      if (aliases.some((a) => h === a || h.startsWith(a))) map[field] = i;
    }
  });
  return map;
}

export interface MemberWriteBack {
  name: string;
  /** null = no AIESEC email yet — the row is located by PHONE instead */
  email: string | null;
  phone: string | null;
  role: string;
  functions: string[];
  sub_functions: string[];
  stakeholder_name: string | null;
  team_name: string | null;
  is_active: boolean;
}

/** Pure row builder for the write-back: places each field under its RESOLVED
 *  header column, preserving any cells the code doesn't know about. A field
 *  whose column is missing from the sheet is skipped, never guessed. */
export function buildMemberSheetRow(
  cols: ColumnMap,
  existing: string[],
  m: MemberWriteBack
): string[] {
  const fields: Array<[number | undefined, string]> = [
    [cols.name, m.name],
    [cols.email, m.email ?? ""],
    [cols.phone, m.phone ?? ""],
    [cols.role, m.role],
    [cols.functions, m.functions.join(", ")],
    [cols.subs, m.sub_functions.join(", ")],
    [cols.stakeholder, m.stakeholder_name ?? ""],
    [cols.team, m.team_name ?? ""],
    [cols.active, m.is_active ? "Yes" : "No"],
  ];
  const width = Math.max(0, ...Object.values(cols)) + 1;
  const out: string[] = Array.from(
    { length: Math.max(width, existing.length) },
    (_, i) => existing[i] ?? ""
  );
  for (const [i, v] of fields) if (i !== undefined) out[i] = v;
  return out;
}
