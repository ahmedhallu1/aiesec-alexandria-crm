"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import {
  canEditAccount,
  canEditRequestState,
  canEditTlComment,
  canEditVpComment,
  canManageBlacklist,
  canManageMembership,
  canReassignAccount,
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
import type { Member, Visit } from "@/lib/types";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | {
      ok: false;
      error: string;
      code?: "duplicate" | "blacklisted" | "next_step_required" | "forbidden";
      info?: Record<string, string | null>;
    };

const fail = (
  error: string,
  code?: "duplicate" | "blacklisted" | "next_step_required" | "forbidden",
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

// ================================================================== accounts

const createAccountSchema = z.object({
  function: z.enum(["IGV", "IGT"]),
  name: z.string().trim().min(2, "Account name is required"),
  product: z.enum(["GTa", "GTe"]).nullish(),
  sub_product: z.string().trim().nullish(),
  project: z.string().trim().nullish(),
  account_type: z.string().trim().nullish(),
  industry: z.string().trim().nullish(),
  package_plan: z.string().trim().nullish(),
  phone: z.string().trim().nullish(),
  email: z.string().trim().nullish(),
  social_link: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
  podio_link: z.string().trim().nullish(),
  responsible_id: z.string().uuid().nullish(),
});

export async function createAccount(
  input: z.infer<typeof createAccountSchema>
): Promise<ActionResult<{ id: string }>> {
  const viewer = await getViewer();
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const data = parsed.data;

  if (data.function === "IGT" && !data.product)
    return fail("Choose the product (Global Talent or Global Teacher).");
  if (data.function === "IGV" && !data.project)
    return fail("Choose the project for this IGV account.");

  // HARD RULE: unique account name across ALL ICX data + blacklist block
  const { duplicate, blacklisted } = await checkAccountName(data.name);
  if (blacklisted)
    return fail(
      `"${data.name}" is Black Listed and cannot be added.`,
      "blacklisted",
      {
        project: blacklisted.project,
        comments: blacklisted.comments,
        link: blacklisted.link,
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
      package_plan: data.package_plan || null,
      phone: data.phone || null,
      email: data.email || null,
      social_link: data.social_link || null,
      website: data.website || null,
      podio_link: data.podio_link || null,
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
  await logAudit(viewer.id, "create", "account", created.id, { name: data.name });
  refresh();
  return { ok: true, data: { id: created.id } };
}

const editableFields = z.object({
  phone: z.string().trim().nullish(),
  email: z.string().trim().nullish(),
  social_link: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
  podio_link: z.string().trim().nullish(),
  sub_product: z.string().trim().nullish(),
  project: z.string().trim().nullish(),
  account_type: z.string().trim().nullish(),
  industry: z.string().trim().nullish(),
  package_plan: z.string().trim().nullish(),
  proposal_sent: z.boolean().nullish(),
  requested_podio: z.boolean().nullish(),
  request_state: z.enum(["Checking", "Approved", "Rejected"]).nullish(),
  next_step: z.string().trim().nullish(),
  next_step_date: z.string().nullish(),
  next_step_time: z.string().nullish(),
  tl_comment: z.string().trim().nullish(),
  vp_comment: z.string().trim().nullish(),
  final_comment: z.string().trim().nullish(),
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
    if (key === "tl_comment" && !canEditTlComment(viewer, account))
      return fail("Only the TL, VP or LCP can edit the TL comment.", "forbidden");
    if (key === "vp_comment" && !canEditVpComment(viewer, account))
      return fail("Only the VP or LCP can edit the VP comment.", "forbidden");
    if (key === "request_state" && !canEditRequestState(viewer, account))
      return fail("Request State is set by the TL, Coordinator or VP.", "forbidden");
    update[key] = value === "" ? null : value;
  }
  if (Object.keys(update).length === 0) return { ok: true };

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
    return fail("Only the TL (within the team), VP or LCP can change responsibility.", "forbidden");

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
    (scope.kind === "function" && target.function === account.function) ||
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

/** Bringing an account back into process is a TL/VP/LCP override. */
export async function reviveAccount(accountId: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account || !canReassignAccount(viewer, account))
    return fail("Only the TL, VP or LCP can bring an account back into process.", "forbidden");
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

// ================================================================== contacts

const contactSchema = z.object({
  accountId: z.string().uuid(),
  method: z.enum(["Call", "WhatsApp", "Email"]),
  status: z.enum(["No Response", "Responded", "Interested", "Not Interested", "Wrong Contact"]),
  comment: z.string().trim().optional(),
  nextStep: z.string().trim().optional(),
  nextStepDate: z.string().optional(),
  nextStepTime: z.string().optional(),
});

export async function logContact(
  input: z.infer<typeof contactSchema>
): Promise<ActionResult<{ attempts: number; contactLimitReached: boolean }>> {
  const viewer = await getViewer();
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { accountId, method, status, comment, nextStep, nextStepDate, nextStepTime } = parsed.data;

  const account = await loadAccount(accountId);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to log contacts on this account.", "forbidden");
  if (account.out_of_process)
    return fail("This account is Out of Process. Ask your TL/VP to bring it back first.");

  // BUSINESS RULE: after a contact without a scheduled visit, the account must
  // carry a next step with a date (unless one is already set in the future).
  const hasPendingVisit = account.visit_id && account.visit_done === null;
  const hasFutureNextStep =
    account.next_step_date && account.next_step_date >= new Date().toISOString().slice(0, 10);
  if (!hasPendingVisit && !nextStepDate && !hasFutureNextStep) {
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

  // notify: function VP + the responsible's stakeholder (deduped)
  const [{ data: responsible }, { data: vps }] = await Promise.all([
    db().from("members").select("*, stakeholder:members!members_stakeholder_id_fkey(*)")
      .eq("id", visit.member_id).maybeSingle(),
    db().from("members").select("*").eq("role", "VP").eq("function", account.function).eq("is_active", true),
  ]);
  const recipients = new Map<string, string>();
  for (const vp of (vps ?? []) as Member[]) recipients.set(vp.email.toLowerCase(), vp.email);
  const stakeholder = (responsible as { stakeholder?: Member } | null)?.stakeholder;
  if (stakeholder?.email) recipients.set(stakeholder.email.toLowerCase(), stakeholder.email);
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

// ================================================================== blacklist

export async function addBlacklistEntry(input: {
  accountName: string;
  project?: string;
  comments?: string;
  link?: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canManageBlacklist(viewer))
    return fail("Only VPs and the LCP manage the blacklist.", "forbidden");
  if (!input.accountName?.trim()) return fail("Account name is required.");
  const { error } = await db().from("blacklist").insert({
    account_name: input.accountName.trim(),
    project: input.project?.trim() || null,
    comments: input.comments?.trim() || null,
    link: input.link?.trim() || null,
    added_by: viewer.id,
  });
  if (error)
    return fail(error.code === "23505" ? "This account is already black listed." : error.message);
  await logAudit(viewer.id, "blacklist_add", "blacklist", null, { name: input.accountName });
  refresh();
  return { ok: true };
}

export async function removeBlacklistEntry(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canManageBlacklist(viewer))
    return fail("Only VPs and the LCP manage the blacklist.", "forbidden");
  const { error } = await db().from("blacklist").delete().eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "blacklist_remove", "blacklist", id);
  refresh();
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
