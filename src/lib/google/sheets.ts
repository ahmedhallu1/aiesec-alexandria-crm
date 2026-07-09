import { google, sheets_v4, drive_v3 } from "googleapis";
import { db } from "@/lib/supabase";
import { env, requireEnv } from "@/lib/env";
import { LC_FUNCTIONS, SUB_FUNCTIONS } from "@/lib/types";
import type { Member } from "@/lib/types";

/** Google Sheets mirror layer.
 *
 *  A service account owns the API access; all spreadsheets live in one Drive
 *  folder (DRIVE_FOLDER_ID) inside Ahmed's Drive, shared with the service
 *  account as Editor. The CRM creates each sheet on first use:
 *
 *  "CRM — Membership"      TWO-WAY — filled by hand AND updated by the in-app
 *                          membership editor; imported into the members table
 *  "CRM — IGV Accounts"    export mirror
 *  "CRM — IGT Accounts"    export mirror
 *  "CRM — Contact Log"     export mirror
 *  "CRM — Visits"          export mirror
 *  "CRM — Blacklist"       export mirror (legacy archive)
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
 *  means LC-wide (no specific function). */
function parseMulti(raw: string | undefined, allowed: readonly string[]): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,;/]+/)) {
    const clean = part.trim();
    if (!clean || clean.toUpperCase() === "LCP") continue;
    const hit = allowed.find((v) => v.toLowerCase() === clean.toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
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

/** Resolves "Stakeholder" names to member ids (matches name OR nickname). */
async function relinkStakeholders(): Promise<void> {
  const { data: members } = await db()
    .from("members")
    .select("id, name, nickname, stakeholder_name, stakeholder_id");
  const byName = new Map<string, string>();
  for (const m of members ?? []) {
    byName.set(m.name.trim().toLowerCase(), m.id);
    if (m.nickname) byName.set(m.nickname.trim().toLowerCase(), m.id);
  }
  for (const m of members ?? []) {
    const targetId = m.stakeholder_name
      ? byName.get(m.stakeholder_name.trim().toLowerCase()) ?? null
      : null;
    if (targetId !== m.stakeholder_id && targetId !== m.id) {
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
  const [{ data: accounts }, { data: contacts }, { data: visits }, { data: comments }] =
    await Promise.all([
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
  const igv = rows.filter((a) => a.function === "IGV");
  const igt = rows.filter((a) => a.function === "IGT");

  await overwriteSheet(
    "CRM — IGV Accounts",
    ["Account Name", "Project", "Account Type", "Industry", "Responsible",
     "Stage", "Contacts", "Requested? (Podio)", "Request State", "Proposal Sent?", "Visit Date",
     "Visit Done?", "Slot Raised?", "Slots", "Next Step", "Next Step Date", "Out of Process?",
     "OOP Reason", "Phone", "Email", "Social Link", "Website", "Comments", "Created At"],
    igv.map((a) => [
      a.name, a.project, a.account_type, a.industry,
      a.responsible_nickname || a.responsible_name, a.stage, a.attempts,
      a.requested_podio ? "Yes" : "No", a.request_state, a.proposal_sent ? "Yes" : "No",
      a.visit_date, a.visit_done == null ? "" : a.visit_done ? "Yes" : "No",
      a.slot_raised ? "Yes" : "No", a.slots_count, a.next_step, a.next_step_date,
      a.out_of_process ? "Yes" : "No", a.oop_reason, a.phone, a.email, a.social_link,
      a.website, commentText.get(a.id) ?? "", a.created_at?.slice(0, 10),
    ])
  );

  await overwriteSheet(
    "CRM — IGT Accounts",
    ["Account Name", "Product", "Sub Product", "Responsible", "Stage", "Contacts",
     "Requested? (Podio)", "Request State", "Visit Date", "Visit Done?", "Slot Raised?",
     "Slots", "Next Step", "Next Step Date", "Out of Process?", "OOP Reason", "Phone",
     "Email", "Social Link", "Website", "Comments", "Created At"],
    igt.map((a) => [
      a.name, a.product, a.sub_product, a.responsible_nickname || a.responsible_name,
      a.stage, a.attempts, a.requested_podio ? "Yes" : "No", a.request_state,
      a.visit_date, a.visit_done == null ? "" : a.visit_done ? "Yes" : "No",
      a.slot_raised ? "Yes" : "No", a.slots_count, a.next_step, a.next_step_date,
      a.out_of_process ? "Yes" : "No", a.oop_reason, a.phone, a.email, a.social_link,
      a.website, commentText.get(a.id) ?? "", a.created_at?.slice(0, 10),
    ])
  );

  await overwriteSheet(
    "CRM — Contact Log",
    ["Date", "Account", "Member", "Method", "Status", "Comment"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((contacts ?? []) as any[]).map((c) => [
      c.created_at?.slice(0, 16).replace("T", " "), c.account?.name, c.member?.name,
      c.method, c.status, c.comment,
    ])
  );

  await overwriteSheet(
    "CRM — Visits",
    ["Visit Date", "Time", "Account", "Member", "Done?", "Comment", "Next Step"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((visits ?? []) as any[]).map((v) => [
      v.visit_date, v.visit_time?.slice(0, 5), v.account?.name, v.member?.name,
      v.done == null ? "Pending" : v.done ? "Yes" : "No", v.visit_comment, v.next_step,
    ])
  );

  // The archive mirror: out-of-process accounts act as the blacklist.
  await overwriteSheet(
    "CRM — Blacklist",
    ["Account Name", "Function", "Project / Product", "Reason", "Archived At", "Responsible"],
    rows
      .filter((a) => a.out_of_process)
      .map((a) => [
        a.name, a.function, a.project ?? a.sub_product ?? a.product, a.oop_reason,
        a.oop_at?.slice(0, 10), a.responsible_nickname || a.responsible_name,
      ])
  );
}

export type { Member };
