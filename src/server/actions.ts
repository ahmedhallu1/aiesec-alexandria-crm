"use server";

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import {
  allowedAccountFunctions,
  canEditAccount,
  canEditRequestState,
  canManageMembership,
  canSeeLcConcerns,
  canUseAdminTools,
  canReassignAccount,
  claimTargetFunction,
  isClaimableAccount,
  canManageArchive,
  commentLabel,
  reassignTargetScope,
} from "@/lib/rbac";
import { cairoDayIso, checkAccountName, getViewer, logAudit, type PipelineRow } from "./data";
import { recordUndo, sandboxSuppressed, snapshotForUndo } from "./sandbox";
// v29: every real piece of work stamps work_activity — the raw material of
// AUTOMATIC working-hours attendance (see src/server/attendance.ts)
import { stampWork } from "./attendance";
import { sendEmail } from "@/lib/google/gmail";
import { visitReportEmail } from "@/lib/email/templates";
import {
  buildVisitIcs,
  createVisitEvent,
  deleteFollowupEvent,
  deleteMailboxVisitEvent,
  deleteVisitEvent,
  getVisitsCalendarId,
  updateVisitEvent,
  upsertFollowupEvent,
  upsertMailboxVisitEvent,
} from "@/lib/google/calendar";
import {
  accountSlug,
  B2C_TYPES,
  podioDefaultDays,
  cleanPhone,
  EMAIL_RE,
  FEEDBACK_CATEGORIES,
  FEEDBACK_INBOX_EMAILS,
  guessEmailTag,
  guessLinkTag,
  LC_FUNCTIONS,
  MEMBER_ROLES,
  normalizePhone,
  PHONE_RE,
  SUB_FUNCTIONS,
  URL_RE,
} from "@/lib/types";
import type { AccountContact, Member, MemberRole, Visit } from "@/lib/types";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | {
      ok: false;
      error: string;
      code?: "duplicate" | "archived" | "next_step_required" | "forbidden";
      info?: Record<string, string | null>;
    };

const fail = (
  error: string,
  code?: "duplicate" | "archived" | "next_step_required" | "forbidden",
  info?: Record<string, string | null>
): ActionResult<never> => ({ ok: false, error, code, info });

async function loadAccount(id: string): Promise<PipelineRow | null> {
  const { data } = await db()
    .from("accounts_pipeline")
    .select("*")
    .eq("id", id)
    .maybeSingle<PipelineRow>();
  return data;
}

function refresh(accountId?: string) {
  revalidatePath("/", "layout");
  if (accountId) revalidatePath(`/accounts/${accountId}`);
}

/** Keeps the responsible's CALENDAR follow-up reminder in sync with the
 *  account's next step: an event at the next step's time (11:00 when only a
 *  date was set), updated on change, removed when the step is cleared, done
 *  or the account leaves the process. Best-effort — never blocks the action. */
async function syncNextStepReminder(accountId: string): Promise<void> {
  try {
    const account = await loadAccount(accountId);
    if (!account) return;
    const { data: owner } = await db()
      .from("members")
      .select("google_refresh_token")
      .eq("id", account.responsible_id)
      .maybeSingle<{ google_refresh_token: string | null }>();
    const token = owner?.google_refresh_token ?? null;

    const today = new Date().toISOString().slice(0, 10);
    const wanted =
      !account.out_of_process && !!account.next_step_date && account.next_step_date >= today;

    if (!wanted) {
      if (account.next_step_event_id) {
        await deleteFollowupEvent(token, account.next_step_event_id);
        await db().from("accounts").update({ next_step_event_id: null }).eq("id", accountId);
      }
      return;
    }

    const eventId = await upsertFollowupEvent(token, account.next_step_event_id ?? null, {
      accountName: account.name,
      step: account.next_step,
      date: account.next_step_date!,
      time: account.next_step_time,
      detailsUrl: `${env.appUrl}/accounts/${accountSlug(account.name)}`,
    });
    if (eventId !== account.next_step_event_id) {
      await db().from("accounts").update({ next_step_event_id: eventId }).eq("id", accountId);
    }
  } catch (e) {
    console.error("[calendar] next-step reminder sync failed:", e);
  }
}

// ------------------------------------------------------------------ field validation

const phoneField = z
  .string()
  .trim()
  .transform((v) => (v ? normalizePhone(v).value : v))
  .refine(
    (v) => !v || normalizePhone(v).ok,
    "Numbers must be Egyptian (01… mobile / 03… landline) or full international (+…)."
  )
  .nullish();

const emailField = z
  .string()
  .trim()
  .refine((v) => !v || EMAIL_RE.test(v), "That doesn't look like a valid email.")
  .nullish();

const linkField = z
  .string()
  .trim()
  .refine((v) => !v || URL_RE.test(v), "Links must start with http:// or https://")
  .nullish();

// ================================================================== accounts

const createAccountSchema = z.object({
  function: z.enum(["IGV", "IGT", "B2B", "BD", "B2C"]),
  name: z.string().trim().min(2, "Account name is required"),
  product: z.enum(["GTa", "GTe"]).nullish(),
  sub_product: z.string().trim().nullish(),
  project: z.string().trim().nullish(),
  account_type: z.string().trim().nullish(),
  industry: z.string().trim().nullish(),
  phone: phoneField,
  email: emailField,
  social_link: linkField,
  website: linkField,
  requested_podio: z.boolean().nullish(),
  comment: z.string().trim().nullish(),
  responsible_id: z.string().uuid().nullish(),
  contacts: z
    .array(
      z.object({
        tag: z.string().trim(),
        kind: z.enum(["phone", "email", "link"]),
        value: z.string().trim(),
      })
    )
    .nullish(),
});

/** Validates + normalizes tagged contacts; returns null + an error message on
 *  the first bad row. Empty rows are dropped. */
function cleanContacts(
  raw: AccountContact[] | null | undefined
): { list: AccountContact[]; error: string | null } {
  const list: AccountContact[] = [];
  for (const c of raw ?? []) {
    const value = (c.value ?? "").trim();
    if (!value) continue;
    const tag = (c.tag ?? "").trim() || (c.kind === "link" ? "Website" : "Contact");
    if (c.kind === "phone") {
      const check = normalizePhone(value);
      if (!check.ok) return { list, error: `"${tag}": ${check.error}` };
      list.push({ tag, kind: "phone", value: check.value });
    } else if (c.kind === "email") {
      if (!EMAIL_RE.test(value)) return { list, error: `"${tag}" email doesn't look valid.` };
      list.push({ tag, kind: "email", value });
    } else {
      if (!URL_RE.test(value)) return { list, error: `"${tag}" must be a link (https://…).` };
      list.push({ tag, kind: "link", value });
    }
  }
  return { list, error: null };
}

/** First-of-kind sync into the legacy single columns (sheet mirrors use them). */
function legacyContactColumns(list: AccountContact[]) {
  return {
    phone: list.find((c) => c.kind === "phone")?.value ?? null,
    email: list.find((c) => c.kind === "email")?.value ?? null,
    website:
      list.find((c) => c.kind === "link" && c.tag.toLowerCase() === "website")?.value ?? null,
    social_link:
      list.find((c) => c.kind === "link" && c.tag.toLowerCase() !== "website")?.value ?? null,
  };
}

export async function createAccount(
  input: z.infer<typeof createAccountSchema>,
  opts?: {
    /** the bulk import stamps ONCE for the whole run instead of per row */
    stampActivity?: boolean;
    /** how the account arrived — kept in the audit log so the account's
     *  History can say "added through the bulk import" (v31) */
    via?: "manual" | "import";
  }
): Promise<ActionResult<{ id: string; slug: string }>> {
  const viewer = await getViewer();
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const data = parsed.data;

  // FUNCTION GATE: IGV-only members can't add IGT accounts and vice versa;
  // B2B people add their accounts as B2B (raising for the whole ICX).
  if (!allowedAccountFunctions(viewer).includes(data.function))
    return fail(
      `You can only add ${allowedAccountFunctions(viewer).join(" / ") || "—"} accounts.`,
      "forbidden"
    );

  if (data.function === "IGT" && !data.product)
    return fail("Choose the product (Global Talent or Global Teacher).");
  if (data.function === "IGV" && !data.project)
    return fail("Choose the project for this IGV account.");
  // B2C accounts carry a TYPE (Courses / Events / Student activities) instead
  // of the account-type/industry pair (v23)
  if (data.function === "B2C" && !(B2C_TYPES as readonly string[]).includes(data.account_type ?? ""))
    return fail("Choose the B2C type (Courses / Events / Student activities).");

  // HARD RULE: an ACTIVE name is unique across EVERY function; the archive
  // block is world-aware (v23.2) — B2C is only blocked by its own archive
  const { duplicate, blacklisted } = await checkAccountName(data.name, data.function);
  if (blacklisted)
    return fail(
      `"${data.name}" is archived and cannot be added again.`,
      "archived",
      {
        project: blacklisted.project,
        reason: blacklisted.comments,
        link: blacklisted.link,
      }
    );
  if (duplicate && duplicate.out_of_process)
    return fail(
      `"${data.name}" was worked before and is archived (Out of Process) — it cannot be added again.`,
      "archived",
      {
        function: duplicate.function,
        reason: duplicate.oop_reason,
        archived_at: duplicate.oop_at?.slice(0, 10) ?? null,
        was_responsible:
          duplicate.responsible_nickname || duplicate.responsible_name || "Unassigned",
      }
    );
  if (duplicate)
    return fail(
      `This account already exists on ${duplicate.function} accounts.`,
      "duplicate",
      {
        function: duplicate.function,
        responsible:
          duplicate.responsible_nickname || duplicate.responsible_name || "Unassigned",
        stage: duplicate.stage,
        project: duplicate.project ?? duplicate.sub_product,
        created_at: duplicate.created_at?.slice(0, 10) ?? null,
      }
    );

  // members/coordinators always create for themselves; TL/VP/LCP may assign in scope
  let responsibleId = viewer.id;
  if (data.responsible_id && data.responsible_id !== viewer.id) {
    const targetOk = canReassignAccount(viewer, {
      function: data.function,
      responsible_id: data.responsible_id,
    });
    if (!targetOk) return fail("You can only assign accounts within your scope.", "forbidden");
    responsibleId = data.responsible_id;
  }

  // tagged contacts: either the dialog's rows (already auto-tagged in the
  // editor) or built from the flat fields — an import carries no tags, so the
  // same rules that run in the browser read the values here (ceo@… → CEO, an
  // instagram address → Instagram) and fall back to the neutral tag.
  const rawContacts: AccountContact[] =
    data.contacts && data.contacts.length > 0
      ? (data.contacts as AccountContact[])
      : ([
          ...(data.phone ? [{ tag: "Contact", kind: "phone" as const, value: data.phone }] : []),
          ...(data.email
            ? [{ tag: guessEmailTag(data.email) ?? "Contact", kind: "email" as const, value: data.email }]
            : []),
          ...(data.social_link
            ? [{ tag: guessLinkTag(data.social_link) ?? "Other", kind: "link" as const, value: data.social_link }]
            : []),
          ...(data.website
            ? [{ tag: guessLinkTag(data.website) ?? "Website", kind: "link" as const, value: data.website }]
            : []),
        ] as AccountContact[]);
  const { list: contacts, error: contactError } = cleanContacts(rawContacts);
  if (contactError) return fail(contactError);
  const legacy = legacyContactColumns(contacts);

  const { data: created, error } = await db()
    .from("accounts")
    .insert({
      function: data.function,
      name: data.name,
      product: data.function === "IGT" ? data.product : null,
      sub_product: data.function === "IGT" ? data.sub_product || null : null,
      project: data.function === "IGV" ? data.project : null,
      account_type: data.account_type || null,
      industry: data.function === "B2C" ? null : data.industry || null,
      contacts,
      ...legacy,
      requested_podio: data.requested_podio ?? false,
      responsible_id: responsibleId,
      created_by: viewer.id,
      // continuous Podio updates (v24): ON by default for IGV / B2C / BD,
      // OFF for IGT / B2B — always editable on the account page
      podio_update_enabled: ["IGV", "B2C", "BD"].includes(data.function),
      podio_update_every_days: podioDefaultDays(data.function),
      podio_updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505")
      return fail("This account already exists in the ICX data.", "duplicate");
    return fail(error.message);
  }

  if (data.comment) {
    await db().from("account_comments").insert({
      account_id: created.id,
      member_id: viewer.id,
      author_label: commentLabel(viewer),
      body: data.comment,
    });
  }

  await recordUndo("accounts", created.id, "insert"); // children cascade on undo
  // v31: the audit row IS the account's first History entry — keep the whole
  // creation snapshot (what was entered, not what the row looks like today)
  await logAudit(viewer.id, "create", "account", created.id, {
    name: data.name,
    via: opts?.via ?? "manual",
    function: data.function,
    product: data.function === "IGT" ? data.product ?? null : null,
    sub_product: data.function === "IGT" ? data.sub_product || null : null,
    project: data.function === "IGV" ? data.project ?? null : null,
    account_type: data.account_type || null,
    industry: data.function === "B2C" ? null : data.industry || null,
    responsible_id: responsibleId,
    requested_podio: data.requested_podio ?? false,
    contacts: contacts.map((c) => ({ tag: c.tag, kind: c.kind, value: c.value })),
    comment: data.comment || null,
  });
  if (opts?.stampActivity !== false)
    await stampWork(viewer.id, "account_created"); // v29: counts towards working hours
  refresh();
  return { ok: true, data: { id: created.id, slug: accountSlug(data.name) } };
}

const editableFields = z.object({
  phone: phoneField,
  email: emailField,
  social_link: linkField,
  website: linkField,
  sub_product: z.string().trim().nullish(),
  project: z.string().trim().nullish(),
  account_type: z.string().trim().nullish(),
  industry: z.string().trim().nullish(),
  proposal_sent: z.boolean().nullish(),
  requested_podio: z.boolean().nullish(),
  request_state: z.enum(["Checking", "Approved", "Rejected"]).nullish(),
  next_step: z.string().trim().nullish(),
  next_step_date: z.string().nullish(),
  next_step_time: z.string().nullish(),
});

export async function updateAccount(
  accountId: string,
  patch: z.infer<typeof editableFields>
): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account.", "forbidden");
  const parsed = editableFields.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    if (key === "request_state" && !canEditRequestState(viewer, account))
      return fail("Request State is set by the TL, Coordinator or VP.", "forbidden");
    update[key] = value === "" ? null : value;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  // BUSINESS RULE: a Rejected Podio request closes the account (like Not Interested)
  if (update.request_state === "Rejected" && !account.out_of_process) {
    update.out_of_process = true;
    update.oop_reason = "Podio request rejected";
    update.oop_at = new Date().toISOString();
  }

  // the "submit it on Podio" pin clears itself once the owner acts
  if (
    account.podio_submit_requested_at &&
    (update.requested_podio === true || update.request_state)
  ) {
    update.podio_submit_requested_at = null;
  }

  await snapshotForUndo("accounts", accountId);
  const { error } = await db().from("accounts").update(update).eq("id", accountId);
  if (error) return fail(error.message);
  // next step touched (or the account auto-archived) → keep the calendar
  // follow-up reminder in sync
  if (
    "next_step" in update || "next_step_date" in update ||
    "next_step_time" in update || "out_of_process" in update
  ) {
    await syncNextStepReminder(accountId);
  }
  await logAudit(viewer.id, "update", "account", accountId, { fields: Object.keys(update) });
  await stampWork(viewer.id, "account_updated"); // v29: counts towards working hours
  refresh(accountId);
  return { ok: true };
}

export async function reassignAccount(
  accountId: string,
  newResponsibleId: string
): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canReassignAccount(viewer, account))
    return fail(
      "Only the Team Leader (within the team), VP or LCP can change responsibility.",
      "forbidden"
    );

  const scope = reassignTargetScope(viewer);
  const { data: target } = await db()
    .from("members")
    .select("*")
    .eq("id", newResponsibleId)
    .eq("is_active", true)
    .maybeSingle<Member>();
  if (!target) return fail("Target member not found.");
  // reassignment stays inside the account's function; B2B/BD (and B2C) may
  // live in EITHER column, so match both — mirrors listReassignTargets in
  // data.ts so the dialog can never offer a target the check would reject.
  const targetInFunction =
    account.function === "B2B" || account.function === "BD"
      ? memberIsB2B(target)
      : account.function === "B2C"
        ? rowIsB2C(target)
        : (target.functions ?? []).includes(account.function);
  // taking an UNOWNED account for yourself needs no authority over anyone —
  // nobody is losing it (v32.4)
  const claimingForSelf =
    isClaimableAccount(viewer, account) && target.id === viewer.id;
  const inScope =
    claimingForSelf ||
    scope.kind === "all" ||
    (scope.kind === "functions" && targetInFunction) ||
    (scope.kind === "members" && scope.ids.includes(target.id));
  if (!inScope) return fail("You can only reassign to members in your scope.", "forbidden");

  // Claiming an unowned account MOVES it into the claimer's function (v32.6):
  // the market research is theirs now, and leaving it filed under a function
  // nobody works would hide it from the person who just took it.
  const movedFn =
    claimingForSelf ? claimTargetFunction(viewer, account) : null;
  const fnChanged = !!movedFn && movedFn !== account.function;

  await snapshotForUndo("accounts", accountId);
  const { error } = await db()
    .from("accounts")
    .update({
      responsible_id: newResponsibleId,
      ...(fnChanged ? { function: movedFn } : {}),
    })
    .eq("id", accountId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "reassign", "account", accountId, {
    from: account.responsible_id,
    to: newResponsibleId,
    ...(fnChanged ? { function_from: account.function, function_to: movedFn } : {}),
  });
  refresh(accountId);
  return { ok: true };
}

export async function setOutOfProcess(
  accountId: string,
  reason: string
): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account.", "forbidden");
  // never re-archive: it would overwrite the ORIGINAL reason/date
  if (account.out_of_process) return fail("This account is already archived.");
  await snapshotForUndo("accounts", accountId);
  const { error } = await db()
    .from("accounts")
    .update({
      out_of_process: true,
      oop_reason: reason || null,
      oop_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) return fail(error.message);

  // drop the pending visit reminder if one exists
  const { data: pending } = await db()
    .from("visits")
    .select("*")
    .eq("account_id", accountId)
    .is("done", null)
    .maybeSingle<Visit>();
  if (pending?.calendar_event_id) {
    // the event may live on the responsible's own calendar (tier 1) OR the
    // shared "Sodio — LC Visits" calendar (tier 2) — try both
    const { data: owner } = await db()
      .from("members")
      .select("google_refresh_token")
      .eq("id", pending.member_id)
      .maybeSingle<{ google_refresh_token: string | null }>();
    await deleteVisitEvent(owner?.google_refresh_token ?? null, pending.calendar_event_id).catch(() => {});
    await deleteMailboxVisitEvent(pending.calendar_event_id).catch(() => {});
  }
  await syncNextStepReminder(accountId); // drop the follow-up reminder too
  await logAudit(viewer.id, "out_of_process", "account", accountId, { reason });
  refresh(accountId);
  return { ok: true };
}

/** Bringing an account back from the archive is a TL/VP/LCP override. */
export async function reviveAccount(accountId: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canReassignAccount(viewer, account))
    return fail("Only the Team Leader, VP or LCP can bring an account back into process.", "forbidden");
  await snapshotForUndo("accounts", accountId);
  const { error } = await db()
    .from("accounts")
    .update({ out_of_process: false, oop_reason: null, oop_at: null })
    .eq("id", accountId);
  if (error) return fail(error.message);
  await syncNextStepReminder(accountId); // future next step? bring its reminder back
  await logAudit(viewer.id, "revive", "account", accountId);
  refresh(accountId);
  return { ok: true };
}

// ================================================================== manual archive

/** Core insert for a manually archived name (an account that was never worked
 *  in the CRM). Lives in the blacklist table — `checkAccountName` blocks the
 *  name from ever being added, exactly like an OOP account. */
async function insertArchivedName(
  viewerId: string,
  name: string,
  reason: string
): Promise<ActionResult> {
  const cleanName = name?.trim();
  // the reason is OPTIONAL — the name alone is enough to blacklist it
  const cleanReason = reason?.trim() || null;
  if (!cleanName || cleanName.length < 2) return fail("Account name is required.");

  const { duplicate, blacklisted } = await checkAccountName(cleanName);
  if (blacklisted)
    return fail(`"${cleanName}" is already in the archive.`, "archived", {
      reason: blacklisted.comments,
    });
  if (duplicate && duplicate.out_of_process)
    return fail(`"${cleanName}" is already archived (Out of Process).`, "archived", {
      reason: duplicate.oop_reason,
    });
  if (duplicate)
    return fail(
      `"${cleanName}" exists in the active accounts (${duplicate.function}, ${duplicate.responsible_nickname || duplicate.responsible_name || "Unassigned"}) — mark it Out of Process from its page instead.`,
      "duplicate"
    );

  const { data: newEntry, error } = await db()
    .from("blacklist")
    .insert({
      account_name: cleanName,
      comments: cleanReason,
      added_by: viewerId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    if (error.code === "23505") return fail(`"${cleanName}" is already in the archive.`, "archived");
    return fail(error.message);
  }
  if (newEntry) await recordUndo("blacklist", newEntry.id, "insert");
  return { ok: true };
}

/** Add one archived account by hand (name + reason) — for companies that were
 *  burned before the CRM existed. TL+ (anyone who can open the archive). */
export async function addArchivedAccount(input: {
  name: string;
  reason: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canManageArchive(viewer))
    return fail("Only TLs, VPs and the LCP manage the archive.", "forbidden");
  const res = await insertArchivedName(viewer.id, input.name, input.reason);
  if (!res.ok) return res;
  await logAudit(viewer.id, "archive_add", "blacklist", null, { name: input.name });
  refresh();
  return { ok: true };
}

/** Bulk import of archived names (CSV/XLSX parsed client-side): Name + Reason.
 *  Free-form reasons from old sheets are accepted as-is. */
export async function importArchivedBulk(
  rows: { name: string; reason: string }[]
): Promise<ActionResult<{ results: ImportRowResult[]; created: number }>> {
  const viewer = await getViewer();
  if (!canManageArchive(viewer))
    return fail("Only TLs, VPs and the LCP manage the archive.", "forbidden");
  if (!rows?.length) return fail("Nothing to import.");
  if (rows.length > 1000) return fail("Import at most 1000 archived names at a time.");

  const results: ImportRowResult[] = [];
  let created = 0;
  for (const row of rows) {
    const res = await insertArchivedName(viewer.id, row.name, row.reason);
    if (res.ok) {
      created += 1;
      results.push({ name: row.name, ok: true });
    } else {
      results.push({ name: row.name, ok: false, error: res.error });
    }
  }
  await logAudit(viewer.id, "archive_import", "blacklist", null, { created });
  refresh();
  return { ok: true, data: { results, created } };
}

/** Remove a manually added archive entry (typos / wrong imports) — VP+. */
export async function removeArchivedEntry(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const allowed =
    viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
  if (!allowed) return fail("Only VPs, Directors or the LCP remove archive entries.", "forbidden");
  // sandbox: keep the row's content so exit can re-insert it
  const { data: beforeRow } = await db().from("blacklist").select("*").eq("id", id).maybeSingle();
  const { error } = await db().from("blacklist").delete().eq("id", id);
  if (error) return fail(error.message);
  if (beforeRow) await recordUndo("blacklist", id, "delete", beforeRow);
  await logAudit(viewer.id, "archive_remove", "blacklist", id);
  refresh();
  return { ok: true };
}

/** Records ONE deal — an account can close many over time (3 slots today, 6
 *  more next month = 2 deals · 9 slots). Opens are recorded PER PRODUCT:
 *  IGV accounts sign IGV opens; IGT accounts split IGTa + IGTe; B2B accounts
 *  mix all three (e.g. 3 IGV + 2 IGTe + 1 IGTa). Totals live on the account.
 *  BD deals' MOS is MONEY: the amount (EGP) is required (+ optional other
 *  benefits) and opens are optional extras. */
export async function recordDeal(
  accountId: string,
  breakdown: { igv?: number; igta?: number; igte?: number },
  note?: string,
  extras?: { amount?: number; benefits?: string },
  /** v22: optionally split the opens across members (e.g. 3 to the owner,
   *  3 to whoever helped close) — every recipient must be in the account's
   *  function and the splits must add up to the deal's opens exactly. */
  allocations?: { memberId: string; igv?: number; igta?: number; igte?: number }[]
): Promise<ActionResult<{ deals: number; slots: number; dealId: string }>> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account.", "forbidden");
  if (account.out_of_process)
    return fail("This account is archived — bring it back in process first.");

  const clamp = (n?: number) => Math.max(0, Math.round(n ?? 0));
  let igv = clamp(breakdown.igv);
  let igta = clamp(breakdown.igta);
  let igte = clamp(breakdown.igte);
  const amount = Math.max(0, Math.round(extras?.amount ?? 0));
  if (account.function === "IGV") {
    igta = 0; igte = 0;
    if (igv < 1) return fail("How many IGV opens were signed?");
  } else if (account.function === "IGT") {
    igv = 0;
    if (igta + igte < 1) return fail("Split the opens across IGTa / IGTe (at least 1).");
  } else if (account.function === "BD") {
    // BD's MOS is the money — opens are a bonus, not a requirement
    if (amount < 1) return fail("What's this deal's amount (EGP)?");
  } else if (account.function === "B2C") {
    // B2C deals carry NO details — just "deal signed" (v23)
    igv = 0; igta = 0; igte = 0;
  } else if (igv + igta + igte < 1) {
    return fail("Add the opens of this deal (IGV / IGTa / IGTe).");
  }
  const cleanSlots = igv + igta + igte;

  // ---- who do the opens belong to? Default: 100% to the account's
  // responsible. A custom split must cover the deal's opens exactly and only
  // name members of the account's function.
  let allocRows = (allocations ?? [])
    .map((a) => ({
      member_id: a.memberId,
      slots_igv: clamp(a.igv),
      slots_igta: clamp(a.igta),
      slots_igte: clamp(a.igte),
    }))
    .filter((a) => a.member_id && a.slots_igv + a.slots_igta + a.slots_igte > 0);
  if (allocRows.length > 0) {
    const ids = allocRows.map((a) => a.member_id);
    if (new Set(ids).size !== ids.length)
      return fail("Each member appears once in the opens split.");
    const sum = (k: "slots_igv" | "slots_igta" | "slots_igte") =>
      allocRows.reduce((s, a) => s + a[k], 0);
    if (sum("slots_igv") !== igv || sum("slots_igta") !== igta || sum("slots_igte") !== igte)
      return fail("The split must add up to the deal's opens exactly.");
    const { listFunctionMembers } = await import("./data");
    const crew = await listFunctionMembers(account.function);
    const crewIds = new Set(crew.map((m) => m.id));
    if (ids.some((id) => !crewIds.has(id)))
      return fail(`Opens can only be assigned to ${account.function} members.`);
  } else if (cleanSlots > 0) {
    if (!account.responsible_id)
      return fail("This account has no responsible yet — choose who the opens go to.");
    allocRows = [
      { member_id: account.responsible_id, slots_igv: igv, slots_igta: igta, slots_igte: igte },
    ];
  }

  // the deal is recorded for the account's RESPONSIBLE (whoever the opens
  // were raised for), not the person clicking the button
  const { data: inserted, error } = await db()
    .from("deals")
    .insert({
      account_id: accountId,
      member_id: account.responsible_id,
      slots: cleanSlots,
      slots_igv: igv,
      slots_igta: igta,
      slots_igte: igte,
      ...(amount > 0 || extras?.benefits?.trim()
        ? { amount, benefits: extras?.benefits?.trim() || null }
        : {}),
      note: note?.trim() || null,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    if (error?.message.includes("slots_igv"))
      return fail("Per-product deals need migration 0009 — run it in the Supabase SQL editor.");
    if (
      error?.message.includes("amount") ||
      error?.message.includes("benefits") ||
      error?.message.includes("deals_slots_check")
    )
      return fail("BD money deals need migration 0015 — run it in the Supabase SQL editor.");
    return fail(error?.message ?? "The deal could not be saved — try again.");
  }

  await recordUndo("deals", inserted.id, "insert");
  // opens allocations (v22): who the opens belong to. If this write fails the
  // deal must NOT survive half-recorded — roll the deal row back and say so.
  if (allocRows.length > 0) {
    const { data: insertedAllocs, error: allocError } = await db()
      .from("deal_allocations")
      .insert(allocRows.map((a) => ({ ...a, deal_id: inserted.id })))
      .select("id");
    if (allocError) {
      await db().from("deals").delete().eq("id", inserted.id);
      if (allocError.message.includes("deal_allocations"))
        return fail("Opens splitting needs migration 0018 — run it in the Supabase SQL editor.");
      return fail(`The opens split could not be saved (${allocError.message}) — nothing was recorded, try again.`);
    }
    for (const a of insertedAllocs ?? []) await recordUndo("deal_allocations", a.id, "insert");
  }
  const totals = {
    slot_raised: true,
    slot_raised_at: new Date().toISOString(),
    slots_count: (account.slots_count ?? 0) + cleanSlots,
    deals_count: (account.deals_count ?? 0) + 1,
    slots_igv_count: (account.slots_igv_count ?? 0) + igv,
    slots_igta_count: (account.slots_igta_count ?? 0) + igta,
    slots_igte_count: (account.slots_igte_count ?? 0) + igte,
  };
  await snapshotForUndo("accounts", accountId);
  const { error: updateError } = await db()
    .from("accounts")
    .update(totals)
    .eq("id", accountId);
  if (updateError) return fail(updateError.message);

  await logAudit(viewer.id, "deal", "account", accountId, {
    slots: cleanSlots, igv, igta, igte,
  });
  await stampWork(viewer.id, "deal"); // v29: counts towards working hours
  refresh(accountId);
  return {
    ok: true,
    data: { deals: totals.deals_count, slots: totals.slots_count, dealId: inserted.id },
  };
}

// ================================================================== deal contracts

/** Contract uploads are OPTIONAL and can happen at record time or any time
 *  later. Files go STRAIGHT from the browser to the private "contracts"
 *  Storage bucket via short-lived signed upload URLs (Vercel caps action
 *  bodies at ~4.5 MB, so the file bytes never touch the server). */

const CONTRACT_MAX_FILES = 10;
const CONTRACT_MAX_SIZE = 25 * 1024 * 1024; // 25 MB per file, any format

interface DealRow {
  id: string;
  account_id: string;
  contracts: { path: string; name: string; type: string; size: number }[];
}

async function loadDeal(dealId: string): Promise<{ deal: DealRow; account: PipelineRow } | null> {
  const { data: deal } = await db()
    .from("deals")
    .select("id, account_id, contracts")
    .eq("id", dealId)
    .maybeSingle<DealRow>();
  if (!deal) return null;
  const account = await loadAccount(deal.account_id);
  if (!account) return null;
  return { deal, account };
}

/** Step 1 — issue signed upload URLs for the picked files (RBAC-checked). */
export async function requestContractUploads(
  dealId: string,
  files: { name: string; type: string; size: number }[]
): Promise<ActionResult<{ uploads: { path: string; signedUrl: string }[] }>> {
  const viewer = await getViewer();
  const loaded = await loadDeal(dealId);
  if (!loaded || !canEditAccount(viewer, loaded.account))
    return fail("You are not allowed to work on this account.", "forbidden");

  if (files.length === 0) return fail("Pick the contract file(s) first.");
  if ((loaded.deal.contracts?.length ?? 0) + files.length > CONTRACT_MAX_FILES)
    return fail(`A deal holds at most ${CONTRACT_MAX_FILES} contract files.`);
  for (const f of files) {
    if (f.size > CONTRACT_MAX_SIZE)
      return fail(`"${f.name}" is over 25 MB — compress it or upload a smaller scan.`);
  }

  const uploads: { path: string; signedUrl: string }[] = [];
  for (const f of files) {
    const safeName = f.name.replace(/[^\w.\- ()]+/g, "_").slice(-80);
    const path = `${loaded.deal.account_id}/${dealId}/${Date.now()}-${safeName}`;
    const { data, error } = await db().storage.from("contracts").createSignedUploadUrl(path);
    if (error || !data) {
      if (error?.message?.toLowerCase().includes("bucket"))
        return fail("The contracts storage isn't set up yet — run migration 0012 in the Supabase SQL editor.");
      return fail(error?.message ?? "Could not prepare the upload — try again.");
    }
    uploads.push({ path: data.path, signedUrl: data.signedUrl });
  }
  return { ok: true, data: { uploads } };
}

/** Step 2 — after the browser PUT the files, record them on the deal. */
export async function confirmContractUploads(
  dealId: string,
  uploaded: { path: string; name: string; type: string; size: number }[]
): Promise<ActionResult> {
  const viewer = await getViewer();
  const loaded = await loadDeal(dealId);
  if (!loaded || !canEditAccount(viewer, loaded.account))
    return fail("You are not allowed to work on this account.", "forbidden");

  // only paths issued for THIS deal can be recorded on it
  const prefix = `${loaded.deal.account_id}/${dealId}/`;
  const clean = uploaded
    .filter((u) => u.path.startsWith(prefix))
    .map((u) => ({
      path: u.path,
      name: u.name.slice(0, 120),
      type: u.type || "application/octet-stream",
      size: u.size,
      uploaded_at: new Date().toISOString(),
      uploaded_by: viewer.id,
    }));
  if (clean.length === 0) return fail("Nothing was uploaded.");

  const { error } = await db()
    .from("deals")
    .update({ contracts: [...(loaded.deal.contracts ?? []), ...clean] })
    .eq("id", dealId);
  if (error) {
    if (error.message.includes("contracts"))
      return fail("Contract uploads need migration 0012 — run it in the Supabase SQL editor.");
    return fail(error.message);
  }
  await logAudit(viewer.id, "deal_contracts", "account", loaded.deal.account_id, {
    dealId, files: clean.map((c) => c.name),
  });
  refresh(loaded.deal.account_id);
  return { ok: true };
}

/** Short-lived signed link so anyone who can SEE the account can open the
 *  contract (view/download) — the bucket itself stays private. */
export async function getContractUrl(
  dealId: string,
  path: string
): Promise<ActionResult<{ url: string }>> {
  const viewer = await getViewer();
  const loaded = await loadDeal(dealId);
  // contracts stay EDIT-scoped (v22.2): the archive being world-readable must
  // not make other functions' signed contract files world-downloadable
  if (!loaded || !canEditAccount(viewer, loaded.account))
    return fail("You are not allowed to view this account.", "forbidden");
  if (!path.startsWith(`${loaded.deal.account_id}/${dealId}/`))
    return fail("That file does not belong to this deal.");

  const { data, error } = await db().storage.from("contracts").createSignedUrl(path, 600);
  if (error || !data) return fail(error?.message ?? "Could not open the contract — try again.");
  return { ok: true, data: { url: data.signedUrl } };
}

// ================================================================== view as (admin test view)

/** Admin-only: see & use the whole app exactly as another member would.
 *  The check runs against the REAL session (never the impersonated viewer),
 *  so the admin can always start/stop regardless of the current test view.
 *
 *  v21 — SANDBOX is the default: every mutation is journaled (test_undo) and
 *  undone on exit, and outbound side effects (emails, notifications, calendar
 *  events, sheet write-backs) are suppressed. `mode: "real"` restores the old
 *  behavior (actions stick, side effects fire). The cookie carries
 *  `<targetId>|<mode>|<sessionId>`. */
export async function startViewAs(
  memberId: string,
  mode: "sandbox" | "real" = "sandbox"
): Promise<ActionResult<{ name: string; mode: "sandbox" | "real" }>> {
  const { getRealViewer, VIEW_AS_COOKIE } = await import("./data");
  const real = await getRealViewer();
  if (!canUseAdminTools(real))
    return fail("Only the admin can use the test view.", "forbidden");

  const { data: target } = await db()
    .from("members")
    .select("id, name, nickname, is_active")
    .eq("id", memberId)
    .maybeSingle<{ id: string; name: string; nickname: string | null; is_active: boolean }>();
  if (!target || !target.is_active) return fail("That member doesn't exist (or is inactive).");

  const { cookies } = await import("next/headers");
  const jar = await cookies();

  // reuse the open session when just SWITCHING target/mode mid-test-view —
  // its undo journal must survive until the admin actually exits
  const prev = jar.get(VIEW_AS_COOKIE)?.value?.split("|") ?? [];
  let sessionId = prev[2] || null;
  if (sessionId) {
    const { data: open } = await db()
      .from("test_sessions").select("id").eq("id", sessionId).is("ended_at", null).maybeSingle();
    if (!open) sessionId = null;
    else await db().from("test_sessions").update({ target_id: target.id, mode }).eq("id", sessionId);
  }
  if (!sessionId) {
    const { data: session, error } = await db()
      .from("test_sessions")
      .insert({ admin_id: real.id, target_id: target.id, mode })
      .select("id")
      .single<{ id: string }>();
    if (error || !session)
      return fail(`Could not open a test session${error ? `: ${error.message}` : ""} — is migration 0017 applied?`);
    sessionId = session.id;
  }

  jar.set(VIEW_AS_COOKIE, `${target.id}|${mode}|${sessionId}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4, // auto-expires after 4h so a test view can't linger
  });
  await logAudit(real.id, "view_as_start", "member", target.id, { mode });
  refresh();
  return { ok: true, data: { name: target.nickname || target.name, mode } };
}

/** Flip the CURRENT test view between sandbox and real. Switching sandbox→real
 *  first ROLLS BACK everything the sandbox phase journaled (you were "just
 *  testing") so the real phase starts from a clean slate — this prevents a
 *  later exit from clobbering a genuine real-mode edit to a row you'd also
 *  touched in sandbox. Returns how many sandbox changes were rolled back. */
export async function setViewAsMode(
  mode: "sandbox" | "real"
): Promise<ActionResult<{ rolledBack: number }>> {
  const { getRealViewer, VIEW_AS_COOKIE } = await import("./data");
  const real = await getRealViewer();
  if (!canUseAdminTools(real))
    return fail("Only the admin can use the test view.", "forbidden");
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const raw = jar.get(VIEW_AS_COOKIE)?.value;
  if (!raw) return fail("No test view is active.");
  const [targetId, prevMode, sessionId] = raw.split("|");
  if (!targetId || !sessionId) return fail("This test view predates modes — exit and start it again.");

  let rolledBack = 0;
  if (prevMode === "sandbox" && mode === "real") {
    const { rollbackJournal } = await import("./sandbox");
    rolledBack = await rollbackJournal(sessionId);
  }
  await db().from("test_sessions").update({ mode }).eq("id", sessionId);
  jar.set(VIEW_AS_COOKIE, `${targetId}|${mode}|${sessionId}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4,
  });
  await logAudit(real.id, "view_as_mode", "member", targetId, { mode, rolledBack });
  refresh();
  return { ok: true, data: { rolledBack } };
}

export async function stopViewAs(): Promise<ActionResult<{ undone: number }>> {
  const { getRealViewer, VIEW_AS_COOKIE } = await import("./data");
  const real = await getRealViewer(); // any signed-in user may clear their own cookie
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const raw = jar.get(VIEW_AS_COOKIE)?.value;
  jar.delete(VIEW_AS_COOKIE);

  // roll back everything the sandbox journaled, then close the session
  let undone = 0;
  const sessionId = raw?.split("|")[2];
  if (sessionId) {
    const { undoSandboxSession } = await import("./sandbox");
    undone = await undoSandboxSession(sessionId);
  }
  await logAudit(real.id, "view_as_stop", "member", null, undone ? { undone } : undefined);
  refresh();
  return { ok: true, data: { undone } };
}

// ================================================================== test mode

/** Admin: show/hide the seeded test accounts in the REAL session (outside of
 *  view-as). Test accounts are always visible inside a test view. */
export async function setTestDataVisibility(show: boolean): Promise<ActionResult> {
  const { getRealViewer } = await import("./data");
  const real = await getRealViewer();
  if (!real.isAdmin) return fail("Only the admin can toggle test mode.", "forbidden");
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  if (show)
    jar.set("sodio-test-mode", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  else jar.delete("sodio-test-mode");
  refresh();
  return { ok: true };
}

/** Admin: seeds a small universe of TEST accounts across every function —
 *  various stages (lead / contacted / visit scheduled / visit done / deals /
 *  archived) with contacts, so dashboards, drills, filters and flows all have
 *  something to chew on. All rows carry is_test=true and are INVISIBLE outside
 *  test mode (accounts list, dashboards, leaderboards, calendar, mirrors,
 *  reports all filter them out). Safe to run twice — existing test accounts
 *  are wiped first. */
export async function seedTestAccounts(): Promise<ActionResult<{ created: number }>> {
  const { getRealViewer } = await import("./data");
  const real = await getRealViewer();
  if (!real.isAdmin) return fail("Only the admin can seed test data.", "forbidden");

  // start clean — cascades wipe old test contacts/visits/deals/comments
  await db().from("accounts").delete().eq("is_test", true);

  const { data: membersData } = await db()
    .from("members")
    .select("id, role, functions, sub_functions")
    .eq("is_active", true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = (membersData ?? []) as any[];
  const pick = (pred: (m: (typeof members)[number]) => boolean) =>
    members.filter(pred).map((m) => m.id as string);
  const igv = pick((m) => (m.functions ?? []).includes("IGV"));
  const igt = pick((m) => (m.functions ?? []).includes("IGT"));
  const b2b = pick((m) => memberIsB2B(m));
  const anyone = [real.id];
  const cycle = (list: string[], i: number) => (list.length ? list[i % list.length] : anyone[0]);

  const testContacts = (n: number) => [
    { kind: "phone", value: `+2010000000${String(n).padStart(2, "0")}`, tag: "Whatsapp" },
    { kind: "email", value: `test${n}@example.com`, tag: "Contact" },
  ];

  const specs: {
    name: string; fn: string; product?: string | null; project?: string | null;
    resp: string; stage: "lead" | "contacted" | "visit" | "visit_done" | "deal" | "oop" | "limit";
    deal?: { igv: number; igta: number; igte: number; amount?: number };
  }[] = [
    { name: "TEST — Blue Lotus Cafe", fn: "IGV", project: "Skill Up!", resp: cycle(igv, 0), stage: "lead" },
    { name: "TEST — Pharos Academy", fn: "IGV", project: "Rooted", resp: cycle(igv, 1), stage: "contacted" },
    { name: "TEST — Corniche Dental", fn: "IGV", project: "Skill Up!", resp: cycle(igv, 2), stage: "visit" },
    { name: "TEST — Alex Motors", fn: "IGV", project: "Global Classroom", resp: cycle(igv, 3), stage: "deal", deal: { igv: 3, igta: 0, igte: 0 } },
    { name: "TEST — Delta Textiles", fn: "IGT", product: "GTa", resp: cycle(igt, 0), stage: "contacted" },
    { name: "TEST — Sigma Software House", fn: "IGT", product: "GTa", resp: cycle(igt, 1), stage: "deal", deal: { igv: 0, igta: 2, igte: 0 } },
    { name: "TEST — Nile English School", fn: "IGT", product: "GTe", resp: cycle(igt, 2), stage: "visit" },
    { name: "TEST — Horizon Nursery", fn: "IGT", product: "GTe", resp: cycle(igt, 3), stage: "limit" },
    { name: "TEST — Andalus Holding", fn: "B2B", resp: cycle(b2b, 0), stage: "deal", deal: { igv: 2, igta: 1, igte: 1 } },
    { name: "TEST — Levant Trading Co", fn: "BD", resp: cycle(b2b, 1), stage: "deal", deal: { igv: 0, igta: 0, igte: 1, amount: 5000 } },
    { name: "TEST — Old Town Bakery", fn: "IGV", project: "Skill Up!", resp: cycle(igv, 4), stage: "oop" },
  ];

  let created = 0;
  for (const [i, s] of specs.entries()) {
    const contacts = testContacts(i);
    const { data: acc, error } = await db()
      .from("accounts")
      .insert({
        function: s.fn,
        name: s.name,
        product: s.product ?? null,
        project: s.project ?? null,
        account_type: "Company",
        industry: "Other",
        contacts,
        phone: contacts[0].value,
        email: contacts[1].value,
        responsible_id: s.resp,
        created_by: real.id,
        is_test: true,
        ...(s.stage === "oop"
          ? { out_of_process: true, oop_reason: "Not Interested", oop_at: new Date().toISOString() }
          : {}),
      })
      .select("id")
      .single();
    if (error || !acc) {
      console.error("[test-seed] account failed:", s.name, error?.message);
      continue;
    }
    created++;

    const attempt = (status: string, daysAgo: number) =>
      db().from("contact_attempts").insert({
        account_id: acc.id,
        member_id: s.resp,
        method: "Call",
        status,
        comment: "Seeded test attempt",
        created_at: new Date(Date.now() - daysAgo * 864e5).toISOString(),
      });

    if (s.stage === "contacted") await attempt("Responded", 2);
    if (s.stage === "limit") {
      await attempt("No Response", 6);
      await attempt("No Response", 4);
      await attempt("No Response", 2);
    }
    if (s.stage === "visit" || s.stage === "visit_done" || s.stage === "deal") {
      await attempt("Interested", 5);
      const future = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
      const past = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
      await db().from("visits").insert({
        account_id: acc.id,
        member_id: s.resp,
        visit_date: s.stage === "visit" ? future : past,
        visit_time: "14:00",
        ...(s.stage === "visit" ? {} : { done: true, visit_comment: "Great meeting (test)" }),
      });
    }
    if (s.stage === "deal" && s.deal) {
      const slots = s.deal.igv + s.deal.igta + s.deal.igte;
      await db().from("deals").insert({
        account_id: acc.id,
        member_id: s.resp,
        slots,
        slots_igv: s.deal.igv,
        slots_igta: s.deal.igta,
        slots_igte: s.deal.igte,
        ...(s.deal.amount ? { amount: s.deal.amount, benefits: "Test partnership" } : {}),
        note: "Seeded test deal",
      });
      await db().from("accounts").update({
        slot_raised: true,
        slot_raised_at: new Date().toISOString(),
        slots_count: slots,
        deals_count: 1,
        slots_igv_count: s.deal.igv,
        slots_igta_count: s.deal.igta,
        slots_igte_count: s.deal.igte,
      }).eq("id", acc.id);
    }
  }

  await logAudit(real.id, "test_seed", "system", null, { created });
  refresh();
  return { ok: true, data: { created } };
}

/** Admin: removes every test account (children cascade). */
export async function removeTestData(): Promise<ActionResult<{ removed: number }>> {
  const { getRealViewer } = await import("./data");
  const real = await getRealViewer();
  if (!real.isAdmin) return fail("Only the admin can remove test data.", "forbidden");
  const { count } = await db()
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("is_test", true);
  const { error } = await db().from("accounts").delete().eq("is_test", true);
  if (error) return fail(error.message);
  await logAudit(real.id, "test_wipe", "system", null, { removed: count ?? 0 });
  refresh();
  return { ok: true, data: { removed: count ?? 0 } };
}

// ============================================ LC-wide testing session (v32)

/** Opens a testing session for the WHOLE LC.
 *
 *  While it is open every member's database writes are journaled; closing it
 *  replays the journal in reverse, so the LC can be turned loose on the system
 *  and the database ends up exactly as it started.
 *
 *  ⚠️ SIDE EFFECTS ARE **NOT** SUPPRESSED — by explicit choice. Emails,
 *  in-app notifications, Google Calendar events, Gmail drafts and the Sheets
 *  write-back all fire for real and CANNOT be rolled back. Only the database
 *  is restored. The UI says this in as many words before the admin starts. */
export async function startLcTestSession(): Promise<ActionResult<{ id: string }>> {
  const { getRealViewer } = await import("./data");
  const real = await getRealViewer();
  if (!real.isAdmin) return fail("Only the admin can start a testing session.", "forbidden");

  const { lcTestSession } = await import("./sandbox");
  if (await lcTestSession())
    return fail("A testing session is already running — stop it first.");

  const { data, error } = await db()
    .from("test_sessions")
    .insert({ admin_id: real.id, target_id: null, mode: "lc", kind: "lc" })
    .select("id")
    .single<{ id: string }>();
  // the partial unique index is the real guard against two admins racing
  if (error)
    return fail(
      error.code === "23505"
        ? "A testing session was just started by someone else."
        : error.message
    );
  await logAudit(real.id, "lc_test_start", "system", data.id);
  refresh();
  return { ok: true, data: { id: data.id } };
}

/** Closes the LC-wide session. `keep` commits everything instead of rolling
 *  back — for when the test turned out to be real work worth keeping. */
export async function stopLcTestSession(
  keep = false
): Promise<ActionResult<{ undone: number; kept: boolean }>> {
  const { getRealViewer } = await import("./data");
  const real = await getRealViewer();
  if (!real.isAdmin) return fail("Only the admin can stop a testing session.", "forbidden");

  const { lcTestSession, rollbackJournal } = await import("./sandbox");
  const id = await lcTestSession();
  if (!id) return fail("No testing session is running.");

  let undone = 0;
  if (keep) {
    // detach the rows from the session so nothing can replay them later, but
    // leave them in the journal — they stay individually undoable from the log
    await db().from("test_undo").update({ session_id: null }).eq("session_id", id);
  } else {
    undone = await rollbackJournal(id);
  }
  await db()
    .from("test_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit(real.id, keep ? "lc_test_keep" : "lc_test_rollback", "system", id, {
    undone,
  });
  refresh();
  return { ok: true, data: { undone, kept: keep } };
}

// ==================================================== undo from the logs (v32)

/** Reverses one or more audited actions from /admin (single or bulk select).
 *  Newest first, so undoing a run of edits to the same row lands on the
 *  oldest snapshot rather than a middle one. */
export async function undoAuditEntries(
  ids: number[]
): Promise<ActionResult<{ undone: number; skipped: number; failed: number }>> {
  const { getRealViewer } = await import("./data");
  const real = await getRealViewer();
  if (!real.isAdmin) return fail("Only the admin can undo actions.", "forbidden");
  if (!ids?.length) return fail("Nothing selected.");
  if (ids.length > 50) return fail("Undo at most 50 entries at a time.");

  const { data: rows } = await db()
    .from("audit_log")
    .select("id, action, change_set, undone_at")
    .in("id", ids)
    .order("id", { ascending: false });

  const { rollbackChangeSet } = await import("./sandbox");
  let undone = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of (rows ?? []) as {
    id: number;
    action: string;
    change_set: string | null;
    undone_at: string | null;
  }[]) {
    // nothing to replay: pre-v32 entries, already-undone ones, and actions
    // that never touched a journaled table (a sign-in, a report send…)
    if (!r.change_set || r.undone_at) {
      skipped++;
      continue;
    }
    const res = await rollbackChangeSet(r.change_set);
    if (res.undone === 0 && res.failed === 0) {
      skipped++;
      continue;
    }
    if (res.failed > 0) failed++;
    if (res.undone > 0) {
      undone++;
      await db()
        .from("audit_log")
        .update({ undone_at: new Date().toISOString(), undone_by: real.id })
        .eq("id", r.id);
    }
  }
  await logAudit(real.id, "audit_undo", "system", null, {
    requested: ids.length,
    undone,
    skipped,
    failed,
  });
  refresh();
  return { ok: true, data: { undone, skipped, failed } };
}

// ================================================================== bulk operations

/** Archive many accounts at once (same rules as one-by-one: RBAC + business
 *  logic run PER ACCOUNT via setOutOfProcess — a row the viewer can't edit
 *  just counts as failed, it never blocks the rest). */
export async function bulkArchiveAccounts(
  ids: string[],
  reason: string
): Promise<ActionResult<{ done: number; failed: number }>> {
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one account.");
  // 50 keeps the slowest case (calendar-event cleanup per account) inside the
  // serverless time budget — bigger sweeps run in batches
  if (ids.length > 50) return fail("Max 50 accounts per bulk archive — run it in batches.");
  let done = 0;
  let failed = 0;
  for (const id of ids) {
    const res = await setOutOfProcess(id, reason);
    if (res.ok) done += 1;
    else failed += 1;
  }
  refresh();
  return { ok: true, data: { done, failed } };
}

/** Reassign many accounts to one member — per-account RBAC via reassignAccount. */
export async function bulkReassignAccounts(
  ids: string[],
  responsibleId: string,
  /** v24: email the new responsible a list of what landed on their plate */
  notifyByEmail = false
): Promise<ActionResult<{ done: number; failed: number; emailed: boolean }>> {
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one account.");
  if (ids.length > 50) return fail("Max 50 accounts per bulk reassign — run it in batches.");
  let done = 0;
  let failed = 0;
  let emailed = false;
  const doneIds: string[] = [];
  for (const id of ids) {
    const res = await reassignAccount(id, responsibleId);
    if (res.ok) { done += 1; doneIds.push(id); }
    else failed += 1;
  }

  if (notifyByEmail && doneIds.length > 0) {
    try {
      const viewer = await getViewer();
      const [{ data: target }, { data: accounts }] = await Promise.all([
        db()
          .from("members")
          .select("id, name, nickname, email, role")
          .eq("id", responsibleId)
          .maybeSingle<{ id: string; name: string; nickname: string | null; email: string | null; role: string }>(),
        db().from("accounts").select("name").in("id", doneIds).order("name"),
      ]);
      // assigning accounts to YOURSELF needs no heads-up
      if (target && target.id !== viewer.id) {
        const names = ((accounts ?? []) as { name: string }[]).map((a) => a.name);
        const { notifyMembers } = await import("./notify");
        await notifyMembers(
          [target.id],
          "broadcast",
          `📋 ${viewer.nickname || viewer.name} assigned you ${names.length} account${names.length === 1 ? "" : "s"}`,
          `${names.slice(0, 5).join(" · ")}${names.length > 5 ? ` · +${names.length - 5} more` : ""} — they're yours now, start raising!`,
          null,
          "/accounts"
        );
        // the LCP never receives operational emails (house rule)
        if (target.email && target.role !== "LCP" && !(await sandboxSuppressed("bulk-assign email"))) {
          emailed = true;
          const { accountsAssignedEmail } = await import("@/lib/email/templates");
          const { sendEmail } = await import("@/lib/google/gmail");
          const mail = accountsAssignedEmail({
            memberName: target.nickname || target.name,
            managerName: viewer.nickname || viewer.name,
            accountNames: names,
            accountsUrl: `${env.appUrl}/accounts`,
          });
          sendEmail({ to: [target.email], ...mail }).catch((e) =>
            console.error("[bulk-reassign] email failed:", e)
          );
        }
      }
    } catch (e) {
      console.error("[bulk-reassign] notify failed:", e);
    }
  }

  refresh();
  return { ok: true, data: { done, failed, emailed } };
}

// ================================================================== podio submit requests


// ================================================================== comments

/** Numbered comments: members log as many as they need; TL/VP/LCP comments
 *  carry their label. Numbering is derived from creation order per label. */
export async function addComment(
  accountId: string,
  body: string
): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to comment on this account.", "forbidden");
  const text = body?.trim();
  if (!text) return fail("Write the comment first 🙂");

  const { data: newComment, error } = await db()
    .from("account_comments")
    .insert({
      account_id: accountId,
      member_id: viewer.id,
      author_label: commentLabel(viewer),
      body: text,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) return fail(error.message);
  if (newComment) await recordUndo("account_comments", newComment.id, "insert");
  await logAudit(viewer.id, "comment", "account", accountId);
  await stampWork(viewer.id, "comment"); // v29: counts towards working hours
  refresh(accountId);
  return { ok: true };
}

/** Pin/unpin a comment — pinned comments are highlighted and surface as a 📌
 *  on the accounts list so nobody contacts the account without seeing it. */
export async function toggleCommentPin(
  commentId: string,
  pinned: boolean
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { data: comment } = await db()
    .from("account_comments")
    .select("id, account_id")
    .eq("id", commentId)
    .maybeSingle<{ id: string; account_id: string }>();
  if (!comment) return fail("Comment not found.");
  const account = await loadAccount(comment.account_id);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to pin comments on this account.", "forbidden");
  await snapshotForUndo("account_comments", commentId);
  const { error } = await db()
    .from("account_comments")
    .update({ pinned })
    .eq("id", commentId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, pinned ? "pin_comment" : "unpin_comment", "account", comment.account_id);
  refresh(comment.account_id);
  return { ok: true };
}

/** Archive/unarchive a comment — archived comments drop out of the default
 *  view (kept for the record). Archiving also unpins it so it can't linger as
 *  a 📌 on the accounts list. */
export async function toggleCommentArchive(
  commentId: string,
  archived: boolean
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { data: comment } = await db()
    .from("account_comments")
    .select("id, account_id")
    .eq("id", commentId)
    .maybeSingle<{ id: string; account_id: string }>();
  if (!comment) return fail("Comment not found.");
  const account = await loadAccount(comment.account_id);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to archive comments on this account.", "forbidden");
  await snapshotForUndo("account_comments", commentId);
  const { error } = await db()
    .from("account_comments")
    .update(archived ? { archived: true, pinned: false } : { archived: false })
    .eq("id", commentId);
  if (error) {
    if (error.message.includes("archived"))
      return fail("Comment archiving needs migration 0016 — run it in the Supabase SQL editor.");
    return fail(error.message);
  }
  await logAudit(viewer.id, archived ? "archive_comment" : "unarchive_comment", "account", comment.account_id);
  refresh(comment.account_id);
  return { ok: true };
}

// ================================================================== contacts

const contactSchema = z.object({
  accountId: z.string().uuid(),
  method: z.enum(["Call", "WhatsApp", "Email"]),
  status: z.enum([
    "No Response", "Responded", "Interested", "Not Interested", "Wrong Contact", "Visit Scheduled",
  ]),
  comment: z.string().trim().optional(),
  nextStep: z.string().trim().optional(),
  nextStepDate: z.string().optional(),
  nextStepTime: z.string().optional(),
  /** required when status = "Call Scheduled" */
  scheduledDate: z.string().optional(),
  scheduledTime: z.string().optional(),
});

export async function logContact(
  input: z.infer<typeof contactSchema>
): Promise<ActionResult<{ attempts: number; contactLimitReached: boolean }>> {
  const viewer = await getViewer();
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const {
    accountId, method, status, comment, scheduledDate, scheduledTime,
    nextStep, nextStepDate, nextStepTime,
  } = parsed.data;

  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to log contacts on this account.", "forbidden");
  if (account.out_of_process)
    return fail("This account is archived (Out of Process). Ask your TL/VP to bring it back first.");

  // "Not Interested" closes the account: it is archived automatically
  const notInterested = status === "Not Interested";
  // "Visit Scheduled" as a result BOOKS the visit — exactly like the button
  const visitScheduled = status === "Visit Scheduled";
  if (visitScheduled && (!scheduledDate || !scheduledTime))
    return fail("Pick the date and time of the visit.");
  // the visit lands on the RESPONSIBLE's calendar — fail BEFORE the attempt
  // row is written, or an unbookable visit leaves a phantom contact behind
  if (visitScheduled && !account.responsible_id)
    return fail("Assign a responsible first — the visit lands on THEIR calendar.");

  // BUSINESS RULE: after a contact without a scheduled visit, the account must
  // carry a next step with a date (unless one is already set in the future).
  const hasPendingVisit = account.visit_id && account.visit_done === null;
  const hasFutureNextStep =
    account.next_step_date && account.next_step_date >= new Date().toISOString().slice(0, 10);
  if (!notInterested && !visitScheduled && !hasPendingVisit && !nextStepDate && !hasFutureNextStep) {
    return fail(
      "Set a next step with a date (or schedule a visit) — no account may float without one.",
      "next_step_required"
    );
  }

  const { data: newAttempt, error } = await db()
    .from("contact_attempts")
    .insert({
      account_id: accountId,
      member_id: viewer.id,
      method,
      status,
      comment: comment || null,
    })
    .select("id")
    .single<{ id: string }>();
  if (newAttempt) await recordUndo("contact_attempts", newAttempt.id, "insert");
  if (error) {
    if (error.message.includes("enum contact_status"))
      return fail(
        'The database is missing the "Visit Scheduled" value — run migration 0007 in the Supabase SQL editor (it ends with a schema reload).'
      );
    return fail(error.message);
  }
  await stampWork(viewer.id, "contact"); // v29: counts towards working hours

  if (notInterested) {
    await snapshotForUndo("accounts", accountId);
    await db()
      .from("accounts")
      .update({
        out_of_process: true,
        oop_reason: comment ? `Not interested — ${comment}` : "Not interested",
        oop_at: new Date().toISOString(),
      })
      .eq("id", accountId);
    await logAudit(viewer.id, "out_of_process", "account", accountId, {
      reason: "Not interested",
    });
    refresh(accountId);
    return { ok: true, data: { attempts: 0, contactLimitReached: false } };
  }

  // book the visit through the exact same path as the dedicated button
  // (visit row + calendar reminders 24h & 1h before)
  if (visitScheduled) {
    const booked = await scheduleVisit({
      accountId,
      visitDate: scheduledDate!,
      visitTime: scheduledTime!,
      notes: comment || undefined,
    });
    if (!booked.ok) return booked;
  }

  if (nextStep || nextStepDate) {
    await snapshotForUndo("accounts", accountId);
    await db()
      .from("accounts")
      .update({
        next_step: nextStep || null,
        next_step_date: nextStepDate || null,
        next_step_time: nextStepTime || null,
      })
      .eq("id", accountId);
    await syncNextStepReminder(accountId);
  }

  const { count } = await db()
    .from("contact_attempts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  const { count: answered } = await db()
    .from("contact_attempts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .neq("status", "No Response");

  refresh(accountId);
  // BUSINESS RULE: 3 contacts without a final answer → prompt for Out of Process
  const contactLimitReached = (count ?? 0) >= 3 && (answered ?? 0) === 0;
  return { ok: true, data: { attempts: count ?? 0, contactLimitReached } };
}

// ================================================================== visits

const visitSchema = z.object({
  accountId: z.string().uuid(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a visit date"),
  visitTime: z.string().regex(/^\d{2}:\d{2}/, "Pick a visit time"),
  notes: z.string().trim().optional(),
});

/** Whether a member is on the RAISING side (not consideration-only). B2B and
 *  members with no sub-function set count as raising; anyone whose ONLY
 *  sub-function is Consideration is excluded. */
function isRaisingMember(m: { functions: string[] | null; sub_functions: string[] | null }): boolean {
  const subs = m.sub_functions ?? [];
  if (subs.length === 0) return true;
  if (subs.some((s) => ["Raising", "ICX", "B2B", "BD"].includes(s))) return true;
  return !subs.includes("Consideration");
}

const memberIsB2B = (m: { functions: string[] | null; sub_functions: string[] | null }) =>
  ["B2B", "BD"].some(
    (f) => (m.functions ?? []).includes(f) || (m.sub_functions ?? []).includes(f)
  );

const rowIsB2C = (m: { functions: string[] | null; sub_functions: string[] | null }) =>
  (m.functions ?? []).includes("B2C") || (m.sub_functions ?? []).includes("B2C");

/** Product label for emails/notifications: IGV / IGTa / IGTe / B2B. */
function productLabel(fn: string, product: string | null): string {
  if (fn === "IGT") return product === "GTe" ? "IGTe" : product === "GTa" ? "IGTa" : "IGT";
  return fn;
}

/** The functions a visit announcement fans out to:
 *  - IGV visit → the IGV raising crew + B2B
 *  - IGT visit → the IGT raising crew + B2B
 *  - B2B visit → the B2B crew ONLY (not the rest of ICX) */
function announceFunctions(fn: string): ("IGV" | "IGT" | "B2B" | "B2C")[] {
  if (fn === "IGV") return ["IGV", "B2B"];
  if (fn === "IGT") return ["IGT", "B2B"];
  if (fn === "B2C") return ["B2C"]; // its own island (v23)
  return ["B2B"]; // B2B/BD account → B2B crew only (memberIsB2B matches both)
}

/** Works out who the visit is shared with:
 *  - calendar attendees (Google invite): the responsible's TL (if a Member) and
 *    the function VP(s); TL/Coordinator → just the VP(s). Raising only.
 *  - announcement crew: the whole product-function raising team + B2B (email +
 *    in-app notification), minus the responsible & the scheduler.
 *  All best-effort — never blocks the booking. */
async function resolveVisitRecipients(
  account: PipelineRow,
  responsible: Member | null,
  viewerId: string
): Promise<{ attendeeEmails: string[]; announceIds: string[]; announceEmails: string[] }> {
  const empty = { attendeeEmails: [], announceIds: [], announceEmails: [] };
  if (!responsible || !isRaisingMember(responsible)) return empty;

  type Row = {
    id: string; email: string; role: MemberRole;
    functions: string[] | null; sub_functions: string[] | null;
    stakeholder_id: string | null;
  };
  const { data: all } = await db()
    .from("members")
    .select("id, email, role, functions, sub_functions, stakeholder_id, is_active")
    .eq("is_active", true);
  const members = (all ?? []) as Row[];
  const byId = new Map(members.map((m) => [m.id, m]));

  const fns = announceFunctions(account.function);
  const inFunction = (m: Row) =>
    (m.functions ?? []).some((f) => (fns as string[]).includes(f)) ||
    // B2B may live in sub-functions; same for B2C — but ONLY when that
    // function is actually part of this announcement
    ((fns as string[]).includes("B2B") && memberIsB2B(m)) ||
    ((fns as string[]).includes("B2C") && rowIsB2C(m));

  // ---- calendar attendees (TL + VP as the spec describes) ----
  const attendees = new Set<string>();
  const vps = members.filter(
    (m) =>
      m.role === "LCVP" &&
      ((m.functions ?? []).some((f) => (fns as string[]).includes(f)) ||
        // B2B/BD (and B2C) VPs may carry the label in sub-functions only
        ((fns as string[]).includes("B2B") && memberIsB2B(m)) ||
        ((fns as string[]).includes("B2C") && rowIsB2C(m)))
  );
  if (responsible.role === "Member") {
    const tl = responsible.stakeholder_id ? byId.get(responsible.stakeholder_id) : null;
    if (tl?.role === "Team Leader" && tl.email) attendees.add(tl.email);
    for (const vp of vps) if (vp.email) attendees.add(vp.email);
  } else if (responsible.role === "Team Leader" || responsible.role === "Coordinator") {
    for (const vp of vps) if (vp.email) attendees.add(vp.email);
  }
  if (responsible.email) attendees.delete(responsible.email);

  // ---- announcement crew: whole raising function + B2B ----
  const announceIds: string[] = [];
  const announceEmails: string[] = [];
  for (const m of members) {
    if (m.role === "LCP") continue; // the LCP never gets operational mail
    if (m.id === responsible.id || m.id === viewerId) continue; // they get the direct notice
    if (!inFunction(m) || !isRaisingMember(m)) continue;
    announceIds.push(m.id);
    if (m.email) announceEmails.push(m.email);
  }

  return { attendeeEmails: [...attendees], announceIds, announceEmails };
}

export async function scheduleVisit(
  input: z.infer<typeof visitSchema>
): Promise<
  ActionResult<{ inviteSent: boolean; calendarLinked: boolean; sharedCount: number }>
> {
  const viewer = await getViewer();
  const parsed = visitSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { accountId, visitDate, visitTime, notes } = parsed.data;

  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to schedule visits on this account.", "forbidden");
  if (!account.responsible_id)
    return fail("Assign a responsible first — the visit lands on THEIR calendar.");

  const { data: responsible } = await db()
    .from("members")
    .select("*")
    .eq("id", account.responsible_id)
    .maybeSingle<Member>();

  const recipients = await resolveVisitRecipients(account, responsible, viewer.id);

  const detailsUrl = `${env.appUrl}/accounts/${accountId}`;
  const eventInput = {
    accountName: account.name,
    visitDate,
    visitTime,
    notes,
    detailsUrl,
    attendees: recipients.attendeeEmails,
  };

  // reschedule if a pending visit exists, otherwise create — keep the row id so
  // the calendar invite has a stable UID (a reschedule updates the same event)
  const { data: pending } = await db()
    .from("visits")
    .select("*")
    .eq("account_id", accountId)
    .is("done", null)
    .maybeSingle<Visit>();

  let visitId = pending?.id ?? null;
  if (pending) {
    await snapshotForUndo("visits", pending.id);
    await db()
      .from("visits")
      .update({ visit_date: visitDate, visit_time: visitTime, followup_prompt_sent_at: null })
      .eq("id", pending.id);
  } else {
    const { data: created, error } = await db()
      .from("visits")
      .insert({
        account_id: accountId,
        member_id: account.responsible_id,
        visit_date: visitDate,
        visit_time: visitTime,
      })
      .select("id")
      .single();
    if (error) return fail(error.message);
    visitId = created.id;
    await recordUndo("visits", created.id, "insert");
  }

  const token = responsible?.google_refresh_token ?? null;
  const inviteTo = [
    ...(responsible?.email ? [responsible.email] : []),
    ...recipients.attendeeEmails,
  ];
  const eventWithAttendees = { ...eventInput, attendees: inviteTo };

  // The event is created through the first mechanism that works, so it reaches
  // the calendar no matter how the member signed in:
  let calendarLinked = false;
  let inviteSent = false;

  // TIER 1 — the responsible's OWN Google Calendar (they signed in with Google,
  // which grants calendar scope). Instant, on their real calendar, TL/VP invited.
  if (token) {
    try {
      let eventId: string | null = null;
      if (pending?.calendar_event_id) {
        await updateVisitEvent(token, pending.calendar_event_id, eventWithAttendees);
        eventId = pending.calendar_event_id;
      } else {
        eventId = await createVisitEvent(token, eventWithAttendees);
      }
      if (eventId) {
        calendarLinked = true;
        inviteSent = true; // Google invited the attendees
        if (eventId !== pending?.calendar_event_id)
          await db().from("visits").update({ calendar_event_id: eventId }).eq("id", visitId);
      }
    } catch (e) {
      console.error("[visits] responsible-calendar insert failed, trying mailbox:", e);
    }
  }

  // TIER 2 — the IM mailbox's shared "Sodio — LC Visits" calendar (covers members
  // who signed in with a password / have no personal Google grant). Requires the
  // IM token's calendar scope.
  if (!calendarLinked) {
    try {
      const calId = await getVisitsCalendarId();
      if (calId) {
        const eventId = await upsertMailboxVisitEvent(
          calId,
          pending?.calendar_event_id ?? null,
          eventWithAttendees
        );
        if (eventId) {
          calendarLinked = true;
          inviteSent = true; // Google emailed the invites itself
          if (eventId !== pending?.calendar_event_id)
            await db().from("visits").update({ calendar_event_id: eventId }).eq("id", visitId);
        }
      }
    } catch (e) {
      console.error("[visits] mailbox calendar event failed, will email .ics:", e);
    }
  }

  // TIER 3 — email a real .ics invite (canonical multipart/alternative,
  // METHOD:REQUEST, 24h & 1h alarms) so the event still reaches everyone.
  if (!calendarLinked && inviteTo.length > 0) {
    try {
      const ics = buildVisitIcs({
        uid: `visit-${visitId}@sodio.aiesec.alexandria`,
        accountName: account.name,
        visitDate,
        visitTime,
        notes,
        detailsUrl,
        organizerEmail: env.gmailSender || viewer.email || "",
        organizerName: "Sodio · AIESEC in Alexandria",
        attendeeEmails: inviteTo,
        method: "REQUEST",
      });
      const { visitInviteEmail } = await import("@/lib/email/templates");
      const mail = visitInviteEmail({
        accountName: account.name,
        visitDate,
        visitTime,
        notes: notes || null,
        sharedWith: recipients.attendeeEmails,
        accountUrl: detailsUrl,
      });
      await sendEmail({ to: inviteTo, ...mail, ics: { content: ics, method: "REQUEST" } });
      inviteSent = true;
    } catch (e) {
      console.error("[visits] invite email failed:", e);
    }
  }

  const slug = accountSlug(account.name);
  const product = productLabel(account.function, account.product);
  const { notifyMembers } = await import("./notify");
  // the responsible: a clickable "your visit is booked" notice
  await notifyMembers(
    [account.responsible_id],
    "visit",
    `Visit booked — ${account.name} 🗓️`,
    `${visitDate} at ${visitTime.slice(0, 5)}.${inviteSent ? " A calendar invite is in your inbox — accept it for the 24h & 1h reminders." : " (Calendar invite couldn't be emailed — check with the IM team.)"}`,
    viewer.id,
    `/accounts/${slug}`
  );

  // function-wide fan-out: the whole product's raising crew + B2B get an FYI
  // email AND an in-app notification (no calendar reminder for them)
  if (recipients.announceIds.length > 0) {
    const responsibleName =
      responsible?.nickname || responsible?.name || account.responsible_nickname || account.responsible_name;
    await notifyMembers(
      recipients.announceIds,
      "visit_announcement",
      `📢 New ${product} visit — ${account.name}`,
      `${responsibleName} booked a visit with ${account.name} on ${visitDate} at ${visitTime.slice(0, 5)}.`,
      viewer.id
    );
    if (recipients.announceEmails.length > 0) {
      const { visitAnnouncementEmail } = await import("@/lib/email/templates");
      const mail = visitAnnouncementEmail({
        responsibleName,
        accountName: account.name,
        product,
        visitDate,
        visitTime,
        notes: notes || null,
        accountUrl: `${env.appUrl}/accounts/${slug}`,
      });
      sendEmail({ to: [env.gmailSender || viewer.email || ""].filter(Boolean), bcc: recipients.announceEmails, ...mail }).catch(
        (e) => console.error("[visits] announcement email failed:", e)
      );
    }
  }

  await logAudit(viewer.id, "schedule_visit", "account", accountId, {
    visitDate, visitTime, inviteSent, calendarLinked, announced: recipients.announceIds.length,
  });
  await stampWork(viewer.id, "visit_scheduled"); // v29: counts towards working hours
  refresh(accountId);
  return { ok: true, data: { inviteSent, calendarLinked, sharedCount: recipients.attendeeEmails.length } };
}

const reportSchema = z.object({
  visitId: z.string().uuid(),
  done: z.boolean(),
  comment: z.string().trim().min(2, "Add a short comment about the visit"),
  nextStep: z.string().trim().optional(),
  nextStepDate: z.string().optional(),
});

/** Member reports a visit (done / not done) → styled email fires to the VP and
 *  the member's stakeholder immediately. */
export async function reportVisit(
  input: z.infer<typeof reportSchema>
): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { visitId, done, comment, nextStep, nextStepDate } = parsed.data;

  const { data: visit } = await db()
    .from("visits")
    .select("*")
    .eq("id", visitId)
    .maybeSingle<Visit>();
  if (!visit) return fail("Visit not found.");
  const account = await loadAccount(visit.account_id);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to report this visit.", "forbidden");

  await snapshotForUndo("visits", visitId);
  const { error } = await db()
    .from("visits")
    .update({ done, visit_comment: comment, next_step: nextStep || null })
    .eq("id", visitId);
  if (error) return fail(error.message);

  if (nextStep || nextStepDate) {
    await snapshotForUndo("accounts", visit.account_id);
    await db()
      .from("accounts")
      .update({ next_step: nextStep || null, next_step_date: nextStepDate || null })
      .eq("id", visit.account_id);
    await syncNextStepReminder(visit.account_id);
  }

  // notify: function VP(s) + the responsible's stakeholder (deduped)
  const [{ data: responsible }, { data: vps }] = await Promise.all([
    db().from("members").select("*, stakeholder:members!members_stakeholder_id_fkey(*)")
      .eq("id", visit.member_id).maybeSingle(),
    db().from("members").select("*")
      .eq("role", "LCVP")
      .contains("functions", [account.function])
      .eq("is_active", true),
  ]);
  const recipients = new Map<string, string>();
  for (const vp of (vps ?? []) as Member[])
    if (vp.email) recipients.set(vp.email.toLowerCase(), vp.email);
  const stakeholder = (responsible as { stakeholder?: Member } | null)?.stakeholder;
  // the LCP does not receive operational reports — that is the VP's concern
  if (stakeholder?.email && stakeholder.role !== "LCP")
    recipients.set(stakeholder.email.toLowerCase(), stakeholder.email);
  if (viewer.email) recipients.delete(viewer.email.toLowerCase());

  if (recipients.size > 0) {
    const mail = visitReportEmail({
      memberName: viewer.nickname || viewer.name,
      accountName: account.name,
      visitDate: visit.visit_date,
      visitTime: visit.visit_time,
      done,
      visitComment: comment,
      nextStep: nextStep || null,
      accountUrl: `${env.appUrl}/accounts/${account.id}`,
    });
    sendEmail({ to: [...recipients.values()], ...mail })
      .then(() => db().from("visits").update({ report_sent_at: new Date().toISOString() }).eq("id", visitId))
      .catch((e) => console.error("[visits] report email failed:", e));
  }

  await logAudit(viewer.id, "report_visit", "visit", visitId, { done });
  await stampWork(viewer.id, "visit_reported"); // v29: counts towards working hours
  refresh(visit.account_id);
  return { ok: true };
}

// ================================================================== feedback

export async function submitFeedback(input: {
  type: "Bug" | "Enhancement" | "Other";
  category?: string;
  message: string;
  page?: string;
  anonymous?: boolean;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!input.message?.trim()) return fail("Tell us what happened first 🙂");
  // the category list depends on the type — validate against the pick-lists
  const allowedCategories = FEEDBACK_CATEGORIES[input.type] ?? [];
  const category =
    input.category && (allowedCategories as readonly string[]).includes(input.category)
      ? input.category
      : null;
  const { error } = await db().from("feedback").insert({
    member_id: input.anonymous ? null : viewer.id,
    anonymous: !!input.anonymous,
    type: input.type,
    category,
    message: input.message.trim(),
    page: input.page || null,
  });
  if (error) {
    if (error.message.includes("category"))
      return fail("Feedback categories need migration 0017 — run it in the Supabase SQL editor.");
    return fail(error.message);
  }

  // straight to the IM director + IM coach inboxes
  const { feedbackEmail } = await import("@/lib/email/templates");
  const mail = feedbackEmail({
    memberName: input.anonymous ? "Anonymous member 🎭" : viewer.nickname || viewer.name,
    memberEmail: input.anonymous ? "hidden" : viewer.email ?? "no email (phone sign-in)",
    type: category ? `${input.type} · ${category}` : input.type,
    message: input.message.trim(),
    inboxUrl: `${env.appUrl}/feedback/inbox`,
  });
  sendEmail({ to: [...FEEDBACK_INBOX_EMAILS], ...mail }).catch((e) =>
    console.error("[feedback] notification email failed:", e)
  );
  await logAudit(viewer.id, "feedback", "feedback", null, { type: input.type });
  return { ok: true };
}

// ================================================================== profile & onboarding

const profileSchema = z.object({
  name: z.string().trim().min(2, "Your full name is required."),
  nickname: z.string().trim().min(1, "Pick the nickname the LC knows you by."),
  phone: z
    .string()
    .trim()
    .transform(cleanPhone)
    .refine((v) => PHONE_RE.test(v), "Phone must be numbers only (7–15 digits)."),
});

async function writeProfileBackToSheet(memberId: string) {
  const { data: m } = await db()
    .from("members")
    .select("*")
    .eq("id", memberId)
    .maybeSingle<Member>();
  if (!m) return;
  const { writeMemberToSheet } = await import("@/lib/google/sheets");
  await writeMemberToSheet({
    name: m.name,
    nickname: m.nickname,
    email: m.email,
    phone: m.phone,
    role: m.role,
    functions: m.functions ?? [],
    sub_functions: m.sub_functions ?? [],
    stakeholder_name: m.stakeholder_name,
    team_name: m.team_name,
    is_active: m.is_active,
  }).catch((e) => console.error("[sheets] membership write-back failed:", e));
}

/** First login: the member confirms their info and sets their own password. */
export async function completeOnboarding(input: {
  name: string;
  nickname: string;
  phone: string;
  password: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  // never complete someone ELSE's onboarding from the admin test view
  if (viewer.impersonated)
    return fail("You're in a test view — exit it before onboarding actions.", "forbidden");
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (!input.password || input.password.length < 8)
    return fail("Your password needs at least 8 characters.");

  const password_hash = await bcrypt.hash(input.password, 10);
  const patch = {
    name: parsed.data.name,
    nickname: parsed.data.nickname,
    phone: parsed.data.phone,
    password_hash,
    profile_completed_at: new Date().toISOString(),
  };
  const { error } = await db()
    .from("members")
    .update({ ...patch, temp_password_hash: null })
    .eq("id", viewer.id);
  if (error) {
    if (!error.message.includes("temp_password")) return fail(error.message);
    const { error: e2 } = await db().from("members").update(patch).eq("id", viewer.id);
    if (e2) return fail(e2.message);
  }

  await writeProfileBackToSheet(viewer.id);
  await logAudit(viewer.id, "onboarding_complete", "member", viewer.id);
  refresh();
  return { ok: true };
}

/** Profile page: members edit what belongs to them (nickname, phone). */
export async function updateProfile(input: {
  nickname: string;
  phone: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = profileSchema.safeParse({ name: viewer.name, ...input });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  await snapshotForUndo("members", viewer.id); // sandbox test view: roll back on exit
  const { error } = await db()
    .from("members")
    .update({ nickname: parsed.data.nickname, phone: parsed.data.phone })
    .eq("id", viewer.id);
  if (error) return fail(error.message);

  await writeProfileBackToSheet(viewer.id);
  await logAudit(viewer.id, "profile_update", "member", viewer.id);
  refresh();
  return { ok: true };
}

export async function changePassword(input: {
  current: string;
  next: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!input.next || input.next.length < 8)
    return fail("Your new password needs at least 8 characters.");
  if (viewer.password_hash) {
    // the emailed temp password counts as "current" too
    const ok =
      (await bcrypt.compare(input.current ?? "", viewer.password_hash)) ||
      (viewer.temp_password_hash
        ? await bcrypt.compare(input.current ?? "", viewer.temp_password_hash)
        : false);
    if (!ok)
      return fail('Your current password is wrong. Forgot it? Use "Forgot password" on the login page — a new one lands in your inbox.');
  }
  const password_hash = await bcrypt.hash(input.next, 10);
  await snapshotForUndo("members", viewer.id); // sandbox test view: roll back on exit
  const { error } = await db()
    .from("members")
    .update({ password_hash, temp_password_hash: null })
    .eq("id", viewer.id);
  if (error) {
    if (error.message.includes("temp_password")) {
      const { error: e2 } = await db().from("members").update({ password_hash }).eq("id", viewer.id);
      if (e2) return fail(e2.message);
    } else return fail(error.message);
  }
  await logAudit(viewer.id, "password_change", "member", viewer.id);
  return { ok: true };
}

/** Admin-only: reports exactly which calendar tiers are working, so we can tell
 *  at a glance why (or whether) visit events land. */
export async function diagnoseCalendar(): Promise<ActionResult<{ lines: string[] }>> {
  const viewer = await getViewer();
  if (!viewer.isAdmin) return fail("Admins only.", "forbidden");
  const lines: string[] = [];
  lines.push(
    viewer.google_refresh_token
      ? "✅ Tier 1 (your own Google Calendar): you have a Google grant — your own visits land instantly."
      : "⚠️ Tier 1: you have no personal Google grant (you'd rely on Tier 2/3)."
  );
  const { diagnoseMailboxCalendar } = await import("@/lib/google/calendar");
  const m = await diagnoseMailboxCalendar();
  lines.push(
    `${m.ok ? "✅" : "❌"} Tier 2 (shared “Sodio — LC Visits” calendar): ${m.detail}`
  );
  lines.push(
    "✅ Tier 3 (emailed .ics invite): always available as a fallback — the event arrives in the inbox for one-tap add."
  );
  return { ok: true, data: { lines } };
}

/** Profile page: pick a fun avatar, upload your own, or fall back to the Google
 *  photo (null). Accepts an https image URL or a resized data:image/... upload
 *  (client-compressed to keep the row small). */
export async function updateAvatar(url: string | null): Promise<ActionResult> {
  const viewer = await getViewer();
  const clean = url?.trim() || null;
  if (clean) {
    const isHttps = /^https:\/\/\S+$/i.test(clean);
    const isDataImage = /^data:image\/(png|jpe?g|webp);base64,/i.test(clean);
    // The Blue Man mascot (BLUE_MAN_AVATAR in lib/avatars.ts) is the ONE
    // site-relative path allowed — it's our own bundled /public asset, so a
    // strict whitelist of the exact literal, never arbitrary relative paths.
    const isBlueMan = clean === "/brand/walk.png";
    if (!isHttps && !isDataImage && !isBlueMan)
      return fail("The avatar must be an image link or an uploaded picture.");
    // ~400KB cap on uploaded images (the client already downscales to ~256px)
    if (isDataImage && clean.length > 550_000)
      return fail("That image is too large — pick a smaller one (it's downscaled automatically, so try again).");
  }
  await snapshotForUndo("members", viewer.id); // sandbox test view: roll back on exit
  const { error } = await db()
    .from("members")
    .update({ avatar_url: clean })
    .eq("id", viewer.id);
  if (error)
    return fail(
      error.message.includes("avatar_url")
        ? "Avatars need migration 0009 — ask the IM team to run it."
        : error.message
    );
  await logAudit(viewer.id, "avatar_update", "member", viewer.id);
  refresh();
  return { ok: true };
}

// ================================================================== membership (EB + admin)

const memberSchema = z
  .object({
    id: z.string().uuid().nullish(),
    name: z.string().trim().min(2, "Name is required."),
    nickname: z.string().trim().nullish(),
    // email is OPTIONAL since v24 — phone-only members sign in with their
    // number (both fields) until the AIESEC email lands
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === "" || EMAIL_RE.test(v), "That email doesn't look valid.")
      .nullish(),
    phone: phoneField,
    role: z.enum(MEMBER_ROLES as [MemberRole, ...MemberRole[]]),
    functions: z.array(z.enum(LC_FUNCTIONS as unknown as [string, ...string[]])),
    sub_functions: z.array(z.enum(SUB_FUNCTIONS as unknown as [string, ...string[]])),
    stakeholder_name: z.string().trim().nullish(),
    team_name: z.string().trim().nullish(),
    is_active: z.boolean(),
  })
  .refine((m) => !!m.email || !!m.phone, {
    message: "A member needs an email OR a phone number (phone-only members sign in with their number).",
  });

/** EB (LCP/LCVPs) + admins edit membership directly in the system; every
 *  change is written back to the Membership sheet so imports don't revert it. */
export async function upsertMember(
  input: z.infer<typeof memberSchema>
): Promise<ActionResult<{ id: string }>> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer))
    return fail("Only the EB and admins can edit membership.", "forbidden");
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const m = parsed.data;

  // a phone-only member's phone IS their identity — block a second member
  // with the same number (the DB partial index would reject it cryptically)
  if (!m.email && m.phone) {
    const digits = m.phone.replace(/\D/g, "");
    const { data: phoneTwins } = await db()
      .from("members")
      .select("id, name, phone")
      .is("email", null)
      .not("phone", "is", null)
      .ilike("phone", `%${digits.slice(-8)}%`)
      .limit(10);
    const twin = ((phoneTwins ?? []) as { id: string; name: string; phone: string | null }[]).find(
      (t) => t.id !== (m.id ?? "") && (t.phone ?? "").replace(/\D/g, "") === digits
    );
    if (twin)
      return fail(`"${twin.name}" already signs in with this phone number — phone-only members need unique numbers.`);
  }

  const row = {
    name: m.name,
    nickname: m.nickname || null,
    email: m.email || null,
    phone: m.phone || null,
    role: m.role,
    functions: m.functions,
    sub_functions: m.sub_functions,
    stakeholder_name: m.stakeholder_name || null,
    team_name: m.team_name || null,
    is_active: m.is_active,
  };

  let id = m.id ?? null;
  if (id) {
    // never ERASE an existing email with an empty field — adding one is the
    // phone-only upgrade path, removing one only happens via the sheet
    const { email: emailValue, ...rest } = row;
    const updatePayload = emailValue ? row : rest;
    const { error } = await db().from("members").update(updatePayload).eq("id", id);
    if (error) return fail(error.message);
  } else if (row.email) {
    const { data: created, error } = await db()
      .from("members")
      .upsert(row, { onConflict: "email" })
      .select("id")
      .single();
    if (error) return fail(error.message);
    id = created.id;
  } else {
    // no email → plain insert (nulls never conflict on the email key)
    const { data: created, error } = await db()
      .from("members")
      .insert(row)
      .select("id")
      .single();
    if (error) return fail(error.message);
    id = created.id;
  }

  // resolve the manager name → id link (default chain: VP → Director → LCP)
  const { data: all } = await db()
    .from("members")
    .select("id, name, nickname, role, functions, stakeholder_name, stakeholder_id, is_active");
  let targetId: string | null = null;
  if (m.stakeholder_name) {
    // a plain Member can never BE a manager — such names fall through to the
    // default chain (VP → Director → LCP)
    targetId =
      (all ?? []).find(
        (x) =>
          x.id !== id &&
          x.role !== "Member" &&
          (x.name.trim().toLowerCase() === m.stakeholder_name!.trim().toLowerCase() ||
            x.nickname?.trim().toLowerCase() === m.stakeholder_name!.trim().toLowerCase())
      )?.id ?? null;
  }
  if (!targetId) {
    const { defaultManagerId } = await import("@/lib/google/sheets");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = (all ?? []).find((x) => x.id === id) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (self) targetId = defaultManagerId({ ...self, role: m.role, functions: m.functions }, (all ?? []) as any);
  }
  if (targetId === id) targetId = null;
  await db().from("members").update({ stakeholder_id: targetId }).eq("id", id);

  const { writeMemberToSheet } = await import("@/lib/google/sheets");
  await writeMemberToSheet(row).catch((e) =>
    console.error("[sheets] membership write-back failed:", e)
  );

  // this edit may have moved them off a plan they had filed (Consideration →
  // Raising, MM → Member, a function swap) — drop what no longer applies
  const { prunePlansForMember } = await import("./data");
  await prunePlansForMember({
    id: id!,
    role: m.role,
    functions: m.functions,
    sub_functions: m.sub_functions,
  });

  await logAudit(viewer.id, m.id ? "member_update" : "member_add", "member", id, {
    email: m.email,
  });
  refresh();
  return { ok: true, data: { id: id! } };
}

/** EB reset: a fresh password is generated and EMAILED to the member (their
 *  old one keeps working until they change it — no lockouts). */
export async function resetMemberPassword(memberId: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer))
    return fail("Only the EB and admins can reset passwords.", "forbidden");
  const { data: member } = await db()
    .from("members")
    .select("id, email, name, nickname")
    .eq("id", memberId)
    .maybeSingle<{ id: string; email: string | null; name: string; nickname: string | null }>();
  if (!member) return fail("Member not found.");
  if (!member.email)
    return fail("This member has no email — they sign in with their phone number (both fields).");
  const { issueTempPassword } = await import("./password");
  const res = await issueTempPassword({ ...member, email: member.email });
  if (!res.ok) return fail(res.error ?? "Couldn't issue the password.");
  await logAudit(viewer.id, "password_reset", "member", memberId);
  return { ok: true };
}

// ---- teams registry (v24.2): ALL team types managed in-app ----

const TEAM_TYPES = ["EB", "LB", "Function", "Function leaders", "Team"] as const;
/** EB and LB are SINGLE teams; Function & Function leaders are one per
 *  function; Team (a TL's team) is many per function. */
const SINGLE_TEAM_TYPES = new Set(["EB", "LB"]);
const PER_FN_SINGLE_TYPES = new Set(["Function", "Function leaders"]);

async function syncTeamRegistrySheet(): Promise<void> {
  const { data } = await db()
    .from("teams")
    .select("type, function_key, name")
    .order("type")
    .order("function_key")
    .order("name");
  const { writeTeamsTab } = await import("@/lib/google/sheets");
  await writeTeamsTab(
    (data ?? []) as { type: string; function_key: string; name: string }[]
  ).catch((e) => console.error("[teams] tab mirror failed:", e));
}

/** Add or edit a named team (Membership Teams card, EB/admin). `id` set =
 *  rename/move that row; unset = create. The Teams tab follows. */
export async function saveTeamEntry(input: {
  id?: string | null;
  type: string;
  functionKey: string;
  name: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer))
    return fail("Only the EB and admins manage teams.", "forbidden");
  const type = (input.type ?? "").trim();
  if (!(TEAM_TYPES as readonly string[]).includes(type)) return fail("Pick a valid team type.");
  const fn = SINGLE_TEAM_TYPES.has(type) ? "" : (input.functionKey ?? "").trim().toUpperCase();
  if (!SINGLE_TEAM_TYPES.has(type) && !fn) return fail("Pick the team's function.");
  const name = (input.name ?? "").trim();
  if (name.length < 2) return fail("Type the team's name.");

  // single-team rules: EB/LB once ever; Function & Function leaders once per fn
  if (SINGLE_TEAM_TYPES.has(type) || PER_FN_SINGLE_TYPES.has(type)) {
    let dupQ = db().from("teams").select("id, name").eq("type", type);
    if (PER_FN_SINGLE_TYPES.has(type)) dupQ = dupQ.eq("function_key", fn);
    const { data: dupes } = await dupQ.limit(5);
    const other = ((dupes ?? []) as { id: string; name: string }[]).find(
      (t) => t.id !== (input.id ?? "")
    );
    if (other)
      return fail(
        `${type}${PER_FN_SINGLE_TYPES.has(type) ? ` for ${fn}` : ""} already has a team ("${other.name}") — edit that one instead.`
      );
  }

  if (input.id) {
    const { error } = await db()
      .from("teams")
      .update({ type, function_key: fn, name })
      .eq("id", input.id);
    if (error) return fail(error.message);
  } else {
    const { error } = await db()
      .from("teams")
      .upsert({ type, function_key: fn, name }, { onConflict: "type,function_key,name" });
    if (error) return fail(error.message);
  }
  await logAudit(viewer.id, input.id ? "team_update" : "team_add", "team", input.id ?? null, {
    type, fn, name,
  });
  await syncTeamRegistrySheet();
  refresh();
  return { ok: true };
}

/** Remove a team from the registry (members keep their team_name text). */
export async function deleteTeamEntry(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer))
    return fail("Only the EB and admins manage teams.", "forbidden");
  const { error } = await db().from("teams").delete().eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "team_delete", "team", id);
  await syncTeamRegistrySheet();
  refresh();
  return { ok: true };
}

// ================================================================== admin

export async function runMembershipImport(): Promise<ActionResult<{ imported: number }>> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer)) return fail("Admins only.", "forbidden");
  const { importMembership } = await import("@/lib/google/sheets");
  try {
    const imported = await importMembership();
    refresh();
    return { ok: true, data: { imported } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Membership import failed.");
  }
}

export async function runSheetsExport(): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer)) return fail("Admins only.", "forbidden");
  const { exportAllSheets } = await import("@/lib/google/sheets");
  try {
    await exportAllSheets();
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Sheets export failed.");
  }
}

// ================================================================== contacts (tagged)

/** Multiple tagged phones/emails per account ("CEO", "HR", …). The first phone
 *  and first email also fill the legacy columns so sheet mirrors keep working. */
export async function updateAccountContacts(
  accountId: string,
  contacts: AccountContact[]
): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account.", "forbidden");

  await snapshotForUndo("accounts", accountId);
  const { list: clean, error: contactError } = cleanContacts(contacts);
  if (contactError) return fail(contactError);

  const { error } = await db()
    .from("accounts")
    .update({ contacts: clean, ...legacyContactColumns(clean) })
    .eq("id", accountId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "update_contacts", "account", accountId, { count: clean.length });
  refresh(accountId);
  return { ok: true };
}

// ============================================================ archive bulk (v24)

/** Bring several archived accounts back to active — RBAC per row (TL+ via
 *  canReassignAccount, exactly like the single Revive button). */
export async function bulkReviveAccounts(
  ids: string[]
): Promise<ActionResult<{ revived: number; failed: number }>> {
  const viewer = await getViewer();
  if (!ids?.length) return fail("Nothing selected.");
  if (ids.length > 50) return fail("Revive at most 50 accounts at a time.");
  let revived = 0;
  for (const id of ids) {
    const account = await loadAccount(id);
    if (!account || !account.out_of_process) continue;
    // the single action carries the full revive semantics (RBAC, undo
    // snapshot, next-step calendar reminder, audit) — never fork the logic
    const res = await reviveAccount(id);
    if (res.ok) revived++;
  }
  await logAudit(viewer.id, "bulk_revive", "account", null, { count: revived });
  refresh();
  return { ok: true, data: { revived, failed: ids.length - revived } };
}

/** PERMANENTLY delete archived accounts (children included) — VP+ only.
 *  This frees the names for re-adding; there is no undo outside sandbox. */
export async function bulkDeleteArchived(
  ids: string[]
): Promise<ActionResult<{ deleted: number; failed: number }>> {
  const viewer = await getViewer();
  const allowed = viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
  if (!allowed) return fail("Only VPs, Directors or the LCP delete archived accounts.", "forbidden");
  // a permanent delete cannot be journaled faithfully (children are gone) —
  // it has no place in ANY session that promises to undo everything on exit
  if (viewer.sandbox)
    return fail("Deleting archived accounts is disabled in the sandbox test view — it can't be undone on exit.");
  {
    const { lcTestSession } = await import("./sandbox");
    if (await lcTestSession())
      return fail(
        "Deleting archived accounts is disabled while an LC testing session is running — a cascade delete can't be rolled back when the session ends."
      );
  }
  if (!ids?.length) return fail("Nothing selected.");
  if (ids.length > 50) return fail("Delete at most 50 accounts at a time.");
  let deleted = 0;
  for (const id of ids) {
    const account = await loadAccount(id);
    // only ARCHIVED accounts inside the viewer's edit scope can be deleted
    if (!account || !account.out_of_process || !canEditAccount(viewer, account)) continue;
    // children first; ANY failure aborts THIS account before its row is
    // touched, so a half-deleted (history-stripped but live) row can't linger
    const children = ["contact_attempts", "visits", "account_comments", "deals"];
    let childError = false;
    for (const table of children) {
      const { error } = await db().from(table).delete().eq("account_id", id);
      if (error) {
        console.error(`[bulk-delete] ${table} for ${id}:`, error.message);
        childError = true;
        break;
      }
    }
    if (childError) continue;
    const { error } = await db().from("accounts").delete().eq("id", id);
    if (!error) deleted++;
  }
  await logAudit(viewer.id, "bulk_delete_archived", "account", null, { count: deleted });
  refresh();
  return { ok: true, data: { deleted, failed: ids.length - deleted } };
}

// ============================================================ B2C podio updates (v23)

const PODIO_UPDATE_FNS = new Set(["IGV", "IGT", "BD", "B2C"]);

/** The account must be refreshed on Podio every N days (v24 — IGV/IGT/BD/B2C).
 *  "I updated it" stamps now, resets the countdown and clears both reminders. */
export async function markPodioUpdated(accountId: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account.", "forbidden");
  if (!PODIO_UPDATE_FNS.has(account.function))
    return fail("Continuous Podio updates don't apply to this account.");
  await snapshotForUndo("accounts", accountId);
  const { error } = await db()
    .from("accounts")
    .update({
      podio_updated_at: new Date().toISOString(),
      podio_update_notified_at: null,
      podio_update_second_notified_at: null,
    })
    .eq("id", accountId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "podio_updated", "account", accountId);
  refresh(accountId);
  return { ok: true };
}

/** Change how often this account must be refreshed on Podio (days). */
export async function setPodioUpdateCadence(
  accountId: string,
  everyDays: number
): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account.", "forbidden");
  if (!PODIO_UPDATE_FNS.has(account.function))
    return fail("Continuous Podio updates don't apply to this account.");
  const days = Math.round(Number(everyDays));
  if (!Number.isFinite(days) || days < 1 || days > 90)
    return fail("Pick a cadence between 1 and 90 days.");
  await snapshotForUndo("accounts", accountId);
  const { error } = await db()
    .from("accounts")
    .update({
      podio_update_every_days: days,
      // a new cadence starts a fresh reminder cycle — stale stamps otherwise
      // re-fire the first nag and suppress the second
      podio_update_notified_at: null,
      podio_update_second_notified_at: null,
    })
    .eq("id", accountId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "podio_cadence", "account", accountId, { days });
  refresh(accountId);
  return { ok: true };
}

/** Turn continuous Podio updates on/off for this account (v24). Turning ON
 *  restarts the countdown from now. */
export async function setPodioUpdateEnabled(
  accountId: string,
  enabled: boolean
): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account.", "forbidden");
  if (!PODIO_UPDATE_FNS.has(account.function))
    return fail("Continuous Podio updates don't apply to this account.");
  await snapshotForUndo("accounts", accountId);
  const { error } = await db()
    .from("accounts")
    .update({
      podio_update_enabled: !!enabled,
      ...(enabled
        ? {
            podio_updated_at: new Date().toISOString(),
            podio_update_notified_at: null,
            podio_update_second_notified_at: null,
          }
        : {}),
    })
    .eq("id", accountId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "podio_update_toggle", "account", accountId, { enabled });
  refresh(accountId);
  return { ok: true };
}

// ============================================================ live name check

/** Instant duplicate/archive check for the Add-account dialog (v22.2): fires
 *  as soon as the member types the name so nobody fills a whole form (and
 *  checks Podio…) only to discover the name is burned. Same checks as
 *  createAccount, read-only. */
export async function checkAccountNameLive(
  name: string,
  fn?: "IGV" | "IGT" | "B2B" | "BD" | "B2C"
): Promise<
  ActionResult<
    | { status: "free"; note?: string }
    | {
        status: "duplicate" | "archived" | "blacklisted";
        message: string;
        info: Record<string, string | null>;
      }
  >
> {
  const viewer = await getViewer();
  // only people who can CREATE accounts get the rich duplicate context
  if (allowedAccountFunctions(viewer).length === 0)
    return { ok: true, data: { status: "free" } };
  const clean = name?.trim() ?? "";
  if (clean.length < 2) return { ok: true, data: { status: "free" } };
  const { checkAccountName } = await import("./data");
  const { duplicate, blacklisted, crossWorldArchived } = await checkAccountName(clean, fn);
  if (blacklisted)
    return {
      ok: true,
      data: {
        status: "blacklisted",
        message: `"${clean}" is in the archive — this name is blocked.`,
        info: {
          reason: blacklisted.comments,
          project: blacklisted.project,
          link: blacklisted.link,
        },
      },
    };
  if (duplicate && duplicate.out_of_process)
    return {
      ok: true,
      data: {
        status: "archived",
        message: `"${clean}" was worked before and is archived — it cannot be added again.`,
        info: {
          function: duplicate.function,
          reason: duplicate.oop_reason,
          archived_at: duplicate.oop_at?.slice(0, 10) ?? null,
          was_responsible:
            duplicate.responsible_nickname || duplicate.responsible_name || "Unassigned",
        },
      },
    };
  if (duplicate)
    return {
      ok: true,
      data: {
        status: "duplicate",
        message: duplicate.responsible_id
          ? `"${clean}" already exists on ${duplicate.function} accounts.`
          : `"${clean}" is already in the CRM under ${duplicate.function}, but NOBODY owns it — open it and hit "Take it" to claim the research for yourself.`,
        info: {
          function: duplicate.function,
          responsible:
            duplicate.responsible_nickname || duplicate.responsible_name || "Unassigned",
          stage: duplicate.stage,
          project: duplicate.project ?? duplicate.sub_product,
          created_at: duplicate.created_at?.slice(0, 10) ?? null,
          open: duplicate.responsible_id ? null : `/accounts/${accountSlug(duplicate.name)}`,
        },
      },
    };
  // archived in the OTHER world — allowed, but worth knowing (v23.2)
  if (crossWorldArchived)
    return {
      ok: true,
      data: {
        status: "free",
        note: `Heads-up: "${clean}" is archived on ${crossWorldArchived.function} (${crossWorldArchived.oop_reason ?? "no reason"}) — different service, different archive. Go ahead and add it.`,
      },
    };
  return { ok: true, data: { status: "free" } };
}

/** The automatic Podio check (v32) — replaces opening the national partners
 *  web-form and typing the name into "Check if your company exists?" by hand.
 *  Read-only, cached ~30 min, and it fails SOFT: if Podio is unreachable the
 *  dialog just falls back to the manual link, never to a false "go ahead". */
export async function checkPodioNameLive(
  name: string
): Promise<ActionResult<import("@/lib/podio").PodioCheck>> {
  const viewer = await getViewer();
  // same gate as the duplicate check — only people who can create accounts
  if (allowedAccountFunctions(viewer).length === 0)
    return {
      ok: true,
      data: { status: "unknown", similar: [] },
    };
  const { checkPodioCompany } = await import("@/lib/podio");
  return { ok: true, data: await checkPodioCompany(name) };
}

// Goals are no longer set in Sodio (v22): function goals come from the VPs'
// planning sheet (plan_cells) and team goals from the Team Leaders' filed
// plans (tl_plans) — setPerformanceGoal and its announcement flow are gone.

// ================================================================== bulk import

export interface ImportRowInput {
  function: "IGV" | "IGT" | "B2B" | "BD" | "B2C";
  name: string;
  product?: string | null;
  project?: string | null;
  sub_product?: string | null;
  account_type?: string | null;
  industry?: string | null;
  phone?: string | null;
  email?: string | null;
  social_link?: string | null;
  website?: string | null;
  comment?: string | null;
  responsible_id?: string | null;
}

export interface ImportRowResult {
  name: string;
  ok: boolean;
  error?: string;
}

/** Market-research import: each row goes through the exact same rules as a
 *  hand-added account (function gate, duplicate + archive block, owner scope). */
export async function importAccountsBulk(
  rows: ImportRowInput[]
): Promise<ActionResult<{ results: ImportRowResult[]; created: number }>> {
  const viewer = await getViewer(); // auth check up-front
  if (!rows?.length) return fail("Nothing to import.");
  if (rows.length > 500) return fail("Import at most 500 accounts at a time.");

  const results: ImportRowResult[] = [];
  let created = 0;
  for (const row of rows) {
    const res = await createAccount({
      function: row.function,
      name: row.name ?? "",
      product:
        row.function === "IGT" && (row.product === "GTa" || row.product === "GTe")
          ? row.product
          : null,
      project: row.function === "IGV" ? row.project ?? null : null,
      sub_product: row.function === "IGT" ? row.sub_product ?? null : null,
      account_type: row.function !== "IGT" ? row.account_type ?? null : null,
      industry: row.function !== "IGT" ? row.industry ?? null : null,
      phone: row.phone ? cleanPhone(row.phone) : null,
      email: row.email ?? null,
      social_link: row.social_link ?? null,
      website: row.website ?? null,
      comment: row.comment ?? null,
      responsible_id: row.responsible_id ?? null,
    }, { stampActivity: false, via: "import" });
    if (res.ok) {
      created += 1;
      results.push({ name: row.name, ok: true });
    } else {
      results.push({ name: row.name, ok: false, error: res.error });
    }
  }
  // one stamp for the whole run — 500 `after()` inserts would cost the member
  // nothing but flood work_activity with a single session's worth of rows
  if (created > 0) await stampWork(viewer.id, "accounts_imported"); // v29
  refresh();
  return { ok: true, data: { results, created } };
}

// ================================================================== proposal drafts

const proposalSchema = z.object({
  accountId: z.string().uuid(),
  recipientEmail: z
    .string()
    .trim()
    .refine((v) => EMAIL_RE.test(v), "A valid recipient email is required."),
  sector: z.string().trim().nullish(),
  customNote: z.string().trim().nullish(),
  attachmentsNote: z.string().trim().nullish(),
  /** attach the official per-product proposal PDF (proposals/<product>.pdf) */
  attachProposal: z.boolean().nullish(),
  /** B2B/BD raise for the whole ICX — the email body is written for THIS
   *  product ("B2B" = the general all-programs partnership email, "BD" = the
   *  talent-solutions pitch of aiesec.org.eg/partner.html) */
  bodyProduct: z.enum(["iGV", "iGTa", "iGTe", "B2B", "BD"]).nullish(),
  /** B2B: which official product PDFs to attach (any of the three) */
  attachProducts: z.array(z.enum(["iGV", "iGTa", "iGTe"])).nullish(),
});

/** ICX Proposal Email: builds the product-specific outreach draft and places
 *  it in the MEMBER's own Gmail drafts (gmail.compose from their Google
 *  sign-in). The member reviews, attaches files if needed, and sends it —
 *  the email goes out from THEIR address. */
export async function createProposalDraft(
  input: z.infer<typeof proposalSchema>
): Promise<ActionResult<{ product: string }>> {
  const viewer = await getViewer();
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const {
    accountId, recipientEmail, sector, customNote,
    attachmentsNote, attachProposal, bodyProduct, attachProducts,
  } = parsed.data;

  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to work on this account.", "forbidden");
  // B2C partners get no proposal emails (v23) — their flow is Podio + the
  // contract form, not the ICX proposal pitch
  if (account.function === "B2C")
    return fail("B2C accounts don't send proposal emails.");

  if (!viewer.google_refresh_token)
    return fail(
      "Your Google access is missing — sign out, then sign in with Google once to grant it (it also powers your calendar reminders)."
    );

  // the email body is written for one product. B2B/BD accounts raise for the
  // whole ICX, so the member picks the product — or keeps their general
  // variant (B2B → all-programs @ aiesec.org/partners; BD → talent solutions
  // @ aiesec.org.eg/partner.html).
  const product: "iGV" | "iGTa" | "iGTe" | "B2B" | "BD" =
    account.function === "IGV"
      ? "iGV"
      : account.function === "IGT"
        ? account.product === "GTe" ? "iGTe" : "iGTa"
        : (bodyProduct ?? (account.function === "BD" ? "BD" : "B2B"));

  const { proposalDraft } = await import("@/lib/email/proposal");
  const draft = proposalDraft({
    product,
    companyName: account.name,
    sector: sector || account.industry || account.sub_product || null,
    customNote: customNote || null,
    attachmentsNote: attachmentsNote || null,
    memberName: viewer.name,
    memberPhone: viewer.phone,
    memberEmail: viewer.email ?? "",
  });

  // which official PDFs to attach: B2B picks any of the three; BD sends NO
  // ready attachments; others attach their own product's PDF when switched on
  const wanted: ("iGV" | "iGTa" | "iGTe")[] =
    account.function === "BD"
      ? []
      : account.function === "B2B"
        ? [...new Set(attachProducts ?? [])]
        : attachProposal && product !== "B2B" && product !== "BD"
          ? [product]
          : [];

  const attachments: { filename: string; mimeType: string; contentBase64: string }[] = [];
  if (wanted.length > 0) {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    for (const p of wanted) {
      try {
        const pdf = await readFile(join(process.cwd(), "proposals", `${p}.pdf`));
        attachments.push({
          filename: `AIESEC Alexandria — ${p} Proposal.pdf`,
          mimeType: "application/pdf",
          contentBase64: pdf.toString("base64"),
        });
      } catch {
        return fail(
          `The official ${p} proposal PDF isn't uploaded to the system yet — ask the IM team, or uncheck it and continue.`
        );
      }
    }
  }

  try {
    const { createMemberDraft } = await import("@/lib/google/gmail");
    const draftId = await createMemberDraft(viewer.google_refresh_token, {
      to: recipientEmail,
      subject: draft.subject,
      html: draft.html,
      attachments,
    });
    if (!draftId) return fail("Google didn't accept the draft — try again.");
  } catch (e) {
    console.error("[proposal] draft failed:", e);
    return fail(
      "Couldn't create the draft. Sign out and sign in with Google again to refresh your access, then retry."
    );
  }

  // proposal drafted → mark the flag the sheet mirrors track
  await db().from("accounts").update({ proposal_sent: true }).eq("id", accountId);
  await logAudit(viewer.id, "proposal_draft", "account", accountId, {
    product,
    to: recipientEmail,
  });
  refresh(accountId);
  return { ok: true, data: { product } };
}

// ================================================================== notifications

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** The viewer's latest notifications + unread count (bell popup). */
export async function getMyNotifications(): Promise<
  ActionResult<{ items: NotificationRow[]; unread: number }>
> {
  const viewer = await getViewer();
  const run = (cols: string) =>
    db()
      .from("notifications")
      .select(cols)
      .eq("member_id", viewer.id)
      .order("created_at", { ascending: false })
      .limit(30);
  let res = await run("id, kind, title, body, link, read_at, created_at");
  // pre-0010 the `link` column doesn't exist — retry without it
  if (res.error && res.error.message.includes("link")) {
    res = await run("id, kind, title, body, read_at, created_at");
  }
  if (res.error) return fail("Notifications need migration 0008 — ask the IM team.");
  const items = ((res.data ?? []) as unknown as Partial<NotificationRow>[]).map((n) => ({
    id: n.id!, kind: n.kind!, title: n.title!, body: n.body ?? null,
    link: n.link ?? null, read_at: n.read_at ?? null, created_at: n.created_at!,
  })) as NotificationRow[];
  return {
    ok: true,
    data: { items, unread: items.filter((n) => !n.read_at).length },
  };
}

export async function markNotificationsRead(): Promise<ActionResult> {
  const viewer = await getViewer();
  await db()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("member_id", viewer.id)
    .is("read_at", null);
  return { ok: true };
}

const broadcastSchema = z.object({
  title: z.string().trim().min(2, "Give the message a title."),
  body: z.string().trim().min(2, "Write the message."),
  audience: z.enum(["all", "functions", "roles", "members"]),
  functions: z.array(z.string()).nullish(),
  roles: z.array(z.string()).nullish(),
  memberIds: z.array(z.string().uuid()).nullish(),
  alsoEmail: z.boolean().nullish(),
});

/** EB + admin broadcast: in-app notification to everyone / by function / by
 *  role / hand-picked members — optionally also as an email (BCC). */
export async function sendBroadcast(
  input: z.infer<typeof broadcastSchema>
): Promise<ActionResult<{ recipients: number }>> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer))
    return fail("Only the EB and admins can broadcast messages.", "forbidden");
  const parsed = broadcastSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const b = parsed.data;

  const { data: all } = await db()
    .from("members")
    .select("id, email, name, nickname, role, functions")
    .eq("is_active", true);
  let targets = (all ?? []) as {
    id: string; email: string; role: string; functions: string[] | null;
  }[];
  if (b.audience === "functions")
    targets = targets.filter((m) =>
      (m.functions ?? []).some((f) => (b.functions ?? []).includes(f))
    );
  else if (b.audience === "roles")
    targets = targets.filter((m) => (b.roles ?? []).includes(m.role));
  else if (b.audience === "members")
    targets = targets.filter((m) => (b.memberIds ?? []).includes(m.id));
  targets = targets.filter((m) => m.id !== viewer.id);
  if (targets.length === 0) return fail("Nobody matches that audience.");

  const { notifyMembers } = await import("./notify");
  await notifyMembers(
    targets.map((t) => t.id),
    "broadcast",
    b.title,
    b.body,
    viewer.id
  );

  if (b.alsoEmail) {
    const { broadcastEmail } = await import("@/lib/email/templates");
    const mail = broadcastEmail({
      title: b.title,
      body: b.body,
      senderName: viewer.nickname || viewer.name,
    });
    sendEmail({ to: [viewer.email || env.gmailSender].filter(Boolean), bcc: targets.map((t) => t.email), ...mail }).catch(
      (e) => console.error("[broadcast] email failed:", e)
    );
  }

  await logAudit(viewer.id, "broadcast", "notification", null, {
    audience: b.audience,
    recipients: targets.length,
  });
  return { ok: true, data: { recipients: targets.length } };
}

/** EB-only: active members for the manual broadcast picker. */
export async function listBroadcastTargets(): Promise<
  ActionResult<{ id: string; label: string; role: string; functions: string[] }[]>
> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer)) return fail("EB only.", "forbidden");
  const { data } = await db()
    .from("members")
    .select("id, name, nickname, role, functions")
    .eq("is_active", true)
    .order("name");
  return {
    ok: true,
    data: (data ?? []).map((m) => ({
      id: m.id,
      label: m.nickname || m.name,
      role: m.role,
      functions: m.functions ?? [],
    })),
  };
}

// ================================================================== feedback workflow

/** Thank-you: in-app notification (seen next time they open Sodio) + email. */
export async function thankFeedback(feedbackId: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const { canSeeFeedbackInbox } = await import("@/lib/rbac");
  if (!canSeeFeedbackInbox(viewer)) return fail("Inbox owners only.", "forbidden");

  const { data: f } = await db()
    .from("feedback")
    .select("id, message, anonymous, member:members(id, name, nickname, email)")
    .eq("id", feedbackId)
    .maybeSingle<{
      id: string; message: string; anonymous: boolean;
      member: { id: string; name: string; nickname: string | null; email: string } | null;
    }>();
  if (!f) return fail("Feedback not found.");
  if (f.anonymous || !f.member)
    return fail("This feedback is anonymous — there's nobody to thank directly 🙂");

  const { notifyMembers } = await import("./notify");
  await notifyMembers(
    [f.member.id],
    "thanks",
    "Your feedback made Sodio better 💙",
    `The IM team applied your feedback — thank you for building Sodio with us! ("${f.message.slice(0, 120)}")`,
    viewer.id
  );

  const { feedbackThanksEmail } = await import("@/lib/email/templates");
  const mail = feedbackThanksEmail({
    memberFirstName: f.member.nickname || f.member.name.split(" ")[0],
    feedbackSnippet: f.message.slice(0, 160),
  });
  sendEmail({ to: [f.member.email], ...mail }).catch((e) =>
    console.error("[feedback] thanks email failed:", e)
  );

  await logAudit(viewer.id, "feedback_thanks", "feedback", feedbackId);
  return { ok: true };
}

export async function setFeedbackStatus(
  feedbackId: string,
  status: "new" | "done" | "archived"
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { canSeeFeedbackInbox } = await import("@/lib/rbac");
  if (!canSeeFeedbackInbox(viewer)) return fail("Inbox owners only.", "forbidden");
  const { error } = await db().from("feedback").update({ status }).eq("id", feedbackId);
  if (error) return fail("Feedback workflow needs migration 0008.");
  return { ok: true };
}

// ================================================================== MM planning (v21)

/** OGX & Consideration MMs (TLs/Coordinators) fill applicants/accepted/
 *  approvals for each of their peak's 6 months on first sign-in. These are
 *  their period goals — shown on /planning and in the period reports. */
export async function saveMmPlan(
  months: { month: string; applicants: number; accepted: number; approvals: number }[]
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { isPlanningMm } = await import("./data");
  if (!isPlanningMm(viewer))
    return fail("The monthly plan is for OGX & Consideration MMs.", "forbidden");
  if (!Array.isArray(months) || months.length === 0) return fail("Fill your plan first 🙂");
  if (months.length > 12) return fail("A plan covers one peak (6 months).");

  const { peakForPlanning } = await import("@/lib/plan");
  const peak = peakForPlanning();
  const allowed = new Set(peak.months);
  const clamp = (n: unknown) => Math.max(0, Math.min(100000, Math.round(Number(n) || 0)));
  const rows = months
    .filter((m) => allowed.has(m.month))
    .map((m) => ({
      member_id: viewer.id,
      month: m.month,
      applicants: clamp(m.applicants),
      accepted: clamp(m.accepted),
      approvals: clamp(m.approvals),
      peak: `${peak.name}-${peak.months[0].slice(0, 4)}`,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return fail("Those months don't belong to the current peak.");

  // sandbox undo: snapshot existing months, journal the new ones (v22)
  const { data: existingRows } = await db()
    .from("mm_plans")
    .select("id, month")
    .eq("member_id", viewer.id);
  const existingByMonth = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((existingRows ?? []) as any[]).map((r) => [`${String(r.month).slice(0, 7)}-01`, r.id])
  );
  for (const r of rows) {
    const id = existingByMonth.get(r.month);
    if (id) await snapshotForUndo("mm_plans", id);
  }

  const { data: upserted, error } = await db()
    .from("mm_plans")
    .upsert(rows, { onConflict: "member_id,month" })
    .select("id, month");
  if (error) {
    if (error.message.includes("mm_plans"))
      return fail("MM planning needs migration 0017 — run it in the Supabase SQL editor.");
    return fail(error.message);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (upserted ?? []) as any[]) {
    if (!existingByMonth.has(`${String(r.month).slice(0, 7)}-01`))
      await recordUndo("mm_plans", r.id, "insert");
  }
  await logAudit(viewer.id, "mm_plan_saved", "member", viewer.id, {
    months: rows.length, peak: peak.name,
  });
  refresh();
  return { ok: true };
}

// ================================================================== TL planning (v22)

/** Raising MMs — TLs & Coordinators of IGV/IGT/B2B&BD — plan OPENS per month
 *  of the peak: on first sign-in and any time later from the profile "My plan"
 *  card. A TL's plan IS the team goal (dashboard team card + /planning track
 *  it); a Coordinator's plan tracks their own raising. */
export async function saveTlPlan(
  months: { month: string; opens: number }[]
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { isPlanningTl } = await import("./data");
  if (!isPlanningTl(viewer))
    return fail("The opens plan is for raising TLs & Coordinators.", "forbidden");
  if (!Array.isArray(months) || months.length === 0) return fail("Fill your plan first 🙂");
  if (months.length > 12) return fail("A plan covers one peak (6 months).");

  const { peakForPlanning } = await import("@/lib/plan");
  const peak = peakForPlanning();
  const allowed = new Set(peak.months);
  const clamp = (n: unknown) => Math.max(0, Math.min(100000, Math.round(Number(n) || 0)));
  const rows = months
    .filter((m) => allowed.has(m.month))
    .map((m) => ({
      member_id: viewer.id,
      month: m.month,
      opens: clamp(m.opens),
      peak: `${peak.name}-${peak.months[0].slice(0, 4)}`,
      updated_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return fail("Those months don't belong to the current peak.");

  // sandbox undo: snapshot the months that already exist, journal the new ones
  const { data: existingRows } = await db()
    .from("tl_plans")
    .select("id, month")
    .eq("member_id", viewer.id);
  const existingByMonth = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((existingRows ?? []) as any[]).map((r) => [`${String(r.month).slice(0, 7)}-01`, r.id])
  );
  for (const r of rows) {
    const id = existingByMonth.get(r.month);
    if (id) await snapshotForUndo("tl_plans", id);
  }

  const { data: upserted, error } = await db()
    .from("tl_plans")
    .upsert(rows, { onConflict: "member_id,month" })
    .select("id, month");
  if (error) {
    if (error.message.includes("tl_plans"))
      return fail("TL planning needs migration 0018 — run it in the Supabase SQL editor.");
    return fail(error.message);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (upserted ?? []) as any[]) {
    if (!existingByMonth.has(`${String(r.month).slice(0, 7)}-01`))
      await recordUndo("tl_plans", r.id, "insert");
  }
  await logAudit(viewer.id, "tl_plan_saved", "member", viewer.id, {
    months: rows.length, peak: peak.name,
  });
  refresh();
  return { ok: true };
}

// ================================================================== LC people feedback (v21)

/** Feedback about PEOPLE in the LC (not the system) — or, since v29, about a
 *  TOUCH POINT the author attended, which reaches its organiser: positive
 *  shout-outs go straight to the person (bell + email); negative concerns land
 *  in an inbox only the LCP + admin can read. The author is always stored for
 *  accountability but NEVER shown when anonymous. */
export async function submitLcFeedback(input: {
  positive: boolean;
  about: string[];
  message: string;
  anonymous?: boolean;
  /** feedback about a TOUCH POINT the viewer attended (v29): it resolves to
   *  the session's OWNER as the target and names the session in the message,
   *  so both flows travel the exact same shout-out / private-inbox path. */
  touchPointId?: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  let message = input.message?.trim();
  if (!message || message.length < 3) return fail("Write the feedback first 🙂");
  const about = [...new Set(input.about ?? [])].filter((id) => id && id !== viewer.id);

  if (input.touchPointId) {
    // you may only review a session you actually showed up to
    const { data: att } = await db()
      .from("touch_point_attendance")
      .select("status")
      .eq("touch_point_id", input.touchPointId)
      .eq("member_id", viewer.id)
      .maybeSingle<{ status: string }>();
    if (!att || !["attended", "late"].includes(att.status))
      return fail("You can only give feedback on a touch point you attended.");
    const { getTouchPoint } = await import("./touch-points-read");
    const tp = await getTouchPoint(input.touchPointId);
    if (!tp) return fail("That touch point no longer exists.");
    if (!tp.owner_id) return fail("That touch point has no organiser left to send it to.");
    if (tp.owner_id === viewer.id) return fail("That's your own touch point 🙂");
    const { touchPointLabel } = await import("@/lib/types");
    const { cairoWhen } = await import("@/lib/touch-points");
    message = `📍 About the ${touchPointLabel(tp.scope, tp.kind)} on ${cairoWhen(tp.starts_at)}\n\n${message}`;
    if (!about.includes(tp.owner_id)) about.unshift(tp.owner_id);
  }

  if (about.length === 0) return fail("Pick at least one person (not yourself 🙂).");
  if (about.length > 10) return fail("Max 10 people per feedback.");

  const { data: targets } = await db()
    .from("members")
    .select("id, name, nickname, email")
    .in("id", about)
    .eq("is_active", true);
  if (!targets || targets.length === 0) return fail("Those members don't exist.");

  const { error } = await db().from("lc_feedback").insert({
    author_id: viewer.id,
    anonymous: !!input.anonymous,
    positive: input.positive,
    about: targets.map((t) => t.id),
    message,
  });
  if (error) {
    if (error.message.includes("lc_feedback"))
      return fail("LC feedback needs migration 0017 — run it in the Supabase SQL editor.");
    return fail(error.message);
  }

  if (input.positive) {
    // shout-out → tell the person right away (bell + branded email)
    const from = input.anonymous ? "Someone in the LC 🎭" : viewer.nickname || viewer.name;
    const { notifyMembers } = await import("./notify");
    await notifyMembers(
      targets.map((t) => t.id),
      "lc_feedback",
      `💙 ${from} appreciated you!`,
      message.slice(0, 300),
      input.anonymous ? null : viewer.id
    );
    const { lcShoutoutEmail } = await import("@/lib/email/templates");
    for (const t of targets) {
      const mail = lcShoutoutEmail({
        firstName: (t.nickname || t.name).split(" ")[0],
        from,
        message,
      });
      sendEmail({ to: [t.email], ...mail }).catch((e) =>
        console.error("[lc-feedback] shout-out email failed:", e)
      );
    }
  }
  // A CONCERN is quiet — never to the person it's about — but the people who
  // must act on it are told: the LCP and the TM leadership (v32.8). Both get
  // the bell and the mail; both can open the inbox.
  if (!input.positive) {
    const { data: owners } = await db()
      .from("members")
      .select("id, name, nickname, email, role, functions, sub_functions")
      .eq("is_active", true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inboxOwners = ((owners ?? []) as any[]).filter(
      (m) =>
        m.role === "LCP" ||
        (["LCVP", "Director"].includes(m.role) &&
          [...(m.functions ?? []), ...(m.sub_functions ?? [])].includes("TM"))
    );
    if (inboxOwners.length > 0) {
      const { notifyMembers } = await import("./notify");
      await notifyMembers(
        inboxOwners.map((m) => m.id),
        "lc_feedback",
        "A new concern was filed",
        `About ${targets.length} ${targets.length === 1 ? "person" : "people"} — open the inbox to read it.`,
        null,
        "/lc-feedback"
      );
      if (!(await sandboxSuppressed("lc concern email"))) {
        const { lcConcernEmail } = await import("@/lib/email/templates");
        const mail = lcConcernEmail({ count: targets.length });
        await Promise.all(
          inboxOwners
            .filter((m) => m.email)
            .map((m) =>
              sendEmail({ to: [m.email], ...mail }).catch((e) =>
                console.error("[lc-feedback] concern mail failed:", e)
              )
            )
        );
      }
    }
  }

  // NEVER attribute anonymous feedback in the audit log — the admin reads BOTH
  // the audit log and the inbox, so an author here would deanonymize a concern.
  // (The lc_feedback row keeps author_id at the DB layer for true abuse
  // accountability, but that is never surfaced in any UI.)
  await logAudit(input.anonymous ? null : viewer.id, "lc_feedback", "member", targets[0].id, {
    positive: input.positive,
    people: targets.length,
    anonymous: !!input.anonymous,
    about_touch_point: !!input.touchPointId,
  });
  return { ok: true };
}

export async function setLcFeedbackStatus(
  id: string,
  status: "new" | "seen" | "done"
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canSeeLcConcerns(viewer))
    return fail("Only the LCP and the TM leadership manage this inbox.", "forbidden");
  const { error } = await db().from("lc_feedback").update({ status }).eq("id", id);
  if (error) return fail(error.message);
  return { ok: true };
}

// ================================================================== planning import (v21)

/** Re-imports the VP planning sheet ("Alexandria | Planning Tool") into
 *  plan_cells. Requires the sheet to be shared with the service account. */
export async function runPlanningImport(): Promise<ActionResult<{ cells: number; skipped: string[] }>> {
  const viewer = await getViewer();
  const { canSeePlanning } = await import("@/lib/rbac");
  if (!canSeePlanning(viewer)) return fail("Planning owners only.", "forbidden");
  try {
    const { importPlanningSheet } = await import("@/lib/google/sheets");
    const res = await importPlanningSheet();
    await logAudit(viewer.id, "plan_import", "system", null, { cells: res.cells });
    refresh();
    return { ok: true, data: res };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed.";
    if (msg.includes("permission") || msg.includes("PERMISSION") || msg.includes("caller does not have"))
      return fail(
        "The planning sheet isn't shared with Sodio's service account yet — share it (Viewer) with crm-sheets@gen-lang-client-0055329754.iam.gserviceaccount.com and retry."
      );
    return fail(msg);
  }
}

// ================================================================== OGT/OGV expectation mail

const OGT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** the fixed CC on every expectation mail — the MC's customer-support inbox */
const OGT_MAIL_CC = "customer.support@aiesec.net.eg";

/** OGT & OGV VPs/Directors + LCP/admin own the Expectation-mail composer. */
const canUseExpectationMail = (v: {
  isAdmin: boolean;
  role: MemberRole;
  functions: string[];
  sub_functions?: string[];
}): boolean =>
  v.isAdmin ||
  v.role === "LCP" ||
  ((v.role === "LCVP" || v.role === "Director") &&
    // sub_functions count too — same recognition rule as the OGX module
    ["OGT", "OGV"].some(
      (f) => v.functions.includes(f) || (v.sub_functions ?? []).includes(f)
    ));

const ogtWorkingDayRow = z.object({
  days: z.array(z.enum(OGT_DAYS)).min(1, "Pick at least one day in every working-days row."),
  from: z.string().regex(/^\d{1,2}:\d{2}$/, "Every working-days row needs a from time."),
  to: z.string().regex(/^\d{1,2}:\d{2}$/, "Every working-days row needs a to time."),
});

const ogtMailSchema = z.object({
  /** OGT → Salary line, no TN Fee · OGV → TN Fee line, no Salary */
  variant: z.enum(["OGT", "OGV"]),
  toEp: z.string().trim().refine((v) => EMAIL_RE.test(v), "The EP email doesn't look valid."),
  toIr: z.string().trim().refine((v) => EMAIL_RE.test(v), "The IR email doesn't look valid."),
  hostingEntity: z.string().trim().min(1, "The hosting entity name is required."),
  epName: z.string().trim().min(1, "The EP name is required."),
  hostLcName: z.string().trim().min(1, "The host LC name is required."),
  epId: z.string().trim().regex(/^\d+$/, "EP ID must be digits only."),
  oppId: z.string().trim().regex(/^\d+$/, "OPP ID must be digits only."),
  oppName: z.string().trim().min(1, "The opportunity name is required."),
  slotStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the slot start date."),
  slotEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the slot end date."),
  workingHours: z.string().trim().min(1, "The working hours are required."),
  workingDays: z.array(ogtWorkingDayRow).min(1, "Add at least one working-days interval."),
  workingDaysNote: z.string().trim().nullish(),
  /** OGT only — empty renders as N/A */
  salary: z.string().trim().nullish(),
  /** OGV only — required for that variant (checked after parse) */
  tnFee: z.string().trim().nullish(),
  computerProvided: z.boolean(),
  accommodationProvided: z.boolean(),
  accommodationCovered: z.boolean(),
  transportationProvided: z.boolean(),
  transportationDetail: z.string().trim().nullish(),
  accommodationType: z.enum(["Hostel", "Host Family", "Private Apartment"]),
  accommodationTypeDetail: z.string().trim().nullish(),
  mealsProvided: z.string().trim().min(1, "Meals Provided is required (write 'None' if none)."),
});

export type OgtMailInput = z.infer<typeof ogtMailSchema>;

/** the reviewed & possibly edited email — what send/draft actually ship */
const ogtReviewedSchema = z.object({
  subject: z.string().trim().min(1, "The subject can't be empty."),
  html: z.string().trim().min(1, "The email body can't be empty."),
  toEp: z.string().trim().refine((v) => EMAIL_RE.test(v), "The EP email doesn't look valid."),
  toIr: z.string().trim().refine((v) => EMAIL_RE.test(v), "The IR email doesn't look valid."),
});

export type OgtReviewedMail = z.infer<typeof ogtReviewedSchema>;

/** "Aug 5, 2026" — how slot dates read inside the expectation email. */
function ogtDateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Home Entity Expectation Setting Mail" step 1: validates the form and
 *  builds the exact email (subject + HTML, incl. the VP's signature) WITHOUT
 *  touching Gmail — the view renders it as an editable review step, then the
 *  VP sends it or saves it as a draft. OGT/OGV leadership (+ LCP/admin). */
export async function previewOgtExpectationMail(
  input: OgtMailInput
): Promise<ActionResult<{ subject: string; html: string }>> {
  const viewer = await getViewer();
  if (!canUseExpectationMail(viewer)) return fail("OGT/OGV leadership only.", "forbidden");

  const parsed = ogtMailSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;

  if (d.slotEnd < d.slotStart) return fail("The slot end date can't be before its start date.");
  if (d.variant === "OGV" && !d.tnFee?.trim())
    return fail("TN Fee and what it covers is required for the OGV mail.");
  if (!d.transportationProvided && !d.transportationDetail?.trim())
    return fail("Transportation isn't provided — describe the daily cost, duration & method.");
  if (
    (d.accommodationType === "Hostel" || d.accommodationType === "Private Apartment") &&
    !d.accommodationTypeDetail?.trim()
  )
    return fail(`${d.accommodationType} — specify the EPs per room & bathroom situation.`);

  // canonical Mon→Sun order inside each interval line, whatever the click order
  const dayLines = d.workingDays.map((row) => {
    const days = [...new Set(row.days)].sort(
      (a, b) => OGT_DAYS.indexOf(a) - OGT_DAYS.indexOf(b)
    );
    return `${days.join(", ")}: ${row.from}–${row.to}`;
  });

  const { ogtExpectationEmail } = await import("@/lib/email/templates");
  const mail = ogtExpectationEmail({
    variant: d.variant,
    hostingEntity: d.hostingEntity,
    epName: d.epName,
    hostLcName: d.hostLcName,
    epId: d.epId,
    oppId: d.oppId,
    oppName: d.oppName,
    slotStartLabel: ogtDateLabel(d.slotStart),
    slotEndLabel: ogtDateLabel(d.slotEnd),
    workingHours: d.workingHours,
    workingDayLines: dayLines,
    workingDaysNote: d.workingDaysNote ?? null,
    salary: d.salary ?? null,
    tnFee: d.tnFee ?? null,
    computerProvided: d.computerProvided,
    accommodationProvided: d.accommodationProvided,
    accommodationCovered: d.accommodationCovered,
    transportationProvided: d.transportationProvided,
    transportationDetail: d.transportationDetail ?? null,
    accommodationType: d.accommodationType,
    accommodationTypeDetail: d.accommodationTypeDetail ?? null,
    mealsProvided: d.mealsProvided,
    senderName: viewer.name,
    senderPosition:
      (viewer.role === "LCP"
        ? "Local Committee President"
        : viewer.role === "Director"
          ? "Director"
          : "Local Committee Vice President") +
      " — Outgoing Global " +
      (d.variant === "OGT" ? "Talent" : "Volunteer") +
      ", AIESEC in Alexandria",
    senderPhone: viewer.phone,
    senderEmail: viewer.email,
  });

  return { ok: true, data: mail };
}

/** Step 2a — SENDS the reviewed expectation mail from the VP's OWN Gmail
 *  (their gmail.compose grant covers sending): To = EP + IR, Cc fixed to the
 *  MC's customer-support inbox. The VP owns the content — whatever they
 *  edited in the review step goes out verbatim. */
export async function sendOgtExpectationMail(input: OgtReviewedMail): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canUseExpectationMail(viewer)) return fail("OGT/OGV leadership only.", "forbidden");

  const parsed = ogtReviewedSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;

  if (!viewer.google_refresh_token)
    return fail(
      "Your Google access is missing — sign out, then sign in with Google once to grant it (it also powers your calendar reminders)."
    );

  try {
    const { sendMemberEmail } = await import("@/lib/google/gmail");
    const messageId = await sendMemberEmail(viewer.google_refresh_token, {
      to: [d.toEp, d.toIr],
      cc: [OGT_MAIL_CC],
      subject: d.subject,
      html: d.html,
    });
    if (!messageId) return fail("Google didn't accept the email — try again.");
    // sandbox test view: the send was suppressed — no real audit row either
    if (messageId === "sandbox") return { ok: true };
  } catch (e) {
    console.error("[ogt-mail] send failed:", e);
    return fail(
      "Couldn't send the email. Sign out and sign in with Google again to refresh your access, then retry."
    );
  }

  await logAudit(viewer.id, "ogt_mail_sent", "system", null, {
    toEp: d.toEp,
    toIr: d.toIr,
    subject: d.subject,
  });
  return { ok: true };
}

/** Step 2b — saves the reviewed expectation mail as a DRAFT in the VP's OWN
 *  Gmail instead of sending it (same recipients + fixed Cc, so the draft
 *  matches exactly what the review step showed). */
export async function createOgtExpectationDraft(input: OgtReviewedMail): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canUseExpectationMail(viewer)) return fail("OGT/OGV leadership only.", "forbidden");

  const parsed = ogtReviewedSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;

  if (!viewer.google_refresh_token)
    return fail(
      "Your Google access is missing — sign out, then sign in with Google once to grant it (it also powers your calendar reminders)."
    );

  try {
    const { createMemberDraft } = await import("@/lib/google/gmail");
    const draftId = await createMemberDraft(viewer.google_refresh_token, {
      to: `${d.toEp}, ${d.toIr}`,
      cc: [OGT_MAIL_CC],
      subject: d.subject,
      html: d.html,
    });
    if (!draftId) return fail("Google didn't accept the draft — try again.");
    if (draftId === "sandbox") return { ok: true };
  } catch (e) {
    console.error("[ogt-mail] draft failed:", e);
    return fail(
      "Couldn't create the draft. Sign out and sign in with Google again to refresh your access, then retry."
    );
  }

  await logAudit(viewer.id, "ogt_mail_draft", "system", null, {
    toEp: d.toEp,
    toIr: d.toIr,
    subject: d.subject,
  });
  return { ok: true };
}

// ================================================================== OGX sign-ups (v25)

import {
  canEditSignupVpFields,
  canViewSignup,
  canWorkSignup,
  ogxFunctions,
} from "@/lib/rbac";
import { SIGNUP_STATUSES, type SignupComment, type SignupRow } from "@/lib/types";

async function loadSignup(id: string): Promise<SignupRow | null> {
  const { data } = await db().from("signups").select("*").eq("id", id).maybeSingle<SignupRow>();
  return data ?? null;
}

/** After every sign-up mutation: reload row + comments and push the workflow
 *  cells back to the tracker sheet ("as fast as possible" two-way sync). */
async function pushSignupToSheet(id: string): Promise<void> {
  const signup = await loadSignup(id);
  if (!signup) return;
  const [{ data: comments }, assigned] = await Promise.all([
    db().from("signup_comments").select("*").eq("signup_id", id).order("created_at"),
    signup.assigned_to
      ? db()
          .from("members")
          .select("name, nickname")
          .eq("id", signup.assigned_to)
          .maybeSingle<{ name: string; nickname: string | null }>()
      : Promise.resolve({ data: null }),
  ]);
  const { writeSignupBack } = await import("@/lib/google/signups");
  await writeSignupBack(
    signup,
    (comments ?? []) as SignupComment[],
    assigned.data ? assigned.data.nickname || assigned.data.name : signup.assigned_name
  ).catch((e) => console.error("[signups] write-back failed:", e));
}

const touchSignup = (extra: Record<string, unknown> = {}) => ({
  sodio_touched: true,
  last_edited_at: new Date().toISOString(),
  ...extra,
});

/** v27 streaks: stamp "worked sign-ups today" — ONE row per member per Cairo
 *  day, the raw material of the OGV contact-streak game (stamped for ANY
 *  member; the card/nags are OGV-only). Fire-and-forget: a stamp failure must
 *  never break the contact action that earned it. */
function stampSignupActivity(viewer: { id: string; sandbox?: boolean }): void {
  if (viewer.sandbox) return; // a test view must not fabricate streak days
  // after(): Vercel may freeze the lambda right after the response — a bare
  // floating promise can silently vanish, losing the member's streak day
  after(async () => {
    try {
      const { error } = await db()
        .from("signup_activity")
        .upsert(
          { member_id: viewer.id, day: cairoDayIso() },
          { onConflict: "member_id,day", ignoreDuplicates: true }
        );
      if (error) console.error("[signups] streak stamp failed:", error.message);
    } catch (e) {
      console.error("[signups] streak stamp failed:", e);
    }
  });
}

/** "This one's mine": a member claims an UNASSIGNED sign-up of their
 *  function — the core motion of the main (unassigned) view. */
export async function claimSignup(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const signup = await loadSignup(id);
  if (!signup || !ogxFunctions(viewer).includes(signup.fn))
    return fail("This sign-up is outside your function.", "forbidden");
  if (signup.out_of_process) return fail("This sign-up is archived (Out of Process).");
  if (signup.assigned_to)
    return fail("Someone already took this one — refresh the list.");
  // the sheet may carry a name Sodio couldn't match to a member — that's
  // still an assignment; only a TL/VP reassign can override it
  if (signup.assigned_name)
    return fail(
      `The sheet already assigns this one to "${signup.assigned_name}" — ask your TL/VP to reassign it.`
    );
  await snapshotForUndo("signups", id);
  const { data: claimed, error } = await db()
    .from("signups")
    .update(
      touchSignup({
        assigned_to: viewer.id,
        assigned_name: viewer.nickname || viewer.name,
        assigned_at: new Date().toISOString(),
      })
    )
    .eq("id", id)
    .is("assigned_to", null) // double-claim race guard
    .select("id");
  if (error) return fail(error.message);
  if (!claimed?.length)
    return fail("Someone already took this one — refresh the list.");
  await logAudit(viewer.id, "signup_claim", "signup", id, { ep_id: signup.ep_id });
  await pushSignupToSheet(id);
  stampSignupActivity(viewer); // claiming = today's streak saved
  await stampWork(viewer.id, "signup_claim"); // v29: counts towards working hours
  refresh();
  return { ok: true };
}

/** TL/VP re-assignment (or un-assignment with null). */
export async function reassignSignup(
  id: string,
  memberId: string | null,
  opts?: { skipSheetPush?: boolean }
): Promise<ActionResult> {
  const viewer = await getViewer();
  const signup = await loadSignup(id);
  if (!signup) return fail("Sign-up not found.");
  if (signup.out_of_process)
    return fail("This sign-up is archived (Out of Process) — revive it first.");
  const isVp = canEditSignupVpFields(viewer, signup);
  const isLeader =
    isVp || (viewer.role === "Team Leader" && ogxFunctions(viewer).includes(signup.fn));
  if (!isLeader) return fail("Only Team Leaders and up re-assign sign-ups.", "forbidden");
  // a TL only touches the pool + their own team's rows — never another team's
  if (
    !isVp &&
    signup.assigned_to &&
    signup.assigned_to !== viewer.id &&
    !viewer.teamMemberIds.includes(signup.assigned_to)
  )
    return fail("Team Leaders re-assign only their own team's sign-ups.", "forbidden");
  let target: { id: string; name: string; nickname: string | null } | null = null;
  if (memberId) {
    const { data } = await db()
      .from("members")
      .select("id, name, nickname, is_active, role, functions, sub_functions")
      .eq("id", memberId)
      .maybeSingle<{
        id: string; name: string; nickname: string | null; is_active: boolean;
        role: string; functions: string[] | null; sub_functions: string[] | null;
      }>();
    if (!data || !data.is_active) return fail("Pick an active member.");
    // the target must actually WORK this function (and never the LCP)
    if (
      data.role === "LCP" ||
      ![...(data.functions ?? []), ...(data.sub_functions ?? [])].includes(signup.fn)
    )
      return fail("Pick a member of the sign-up's function.", "forbidden");
    if (
      viewer.role === "Team Leader" &&
      data.id !== viewer.id &&
      !viewer.teamMemberIds.includes(data.id)
    )
      return fail("Team Leaders assign within their own team.", "forbidden");
    target = data;
  }
  // a true no-op (same assignee, same display name) must not touch the row —
  // flipping sodio_touched would mute future sheet-side edits for nothing
  const newName = target ? target.nickname || target.name : null;
  if ((target?.id ?? null) === signup.assigned_to && newName === signup.assigned_name)
    return { ok: true };
  await snapshotForUndo("signups", id);
  const { error } = await db()
    .from("signups")
    .update(
      touchSignup({
        assigned_to: target?.id ?? null,
        assigned_name: target ? target.nickname || target.name : null,
        assigned_at: target ? new Date().toISOString() : null,
      })
    )
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "signup_reassign", "signup", id, {
    to: target?.id ?? null,
  });
  if (!opts?.skipSheetPush) await pushSignupToSheet(id);
  refresh();
  return { ok: true };
}

/** Bulk assign (memberId) or unassign-back-to-the-pool (null) — ≤50 per call,
 *  the client chunks bigger selections. Loops reassignSignup so EVERY row
 *  re-checks scope (VP/Director/LCP-admin: anything in their fn; TL: only
 *  unassigned/own/team rows), keeps sodio_touched, and pushes to the sheet. */
export async function bulkReassignSignups(
  ids: string[],
  memberId: string | null
): Promise<ActionResult<{ done: number; failed: number }>> {
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one sign-up.");
  if (ids.length > 50)
    return fail("Max 50 sign-ups per bulk call — run it in batches.");
  let done = 0;
  let failed = 0;
  const doneIds: string[] = [];
  for (const id of ids) {
    // per-row RBAC/scope re-runs inside; the sheet push is batched below
    const res = await reassignSignup(id, memberId, { skipSheetPush: true });
    if (res.ok) { done += 1; doneIds.push(id); }
    else failed += 1;
  }

  // ONE tab read + ONE batch write per sheet instead of ~3 calls per row
  if (doneIds.length > 0) {
    try {
      const [{ data: signups }, { data: comments }] = await Promise.all([
        db().from("signups").select("*").in("id", doneIds),
        db()
          .from("signup_comments")
          .select("*")
          .in("signup_id", doneIds)
          .order("created_at"),
      ]);
      const byId = new Map<string, SignupComment[]>();
      for (const c of (comments ?? []) as SignupComment[]) {
        const list = byId.get(c.signup_id) ?? [];
        list.push(c);
        byId.set(c.signup_id, list);
      }
      const { writeSignupsBackBatch } = await import("@/lib/google/signups");
      const missed = await writeSignupsBackBatch(
        ((signups ?? []) as SignupRow[]).map((s) => ({
          signup: s,
          comments: byId.get(s.id) ?? [],
          assignedDisplay: s.assigned_name,
        }))
      );
      if (missed.length > 0)
        console.warn(`[signups] batch write-back missed ${missed.length} rows:`, missed.join(", "));
    } catch (e) {
      // the DB is right either way — the 15-min import reconciles the sheet
      console.error("[signups] batch write-back failed:", e);
    }
  }

  refresh();
  return { ok: true, data: { done, failed } };
}

/** Member/MM workflow edits: Contacted (Yes/No) + Interested (Yes/No). */
export async function updateSignupContact(
  id: string,
  input: { contactStatus?: string | null; interested?: string | null }
): Promise<ActionResult> {
  const viewer = await getViewer();
  const signup = await loadSignup(id);
  if (!signup || !canWorkSignup(viewer, signup))
    return fail("You are not allowed to work this sign-up.", "forbidden");
  if (signup.out_of_process) return fail("This sign-up is archived (Out of Process).");
  const clean = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    if (!t) return null;
    return /^y/i.test(t) ? "Yes" : /^n/i.test(t) ? "No" : t;
  };
  const contact = clean(input.contactStatus);
  await snapshotForUndo("signups", id);
  const { error } = await db()
    .from("signups")
    .update(
      touchSignup({
        ...(input.contactStatus !== undefined
          ? {
              contact_status: contact,
              // first Yes stamps the contacted date (mirrored to the sheet);
              // taking the contact BACK clears it, so the record matches
              // reality and the streak — which reads this — can't be gamed by
              // contacting and immediately undoing
              ...(contact === "Yes"
                ? signup.contacted_at
                  ? {}
                  : { contacted_at: new Date().toISOString() }
                : { contacted_at: null }),
            }
          : {}),
        ...(input.interested !== undefined ? { interested: clean(input.interested) } : {}),
      })
    )
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "signup_contact", "signup", id, input);
  await pushSignupToSheet(id);
  stampSignupActivity(viewer); // contact update = today's streak saved
  await stampWork(viewer.id, "signup_contact"); // v29: counts towards working hours
  refresh();
  return { ok: true };
}

/** Comment log: members/MMs land in the Comment cell, VPs (VP/Director/LCP/
 *  admin) in the VP Comment cell — each cell holds the organized log. */
export async function addSignupComment(id: string, body: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const signup = await loadSignup(id);
  if (!signup) return fail("Sign-up not found.");
  if (signup.out_of_process)
    return fail("This sign-up is archived (Out of Process) — revive it first.");
  const isVpClass = canEditSignupVpFields(viewer, signup);
  if (!isVpClass && !canWorkSignup(viewer, signup))
    return fail("You are not allowed to comment on this sign-up.", "forbidden");
  const clean = (body ?? "").trim();
  if (!clean) return fail("Write the comment first.");
  const { data: inserted, error } = await db()
    .from("signup_comments")
    .insert({
      signup_id: id,
      author_id: viewer.id,
      author_name: viewer.nickname || viewer.name,
      author_class: isVpClass ? "vp" : "member",
      body: clean,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return fail(error.message);
  if (inserted) await recordUndo("signup_comments", inserted.id, "insert");
  await db().from("signups").update(touchSignup()).eq("id", id);
  await logAudit(viewer.id, "signup_comment", "signup", id);
  await pushSignupToSheet(id);
  stampSignupActivity(viewer); // commenting = today's streak saved
  await stampWork(viewer.id, "signup_comment"); // v29: counts towards working hours
  refresh();
  return { ok: true };
}

/** The POTENTIAL pipeline (v28): whoever OWNS a sign-up (the assigned
 *  member, their TL, the fn's VP/Director, LCP/admin — canWorkSignup) moves
 *  it Sign-up → Applied → Accepted → Approved (and back). These stages are
 *  SYSTEM-ONLY: the sheet write-back no longer carries them (its status cell
 *  only ever says "Out of Process"). "Parents Approval" stays VP-set. */
export async function setSignupPotential(
  id: string,
  status: string | null
): Promise<ActionResult> {
  const viewer = await getViewer();
  const signup = await loadSignup(id);
  if (!signup || !canWorkSignup(viewer, signup))
    return fail("You are not allowed to work this sign-up.", "forbidden");
  if (signup.out_of_process) return fail("This sign-up is archived (Out of Process).");
  const POTENTIAL: readonly string[] = ["Applied", "Accepted", "Approved"];
  const next = status?.trim() || null;
  if (next !== null && !POTENTIAL.includes(next))
    return fail("Pick a valid potential stage.");
  // moving OFF the VP-set "Parents Approval" stays a VP move
  if (signup.status === "Parents Approval" && !canEditSignupVpFields(viewer, signup))
    return fail(
      '"Parents Approval" is VP-set — ask your VP/Director to move this one.',
      "forbidden"
    );
  if (next === signup.status) return { ok: true };
  await snapshotForUndo("signups", id);
  const { error } = await db()
    .from("signups")
    .update(touchSignup({ status: next }))
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "signup_potential", "signup", id, {
    from: signup.status,
    to: next,
  });
  // the push stamps Time Stamp etc. — the status cell itself stays system-only
  await pushSignupToSheet(id);
  refresh();
  return { ok: true };
}

/** VP-only fields: Country (autocomplete text), Sub Product (OGT), Status. */
export async function updateSignupVpFields(
  id: string,
  input: { country?: string | null; subProduct?: string | null; status?: string | null }
): Promise<ActionResult> {
  const viewer = await getViewer();
  const signup = await loadSignup(id);
  if (!signup || !canEditSignupVpFields(viewer, signup))
    return fail("Only the function's VP/Director edits these fields.", "forbidden");
  if (
    input.status !== undefined &&
    input.status !== null &&
    input.status !== "" &&
    !(SIGNUP_STATUSES as readonly string[]).includes(input.status)
  )
    return fail("Pick a valid status.");
  await snapshotForUndo("signups", id);
  const { error } = await db()
    .from("signups")
    .update(
      touchSignup({
        ...(input.country !== undefined ? { country: input.country?.trim() || null } : {}),
        ...(input.subProduct !== undefined
          ? { sub_product: input.subProduct?.trim() || null }
          : {}),
        ...(input.status !== undefined ? { status: input.status || null } : {}),
      })
    )
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "signup_vp_fields", "signup", id, input);
  await pushSignupToSheet(id);
  refresh();
  return { ok: true };
}

/** VP-only: Out of Process — the sign-up leaves the list (like the accounts
 *  archive) and the sheet row is stamped. Revive brings it back. */
export async function setSignupOop(id: string, reason: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const signup = await loadSignup(id);
  if (!signup || !canEditSignupVpFields(viewer, signup))
    return fail("Only the function's VP/Director archives sign-ups.", "forbidden");
  await snapshotForUndo("signups", id);
  const { error } = await db()
    .from("signups")
    .update(touchSignup({ out_of_process: true, oop_reason: reason?.trim() || null }))
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "signup_oop", "signup", id, { reason });
  await pushSignupToSheet(id);
  refresh();
  return { ok: true };
}

/** VP-only bulk revive — the archive's counterpart to bulk reassign. Loops the
 *  single action so the per-row RBAC and the sheet write-back run exactly as
 *  they do one at a time (v32.5). */
export async function bulkReviveSignups(
  ids: string[]
): Promise<ActionResult<{ done: number; failed: number }>> {
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one sign-up.");
  if (ids.length > 50) return fail("Max 50 sign-ups per bulk call — run it in batches.");
  let done = 0;
  let failed = 0;
  for (const id of ids) {
    const res = await reviveSignup(id);
    if (res.ok) done += 1;
    else failed += 1;
  }
  refresh();
  return { ok: true, data: { done, failed } };
}

export async function reviveSignup(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const signup = await loadSignup(id);
  if (!signup || !canEditSignupVpFields(viewer, signup))
    return fail("Only the function's VP/Director revives sign-ups.", "forbidden");
  await snapshotForUndo("signups", id);
  const { error } = await db()
    .from("signups")
    .update(touchSignup({ out_of_process: false, oop_reason: null }))
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "signup_revive", "signup", id);
  await pushSignupToSheet(id);
  refresh();
  return { ok: true };
}

/** Manual "Sync now" (VP+ / admin) — same import the 15-min cron runs. */
export async function runSignupsImport(): Promise<ActionResult<{ imported: number; created: number }>> {
  const viewer = await getViewer();
  const leader = viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
  if (!leader || !ogxFunctions(viewer).length)
    return fail("Only OGX leaders trigger a sync.", "forbidden");
  try {
    const { importSignups } = await import("@/lib/google/signups");
    const res = await importSignups();
    refresh();
    return { ok: true, data: res };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Sign-ups import failed.");
  }
}

/** Read: the sign-up dialog's full payload (scope-checked). */
export async function openSignupDetail(
  id: string
): Promise<ActionResult<import("./data").SignupDetail>> {
  const viewer = await getViewer();
  const { getSignupDetail } = await import("./data");
  const detail = await getSignupDetail(viewer, id);
  if (!detail) return fail("Sign-up not found — or outside your scope.", "forbidden");
  return { ok: true, data: detail };
}

// ================================================================== consideration (v26)

import { canSeeCvPool, hasConsiderationAccess } from "@/lib/rbac";
import { CV_INDUSTRIES } from "@/lib/cv-extract";
import { freeBookingSlots } from "./data";
import type { CvRow, IrBookingSettings, IrCallRow, PartnerLc } from "./data";
/** server-side ir_call rows (own select) still carry the raw token */
type IrCallServerRow = IrCallRow & { manage_token: string | null };

import type { Viewer } from "@/lib/rbac";

/** IR calls (International Relations): video calls with partner LCs abroad
 *  marketing our city's opens — the screenshot lands in the "CRM — IR Calls"
 *  folder on the system Drive. CVs: the consideration CV pool (private `cvs`
 *  storage bucket + Gemini auto-extraction). */

// the screenshot travels base64 inside the action body: 3.2 MB decoded ≈
// 4.27 MB base64 + JSON envelope — under Vercel's hard 4.5 MB request cap
// AND next.config.ts's serverActions bodySizeLimit (the client enforces 3 MB)
const IR_SCREENSHOT_MAX_BYTES = Math.floor(3.2 * 1024 * 1024);
const CV_MAX_SIZE = 25 * 1024 * 1024; // per file, any format
// base64 (~4/3) + prompt must stay under Gemini's 20 MB request cap
const CV_EXTRACT_MAX = 14 * 1024 * 1024;

const considerationFail = () =>
  fail("The Consideration module is outside your access.", "forbidden");

/** Uploader, VP/Director of the module, LCP or admin. */
const canManageCv = (viewer: Viewer, cv: { uploaded_by: string | null }) =>
  viewer.isAdmin ||
  viewer.role === "LCP" ||
  cv.uploaded_by === viewer.id ||
  ((viewer.role === "LCVP" || viewer.role === "Director") && hasConsiderationAccess(viewer));

/** VP-and-above inside the module: LCP/admin + LCVPs/Directors with access. */
const isConsiderationLead = (viewer: Viewer) =>
  viewer.isAdmin ||
  viewer.role === "LCP" ||
  ((viewer.role === "LCVP" || viewer.role === "Director") &&
    hasConsiderationAccess(viewer));

/** Builds the stored demand text from the multi-pick chips (CV_INDUSTRIES)
 *  + the "Other…" free text. */
function buildDemand(
  picks: string[] | null | undefined,
  other: string | null | undefined
): { value: string | null } | { error: ActionResult<never> } {
  const chosen = [...new Set((picks ?? []).map((p) => String(p)))].slice(0, 12);
  for (const p of chosen)
    if (!(CV_INDUSTRIES as readonly string[]).includes(p))
      return { error: fail("Pick demand domains from the list.") };
  const extra = (other ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const parts = chosen.filter((p) => p !== "Other");
  if (extra) parts.push(extra);
  else if (chosen.includes("Other")) parts.push("Other");
  return { value: parts.length ? parts.join(" · ") : null };
}

/** Validates + uploads an IR-call screenshot to the "CRM — IR Calls" Drive
 *  folder. BEST-EFFORT past validation: a Drive hiccup returns a warning, not
 *  an error, so the call is never lost. Shared by record + complete. */
async function uploadIrScreenshot(
  shot: { name: string; mimeType: string; dataBase64: string },
  fallbackName: string
): Promise<
  | { error: ActionResult<never> }
  | { file: { id: string; name: string; link: string } | null; warning?: string }
> {
  if (!(shot.mimeType || "").toLowerCase().startsWith("image/"))
    return { error: fail("The screenshot must be an image (png/jpg/webp…).") };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(shot.dataBase64, "base64");
  } catch {
    return { error: fail("The screenshot upload was corrupted — try again.") };
  }
  if (bytes.byteLength === 0) return { error: fail("The screenshot file is empty.") };
  if (bytes.byteLength > IR_SCREENSHOT_MAX_BYTES)
    return {
      error: fail("The screenshot is over 3 MB — compress or crop it and try again."),
    };
  // trust the CONTENT, not the declared mime (the client falls back to
  // image/png for unknown types): PNG / JPEG / WebP / GIF / HEIC magics
  const isImage =
    (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) ||
    (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) ||
    (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70);
  if (!isImage) return { error: fail("The screenshot must be an image (png/jpg/webp…).") };
  const fileName = shot.name?.trim() || fallbackName;
  if (await sandboxSuppressed("IR-call screenshot Drive upload"))
    return { file: null, warning: "Sandbox test view — the Drive upload was skipped." };
  try {
    const { uploadToDriveFolder } = await import("@/lib/google/drive-upload");
    const up = await uploadToDriveFolder({
      folderName: "CRM — IR Calls",
      fileName,
      mimeType: shot.mimeType,
      data: bytes,
    });
    return { file: { id: up.id, name: fileName, link: up.webViewLink } };
  } catch (e) {
    console.error("[ir-calls] Drive upload failed:", e);
    return {
      file: null,
      warning:
        "The call was saved, but the screenshot could not reach Drive — try again later or ping the IM team.",
    };
  }
}

/** "+ Add new LC" (inline in the combobox): creates a partner LC — the name
 *  is unique case-insensitively; hitting an existing one just returns it. */
export async function addPartnerLc(input: {
  name: string;
  country?: string | null;
}): Promise<ActionResult<PartnerLc>> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  const name = input.name?.trim();
  if (!name) return fail("The partner LC needs a name.");
  const country = input.country?.trim() || null;
  const { data: created, error } = await db()
    .from("partner_lcs")
    .insert({ name, country, created_by: viewer.id })
    .select("id, name, country")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await db()
        .from("partner_lcs")
        .select("id, name, country")
        .ilike("name", name.replaceAll("%", "\\%").replaceAll("_", "\\_"))
        .maybeSingle<PartnerLc>();
      if (existing) return { ok: true, data: existing };
      return fail("That partner LC already exists.");
    }
    return fail(error.message);
  }
  await recordUndo("partner_lcs", created.id, "insert");
  await logAudit(viewer.id, "partner_lc_add", "partner_lc", created.id, { name });
  return { ok: true, data: created as PartnerLc };
}

async function resolvePartnerLc(input: {
  partnerLcId?: string | null;
  newLc?: { name: string; country?: string | null } | null;
}): Promise<{ lc: PartnerLc } | { error: ActionResult<never> }> {
  if (input.partnerLcId) {
    const { data } = await db()
      .from("partner_lcs")
      .select("id, name, country")
      .eq("id", input.partnerLcId)
      .maybeSingle<PartnerLc>();
    if (!data) return { error: fail("That partner LC no longer exists — pick another.") };
    return { lc: data };
  }
  if (input.newLc?.name?.trim()) {
    const res = await addPartnerLc(input.newLc);
    if (!res.ok) return { error: res as ActionResult<never> };
    return { lc: res.data! };
  }
  return { error: fail("Pick the partner LC (or add it) first.") };
}

/** Records one PAST IR call manually (born 'completed' — booked calls arrive
 *  through bookIrCall instead). The screenshot upload is BEST-EFFORT: a Drive
 *  hiccup never loses the call — the row lands without it + a warning in the
 *  result. Sandbox: the Drive upload is suppressed, the insert is journaled. */
export async function recordIrCall(input: {
  partnerLcId?: string | null;
  newLc?: { name: string; country?: string | null } | null;
  calledAt: string;
  notes?: string | null;
  demand?: string[] | null;
  demandOther?: string | null;
  b2cCampaigns?: string | null;
  screenshot?: { name: string; mimeType: string; dataBase64: string } | null;
}): Promise<ActionResult<{ id: string; screenshotWarning?: string }>> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();

  const resolved = await resolvePartnerLc(input);
  if ("error" in resolved) return resolved.error;
  const lc = resolved.lc;

  const calledAt = new Date(input.calledAt);
  if (!input.calledAt || Number.isNaN(calledAt.getTime()))
    return fail("Pick the call's date and time.");
  // manual recording is for calls that HAPPENED — future ones come from the
  // booking link (5-min grace for clock skew)
  if (calledAt.getTime() > Date.now() + 5 * 60 * 1000)
    return fail("That call is in the future — future calls come from your booking link.");

  const demand = buildDemand(input.demand, input.demandOther);
  if ("error" in demand) return demand.error;

  let screenshot: { id: string; name: string; link: string } | null = null;
  let warning: string | undefined;
  if (input.screenshot?.dataBase64) {
    const up = await uploadIrScreenshot(
      input.screenshot,
      `IR call — ${lc.name} — ${calledAt.toISOString().slice(0, 10)}`
    );
    if ("error" in up) return up.error;
    screenshot = up.file;
    warning = up.warning;
  }

  const { data: created, error } = await db()
    .from("ir_calls")
    .insert({
      partner_lc_id: lc.id,
      partner_lc_name: lc.name,
      called_at: calledAt.toISOString(),
      notes: input.notes?.trim() || null,
      status: "completed",
      demand: demand.value,
      b2c_campaigns: input.b2cCampaigns?.trim().slice(0, 2000) || null,
      screenshot_drive_id: screenshot?.id ?? null,
      screenshot_name: screenshot?.name ?? null,
      screenshot_link: screenshot?.link ?? null,
      member_id: viewer.id,
      member_name: viewer.nickname || viewer.name,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);

  await recordUndo("ir_calls", created.id, "insert");
  await logAudit(viewer.id, "ir_call", "ir_call", created.id, { lc: lc.name });
  await stampWork(viewer.id, "ir_call"); // v29: counts towards working hours
  refresh();
  return { ok: true, data: { id: created.id, screenshotWarning: warning } };
}

// ------------------------------------------------------------ booking (v27/v28)

const BOOKING_SLUG_RE = /^[a-z0-9-]{3,40}$/;
const BOOKING_SLOT_CHOICES = [15, 30, 45, 60, 90, 120];
const BOOKING_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BOOKING_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "My booking link": each consideration member publishes /book/<slug> built
 *  from their Cairo-time availability (weekly rows + one-off dates). v28 adds
 *  Calendar-appointment parity: buffer between calls, minimum notice, maximum
 *  advance, an active date range and the guests-can-invite toggle. Upserted
 *  on member_id; the slug is unique case-insensitively across members.
 *  Sandbox-refused: the table is keyed by member_id (no `id` column), so the
 *  undo replay can't restore it. */
export async function saveIrBookingSettings(input: {
  slug: string;
  slotMinutes: number;
  availability: { day?: number; date?: string; from: string; to: string }[];
  active: boolean;
  bufferMinutes?: number;
  minNoticeMinutes?: number;
  maxAdvanceDays?: number;
  startDate?: string | null;
  endDate?: string | null;
  guestsCanInvite?: boolean;
}): Promise<ActionResult<{ slug: string }>> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  if (viewer.sandbox)
    return fail("Booking settings are disabled in the sandbox test view.");

  const slug = (input.slug ?? "").trim().toLowerCase();
  if (!BOOKING_SLUG_RE.test(slug))
    return fail(
      "The link name must be 3–40 characters — lowercase letters, numbers and dashes only."
    );
  const slotMinutes = Number(input.slotMinutes);
  if (!BOOKING_SLOT_CHOICES.includes(slotMinutes))
    return fail("Pick a slot length from the list (15 / 30 / 45 / 60 / 90 / 120 minutes).");

  const bufferMinutes = Number(input.bufferMinutes ?? 0);
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 60)
    return fail("The buffer between calls must be between 0 and 60 minutes.");
  const minNoticeMinutes = Number(input.minNoticeMinutes ?? 60);
  if (!Number.isInteger(minNoticeMinutes) || minNoticeMinutes < 0 || minNoticeMinutes > 10_080)
    return fail("The minimum notice must be between 0 minutes and 7 days.");
  const maxAdvanceDays = Number(input.maxAdvanceDays ?? 14);
  if (!Number.isInteger(maxAdvanceDays) || maxAdvanceDays < 1 || maxAdvanceDays > 90)
    return fail("The maximum advance must be between 1 and 90 days.");

  const cleanDate = (v: string | null | undefined, label: string) => {
    const t = (v ?? "").trim();
    if (!t) return { value: null as string | null };
    if (!BOOKING_DATE_RE.test(t) || Number.isNaN(new Date(`${t}T00:00:00Z`).getTime()))
      return { error: fail(`The ${label} date doesn't look right (YYYY-MM-DD).`) };
    return { value: t as string | null };
  };
  const startD = cleanDate(input.startDate, "start");
  if ("error" in startD) return startD.error!;
  const endD = cleanDate(input.endDate, "end");
  if ("error" in endD) return endD.error!;
  if (startD.value && endD.value && startD.value > endD.value)
    return fail("The schedule's start date must come before its end date.");

  const raw = Array.isArray(input.availability) ? input.availability.slice(0, 21) : [];
  const availability: { day?: number; date?: string; from: string; to: string }[] = [];
  for (const w of raw) {
    const from = String(w?.from ?? "");
    const to = String(w?.to ?? "");
    if (!BOOKING_TIME_RE.test(from) || !BOOKING_TIME_RE.test(to))
      return fail("Each availability row needs a from and to time (e.g. 18:00 → 21:00).");
    const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    if (mins(to) - mins(from) < slotMinutes)
      return fail(
        `The ${from} → ${to} window is shorter than one ${slotMinutes}-minute slot — widen it or drop it.`
      );
    const rawDate = w?.date;
    const date = String(rawDate ?? "").trim();
    // a row explicitly in "one date only" mode with the date left empty must
    // not silently fall through to the weekly branch's confusing error
    if (rawDate != null && !date)
      return fail("A 'One date only' row is missing its date — pick it or switch the row to weekly.");
    if (date) {
      if (!BOOKING_DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime()))
        return fail("Each one-date row needs a real date (YYYY-MM-DD).");
      availability.push({ date, from, to });
    } else {
      const day = Number(w?.day);
      if (!Number.isInteger(day) || day < 0 || day > 6)
        return fail("Each weekly availability row needs a day of the week.");
      availability.push({ day, from, to });
    }
  }
  if (input.active && availability.length === 0)
    return fail("Add at least one availability window — or switch the link off.");

  // overlapping windows on the same day would mint overlapping slot grids the
  // unique (member, called_at) index cannot race-guard — reject them
  {
    const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    type Win = { from: number; to: number; label: string };
    const overlapIn = (list: Win[]): string | null => {
      const s = [...list].sort((a, b) => a.from - b.from);
      for (let i = 1; i < s.length; i++)
        if (s[i].from < s[i - 1].to) return `${s[i].label} overlaps ${s[i - 1].label}`;
      return null;
    };
    const win = (w: { from: string; to: string }): Win => ({
      from: toM(w.from), to: toM(w.to), label: `${w.from} → ${w.to}`,
    });
    const weekly = new Map<number, Win[]>();
    const dated = new Map<string, Win[]>();
    for (const w of availability) {
      if (w.date) dated.set(w.date, [...(dated.get(w.date) ?? []), win(w)]);
      else weekly.set(w.day!, [...(weekly.get(w.day!) ?? []), win(w)]);
    }
    for (const list of weekly.values()) {
      const clash = overlapIn(list);
      if (clash) return fail(`Weekly windows overlap: ${clash} — merge or separate them.`);
    }
    for (const [date, list] of dated) {
      // a one-off day also carries that weekday's weekly windows
      const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
      const clash = overlapIn([...list, ...(weekly.get(dow) ?? [])]);
      if (clash) return fail(`Windows on ${date} overlap: ${clash} — merge or separate them.`);
    }
  }

  const { error } = await db().from("ir_booking_settings").upsert({
    member_id: viewer.id,
    slug,
    slot_minutes: slotMinutes,
    availability,
    active: !!input.active,
    buffer_minutes: bufferMinutes,
    min_notice_minutes: minNoticeMinutes,
    max_advance_days: maxAdvanceDays,
    start_date: startD.value,
    end_date: endD.value,
    guests_can_invite: input.guestsCanInvite ?? true,
  });
  if (error) {
    if (error.code === "23505")
      return fail(`"${slug}" is already taken by another member — pick a different link name.`);
    return fail(error.message);
  }
  await logAudit(viewer.id, "ir_booking_save", "ir_booking", viewer.id, {
    slug,
    slotMinutes,
    windows: availability.length,
    active: !!input.active,
  });
  refresh();
  return { ok: true, data: { slug } };
}

/** Neutral input scrub for the PUBLIC booking surfaces. */
const bookingPlain = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Shared per-IP throttle for EVERY public booking mutation (book, reschedule,
 *  cancel): 3 actions/hour per IP. Returns a fail() when over, null when OK —
 *  and never blocks the action on a throttle-infra error. */
async function bookingThrottle(): Promise<ActionResult<never> | null> {
  try {
    const { headers } = await import("next/headers");
    const ip =
      (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const hourKey = `bookrl:${ipHash}:${new Date().toISOString().slice(0, 13)}`;
    // atomic increment (0030 RPC) — read-then-upsert let parallel bursts by
    const { data: n, error } = await db().rpc("bump_rate_bucket", { k: hourKey });
    if (error) console.error("[ir-booking] rate bucket failed:", error.message);
    else if ((n ?? 0) > 3)
      return fail("Too many booking attempts from your network — try again later.");
  } catch (e) {
    console.error("[ir-booking] rate limit check failed:", e);
  }
  return null;
}

/** PUBLIC — the /book/<slug> submit. No viewer, no session: inputs are
 *  validated hard (length caps, tags stripped, email format), the slot is
 *  re-validated against the availability AND a fresh overlap query (race
 *  guard). v28: the IR's email is REQUIRED — they're invited as a calendar
 *  attendee (Google sends the invite), a Meet room rides on the event, and a
 *  confirmation email carries the public manage link. Journals nothing —
 *  there is no sandbox without a viewer. */
export async function bookIrCall(input: {
  slug: string;
  startIso: string;
  lcName: string;
  bookerEmail: string;
  bookerPhone: string;
  country?: string | null;
  bookerName?: string | null;
  bookerRole?: string | null;
}): Promise<
  ActionResult<{ memberName: string; whenLabel: string; meetLink: string | null }>
> {
  const plain = bookingPlain;

  const slug = plain(input.slug, 40).toLowerCase();
  if (!BOOKING_SLUG_RE.test(slug)) return fail("This booking link is not valid.");
  const lcName = plain(input.lcName, 120);
  if (!lcName) return fail("Tell us your LC's name first.");
  const bookerEmail = plain(input.bookerEmail, 200).toLowerCase();
  if (!bookerEmail || !EMAIL_RE.test(bookerEmail))
    return fail("We need a valid email — the calendar invite and Meet link go there.");
  // country only counts when it IS a country — public input never gets to
  // store free text (CountryInput is client-side sugar, not validation)
  const countryRaw = plain(input.country, 60);
  const { COUNTRIES } = await import("@/lib/countries");
  const country =
    COUNTRIES.find((c) => c.toLowerCase() === countryRaw.toLowerCase()) ?? null;
  // v29: name + role are REQUIRED on the public page (validated here too —
  // a public endpoint never trusts the client)
  const bookerName = plain(input.bookerName, 100);
  if (!bookerName) return fail("Tell us your name.");
  const BOOKER_ROLES = ["Member", "MM (Team Leader / Coordinator)", "LCVP", "LCP"];
  const bookerRole = plain(input.bookerRole, 40);
  if (!BOOKER_ROLES.includes(bookerRole)) return fail("Pick your role in your LC.");
  // v32.6: the phone is REQUIRED and must carry a country code — the crew
  // reaches IRs on WhatsApp, and a local-format number from another country is
  // unusable. normalizePhone accepts +<7–15 digits> for anything non-Egyptian.
  const phoneRaw = plain(input.bookerPhone, 40);
  if (!phoneRaw) return fail("We need your WhatsApp number so we can reach you.");
  const phoneCheck = normalizePhone(phoneRaw);
  if (!phoneCheck.ok || !phoneCheck.value.startsWith("+"))
    return fail(
      "Add your number with its country code, e.g. +20 10 1234 5678 or +33 6 12 34 56 78."
    );
  const bookerPhone = phoneCheck.value;
  const start = new Date(String(input.startIso ?? ""));
  if (!input.startIso || Number.isNaN(start.getTime()))
    return fail("Pick a time slot first.");

  // an admin's sandbox test view must not create real bookings (calendar
  // events + emails can't be undone); real external bookers never carry the
  // sandbox cookie, so this only ever fires for the tester themself
  if (await sandboxSuppressed("public IR booking"))
    return fail("Sandbox test view is active in this browser — exit it to test bookings.");

  // per-caller throttle: 3 bookings/hour per IP — a public endpoint must not
  // let one visitor flood a member's calendar or the partner-LC list
  const throttled = await bookingThrottle();
  if (throttled) return throttled;

  // the slug charset has no % or _ — ilike is a safe case-insensitive equal
  const { data: settings } = await db()
    .from("ir_booking_settings")
    .select(
      "member_id, slug, slot_minutes, availability, active, buffer_minutes, min_notice_minutes, max_advance_days, start_date, end_date, guests_can_invite"
    )
    .ilike("slug", slug)
    .maybeSingle<IrBookingSettings>();
  if (!settings?.active) return fail("This booking link is not active.");
  const { data: owner } = await db()
    .from("members")
    .select("id, name, nickname, email, google_refresh_token, is_active")
    .eq("id", settings.member_id)
    .maybeSingle<{
      id: string;
      name: string;
      nickname: string | null;
      email: string | null;
      google_refresh_token: string | null;
      is_active: boolean;
    }>();
  if (!owner?.is_active) return fail("This booking link is not active.");
  const memberName = owner.nickname || owner.name;

  // light rate limit: a fully-booked fortnight closes the link
  const { count: futureCount } = await db()
    .from("ir_calls")
    .select("id", { count: "exact", head: true })
    .eq("member_id", owner.id)
    .eq("status", "scheduled")
    .gte("called_at", new Date().toISOString());
  if ((futureCount ?? 0) >= 10)
    return fail(
      `${memberName}'s calendar is fully booked for now — try again in a few days.`
    );

  // the slot must be one the page offers RIGHT NOW: inside the availability,
  // in the future, and (fresh overlap query inside freeBookingSlots) not
  // clashing with another scheduled call
  const startIso = start.toISOString();
  const days = await freeBookingSlots(settings);
  const day = days.find((d) => d.slots.some((sl) => sl.iso === startIso));
  const slot = day?.slots.find((sl) => sl.iso === startIso);
  if (!day || !slot)
    return fail("That slot was just taken (or is no longer offered) — pick another one.");
  const whenLabel = `${day.label} · ${slot.label} (Cairo time)`;

  // resolve / create the partner LC by name, case-insensitively
  const esc = lcName.replaceAll("%", "\\%").replaceAll("_", "\\_");
  let lc: PartnerLc | null = null;
  const { data: existingLc } = await db()
    .from("partner_lcs")
    .select("id, name, country")
    .ilike("name", esc)
    .maybeSingle<PartnerLc>();
  if (existingLc) {
    // anonymous input never MUTATES an existing internal record — the crew
    // sets/corrects an LC's country from inside Sodio
    lc = existingLc;
  } else {
    const ins = await db()
      .from("partner_lcs")
      .insert({ name: lcName, country })
      .select("id, name, country")
      .single();
    if (ins.error) {
      if (ins.error.code === "23505") {
        const { data: raced } = await db()
          .from("partner_lcs")
          .select("id, name, country")
          .ilike("name", esc)
          .maybeSingle<PartnerLc>();
        lc = raced;
      }
      if (!lc) return fail("Could not save your LC — try again.");
    } else lc = ins.data as PartnerLc;
  }

  // the public manage link's key — lets the IR reschedule/cancel accountless
  const manageToken = crypto.randomBytes(16).toString("hex");

  const { data: created, error } = await db()
    .from("ir_calls")
    .insert({
      partner_lc_id: lc.id,
      partner_lc_name: lc.name,
      called_at: startIso,
      status: "scheduled",
      booker_name: bookerName,
      booker_role: bookerRole,
      booker_email: bookerEmail,
      booker_phone: bookerPhone,
      manage_token: manageToken,
      booked_at: new Date().toISOString(),
      duration_minutes: settings.slot_minutes,
      member_id: owner.id,
      member_name: memberName,
    })
    .select("id")
    .single();
  if (error) {
    // the unique (member_id, called_at where scheduled) index is the REAL
    // race guard — a concurrent booking of the same slot lands here
    if (error.code === "23505")
      return fail("That slot was just taken — pick another one.");
    return fail("Could not book the slot — try again.");
  }

  // best-effort calendar event on the OWNER's own calendar (a dead grant
  // must never fail the booking): the IR is a real attendee (Google emails
  // the invite) and a Meet room is provisioned
  let meetLink: string | null = null;
  try {
    const { createIrCallEvent } = await import("@/lib/google/calendar");
    const event = await createIrCallEvent(owner.google_refresh_token, {
      partnerLc: lc.name,
      start,
      minutes: settings.slot_minutes,
      attendeeEmail: bookerEmail,
      guestsCanInvite: settings.guests_can_invite ?? true,
      // The IR is an ATTENDEE — they read this description. It must carry
      // nothing internal: no CRM link (they can't open it), no Sodio branding
      // they have no context for. Just who is meeting whom (v32.8).
      description: `AIESEC IR call.\nPartner LC: ${lc.name}${
        country ? ` (${country})` : ""
      }${bookerName ? `\nBooked by: ${bookerName}` : ""}${
        bookerPhone ? ` · ${bookerPhone}` : ""
      } <${bookerEmail}>\nHost: ${owner.nickname || owner.name}, AIESEC in Alexandria.`,
    });
    if (event) {
      meetLink = event.meetLink;
      await db()
        .from("ir_calls")
        .update({ calendar_event_id: event.id, meet_link: event.meetLink })
        .eq("id", created.id);
    }
  } catch (e) {
    console.error("[ir-booking] calendar event failed:", e);
  }

  // bell + branded email to the owner — best-effort
  try {
    const { notifyMembers } = await import("./notify");
    await notifyMembers(
      [owner.id],
      "info",
      `📅 IR call booked — ${lc.name}`,
      `${bookerName ? `${bookerName} of ` : ""}${lc.name} booked ${whenLabel}.`,
      null,
      "/consideration"
    );
  } catch (e) {
    console.error("[ir-booking] notification failed:", e);
  }
  if (owner.email) {
    try {
      const { irCallBookedEmail } = await import("@/lib/email/templates");
      const mail = irCallBookedEmail({
        memberFirstName: (owner.nickname || owner.name).split(" ")[0],
        partnerLc: lc.name,
        country,
        bookerName,
        bookerEmail,
        whenLabel,
        slotMinutes: settings.slot_minutes,
        meetLink,
        considerationUrl: `${env.appUrl}/consideration`,
      });
      await sendEmail({ to: [owner.email], subject: mail.subject, html: mail.html });
    } catch (e) {
      console.error("[ir-booking] owner email failed:", e);
    }
  }

  // the IR's confirmation — when/who/Meet + the accountless manage link
  try {
    const { irBookingConfirmEmail } = await import("@/lib/email/templates");
    const confirm = irBookingConfirmEmail({
      bookerName,
      memberName,
      partnerLc: lc.name,
      whenLabel,
      slotMinutes: settings.slot_minutes,
      meetLink,
      manageUrl: `${env.appUrl}/book/manage/${manageToken}`,
    });
    await sendEmail({ to: [bookerEmail], subject: confirm.subject, html: confirm.html });
  } catch (e) {
    console.error("[ir-booking] booker confirmation email failed:", e);
  }

  await logAudit(null, "ir_call_booked", "ir_call", created.id, {
    lc: lc.name,
    slug,
    when: whenLabel,
  });
  return { ok: true, data: { memberName, whenLabel, meetLink } };
}

/** The in-call notes: demand domains + "when are your B2C campaigns?" + free
 *  notes + screenshot — saving flips a SCHEDULED call to 'completed'. Only
 *  the call's owner or a VP/Director/LCP. */
export async function completeIrCall(
  id: string,
  input: {
    demand?: string[] | null;
    demandOther?: string | null;
    b2cCampaigns?: string | null;
    notes?: string | null;
    screenshot?: { name: string; mimeType: string; dataBase64: string } | null;
  }
): Promise<ActionResult<{ screenshotWarning?: string }>> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  const { data: call } = await db()
    .from("ir_calls")
    .select("*")
    .eq("id", id)
    .maybeSingle<IrCallServerRow>();
  if (!call) return fail("That call no longer exists.");
  if (call.status !== "scheduled")
    return fail(`This call is already ${call.status}.`);
  if (call.member_id !== viewer.id && !isConsiderationLead(viewer))
    return fail("Only the call's owner or a VP/Director can fill its notes.", "forbidden");

  const demand = buildDemand(input.demand, input.demandOther);
  if ("error" in demand) return demand.error;

  let screenshot: { id: string; name: string; link: string } | null = null;
  let warning: string | undefined;
  if (input.screenshot?.dataBase64) {
    const up = await uploadIrScreenshot(
      input.screenshot,
      `IR call — ${call.partner_lc_name} — ${call.called_at.slice(0, 10)}`
    );
    if ("error" in up) return up.error;
    screenshot = up.file;
    warning = up.warning;
  }

  await snapshotForUndo("ir_calls", id);
  const { error } = await db()
    .from("ir_calls")
    .update({
      status: "completed",
      demand: demand.value,
      b2c_campaigns: input.b2cCampaigns?.trim().slice(0, 2000) || null,
      notes: input.notes?.trim().slice(0, 5000) || null,
      ...(screenshot
        ? {
            screenshot_drive_id: screenshot.id,
            screenshot_name: screenshot.name,
            screenshot_link: screenshot.link,
          }
        : {}),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "ir_call_complete", "ir_call", id, {
    lc: call.partner_lc_name,
  });
  await stampWork(viewer.id, "ir_call_completed"); // v29: counts towards working hours
  refresh();
  return { ok: true, data: { screenshotWarning: warning } };
}

/** Cancels a SCHEDULED call (owner or VP/Director/LCP) — v28: a short reason
 *  is REQUIRED, the calendar event is removed (attendees notified), and the
 *  IR who booked it gets the reason by email + a link to rebook. */
export async function cancelIrCall(id: string, reason: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  if (viewer.sandbox)
    return fail("Cancelling calls is disabled in the sandbox test view — exit it to test cancellations.");
  const cleanReason = (reason ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!cleanReason)
    return fail("Give the IR a short reason — it goes into their cancellation email.");
  const { data: call } = await db()
    .from("ir_calls")
    .select("*")
    .eq("id", id)
    .maybeSingle<IrCallServerRow>();
  if (!call) return fail("That call no longer exists.");
  if (call.status !== "scheduled") return fail("Only scheduled calls can be cancelled.");
  if (call.member_id !== viewer.id && !isConsiderationLead(viewer))
    return fail("Only the call's owner or a VP/Director can cancel it.", "forbidden");

  await snapshotForUndo("ir_calls", id);
  const { error } = await db()
    .from("ir_calls")
    .update({ status: "cancelled", cancel_reason: cleanReason })
    .eq("id", id);
  if (error) return fail(error.message);

  let ownerToken: string | null = null;
  let bookingSlug: { slug: string; active: boolean } | null = null;
  if (call.member_id) {
    const [{ data: owner }, { data: s }] = await Promise.all([
      db()
        .from("members")
        .select("google_refresh_token")
        .eq("id", call.member_id)
        .maybeSingle<{ google_refresh_token: string | null }>(),
      db()
        .from("ir_booking_settings")
        .select("slug, active")
        .eq("member_id", call.member_id)
        .maybeSingle<{ slug: string; active: boolean }>(),
    ]);
    ownerToken = owner?.google_refresh_token ?? null;
    bookingSlug = s ?? null;
  }

  if (
    call.calendar_event_id &&
    call.member_id &&
    !(await sandboxSuppressed("IR-call calendar event delete"))
  ) {
    try {
      const { deleteIrCallEvent } = await import("@/lib/google/calendar");
      await deleteIrCallEvent(ownerToken, call.calendar_event_id);
    } catch (e) {
      console.error("[ir-calls] calendar delete failed:", e);
    }
  }

  // the IR's cancellation email — reason + a rebook link (best-effort; the
  // sendEmail helper itself is sandbox-suppressed)
  if (call.booker_email) {
    try {
      const { irCallCancelledByMemberEmail } = await import("@/lib/email/templates");
      const { cairoWhenLabel } = await import("./data");
      const mail = irCallCancelledByMemberEmail({
        bookerName: call.booker_name,
        memberName: call.member_name,
        partnerLc: call.partner_lc_name,
        whenLabel: cairoWhenLabel(call.called_at),
        reason: cleanReason,
        bookingUrl: bookingSlug?.active ? `${env.appUrl}/book/${bookingSlug.slug}` : null,
      });
      await sendEmail({ to: [call.booker_email], subject: mail.subject, html: mail.html });
    } catch (e) {
      console.error("[ir-calls] booker cancel email failed:", e);
    }
  }

  await logAudit(viewer.id, "ir_call_cancel", "ir_call", id, {
    lc: call.partner_lc_name,
    reason: cleanReason,
  });
  refresh();
  return { ok: true };
}

/** v28 — the member can't make a BOOKED call and wants the IR to pick a new
 *  time: stamps reschedule_requested_at and emails the IR their manage link
 *  ("pick a new time"). Owner or VP/Director/LCP; no bells to anyone else. */
export async function requestIrReschedule(
  id: string,
  reason: string
): Promise<ActionResult> {
  const viewer = await getViewer();
  // v29: the IR is owed an explanation — the reason is logged AND emailed
  const why = (reason ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  if (why.length < 3) return fail("Add a short reason — the IR gets to read it.");
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  if (viewer.sandbox)
    return fail("Reschedule requests are disabled in the sandbox test view.");
  const { data: call } = await db()
    .from("ir_calls")
    .select("*")
    .eq("id", id)
    .maybeSingle<IrCallServerRow>();
  if (!call) return fail("That call no longer exists.");
  if (call.status !== "scheduled")
    return fail("Only scheduled calls can be rescheduled.");
  if (call.member_id !== viewer.id && !isConsiderationLead(viewer))
    return fail(
      "Only the call's owner or a VP/Director can request a reschedule.",
      "forbidden"
    );
  if (!call.manage_token || !call.booker_email)
    return fail(
      "This call wasn't booked through a link — there's no IR email to reach. Agree on a new time directly, then cancel and rebook."
    );

  // email FIRST (it's the whole point) — the stamp only lands after it sends;
  // in the sandbox test view sendEmail is suppressed and the stamp is journaled
  try {
    const { irRescheduleRequestEmail } = await import("@/lib/email/templates");
    const { cairoWhenLabel } = await import("./data");
    const mail = irRescheduleRequestEmail({
      bookerName: call.booker_name,
      memberName: call.member_name,
      partnerLc: call.partner_lc_name,
      whenLabel: cairoWhenLabel(call.called_at),
      reason: why,
      manageUrl: `${env.appUrl}/book/manage/${call.manage_token}`,
    });
    await sendEmail({ to: [call.booker_email], subject: mail.subject, html: mail.html });
  } catch (e) {
    console.error("[ir-calls] reschedule request email failed:", e);
    return fail("Could not email the IR — try again in a moment.");
  }

  await snapshotForUndo("ir_calls", id);
  const { error } = await db()
    .from("ir_calls")
    .update({ reschedule_requested_at: new Date().toISOString(), reschedule_reason: why })
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "ir_call_reschedule_request", "ir_call", id, {
    lc: call.partner_lc_name,
  });
  refresh();
  return { ok: true };
}

// ------------------------------------------------- public manage page (v28)

/** Loads a manage-token's call + its owner's settings/grant for the public
 *  reschedule/cancel actions. */
async function loadManagedCall(token: string): Promise<
  | { error: ActionResult<never> }
  | {
      call: IrCallServerRow;
      owner: {
        id: string;
        name: string;
        nickname: string | null;
        email: string | null;
        google_refresh_token: string | null;
        is_active: boolean;
      } | null;
      settings: IrBookingSettings | null;
    }
> {
  const clean = bookingPlain(token, 64);
  if (!/^[0-9a-f-]{20,64}$/i.test(clean))
    return { error: fail("This manage link is not valid.") };
  const { data: call } = await db()
    .from("ir_calls")
    .select("*")
    .eq("manage_token", clean)
    .maybeSingle<IrCallServerRow>();
  if (!call) return { error: fail("This manage link is not valid.") };
  let owner = null;
  let settings: IrBookingSettings | null = null;
  if (call.member_id) {
    const [o, s] = await Promise.all([
      db()
        .from("members")
        .select("id, name, nickname, email, google_refresh_token, is_active")
        .eq("id", call.member_id)
        .maybeSingle<{
          id: string;
          name: string;
          nickname: string | null;
          email: string | null;
          google_refresh_token: string | null;
          is_active: boolean;
        }>(),
      db()
        .from("ir_booking_settings")
        .select(
          "member_id, slug, slot_minutes, availability, active, buffer_minutes, min_notice_minutes, max_advance_days, start_date, end_date, guests_can_invite"
        )
        .eq("member_id", call.member_id)
        .maybeSingle<IrBookingSettings>(),
    ]);
    owner = o.data ?? null;
    settings = s.data ?? null;
  }
  return { call, owner, settings };
}

/** PUBLIC — the manage page's Reschedule: the IR picks one of the member's
 *  CURRENT free slots and the call moves — DB first (the unique scheduled
 *  index is the race guard), then the calendar event, then emails both ways. */
export async function rescheduleBookedCall(input: {
  token: string;
  startIso: string;
}): Promise<ActionResult<{ whenLabel: string }>> {
  if (await sandboxSuppressed("public IR reschedule"))
    return fail("Sandbox test view is active in this browser — exit it to test rescheduling.");
  const throttled = await bookingThrottle();
  if (throttled) return throttled;

  const loaded = await loadManagedCall(input.token);
  if ("error" in loaded) return loaded.error;
  const { call, owner, settings } = loaded;
  if (call.status === "cancelled")
    return fail("This booking was cancelled — book a fresh slot instead.");
  if (call.status !== "scheduled")
    return fail("This call already happened — nothing to reschedule.");
  if (!owner?.is_active || !settings?.active)
    return fail("Rescheduling is unavailable right now — reply to your confirmation email instead.");

  const start = new Date(String(input.startIso ?? ""));
  if (!input.startIso || Number.isNaN(start.getTime()))
    return fail("Pick a new time slot first.");
  // moving to the time you already have is a no-op, not a reschedule (v29)
  if (new Date(call.called_at).getTime() === start.getTime())
    return fail("That's the time you already have — pick a different slot.");
  const startIso = start.toISOString();

  // the new slot must be one the member offers RIGHT NOW — the call being
  // moved doesn't block itself
  const days = await freeBookingSlots(settings, { excludeCallId: call.id });
  const day = days.find((d) => d.slots.some((sl) => sl.iso === startIso));
  const slot = day?.slots.find((sl) => sl.iso === startIso);
  if (!day || !slot)
    return fail("That slot was just taken (or is no longer offered) — pick another one.");
  const newWhen = `${day.label} · ${slot.label} (Cairo time)`;
  const { cairoWhenLabel } = await import("./data");
  const oldWhen = cairoWhenLabel(call.called_at);

  const { data: movedRows, error } = await db()
    .from("ir_calls")
    .update({
      called_at: startIso,
      duration_minutes: settings.slot_minutes,
      reschedule_requested_at: null,
    })
    .eq("id", call.id)
    .eq("status", "scheduled")
    .select("id");
  if (error) {
    // unique (member_id, called_at where scheduled) — a concurrent booking
    // of the same slot lands here
    if (error.code === "23505")
      return fail("That slot was just taken — pick another one.");
    return fail("Could not move the call — try again.");
  }
  // 0-row = the status flipped mid-flight — never touch the calendar then
  if (!movedRows?.length)
    return fail("This booking just changed on the other side — reload the page and try again.");

  // move the calendar event (attendees get Google's update) — best-effort
  if (call.calendar_event_id) {
    try {
      const { updateIrCallEvent } = await import("@/lib/google/calendar");
      await updateIrCallEvent(
        owner.google_refresh_token,
        call.calendar_event_id,
        start,
        settings.slot_minutes
      );
    } catch (e) {
      console.error("[ir-booking] calendar reschedule failed:", e);
    }
  }

  // owner: bell + email · IR: fresh confirmation — all best-effort
  try {
    const { notifyMembers } = await import("./notify");
    await notifyMembers(
      [owner.id],
      "info",
      `🔁 IR call moved — ${call.partner_lc_name}`,
      `${call.booker_name ? `${call.booker_name} of ` : ""}${call.partner_lc_name} moved the call from ${oldWhen} to ${newWhen}.`,
      null,
      "/consideration"
    );
  } catch (e) {
    console.error("[ir-booking] reschedule notification failed:", e);
  }
  if (owner.email) {
    try {
      const { irCallRescheduledOwnerEmail } = await import("@/lib/email/templates");
      const mail = irCallRescheduledOwnerEmail({
        memberFirstName: (owner.nickname || owner.name).split(" ")[0],
        partnerLc: call.partner_lc_name,
        bookerName: call.booker_name,
        oldWhenLabel: oldWhen,
        newWhenLabel: newWhen,
        considerationUrl: `${env.appUrl}/consideration`,
      });
      await sendEmail({ to: [owner.email], subject: mail.subject, html: mail.html });
    } catch (e) {
      console.error("[ir-booking] owner reschedule email failed:", e);
    }
  }
  if (call.booker_email) {
    try {
      const { irBookingConfirmEmail } = await import("@/lib/email/templates");
      const mail = irBookingConfirmEmail({
        bookerName: call.booker_name,
        memberName: owner.nickname || owner.name,
        partnerLc: call.partner_lc_name,
        whenLabel: newWhen,
        slotMinutes: settings.slot_minutes,
        meetLink: call.meet_link,
        manageUrl: `${env.appUrl}/book/manage/${call.manage_token}`,
        rescheduled: true,
      });
      await sendEmail({ to: [call.booker_email], subject: mail.subject, html: mail.html });
    } catch (e) {
      console.error("[ir-booking] booker reschedule email failed:", e);
    }
  }

  await logAudit(null, "ir_call_rescheduled", "ir_call", call.id, {
    lc: call.partner_lc_name,
    from: oldWhen,
    to: newWhen,
  });
  return { ok: true, data: { whenLabel: newWhen } };
}

/** PUBLIC — the manage page's Cancel: a short reason is required; the call is
 *  cancelled, the calendar event removed, and the owner notified (bell +
 *  email with the reason). */
export async function cancelBookedCall(input: {
  token: string;
  reason: string;
}): Promise<ActionResult> {
  if (await sandboxSuppressed("public IR booking cancel"))
    return fail("Sandbox test view is active in this browser — exit it to test cancelling.");
  const throttled = await bookingThrottle();
  if (throttled) return throttled;

  // the IR cancels freely — a note is welcome, never required (v29)
  const reason = bookingPlain(input.reason, 500);

  const loaded = await loadManagedCall(input.token);
  if ("error" in loaded) return loaded.error;
  const { call, owner } = loaded;
  if (call.status === "cancelled") return fail("This booking is already cancelled.");
  if (call.status !== "scheduled")
    return fail("This call already happened — nothing to cancel.");

  const { data: cancelledRows, error } = await db()
    .from("ir_calls")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", call.id)
    .eq("status", "scheduled")
    .select("id");
  if (error) return fail("Could not cancel the booking — try again.");
  // 0-row = the status flipped mid-flight — leave the calendar alone
  if (!cancelledRows?.length)
    return fail("This booking just changed — reload the page.");

  if (call.calendar_event_id && owner) {
    try {
      const { deleteIrCallEvent } = await import("@/lib/google/calendar");
      await deleteIrCallEvent(owner.google_refresh_token, call.calendar_event_id);
    } catch (e) {
      console.error("[ir-booking] calendar cancel failed:", e);
    }
  }

  const { cairoWhenLabel } = await import("./data");
  const whenLabel = cairoWhenLabel(call.called_at);
  if (owner) {
    try {
      const { notifyMembers } = await import("./notify");
      await notifyMembers(
        [owner.id],
        "info",
        `❌ IR call cancelled — ${call.partner_lc_name}`,
        `${call.booker_name ? `${call.booker_name} of ` : ""}${call.partner_lc_name} cancelled ${whenLabel}: "${reason}"`,
        null,
        "/consideration"
      );
    } catch (e) {
      console.error("[ir-booking] cancel notification failed:", e);
    }
    if (owner.email) {
      try {
        const { irCallCancelledByBookerEmail } = await import("@/lib/email/templates");
        const mail = irCallCancelledByBookerEmail({
          memberFirstName: (owner.nickname || owner.name).split(" ")[0],
          partnerLc: call.partner_lc_name,
          bookerName: call.booker_name,
          whenLabel,
          reason,
          considerationUrl: `${env.appUrl}/consideration`,
        });
        await sendEmail({ to: [owner.email], subject: mail.subject, html: mail.html });
      } catch (e) {
        console.error("[ir-booking] owner cancel email failed:", e);
      }
    }
  }

  await logAudit(null, "ir_call_cancelled_by_booker", "ir_call", call.id, {
    lc: call.partner_lc_name,
    reason,
  });
  return { ok: true };
}

// ------------------------------------------------- partner LC registry (v28)

/** VP/Director/LCP fix a partner LC's name or country. The denormalized
 *  partner_lc_name snapshots on IR calls and CVs follow the rename so the
 *  logs read consistently. Sandbox-refused: the fan-out to child rows can't
 *  be journaled row-by-row. */
export async function updatePartnerLc(
  id: string,
  patch: { name: string; country?: string | null }
): Promise<ActionResult<PartnerLc>> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  // v29: MMs (Team Leaders / Coordinators) fix LC names too — they are the
  // ones on the calls. Deleting an LC stays VP+.
  const canRename =
    isConsiderationLead(viewer) ||
    ["Team Leader", "Coordinator"].includes(viewer.role);
  if (!canRename)
    return fail("Only MMs, VPs/Directors or the LCP can edit a partner LC.", "forbidden");
  if (viewer.sandbox)
    return fail("Partner-LC edits are disabled in the sandbox test view.");

  const name = (patch.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return fail("The partner LC needs a name.");
  const country = (patch.country ?? "").trim().slice(0, 60) || null;

  const { data: existing } = await db()
    .from("partner_lcs")
    .select("id, name, country")
    .eq("id", id)
    .maybeSingle<PartnerLc>();
  if (!existing) return fail("That partner LC no longer exists.");

  const { data: updated, error } = await db()
    .from("partner_lcs")
    .update({ name, country })
    .eq("id", id)
    .select("id, name, country")
    .single();
  if (error) {
    if (error.code === "23505")
      return fail(`An LC named "${name}" already exists — merge by hand instead.`);
    return fail(error.message);
  }

  // keep the denormalized snapshots readable after a rename — best-effort
  if (existing.name !== name) {
    const { error: e1 } = await db()
      .from("ir_calls")
      .update({ partner_lc_name: name })
      .eq("partner_lc_id", id);
    const { error: e2 } = await db()
      .from("cvs")
      .update({ partner_lc_name: name })
      .eq("partner_lc_id", id);
    if (e1 || e2)
      console.error("[partner-lcs] denormalized rename failed:", e1?.message, e2?.message);
  }

  await logAudit(viewer.id, "partner_lc_update", "partner_lc", id, {
    from: existing.name,
    to: name,
  });
  refresh();
  return { ok: true, data: updated as PartnerLc };
}

/** VP/Director/LCP delete a partner LC — only when NO IR calls or CVs point
 *  at it (else a friendly error). Sandbox-refused. */
export async function deletePartnerLc(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  if (!isConsiderationLead(viewer))
    return fail("Only a VP/Director or the LCP can delete a partner LC.", "forbidden");
  if (viewer.sandbox)
    return fail("Partner-LC edits are disabled in the sandbox test view.");

  const { data: lc } = await db()
    .from("partner_lcs")
    .select("id, name")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string }>();
  if (!lc) return fail("That partner LC no longer exists.");

  const [{ count: callCount }, { count: cvCount }] = await Promise.all([
    db().from("ir_calls").select("id", { count: "exact", head: true }).eq("partner_lc_id", id)
    .neq("status", "cancelled"),
    db().from("cvs").select("id", { count: "exact", head: true }).eq("partner_lc_id", id),
  ]);
  if ((callCount ?? 0) > 0 || (cvCount ?? 0) > 0)
    return fail(
      `"${lc.name}" is referenced by ${callCount ?? 0} IR call(s) and ${cvCount ?? 0} CV(s) — it stays in the list as history. Rename it instead if the name is wrong.`
    );

  const { error } = await db().from("partner_lcs").delete().eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "partner_lc_delete", "partner_lc", id, { name: lc.name });
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------------ CV pool

/** Step 1 — signed upload URL for the CV file (browser PUTs straight to the
 *  private `cvs` bucket; the bytes never touch a server action). */
export async function requestCvUpload(file: {
  name: string;
  type: string;
  size: number;
}): Promise<ActionResult<{ path: string; signedUrl: string }>> {
  const viewer = await getViewer();
  // v27: the CV pool is IGT-only — Consideration crew + IGT leaders
  if (!canSeeCvPool(viewer)) return considerationFail();
  // the uploaded storage object + the Gemini call can't be undone on exit
  if (viewer.sandbox)
    return fail("CV uploads are disabled in the sandbox test view — the file and AI extraction can't be undone on exit.");
  if (!file?.name) return fail("Pick the CV file first.");
  if (file.size > CV_MAX_SIZE)
    return fail(`"${file.name}" is over 25 MB — compress it and try again.`);

  const safeName = file.name.replace(/[^\w.\- ()]+/g, "_").slice(-80);
  const path = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const { data, error } = await db().storage.from("cvs").createSignedUploadUrl(path);
  if (error || !data) {
    if (error?.message?.toLowerCase().includes("bucket"))
      return fail("The cvs storage bucket isn't set up yet — run migration 0026 in the Supabase SQL editor.");
    return fail(error?.message ?? "Could not prepare the upload — try again.");
  }
  return { ok: true, data: { path: data.path, signedUrl: data.signedUrl } };
}

/** Runs (or re-runs) the Gemini extraction for one CV row and stamps the
 *  result. Returns the final status + a human error when it didn't stick. */
async function runCvExtraction(id: string): Promise<{ status: string; note?: string }> {
  const { data: cv } = await db().from("cvs").select("*").eq("id", id).maybeSingle<CvRow>();
  if (!cv) return { status: "failed", note: "CV not found." };

  const finish = async (patch: Record<string, unknown>) => {
    await snapshotForUndo("cvs", id);
    const { error } = await db().from("cvs").update(patch).eq("id", id);
    if (error) console.error(`[cvs] status write for ${id}:`, error.message);
    return error;
  };

  if ((cv.size_bytes ?? 0) > CV_EXTRACT_MAX) {
    await finish({ extraction_status: "unsupported" });
    return {
      status: "unsupported",
      note: "The file is too big for the AI to read (14 MB max) — fill the fields manually.",
    };
  }
  const { data: file, error: dlError } = await db().storage.from("cvs").download(cv.file_path);
  if (dlError || !file) {
    await finish({ extraction_status: "failed" });
    return { status: "failed", note: "Could not read the uploaded file back from storage." };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > CV_EXTRACT_MAX) {
    await finish({ extraction_status: "unsupported" });
    return {
      status: "unsupported",
      note: "The file is too big for the AI to read (14 MB max) — fill the fields manually.",
    };
  }

  const { extractCv } = await import("@/lib/cv-extract");
  const result = await extractCv({
    mimeType: cv.mime_type || file.type || "application/octet-stream",
    dataBase64: buf.toString("base64"),
  });

  if (result.status === "done") {
    const saveErr = await finish({
      // AI fills only what a human hasn't already fixed by hand
      person_name: cv.person_name ?? result.fields.person_name,
      phone: cv.phone ?? result.fields.phone,
      email: cv.email ?? result.fields.email,
      industry: cv.industry ?? result.fields.industry,
      skills: cv.skills ?? result.fields.skills,
      summary: result.fields.summary,
      extracted_text: result.fields.full_text,
      extraction_status: "done",
    });
    // a silent lost write would show "done" while the row stays pending
    if (saveErr)
      return { status: "failed", note: "The AI read it but saving failed — hit Re-run." };
    return { status: "done" };
  }
  await finish({ extraction_status: result.status });
  return {
    status: result.status,
    note:
      result.status === "failed"
        ? result.error
        : "This format can't be auto-read (e.g. docx) — fill the fields manually.",
  };
}

/** Step 2 — after the browser PUT: record the CV row, then IMMEDIATELY run
 *  the AI extraction (name/phone/email/industry/skills/summary/full text). */
export async function confirmCvUpload(input: {
  path: string;
  name: string;
  type: string;
  size: number;
  partnerLcId?: string | null;
  newLc?: { name: string; country?: string | null } | null;
}): Promise<ActionResult<{ id: string; status: string; note?: string }>> {
  const viewer = await getViewer();
  // v27: the CV pool is IGT-only — Consideration crew + IGT leaders
  if (!canSeeCvPool(viewer)) return considerationFail();
  if (viewer.sandbox)
    return fail("CV uploads are disabled in the sandbox test view — the file and AI extraction can't be undone on exit.");
  // only paths shaped like the ones requestCvUpload issues are recordable
  if (!/^\d{10,}-[0-9a-f][0-9a-f-]{30,40}-/.test(input.path ?? ""))
    return fail("Nothing was uploaded.");

  // v29: every CV belongs to an LC — the pool is worthless without it
  if (!input.partnerLcId && !input.newLc?.name?.trim())
    return fail("Pick the partner LC this CV came from.");
  const resolved = await resolvePartnerLc(input);
  if ("error" in resolved) return resolved.error;
  const lc: PartnerLc | null = resolved.lc;
  if (!lc) return fail("Pick the partner LC this CV came from.");

  const { data: created, error } = await db()
    .from("cvs")
    .insert({
      partner_lc_id: lc?.id ?? null,
      partner_lc_name: lc?.name ?? null,
      file_path: input.path,
      file_name: (input.name || "CV").slice(0, 200),
      mime_type: input.type || "application/octet-stream",
      size_bytes: input.size,
      extraction_status: "pending",
      uploaded_by: viewer.id,
      uploader_name: viewer.nickname || viewer.name,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);

  await recordUndo("cvs", created.id, "insert");
  await logAudit(viewer.id, "cv_upload", "cv", created.id, { file: input.name });
  const result = await runCvExtraction(created.id);
  refresh();
  return { ok: true, data: { id: created.id, status: result.status, note: result.note } };
}

/** Manual re-run for failed/unsupported (or stuck-pending) extractions. */
export async function rerunCvExtraction(
  id: string
): Promise<ActionResult<{ status: string; note?: string }>> {
  const viewer = await getViewer();
  if (!canSeeCvPool(viewer)) return considerationFail();
  // a real Gemini call burns real quota — nothing to undo, so refuse
  if (viewer.sandbox)
    return fail("AI extraction is disabled in the sandbox test view.");
  const { data: cv } = await db().from("cvs").select("id").eq("id", id).maybeSingle();
  if (!cv) return fail("That CV no longer exists.");
  const result = await runCvExtraction(id);
  await logAudit(viewer.id, "cv_extract_rerun", "cv", id, { status: result.status });
  refresh();
  return { ok: true, data: result };
}

/** Fix the extracted fields by hand — the uploader or a VP/Director/LCP. */
export async function updateCvFields(
  id: string,
  patch: {
    person_name?: string | null;
    phone?: string | null;
    email?: string | null;
    industry?: string | null;
    skills?: string | null;
    partnerLcId?: string | null;
  }
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canSeeCvPool(viewer)) return considerationFail();
  const { data: cv } = await db().from("cvs").select("*").eq("id", id).maybeSingle<CvRow>();
  if (!cv) return fail("That CV no longer exists.");
  if (!canManageCv(viewer, cv))
    return fail("Only the uploader or a VP/Director can edit this CV's fields.", "forbidden");

  const clean = (v: string | null | undefined, max: number) => {
    if (v === undefined) return undefined;
    const t = (v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };
  const update: Record<string, unknown> = {};
  const name = clean(patch.person_name, 200);
  if (name !== undefined) update.person_name = name;
  const phone = clean(patch.phone, 40);
  if (phone !== undefined) update.phone = phone;
  const email = clean(patch.email, 200);
  if (email !== undefined) {
    if (email && !EMAIL_RE.test(email)) return fail("That email doesn't look right.");
    update.email = email;
  }
  if (patch.industry !== undefined) {
    const ind = (patch.industry ?? "").trim();
    if (ind && !(CV_INDUSTRIES as readonly string[]).includes(ind))
      return fail("Pick an industry from the list.");
    update.industry = ind || null;
  }
  const skills = clean(patch.skills, 2000);
  if (skills !== undefined) update.skills = skills;
  if (patch.partnerLcId !== undefined) {
    if (patch.partnerLcId) {
      const resolved = await resolvePartnerLc({ partnerLcId: patch.partnerLcId });
      if ("error" in resolved) return resolved.error;
      update.partner_lc_id = resolved.lc.id;
      update.partner_lc_name = resolved.lc.name;
    } else {
      update.partner_lc_id = null;
      update.partner_lc_name = null;
    }
  }
  if (Object.keys(update).length === 0) return { ok: true };

  await snapshotForUndo("cvs", id);
  const { error } = await db().from("cvs").update(update).eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "cv_update", "cv", id, { fields: Object.keys(update) });
  refresh();
  return { ok: true };
}

/** 10-minute signed link to view/download the CV file (bucket stays private). */
export async function getCvFileUrl(id: string): Promise<ActionResult<{ url: string }>> {
  const viewer = await getViewer();
  if (!canSeeCvPool(viewer)) return considerationFail();
  const { data: cv } = await db()
    .from("cvs")
    .select("file_path")
    .eq("id", id)
    .maybeSingle<{ file_path: string }>();
  if (!cv) return fail("That CV no longer exists.");
  const { data, error } = await db().storage.from("cvs").createSignedUrl(cv.file_path, 600);
  if (error || !data) return fail(error?.message ?? "Could not open the file — try again.");
  return { ok: true, data: { url: data.signedUrl } };
}

/** Delete a CV (row + the stored file) — the uploader or a VP/Director/LCP.
 *  Refused in the sandbox: a removed storage object can't be undone on exit. */
export async function deleteCv(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canSeeCvPool(viewer)) return considerationFail();
  const { data: cv } = await db().from("cvs").select("*").eq("id", id).maybeSingle<CvRow>();
  if (!cv) return fail("That CV no longer exists.");
  if (!canManageCv(viewer, cv))
    return fail("Only the uploader or a VP/Director can delete this CV.", "forbidden");
  if (viewer.sandbox)
    return fail("Deleting CVs is disabled in the sandbox test view — the file removal can't be undone on exit.");

  const { error } = await db().from("cvs").delete().eq("id", id);
  if (error) return fail(error.message);
  const { error: rmError } = await db().storage.from("cvs").remove([cv.file_path]);
  if (rmError) console.error("[cvs] storage removal failed:", rmError.message);
  await logAudit(viewer.id, "cv_delete", "cv", id, { file: cv.file_name });
  refresh();
  return { ok: true };
}

// ==================================================== timelines (v32.9)

export async function saveTimeline(input: {
  id?: string | null;
  scope: string;
  kind: string;
  functionKey?: string | null;
  teamName?: string | null;
  weekday: number;
  time: string;
  virtual?: boolean;
  note?: string | null;
  startsOn: string;
  endsOn: string;
}): Promise<ActionResult<{ id: string; created: number; skipped: number }>> {
  const { saveRoutine } = await import("./touch-points");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return saveRoutine(input as any) as any;
}

export async function listTimelines(): Promise<ActionResult<unknown[]>> {
  const { listRoutines } = await import("./touch-points");
  return { ok: true, data: await listRoutines() };
}

export async function deleteTimeline(id: string): Promise<ActionResult> {
  const { deleteRoutine } = await import("./touch-points");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return deleteRoutine(id) as any;
}
