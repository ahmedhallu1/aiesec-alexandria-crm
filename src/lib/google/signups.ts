import { db } from "@/lib/supabase";
import { clients } from "./sheets";
import { sandboxSuppressed } from "@/server/sandbox";
import type { OgxFunction, SignupComment, SignupRow } from "@/lib/types";

/** THE OGX SIGN-UP SYNC (v25). The LC's tracker sheets stay alive: Sodio
 *  imports every row (cron, 15 min) and writes each in-app edit straight back
 *  to the row's workflow cells. Row identity = (source tab, EP ID). Columns
 *  are resolved BY HEADER NAME (never index) so sheet-side column moves don't
 *  break the sync. Ownership rule: intake data is sheet-authoritative; once a
 *  sign-up is touched in Sodio (sodio_touched) the WORKFLOW fields belong to
 *  Sodio and imports stop overwriting them. */

export interface SignupTabConfig {
  source: string;
  fn: OgxFunction;
  batch: "new" | "old";
  spreadsheetId: string;
  tab: string;
}

export const SIGNUP_TABS: SignupTabConfig[] = [
  {
    source: "ogt_new",
    fn: "OGT",
    batch: "new",
    spreadsheetId: "1cI4aicSewADosDmB-Shq6p8z-QEgnrbZHH-ykgRrWQY",
    tab: "New SUs",
  },
  {
    source: "ogt_old",
    fn: "OGT",
    batch: "old",
    spreadsheetId: "1cI4aicSewADosDmB-Shq6p8z-QEgnrbZHH-ykgRrWQY",
    tab: "Old SUs",
  },
  {
    source: "ogv_old",
    fn: "OGV",
    batch: "old",
    spreadsheetId: "1R_l1Pt2QyvSVoLvTd9Oja5JQHB2iKNr8cKwWpNHUWD4",
    tab: "Old",
  },
  {
    source: "ogv_main",
    fn: "OGV",
    batch: "new",
    spreadsheetId: "1nB86zagRaxpLZgPnTyLji7QUXS8tSRB4-uF1Nrn2Yj8",
    tab: "Main",
  },
];

/** canonical field → the header spellings seen across the four tabs */
const HEADER_ALIASES: Record<string, string[]> = {
  ep_id: ["ep id"],
  name: ["name", "ep name"],
  signed_up_at: ["signed up at"],
  phone: ["phone"],
  email: ["email"],
  gender: ["gender"],
  dob: ["dob"],
  person_status: ["person status"],
  program: ["program"],
  referral: ["referral"],
  grad_year: ["grad year"],
  university: ["university"],
  background: ["backgrounds", "background"],
  home_lc: ["home lc"],
  campaign: ["campaign tag", "campaign"],
  assigned_name: ["assigned to"],
  contact_status: ["contact status", "contacted"],
  interested: ["interested", "intersted"],
  comment: ["comment", "comments"],
  time_stamp: ["time stamp"],
  vp_comment: ["vp comment"],
  country: ["country"],
  sub_product: ["sub product"],
  status: ["status"],
  out_of_process: ["out of process"],
  reasons_not_travel: ["reasons not to travel"],
  assigned_date: ["assigned date"],
  contacted_date: ["contacted date"],
};

const norm = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** header row → canonical-field → column index. Duplicate headers keep the
 *  FIRST occurrence — except person-status vs VP-status on OGV Main, where
 *  "Status" appears twice: the intake one sits before "Program", the VP one
 *  after "VP Comment"; we resolve that case explicitly. */
export function mapHeaders(headerRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const normed = headerRow.map((h) => norm(h));
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normed.indexOf(alias);
      if (idx >= 0 && !(field in map)) map[field] = idx;
    }
  }
  // OGV Main: two "Status" columns — intake (col ~7) AND the VP pick-list.
  // The VP one is the LAST occurrence; the intake one doubles as person_status.
  const statusIdxs = normed.flatMap((h, i) => (h === "status" ? [i] : []));
  if (statusIdxs.length > 1) {
    if (!("person_status" in map)) map.person_status = statusIdxs[0];
    map.status = statusIdxs[statusIdxs.length - 1];
  }
  return map;
}

/** How far right and down a tracker tab is read. The trackers are LIVING
 *  sheets — columns get appended (OGV Main is already 24 wide). The old bound
 *  stopped at AC/29, so the day someone adds five columns, everything past the
 *  edge would import as NULL with no error anywhere: exactly the shape of
 *  "the emails sometimes don't get parsed". Sheets only returns the cells that
 *  exist, so a generous bound costs nothing. Import and write-back share it —
 *  a narrower write-back range would leave rows the import can see unwritable. */
const TAB_RANGE = "A1:BZ30000";

/** Invisible junk that rides along with pasted values (zero-width space, ZWNJ,
 *  ZWJ, BOM) and non-breaking spaces. Left in place they make a value fail to
 *  compare equal to itself, so a row "changes" on every single import run. */
const stripInvisibles = (s: string) =>
  s.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[\u00A0\u202F]/g, " ");

/** One sheet cell → a stored value. NEVER shortens: whatever length the sheet
 *  holds is what lands in Postgres (`text`, no limit). Only the ends are
 *  trimmed and invisible characters dropped — an email like
 *  `p_<40 hex>@inbound.aiesec.org` (61 chars) arrives whole. */
const cell = (row: string[], idx: number | undefined): string | null => {
  if (idx === undefined) return null;
  const v = stripInvisibles(String(row[idx] ?? "")).trim();
  return v === "" ? null : v;
};

const yesish = (v: string | null) => !!v && /^(yes|y|true|✓)/i.test(v.trim());

/** The write-back emits "Yes — {reason}" into the Out of Process cell — the
 *  importer must round-trip that instead of swallowing the reason. */
const oopReasonFrom = (v: string | null): string | null => {
  if (!v) return null;
  const m = /^(?:yes|y|true|✓)\s*[—–-]\s*(.+)$/i.exec(v.trim());
  if (m) return m[1].trim();
  return yesish(v) ? null : v.trim();
};

/** Best-effort parse of the sheets' legacy date cells ("2/9/2026",
 *  "2025-12-03", "9 Feb 2026 14:00") → ISO, else null (cell left alone). */
const parseSheetDate = (v: string | null): string | null => {
  if (!v) return null;
  const t = v.trim();
  let d: Date | null = null;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (mdy) d = new Date(Date.UTC(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]), 12));
  else {
    const parsed = new Date(t);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

interface MemberLite {
  id: string;
  name: string;
  nickname: string | null;
  is_active: boolean;
}

/** Loose sheet-name → member matching ("menna ahmed", "Yaseen", "A.Samir"):
 *  exact full name → exact nickname → unique first-token prefix. */
export function matchMemberByName(raw: string | null, members: MemberLite[]): string | null {
  const q = norm(raw ?? "");
  if (!q) return null;
  // full name or nickname, exactly
  const exact = members.find((m) => norm(m.name) === q || norm(m.nickname ?? "") === q);
  if (exact) return exact.id;

  // v29: a BARE FIRST NAME is never enough. "Ahmed" on a tracker row used to
  // resolve to whichever Ahmed happened to be the only prefix hit — which
  // handed 100 OGV sign-ups to the wrong person. A multi-token name may still
  // match on first+last tokens; a single token is left UNMATCHED (the row
  // keeps its raw assigned_name until a leader assigns it properly).
  const toks = q.split(" ").filter(Boolean);
  if (toks.length < 2) return null;
  const first = toks[0];
  const last = toks[toks.length - 1];
  const hits = members.filter((m) => {
    const mt = norm(m.name).split(" ").filter(Boolean);
    if (mt.length < 2) return false;
    return mt[0] === first && mt[mt.length - 1] === last;
  });
  return hits.length === 1 ? hits[0].id : null;
}

/** Imports every tab. New rows land whole (batched); rows never touched in
 *  Sodio track the sheet; touched rows only refresh their INTAKE columns.
 *  Row-diffing keeps the 15-min runs cheap: unchanged rows cost nothing. */
export async function importSignups(): Promise<{ imported: number; created: number }> {
  const { sheets } = clients();
  const { data: memberRows } = await db()
    .from("members")
    .select("id, name, nickname, is_active")
    .eq("is_active", true);
  const members = (memberRows ?? []) as MemberLite[];

  let imported = 0;
  let created = 0;

  for (const cfg of SIGNUP_TABS) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: `'${cfg.tab}'!${TAB_RANGE}`,
    });
    const rows = (res.data.values ?? []) as string[][];
    if (rows.length < 2) continue;
    const H = mapHeaders(rows[0]);
    if (H.ep_id === undefined || H.name === undefined) continue;

    // existing rows of this tab (full workflow+intake state for diffing)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = new Map<string, any>();
    for (let off = 0; ; off += 1000) {
      const { data } = await db()
        .from("signups")
        .select("*")
        .eq("source", cfg.source)
        .order("id")
        .range(off, off + 999);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (data ?? []) as any[]) existing.set(r.ep_id, r);
      if ((data ?? []).length < 1000) break;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inserts: any[] = [];
    const legacyByEp = new Map<string, { member: string | null; vp: string | null }>();
    const seenEpIds = new Set<string>();
    const sheetCommentChecks: SheetCommentCheck[] = [];

    for (const row of rows.slice(1)) {
      const epId = cell(row, H.ep_id);
      const name = cell(row, H.name);
      if (!epId || !name) continue;
      if (seenEpIds.has(epId)) continue; // duplicate EP ID in the tab — first wins
      seenEpIds.add(epId);

      const intake = {
        fn: cfg.fn,
        batch: cfg.batch,
        name,
        signed_up_at: cell(row, H.signed_up_at),
        phone: cell(row, H.phone),
        email: cell(row, H.email),
        gender: cell(row, H.gender),
        dob: cell(row, H.dob),
        person_status: cell(row, H.person_status),
        program: cell(row, H.program),
        referral: cell(row, H.referral),
        grad_year: cell(row, H.grad_year),
        university: cell(row, H.university),
        background: cell(row, H.background),
        home_lc: cell(row, H.home_lc),
        campaign: cell(row, H.campaign),
      };
      const rawAssigned = cell(row, H.assigned_name);
      const oopCell = cell(row, H.out_of_process);
      const statusCell = cell(row, H.status);
      const statusIsOop = !!statusCell && /out of process/i.test(statusCell);
      const workflow = {
        assigned_name: rawAssigned,
        assigned_to: matchMemberByName(rawAssigned, members),
        contact_status: cell(row, H.contact_status),
        interested: cell(row, H.interested),
        country: cell(row, H.country),
        sub_product: cell(row, H.sub_product),
        status: statusIsOop ? null : statusCell,
        out_of_process: !!oopCell || statusIsOop,
        oop_reason: oopReasonFrom(oopCell) ?? (statusIsOop ? statusCell : null),
        reasons_not_travel: cell(row, H.reasons_not_travel),
        // legacy tracker stamps — imported so the write-back never blanks them
        assigned_at: parseSheetDate(cell(row, H.assigned_date)),
        contacted_at: parseSheetDate(cell(row, H.contacted_date)),
      };

      const prior = existing.get(epId);
      if (!prior) {
        inserts.push({ source: cfg.source, ep_id: epId, ...intake, ...workflow });
        legacyByEp.set(epId, {
          member: cell(row, H.comment),
          vp: cell(row, H.vp_comment),
        });
        created++;
      } else {
        // touched rows keep their Sodio-stamped dates too
        const patch = prior.sodio_touched
          ? intake
          : {
              ...intake,
              ...workflow,
              ...(prior.assigned_at ? { assigned_at: prior.assigned_at } : {}),
              ...(prior.contacted_at ? { contacted_at: prior.contacted_at } : {}),
            };
        // update ONLY when something actually differs (keeps runs cheap)
        const changed = Object.entries(patch).some(
          ([k, v]) => (prior[k] ?? null) !== (v ?? null)
        );
        if (changed) {
          // .eq(sodio_touched, prior value): a claim/edit racing this import
          // must never be clobbered by our stale snapshot (TOCTOU guard) —
          // 0 affected rows just means the next 15-min run handles it
          const { error: upErr } = await db()
            .from("signups")
            .update(patch)
            .eq("id", prior.id)
            .eq("sodio_touched", prior.sodio_touched);
          if (upErr) {
            console.error(`[signups] update ${cfg.source}/${epId}:`, upErr.message);
            continue;
          }
        }
        // sheet-side COMMENT edits flow in too ("edits shown on both sides"):
        // compare the cells against what our log would render and capture the
        // difference as a "Sheet" entry
        sheetCommentChecks.push({
          signupId: prior.id,
          touched: !!prior.sodio_touched,
          memberCell: cell(row, H.comment),
          vpCell: cell(row, H.vp_comment),
        });
      }
      imported++;
    }

    await captureSheetComments(sheetCommentChecks);

    // batched inserts (500 a call) + the legacy comment-cell log entries
    for (let i = 0; i < inserts.length; i += 500) {
      const chunk = inserts.slice(i, i + 500);
      const { data: insertedRows, error } = await db()
        .from("signups")
        .insert(chunk)
        .select("id, ep_id");
      if (error) {
        console.error(`[signups] batch insert ${cfg.source}:`, error.message);
        continue;
      }
      const logs = ((insertedRows ?? []) as { id: string; ep_id: string }[]).flatMap((r) => {
        const legacy = legacyByEp.get(r.ep_id);
        return [
          ...(legacy?.member
            ? [{ signup_id: r.id, author_name: "Sheet", author_class: "member", body: legacy.member }]
            : []),
          ...(legacy?.vp
            ? [{ signup_id: r.id, author_name: "Sheet", author_class: "vp", body: legacy.vp }]
            : []),
        ];
      });
      for (let j = 0; j < logs.length; j += 500) {
        const { error: cErr } = await db()
          .from("signup_comments")
          .insert(logs.slice(j, j + 500));
        if (cErr) console.error(`[signups] legacy comments ${cfg.source}:`, cErr.message);
      }
    }
  }
  return { imported, created };
}

interface SheetCommentCheck {
  signupId: string;
  touched: boolean;
  memberCell: string | null;
  vpCell: string | null;
}

/** Sheet-typed comments must survive: for each existing row, compare the
 *  sheet's Comment / VP Comment cells with what our log would render —
 *  untouched rows REPLACE their "Sheet" entry when the cell changed; touched
 *  rows capture any text typed AFTER our rendered log (prefix remainder) as a
 *  fresh "Sheet" entry. Comments are bulk-loaded, so quiet runs cost one
 *  paged query per tab. */
async function captureSheetComments(checks: SheetCommentCheck[]): Promise<void> {
  const withCells = checks.filter((c) => c.memberCell || c.vpCell);
  if (withCells.length === 0) return;
  const byId = new Map(withCells.map((c) => [c.signupId, c]));

  // all comments for the involved sign-ups, paged in id chunks
  const ids = [...byId.keys()];
  const comments = new Map<string, SignupComment[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data } = await db()
      .from("signup_comments")
      .select("*")
      .in("signup_id", chunk)
      .order("created_at");
    for (const c of (data ?? []) as SignupComment[]) {
      const list = comments.get(c.signup_id) ?? [];
      list.push(c);
      comments.set(c.signup_id, list);
    }
  }

  for (const check of withCells) {
    const list = comments.get(check.signupId) ?? [];
    for (const cls of ["member", "vp"] as const) {
      const cellText = (cls === "member" ? check.memberCell : check.vpCell)?.trim();
      if (!cellText) continue;
      const expected = buildCommentCell(list, cls).trim();
      if (cellText === expected) continue;
      const clsComments = list.filter((c) => c.author_class === cls);
      const sheetEntry = clsComments.find((c) => c.author_name === "Sheet");
      if (!check.touched && clsComments.length <= 1) {
        // untouched row: the cell IS the log — keep the "Sheet" entry in sync
        if (sheetEntry) {
          await db()
            .from("signup_comments")
            .update({ body: cellText })
            .eq("id", sheetEntry.id);
        } else {
          await db().from("signup_comments").insert({
            signup_id: check.signupId,
            author_name: "Sheet",
            author_class: cls,
            body: cellText,
          });
        }
      } else if (expected && cellText.startsWith(expected)) {
        // someone typed AFTER our rendered log — capture the remainder
        const remainder = cellText.slice(expected.length).trim();
        if (remainder) {
          await db().from("signup_comments").insert({
            signup_id: check.signupId,
            author_name: "Sheet",
            author_class: cls,
            body: remainder,
          });
        }
      } else if (!expected) {
        // no log yet on this class — the whole cell is a new sheet comment
        await db().from("signup_comments").insert({
          signup_id: check.signupId,
          author_name: "Sheet",
          author_class: cls,
          body: cellText,
        });
      }
      // cell diverged in a way we can't merge cleanly → Sodio's log wins on
      // the next write-back (the ownership rule)
    }
  }
}

const fmtStamp = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  });

/** The organized per-class comment log written into ONE sheet cell. */
export function buildCommentCell(comments: SignupComment[], cls: "member" | "vp"): string {
  return comments
    .filter((c) => c.author_class === cls)
    .map((c) =>
      c.author_name === "Sheet"
        ? c.body
        : `[${fmtStamp(new Date(c.created_at))} — ${c.author_name}] ${c.body}`
    )
    .join("\n");
}

/** A Google Sheets CELL tops out at 50,000 characters and the API rejects the
 *  WHOLE batchUpdate when one value is over — a single sign-up with a very
 *  long comment log would silently kill the write-back for every row in the
 *  batch. Cap just under the limit, and say so in the cell so nobody thinks
 *  the log ended there (Elevate keeps the full history either way). */
const SHEET_CELL_MAX = 49_000;
const OVERFLOW_NOTE = "\n… (older entries are in Elevate — this cell is full)";

const fitCell = (value: string): string =>
  value.length <= SHEET_CELL_MAX
    ? value
    : // keep the NEWEST text: the log grows downwards, so trim from the top
      OVERFLOW_NOTE.trimStart() +
      "\n" +
      value.slice(value.length - (SHEET_CELL_MAX - OVERFLOW_NOTE.length));

const colLetter = (idx: number): string => {
  let s = "";
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

/** Writes ONE sign-up's workflow cells back to its sheet row (located by EP
 *  ID at write time — sheet-side row inserts can't break it). Best-effort:
 *  callers .catch() and keep going; the DB row is already saved. */
function signupCellValues(
  signup: SignupRow,
  comments: SignupComment[],
  assignedDisplay: string | null
): { field: string; value: string }[] {
  return rawCellValues(signup, comments, assignedDisplay).map((v) => ({
    field: v.field,
    // every written value passes the 50k cell ceiling — one oversized comment
    // log must not fail the batch for the rows next to it
    value: fitCell(v.value),
  }));
}

/** The workflow cells as Elevate knows them, before the length guard. */
function rawCellValues(
  signup: SignupRow,
  comments: SignupComment[],
  assignedDisplay: string | null
): { field: string; value: string }[] {
  return [
    { field: "assigned_name", value: assignedDisplay ?? signup.assigned_name ?? "" },
    { field: "contact_status", value: signup.contact_status ?? "" },
    { field: "interested", value: signup.interested ?? "" },
    { field: "comment", value: buildCommentCell(comments, "member") },
    { field: "vp_comment", value: buildCommentCell(comments, "vp") },
    { field: "country", value: signup.country ?? "" },
    { field: "sub_product", value: signup.sub_product ?? "" },
    {
      // v28: Applied/Accepted/Approved are SYSTEM-ONLY (the "potential"
      // pipeline lives in Elevate) — the sheet's status cell only ever
      // carries the OOP stamp now. Legacy sheet statuses still IMPORT fine
      // (the reader above is unchanged).
      field: "status",
      value: signup.out_of_process ? "Out of Process" : "",
    },
    {
      field: "out_of_process",
      value: signup.out_of_process
        ? signup.oop_reason
          ? `Yes — ${signup.oop_reason}`
          : "Yes"
        : "",
    },
    { field: "time_stamp", value: fmtStamp(new Date()) },
    // date cells only when Sodio KNOWS the date — a null stamp must never
    // blank the tracker's legacy history
    ...(signup.assigned_at
      ? [{ field: "assigned_date", value: fmtStamp(new Date(signup.assigned_at)) }]
      : []),
    ...(signup.contacted_at
      ? [{ field: "contacted_date", value: fmtStamp(new Date(signup.contacted_at)) }]
      : []),
  ];
}

export interface SignupBackEntry {
  signup: SignupRow;
  comments: SignupComment[];
  assignedDisplay: string | null;
}

/** Batched write-back (v26): bulk assigns push MANY rows — one tab read +
 *  ONE batchUpdate per tab instead of a full read/verify/write per row
 *  (50 rows would otherwise be ~150 Sheets calls). Returns the ep_ids it
 *  could NOT place (vanished rows — the import recreates them). */
export async function writeSignupsBackBatch(entries: SignupBackEntry[]): Promise<string[]> {
  if (entries.length === 0) return [];
  if (await sandboxSuppressed("signup sheet write-back (batch)")) return [];
  const { sheets } = clients();
  const missed: string[] = [];

  const bySource = new Map<string, SignupBackEntry[]>();
  for (const e of entries) {
    const list = bySource.get(e.signup.source) ?? [];
    list.push(e);
    bySource.set(e.signup.source, list);
  }

  for (const [source, group] of bySource) {
    const cfg = SIGNUP_TABS.find((t) => t.source === source);
    if (!cfg) continue;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: `'${cfg.tab}'!${TAB_RANGE}`,
      majorDimension: "ROWS",
    });
    const rows = (res.data.values ?? []) as string[][];
    const H = mapHeaders(rows[0] ?? []);
    if (H.ep_id === undefined) continue;
    const rowByEp = new Map<string, number>();
    rows.forEach((r, i) => {
      if (i > 0) {
        const ep = (r[H.ep_id] ?? "").trim();
        if (ep && !rowByEp.has(ep)) rowByEp.set(ep, i);
      }
    });

    const data: { range: string; values: string[][] }[] = [];
    for (const e of group) {
      const rowIdx = rowByEp.get(e.signup.ep_id);
      if (rowIdx === undefined) {
        missed.push(e.signup.ep_id);
        continue;
      }
      for (const v of signupCellValues(e.signup, e.comments, e.assignedDisplay)) {
        if (H[v.field] === undefined) continue;
        data.push({
          range: `'${cfg.tab}'!${colLetter(H[v.field])}${rowIdx + 1}`,
          values: [[v.value]],
        });
      }
    }
    if (data.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: cfg.spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
      });
    }
  }
  return missed;
}

export async function writeSignupBack(
  signup: SignupRow,
  comments: SignupComment[],
  assignedDisplay: string | null
): Promise<void> {
  if (await sandboxSuppressed("signup sheet write-back")) return;
  const cfg = SIGNUP_TABS.find((t) => t.source === signup.source);
  if (!cfg) return;
  const { sheets } = clients();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `'${cfg.tab}'!${TAB_RANGE}`,
    majorDimension: "ROWS",
  });
  const rows = (res.data.values ?? []) as string[][];
  const H = mapHeaders(rows[0] ?? []);
  if (H.ep_id === undefined) return;
  const rowIdx = rows.findIndex(
    (r, i) => i > 0 && (r[H.ep_id] ?? "").trim() === signup.ep_id
  );
  if (rowIdx < 0) return; // row vanished sheet-side — the import will recreate it

  const data = signupCellValues(signup, comments, assignedDisplay)
    .filter((v) => H[v.field] !== undefined)
    .map((v) => ({
      range: `'${cfg.tab}'!${colLetter(H[v.field])}${rowIdx + 1}`,
      values: [[v.value]],
    }));
  if (data.length === 0) return;
  // guard against a sheet-side sort/insert between our read and this write:
  // re-check that the located row still holds OUR EP ID
  const verify = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `'${cfg.tab}'!${colLetter(H.ep_id)}${rowIdx + 1}`,
  });
  const nowEp = ((verify.data.values ?? [])[0]?.[0] ?? "").trim();
  if (nowEp !== signup.ep_id) {
    console.warn(`[signups] row moved under us (${signup.ep_id} → ${nowEp}) — skipping write-back`);
    return; // the 15-min import will reconcile; better skipped than misplaced
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: cfg.spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}
