import { google, sheets_v4, drive_v3 } from "googleapis";
import { db } from "@/lib/supabase";
import { env, requireEnv } from "@/lib/env";
import { LC_FUNCTIONS, SUB_FUNCTIONS } from "@/lib/types";
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
const TEAMS_HEADERS = ["Type (EB/LB/Function/MM)", "Function (IGV/IGT/B2B)", "Team Name"];
const TEAMS_SEED = [
  ["EB", "", "IRIS"],
  ["Function", "IGT", "فرقة ناجي عطالله"],
  ["Function", "B2B", "Suits"],
];

function clients(): { sheets: sheets_v4.Sheets; drive: drive_v3.Drive } {
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
  email: string;
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
  if (!name?.trim() || !cleanEmail || !cleanEmail.includes("@")) return null;
  return {
    name: name.trim(),
    nickname: nickname?.trim() || null,
    email: cleanEmail,
    phone: phone?.trim() || null,
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

/** Resolves "Stakeholder" (Manager) names to member ids (name OR nickname),
 *  falling back to the default manager chain when the cell is empty. */
async function relinkStakeholders(): Promise<void> {
  const { data: members } = await db()
    .from("members")
    .select("id, name, nickname, role, functions, stakeholder_name, stakeholder_id, is_active");
  const all = (members ?? []) as LinkableMember[];
  const byName = new Map<string, string>();
  for (const m of all) {
    byName.set(m.name.trim().toLowerCase(), m.id);
    if (m.nickname) byName.set(m.nickname.trim().toLowerCase(), m.id);
  }
  for (const m of all) {
    let targetId = m.stakeholder_name
      ? byName.get(m.stakeholder_name.trim().toLowerCase()) ?? null
      : null;
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

  const seen: string[] = [];
  for (const raw of rows) {
    const row = parseSheetRow(raw);
    if (!row) continue;
    seen.push(row.email);
    await db().from("members").upsert(row, { onConflict: "email" });
  }

  await relinkStakeholders();
  await importTeams().catch((e) => console.error("[sheets] teams import failed:", e));

  // deactivate anyone removed from the sheet (admins stay)
  if (seen.length > 0) {
    const { data: activeMembers } = await db().from("members").select("id, email").eq("is_active", true);
    for (const m of activeMembers ?? []) {
      const mail = m.email.toLowerCase();
      if (!seen.includes(mail) && !env.adminEmails.includes(mail)) {
        await db().from("members").update({ is_active: false }).eq("id", m.id);
      }
    }
  }
  return seen.length;
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

  // sheet wording → stored type ("Function leaders" = the MM team)
  const TYPE_ALIASES: Record<string, string> = {
    eb: "EB",
    lb: "LB",
    function: "Function",
    mm: "MM",
    functionleaders: "MM",
  };
  let count = 0;
  for (const raw of rows) {
    const [typeRaw, fnRaw, nameRaw] = raw;
    const name = (nameRaw ?? "").trim();
    const type = TYPE_ALIASES[(typeRaw ?? "").trim().toLowerCase().replace(/[^a-z]/g, "")];
    // "Team" rows are intentionally skipped — TL teams are named in the
    // Membership tab's Team Name column
    if (!name || !type) continue;
    const needsFn = type === "Function" || type === "MM";
    // multi-select cells arrive as "B2B, BD" — store one row per function
    const fnKeys = needsFn
      ? [...new Set((fnRaw ?? "").split(/[,;]+/).map((f) => f.trim().toUpperCase()).filter(Boolean))]
      : [""];
    for (const fnKey of fnKeys.length > 0 ? fnKeys : [""]) {
      await db()
        .from("teams")
        .upsert({ type, function_key: fnKey, name }, { onConflict: "type,function_key" });
      count += 1;
    }
  }
  return count;
}

// ------------------------------------------------------------------ write-back

export interface MemberWriteBack {
  name: string;
  nickname: string | null;
  email: string;
  phone: string | null;
  role: string;
  functions: string[];
  sub_functions: string[];
  stakeholder_name: string | null;
  team_name: string | null;
  is_active: boolean;
}

/** Writes one member's row back to the Membership sheet (found by email,
 *  appended if new) so in-app edits survive the next import. Best-effort:
 *  callers should .catch() and keep going — the DB row is already saved. */
export async function writeMemberToSheet(m: MemberWriteBack): Promise<void> {
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS);
  const { sheets } = clients();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: "C2:C1000", // emails
  });
  const emails = (res.data.values ?? []).map((r) => (r[0] ?? "").trim().toLowerCase());
  const idx = emails.findIndex((e) => e === m.email.toLowerCase());

  const rowValues = [
    m.name,
    m.nickname ?? "",
    m.email,
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
  const [
    { data: accounts },
    { data: contacts },
    { data: visits },
    { data: comments },
    { data: manualArchived },
  ] = await Promise.all([
    db().from("accounts_pipeline").select("*").order("created_at"),
    db()
      .from("contact_attempts")
      .select("*, account:accounts(name), member:members(name)")
      .order("created_at"),
    db()
      .from("visits")
      .select("*, account:accounts(name), member:members(name)")
      .order("visit_date"),
    db()
      .from("account_comments")
      .select("*, member:members(name, nickname)")
      .order("created_at"),
    db()
      .from("blacklist")
      .select("*, added_by_member:members!blacklist_added_by_fkey(name, nickname)")
      .order("created_at"),
  ]);

  // numbered comments per account, flattened for the mirrors
  const commentText = new Map<string, string>();
  const counters = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (comments ?? []) as any[]) {
    const key = `${c.account_id}:${c.author_label}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    const label = c.author_label === "Member" ? `Comment #${n}` : `${c.author_label} Comment #${n}`;
    const who = c.member?.nickname || c.member?.name || "";
    const prev = commentText.get(c.account_id) ?? "";
    commentText.set(c.account_id, `${prev}${prev ? "\n" : ""}${label}${who ? ` (${who})` : ""}: ${c.body}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (accounts ?? []) as any[];

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

  await safe("CRM — Raising Accounts", () => overwriteSheet(
    "CRM — Raising Accounts",
    ["Account Name", "Function (IGV/IGT/B2B)", "Product", "Sub Product", "Project (IGV)",
     "Account Type", "Industry", "Responsible", "Team", "Stage", "Archived?", "Archive Reason",
     "Contacts", "Requested? (Podio)", "Request State", "Proposal Sent?", "Visit Date",
     "Visit Done?", "Deals", "Total Slots", "IGV Slots", "IGTa Slots", "IGTe Slots",
     "Next Step", "Next Step Date", "Phone", "Email", "Social Link", "Website",
     "Comments", "Created At"],
    rows.map((a) => [
      a.name, a.function, productLabel(a), a.sub_product, a.project,
      a.account_type, a.industry, a.responsible_nickname || a.responsible_name,
      a.responsible_team_name, a.stage,
      a.out_of_process ? "Yes" : "No", a.oop_reason,
      a.attempts, a.requested_podio ? "Yes" : "No", a.request_state,
      a.proposal_sent ? "Yes" : "No", a.visit_date,
      a.visit_done == null ? "" : a.visit_done ? "Yes" : "No",
      a.deals_count, a.slots_count, a.slots_igv_count, a.slots_igta_count, a.slots_igte_count,
      a.next_step, a.next_step_date, a.phone, a.email, a.social_link,
      a.website, commentText.get(a.id) ?? "", a.created_at?.slice(0, 16)?.replace("T", " "),
    ])
  ));

  await safe("CRM — Contact Log", () => overwriteSheet(
    "CRM — Contact Log",
    ["Date", "Account", "Member", "Method", "Status", "Comment"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((contacts ?? []) as any[]).map((c) => [
      c.created_at?.slice(0, 16).replace("T", " "), c.account?.name, c.member?.name,
      c.method, c.status, c.comment,
    ])
  ));

  await safe("CRM — Visits", () => overwriteSheet(
    "CRM — Visits",
    ["Visit Date", "Time", "Account", "Member", "Done?", "Comment", "Next Step"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((visits ?? []) as any[]).map((v) => [
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
      a.responsible_nickname || a.responsible_name,
      "Worked in the CRM, then archived",
    ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const manualRows = ((manualArchived ?? []) as any[]).map((b) => [
    b.account_name,
    "",
    b.comments,
    b.created_at?.slice(0, 16)?.replace("T", " "),
    b.added_by_member?.nickname || b.added_by_member?.name || "",
    "Added manually to the archive",
  ]);
  await safe("CRM — Archived Accounts", () => overwriteSheet(
    "CRM — Archived Accounts",
    ["Account Name", "Product", "Archive Reason", "Archived At", "By / Was Responsible", "Source"],
    [...oopRows, ...manualRows]
  ));

  if (failures.length > 0)
    console.error(`[sheets] export finished with ${failures.length} failed sheet(s): ${failures.join(", ")}`);
}

export type { Member };
