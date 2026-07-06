import { google, sheets_v4, drive_v3 } from "googleapis";
import { db } from "@/lib/supabase";
import { env, requireEnv } from "@/lib/env";
import type { Member } from "@/lib/types";

/** Google Sheets mirror layer.
 *
 *  A service account owns the API access; all spreadsheets live in one Drive
 *  folder (DRIVE_FOLDER_ID) inside Ahmed's Drive, shared with the service
 *  account as Editor. The CRM creates each sheet on first use:
 *
 *  "CRM — Membership"      IMPORT — filled by hand, source of truth for users
 *  "CRM — IGV Accounts"    export mirror
 *  "CRM — IGT Accounts"    export mirror
 *  "CRM — Contact Log"     export mirror
 *  "CRM — Visits"          export mirror
 *  "CRM — Blacklist"       export mirror
 */

const MEMBERSHIP_HEADERS = [
  "Name", "Nickname", "Email", "Phone", "Function (IGV/IGT/OGV/OGT)",
  "Sub Function (Raising/Consideration/ICX/OGX)", "Role (LCP/VP/TL/Coordinator/Member)",
  "Stakeholder Email", "Team Name", "Active (Yes/No)",
];

// The current EB (changes each term — edit freely in the sheet).
const MEMBERSHIP_SEED = [
  ["Arwa Gouda", "Arwa", "arwagouda923@aiesec.net", "01204717268", "", "", "LCP", "", "", "Yes"],
  ["Omar Eldeeb", "El-DeeB", "omareldeeb123@aiesec.net", "01002200337", "IGT", "ICX", "VP", "arwagouda923@aiesec.net", "", "Yes"],
  ["Nada Assem", "Nada", "nadaassem@aiesec.net", "", "IGV", "ICX", "VP", "arwagouda923@aiesec.net", "", "Yes"],
  ["Yassin Hawash", "Hawash", "yassinamr@aiesec.net", "", "OGT", "OGX", "VP", "arwagouda923@aiesec.net", "", "Yes"],
  ["Barthinya", "Barthinya", "barthinya199@aiesec.net", "", "OGV", "OGX", "VP", "arwagouda923@aiesec.net", "", "Yes"],
  ["Ahmed Hallul", "Hallul", "ahmedhallul@aiesec.net", "01099019374", "IGT", "ICX", "Member", "omareldeeb123@aiesec.net", "", "Yes"],
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

const FUNCTIONS = ["IGV", "IGT", "OGV", "OGT"];
const SUB_FUNCTIONS = ["Raising", "Consideration", "ICX", "OGX"];
const ROLES = ["LCP", "VP", "TL", "Coordinator", "Member"];

function pick(list: string[], raw: string | undefined): string | null {
  if (!raw) return null;
  const hit = list.find((v) => v.toLowerCase() === raw.trim().toLowerCase());
  return hit ?? null;
}

/** Reads the Membership sheet and upserts the members table.
 *  Members missing from the sheet are deactivated (never deleted). */
export async function importMembership(): Promise<number> {
  const id = await ensureSpreadsheet("CRM — Membership", MEMBERSHIP_HEADERS, MEMBERSHIP_SEED);
  const { sheets } = clients();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: "A2:J1000",
  });
  const rows = (res.data.values ?? []) as string[][];

  const seen: string[] = [];
  for (const row of rows) {
    const [name, nickname, email, phone, fn, sub, role, stakeholderEmail, teamName, active] = row;
    const cleanEmail = email?.trim().toLowerCase();
    if (!name?.trim() || !cleanEmail || !cleanEmail.includes("@")) continue;
    seen.push(cleanEmail);
    await db()
      .from("members")
      .upsert(
        {
          email: cleanEmail,
          name: name.trim(),
          nickname: nickname?.trim() || null,
          phone: phone?.trim() || null,
          function: pick(FUNCTIONS, fn),
          sub_function: pick(SUB_FUNCTIONS, sub),
          role: pick(ROLES, role) ?? "Member",
          stakeholder_email: stakeholderEmail?.trim().toLowerCase() || null,
          team_name: teamName?.trim() || null,
          is_active: (active ?? "Yes").trim().toLowerCase() !== "no",
        },
        { onConflict: "email" }
      );
  }

  // resolve stakeholder links (second pass, emails now all exist)
  const { data: members } = await db().from("members").select("id, email, stakeholder_email, stakeholder_id");
  const byEmail = new Map((members ?? []).map((m) => [m.email.toLowerCase(), m.id]));
  for (const m of members ?? []) {
    const targetId = m.stakeholder_email ? byEmail.get(m.stakeholder_email) ?? null : null;
    if (targetId !== m.stakeholder_id) {
      await db().from("members").update({ stakeholder_id: targetId }).eq("id", m.id);
    }
  }

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

// ------------------------------------------------------------------ export

export async function exportAllSheets(): Promise<void> {
  const [{ data: accounts }, { data: contacts }, { data: visits }, { data: blacklist }] =
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
      db().from("blacklist").select("*, added_by_member:members(name)").order("created_at"),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (accounts ?? []) as any[];
  const igv = rows.filter((a) => a.function === "IGV");
  const igt = rows.filter((a) => a.function === "IGT");

  await overwriteSheet(
    "CRM — IGV Accounts",
    ["Account Name", "Project", "Account Type", "Industry", "Package Plan", "Responsible",
     "Stage", "Contacts", "Requested? (Podio)", "Request State", "Proposal Sent?", "Visit Date",
     "Visit Done?", "Slot Raised?", "Slots", "Next Step", "Next Step Date", "Out of Process?",
     "OOP Reason", "Phone", "Social Link", "Podio Link", "VP Comment", "TL Comment", "Created At"],
    igv.map((a) => [
      a.name, a.project, a.account_type, a.industry, a.package_plan,
      a.responsible_nickname || a.responsible_name, a.stage, a.attempts,
      a.requested_podio ? "Yes" : "No", a.request_state, a.proposal_sent ? "Yes" : "No",
      a.visit_date, a.visit_done == null ? "" : a.visit_done ? "Yes" : "No",
      a.slot_raised ? "Yes" : "No", a.slots_count, a.next_step, a.next_step_date,
      a.out_of_process ? "Yes" : "No", a.oop_reason, a.phone, a.social_link,
      a.podio_link, a.vp_comment, a.tl_comment, a.created_at?.slice(0, 10),
    ])
  );

  await overwriteSheet(
    "CRM — IGT Accounts",
    ["Account Name", "Product", "Sub Product", "Responsible", "Stage", "Contacts",
     "Requested? (Podio)", "Request State", "Visit Date", "Visit Done?", "Slot Raised?",
     "Slots", "Next Step", "Next Step Date", "Out of Process?", "OOP Reason", "Phone",
     "Social Link", "Podio Link", "VP Comment", "TL Comment", "Created At"],
    igt.map((a) => [
      a.name, a.product, a.sub_product, a.responsible_nickname || a.responsible_name,
      a.stage, a.attempts, a.requested_podio ? "Yes" : "No", a.request_state,
      a.visit_date, a.visit_done == null ? "" : a.visit_done ? "Yes" : "No",
      a.slot_raised ? "Yes" : "No", a.slots_count, a.next_step, a.next_step_date,
      a.out_of_process ? "Yes" : "No", a.oop_reason, a.phone, a.social_link,
      a.podio_link, a.vp_comment, a.tl_comment, a.created_at?.slice(0, 10),
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

  await overwriteSheet(
    "CRM — Blacklist",
    ["Account Name", "Project", "Comments", "Link", "Added By", "Added At"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((blacklist ?? []) as any[]).map((b) => [
      b.account_name, b.project, b.comments, b.link, b.added_by_member?.name,
      b.created_at?.slice(0, 10),
    ])
  );
}

export type { Member };
