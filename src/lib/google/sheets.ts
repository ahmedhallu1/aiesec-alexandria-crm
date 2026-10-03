import { google, sheets_v4, drive_v3 } from "@/lib/google/apis";
import { db } from "@/lib/supabase";
import { env, requireEnv } from "@/lib/env";
import { sandboxSuppressed } from "@/server/sandbox";
import {
  normalizePhone, LC_FUNCTIONS, SUB_FUNCTIONS, MANAGER_ROLES } from "@/lib/types";
import type { Member, MemberRole } from "@/lib/types";
import { memberNameProblem } from "@/lib/member-fields";

/** Google Sheets mirror layer.
 *
 *  A service account owns the API access; all spreadsheets live in one Drive
 *  folder (DRIVE_FOLDER_ID) inside Ahmed's Drive, shared with the service
 *  account as Editor. Kept deliberately SMALL — few spreadsheets, flag columns
 *  instead of per-product sheets:
 *
 *  "CRM — Membership"        TWO-WAY — filled by hand AND updated by the in-app
 *                            membership editor; imported into the members table.
 *                            Has a second TAB "Teams" naming the standing AIESEC
 *                            teams (EB/LB/Function/MM) — also imported.
 *  "CRM — Raising Accounts"  export mirror — ALL accounts in ONE sheet (IGV +
 *                            IGT + B2B, even archived ones) with Function /
 *                            Product / Archived? flag columns for filtering.
 *  "CRM — Archived Accounts" export mirror — archived-only view: out-of-process
 *                            accounts + manually archived names. These can never
 *                            be added to the CRM again.
 *  "CRM — Contact Log"       export mirror
 *  "CRM — Visits"            export mirror
 */

/** Membership sheet headers — used ONLY to seed a brand-new blank sheet.
 *  The layout is NOT a positional contract any more: both the import and the
 *  write-back resolve columns by header name (v33 removed Nickname from the
 *  live sheet, so this list matches the current 9-column layout). */
const MEMBERSHIP_HEADERS = [
  "Name", "Email", "Phone",
  "Role (LCP/VP/TL/Coordinator/Member)",
  "Function (IGV/IGT/OGV/OGT)",
  "Sub Function (Raising/Consideration/ICX/OGX)",
  "Stakeholder", "Team Name", "Active (Yes/No)",
];

/** "Teams" TAB on the Membership spreadsheet: names the standing teams (the
 *  structure is derived from the membership). Types in the sheet:
 *  EB · LB · Function · "Function leaders" (stored as MM — the function's
 *  VP/Director + their TLs) · Team ("Team" rows are skipped: TL team names
 *  already live in the Membership tab's Team Name column). The Function cell
 *  may hold SEVERAL functions ("B2B, BD") — one teams row is stored per
 *  function so every member matches. */
const TEAMS_TAB = "Teams";
// the 5 team types: EB and LB are single teams; Function, Function leaders
// (stored internally as MM) and Team exist per function / many times

export function clients(): { sheets: sheets_v4.Sheets; drive: drive_v3.Drive } {
  const missing = requireEnv("serviceAccountKeyBase64", "driveFolderId");
  if (missing) throw new Error(missing);
  const key = JSON.parse(
    Buffer.from(env.serviceAccountKeyBase64, "base64").toString("utf-8")
  );
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

/** The service account's own address, lower-cased — what a protected range's
 *  editor list is checked against before a write (v36.2). Null when the key is
 *  missing or unreadable, which makes every protected range count as closed. */
export function serviceAccountEmail(): string | null {
  try {
    const key = JSON.parse(Buffer.from(env.serviceAccountKeyBase64, "base64").toString("utf-8"));
    return typeof key.client_email === "string" ? key.client_email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Loose title matching so "CRM — Membership" vs "CRM - membership" both work. */
function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function ensureSpreadsheet(
  title: string,
  headers: string[],
  seedRows: string[][] = []
): Promise<string> {
  const cacheKey = `sheet:${title}`;
  const { data: cached } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", cacheKey)
    .maybeSingle();
  if (cached?.value && typeof cached.value === "object" && "id" in cached.value) {
    return (cached.value as { id: string }).id;
  }

  const { sheets, drive } = clients();
  const list = await drive.files.list({
    q: `'${env.driveFolderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 100,
  });
  let id =
    (list.data.files ?? []).find((f) => normTitle(f.name ?? "") === normTitle(title))
      ?.id ?? null;

  if (!id) {
    // Service accounts have no Drive storage quota of their own, so creating a
    // file usually fails — but try anyway, then fall back to a clear message.
    try {
      const created = await drive.files.create({
        requestBody: {
          name: title,
          mimeType: "application/vnd.google-apps.spreadsheet",
          parents: [env.driveFolderId],
        },
        fields: "id",
      });
      id = created.data.id!;
    } catch {
      throw new Error(
        `Missing spreadsheet "${title}". The service account cannot create files in Drive (no storage quota) — create an empty Google Sheet with that name inside the CRM folder, then run the sync again.`
      );
    }
  }

  // Write headers (and seed rows) if the sheet is still blank.
  const firstCell = await sheets.spreadsheets.values
    .get({ spreadsheetId: id, range: "A1:B1" })
    .catch(() => null);
  if (!firstCell?.data.values?.[0]?.[0]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: "A1",
      valueInputOption: "RAW",
      requestBody: { values: [headers, ...seedRows] },
    });
  }

  await db()
    .from("app_settings")
    .upsert({ key: cacheKey, value: { id }, updated_at: new Date().toISOString() });
  return id;
}

/** Ensures a named TAB exists on a spreadsheet (creates it + writes headers and
 *  seed rows when blank). Returns the tab's actual title for range building. */
/** The Teams tab as it stands: its real title, or null when it isn't there.
 *
 *  ⚠️ NEVER CREATES IT (v33.53). Named teams are retired — the LC deleted the
 *  Teams tab and the Team Name column from the Membership sheet, and a team is
 *  now simply a MANAGER and the people whose Manager cell names them. The
 *  half-hourly import used `ensureTab`, which would have re-created the tab
 *  and re-seeded it within thirty minutes of the LC deleting it. */
async function findTab(spreadsheetId: string, title: string): Promise<string | null> {
  const { sheets } = clients();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title))",
  });
  return (
    (meta.data.sheets ?? []).find(
      (x) => normTitle(x.properties?.title ?? "") === normTitle(title)
    )?.properties?.title ?? null
  );
}


/** Every mirror sheet carries this in its LAST header cell — the sheets are
 *  write-only exports: deleting/editing rows there never touches Sodio.
 *  (A user once cleared the accounts sheet expecting Sodio to empty itself.) */
const MIRROR_NOTE =
  "⚠ MIRROR — Sodio overwrites this sheet hourly. Edit/delete IN SODIO, not here.";

async function overwriteSheet(title: string, headers: string[], rows: (string | number | boolean | null)[][]) {
  const id = await ensureSpreadsheet(title, headers);
  const { sheets } = clients();
  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: "A:ZZ" });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: "A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [headers, ...rows.map((r) => r.map((v) => (v == null ? "" : String(v))))],
    },
  });
}

// ------------------------------------------------------------------ import

const ROLE_ALIASES: Record<string, string> = {
  lcp: "LCP",
  lcvp: "LCVP",
  vp: "LCVP",
  "team leader": "Team Leader",
  tl: "Team Leader",
  coordinator: "Coordinator",
  member: "Member",
  director: "Director",
  // v33 — the system caretaker. Unrecognised roles fall back to "Member", so
  // until this alias existed an "Admin" on the sheet silently became a Member.
  admin: "Admin",
  "im director": "Admin",
};

/** The Role cell can hold SEVERAL values — "LCVP, Admin" is a VP who also
 *  keeps the system running (v33). Looking the whole string up in the alias
 *  map failed silently and fell back to "Member", which is how the VP of IGT
 *  spent a release with a member's permissions.
 *
 *  The OPERATIONAL rank wins; "Admin" is a capability carried alongside it and
 *  is surfaced via `roleCarriesAdmin` into the Sub Function list, where
 *  `canUseAdminTools` looks for it. A cell that says only "Admin" IS the role. */
function parseRole(raw: string | undefined): string {
  const parts = (raw ?? "")
    .split(/[,;/]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  for (const p of parts) {
    const mapped = ROLE_ALIASES[p];
    if (mapped && mapped !== "Admin") return mapped; // the real rank wins
  }
  // nothing operational — an Admin-only cell keeps Admin, anything else is a Member
  return parts.some((p) => ROLE_ALIASES[p] === "Admin") ? "Admin" : "Member";
}

/** True when the Role cell also grants the admin TOOLS alongside a real rank. */
function roleCarriesAdmin(raw: string | undefined): boolean {
  return (raw ?? "")
    .split(/[,;/]+/)
    .map((p) => p.trim().toLowerCase())
    .some((p) => ROLE_ALIASES[p] === "Admin");
}

/** Multi-select dropdown cells arrive as "IGV, IGT". "LCP" as a function value
 *  means LC-wide (no specific function). Values are FREE-FORM: known values are
 *  normalized to their canonical casing, anything new in the sheet (e.g. a new
 *  "TM" function) is kept as-is so the system follows the sheet automatically. */
function parseMulti(raw: string | undefined, known: readonly string[]): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,;]+/)) {
    const clean = part.trim();
    if (!clean || clean.toUpperCase() === "LCP") continue;
    const hit = known.find((v) => v.toLowerCase() === clean.toLowerCase()) ?? clean;
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

interface SheetMemberRow {
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  functions: string[];
  sub_functions: string[];
  stakeholder_name: string | null;
  team_name: string | null;
  is_active: boolean;
}

// Header resolution + write-back row building live in sheet-row.ts (pure, so
// the column-alignment property is unit-testable without googleapis).
export { mapColumns, buildMemberSheetRow } from "./sheet-row";
export type { ColumnMap, MemberWriteBack } from "./sheet-row";
import {
  buildMemberSheetRow, mapColumns, type ColumnMap, type MemberWriteBack,
} from "./sheet-row";

/** Role words, lower-cased — a value from the Role column showing up in the
 *  Function column is the tell-tale of a shifted row. */
const ROLE_WORDS = ["lcp", "lcvp", "director", "team leader", "coordinator", "member", "admin"];

function parseSheetRow(row: string[], cols: ColumnMap): SheetMemberRow | null {
  return parseSheetRowDetailed(row, cols).row;
}

/** The same parse, saying WHY a row was refused — the membership upload's
 *  preview shows the reason next to the line (v37.2). */
function parseSheetRowDetailed(
  row: string[],
  cols: ColumnMap
): { row: SheetMemberRow | null; reason?: string } {
  const at = (field: string) => {
    const i = cols[field];
    return i === undefined ? undefined : row[i];
  };
  const name = at("name");
  const email = at("email");
  const phone = at("phone");
  const role = at("role");
  const fns = at("functions");
  const subs = at("subs");
  const stakeholder = at("stakeholder");
  const teamName = at("team");
  const active = at("active");
  const cleanEmail = email?.trim().toLowerCase();
  const cleanPhone = phone?.trim();
  // email is OPTIONAL since v24 — a row needs a name plus an email OR a phone
  // (phone-only members sign in with their number until the email lands)
  if (!name?.trim()) return { row: null, reason: "No name." };
  const hasEmail = !!cleanEmail && cleanEmail.includes("@");
  const phoneCheck = cleanPhone ? normalizePhone(cleanPhone) : null;
  // canonical +digits when possible so every digit-tail matcher agrees;
  // unrecognized formats keep the raw value (stripped of separators)
  const storedPhone =
    phoneCheck?.ok ? phoneCheck.value : cleanPhone?.replace(/[^0-9+]/g, "") || null;

  // THE ROW MUST BE THE RIGHT SHAPE (v33.12).
  //
  // Two members arrived corrupted — phone "199", function "LCVP" — because
  // their SHEET rows were typed one column across: the email sat in Phone,
  // the role in Function, the function in Sub Function. Every value was
  // individually plausible, so the import took them and wrote a member whose
  // role was "Member", whose function was "LCVP" and whose phone was the
  // digits out of their email address.
  //
  // Columns are found by header, so a shift like this is a typing mistake in
  // one ROW, and the only place it can be caught is here: a cell that clearly
  // belongs to a different column means the row is misaligned, and importing
  // it does more damage than skipping it.
  // a NAME cell holding an address or a phone number is the same class of
  // mistake, and it is the one that shows: the value becomes the member's
  // display name on every leaderboard and in the greeting of every email.
  const nameProblem = memberNameProblem(name);
  const looksShifted =
    !!nameProblem ||
    // an email in the phone column, or a phone in the email column
    !!cleanPhone?.includes("@") ||
    (!!cleanEmail && !cleanEmail.includes("@") && /\d{7,}/.test(cleanEmail)) ||
    // a ROLE sitting in the Function column
    ROLE_WORDS.some((r) => (fns ?? "").trim().toLowerCase() === r) ||
    // a real role cell that names no role we know
    (!!role?.trim() && parseRole(role) === "Member" && !/member/i.test(role));
  if (looksShifted) {
    console.error(
      `[sheets] "${name.trim()}" looks like a SHIFTED row — ` +
        (nameProblem ? `the NAME cell is wrong (${nameProblem}) — ` : "") +
        `email/phone/role/function ` +
        `don't line up with their columns, so it was skipped rather than imported ` +
        `wrong. Check that row in the Membership sheet. ` +
        `(email=${JSON.stringify(cleanEmail)} phone=${JSON.stringify(cleanPhone)} ` +
        `role=${JSON.stringify(role)} function=${JSON.stringify(fns)})`
    );
    return {
      row: null,
      reason: nameProblem
        ? `The name cell is wrong: ${nameProblem}`
        : "The cells don't line up with their columns (an email in Phone, a role in Function, or a role we don't know) — check this line.",
    };
  }

  // IDENTITY OR NOTHING (v33.7). This used to test the RAW cell — so a phone
  // column holding text with no digits ("—", "N/A", a note) passed the check
  // and then stored as null. The row arrived with no email AND no phone,
  // which is exactly what the import keys on: nothing matched, so every run
  // INSERTED A NEW MEMBER. One member accumulated 33 copies at one per
  // half-hour before anyone noticed. Test what will actually be STORED.
  if (!hasEmail && !storedPhone) {
    console.warn(
      `[sheets] "${name.trim()}" has no usable email or phone — skipped. ` +
        `Without one there is no way to tell them apart from a new person, ` +
        `and re-importing would create a duplicate every run.`
    );
    return { row: null, reason: "No usable email or phone — one of them is required." };
  }

  return { row: {
    name: name.trim(),
    email: hasEmail ? cleanEmail : null,
    phone: storedPhone,
    role: parseRole(role),
    functions: parseMulti(fns, LC_FUNCTIONS),
    // "LCVP, Admin" → rank LCVP, capability Admin. The capability rides in
    // Sub Function because that is where `canUseAdminTools` looks for it.
    sub_functions: [
      ...parseMulti(subs, SUB_FUNCTIONS),
      ...(roleCarriesAdmin(role) && parseRole(role) !== "Admin" ? ["Admin"] : []),
    ],
    stakeholder_name: stakeholder?.trim() || null,
    team_name: teamName?.trim() || null,
    // "No" / "FALSE" / "0" / "inactive" all mean inactive (an exported file
    // re-uploaded from Excel may carry any of them)
    is_active: !["no", "false", "0", "inactive", "n"].includes((active ?? "Yes").trim().toLowerCase()),
  } };
}

interface LinkableMember {
  id: string;
  name: string;
  role: MemberRole;
  functions: string[] | null;
  stakeholder_name: string | null;
  stakeholder_id: string | null;
  is_active: boolean;
}

/** DEFAULT MANAGER RULES when the sheet doesn't name one:
 *  MM (TL / Coordinator / Member) → their function's VP → else the function's
 *  Director → else the LCP. VPs and Directors → the LCP. */
export function defaultManagerId(m: LinkableMember, all: LinkableMember[]): string | null {
  const lcp = all.find((x) => x.role === "LCP" && x.is_active);
  if (m.role === "LCP") return null;
  if (m.role === "LCVP" || m.role === "Director") return lcp?.id ?? null;
  const fns = m.functions ?? [];
  const inFunction = (x: LinkableMember) =>
    x.is_active && (x.functions ?? []).some((f) => fns.includes(f));
  const vp = all.find((x) => x.role === "LCVP" && inFunction(x));
  if (vp) return vp.id;
  const director = all.find((x) => x.role === "Director" && inFunction(x));
  if (director) return director.id;
  return lcp?.id ?? null;
}

/** Roles that can BE someone's manager — a plain Member never manages anyone
 *  (common sense, enforced on import AND in the editor since v24). */
// The Manager pick-list lives in types.ts so the CLIENT-side membership editor
// can offer exactly what this server-side relink will accept — see the comment
// there for why a Coordinator is not on it. Re-exported here because callers
// have imported it from this module since v24.
export { MANAGER_ROLES };

/** Resolves "Stakeholder" (Manager) names to member ids (by name),
 *  falling back to the default manager chain when the cell is empty or names
 *  someone who can't manage (a plain Member). */
async function relinkStakeholders(): Promise<void> {
  const { data: members } = await db()
    .from("members")
    .select("id, name, role, functions, stakeholder_name, stakeholder_id, is_active");
  const all = (members ?? []) as LinkableMember[];
  const byName = new Map<string, LinkableMember>();
  for (const m of all) {
    byName.set(m.name.trim().toLowerCase(), m);
  }
  for (const m of all) {
    const named = m.stakeholder_name
      ? byName.get(m.stakeholder_name.trim().toLowerCase()) ?? null
      : null;
    let targetId = named && MANAGER_ROLES.includes(named.role) ? named.id : null;
    if (!targetId || targetId === m.id) targetId = defaultManagerId(m, all);
    if (targetId === m.id) targetId = null;
    if (targetId !== m.stakeholder_id) {
      await db().from("members").update({ stakeholder_id: targetId }).eq("id", m.id);
    }
  }
}

/** HAS THIS SPREADSHEET CHANGED SINCE WE LAST IMPORTED IT? (v33.19)
 *
 *  The imports ran every 15–30 minutes around the clock and did the FULL
 *  parse-and-upsert every time, whether or not a single cell had moved —
 *  which is most of the day, and it was the biggest line on the hosting
 *  bill. Drive tells us for free: one metadata call returns the file's
 *  `modifiedTime`. If it matches what we stored after the last run, there is
 *  nothing to do. Returns the token to store on success, or null when
 *  unchanged (caller exits). Fails OPEN — any doubt runs the import. */
export async function sheetChangedSince(
  spreadsheetId: string,
  key: string
): Promise<{ changed: boolean; token: string | null }> {
  try {
    const { drive } = clients();
    const res = await drive.files.get({
      fileId: spreadsheetId,
      fields: "modifiedTime",
      supportsAllDrives: true,
    });
    const token = res.data.modifiedTime ?? null;
    if (!token) return { changed: true, token: null };
    const { data } = await db()
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const seen =
      data?.value && typeof data.value === "object" && "t" in data.value
        ? (data.value as { t: string }).t
        : null;
    return { changed: seen !== token, token };
  } catch (e) {
    console.error("[sheets] change check failed (running the import anyway):", e);
    return { changed: true, token: null };
  }
}

export async function markSheetSeen(key: string, token: string | null): Promise<void> {
  if (!token) return;
  await db()
    .from("app_settings")
    .upsert({ key, value: { t: token } }, { onConflict: "key" })
    .then(({ error }) => {
      if (error) console.error("[sheets] seen-stamp failed:", error.message);
    });
}

/** Reads the Membership sheet and upserts the members table.
 *  Members missing from the sheet are deactivated (never deleted).
 *  `opts.force` skips the unchanged-since check (manual runs / after edits). */
/** WHERE MEMBERSHIP LIVES (v37.2). "sodio" (the default since v37.2): Sodio is
 *  the source of truth — edited, uploaded and exported inside the app — and
 *  the "CRM — Membership" sheet is a MIRROR Sodio keeps writing. "sheet": the
 *  old two-way sync, where the 30-minute import reads the sheet back. Set from
 *  Settings → LC; stored in app_settings `membership:source`. */
export async function membershipSource(): Promise<"sodio" | "sheet"> {
  const { data } = await db().from("app_settings").select("value").eq("key", "membership:source").maybeSingle();
  const v = (data?.value as { source?: string } | null)?.source;
  return v === "sheet" ? "sheet" : "sodio";
}

export async function importMembership(opts?: { force?: boolean }): Promise<number> {
  // SODIO IS THE SOURCE (v37.2): the sheet is a mirror, so reading it back
  // would undo in-app edits every half hour. -1 = "skipped" (same as unchanged)
  if ((await membershipSource()) === "sodio") return -1;
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS);
  // nothing moved on the sheet since the last run → nothing to import (v33.19)
  const change = opts?.force
    ? { changed: true, token: null }
    : await sheetChangedSince(id, "seen:membership");
  if (!change.changed) return -1; // -1 = "skipped, unchanged"
  const { sheets } = clients();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: "A1:Z20000", // (v37.7) was A1:Z1000 — rows past 1000 were dropped/duplicated
  });
  const rows = (res.data.values ?? []) as string[][];
  const count = await applyMembershipGrid(rows, { deactivateMissing: true });
  await markSheetSeen("seen:membership", change.token);
  return count;
}

/**
 * THE MEMBERSHIP IMPORT, FROM ANY GRID (v37.2) — the Google Sheet, or a file
 * uploaded in Sodio. One implementation, so an upload obeys every rule the
 * sheet import learned: columns found by header, shifted rows refused,
 * identity by email or exact phone, renames cascading, promotions releasing
 * sign-ups, stale plans pruned, and — with `deactivateMissing` — everyone not
 * on the list marked inactive (the "restart the membership" of a new peak).
 * Returns the number of member rows read; 0 when the header isn't recognised.
 */
export async function applyMembershipGrid(
  rows: string[][],
  opts: { deactivateMissing: boolean }
): Promise<number> {
  const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  // an email-less member is matched to their DB row by phone tail
  const findPhoneKeyed = async (
    phone: string
  ): Promise<{ id: string; isActive: boolean; name: string; role: string } | null> => {
    const digits = digitsOf(phone);
    if (digits.length < 7) return null;
    const { data } = await db()
      .from("members")
      .select("id, name, role, phone, is_active")
      .is("email", null)
      .not("phone", "is", null)
      .ilike("phone", `%${digits.slice(-8)}%`)
      .limit(10);
    const rows = (data ?? []) as {
      id: string; name: string; role: string; phone: string | null; is_active: boolean;
    }[];
    // exact digits first — a shared tail must never merge two people; ACTIVE
    // rows win ties so a deactivated duplicate can't shadow the live identity
    const pick = (cands: typeof rows) =>
      cands.find((m) => m.is_active) ?? cands[0] ?? null;
    const exacts = rows.filter((m) => digitsOf(m.phone) === digits);
    const exact = pick(exacts);
    if (exact) return { id: exact.id, isActive: exact.is_active, name: exact.name, role: exact.role };
    const tail = digits.slice(-9);
    const tails = rows.filter((m) => digitsOf(m.phone).endsWith(tail));
    const hit = pick(tails);
    return hit ? { id: hit.id, isActive: hit.is_active, name: hit.name, role: hit.role } : null;
  };

  // The email-REMOVAL transition (v33.15): a member's email was taken off the
  // sheet but their DB row still carries it, so findPhoneKeyed (email-null
  // rows only) misses them and the import used to INSERT a duplicate — which
  // the next run then deactivated, stranding the member's session on
  // /inactive. Adopt the existing row instead: EXACT full-digit phone match
  // only, and only when that row's email appears NOWHERE on the sheet — both
  // guards together mean this can never merge two people sharing a tail.
  const findEmailRowByExactPhone = async (
    phone: string,
    sheetEmails: Set<string>
  ): Promise<string | null> => {
    const digits = digitsOf(phone);
    if (digits.length < 7) return null;
    const { data } = await db()
      .from("members")
      .select("id, phone, email")
      .not("email", "is", null)
      .not("phone", "is", null)
      .ilike("phone", `%${digits.slice(-8)}%`)
      .limit(10);
    const rows = (data ?? []) as { id: string; phone: string | null; email: string | null }[];
    const exact = rows.find(
      (m) =>
        digitsOf(m.phone) === digits &&
        !sheetEmails.has((m.email ?? "").trim().toLowerCase())
    );
    return exact?.id ?? null;
  };

  // the FIRST row is the header — it decides where every field lives
  const cols = mapColumns((rows[0] ?? []) as string[]);
  if (cols.name === undefined || (cols.email === undefined && cols.phone === undefined)) {
    console.error("[sheets] membership header not recognised — import aborted", rows[0]);
    return 0;
  }
  const dataRows = rows.slice(1);

  // every email present ANYWHERE on the sheet — the email-removal adoption
  // must know an email is truly gone, not merely sitting on a later row
  const allSheetEmails = new Set<string>();
  for (const raw of dataRows) {
    const e = cols.email !== undefined ? (raw[cols.email] ?? "").trim().toLowerCase() : "";
    if (e.includes("@")) allSheetEmails.add(e);
  }

  const seenEmails: string[] = [];
  const seenPhoneTails: string[] = [];
  /** members whose NAME changed in this run — their snapshots follow */
  const renamed: { id: string; name: string }[] = [];
  /** members whose ROLE changed Member/Coordinator → TL+ this run — their
   *  member-level sign-ups are released (v33.19) */
  const promoted: { id: string; oldRole: string; newRole: string }[] = [];
  let count = 0;
  for (const raw of dataRows) {
    const row = parseSheetRow(raw, cols);
    if (!row) continue;
    count += 1;
    if (row.email) {
      seenEmails.push(row.email);
      // "the email just landed": adopt the phone-keyed row instead of
      // inserting a duplicate — the member keeps their id, accounts, history
      const { data: existing } = await db()
        .from("members")
        .select("id, name, role")
        .ilike("email", row.email)
        .maybeSingle<{ id: string; name: string; role: string }>();
      // a corrected SPELLING must travel to the snapshot columns (v33.18) —
      // otherwise the old string keeps appearing in every filter built from
      // them ("Elina Tallat" beside "Elina Talaat")
      if (existing && existing.name !== row.name) renamed.push({ id: existing.id, name: row.name });
      if (existing && existing.role !== row.role)
        promoted.push({ id: existing.id, oldRole: existing.role, newRole: row.role });
      if (!existing && row.phone) {
        const phoneKeyed = await findPhoneKeyed(row.phone);
        if (phoneKeyed) {
          await db().from("members").update(row).eq("id", phoneKeyed.id);
          continue;
        }
        // the email was CHANGED on the sheet (typo fix, domain move): the old
        // email-bearing row won't match by email OR by findPhoneKeyed
        // (email-null only) — adopt it by exact phone; its old email is by
        // definition absent from the sheet, so the guard holds
        const adoptId = await findEmailRowByExactPhone(row.phone, allSheetEmails);
        if (adoptId) {
          await db().from("members").update({ ...row, left_at: null }).eq("id", adoptId);
          continue;
        }
      }
      // back on the sheet = back in the LC: clear the archive stamp
      await db().from("members").upsert({ ...row, left_at: null }, { onConflict: "email" });
    } else {
      // phone-keyed row (no email yet)
      const tail = digitsOf(row.phone).slice(-9);
      if (tail) seenPhoneTails.push(tail);
      const phoneKeyed = row.phone ? await findPhoneKeyed(row.phone) : null;
      if (phoneKeyed && phoneKeyed.name !== row.name)
        renamed.push({ id: phoneKeyed.id, name: row.name });
      if (phoneKeyed && phoneKeyed.role !== row.role)
        promoted.push({ id: phoneKeyed.id, oldRole: phoneKeyed.role, newRole: row.role });
      if (phoneKeyed?.isActive) {
        await db().from("members").update({ ...row, left_at: null }).eq("id", phoneKeyed.id);
      } else {
        // email removed from the sheet? adopt the member's existing row
        // (keeps their id, accounts, sign-ups) and clear the email — the
        // sheet is the source of truth, and this opens the phone door.
        // This outranks REVIVING an inactive email-less row: a deactivated
        // duplicate must never shadow the identity that owns the history.
        const adoptId = row.phone
          ? await findEmailRowByExactPhone(row.phone, allSheetEmails)
          : null;
        if (adoptId)
          await db()
            .from("members")
            .update({ ...row, email: null, left_at: null })
            .eq("id", adoptId);
        else if (phoneKeyed)
          await db().from("members").update({ ...row, left_at: null }).eq("id", phoneKeyed.id);
        else await db().from("members").insert(row);
      }
    }
  }

  // spelling corrections reach ir_calls / touch_points / calendar_items /
  // sign-up assignments / manager-by-name (v33.18)
  if (renamed.length > 0) {
    const { cascadeMemberRename } = await import("@/server/data");
    for (const r of renamed)
      await cascadeMemberRename(r.id, r.name).catch((e) =>
        console.error("[sheets] rename cascade failed:", e)
      );
  }
  // a promotion to TL+ releases the member-level sign-up pool (v33.19)
  if (promoted.length > 0) {
    const { releaseSignupsOnPromotion } = await import("@/server/data");
    for (const p of promoted)
      await releaseSignupsOnPromotion(p.id, p.oldRole, p.newRole).catch((e) =>
        console.error("[sheets] promotion release failed:", e)
      );
  }

  await relinkStakeholders();
  await importTeams().catch((e) => console.error("[sheets] teams import failed:", e));
  // the standing teams follow from the membership — provision what the rules
  // imply, then mirror the whole registry back so the sheet shows it too
  await ensureDerivedTeams()
    .then(async (created) => {
      if (created === 0) return;
      const { data } = await db()
        .from("teams")
        .select("type, function_key, name")
        .order("type")
        .order("function_key")
        .order("name");
      await writeTeamsTab(
        (data ?? []) as { type: string; function_key: string; name: string }[]
      );
    })
    .catch((e) => console.error("[sheets] derived teams failed:", e));

  // the sheet is where role / function / sub-function moves actually happen,
  // so this is where a plan stops belonging to its owner (Consideration →
  // Raising, MM → Member, a function swap). Drop what no longer applies.
  await import("@/server/data")
    .then((d) => d.pruneStalePlans())
    .catch((e) => console.error("[sheets] plan prune failed:", e));

  // deactivate anyone removed from the sheet (admins stay; phone-keyed
  // members are recognized by their phone tail)
  if (opts.deactivateMissing && count > 0) {
    const { data: activeMembers } = await db()
      .from("members")
      .select("id, email, phone")
      .eq("is_active", true);
    for (const m of activeMembers ?? []) {
      const mail = (m.email ?? "").toLowerCase();
      const stillListed = mail
        ? seenEmails.includes(mail) || env.adminEmails.includes(mail)
        : seenPhoneTails.some((t) => digitsOf(m.phone).endsWith(t));
      if (!stillListed) {
        // GONE FROM THE SHEET = LEFT THE LC (v33.7). Deactivating them was
        // right; leaving them among the active members was not — the list is
        // the register, and an alumnus sitting in it makes every count and
        // every picker read as wrong. `left_at` moves them to the archive,
        // and coming back (their row reappearing in the sheet) clears it.
        await db()
          .from("members")
          .update({ is_active: false, left_at: new Date().toISOString() })
          .eq("id", m.id);
      }
    }
  }
  return count;
}

export interface MembershipPreviewLine {
  /** the line number in the file (the header is line 1) */
  line: number;
  name: string;
  email: string | null;
  action: "new" | "update" | "same" | "invalid";
  /** what would change, in words — "Role: Member → Team Leader" */
  changes: string[];
  reason?: string;
}

/** WHAT AN UPLOAD WOULD DO — without doing it (v37.2). The same parse and the
 *  same identity matching as `applyMembershipGrid`, so the preview and the
 *  apply can't disagree about who is new, who changes and who leaves. */
export async function previewMembershipGrid(
  rows: string[][],
  opts: { deactivateMissing: boolean }
): Promise<{
  headerProblem: string | null;
  lines: MembershipPreviewLine[];
  leaving: { name: string; email: string | null }[];
}> {
  const cols = mapColumns((rows[0] ?? []) as string[]);
  if (cols.name === undefined || (cols.email === undefined && cols.phone === undefined)) {
    return {
      headerProblem:
        "The first row must be the headers, with at least Name and Email (or Phone). Download the current membership to get the exact columns.",
      lines: [],
      leaving: [],
    };
  }
  const { data: members } = await db()
    .from("members")
    .select("id, name, email, phone, role, functions, sub_functions, stakeholder_name, is_active");
  const all = (members ?? []) as {
    id: string; name: string; email: string | null; phone: string | null; role: string;
    functions: string[] | null; sub_functions: string[] | null; stakeholder_name: string | null;
    is_active: boolean;
  }[];
  const digits = (x: string | null | undefined) => (x ?? "").replace(/\D/g, "");
  const byEmail = new Map(all.filter((m) => m.email).map((m) => [m.email!.toLowerCase(), m]));
  const matched = new Set<string>();
  const lines: MembershipPreviewLine[] = [];
  const fmtList = (a: string[] | null | undefined) => (a ?? []).join(", ") || "—";

  rows.slice(1).forEach((raw, i) => {
    if (raw.every((c) => !String(c ?? "").trim())) return; // a blank line
    const { row, reason } = parseSheetRowDetailed(raw, cols);
    const line = i + 2;
    if (!row) {
      const nameCell = cols.name !== undefined ? String(raw[cols.name] ?? "") : "";
      lines.push({ line, name: nameCell.trim() || "—", email: null, action: "invalid", changes: [], reason });
      return;
    }
    const existing =
      (row.email ? byEmail.get(row.email) : undefined) ??
      (row.phone ? all.find((m) => digits(m.phone) && digits(m.phone) === digits(row.phone)) : undefined);
    if (!existing) {
      lines.push({ line, name: row.name, email: row.email, action: "new", changes: [] });
      return;
    }
    matched.add(existing.id);
    const changes: string[] = [];
    const diff = (label: string, a: string, b: string) => {
      if (a !== b) changes.push(`${label}: ${a || "—"} → ${b || "—"}`);
    };
    diff("Name", existing.name, row.name);
    diff("Email", existing.email ?? "", row.email ?? "");
    diff("Phone", existing.phone ?? "", row.phone ?? "");
    diff("Role", existing.role, row.role);
    diff("Function", fmtList(existing.functions), fmtList(row.functions));
    diff("Sub function", fmtList(existing.sub_functions), fmtList(row.sub_functions));
    diff("Manager", existing.stakeholder_name ?? "", row.stakeholder_name ?? "");
    diff("Active", existing.is_active ? "Yes" : "No", row.is_active ? "Yes" : "No");
    lines.push({ line, name: row.name, email: row.email, action: changes.length ? "update" : "same", changes });
  });

  const anyValid = lines.some((l) => l.action !== "invalid");
  const leaving =
    opts.deactivateMissing && anyValid
      ? all
          .filter(
            (m) =>
              m.is_active &&
              !matched.has(m.id) &&
              !env.adminEmails.includes((m.email ?? "").toLowerCase())
          )
          .map((m) => ({ name: m.name, email: m.email }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
  return { headerProblem: null, lines, leaving };
}

/** THE SHEET AS A MIRROR (v37.2): rewrite "CRM — Membership" from Sodio in one
 *  go — every member, active and not, in the LC's 8 columns. Anyone reading
 *  the sheet sees the truth; nobody's edit there is read back while Sodio is
 *  the source. */
export async function mirrorMembershipToSheet(): Promise<number> {
  if (await sandboxSuppressed("membership sheet mirror")) return 0;
  const { data } = await db()
    .from("members")
    .select("name, email, phone, role, functions, sub_functions, stakeholder_name, is_active")
    .order("is_active", { ascending: false })
    .order("name");
  const rows = (data ?? []).map((m) => [
    m.name,
    m.email ?? "",
    m.phone ?? "",
    m.role,
    (m.functions ?? []).join(", "),
    (m.sub_functions ?? []).join(", "),
    m.stakeholder_name ?? "",
    m.is_active ? "Yes" : "No",
  ]);
  await overwriteSheet(
    "CRM — Membership",
    ["Name", "Email", "Phone", "Role", "Function", "Sub Function", "Manager", "Active"],
    rows
  );
  return rows.length;
}

// ------------------------------------------------------------------ teams

/** Reads the "Teams" TAB of the Membership spreadsheet and upserts the teams
 *  table (names only — the membership derives who's in each team). Best-effort. */
export async function importTeams(): Promise<number> {
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS);
  // NO TAB, NO IMPORT (v33.53) — the registry is retired, and re-creating the
  // tab the LC deleted would undo their own edit twice an hour.
  const tab = await findTab(id, TEAMS_TAB);
  if (!tab) return 0;
  const { sheets } = clients();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${tab}'!A2:C200`,
  });
  const rows = (res.data.values ?? []) as string[][];

  // sheet wording → stored type (5 types since v24.2; "MM" is the legacy
  // alias of "Function leaders")
  const TYPE_ALIASES: Record<string, string> = {
    eb: "EB",
    lb: "LB",
    function: "Function",
    mm: "Function leaders",
    functionleaders: "Function leaders",
    team: "Team",
  };
  let count = 0;
  for (const raw of rows) {
    const [typeRaw, fnRaw, nameRaw] = raw;
    const name = (nameRaw ?? "").trim();
    const type = TYPE_ALIASES[(typeRaw ?? "").trim().toLowerCase().replace(/[^a-z]/g, "")];
    if (!name || !type) continue;
    const needsFn = type === "Function" || type === "Function leaders" || type === "Team";
    // multi-select cells arrive as "B2B, BD" — store one row per function
    const fnKeys = needsFn
      ? [...new Set((fnRaw ?? "").split(/[,;]+/).map((f) => f.trim().toUpperCase()).filter(Boolean))]
      : [""];
    for (const fnKey of fnKeys.length > 0 ? fnKeys : [""]) {
      // EB / LB / Function / Function leaders are SINGLE per (type, fn) — a
      // rename in the sheet replaces the old name. 'Team' is many per
      // function, so siblings must never be dropped.
      if (type !== "Team") {
        await db()
          .from("teams")
          .delete()
          .eq("type", type)
          .eq("function_key", fnKey)
          .neq("name", name);
      }
      await db()
        .from("teams")
        .upsert({ type, function_key: fnKey, name }, { onConflict: "type,function_key,name" });
      count += 1;
    }
  }
  return count;
}

/** The STANDING teams are a rule, not a list (v32.6).
 *
 *  The structure follows from the membership, so nobody should have to keep a
 *  registry in step with it by hand:
 *
 *    EB               every LCP + LCVP
 *    LB               every LCP / LCVP / Director / Team Leader / Coordinator
 *    <FN> function    everyone carrying that function
 *    <FN> leaders     that function's VP / Director / TLs / Coordinators
 *
 *  Membership is DERIVED at read time (`teamsForViewer`), so it can never
 *  drift. This makes sure the registry actually HAS a row for every team those
 *  rules imply — a function that appears in the Membership sheet gets its two
 *  teams automatically, named after itself until someone renames them. It only
 *  ever ADDS; a team someone named stays named, and 'Team' rows (a TL's own
 *  team) are never touched. */
export async function ensureDerivedTeams(): Promise<number> {
  const { data: members } = await db()
    .from("members")
    .select("role, functions, sub_functions")
    .eq("is_active", true);
  const rows = (members ?? []) as {
    role: string;
    functions: string[] | null;
    sub_functions: string[] | null;
  }[];

  // every function that actually has people. B2B and BD share a membership
  // TODAY, but they are separate functions on the sheet and may split into
  // separate crews in a future peak — so each keeps its own standing teams
  // rather than being folded together (v32.7).
  const fns = new Set<string>();
  for (const m of rows) {
    for (const f of [...(m.functions ?? []), ...(m.sub_functions ?? [])]) {
      const key = f.trim().toUpperCase();
      if (key && LC_FUNCTIONS.includes(key as (typeof LC_FUNCTIONS)[number]))
        fns.add(key);
    }
  }

  const wanted: { type: string; function_key: string; name: string }[] = [
    { type: "EB", function_key: "", name: "EB" },
    { type: "LB", function_key: "", name: "LB" },
  ];
  for (const fn of [...fns].sort()) {
    wanted.push({ type: "Function", function_key: fn, name: `${fn} function` });
    wanted.push({ type: "Function leaders", function_key: fn, name: `${fn} leaders` });
  }

  const { data: existing } = await db().from("teams").select("type, function_key");
  const have = new Set(
    ((existing ?? []) as { type: string; function_key: string }[]).map(
      (t) => `${t.type}:${t.function_key}`
    )
  );
  // 'MM' is the pre-v24.2 alias of 'Function leaders' — an LC still carrying
  // those rows must not get a duplicate
  for (const t of (existing ?? []) as { type: string; function_key: string }[]) {
    if (t.type === "MM") have.add(`Function leaders:${t.function_key}`);
  }

  let created = 0;
  for (const t of wanted) {
    if (have.has(`${t.type}:${t.function_key}`)) continue;
    const { error } = await db().from("teams").insert(t);
    if (error) console.error("[teams] could not create", t, error.message);
    else created += 1;
  }
  if (created > 0) console.log(`[teams] provisioned ${created} standing team(s)`);
  return created;
}

/** Rewrites the WHOLE Teams tab from the in-app registry (v24.2 — every
 *  type is editable in Sodio, so the DB is the source and the tab follows).
 *  Best-effort: callers .catch() and keep going. */
export async function writeTeamsTab(
  teams: { type: string; function_key: string; name: string }[]
): Promise<void> {
  if (await sandboxSuppressed("teams tab write-back")) return;
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS);
  // mirror the registry ONLY into a tab that still exists (v33.53)
  const tab = await findTab(id, TEAMS_TAB);
  if (!tab) return;
  const { sheets } = clients();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${tab}'!A2:C200`,
  });
  const existing = (res.data.values ?? []) as string[][];
  // EB/LB rows traditionally carry the type in the Function cell too
  const next: string[][] = teams.map((t) => [t.type, t.function_key || t.type, t.name]);
  while (next.length < existing.length) next.push(["", "", ""]);
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `'${tab}'!A2:C${next.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: next },
  });
}

// ------------------------------------------------------------------ write-back

/** Writes one member's row back to the Membership sheet (found by email —
 *  or, for members without one yet, by phone digits — appended if new) so
 *  in-app edits survive the next import. Best-effort: callers should .catch()
 *  and keep going — the DB row is already saved.
 *
 *  COLUMNS ARE RESOLVED BY HEADER (v33.15). The old writer assumed the
 *  pre-v33 10-column layout (with Nickname); after the Nickname column was
 *  deleted it could no longer FIND anyone's row (it read C:D expecting
 *  Email/Phone) and appended a one-column-shifted duplicate on every first
 *  sign-in — which the import's shifted-row guard then skipped forever. */
export async function writeMemberToSheet(m: MemberWriteBack): Promise<void> {
  if (await sandboxSuppressed("membership sheet write-back")) return;
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS);
  const { sheets } = clients();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: "A1:Z20000", // (v37.7) was A1:Z1000 — rows past 1000 were dropped/duplicated
  });
  const rows = (res.data.values ?? []) as string[][];
  const cols = mapColumns((rows[0] ?? []) as string[]);
  // never guess positions — a shifted write corrupts the row for every
  // future import. Throwing is safe: all callers .catch() and log.
  if (cols.name === undefined || (cols.email === undefined && cols.phone === undefined)) {
    throw new Error(
      "[sheets] membership header not recognised — write-back aborted " +
        "(sheet layout changed?): " + JSON.stringify(rows[0] ?? [])
    );
  }
  const dataRows = rows.slice(1);
  const digitsOf = (s: string) => s.replace(/\D/g, "");
  const cellAt = (r: string[], i: number | undefined) => (i === undefined ? "" : r[i] ?? "");
  const phoneRowIdx = () => {
    if (!m.phone) return -1;
    const tail = digitsOf(m.phone).slice(-9);
    if (!tail) return -1;
    return dataRows.findIndex(
      (r) => !cellAt(r, cols.email).trim() && digitsOf(cellAt(r, cols.phone)).endsWith(tail)
    );
  };
  let idx = -1;
  if (m.email) {
    idx = dataRows.findIndex(
      (r) => cellAt(r, cols.email).trim().toLowerCase() === m.email!.toLowerCase()
    );
    // the email just landed on a previously phone-only member: fill THEIR old
    // email-less row instead of appending a duplicate the import would re-adopt
    if (idx < 0) idx = phoneRowIdx();
  } else {
    idx = phoneRowIdx();
  }

  const out = buildMemberSheetRow(cols, idx >= 0 ? dataRows[idx] ?? [] : [], m);

  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `A${idx + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [out] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: "A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [out] },
    });
  }
}

// ------------------------------------------------------------------ export

export async function exportAllSheets(): Promise<void> {
  // Supabase caps one response at 1000 rows — since the v22 market-research
  // import the mirrors hold many thousands, so every read pages. The builder
  // must apply a stable order (id tiebreak: bulk imports share created_at).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageAll = async (build: () => any, max = 30000): Promise<any[]> => {
    const PAGE = 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any[] = [];
    for (let off = 0; off < max; off += PAGE) {
      const { data, error } = await build().range(off, off + PAGE - 1);
      if (error) throw error;
      const chunk = data ?? [];
      out.push(...chunk);
      if (chunk.length < PAGE) break;
    }
    return out;
  };
  const [accounts, contacts, visits, comments, manualArchived] = await Promise.all([
    // test accounts (and their contacts/visits) never reach the Drive mirrors
    pageAll(() =>
      db().from("accounts_pipeline").select("*").eq("is_test", false).order("created_at").order("id")
    ),
    pageAll(() =>
      db()
        .from("contact_attempts")
        .select("*, account:accounts!inner(name, is_test), member:members(name)")
        .eq("account.is_test", false)
        .order("created_at")
        .order("id")
    ),
    pageAll(() =>
      db()
        .from("visits")
        .select("*, account:accounts!inner(name, is_test), member:members(name)")
        .eq("account.is_test", false)
        .order("visit_date")
        .order("id")
    ),
    pageAll(() =>
      db()
        .from("account_comments")
        .select("*, member:members(name)")
        .order("created_at")
        .order("id")
    ),
    pageAll(() =>
      db()
        .from("blacklist")
        .select("*, added_by_member:members!blacklist_added_by_fkey(name)")
        .order("created_at")
        .order("id")
    ),
  ]);

  // numbered comments per account, flattened for the mirrors
  const commentText = new Map<string, string>();
  const counters = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of comments as any[]) {
    const key = `${c.account_id}:${c.author_label}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    const label = c.author_label === "Member" ? `Comment #${n}` : `${c.author_label} Comment #${n}`;
    const who = c.member?.name || "";
    const prev = commentText.get(c.account_id) ?? "";
    commentText.set(c.account_id, `${prev}${prev ? "\n" : ""}${label}${who ? ` (${who})` : ""}: ${c.body}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = accounts as any[];

  // one failing sheet (e.g. a transient Sheets API error) must NOT abort the
  // whole export — collect failures and keep going
  const failures: string[] = [];
  const safe = async (title: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      failures.push(title);
      console.error(`[sheets] export of "${title}" failed:`, e instanceof Error ? e.message : e);
    }
  };

  // ONE sheet for every account (IGV + IGT + B2B, active AND archived) — the
  // Function / Product / Archived? columns are the filter flags.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const productLabel = (a: any): string =>
    // ⚠️ v36 — AN UNCLAIMED ROW GETS A WORD, NOT A BLANK CELL. The research
    // pool carries no function until somebody claims it, and an empty cell
    // under a header reading "Function" is indistinguishable from a broken
    // export — which is exactly the kind of thing that gets reported as "the
    // sheet stopped working". It says what is true instead.
    a.function == null
      ? "Unclaimed"
      : a.function === "IGT"
        ? (a.product ? `I${a.product}` : "IGT")
        : a.function;

  // BD deals' MOS is money — total EGP per account. Pre-migration-0015 the
  // select returns an error (never throws) and the column just stays empty.
  const amountByAccount = new Map<string, number>();
  // (v37.7) Paged — an unpaged read stops at 1000 rows, understating amounts
  // past that. A failed read keeps the old behaviour (column stays empty)
  // rather than failing the whole export.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dealAmounts: any[] = [];
  try {
    dealAmounts = await pageAll(() => db().from("deals").select("account_id, amount").order("id"));
  } catch (e) {
    console.error("[sheets] deal amounts read failed:", e instanceof Error ? e.message : e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of dealAmounts as any[]) {
    if (d.amount > 0)
      amountByAccount.set(d.account_id, (amountByAccount.get(d.account_id) ?? 0) + d.amount);
  }

  await safe("CRM — Raising Accounts", () => overwriteSheet(
    "CRM — Raising Accounts",
    ["Account Name", "Function (IGV/IGT/B2B/BD/B2C · Unclaimed = nobody has taken it yet)",
      "Product", "Sub Product", "Project (IGV)",
     "Account Type", "Industry", "Responsible", "Team", "Stage", "Archived?", "Archive Reason",
     "Contacts", "Requested? (Podio)", "Request State", "Proposal Sent?", "Visit Date",
     "Visit Done?", "Deals", "Total Slots", "IGV Slots", "IGTa Slots", "IGTe Slots",
     "Deal Amount (EGP)", "Next Step", "Next Step Date", "Phone", "Email", "Social Link",
     "Website", "Comments", "Created At", MIRROR_NOTE],
    rows.map((a) => [
      a.name, a.function, productLabel(a), a.sub_product, a.project,
      a.account_type, a.industry, a.responsible_name || "Unassigned",
      a.responsible_team_name, a.stage,
      a.out_of_process ? "Yes" : "No", a.oop_reason,
      a.attempts, a.requested_podio ? "Yes" : "No", a.request_state,
      a.proposal_sent ? "Yes" : "No", a.visit_date,
      a.visit_done == null ? "" : a.visit_done ? "Yes" : "No",
      a.deals_count, a.slots_count, a.slots_igv_count, a.slots_igta_count, a.slots_igte_count,
      amountByAccount.get(a.id) || "",
      a.next_step, a.next_step_date, a.phone, a.email, a.social_link,
      a.website, commentText.get(a.id) ?? "", a.created_at?.slice(0, 16)?.replace("T", " "),
    ])
  ));

  await safe("CRM — Contact Log", () => overwriteSheet(
    "CRM — Contact Log",
    ["Date", "Account", "Member", "Method", "Status", "Comment", MIRROR_NOTE],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contacts as any[]).map((c) => [
      c.created_at?.slice(0, 16).replace("T", " "), c.account?.name, c.member?.name,
      c.method, c.status, c.comment,
    ])
  ));

  await safe("CRM — Visits", () => overwriteSheet(
    "CRM — Visits",
    ["Visit Date", "Time", "Account", "Member", "Done?", "Comment", "Next Step", MIRROR_NOTE],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (visits as any[]).map((v) => [
      v.visit_date, v.visit_time?.slice(0, 5), v.account?.name, v.member?.name,
      v.done == null ? "Pending" : v.done ? "Yes" : "No", v.visit_comment, v.next_step,
    ])
  ));

  // EVERY archived name in one clearly-labeled sheet: out-of-process accounts
  // (worked in the CRM, then closed) + manually archived names (burned before
  // the CRM existed). None of these can ever be added again. The archived
  // accounts ALSO appear in "CRM — Raising Accounts" flagged Archived = Yes —
  // this sheet is the focused blacklist view.
  const oopRows = rows
    .filter((a) => a.out_of_process)
    .map((a) => [
      a.name,
      productLabel(a),
      a.oop_reason,
      a.oop_at?.slice(0, 16)?.replace("T", " "),
      a.responsible_name || "Unassigned",
      "Worked in the CRM, then archived",
    ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manualRows = (manualArchived as any[]).map((b) => [
    b.account_name,
    "",
    b.comments,
    b.created_at?.slice(0, 16)?.replace("T", " "),
    b.added_by_member?.name || "",
    "Added manually to the archive",
  ]);
  await safe("CRM — Archived Accounts", () => overwriteSheet(
    "CRM — Archived Accounts",
    ["Account Name", "Product", "Archive Reason", "Archived At", "By / Was Responsible", "Source", MIRROR_NOTE],
    [...oopRows, ...manualRows]
  ));

  if (failures.length > 0)
    console.error(`[sheets] export finished with ${failures.length} failed sheet(s): ${failures.join(", ")}`);
}

// ====================================================================
// VP planning import — "Alexandria | Planning Tool" goal-setting tabs
// ====================================================================
//
// Term Feb→Jan. Each goal tab has two numeric blocks:
//   1. monthly overview — marker "here is the overview"; header row
//      Goal · February … January (+ Q1/Q2/S1/Q3/Q4/S2 totals, skipped);
//      7 metric rows in FIXED ORDER: Opens(i*)/SignUps(o*), Applicants,
//      Accepted, Approvals, Realised, Finished, Complete.
//   2. sprint block — marker "LC goal distribution by Sprints"; months ×
//      (Sprint 1, Sprint 2); same 7 rows. For i* the first row is the OPENS
//      split per sprint (verified against the monthly totals).
// Labels are template copy-paste (unreliable) — parse by ROW ORDER.
// The sheet must be shared (Viewer) with the service account.

const PLAN_TABS: { fn: string; tab: string }[] = [
  { fn: "IGV", tab: "🎯 iGV | goal setting" },
  { fn: "IGTa", tab: "🎯 iGTa | goal setting" },
  { fn: "IGTe", tab: "🎯 iGTe | goal setting" },
  { fn: "OGV", tab: "🎯 oGV | goal setting" },
  { fn: "OGTa", tab: "🎯 oGTa | goal setting" },
  { fn: "OGTe", tab: "🎯 oGTe | goal setting" },
];
const PLAN_MONTHS = ["February","March","April","May","June","July",
  "August","September","October","November","December","January"];
const PLAN_METRIC_ROWS = ["m1","applicants","accepted","approvals","realised","finished","complete"];

/** ISO first-of-month for a term anchored at `febYear` (Jan → febYear+1). */
function planMonthIso(month: string, febYear: number): string {
  const idx = PLAN_MONTHS.indexOf(month); // 0 = February … 11 = January
  return idx === 11
    ? `${febYear + 1}-01-01`
    : `${febYear}-${String(idx + 2).padStart(2, "0")}-01`;
}

function planNum(v: unknown): number {
  if (typeof v === "number" && isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(/[,%\s]/g, ""));
  return isFinite(n) ? n : 0;
}

/** Reads the planning sheet's id from app_settings (shared by every planning
 *  importer). Throws when it hasn't been seeded. */
async function planningSheetId(): Promise<string> {
  const { data: setting } = await db()
    .from("app_settings").select("value").eq("key", "planning:sheet-id").maybeSingle();
  const spreadsheetId =
    typeof setting?.value === "string" ? setting.value : (setting?.value as { id?: string })?.id;
  if (!spreadsheetId) throw new Error("planning:sheet-id is not set in app_settings.");
  return spreadsheetId;
}

/** The planning workbook's tabs, uploaded as a file instead of read from the
 *  Google Sheet (v37.2) — tab name → rows. The same parser reads both. */
export type PlanningGrids = Record<string, unknown[][]>;

/** One planning tab: from the uploaded workbook when one is given (tab names
 *  matched loosely — emoji, spaces and case aside), else from the sheet. */
async function readPlanningTab(
  spreadsheetId: string | null,
  tab: string,
  range: string,
  grids?: PlanningGrids
): Promise<unknown[][]> {
  if (grids) {
    const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = grids[tab] ?? Object.entries(grids).find(([k]) => key(k) === key(tab))?.[1];
    if (!hit) throw new Error("this tab isn't in the uploaded file");
    return hit;
  }
  const res = await clients().sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${tab}'!${range}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (res.data.values ?? []) as unknown[][];
}

/** Re-imports the six goal-setting tabs into plan_cells. Returns cell count.
 *  febYear anchors the term (default: current term — Feb of this year, or of
 *  last year when we're in January). `monthsFilter` restricts the import to a
 *  subset of PLAN_MONTHS (e.g. just the winter peak) — omit it for the full
 *  term, which is the right default for any future re-import. */
export async function importPlanningSheet(
  febYear?: number,
  monthsFilter?: string[],
  grids?: PlanningGrids
): Promise<{ cells: number; skipped: string[] }> {
  const spreadsheetId = grids ? null : await planningSheetId();

  // anchor the term in Cairo time (matches src/lib/plan.ts) — the term starts
  // in February, so a January import belongs to the PREVIOUS Feb-anchored term
  const cairoNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const year = febYear ?? (cairoNow.getMonth() === 0 ? cairoNow.getFullYear() - 1 : cairoNow.getFullYear());
  const months = monthsFilter?.length ? PLAN_MONTHS.filter((m) => monthsFilter.includes(m)) : PLAN_MONTHS;

  const skipped: string[] = [];
  const rows: { fn: string; scope: string; period_start: string; metric: string; value: number }[] = [];

  for (const { fn, tab } of PLAN_TABS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let grid: any[][];
    try {
      grid = await readPlanningTab(spreadsheetId, tab, "A1:AZ80", grids);
    } catch (e) {
      skipped.push(`${tab}: ${e instanceof Error ? e.message : "unreadable"}`);
      continue;
    }
    const m1 = fn.startsWith("O") ? "signups" : "opens";
    const rowText = (r: unknown[]) => r.map((c) => String(c ?? "")).join(" ");

    // ---- monthly block ----
    const hdrIdx = grid.findIndex(
      (r) => rowText(r).includes("February") && rowText(r).includes("Goal")
    );
    if (hdrIdx < 0) { skipped.push(`${tab}: monthly header not found`); continue; }
    const hdr = grid[hdrIdx].map((c) => String(c ?? "").trim());
    const monthColByName = new Map(PLAN_MONTHS.map((m) => [m, hdr.indexOf(m)]));
    if ([...monthColByName.values()].some((c) => c < 0)) { skipped.push(`${tab}: month columns missing`); continue; }
    PLAN_METRIC_ROWS.forEach((met, j) => {
      const r = grid[hdrIdx + 1 + j] ?? [];
      months.forEach((mName) => {
        rows.push({
          fn, scope: "month", period_start: planMonthIso(mName, year),
          metric: met === "m1" ? m1 : met, value: planNum(r[monthColByName.get(mName)!]),
        });
      });
    });

    // ---- sprint block ----
    const sIdx = grid.findIndex((r) => rowText(r).includes("LC goal distribution by Sprints"));
    if (sIdx < 0) { skipped.push(`${tab}: sprint block not found`); continue; }
    const sHdr = (grid[sIdx + 1] ?? []).map((c) => String(c ?? "").trim());
    const sMonthColByName = new Map(PLAN_MONTHS.map((m) => [m, sHdr.indexOf(m)]));
    if ([...sMonthColByName.values()].some((c) => c < 0)) { skipped.push(`${tab}: sprint month columns missing`); continue; }
    PLAN_METRIC_ROWS.forEach((met, j) => {
      const r = grid[sIdx + 3 + j] ?? [];
      months.forEach((mName) => {
        const base = sMonthColByName.get(mName)!;
        const monthIso = planMonthIso(mName, year);
        rows.push({
          fn, scope: "sprint", period_start: monthIso,
          metric: met === "m1" ? m1 : met, value: planNum(r[base]),
        });
        rows.push({
          fn, scope: "sprint", period_start: `${monthIso.slice(0, 8)}16`,
          metric: met === "m1" ? m1 : met, value: planNum(r[base + 1]),
        });
      });
    });
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db()
      .from("plan_cells")
      .upsert(
        rows.slice(i, i + 500).map((r) => ({ ...r, imported_at: new Date().toISOString() })),
        { onConflict: "fn,scope,period_start,metric" }
      );
    if (error) throw new Error(`plan_cells upsert failed: ${error.message}`);
  }
  return { cells: rows.length, skipped };
}

/** BD & B2B goal-setting tabs (v36.9): each sets ONE term-wide target, not a
 *  month/sprint funnel — a different shape from PLAN_TABS, so it's parsed
 *  separately and stored as plan_cells `scope='term'` rows keyed at the
 *  term's own February 1st.
 *   · BD ("🎯BD | goal setting"): "BD Goal 26.27" = the term revenue target
 *     (EGP), found by marker text, value one row below in the same column;
 *     "Contract signed" = the term deal-count target, 2 columns to its right
 *     (the row also carries a "/" conversion-rate placeholder in between —
 *     labels are template copy-paste, so this reads by fixed position off a
 *     found marker row, same caution as PLAN_TABS above).
 *   · B2B ("🎯B2B | goal setting"): one summary row headed "Revenue
 *     Generated" / "IGV Slots" / "IGta slots" / "IGte slots", values in the
 *     row below. The tab's funnel detail below this is riddled with #DIV/0!
 *     errors from unfilled cells — deliberately NOT read. */
export async function importBdB2bPlanning(
  febYear?: number,
  grids?: PlanningGrids
): Promise<{ cells: number; skipped: string[] }> {
  const spreadsheetId = grids ? null : await planningSheetId();
  const cairoNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const year = febYear ?? (cairoNow.getMonth() === 0 ? cairoNow.getFullYear() - 1 : cairoNow.getFullYear());
  const periodStart = `${year}-02-01`;

  const skipped: string[] = [];
  const rows: { fn: string; scope: string; period_start: string; metric: string; value: number }[] = [];
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

  try {
    const grid = await readPlanningTab(spreadsheetId, "🎯BD | goal setting", "A1:AZ20", grids);
    // the marker cell is "BD Goal 26.27" on its own, not a sentence ending in
    // those words — the instructions column above it ("...in your BD goal")
    // would also match a loose `includes`, and land on the wrong column
    const goalRowIdx = grid.findIndex((r) => r.some((c) => norm(c).startsWith("bd goal")));
    const goalCol = goalRowIdx >= 0 ? grid[goalRowIdx].findIndex((c) => norm(c).startsWith("bd goal")) : -1;
    if (goalCol >= 0) {
      rows.push({
        fn: "BD", scope: "term", period_start: periodStart, metric: "revenue",
        value: planNum((grid[goalRowIdx + 1] ?? [])[goalCol]),
      });
    } else skipped.push("🎯BD | goal setting: revenue goal not found");

    const contractRowIdx = grid.findIndex((r) => r.some((c) => norm(c) === "contract signed"));
    const contractCol = contractRowIdx >= 0 ? grid[contractRowIdx].findIndex((c) => norm(c) === "contract signed") : -1;
    if (contractCol >= 0) {
      // the row also carries a "/" conversion-rate placeholder immediately
      // after the label, so the target itself is 2 columns to its right
      rows.push({
        fn: "BD", scope: "term", period_start: periodStart, metric: "contracts",
        value: planNum(grid[contractRowIdx][contractCol + 2]),
      });
    } else skipped.push("🎯BD | goal setting: contract-signed target not found");
  } catch (e) {
    skipped.push(`🎯BD | goal setting: ${e instanceof Error ? e.message : "unreadable"}`);
  }

  try {
    const grid = await readPlanningTab(spreadsheetId, "🎯B2B | goal setting", "A1:AZ10", grids);
    const hdrIdx = grid.findIndex((r) => r.some((c) => norm(c) === "revenue generated"));
    if (hdrIdx >= 0) {
      const hdr = grid[hdrIdx].map((c) => norm(c));
      const valueRow = grid[hdrIdx + 1] ?? [];
      const metrics: [string, string][] = [
        ["revenue generated", "revenue"],
        ["igv slots", "slots_igv"],
        ["igta slots", "slots_igta"],
        ["igte slots", "slots_igte"],
      ];
      for (const [label, metric] of metrics) {
        const col = hdr.indexOf(label);
        if (col >= 0) {
          rows.push({ fn: "B2B", scope: "term", period_start: periodStart, metric, value: planNum(valueRow[col]) });
        } else skipped.push(`🎯B2B | goal setting: "${label}" column missing`);
      }
    } else skipped.push("🎯B2B | goal setting: summary row not found");
  } catch (e) {
    skipped.push(`🎯B2B | goal setting: ${e instanceof Error ? e.message : "unreadable"}`);
  }

  for (const r of rows) {
    const { error } = await db()
      .from("plan_cells")
      .upsert({ ...r, imported_at: new Date().toISOString() }, { onConflict: "fn,scope,period_start,metric" });
    if (error) throw new Error(`plan_cells upsert failed: ${error.message}`);
  }
  return { cells: rows.length, skipped };
}

export type { Member };
