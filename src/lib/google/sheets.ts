import { google, sheets_v4, drive_v3 } from "googleapis";
import { db } from "@/lib/supabase";
import { env, requireEnv } from "@/lib/env";
import { sandboxSuppressed } from "@/server/sandbox";
import {
  normalizePhone, LC_FUNCTIONS, SUB_FUNCTIONS } from "@/lib/types";
import type { Member, MemberRole } from "@/lib/types";

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

/** Final Membership sheet structure (column order is the contract):
 *  A Name · B Nickname · C Email · D Phone · E Role · F Function (multi) ·
 *  G Sub Function (multi) · H Stakeholder (by NAME) · I Team Name · J Active */
const MEMBERSHIP_HEADERS = [
  "Name", "Nickname", "Email", "Phone",
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
const TEAMS_HEADERS = [
  "Type (EB / LB / Function / Function leaders / Team)",
  "Function (IGV/IGT/B2B…)",
  "Team Name",
];
const TEAMS_SEED = [
  ["EB", "EB", "IRIS"],
  ["LB", "LB", "شماريخ"],
  ["Function leaders", "IGT", "فرقة ناجي عطالله"],
  ["Function leaders", "B2B, BD", "Suits"],
  ["Function leaders", "IGV", "تملي معاك"],
];

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
async function ensureTab(
  spreadsheetId: string,
  title: string,
  headers: string[],
  seedRows: string[][] = []
): Promise<string> {
  const { sheets } = clients();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title))",
  });
  const existing = (meta.data.sheets ?? []).find(
    (s) => normTitle(s.properties?.title ?? "") === normTitle(title)
  )?.properties?.title;
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
  const tab = existing ?? title;
  const firstCell = await sheets.spreadsheets.values
    .get({ spreadsheetId, range: `'${tab}'!A1:B1` })
    .catch(() => null);
  if (!firstCell?.data.values?.[0]?.[0]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tab}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers, ...seedRows] },
    });
  }
  return tab;
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
};

function parseRole(raw: string | undefined): string {
  return ROLE_ALIASES[(raw ?? "").trim().toLowerCase()] ?? "Member";
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
  nickname: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  functions: string[];
  sub_functions: string[];
  stakeholder_name: string | null;
  team_name: string | null;
  is_active: boolean;
}

function parseSheetRow(row: string[]): SheetMemberRow | null {
  const [name, nickname, email, phone, role, fns, subs, stakeholder, teamName, active] = row;
  const cleanEmail = email?.trim().toLowerCase();
  const cleanPhone = phone?.trim();
  // email is OPTIONAL since v24 — a row needs a name plus an email OR a phone
  // (phone-only members sign in with their number until the email lands)
  if (!name?.trim()) return null;
  const hasEmail = !!cleanEmail && cleanEmail.includes("@");
  if (!hasEmail && !cleanPhone) return null;
  const phoneCheck = cleanPhone ? normalizePhone(cleanPhone) : null;
  return {
    name: name.trim(),
    nickname: nickname?.trim() || null,
    email: hasEmail ? cleanEmail : null,
    // canonical +digits when possible so every digit-tail matcher agrees;
    // unrecognized formats keep the raw value (stripped of separators)
    phone: phoneCheck?.ok ? phoneCheck.value : cleanPhone?.replace(/[^0-9+]/g, "") || null,
    role: parseRole(role),
    functions: parseMulti(fns, LC_FUNCTIONS),
    sub_functions: parseMulti(subs, SUB_FUNCTIONS),
    stakeholder_name: stakeholder?.trim() || null,
    team_name: teamName?.trim() || null,
    is_active: (active ?? "Yes").trim().toLowerCase() !== "no",
  };
}

interface LinkableMember {
  id: string;
  name: string;
  nickname: string | null;
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
export const MANAGER_ROLES: readonly string[] = ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"];

/** Resolves "Stakeholder" (Manager) names to member ids (name OR nickname),
 *  falling back to the default manager chain when the cell is empty or names
 *  someone who can't manage (a plain Member). */
async function relinkStakeholders(): Promise<void> {
  const { data: members } = await db()
    .from("members")
    .select("id, name, nickname, role, functions, stakeholder_name, stakeholder_id, is_active");
  const all = (members ?? []) as LinkableMember[];
  const byName = new Map<string, LinkableMember>();
  for (const m of all) {
    byName.set(m.name.trim().toLowerCase(), m);
    if (m.nickname) byName.set(m.nickname.trim().toLowerCase(), m);
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

/** Reads the Membership sheet and upserts the members table.
 *  Members missing from the sheet are deactivated (never deleted). */
export async function importMembership(): Promise<number> {
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS);
  const { sheets } = clients();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: "A2:J1000",
  });
  const rows = (res.data.values ?? []) as string[][];

  const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  // an email-less member is matched to their DB row by phone tail
  const findPhoneKeyed = async (phone: string): Promise<string | null> => {
    const digits = digitsOf(phone);
    if (digits.length < 7) return null;
    const { data } = await db()
      .from("members")
      .select("id, phone")
      .is("email", null)
      .not("phone", "is", null)
      .ilike("phone", `%${digits.slice(-8)}%`)
      .limit(10);
    const rows = (data ?? []) as { id: string; phone: string | null }[];
    // exact digits first — a shared tail must never merge two people
    const exact = rows.find((m) => digitsOf(m.phone) === digits);
    if (exact) return exact.id;
    const tail = digits.slice(-9);
    return rows.find((m) => digitsOf(m.phone).endsWith(tail))?.id ?? null;
  };

  const seenEmails: string[] = [];
  const seenPhoneTails: string[] = [];
  let count = 0;
  for (const raw of rows) {
    const row = parseSheetRow(raw);
    if (!row) continue;
    count += 1;
    if (row.email) {
      seenEmails.push(row.email);
      // "the email just landed": adopt the phone-keyed row instead of
      // inserting a duplicate — the member keeps their id, accounts, history
      const { data: existing } = await db()
        .from("members")
        .select("id")
        .ilike("email", row.email)
        .maybeSingle<{ id: string }>();
      if (!existing && row.phone) {
        const phoneKeyedId = await findPhoneKeyed(row.phone);
        if (phoneKeyedId) {
          await db().from("members").update(row).eq("id", phoneKeyedId);
          continue;
        }
      }
      await db().from("members").upsert(row, { onConflict: "email" });
    } else {
      // phone-keyed row (no email yet)
      const tail = digitsOf(row.phone).slice(-9);
      if (tail) seenPhoneTails.push(tail);
      const phoneKeyedId = row.phone ? await findPhoneKeyed(row.phone) : null;
      if (phoneKeyedId) await db().from("members").update(row).eq("id", phoneKeyedId);
      else await db().from("members").insert(row);
    }
  }

  await relinkStakeholders();
  await importTeams().catch((e) => console.error("[sheets] teams import failed:", e));

  // deactivate anyone removed from the sheet (admins stay; phone-keyed
  // members are recognized by their phone tail)
  if (count > 0) {
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
        await db().from("members").update({ is_active: false }).eq("id", m.id);
      }
    }
  }
  return count;
}

// ------------------------------------------------------------------ teams

/** Reads the "Teams" TAB of the Membership spreadsheet and upserts the teams
 *  table (names only — the membership derives who's in each team). Best-effort. */
export async function importTeams(): Promise<number> {
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS);
  const tab = await ensureTab(id, TEAMS_TAB, TEAMS_HEADERS, TEAMS_SEED);
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

/** Rewrites the WHOLE Teams tab from the in-app registry (v24.2 — every
 *  type is editable in Sodio, so the DB is the source and the tab follows).
 *  Best-effort: callers .catch() and keep going. */
export async function writeTeamsTab(
  teams: { type: string; function_key: string; name: string }[]
): Promise<void> {
  if (await sandboxSuppressed("teams tab write-back")) return;
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS);
  const tab = await ensureTab(id, TEAMS_TAB, TEAMS_HEADERS, TEAMS_SEED);
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

export interface MemberWriteBack {
  name: string;
  nickname: string | null;
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

/** Writes one member's row back to the Membership sheet (found by email —
 *  or, for members without one yet, by phone digits — appended if new) so
 *  in-app edits survive the next import. Best-effort: callers should .catch()
 *  and keep going — the DB row is already saved. */
export async function writeMemberToSheet(m: MemberWriteBack): Promise<void> {
  if (await sandboxSuppressed("membership sheet write-back")) return;
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS);
  const { sheets } = clients();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: "C2:D1000", // emails + phones (the phone is the email-less fallback key)
  });
  const rows = (res.data.values ?? []) as string[][];
  const digitsOf = (s: string) => s.replace(/\D/g, "");
  const phoneRowIdx = () => {
    if (!m.phone) return -1;
    const tail = digitsOf(m.phone).slice(-9);
    return rows.findIndex(
      (r) => !((r[0] ?? "").trim()) && tail && digitsOf(r[1] ?? "").endsWith(tail)
    );
  };
  let idx = -1;
  if (m.email) {
    idx = rows.findIndex((r) => (r[0] ?? "").trim().toLowerCase() === m.email!.toLowerCase());
    // the email just landed on a previously phone-only member: fill THEIR old
    // email-less row instead of appending a duplicate the import would re-adopt
    if (idx < 0) idx = phoneRowIdx();
  } else {
    idx = phoneRowIdx();
  }

  const rowValues = [
    m.name,
    m.nickname ?? "",
    m.email ?? "",
    m.phone ?? "",
    m.role,
    m.functions.join(", "),
    m.sub_functions.join(", "),
    m.stakeholder_name ?? "",
    m.team_name ?? "",
    m.is_active ? "Yes" : "No",
  ];

  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `A${idx + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range: "A1:J1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
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
        .select("*, member:members(name, nickname)")
        .order("created_at")
        .order("id")
    ),
    pageAll(() =>
      db()
        .from("blacklist")
        .select("*, added_by_member:members!blacklist_added_by_fkey(name, nickname)")
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
    const who = c.member?.nickname || c.member?.name || "";
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
    a.function === "IGT" ? (a.product ? `I${a.product}` : "IGT") : a.function;

  // BD deals' MOS is money — total EGP per account. Pre-migration-0015 the
  // select returns an error (never throws) and the column just stays empty.
  const amountByAccount = new Map<string, number>();
  const { data: dealAmounts } = await db().from("deals").select("account_id, amount");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of (dealAmounts ?? []) as any[]) {
    if (d.amount > 0)
      amountByAccount.set(d.account_id, (amountByAccount.get(d.account_id) ?? 0) + d.amount);
  }

  await safe("CRM — Raising Accounts", () => overwriteSheet(
    "CRM — Raising Accounts",
    ["Account Name", "Function (IGV/IGT/B2B)", "Product", "Sub Product", "Project (IGV)",
     "Account Type", "Industry", "Responsible", "Team", "Stage", "Archived?", "Archive Reason",
     "Contacts", "Requested? (Podio)", "Request State", "Proposal Sent?", "Visit Date",
     "Visit Done?", "Deals", "Total Slots", "IGV Slots", "IGTa Slots", "IGTe Slots",
     "Deal Amount (EGP)", "Next Step", "Next Step Date", "Phone", "Email", "Social Link",
     "Website", "Comments", "Created At", MIRROR_NOTE],
    rows.map((a) => [
      a.name, a.function, productLabel(a), a.sub_product, a.project,
      a.account_type, a.industry, a.responsible_nickname || a.responsible_name || "Unassigned",
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
      a.responsible_nickname || a.responsible_name || "Unassigned",
      "Worked in the CRM, then archived",
    ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manualRows = (manualArchived as any[]).map((b) => [
    b.account_name,
    "",
    b.comments,
    b.created_at?.slice(0, 16)?.replace("T", " "),
    b.added_by_member?.nickname || b.added_by_member?.name || "",
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

/** Re-imports the six goal-setting tabs into plan_cells. Returns cell count.
 *  febYear anchors the term (default: current term — Feb of this year, or of
 *  last year when we're in January). */
export async function importPlanningSheet(febYear?: number): Promise<{ cells: number; skipped: string[] }> {
  const { data: setting } = await db()
    .from("app_settings").select("value").eq("key", "planning:sheet-id").maybeSingle();
  const spreadsheetId =
    typeof setting?.value === "string" ? setting.value : (setting?.value as { id?: string })?.id;
  if (!spreadsheetId) throw new Error("planning:sheet-id is not set in app_settings.");

  // anchor the term in Cairo time (matches src/lib/plan.ts) — the term starts
  // in February, so a January import belongs to the PREVIOUS Feb-anchored term
  const cairoNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const year = febYear ?? (cairoNow.getMonth() === 0 ? cairoNow.getFullYear() - 1 : cairoNow.getFullYear());

  const { sheets } = clients();
  const skipped: string[] = [];
  const rows: { fn: string; scope: string; period_start: string; metric: string; value: number }[] = [];

  for (const { fn, tab } of PLAN_TABS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let grid: any[][];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tab}'!A1:AZ80`,
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      grid = (res.data.values ?? []) as unknown[][];
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
    const monthCols = PLAN_MONTHS.map((m) => hdr.indexOf(m));
    if (monthCols.some((c) => c < 0)) { skipped.push(`${tab}: month columns missing`); continue; }
    PLAN_METRIC_ROWS.forEach((met, j) => {
      const r = grid[hdrIdx + 1 + j] ?? [];
      PLAN_MONTHS.forEach((mName, k) => {
        rows.push({
          fn, scope: "month", period_start: planMonthIso(mName, year),
          metric: met === "m1" ? m1 : met, value: planNum(r[monthCols[k]]),
        });
      });
    });

    // ---- sprint block ----
    const sIdx = grid.findIndex((r) => rowText(r).includes("LC goal distribution by Sprints"));
    if (sIdx < 0) { skipped.push(`${tab}: sprint block not found`); continue; }
    const sHdr = (grid[sIdx + 1] ?? []).map((c) => String(c ?? "").trim());
    const sMonthCols = PLAN_MONTHS.map((m) => sHdr.indexOf(m));
    if (sMonthCols.some((c) => c < 0)) { skipped.push(`${tab}: sprint month columns missing`); continue; }
    PLAN_METRIC_ROWS.forEach((met, j) => {
      const r = grid[sIdx + 3 + j] ?? [];
      PLAN_MONTHS.forEach((mName, k) => {
        const base = sMonthCols[k];
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

export type { Member };
