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
  commentLabel,
  reassignTargetScope,
} from "@/lib/rbac";
import { checkAccountName, getViewer, logAudit, type PipelineRow } from "./data";
import { sendEmail } from "@/lib/google/gmail";
import { visitReportEmail } from "@/lib/email/templates";
import {
  createVisitEvent,
  deleteVisitEvent,
  updateVisitEvent,
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
  function: z.enum(["IGV", "IGT"]),
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

  // FUNCTION GATE: IGV-only members can't add IGT accounts and vice versa.
  if (!allowedAccountFunctions(viewer).includes(data.function))
    return fail(
      `You can only add ${allowedAccountFunctions(viewer).join(" / ") || "—"} accounts.`,
      "forbidden"
    );

  if (data.function === "IGT" && !data.product)
    return fail("Choose the product (Global Talent or Global Teacher).");

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
    const { data: owner } = await db()
      .from("members")
      .select("google_refresh_token")
      .eq("id", pending.member_id)
      .maybeSingle();
    await deleteVisitEvent(owner?.google_refresh_token ?? null, pending.calendar_event_id).catch(() => {});
  }
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
  await logAudit(viewer.id, "revive", "account", accountId);
  refresh(accountId);
  return { ok: true };
}

export async function markSlotRaised(
  accountId: string,
  slots: number
): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account.", "forbidden");
  const { error } = await db()
    .from("accounts")
    .update({
      slot_raised: true,
      slots_count: Math.max(1, Math.round(slots || 1)),
      slot_raised_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "slot_raised", "account", accountId, { slots });
  refresh(accountId);
  return { ok: true };
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
    "No Response", "Responded", "Interested", "Not Interested", "Wrong Contact", "Call Scheduled",
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
  const { accountId, method, status, comment, scheduledDate, scheduledTime } = parsed.data;
  let { nextStep, nextStepDate, nextStepTime } = parsed.data;

  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to log contacts on this account.", "forbidden");
  if (account.out_of_process)
    return fail("This account is archived (Out of Process). Ask your TL/VP to bring it back first.");

  // "Not Interested" closes the account: it is archived automatically
  const notInterested = status === "Not Interested";

  // "Call Scheduled" carries its own date + time and becomes the next step
  if (status === "Call Scheduled") {
    if (!scheduledDate || !scheduledTime)
      return fail("Pick the date and time of the scheduled call.");
    nextStep = nextStep || "Scheduled call";
    nextStepDate = scheduledDate;
    nextStepTime = scheduledTime;
  }

  // BUSINESS RULE: after a contact without a scheduled visit, the account must
  // carry a next step with a date (unless one is already set in the future).
  const hasPendingVisit = account.visit_id && account.visit_done === null;
  const hasFutureNextStep =
    account.next_step_date && account.next_step_date >= new Date().toISOString().slice(0, 10);
  if (!notInterested && !hasPendingVisit && !nextStepDate && !hasFutureNextStep) {
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
  if (error) return fail(error.message);

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

  if (nextStep || nextStepDate) {
    await db()
      .from("accounts")
      .update({
        next_step: nextStep || null,
        next_step_date: nextStepDate || null,
        next_step_time: nextStepTime || null,
      })
      .eq("id", accountId);
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

export async function scheduleVisit(
  input: z.infer<typeof visitSchema>
): Promise<ActionResult<{ calendarLinked: boolean }>> {
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

  const eventInput = {
    accountName: account.name,
    visitDate,
    visitTime,
    notes,
    detailsUrl: `${env.appUrl}/accounts/${accountId}`,
  };

  // reschedule if a pending visit exists, otherwise create
  const { data: pending } = await db()
    .from("visits")
    .select("*")
    .eq("account_id", accountId)
    .is("done", null)
    .maybeSingle<Visit>();

  let calendarLinked = false;
  try {
    if (pending) {
      if (pending.calendar_event_id) {
        await updateVisitEvent(responsible?.google_refresh_token ?? null, pending.calendar_event_id, eventInput);
        calendarLinked = true;
      } else {
        const id = await createVisitEvent(responsible?.google_refresh_token ?? null, eventInput);
        calendarLinked = !!id;
        if (id) await db().from("visits").update({ calendar_event_id: id }).eq("id", pending.id);
      }
      await db()
        .from("visits")
        .update({ visit_date: visitDate, visit_time: visitTime, followup_prompt_sent_at: null })
        .eq("id", pending.id);
    } else {
      const eventId = await createVisitEvent(responsible?.google_refresh_token ?? null, eventInput);
      calendarLinked = !!eventId;
      const { error } = await db().from("visits").insert({
        account_id: accountId,
        member_id: account.responsible_id,
        visit_date: visitDate,
        visit_time: visitTime,
        calendar_event_id: eventId,
      });
      if (error) return fail(error.message);
    }
  } catch (e) {
    console.error("[visits] calendar sync failed:", e);
    if (!pending) {
      const { error } = await db().from("visits").insert({
        account_id: accountId,
        member_id: account.responsible_id,
        visit_date: visitDate,
        visit_time: visitTime,
      });
      if (error) return fail(error.message);
    }
  }

  await logAudit(viewer.id, "schedule_visit", "account", accountId, { visitDate, visitTime });
  refresh(accountId);
  return { ok: true, data: { calendarLinked } };
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
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!input.message?.trim()) return fail("Tell us what happened first 🙂");
  const { error } = await db().from("feedback").insert({
    member_id: viewer.id,
    type: input.type,
    message: input.message.trim(),
    page: input.page || null,
  });
  if (error) return fail(error.message);

  // straight to the IM director + IM coach inboxes
  const { feedbackEmail } = await import("@/lib/email/templates");
  const mail = feedbackEmail({
    memberName: viewer.nickname || viewer.name,
    memberEmail: viewer.email,
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
  const { error } = await db()
    .from("members")
    .update({
      name: parsed.data.name,
      nickname: parsed.data.nickname,
      phone: parsed.data.phone,
      password_hash,
      profile_completed_at: new Date().toISOString(),
    })
    .eq("id", viewer.id);
  if (error) return fail(error.message);

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
    const ok = await bcrypt.compare(input.current ?? "", viewer.password_hash);
    if (!ok) return fail("Your current password is wrong. Forgot it? Ask the IM team to reset it.");
  }
  const password_hash = await bcrypt.hash(input.next, 10);
  const { error } = await db()
    .from("members")
    .update({ password_hash })
    .eq("id", viewer.id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "password_change", "member", viewer.id);
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

/** Clears the password so the member's next login (any password) re-runs the
 *  first-login onboarding where they set a new one. */
export async function resetMemberPassword(memberId: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canManageMembership(viewer))
    return fail("Only the EB and admins can reset passwords.", "forbidden");
  const { error } = await db()
    .from("members")
    .update({ password_hash: null, profile_completed_at: null })
    .eq("id", memberId);
  if (error) return fail(error.message);
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
  function: z.enum(["IGV", "IGT"]).nullish(),
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
    if (!g.function) return fail("Pick the function for this goal.");
    const ownsFunction =
      (viewer.role === "LCVP" || viewer.role === "Director") &&
      viewer.functions.includes(g.function);
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
  function: "IGV" | "IGT";
  name: string;
  product?: string | null;
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
      sub_product: row.sub_product ?? null,
      account_type: row.account_type ?? null,
      industry: row.industry ?? null,
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
