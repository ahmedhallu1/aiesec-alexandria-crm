"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import {
  allowedAccountFunctions,
  canEditAccount,
  canEditRequestState,
  canManageMembership,
  canReassignAccount,
  canViewArchive,
  commentLabel,
  reassignTargetScope,
} from "@/lib/rbac";
import { checkAccountName, getViewer, logAudit, type PipelineRow } from "./data";
import { sendEmail } from "@/lib/google/gmail";
import { visitReportEmail } from "@/lib/email/templates";
import {
  buildVisitIcs,
  deleteFollowupEvent,
  deleteMailboxVisitEvent,
  getVisitsCalendarId,
  upsertFollowupEvent,
  upsertMailboxVisitEvent,
} from "@/lib/google/calendar";
import {
  accountSlug,
  cleanPhone,
  EMAIL_RE,
  FEEDBACK_INBOX_EMAILS,
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
  function: z.enum(["IGV", "IGT", "B2B"]),
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
  input: z.infer<typeof createAccountSchema>
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

  // HARD RULE: unique account name across ALL ICX data + archive block
  const { duplicate, blacklisted } = await checkAccountName(data.name);
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
        was_responsible: duplicate.responsible_nickname || duplicate.responsible_name,
      }
    );
  if (duplicate)
    return fail(
      `This account already exists on ${duplicate.function} accounts.`,
      "duplicate",
      {
        function: duplicate.function,
        responsible: duplicate.responsible_nickname || duplicate.responsible_name,
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

  // tagged contacts: either the dialog's rows or built from the flat fields (import)
  const rawContacts: AccountContact[] =
    data.contacts && data.contacts.length > 0
      ? (data.contacts as AccountContact[])
      : ([
          ...(data.phone ? [{ tag: "Contact", kind: "phone" as const, value: data.phone }] : []),
          ...(data.email ? [{ tag: "Contact", kind: "email" as const, value: data.email }] : []),
          ...(data.social_link ? [{ tag: "Other", kind: "link" as const, value: data.social_link }] : []),
          ...(data.website ? [{ tag: "Website", kind: "link" as const, value: data.website }] : []),
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
      industry: data.industry || null,
      contacts,
      ...legacy,
      requested_podio: data.requested_podio ?? false,
      responsible_id: responsibleId,
      created_by: viewer.id,
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

  await logAudit(viewer.id, "create", "account", created.id, { name: data.name });
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
  const inScope =
    scope.kind === "all" ||
    (scope.kind === "functions" &&
      (target.functions ?? []).includes(account.function)) ||
    (scope.kind === "members" && scope.ids.includes(target.id));
  if (!inScope) return fail("You can only reassign to members in your scope.", "forbidden");

  const { error } = await db()
    .from("accounts")
    .update({ responsible_id: newResponsibleId })
    .eq("id", accountId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "reassign", "account", accountId, {
    from: account.responsible_id,
    to: newResponsibleId,
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
    // the visit event lives on the shared "Sodio — LC Visits" calendar
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
  const cleanReason = reason?.trim();
  if (!cleanName || cleanName.length < 2) return fail("Account name is required.");
  if (!cleanReason) return fail("Pick or type the archive reason.");

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
      `"${cleanName}" exists in the active accounts (${duplicate.function}, ${duplicate.responsible_nickname || duplicate.responsible_name}) — mark it Out of Process from its page instead.`,
      "duplicate"
    );

  const { error } = await db().from("blacklist").insert({
    account_name: cleanName,
    comments: cleanReason,
    added_by: viewerId,
  });
  if (error) {
    if (error.code === "23505") return fail(`"${cleanName}" is already in the archive.`, "archived");
    return fail(error.message);
  }
  return { ok: true };
}

/** Add one archived account by hand (name + reason) — for companies that were
 *  burned before the CRM existed. TL+ (anyone who can open the archive). */
export async function addArchivedAccount(input: {
  name: string;
  reason: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canViewArchive(viewer))
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
  if (!canViewArchive(viewer))
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
  const { error } = await db().from("blacklist").delete().eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "archive_remove", "blacklist", id);
  refresh();
  return { ok: true };
}

/** Records ONE deal — an account can close many over time (3 slots today, 6
 *  more next month = 2 deals · 9 slots). Opens are recorded PER PRODUCT:
 *  IGV accounts sign IGV opens; IGT accounts split IGTa + IGTe; B2B accounts
 *  mix all three (e.g. 3 IGV + 2 IGTe + 1 IGTa). Totals live on the account. */
export async function recordDeal(
  accountId: string,
  breakdown: { igv?: number; igta?: number; igte?: number },
  note?: string
): Promise<ActionResult<{ deals: number; slots: number }>> {
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
  if (account.function === "IGV") {
    igta = 0; igte = 0;
    if (igv < 1) return fail("How many IGV opens were signed?");
  } else if (account.function === "IGT") {
    igv = 0;
    if (igta + igte < 1) return fail("Split the opens across IGTa / IGTe (at least 1).");
  } else if (igv + igta + igte < 1) {
    return fail("Add the opens of this deal (IGV / IGTa / IGTe).");
  }
  const cleanSlots = igv + igta + igte;

  // the deal is recorded for the account's RESPONSIBLE (whoever the opens
  // were raised for), not the person clicking the button
  const { error } = await db().from("deals").insert({
    account_id: accountId,
    member_id: account.responsible_id,
    slots: cleanSlots,
    slots_igv: igv,
    slots_igta: igta,
    slots_igte: igte,
    note: note?.trim() || null,
  });
  if (error) {
    if (error.message.includes("slots_igv"))
      return fail("Per-product deals need migration 0009 — run it in the Supabase SQL editor.");
    return fail(error.message);
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
  const { error: updateError } = await db()
    .from("accounts")
    .update(totals)
    .eq("id", accountId);
  if (updateError) return fail(updateError.message);

  await logAudit(viewer.id, "deal", "account", accountId, {
    slots: cleanSlots, igv, igta, igte,
  });
  refresh(accountId);
  return { ok: true, data: { deals: totals.deals_count, slots: totals.slots_count } };
}

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

  const { error } = await db().from("account_comments").insert({
    account_id: accountId,
    member_id: viewer.id,
    author_label: commentLabel(viewer),
    body: text,
  });
  if (error) return fail(error.message);
  await logAudit(viewer.id, "comment", "account", accountId);
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
  const { error } = await db()
    .from("account_comments")
    .update({ pinned })
    .eq("id", commentId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, pinned ? "pin_comment" : "unpin_comment", "account", comment.account_id);
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

  const { error } = await db().from("contact_attempts").insert({
    account_id: accountId,
    member_id: viewer.id,
    method,
    status,
    comment: comment || null,
  });
  if (error) {
    if (error.message.includes("enum contact_status"))
      return fail(
        'The database is missing the "Visit Scheduled" value — run migration 0007 in the Supabase SQL editor (it ends with a schema reload).'
      );
    return fail(error.message);
  }

  if (notInterested) {
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
  if (subs.some((s) => ["Raising", "ICX", "B2B"].includes(s))) return true;
  return !subs.includes("Consideration");
}

const memberIsB2B = (m: { functions: string[] | null; sub_functions: string[] | null }) =>
  (m.functions ?? []).includes("B2B") || (m.sub_functions ?? []).includes("B2B");

/** Product label for emails/notifications: IGV / IGTa / IGTe / B2B. */
function productLabel(fn: string, product: string | null): string {
  if (fn === "IGT") return product === "GTe" ? "IGTe" : product === "GTa" ? "IGTa" : "IGT";
  return fn;
}

/** The functions a visit announcement fans out to. B2B spans the whole ICX. */
function announceFunctions(fn: string): ("IGV" | "IGT" | "B2B")[] {
  if (fn === "IGV") return ["IGV", "B2B"];
  if (fn === "IGT") return ["IGT", "B2B"];
  return ["IGV", "IGT", "B2B"]; // B2B account
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
    (m.functions ?? []).some((f) => (fns as string[]).includes(f)) || memberIsB2B(m);

  // ---- calendar attendees (TL + VP as the spec describes) ----
  const attendees = new Set<string>();
  const vps = members.filter(
    (m) => m.role === "LCVP" && (m.functions ?? []).some((f) => (fns as string[]).includes(f))
  );
  if (responsible.role === "Member") {
    const tl = responsible.stakeholder_id ? byId.get(responsible.stakeholder_id) : null;
    if (tl?.role === "Team Leader" && tl.email) attendees.add(tl.email);
    for (const vp of vps) if (vp.email) attendees.add(vp.email);
  } else if (responsible.role === "Team Leader" || responsible.role === "Coordinator") {
    for (const vp of vps) if (vp.email) attendees.add(vp.email);
  }
  attendees.delete(responsible.email);

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
  }

  const inviteTo = [
    ...(responsible?.email ? [responsible.email] : []),
    ...recipients.attendeeEmails,
  ];

  // (a) PRIMARY — create a REAL Google Calendar event via the IM mailbox on the
  // shared "Sodio — LC Visits" calendar, with the responsible + TL/VP as
  // attendees and sendUpdates:"all". Google natively pushes it onto everyone's
  // calendar (auto-added for same-domain Workspace) and sends the invite. No
  // per-member OAuth grant needed. Requires the IM token's calendar scope.
  let calendarLinked = false;
  let inviteSent = false;
  const eventWithAttendees = { ...eventInput, attendees: inviteTo };
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

  // (b) FALLBACK — if the mailbox calendar path isn't available (token missing
  // calendar scope), email a real .ics invite (canonical multipart/alternative,
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
        organizerEmail: env.gmailSender || viewer.email,
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
      sendEmail({ to: [env.gmailSender || viewer.email], bcc: recipients.announceEmails, ...mail }).catch(
        (e) => console.error("[visits] announcement email failed:", e)
      );
    }
  }

  await logAudit(viewer.id, "schedule_visit", "account", accountId, {
    visitDate, visitTime, inviteSent, calendarLinked, announced: recipients.announceIds.length,
  });
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

  const { error } = await db()
    .from("visits")
    .update({ done, visit_comment: comment, next_step: nextStep || null })
    .eq("id", visitId);
  if (error) return fail(error.message);

  if (nextStep || nextStepDate) {
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
  for (const vp of (vps ?? []) as Member[]) recipients.set(vp.email.toLowerCase(), vp.email);
  const stakeholder = (responsible as { stakeholder?: Member } | null)?.stakeholder;
  // the LCP does not receive operational reports — that is the VP's concern
  if (stakeholder?.email && stakeholder.role !== "LCP")
    recipients.set(stakeholder.email.toLowerCase(), stakeholder.email);
  recipients.delete(viewer.email.toLowerCase());

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
  refresh(visit.account_id);
  return { ok: true };
}

// ================================================================== feedback

export async function submitFeedback(input: {
  type: "Bug" | "Enhancement" | "Other";
  message: string;
  page?: string;
  anonymous?: boolean;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!input.message?.trim()) return fail("Tell us what happened first 🙂");
  const { error } = await db().from("feedback").insert({
    member_id: input.anonymous ? null : viewer.id,
    anonymous: !!input.anonymous,
    type: input.type,
    message: input.message.trim(),
    page: input.page || null,
  });
  if (error) return fail(error.message);

  // straight to the IM director + IM coach inboxes
  const { feedbackEmail } = await import("@/lib/email/templates");
  const mail = feedbackEmail({
    memberName: input.anonymous ? "Anonymous member 🎭" : viewer.nickname || viewer.name,
    memberEmail: input.anonymous ? "hidden" : viewer.email,
    type: input.type,
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

/** Profile page: pick a fun avatar, upload your own, or fall back to the Google
 *  photo (null). Accepts an https image URL or a resized data:image/... upload
 *  (client-compressed to keep the row small). */
export async function updateAvatar(url: string | null): Promise<ActionResult> {
  const viewer = await getViewer();
  const clean = url?.trim() || null;
  if (clean) {
    const isHttps = /^https:\/\/\S+$/i.test(clean);
    const isDataImage = /^data:image\/(png|jpe?g|webp);base64,/i.test(clean);
    if (!isHttps && !isDataImage)
      return fail("The avatar must be an image link or an uploaded picture.");
    // ~400KB cap on uploaded images (the client already downscales to ~256px)
    if (isDataImage && clean.length > 550_000)
      return fail("That image is too large — pick a smaller one (it's downscaled automatically, so try again).");
  }
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

const memberSchema = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().trim().min(2, "Name is required."),
  nickname: z.string().trim().nullish(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => EMAIL_RE.test(v), "A valid email is required."),
  phone: phoneField,
  role: z.enum(MEMBER_ROLES as [MemberRole, ...MemberRole[]]),
  functions: z.array(z.enum(LC_FUNCTIONS as unknown as [string, ...string[]])),
  sub_functions: z.array(z.enum(SUB_FUNCTIONS as unknown as [string, ...string[]])),
  stakeholder_name: z.string().trim().nullish(),
  team_name: z.string().trim().nullish(),
  is_active: z.boolean(),
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

  const row = {
    name: m.name,
    nickname: m.nickname || null,
    email: m.email,
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
    const { error } = await db().from("members").update(row).eq("id", id);
    if (error) return fail(error.message);
  } else {
    const { data: created, error } = await db()
      .from("members")
      .upsert(row, { onConflict: "email" })
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
    targetId =
      (all ?? []).find(
        (x) =>
          x.id !== id &&
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
    .maybeSingle<{ id: string; email: string; name: string; nickname: string | null }>();
  if (!member) return fail("Member not found.");
  const { issueTempPassword } = await import("./password");
  const res = await issueTempPassword(member);
  if (!res.ok) return fail(res.error ?? "Couldn't issue the password.");
  await logAudit(viewer.id, "password_reset", "member", memberId);
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

// ================================================================== performance goals

const goalSchema = z.object({
  scope: z.enum(["function", "team"]),
  // goals are set per product lane — the IGT goal is DERIVED (IGTa + IGTe)
  function: z.enum(["IGV", "IGTa", "IGTe"]).nullish(),
  teamLeaderId: z.string().uuid().nullish(),
  target: z.number().int().min(1, "The goal must be at least 1 slot."),
  periodLabel: z.string().trim().min(2, "Name the period (e.g. July 2026 or Summer Peak 26)."),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** VPs (and the LCP) set the function goal; Team Leaders set their team goal.
 *  Shown on every member's dashboard as the shared target. */
export async function setPerformanceGoal(
  input: z.infer<typeof goalSchema>
): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const g = parsed.data;
  if (g.periodEnd < g.periodStart) return fail("The period ends before it starts.");

  const master = viewer.isAdmin || viewer.role === "LCP";
  if (g.scope === "function") {
    if (!g.function) return fail("Pick the lane for this goal.");
    const parentFn = g.function === "IGV" ? "IGV" : "IGT";
    const ownsFunction =
      (viewer.role === "LCVP" || viewer.role === "Director") &&
      viewer.functions.includes(parentFn);
    if (!master && !ownsFunction)
      return fail("Only the function's VP (or the LCP) sets the function goal.", "forbidden");
  } else {
    const teamLeaderId = g.teamLeaderId ?? viewer.id;
    const isOwnTeam = viewer.role === "Team Leader" && teamLeaderId === viewer.id;
    const isLeadOver =
      (viewer.role === "LCVP" || viewer.role === "Director") || master;
    if (!isOwnTeam && !isLeadOver)
      return fail("Only the Team Leader (or their VP/LCP) sets the team goal.", "forbidden");
    g.teamLeaderId = teamLeaderId;
  }

  // one goal per scope/key/period label — update in place if it exists
  let existing = db()
    .from("performance_goals")
    .select("id")
    .eq("scope", g.scope)
    .eq("period_label", g.periodLabel);
  existing =
    g.scope === "function"
      ? existing.eq("function", g.function!)
      : existing.eq("team_leader_id", g.teamLeaderId!);
  const { data: found } = await existing.maybeSingle<{ id: string }>();

  const row = {
    scope: g.scope,
    function: g.scope === "function" ? g.function : null,
    team_leader_id: g.scope === "team" ? g.teamLeaderId : null,
    target: g.target,
    period_label: g.periodLabel,
    period_start: g.periodStart,
    period_end: g.periodEnd,
    created_by: viewer.id,
  };
  const { error } = found
    ? await db().from("performance_goals").update(row).eq("id", found.id)
    : await db().from("performance_goals").insert(row);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "set_goal", "goal", null, { ...row });
  refresh();
  return { ok: true };
}

// ================================================================== bulk import

export interface ImportRowInput {
  function: "IGV" | "IGT" | "B2B";
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
  await getViewer(); // auth check up-front
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
    });
    if (res.ok) {
      created += 1;
      results.push({ name: row.name, ok: true });
    } else {
      results.push({ name: row.name, ok: false, error: res.error });
    }
  }
  refresh();
  return { ok: true, data: { results, created } };
}

// ================================================================== proposal drafts

const proposalSchema = z.object({
  accountId: z.string().uuid(),
  recipientName: z.string().trim().min(2, "Who is this proposal addressed to?"),
  recipientEmail: z
    .string()
    .trim()
    .refine((v) => EMAIL_RE.test(v), "A valid recipient email is required."),
  sector: z.string().trim().nullish(),
  customNote: z.string().trim().nullish(),
  attachmentsNote: z.string().trim().nullish(),
  /** attach the official per-product proposal PDF (proposals/<product>.pdf) */
  attachProposal: z.boolean().nullish(),
  /** B2B raises for the whole ICX — the email body is written for THIS product */
  bodyProduct: z.enum(["iGV", "iGTa", "iGTe"]).nullish(),
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
    accountId, recipientName, recipientEmail, sector, customNote,
    attachmentsNote, attachProposal, bodyProduct, attachProducts,
  } = parsed.data;

  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to work on this account.", "forbidden");

  if (!viewer.google_refresh_token)
    return fail(
      "Your Google access is missing — sign out, then sign in with Google once to grant it (it also powers your calendar reminders)."
    );

  // the email body is written for one product. B2B accounts raise for the whole
  // ICX, so the member picks which product the body targets.
  const product: "iGV" | "iGTa" | "iGTe" =
    account.function === "IGV"
      ? "iGV"
      : account.function === "IGT"
        ? account.product === "GTe" ? "iGTe" : "iGTa"
        : (bodyProduct ?? "iGV"); // B2B

  const { proposalDraft } = await import("@/lib/email/proposal");
  const draft = proposalDraft({
    product,
    companyName: account.name,
    recipientName,
    sector: sector || account.industry || account.sub_product || null,
    customNote: customNote || null,
    attachmentsNote: attachmentsNote || null,
    memberName: viewer.name,
    memberRole: `${viewer.role}${viewer.functions.length ? ` — ${viewer.functions.join(" & ")}` : ""}`,
    memberPhone: viewer.phone,
    memberEmail: viewer.email,
  });

  // which official PDFs to attach: B2B picks any of the three; others attach
  // just their own product's PDF when the switch is on
  const wanted: ("iGV" | "iGTa" | "iGTe")[] =
    account.function === "B2B"
      ? [...new Set(attachProducts ?? [])]
      : attachProposal
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
    sendEmail({ to: [viewer.email], bcc: targets.map((t) => t.email), ...mail }).catch(
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
