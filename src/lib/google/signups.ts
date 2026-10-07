import { db } from "@/lib/supabase";
import { clients, serviceAccountEmail } from "./sheets";
import { sandboxSuppressed } from "@/server/sandbox";
import type { OgxFunction, SignupBatch, SignupComment, SignupRow } from "@/lib/types";

/** THE OGX SIGN-UP SYNC (v25). The LC's tracker sheets stay alive: Sodio
 *  imports every row (cron, 15 min) and writes each in-app edit straight back
 *  to the row's workflow cells. Row identity = (source tab, EP ID). Columns
 *  are resolved BY HEADER NAME (never index) so sheet-side column moves don't
 *  break the sync. Ownership rule: intake data is sheet-authoritative; once a
 *  sign-up is touched in Sodio (sodio_touched) the WORKFLOW fields belong to
 *  Sodio and imports stop overwriting them. */

export interface SignupTabConfig {
  /** row identity with ep_id — NEVER rename one: it would re-import the tab
   *  as brand-new rows and orphan every claim, comment and status on the old */
  source: string;
  fn: OgxFunction;
  batch: SignupBatch;
  spreadsheetId: string;
  tab: string;
  /** the tracker's Phone column lost its leading 0 (Sheets read "01012345678"
   *  as a number) — put it back on Egyptian mobiles so Call works, not just
   *  WhatsApp (v37.9: every OGV tab; v37.9.1: OGT too, so every tab) */
  restorePhoneZero?: boolean;
  /** a BLANK Campaign cell never clears a campaign Sodio already holds. The
   *  26.2 sheet arrived with Campaign Name empty on its first 1,519 rows (all
   *  Techne Summit) and those were tagged in Sodio, not on the sheet — without
   *  this the next import would wipe the tag. A filled cell still wins. */
  keepCampaignWhenBlank?: boolean;
}

/** OGV rotates its tracker each term (v37.9): "OGV 26.2 New Signups" is New,
 *  the 26.1 [New] "Main" tab became Old and the 26.1 [Old] "Old" tab Older.
 *  Their `source` keys stay what they were — only the batch label moved. */
export const SIGNUP_TABS: SignupTabConfig[] = [
  {
    source: "ogt_new",
    fn: "OGT",
    batch: "new",
    spreadsheetId: "1cI4aicSewADosDmB-Shq6p8z-QEgnrbZHH-ykgRrWQY",
    tab: "New SUs",
    restorePhoneZero: true,
  },
  {
    source: "ogt_old",
    fn: "OGT",
    batch: "old",
    spreadsheetId: "1cI4aicSewADosDmB-Shq6p8z-QEgnrbZHH-ykgRrWQY",
    tab: "Old SUs",
    restorePhoneZero: true,
  },
  {
    source: "ogv_old",
    fn: "OGV",
    batch: "older",
    spreadsheetId: "1R_l1Pt2QyvSVoLvTd9Oja5JQHB2iKNr8cKwWpNHUWD4",
    tab: "Old",
    restorePhoneZero: true,
  },
  {
    // "Alexandria - oGV Tracker 26.1 [New]" — New until v37.9
    source: "ogv_main",
    fn: "OGV",
    batch: "old",
    spreadsheetId: "1nB86zagRaxpLZgPnTyLji7QUXS8tSRB4-uF1Nrn2Yj8",
    tab: "Main",
    restorePhoneZero: true,
  },
  {
    // "Alexandria - OGV 26.2 New Signups" (v37.9). Not link-shared like the
    // 26.1 trackers: the service account was added as Editor by name.
    source: "ogv_262",
    fn: "OGV",
    batch: "new",
    spreadsheetId: "1Lgnl3XRQ4RbBgN6zLKSgkH6Jf-uYRDCFQmrsPkoPHRI",
    tab: "Main",
    restorePhoneZero: true,
    keepCampaignWhenBlank: true,
  },
];

/** canonical field → the header spellings seen across the tabs */
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
  // 26.2: the member who signed the EP up at the booth
  referral: ["referral", "aiesec representative"],
  grad_year: ["grad year"],
  university: ["university"],
  background: ["backgrounds", "background"],
  home_lc: ["home lc"],
  campaign: ["campaign tag", "campaign", "campaign name"],
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
  contacted_date: ["contacted date", "contact date"],
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

/** One tracker Phone cell → a stored phone, or null when it isn't one.
 *  Tracker placeholders ("-", "deleted phone number") are not phones — null,
 *  so the UI never renders dead Call/WhatsApp buttons. Arabic-Indic digits
 *  ("٠١٠٠…") become ASCII and bidi marks (a pasted RLM) go, or a real number
 *  failed the digit test. With `restoreZero`, a bare 10-digit Egyptian mobile
 *  ("1012345678" — the sheet ate the 0) gets its leading 0 back; anything
 *  else is kept exactly as typed. Pure — pinned by tests/signup-tabs.test.ts. */
export function trackerPhone(raw: string | null, restoreZero = false): string | null {
  if (!raw) return null;
  const p = raw
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g, "")
    .trim();
  if (!/\d/.test(p)) return null;
  if (restoreZero) {
    const compact = p.replace(/[\s-]/g, "");
    if (/^1[0125]\d{8}$/.test(compact)) return `0${compact}`;
  }
  return p;
}

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
  is_active: boolean;
  functions?: string[] | null;
  sub_functions?: string[] | null;
}

/** Loose sheet-name → member matching ("menna ahmed", "Yaseen", "A.Samir"):
 *  exact full name → exact nickname → unique first-token prefix. */
export function matchMemberByName(raw: string | null, members: MemberLite[]): string | null {
  const q = norm(raw ?? "");
  if (!q) return null;
  // full name or exactly
  // (v37.7) two members with the same full name are ambiguous — leave the row
  // unmatched for a leader to assign rather than picking whichever is first
  const exacts = members.filter((m) => norm(m.name) === q);
  if (exacts.length === 1) return exacts[0].id;
  if (exacts.length > 1) return null;

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
export async function importSignups(
  opts?: { force?: boolean }
): Promise<{ imported: number; created: number; skipped?: boolean }> {
  // NOTHING CHANGED → NOTHING TO IMPORT (v33.19). The tracker spreadsheets
  // sit untouched most of the day while this ran every 15 minutes and
  // re-parsed ~8,000 rows each time. One Drive metadata call per spreadsheet
  // answers it; the parse only happens when a sheet actually moved.
  const sheetIds = [...new Set(SIGNUP_TABS.map((t) => t.spreadsheetId))];
  const { sheetChangedSince, markSheetSeen } = await import("./sheets");
  const changes = opts?.force
    ? sheetIds.map((id) => ({ id, changed: true, token: null as string | null }))
    : await Promise.all(
        sheetIds.map(async (id) => ({
          id,
          ...(await sheetChangedSince(id, `seen:signups:${id}`)),
        }))
      );
  const changedIds = new Set(changes.filter((c) => c.changed).map((c) => c.id));
  if (changedIds.size === 0) return { imported: 0, created: 0, skipped: true };

  const { sheets } = clients();
  const { data: memberRows } = await db()
    .from("members")
    .select("id, name, is_active, functions, sub_functions")
    .eq("is_active", true);
  const members = (memberRows ?? []) as MemberLite[];

  let imported = 0;
  let created = 0;

  for (const cfg of SIGNUP_TABS) {
    if (!changedIds.has(cfg.spreadsheetId)) continue;
    // a tracker name may belong to someone who LEFT the function (moved to
    // BD, OGV↔OGT…) but is still active in the LC — they must not keep
    // collecting this function's sign-ups, so matching is scoped to the
    // tab's own function
    const fnMembers = members.filter((m) =>
      [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes(cfg.fn)
    );
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
      const { data, error: exErr } = await db()
        .from("signups")
        .select("*")
        .eq("source", cfg.source)
        .order("id")
        .range(off, off + 999);
      // (v37.7) a failed read must not look like "no existing rows" — every
      // sheet row would then look new and the tab would be marked seen. Throw
      // before markSheetSeen so the next run retries the whole tab.
      if (exErr) throw new Error(`signups import: existing-rows read failed (${cfg.source}): ${exErr.message}`);
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

      const prior = existing.get(epId);
      const campaignCell = cell(row, H.campaign);
      const intake = {
        fn: cfg.fn,
        batch: cfg.batch,
        name,
        signed_up_at: cell(row, H.signed_up_at),
        phone: trackerPhone(cell(row, H.phone), cfg.restorePhoneZero),
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
        campaign:
          campaignCell ?? (cfg.keepCampaignWhenBlank ? (prior?.campaign ?? null) : null),
      };
      const rawAssigned = cell(row, H.assigned_name);
      const oopCell = cell(row, H.out_of_process);
      const statusCell = cell(row, H.status);
      const statusIsOop = !!statusCell && /out of process/i.test(statusCell);
      const workflow = {
        assigned_name: rawAssigned,
        assigned_to: matchMemberByName(rawAssigned, fnMembers),
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
  // remember each spreadsheet's modifiedTime so the next run can skip it
  for (const c of changes) if (c.changed) await markSheetSeen(`seen:signups:${c.id}`, c.token);
  return { imported, created };
}

interface SheetCommentCheck {
  signupId: string;
  touched: boolean;
  memberCell: string | null;
  vpCell: string | null;
}

/** Every comment for these sign-ups, grouped by sign-up (v37.7). Ids go in
 *  chunks of 200 (a long .in() list overflows PostgREST's URL limit) and each
 *  chunk is paged past the API's 1000-row cap with a stable order. THROWS on
 *  any error — callers must never treat a failed read as "no comments". */
async function readCommentsFor(ids: string[]): Promise<Map<string, SignupComment[]>> {
  const out = new Map<string, SignupComment[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db()
        .from("signup_comments")
        .select("*")
        .in("signup_id", chunk)
        .order("created_at")
        .order("id")
        .range(off, off + 999);
      if (error) throw new Error(`signup_comments read failed: ${error.message}`);
      const page = (data ?? []) as SignupComment[];
      for (const c of page) {
        const list = out.get(c.signup_id) ?? [];
        list.push(c);
        out.set(c.signup_id, list);
      }
      if (page.length < 1000) break;
    }
  }
  return out;
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

  // all comments for the involved sign-ups, paged in id chunks. (v37.7) A
  // failed or truncated read would make `expected` wrong and re-insert
  // existing log text as duplicate "Sheet" comments — so skip the capture
  // for this run instead (the next run retries).
  let comments: Map<string, SignupComment[]>;
  try {
    comments = await readCommentsFor([...byId.keys()]);
  } catch (e) {
    console.error("[signups] comment capture skipped:", e instanceof Error ? e.message : e);
    return;
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
 *  the log ended there (Sodio keeps the full history either way). */
const SHEET_CELL_MAX = 49_000;
const OVERFLOW_NOTE = "\n… (older entries are in Sodio — this cell is full)";

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

/** The workflow cells as Sodio knows them, before the length guard. */
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
      // pipeline lives in Sodio) — the sheet's status cell only ever
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

// ------------------------------------------------ writing around protected cells

/** The bits of a Sheets `GridRange` / `ProtectedRange` the check reads. An
 *  absent bound is unbounded, exactly as Google means it (a whole-sheet
 *  protection carries only its sheetId). */
export interface GridRangeLite {
  startRowIndex?: number | null;
  endRowIndex?: number | null;
  startColumnIndex?: number | null;
  endColumnIndex?: number | null;
}
export interface ProtectedRangeLite {
  range?: GridRangeLite | null;
  unprotectedRanges?: GridRangeLite[] | null;
  /** a "show a warning" protection doesn't stop a write */
  warningOnly?: boolean | null;
  /** only visible to someone allowed to edit the range */
  editors?: { users?: string[] | null } | null;
}

const inGrid = (g: GridRangeLite, row: number, col: number) =>
  (g.startRowIndex ?? 0) <= row &&
  row < (g.endRowIndex ?? Infinity) &&
  (g.startColumnIndex ?? 0) <= col &&
  col < (g.endColumnIndex ?? Infinity);

/** Is this (0-based) cell closed to `me`? Pure — pinned by
 *  `tests/sheet-protection.test.ts`. */
export function isCellProtected(
  ranges: readonly ProtectedRangeLite[],
  row: number,
  col: number,
  me: string | null
): boolean {
  return ranges.some(
    (p) =>
      !p.warningOnly &&
      !(me && (p.editors?.users ?? []).some((u) => u.toLowerCase() === me)) &&
      (p.range ? inGrid(p.range, row, col) : true) &&
      !(p.unprotectedRanges ?? []).some((u) => inGrid(u, row, col))
  );
}

/** "AB12" → 0-based column index 27. */
function colIndexOf(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

type SheetsApi = ReturnType<typeof clients>["sheets"];
type CellWrite = { range: string; values: string[][] };

/** Batch-write, and when Google refuses because of protection, find the
 *  refused cells in as few calls as possible: Google names the first refused
 *  index (`data[7]`), so that one is dropped and the rest retried; without a
 *  name the batch is halved. Stops at `deadline` — whatever is left counts as
 *  refused and is retried on the next run. Returns the refused writes. */
async function writeNarrowing(
  sheets: SheetsApi,
  spreadsheetId: string,
  data: CellWrite[],
  deadline: number
): Promise<CellWrite[]> {
  if (data.length === 0) return [];
  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data },
    });
    return [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/protected/i.test(msg)) {
      // not a protection problem (quota, a vanished tab…) — say so, give up on
      // this batch, and let the next run retry it
      console.warn(`[signups] sheet write failed (${msg}) — ${data.length} cell(s) left for next run`);
      return data;
    }
    if (data.length === 1 || Date.now() > deadline) return data;
    const named = Number(/data\[(\d+)\]/.exec(msg)?.[1]);
    if (Number.isInteger(named) && named >= 0 && named < data.length) {
      const rest = [...data.slice(0, named), ...data.slice(named + 1)];
      return [data[named], ...(await writeNarrowing(sheets, spreadsheetId, rest, deadline))];
    }
    const mid = data.length >> 1;
    return [
      ...(await writeNarrowing(sheets, spreadsheetId, data.slice(0, mid), deadline)),
      ...(await writeNarrowing(sheets, spreadsheetId, data.slice(mid), deadline)),
    ];
  }
}

/** WRITE WHAT MAY BE WRITTEN, FAST (v36.2). Reads the tab's protected ranges
 *  once, leaves the cells closed to this service account alone, writes the rest
 *  in one batch and narrows down anything Google still refuses. Returns the
 *  1-based SHEET ROWS that did not fully land. */
async function writeCellsAvoidingProtection(
  sheets: SheetsApi,
  spreadsheetId: string,
  tab: string,
  data: CellWrite[]
): Promise<Set<number>> {
  let ranges: ProtectedRangeLite[] = [];
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields:
        "sheets(properties(title),protectedRanges(range,unprotectedRanges,warningOnly,editors(users)))",
    });
    ranges = (meta.data.sheets ?? []).find((s) => s.properties?.title === tab)
      ?.protectedRanges as ProtectedRangeLite[] ?? [];
  } catch (e) {
    // no protection map — the narrowing below still finds the closed cells
    console.warn(`[signups] couldn't read ${tab}'s protected ranges:`, e instanceof Error ? e.message : e);
  }

  const me = serviceAccountEmail();
  const cell = (range: string) => {
    const m = /!([A-Z]+)(\d+)$/.exec(range);
    return m ? { row: Number(m[2]), col: colIndexOf(m[1]) } : null;
  };
  const open: CellWrite[] = [];
  const closed: CellWrite[] = [];
  for (const d of data) {
    const c = cell(d.range);
    (c && isCellProtected(ranges, c.row - 1, c.col, me) ? closed : open).push(d);
  }

  const refused = [
    ...closed,
    ...(await writeNarrowing(sheets, spreadsheetId, open, Date.now() + 4 * 60_000)),
  ];
  if (refused.length > 0)
    console.warn(`[signups] ${refused.length} protected cell(s) on ${tab} left alone`);
  return new Set(refused.map((d) => cell(d.range)?.row ?? -1));
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
        // (v37.7) same cleaning the import applies (cell()) — otherwise an EP ID
        // with a zero-width char imports fine but is never found here
        const ep = stripInvisibles(r[H.ep_id] ?? "").trim();
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
      // ⚠️ ONE PROTECTED CELL MUST NOT LOSE THE WHOLE BATCH (v36) — AND MUST
      // NOT COST THE WHOLE RUN EITHER (v36.2). A `values.batchUpdate` is
      // all-or-nothing, and the LC protects ranges on its tracker, as it is
      // entitled to. v36's answer was to retry every cell on its own after a
      // refusal: correct, and so slow on the "Old" tab that the hourly export
      // hit GitHub's 10-minute limit and was cancelled on every run. Now the
      // protected cells are known BEFORE writing, the rest go in one batch, and
      // anything still refused is narrowed down in a handful of calls.
      const blockedRows = await writeCellsAvoidingProtection(
        sheets, cfg.spreadsheetId, cfg.tab, data
      );
      // map the blocked SHEET ROWS back to the ep_ids that own them, so the
      // caller can say which sign-ups are behind rather than just "some" —
      // and so the watermark never advances over a row that didn't land
      for (const e of group) {
        const rowIdx = rowByEp.get(e.signup.ep_id);
        if (rowIdx !== undefined && blockedRows.has(rowIdx + 1)) missed.push(e.signup.ep_id);
      }
    }
  }
  return missed;
}

/** THE HOURLY MIRROR — SIGN-UP EDITS STOPPED PAYING FOR GOOGLE (v36).
 *
 *  Every OGX edit used to push its own row to the tracker. It was already
 *  deferred with `after()`, so it did not block the RESPONSE — but it still
 *  ran inside the request's lifetime, and each push is a tab read plus a
 *  verify plus a write, three Google round trips for one dropdown change. A
 *  member working a list of thirty sign-ups paid ninety of them, and on the
 *  plan this LC is on that is measured in CPU seconds (v33.59).
 *
 *  ⚠️ AND NOBODY WAS READING THE OTHER END. The tracker sheets are worked in
 *  Sodio now; the write-back exists so the OGX crew's own spreadsheet stays a
 *  true mirror, which is an HOURLY need, not a per-keystroke one. Raising has
 *  worked exactly this way since v11 — edits are instant, `sheets-export`
 *  mirrors on the hour.
 *
 *  DIRTINESS IS `updated_at`, so this needs no new column and no flag anybody
 *  has to remember to set: every mutation already touches it. The watermark
 *  lives in `app_settings`.
 *
 *  ⚠️ A FAILED RUN DOES NOT ADVANCE IT — the throw happens before the upsert,
 *  so the same rows are retried next hour rather than silently dropped, which
 *  is the one way a mirror goes quietly wrong.
 *
 *  ⚠️ INDIVIDUAL MISSES DO advance it, deliberately, and are RETURNED instead.
 *  The two reasons a single row misses are permanent: its ep_id is not in the
 *  tracker at all (a referral, or a row the crew deleted), or its cells are
 *  PROTECTED — the LC does protect ranges on their sheet, which is their
 *  right. Holding the watermark for those would stall every later edit behind
 *  a row that can never be written. They come back in `missed` so the failure
 *  is visible in the cron's own response rather than inferred.
 *
 *  The window overlaps by a minute on purpose: `updated_at` is set by the
 *  database clock and read here against another, and re-writing a row that was
 *  already correct costs nothing.
 */
export async function exportDirtySignups(
  limit = 2000
): Promise<{ pushed: number; missed: string[]; since: string | null }> {
  const { db } = await import("@/lib/supabase");
  const KEY = "signups:last-export";

  const { data: mark } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle<{ value: { at?: string } | null }>();
  const since = mark?.value?.at ?? null;

  let q = db()
    .from("signups")
    .select("*")
    // only rows Sodio owns the workflow fields of — an untouched tracker row
    // has nothing of ours to mirror back (v25's ownership rule)
    .eq("sodio_touched", true)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (since) q = q.gt("updated_at", new Date(Date.parse(since) - 60_000).toISOString());
  const { data: rows, error } = await q;
  if (error) throw new Error(`signup export read failed: ${error.message}`);
  const signups = (rows ?? []) as SignupRow[];
  if (signups.length === 0) return { pushed: 0, missed: [], since };

  // comments and the assignee label, for every row in one pass each
  const ids = signups.map((s) => s.id);
  const memberIds = [...new Set(signups.map((s) => s.assigned_to).filter(Boolean))] as string[];
  // (v37.7) chunked + paged + throws on error: one uncapped .in() over up to
  // 1000 ids failed (URL too long) or truncated, and the ignored error then
  // blanked the sheet's Comment cells AND advanced the watermark.
  const byId = await readCommentsFor(ids);
  const [{ data: members }] = await Promise.all([
    memberIds.length > 0
      ? db().from("members").select("id, name").in("id", memberIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const nameOf = new Map(
    ((members ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name])
  );

  const missed = await writeSignupsBackBatch(
    signups.map((s) => ({
      signup: s,
      comments: byId.get(s.id) ?? [],
      assignedDisplay: s.assigned_to ? (nameOf.get(s.assigned_to) ?? s.assigned_name) : s.assigned_name,
    }))
  );

  // the watermark is the NEWEST row we just wrote — advanced only now, after
  // the batch actually returned
  const newest = signups[signups.length - 1]?.updated_at ?? since;
  if (newest)
    await db()
      .from("app_settings")
      .upsert({ key: KEY, value: { at: newest }, updated_at: new Date().toISOString() });

  return { pushed: signups.length - missed.length, missed, since };
}
