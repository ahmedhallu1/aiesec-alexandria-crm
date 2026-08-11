"use server";

import { revalidatePath } from "next/cache";
import { touchPointName } from "@/lib/touch-points";
import crypto from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import {
  accountFnTargets,
  accountScope,
  allowedAccountFunctions,
  canEditAccount,
  canEditRequestState,
  canManageMembership,
  canSeeLcConcerns,
  canCheckPodio,
  canSetRequestStateOnCreate,
  canUseAdminTools,
  canUseMailboxTab,
  canUseIgtExpectationMail,
  canReassignAccount,
  claimTargetFunction,
  isClaimableAccount,
  canManageArchive,
  commentLabel,
  master,
  reassignTargetScope,
} from "@/lib/rbac";
import {
  cairoDayIso, cascadeMemberRename, checkAccountName, getViewer, logAudit, type PipelineRow,
} from "./data";
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
  cleanPhone,
  EMAIL_RE,
  FEEDBACK_CATEGORIES,
  FEEDBACK_INBOX_EMAILS,
  guessEmailTag,
  DIRECT_VISIT_OUTCOMES,
  guessLinkTag,
  isKnownIrRole,
  irProductForMember,
  normalizeLcName,
  LC_FUNCTIONS,
  MEMBER_ROLES,
  normalizePhone,
  PHONE_RE,
  SUB_FUNCTIONS,
  VISIT_RESULTS,
  URL_RE,
} from "@/lib/types";
import type { AccountContact, AccountFunction, Member, MemberRole, Visit } from "@/lib/types";

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

/** Runs a bulk operation a few rows at a time (v33.10).
 *
 *  Bulk assign was STRICTLY sequential, and every row costs ~5 round trips to
 *  the database — load, snapshot, update, audit, revalidate. Fifty rows meant
 *  two hundred and fifty trips end to end, which is why assigning a selection
 *  "took too long in a weird way". Five at a time keeps the per-row RBAC and
 *  journaling exactly as they were and cuts the wall time by about five.
 *  Deliberately not unbounded: fifty parallel writes is how you exhaust a
 *  connection pool. */
async function inBatches<T, R>(
  items: T[],
  run: (item: T) => Promise<R>,
  size = 5
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  }
  return out;
}

function refresh(accountId?: string) {
  revalidatePath("/", "layout");
  if (accountId) revalidatePath(`/accounts/${accountId}`);
  // The dashboard's row read is SHARED between everyone with the same scope,
  // so expiring it here meant one member logging a contact made forty people
  // re-read four thousand rows. With the project near its CPU allowance that
  // is the single most expensive habit in the system, so the entry now lives
  // out its five minutes (v33.14). Account PAGES and lists are unaffected —
  // revalidatePath above still refreshes those immediately.
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
  /** v33.2 — people who hold Podio access may record what it said as they
   *  create the account. "Rejected" is deliberately not accepted here: it
   *  ARCHIVES an account, and an account that is born archived is a mistake,
   *  not a workflow. */
  request_state: z.enum(["Checking", "Approved"]).nullish(),
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

  // HARD RULE (v33.29): a name is unique WITHIN its world — ICX (IGV/IGT/B2B)
  // · BD · B2C — active or archived; another world's namesake never blocks
  // (the add dialog shows the info note instead)
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
          duplicate.responsible_name || "Unassigned",
      }
    );
  if (duplicate)
    return fail(
      `This account already exists on ${duplicate.function} accounts.`,
      "duplicate",
      {
        function: duplicate.function,
        responsible:
          duplicate.responsible_name || "Unassigned",
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

  // THE FUNCTION'S OWN DEFAULTS (v33.32, migration 0054) — the leader of this
  // function decides whether new accounts start on the Podio update cycle and
  // how often. Unset = the rule that shipped before: ON for IGV/B2C/BD.
  const fnSettings = await (
    await import("./function-settings")
  ).functionSettingsFor(data.function);

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
      request_state: canSetRequestStateOnCreate(viewer) ? data.request_state ?? null : null,
      responsible_id: responsibleId,
      created_by: viewer.id,
      // continuous Podio updates (v24): the function's own default since
      // v33.32 — always editable per account afterwards
      podio_update_enabled: fnSettings.podioUpdateDefault,
      podio_update_every_days: fnSettings.podioUpdateDays,
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
  // v33.19: a function change may target any of the five — the server
  // validates the pair against the VIEWER's own functions (accountFnTargets)
  function: z.enum(["IGV", "IGT", "B2B", "BD", "B2C"]).nullish(),
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
  if (!account) return fail("That account no longer exists.");
  // THE PODIO WORKLIST GRANT (v33.14) lets an MM sent to check a name record
  // BOTH Podio fields on an account that is not otherwise theirs — and
  // nothing else on it. `podioOnly` is that narrower door.
  const fullEdit = canEditAccount(viewer, account);
  const podioOnly = !fullEdit && canCheckPodio(viewer, account);
  if (!fullEdit && !podioOnly)
    return fail("You are not allowed to edit this account.", "forbidden");
  const parsed = editableFields.safeParse(patch);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const PODIO_FIELDS = ["requested_podio", "request_state"];
  const update: Record<string, unknown> = {};
  /** set when this save moves the account — its resets are applied last */
  let movedTo: AccountFunction | null = null;
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    if (podioOnly && !PODIO_FIELDS.includes(key))
      return fail("From the Podio queue you can only record what Podio said.", "forbidden");
    if (key === "request_state" && !canEditRequestState(viewer, account))
      return fail("Request State is set by the TL, Coordinator or VP.", "forbidden");
    if (key === "function") {
      // UNIVERSAL relabel (v33.19, generalizing v33.15's B2B↔BD): whoever
      // may edit the account and works BOTH functions may move it — an
      // IGV+IGT member flips between those two, LCP-level across all five.
      if (value === account.function || value == null) continue;
      const targets = accountFnTargets(viewer, account);
      if (!targets.includes(value as AccountFunction))
        return fail(
          "You can only move an account between functions YOU work.",
          "forbidden"
        );
      // 0034: the name must be re-checked in the TARGET world (its archive +
      // the opens blacklist) — B2B/IGV/IGT are the opens world, BD/B2C the
      // service world
      const check = await checkAccountName(account.name, value as AccountFunction, {
        excludeId: account.id,
      });
      if (check.duplicate)
        return fail(
          `"${account.name}" already exists ${
            check.duplicate.out_of_process ? "archived " : ""
          }in ${value}'s world — revive that one instead.`
        );
      if (check.blacklisted)
        return fail(
          `"${account.name}" is on the raising blacklist — it can't move there.`
        );
      update.function = value;
      // the RESETS are applied after the loop — the same save carries the
      // Details form's project/product/industry fields, and assigning them
      // here let a later iteration overwrite the reset (v33.19 review)
      movedTo = value as AccountFunction;
      continue;
    }
    update[key] = value === "" ? null : value;
  }
  // A FUNCTION MOVE OWNS ITS FIELDS (v33.19). fnSpecificReset clears what
  // belongs to the old function, and IGTe → IGV lands on the teaching
  // project — both must WIN over whatever the form submitted alongside the
  // move, so they are applied last.
  if (movedTo) {
    Object.assign(update, fnSpecificReset(movedTo));
    if (movedTo === "IGV" && account.function === "IGT" && account.product === "GTe")
      update.project = "Global Classroom";
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
  if (error)
    return fail(
      error.code === "23505"
        ? "That name is taken in the other world's archive — the flip was blocked."
        : error.message
    );
  // next step touched (or the account auto-archived) → keep the calendar
  // follow-up reminder in sync
  if (
    "next_step" in update || "next_step_date" in update ||
    "next_step_time" in update || "out_of_process" in update
  ) {
    await syncNextStepReminder(accountId);
  }
  await logAudit(viewer.id, "update", "account", accountId, {
    fields: Object.keys(update),
    ...("function" in update
      ? { function_from: account.function, function_to: update.function }
      : {}),
  });
  await stampWork(viewer.id, "account_updated"); // v29: counts towards working hours
  refresh(accountId);
  return { ok: true };
}

/** TAKE AN UNOWNED ACCOUNT FOR YOURSELF, from wherever you found it (v33.37).
 *  A thin wrapper over the reassign path (target = self), so a Member who
 *  researched a name and hit the "already exists, nobody owns it" verdict can
 *  claim it from THAT dialog instead of being sent to a page they may not
 *  even be able to open. All the reassign rules re-run inside. */
export async function claimAccountForSelf(
  accountId: string
): Promise<ActionResult<{ slug: string }>> {
  const viewer = await getViewer();
  const res = await reassignAccount(accountId, viewer.id);
  if (!res.ok) return res;
  const { data: row } = await db()
    .from("accounts")
    .select("name")
    .eq("id", accountId)
    .maybeSingle<{ name: string }>();
  return { ok: true, data: { slug: row ? accountSlug(row.name) : accountId } };
}

export async function reassignAccount(
  accountId: string,
  newResponsibleId: string,
  opts?: { skipRefresh?: boolean }
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
  // an UNOWNED account is nobody's to lose, so distributing it may cross
  // functions — the account then follows its new owner (v33.18)
  const distributingUnowned = account.responsible_id == null;
  const inScope =
    claimingForSelf ||
    scope.kind === "all" ||
    (scope.kind === "functions" && (targetInFunction || distributingUnowned)) ||
    (scope.kind === "members" && scope.ids.includes(target.id));
  if (!inScope) return fail("You can only reassign to members in your scope.", "forbidden");

  // AN ACCOUNT FOLLOWS ITS NEW OWNER (v32.6, widened v33.9).
  //
  // Claiming an unowned account moved it into the claimer's function already.
  // The same has to be true of a REVIVED one and of any hand-over across
  // functions: an IGT account brought back by an IGV MM is an IGV account
  // now, or it lands in a function its new owner can't even open. The
  // destination is the TARGET's function, not the mover's — handing a company
  // to IGT should file it under IGT.
  const targetFns = [
    ...(target.functions ?? []),
    ...(target.sub_functions ?? []),
  ].filter((f) => ["IGV", "IGT", "B2B", "BD", "B2C"].includes(f));
  // v33.18 — ANY cross-function hand-over moves it, not just claims and
  // revives. Leaving an account in a function its new owner can't open was
  // the bug: it vanished from their list and kept counting on the old
  // function's dashboard. If the target doesn't work the account's function
  // but does work a raising one, the account moves to theirs.
  const movedFn = claimingForSelf
    ? claimTargetFunction(viewer, account)
    : !targetInFunction && targetFns.length > 0
      ? (targetFns[0] as typeof account.function)
      : null;
  const fnChanged = !!movedFn && movedFn !== account.function;

  await snapshotForUndo("accounts", accountId);
  const { error } = await db()
    .from("accounts")
    .update({
      responsible_id: newResponsibleId,
      ...(fnChanged ? { function: movedFn, ...fnSpecificReset(movedFn!) } : {}),
      // IGTe → IGV carries a sensible default (v33.19): Global Classroom is
      // the teaching project, the natural landing for a GTe company. Every
      // other direction leaves the new function's fields for the owner to
      // pick (an IGV→IGT mover chooses GTa/GTe themselves).
      ...(fnChanged && movedFn === "IGV" && account.function === "IGT" && account.product === "GTe"
        ? { project: "Global Classroom" }
        : {}),
    })
    .eq("id", accountId);
  if (error)
    return fail(
      // moving across the name WORLDS (0034: BD/B2C vs the opens side) can
      // collide with an archived namesake there
      error.code === "23505"
        ? `"${account.name}" already exists in ${movedFn}'s world (probably archived) — revive that one instead.`
        : error.message
    );
  await logAudit(viewer.id, "reassign", "account", accountId, {
    from: account.responsible_id,
    to: newResponsibleId,
    ...(fnChanged ? { function_from: account.function, function_to: movedFn } : {}),
  });
  if (!opts?.skipRefresh) refresh(accountId);
  return { ok: true };
}

/** Fields that only mean something inside ONE function, cleared when an
 *  account moves to another (v33.6).
 *
 *  An IGV account carries a Project ("Skill Up!"); an IGT one carries a
 *  product (GTa/GTe) and a sub-product. Claiming an IGV account into IGT left
 *  the IGV project on it, so the account showed one function's badge and
 *  another function's details — which is what made a claimed account look
 *  like it was still in the function the claimer has no access to. */
function fnSpecificReset(fn: string): Record<string, null> {
  return {
    ...(fn === "IGV" ? {} : { project: null }),
    ...(fn === "IGT" ? {} : { product: null, sub_product: null }),
    ...(fn === "B2C" ? {} : {}),
  };
}

/** MOVE an account to another function (v33.6).
 *
 *  Only for someone who works BOTH sides — the LCP/admin, or a leader of two
 *  functions, which happens for real (an OGT VP taking OGV as well). Anyone
 *  else moving an account would be pushing it out of their own sight.
 *  Function-specific fields are cleared, exactly as on a cross-function
 *  claim. */
export async function moveAccountFunction(
  accountId: string,
  toFunction: string
): Promise<ActionResult> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account) return fail("That account no longer exists.");
  const allowed = allowedAccountFunctions(viewer);
  if (!canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account.", "forbidden");
  // an ARCHIVED account can be moved out of any function — that is the whole
  // point of reviving it into the one that can actually sell to them (v33.8)
  if (
    !account.out_of_process &&
    !allowed.includes(account.function as (typeof allowed)[number])
  )
    return fail("You can only move an account out of a function you work.", "forbidden");
  if (!allowed.includes(toFunction as (typeof allowed)[number]))
    return fail("You can only move an account into a function you work.", "forbidden");
  if (toFunction === account.function) return { ok: true };

  await snapshotForUndo("accounts", accountId);
  const { error } = await db()
    .from("accounts")
    .update({ function: toFunction, ...fnSpecificReset(toFunction) })
    .eq("id", accountId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "move_function", "account", accountId, {
    from: account.function,
    to: toFunction,
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
  await stampWork(viewer.id, "account_archived"); // v33.18
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
      `"${cleanName}" exists in the active accounts (${duplicate.function}, ${duplicate.responsible_name || "Unassigned"}) — mark it Out of Process from its page instead.`,
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

/** Upload safety (v33 audit, F-17).
 *
 *  Contracts and CVs deliberately accept "any format" — the crew scans things
 *  with whatever they have. But a handful of extensions are ACTIVE CONTENT: an
 *  .html or .svg stored in a bucket and later opened from a signed URL runs
 *  script on the storage origin, which is a convincing phishing surface even
 *  though it can't reach this app's cookies (different origin). Executables
 *  have no business here at all.
 *
 *  A denylist, not an allowlist, on purpose: the legitimate set is genuinely
 *  open-ended (pdf, docx, xlsx, jpg, png, heic, zip, pages, odt…) and an
 *  allowlist would reject real contracts and send people back to WhatsApp. */
const UNSAFE_UPLOAD_EXTENSIONS = new Set([
  "html", "htm", "xhtml", "shtml", "svg", "xml", "xsl",
  "js", "mjs", "cjs", "jsx", "ts", "vbs", "ps1", "sh", "bash",
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "jar", "app", "dmg",
  "dll", "so", "deb", "rpm", "apk", "hta", "chm", "reg", "iso",
]);

/** Returns an error message when the file must not be stored, else null. */
function unsafeUploadReason(name: string): string | null {
  const clean = (name ?? "").trim().toLowerCase();
  if (!clean) return "That file has no name.";
  // a double extension ("cv.pdf.html") is the classic bypass — check the LAST
  const ext = clean.includes(".") ? clean.split(".").pop()! : "";
  if (!ext) return `"${name}" has no file extension — rename it and try again.`;
  if (UNSAFE_UPLOAD_EXTENSIONS.has(ext))
    return `".${ext}" files can't be uploaded — they can run code when opened. Save it as a PDF or an image instead.`;
  return null;
}

/** ATTACHMENTS ON FEEDBACK (v33.13).
 *
 *  A bug report is usually a screenshot, and a concern about a person is often
 *  evidence — both were being described in prose because there was nowhere to
 *  put the file. Same signed-URL flow as contracts and CVs: the bytes go
 *  browser → private bucket, never through the server (Vercel caps an action
 *  body at ~4.5 MB), and the same extension guard applies.
 *
 *  Anyone signed in may attach to their OWN feedback — that is the whole
 *  point of feedback — so the only gate is a real session. */
const FEEDBACK_MAX_FILES = 5;
const FEEDBACK_MAX_SIZE = 10 * 1024 * 1024;

export async function requestFeedbackUploads(
  files: { name: string; type: string; size: number }[]
): Promise<ActionResult<{ uploads: { path: string; signedUrl: string; name: string }[] }>> {
  const viewer = await getViewer();
  if (!viewer?.id) return fail("Sign in first.", "forbidden");
  if (files.length === 0) return fail("Pick a file first.");
  if (files.length > FEEDBACK_MAX_FILES)
    return fail(`At most ${FEEDBACK_MAX_FILES} files per message.`);
  for (const f of files) {
    if (f.size > FEEDBACK_MAX_SIZE)
      return fail(`"${f.name}" is over 10 MB — a screenshot shouldn't be.`);
    const unsafe = unsafeUploadReason(f.name);
    if (unsafe) return fail(unsafe);
  }

  const uploads: { path: string; signedUrl: string; name: string }[] = [];
  for (const f of files) {
    const safeName = f.name.replace(/[^\w.\- ()]+/g, "_").slice(-80);
    const path = `${viewer.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const { data, error } = await db().storage.from("feedback").createSignedUploadUrl(path);
    if (error || !data) {
      if (error?.message?.toLowerCase().includes("bucket"))
        return fail("Feedback storage isn't set up yet — run migration 0042.");
      return fail(error?.message ?? "Could not prepare the upload — try again.");
    }
    uploads.push({ path: data.path, signedUrl: data.signedUrl, name: safeName });
  }
  return { ok: true, data: { uploads } };
}

/** A 10-minute link to an attachment — inbox owners and the author. */
export async function getFeedbackFileUrl(path: string): Promise<ActionResult<{ url: string }>> {
  const viewer = await getViewer();
  if (!viewer?.id) return fail("Sign in first.", "forbidden");
  // a path always starts with the author's id, so this is cheap to check
  const ownPath = path.startsWith(`${viewer.id}/`);
  const { canSeeFeedbackInbox } = await import("@/lib/rbac");
  if (!ownPath && !canSeeFeedbackInbox(viewer) && !canSeeLcConcerns(viewer))
    return fail("Not yours to open.", "forbidden");
  const { data, error } = await db().storage.from("feedback").createSignedUrl(path, 600);
  if (error || !data) return fail(error?.message ?? "Could not open the file.");
  return { ok: true, data: { url: data.signedUrl } };
}

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
    const unsafe = unsafeUploadReason(f.name);
    if (unsafe) return fail(unsafe);
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
    .select("id, name, is_active")
    .eq("id", memberId)
    .maybeSingle<{ id: string; name: string; is_active: boolean }>();
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
  return { ok: true, data: { name: target.name, mode } };
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

  // v33 — TOUCH POINTS + ATTENDANCE, so the attendance feature can actually be
  // exercised. Marked with the 🧪 prefix and removed by "Remove test data",
  // exactly like the accounts.
  const tpCreated = await seedTestTouchPoints(real);

  await logAudit(real.id, "test_seed", "system", null, { created, touchPoints: tpCreated });
  refresh();
  return { ok: true, data: { created: created + tpCreated } };
}

/** Admin: removes every test account (children cascade). */

/** Marks a seeded touch point. Kept in the NOTE because touch_points has no
 *  is_test column and adding one would touch the attendance engine's queries. */
const TEST_TP_TAG = "🧪 test —";

/** Seeds touch points AND their attendance so the whole attendance flow can be
 *  exercised without waiting for a real meeting (v33):
 *
 *    · one PAST meeting, fully recorded — attended / absent / late / excused,
 *      so the history, the filters and the appeal button all have something;
 *    · one PAST meeting with NOTHING recorded — this is the one that drives
 *      the reminder ladder and the blocking prompt;
 *    · one PAST working-hours session, left unconfirmed so the AI pre-fill and
 *      the "review & confirm" step are visible;
 *    · one UPCOMING virtual meeting, so the Meet link and the RSVP path can be
 *      tried end to end.
 *
 *  Everything is scoped to the admin's own team-mates, so no real member is
 *  marked absent in a meeting that never happened. */
async function seedTestTouchPoints(real: { id: string; name: string }): Promise<number> {
  const { data: crew } = await db()
    .from("members")
    .select("id, name, functions, sub_functions")
    .eq("is_active", true)
    .limit(6);
  const people = (crew ?? []) as { id: string }[];
  if (people.length === 0) return 0;

  const day = (offset: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const points = [
    { kind: "meeting", starts_at: day(-7, 19), note: `${TEST_TP_TAG} recorded meeting`, record: true, virtual: false },
    { kind: "meeting", starts_at: day(-2, 19), note: `${TEST_TP_TAG} meeting nobody recorded`, record: false, virtual: false },
    { kind: "working_hours", starts_at: day(-1, 16), note: `${TEST_TP_TAG} working hours (unconfirmed)`, record: false, virtual: false },
    { kind: "meeting", starts_at: day(3, 19), note: `${TEST_TP_TAG} virtual meeting (RSVP)`, record: false, virtual: true },
  ];

  const statuses = ["attended", "absent", "late", "excused"];
  let made = 0;
  for (const p of points) {
    const { data: tp } = await db()
      .from("touch_points")
      .insert({
        scope: "team",
        kind: p.kind,
        function_key: null,
        team_name: null,
        starts_at: p.starts_at,
        note: p.note,
        invited_teams: [],
        invited_functions: [],
        owner_id: real.id,
        owner_name: real.name,
        announced: false,
        virtual: p.virtual,
        ...(p.record ? { attendance_recorded_at: new Date().toISOString() } : {}),
      })
      .select("id")
      .single<{ id: string }>();
    if (!tp) continue;
    made += 1;
    if (!p.record) continue;
    await db().from("touch_point_attendance").insert(
      people.map((m, i) => ({
        touch_point_id: tp.id,
        member_id: m.id,
        status: statuses[i % statuses.length],
        source: "manual",
        note: statuses[i % statuses.length] === "excused" ? "Test excuse" : null,
      }))
    );
  }
  return made;
}

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
  // the seeded touch points go too — attendance rows cascade with them
  await db().from("touch_points").delete().like("note", `${TEST_TP_TAG}%`);
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
  let emailed = false;
  const results = await inBatches(ids, (id) =>
    reassignAccount(id, responsibleId, { skipRefresh: true })
  );
  const doneIds = ids.filter((_, i) => results[i].ok);
  const done = doneIds.length;
  const failed = ids.length - done;
  // ONE revalidation for the whole batch instead of one per row
  refresh();

  if (notifyByEmail && doneIds.length > 0) {
    try {
      const viewer = await getViewer();
      const [{ data: target }, { data: accounts }] = await Promise.all([
        db()
          .from("members")
          .select("id, name, email, role")
          .eq("id", responsibleId)
          .maybeSingle<{ id: string; name: string; email: string | null; role: string }>(),
        db().from("accounts").select("name").in("id", doneIds).order("name"),
      ]);
      // assigning accounts to YOURSELF needs no heads-up
      if (target && target.id !== viewer.id) {
        const names = ((accounts ?? []) as { name: string }[]).map((a) => a.name);
        const { notifyMembers } = await import("./notify");
        await notifyMembers(
          [target.id],
          "broadcast",
          `📋 ${viewer.name} assigned you ${names.length} account${names.length === 1 ? "" : "s"}`,
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
            memberName: target.name,
            managerName: viewer.name,
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

/** EDIT a logged contact attempt (v33.19) — a wrong click shouldn't need the
 *  IM team. Author or LCP-level only; edits NEVER re-fire side effects (no
 *  archive on Not Interested, no visit booking on Visit Scheduled — those
 *  belong to logContact), so status may not move to/from "Visit Scheduled". */
export async function updateContactAttempt(
  attemptId: string,
  patch: { method?: string; status?: string; comment?: string | null }
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { data: attempt } = await db()
    .from("contact_attempts")
    .select("id, account_id, member_id, method, status")
    .eq("id", attemptId)
    .maybeSingle<{ id: string; account_id: string; member_id: string; method: string; status: string }>();
  if (!attempt) return fail("That contact log no longer exists.");
  const account = await loadAccount(attempt.account_id);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account's logs.", "forbidden");
  const lcpLevel = accountScope(viewer).kind === "all";
  if (attempt.member_id !== viewer.id && !lcpLevel)
    return fail("Only whoever logged this contact (or the LCP) can edit it.", "forbidden");
  const update: Record<string, unknown> = {};
  if (patch.method !== undefined) {
    if (!["Call", "WhatsApp", "Email"].includes(patch.method)) return fail("Pick a real method.");
    update.method = patch.method;
  }
  if (patch.status !== undefined) {
    const ok = ["No Response", "Waiting for response", "Responded", "Interested", "Wrong Contact"];
    if (!ok.includes(patch.status))
      return fail("That result can't be set from an edit — archive/visit results are set by logging a contact.");
    if (attempt.status === "Visit Scheduled" || attempt.status === "Not Interested")
      return fail("This log carries a side effect (visit/archive) — it can't be rewritten.");
    update.status = patch.status;
  }
  if (patch.comment !== undefined) update.comment = patch.comment?.trim() || null;
  if (Object.keys(update).length === 0) return { ok: true };
  await snapshotForUndo("contact_attempts", attemptId);
  const { error } = await db().from("contact_attempts").update(update).eq("id", attemptId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "contact_edit", "account", attempt.account_id, {
    attempt: attemptId, fields: Object.keys(update),
  });
  refresh(attempt.account_id);
  return { ok: true };
}

/** EDIT a comment's text (v33.19). Author or LCP-level; the label/number and
 *  pin state stay — only the words change. */
export async function updateComment(
  commentId: string,
  body: string
): Promise<ActionResult> {
  const viewer = await getViewer();
  const clean = body?.trim();
  if (!clean) return fail("The comment can't be empty — archive it instead.");
  const { data: comment } = await db()
    .from("account_comments")
    .select("id, account_id, member_id")
    .eq("id", commentId)
    .maybeSingle<{ id: string; account_id: string; member_id: string | null }>();
  if (!comment) return fail("That comment no longer exists.");
  const account = await loadAccount(comment.account_id);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account's comments.", "forbidden");
  const lcpLevel = accountScope(viewer).kind === "all";
  if (comment.member_id !== viewer.id && !lcpLevel)
    return fail("Only the comment's author (or the LCP) can edit it.", "forbidden");
  await snapshotForUndo("account_comments", commentId);
  const { error } = await db().from("account_comments").update({ body: clean }).eq("id", commentId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "comment_edit", "account", comment.account_id, { comment: commentId });
  refresh(comment.account_id);
  return { ok: true };
}

/** EDIT a deal's details (v33.19): note, amount, benefits — and its OPENS,
 *  which recomputes the account's counters from the sum of all its deals.
 *  Opens edits are refused when the deal carries a CUSTOM multi-member split
 *  (rewriting someone else's attribution needs a re-record, not an edit). */
export async function updateDeal(
  dealId: string,
  patch: {
    slotsIgv?: number; slotsIgta?: number; slotsIgte?: number;
    amount?: number | null; benefits?: string | null; note?: string | null;
  }
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { data: deal } = await db()
    .from("deals")
    .select("*, allocations:deal_allocations(id, member_id, slots_igv, slots_igta, slots_igte)")
    .eq("id", dealId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .maybeSingle<any>();
  if (!deal) return fail("That deal no longer exists.");
  const account = await loadAccount(deal.account_id);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to edit this account's deals.", "forbidden");
  const lcpLevel = accountScope(viewer).kind === "all";
  const isLead = viewer.role === "LCVP" || viewer.role === "Director";
  if (deal.member_id !== viewer.id && !lcpLevel && !isLead)
    return fail("Only the deal's owner, their leaders or the LCP can edit it.", "forbidden");

  const update: Record<string, unknown> = {};
  if (patch.note !== undefined) update.note = patch.note?.trim() || null;
  if (patch.benefits !== undefined) update.benefits = patch.benefits?.trim() || null;
  if (patch.amount !== undefined) {
    if (patch.amount !== null && (!Number.isFinite(patch.amount) || patch.amount < 0))
      return fail("The amount must be a positive number (EGP).");
    update.amount = patch.amount;
  }
  const editingOpens =
    patch.slotsIgv !== undefined || patch.slotsIgta !== undefined || patch.slotsIgte !== undefined;
  if (editingOpens) {
    const allocs = (deal.allocations ?? []) as { id: string }[];
    if (allocs.length > 1)
      return fail(
        "This deal's opens are SPLIT across members — edit by deleting nothing: record a corrective deal instead."
      );
    const igv = Math.max(0, Math.trunc(patch.slotsIgv ?? deal.slots_igv ?? 0));
    const igta = Math.max(0, Math.trunc(patch.slotsIgta ?? deal.slots_igta ?? 0));
    const igte = Math.max(0, Math.trunc(patch.slotsIgte ?? deal.slots_igte ?? 0));
    const total = igv + igta + igte;
    if (total <= 0 && account.function !== "B2C" && account.function !== "BD")
      return fail("A deal needs at least one open.");
    update.slots_igv = igv;
    update.slots_igta = igta;
    update.slots_igte = igte;
    update.slots = Math.max(total, account.function === "B2C" || account.function === "BD" ? 0 : 1);
  }
  if (Object.keys(update).length === 0) return { ok: true };

  await snapshotForUndo("deals", dealId);
  const { error } = await db().from("deals").update(update).eq("id", dealId);
  if (error) return fail(error.message);

  if (editingOpens) {
    // keep the single default allocation in lockstep with the deal
    const allocs = (deal.allocations ?? []) as { id: string }[];
    if (allocs.length === 0) {
      // pre-0018 deals carry no allocation row, so edited opens would land in
      // the lane totals and in NOBODY's personal numbers (every per-member
      // read is allocation-attributed). Create the default 100% row the way
      // recordDeal does (v33.19 review).
      const owner = deal.member_id ?? account.responsible_id;
      if (owner)
        await db().from("deal_allocations").insert({
          deal_id: dealId,
          member_id: owner,
          slots_igv: update.slots_igv,
          slots_igta: update.slots_igta,
          slots_igte: update.slots_igte,
        });
    } else if (allocs.length === 1) {
      await db()
        .from("deal_allocations")
        .update({
          slots_igv: update.slots_igv, slots_igta: update.slots_igta, slots_igte: update.slots_igte,
        })
        .eq("id", allocs[0].id);
    }
    // the account's counters are DERIVED — recompute from the sum of deals
    const { data: sums } = await db()
      .from("deals")
      .select("slots, slots_igv, slots_igta, slots_igte")
      .eq("account_id", deal.account_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = (sums ?? []) as any[];
    const agg = (k: string) => all.reduce((n, d) => n + (d[k] ?? 0), 0);
    await db()
      .from("accounts")
      .update({
        slots_count: agg("slots"),
        slots_igv_count: agg("slots_igv"),
        slots_igta_count: agg("slots_igta"),
        slots_igte_count: agg("slots_igte"),
        deals_count: all.length,
      })
      .eq("id", deal.account_id);
  }
  await logAudit(viewer.id, "deal_edit", "account", deal.account_id, {
    deal: dealId, fields: Object.keys(update),
  });
  refresh(deal.account_id);
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
    "No Response", "Waiting for response", "Responded", "Interested", "Not Interested",
    "Wrong Contact", "Visit Scheduled",
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
        "The database is missing a contact-result value — run migrations 0007 and 0043 in the Supabase SQL editor (each ends with a schema reload)."
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
  // "Waiting for response" is NOT an answer — a WhatsApp/Email-only history
  // must still trip the 3-contacts prompt (matches the view's
  // no_response_attempts filter since migration 0043)
  // eslint-disable-next-line prefer-const
  let { count: answered, error: answeredErr } = await db()
    .from("contact_attempts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .not("status", "in", '("No Response","Waiting for response")');
  if (answeredErr) {
    // pre-0043 DB: the new literal can't be cast to the enum and the WHOLE
    // query errors — falling back keeps the prompt honest instead of firing
    // "3 contacts without an answer" on accounts that answered
    ({ count: answered } = await db()
      .from("contact_attempts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .neq("status", "No Response"));
  }

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

/** How long after a booking a correction still counts as part of it, rather
 *  than as news of its own (v33.23). Fifteen minutes: long enough to cover
 *  "wrong time, fix it" and short enough that a real move next week is
 *  announced properly. */
const ANNOUNCE_GRACE_MS = 15 * 60_000;

/** WHOSE LEADERS RIDE THE CALENDAR INVITE — unchanged. B2B/BD raise for IGV
 *  and IGT, so their VP stays on an IGV/IGT visit invite for oversight. */
function leaderShareFunctions(fn: string): ("IGV" | "IGT" | "B2B" | "B2C")[] {
  if (fn === "IGV") return ["IGV", "B2B"];
  if (fn === "IGT") return ["IGT", "B2B"];
  if (fn === "B2C") return ["B2C"]; // its own island (v23)
  return ["B2B"];
}

/** WHO THE ANNOUNCEMENT GOES TO — the account's OWN function, and nothing
 *  else (v33.23, the LCP: "every function on its own").
 *
 *  It used to widen IGV and IGT to include B2B, on the theory that B2B raises
 *  for them. In practice that meant the B2B crew was told about every IGV and
 *  IGT visit in the LC — mail they cannot act on, which is how people learn to
 *  ignore the mail that matters. B2B and BD stay ONE crew here, exactly as
 *  memberIsB2B treats them everywhere else. */
function announceFunctions(fn: string): ("IGV" | "IGT" | "B2B" | "B2C")[] {
  if (fn === "IGV") return ["IGV"];
  if (fn === "IGT") return ["IGT"];
  if (fn === "B2C") return ["B2C"];
  return ["B2B"]; // B2B/BD account → the B2B/BD crew (memberIsB2B matches both)
}

/** Works out who the visit is shared with:
 *  - calendar attendees (Google invite): the responsible's TL (if a Member) and
 *    the function VP(s); TL/Coordinator → just the VP(s). Raising only.
 *  - announcement crew: the account's OWN raising function (email + in-app
 *    notification), minus the responsible & the scheduler.
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

  // TWO AUDIENCES, TWO LISTS (v33.23). They used to share one `fns`, so
  // narrowing the announcement would have silently dropped the B2B VP off
  // IGV/IGT calendar invites too.
  const shareFns = leaderShareFunctions(account.function) as string[];
  const announceFns = announceFunctions(account.function) as string[];
  const inFns = (fns: string[], m: Row) =>
    (m.functions ?? []).some((f) => fns.includes(f)) ||
    // B2B may live in sub-functions; same for B2C — but ONLY when that
    // function is actually part of this list
    (fns.includes("B2B") && memberIsB2B(m)) ||
    (fns.includes("B2C") && rowIsB2C(m));

  // ---- calendar attendees (TL + VP as the spec describes) ----
  const attendees = new Set<string>();
  const vps = members.filter((m) => m.role === "LCVP" && inFns(shareFns, m));
  if (responsible.role === "Member") {
    const tl = responsible.stakeholder_id ? byId.get(responsible.stakeholder_id) : null;
    if (tl?.role === "Team Leader" && tl.email) attendees.add(tl.email);
    for (const vp of vps) if (vp.email) attendees.add(vp.email);
  } else if (responsible.role === "Team Leader" || responsible.role === "Coordinator") {
    for (const vp of vps) if (vp.email) attendees.add(vp.email);
  }
  if (responsible.email) attendees.delete(responsible.email);

  // ---- announcement crew: the account's OWN raising function ----
  const announceIds: string[] = [];
  const announceEmails: string[] = [];
  for (const m of members) {
    if (m.role === "LCP") continue; // the LCP never gets operational mail
    if (m.id === responsible.id || m.id === viewerId) continue; // they get the direct notice
    if (!inFns(announceFns, m) || !isRaisingMember(m)) continue;
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

  // ONE BOOKING, ONE ANNOUNCEMENT (v33.23).
  //
  // The fan-out used to fire on EVERY call, with no idea whether this was a
  // new booking, a correction or the exact same slot submitted again. Both
  // failure modes were live in production:
  //   · "I Can Read Academy" — booked 18:43, corrected to a different time
  //     18:44. Two "📢 New visit booked" mails and 40 bell rows for one visit.
  //   · "Softa software solutions" — the same slot re-submitted three times
  //     inside 30 seconds. Three identical mails, 63 bell rows, nothing moved.
  //
  // So: a repeat of the same slot is never news; a correction made while the
  // first mail is still being read is not news either (the responsible's own
  // bell and the Google invite both carry the new time); a genuine move days
  // later IS news, and gets said in those words.
  const sameSlot =
    !!pending &&
    pending.visit_date === visitDate &&
    (pending.visit_time ?? "").slice(0, 5) === visitTime.slice(0, 5);
  const justAnnounced =
    !!pending &&
    Date.now() - new Date(pending.created_at).getTime() < ANNOUNCE_GRACE_MS;
  const announce = !pending || (!sameSlot && !justAnnounced);
  const announceAsMove = announce && !!pending;

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

  // function-wide fan-out: the account's OWN raising crew get an FYI email AND
  // an in-app notification (no calendar reminder for them)
  if (announce && recipients.announceIds.length > 0) {
    const responsibleName =
      responsible?.name || account.responsible_name;
    await notifyMembers(
      recipients.announceIds,
      "visit_announcement",
      announceAsMove
        ? `🗓️ ${product} visit moved — ${account.name}`
        : `📢 New ${product} visit — ${account.name}`,
      announceAsMove
        ? `${responsibleName} moved the visit with ${account.name} to ${visitDate} at ${visitTime.slice(0, 5)}.`
        : `${responsibleName} booked a visit with ${account.name} on ${visitDate} at ${visitTime.slice(0, 5)}.`,
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
        moved: announceAsMove,
      });
      sendEmail({ to: [env.gmailSender || viewer.email || ""].filter(Boolean), bcc: recipients.announceEmails, ...mail }).catch(
        (e) => console.error("[visits] announcement email failed:", e)
      );
    }
  }

  await logAudit(viewer.id, "schedule_visit", "account", accountId, {
    visitDate, visitTime, inviteSent, calendarLinked,
    // the real number — the log used to claim a fan-out that may not have run
    announced: announce ? recipients.announceIds.length : 0,
    ...(pending ? { rescheduled: true, announcedAsMove: announceAsMove } : {}),
  });
  await stampWork(viewer.id, "visit_scheduled"); // v29: counts towards working hours
  refresh(accountId);
  return { ok: true, data: { inviteSent, calendarLinked, sharedCount: recipients.attendeeEmails.length } };
}

// ================================================== the mailbox (v33.24)

async function mailboxSender(): Promise<
  | { error: ActionResult<never> }
  | { viewer: Viewer; token: string; signature: string }
> {
  const viewer = await getViewer();
  if (!canUseMailboxTab(viewer))
    return { error: fail("The Emails tab is for MMs and above.", "forbidden") };
  const { data: me } = await db()
    .from("members")
    .select("google_refresh_token, email, phone, role, functions")
    .eq("id", viewer.id)
    .maybeSingle<{
      google_refresh_token: string | null;
      email: string | null;
      phone: string | null;
      role: string;
      functions: string[] | null;
    }>();
  if (!me?.google_refresh_token)
    return {
      error: fail(
        "Sodio needs your Google permission to send as you — sign in with Google once from the login page, then come back.",
        "forbidden"
      ),
    };
  const { memberSignature, signatureTitle } = await import("@/lib/email/compose");
  return {
    viewer,
    token: me.google_refresh_token,
    signature: memberSignature({
      name: viewer.name,
      title: signatureTitle(me.role, me.functions ?? []),
      email: me.email,
      phone: me.phone,
    }),
  };
}

const composeSchema = z.object({
  to: z.array(z.string().trim()).min(1, "Add at least one recipient"),
  cc: z.array(z.string().trim()).optional(),
  bcc: z.array(z.string().trim()).optional(),
  subject: z.string().trim().min(2, "Give the email a subject"),
  /** the member's own HTML, straight from the editor */
  body: z.string().trim().min(2, "Write something first"),
  template: z.string().trim().nullish(),
  layout: z.enum(["branded", "banner", "plain", "letterhead"]).optional(),
  attachments: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        mimeType: z.string().trim().min(3),
        dataBase64: z.string().min(4),
      })
    )
    .optional(),
  /** true = leave it in their Gmail drafts instead of sending */
  draft: z.boolean().optional(),
});

/** The editor's HTML, made safe to put in someone else's inbox. */
function safeEmailHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/javascript:/gi, "")
    .slice(0, 80_000);
}

/** WHAT IT WILL ACTUALLY LOOK LIKE (v33.25) — the same function that builds
 *  the outgoing mail, so the preview cannot drift from the thing that is
 *  sent. Nobody should discover the layout in the recipient's inbox. */
export async function previewComposedEmail(input: {
  body: string;
  layout?: string;
}): Promise<ActionResult<{ html: string }>> {
  const sender = await mailboxSender();
  if ("error" in sender) return sender.error;
  const { composedEmail } = await import("@/lib/email/compose");
  return {
    ok: true,
    data: {
      html: composedEmail({
        bodyHtml: safeEmailHtml(input.body ?? ""),
        signature: sender.signature,
        layout: (input.layout as "branded") ?? "branded",
      }),
    },
  };
}

/** SEND (or draft) AN EMAIL AS THE MEMBER.
 *
 *  Through their OWN Gmail, so the reply comes back to them and it sits in
 *  their Sent folder like any other letter — Sodio is the stationery, not the
 *  sender. What it adds is the frame, the signature nobody remembers to
 *  paste, and a record of who we have already written to. */
export async function sendComposedEmail(
  input: z.infer<typeof composeSchema>
): Promise<ActionResult<{ draft: boolean; to: number }>> {
  const parsed = composeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;
  const sender = await mailboxSender();
  if ("error" in sender) return sender.error;
  const { viewer, token, signature } = sender;

  const clean = (list: string[] | undefined) =>
    [...new Set((list ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))]
      .filter((a) => EMAIL_RE.test(a))
      .slice(0, 40);
  const to = clean(d.to);
  const cc = clean(d.cc);
  const bcc = clean(d.bcc);
  if (to.length === 0) return fail("None of those look like email addresses.");
  if (await sandboxSuppressed("compose email"))
    return fail("Sandbox test view is active — exit it to send real email.");

  const body = safeEmailHtml(d.body);
  const { composedEmail } = await import("@/lib/email/compose");
  const html = composedEmail({ bodyHtml: body, signature, layout: d.layout });

  // attachments ride the Gmail draft path, which already speaks multipart;
  // Vercel caps an action body around 4.5 MB, so this is checked here too
  const files = (d.attachments ?? []).slice(0, 8).map((f) => ({
    filename: f.name.slice(0, 160),
    mimeType: f.mimeType,
    contentBase64: f.dataBase64,
  }));
  const bytes = files.reduce((n, f) => n + Math.ceil(f.contentBase64.length * 0.75), 0);
  if (bytes > 3_200_000)
    return fail("Those attachments are over ~3 MB together — send the big ones as a link.");

  try {
    if (d.draft || files.length > 0) {
      // an email WITH files is always left as a draft: Gmail is where the
      // member sees the attachments land, and it is one click from there
      const { createMemberDraft } = await import("@/lib/google/gmail");
      await createMemberDraft(token, {
        to: to.join(", "), cc, subject: d.subject, html, attachments: files,
      });
    } else {
      const { sendMemberEmail } = await import("@/lib/google/gmail");
      await sendMemberEmail(token, { to, cc, bcc, subject: d.subject, html });
    }
  } catch (e) {
    console.error("[mailbox] send failed:", e);
    return fail(
      "Google refused to send it. If you changed your password recently, sign in with Google once and try again."
    );
  }

  await db().from("sent_emails").insert({
    member_id: viewer.id,
    member_name: viewer.name,
    to_addresses: to,
    cc_addresses: [...cc, ...bcc],
    subject: d.subject,
    body_html: html,
    status: d.draft ? "draft" : "sent",
    template: d.template || null,
  });
  await logAudit(viewer.id, d.draft ? "email_draft" : "email_sent", "member", viewer.id, {
    to: to.length,
    subject: d.subject,
  });
  await stampWork(viewer.id, "email_sent");
  revalidatePath("/emails");
  return { ok: true, data: { draft: !!d.draft || files.length > 0, to: to.length } };
}

/** THE BLUE MAN, ON A LETTER (v33.24). Write it from a brief, or rework what
 *  is already in the editor — shorten it, warm it up, fix the English, turn
 *  it into Arabic. It returns HTML the editor can hold. */
export async function draftEmailWithAi(input: {
  instruction: string;
  current?: string | null;
  subject?: string | null;
}): Promise<ActionResult<{ html: string; subject?: string }>> {
  const viewer = await getViewer();
  if (!canUseMailboxTab(viewer)) return fail("The Emails tab is for MMs and above.", "forbidden");
  const instruction = (input.instruction ?? "").trim().slice(0, 2000);
  if (instruction.length < 3) return fail("Tell it what you want first.");
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return fail("The AI helper isn't configured — tell the IM team.");

  const current = (input.current ?? "").trim().slice(0, 20_000);
  const prompt = `You are helping a member of AIESEC in Alexandria write a professional email.

RULES
- Return ONLY the email BODY as simple HTML: <p>, <b>, <i>, <ul>/<li>, <a href>. No <html>, <head>, <body>, no styles, no markdown fences.
- Do NOT write a signature, a sign-off block, or the sender's name — the system appends the real signature.
- Do NOT invent facts, names, numbers, dates or commitments that are not in the brief or the current draft.
- Match the language of the instruction (English or Arabic). Keep AIESEC terms in English.
- Warm, clear, professional. Short paragraphs. No corporate padding.

${current ? `CURRENT DRAFT (rework this):\n${current}\n\n` : ""}WHAT THEY ASKED FOR:
${instruction}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    if (!res.ok) return fail("The AI helper is busy right now — try again in a moment.");
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text.trim()) return fail("The AI helper came back empty — try rephrasing.");
    const html = text
      .replace(/^```(?:html)?/i, "")
      .replace(/```$/i, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .trim();
    return { ok: true, data: { html } };
  } catch (e) {
    console.error("[mailbox] ai draft failed:", e);
    return fail("Could not reach the AI helper.");
  }
}

// ================================================== direct visits (v33.24)

const directVisitSchema = z.object({
  function: z.enum(["IGV", "IGT", "B2B", "BD", "B2C"]),
  name: z.string().trim().min(2, "The account name is required"),
  product: z.enum(["GTa", "GTe"]).nullish(),
  sub_product: z.string().trim().nullish(),
  project: z.string().trim().nullish(),
  account_type: z.string().trim().nullish(),
  industry: z.string().trim().nullish(),
  /** the SAME tagged contacts every account gets — validated identically */
  contacts: z
    .array(
      z.object({
        tag: z.string().trim(),
        kind: z.enum(["phone", "email", "link"]),
        value: z.string().trim(),
      })
    )
    .optional(),
  requested_podio: z.boolean().nullish(),
  request_state: z.enum(["Checking", "Approved"]).nullish(),
  /** which day it happened — today by default, never the future */
  visitDate: z.string().min(8),
  visitTime: z.string().min(4),
  outcome: z.enum(["turned_away", "revisit", "send_info", "presented", "deal"]),
  comment: z.string().trim().min(2, "Say what happened in a line"),
  /** revisit → when you're going back; send_info / presented → the follow-up */
  nextDate: z.string().optional(),
  nextTime: z.string().optional(),
  nextStep: z.string().trim().optional(),
  /** turned away AND clearly dead — archive it there and then (v33.25) */
  outOfProcess: z.boolean().optional(),
  oopReason: z.string().trim().optional(),
});

/** A WALK-IN, LOGGED IN ONE ACT.
 *
 *  The raising funnel assumes research first: find the company, contact them,
 *  book a visit, go. Plenty of the LC's best work happens the other way round
 *  — someone walks a street, finds a business and offers the product at the
 *  door. Recording that used to mean creating an account, logging a contact,
 *  booking a visit into the past and reporting it: four screens for something
 *  that already happened, so it went unrecorded and the funnel called them
 *  idle.
 *
 *  This writes the same rows the normal path writes — a real account (MR), a
 *  real contact attempt, a real visit — so the walk-in shows up in the
 *  pipeline, the leaderboard and the dashboard with no double entry. The
 *  account carries `direct_visit` so the LC can see how much of the pipeline
 *  came from the street rather than the sheet.
 *
 *  Nothing is announced: the visit already happened, and the crew does not
 *  need "a visit was booked" for a meeting that is over. */
export async function logDirectVisit(
  input: z.infer<typeof directVisitSchema>
): Promise<ActionResult<{ id: string; slug: string; visitDone: boolean }>> {
  const viewer = await getViewer();
  const parsed = directVisitSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;

  if (!allowedAccountFunctions(viewer).includes(d.function))
    return fail(`You can only add ${allowedAccountFunctions(viewer).join(" / ") || "—"} accounts.`, "forbidden");
  if (!viewer.id) return fail("Sign in first.", "forbidden");

  // it ALREADY HAPPENED — a direct visit in the future is a booking, and
  // there is a button for that
  const { cairoToUtc } = await import("@/lib/time");
  const when = /^\d{4}-\d{2}-\d{2}$/.test(d.visitDate) && /^\d{2}:\d{2}/.test(d.visitTime)
    ? cairoToUtc(d.visitDate, d.visitTime)
    : null;
  if (!when || Number.isNaN(when.getTime())) return fail("That date and time don't look right.");
  if (when.getTime() > Date.now() + 5 * 60_000)
    return fail("A direct visit is one you already made — pick a time that has passed.");

  const outcome = DIRECT_VISIT_OUTCOMES.find((o) => o.key === d.outcome)!;

  // ---- 0. AN ARCHIVED NAME MET AT THE DOOR (v33.37).
  //
  // The walk-in already happened — refusing the log because the name sits in
  // the archive just loses the information. Two honest paths:
  //   · they LET YOU IN (any outcome but turned_away) → the account comes
  //     BACK, to the visitor, evidence being the visit itself — a Member may
  //     do this even though ordinary revive is TL+;
  //   · they TURNED YOU AWAY → the archive was right. It stays archived, and
  //     the attempt is logged on it as a comment so the next researcher knows
  //     the door was tried (and when).
  // The manual blacklist stays a hard block — there is no account to revive.
  {
    const { checkAccountName } = await import("./data");
    const { duplicate } = await checkAccountName(d.name, d.function);
    if (duplicate?.out_of_process) {
      if (d.outcome === "turned_away") {
        await db().from("account_comments").insert({
          account_id: duplicate.id,
          member_id: viewer.id,
          author_label: commentLabel(viewer),
          body: `🚶 Direct visit on ${d.visitDate} — turned away at the door. Still archived (${duplicate.oop_reason ?? "no reason recorded"}). ${d.comment}`,
        });
        await logAudit(viewer.id, "direct_visit_archived_log", "account", duplicate.id, {
          outcome: d.outcome,
        });
        refresh();
        return {
          ok: true,
          data: {
            id: duplicate.id,
            slug: accountSlug(duplicate.name),
            visitDone: false,
          },
        };
      }
      // they let you in — bring it back and make it yours
      const revive = await db()
        .from("accounts")
        .update({
          out_of_process: false,
          oop_reason: null,
          oop_at: null,
          responsible_id: viewer.id,
          direct_visit: true,
        })
        .eq("id", duplicate.id)
        .select("id")
        .maybeSingle();
      if (revive.error) return fail(revive.error.message);
      await db().from("account_comments").insert({
        account_id: duplicate.id,
        member_id: viewer.id,
        author_label: commentLabel(viewer),
        body: `🚶 Back from the archive: a direct visit on ${d.visitDate} reopened this account (was archived: ${duplicate.oop_reason ?? "no reason recorded"}).`,
      });
      await logAudit(viewer.id, "direct_visit_revive", "account", duplicate.id, {
        outcome: d.outcome,
      });
      const done = await finishDirectVisit(viewer, duplicate.id, d, outcome, when);
      if (!done.ok) return done as ActionResult<never>;
      return {
        ok: true,
        data: { id: duplicate.id, slug: accountSlug(duplicate.name), visitDone: outcome.visitDone },
      };
    }
  }

  // ---- 1. the account (this is the MR)
  // THE SAME DOOR EVERY ACCOUNT COMES THROUGH (v33.25). It runs the whole of
  // createAccount — the world-aware duplicate check, the archive block, the
  // blacklist, the contact validation and the Podio fields — so a walk-in can
  // no longer quietly create a second copy of an account that already exists,
  // or resurrect a name the LC burned.
  const created = await createAccount(
    {
      function: d.function,
      name: d.name,
      product: d.function === "IGT" ? d.product ?? null : null,
      sub_product: d.function === "IGT" ? d.sub_product ?? null : null,
      project: d.function === "IGV" ? d.project ?? null : null,
      account_type: d.function !== "IGT" ? d.account_type ?? null : null,
      industry:
        d.function !== "IGT" && d.function !== "B2C" ? d.industry ?? null : null,
      contacts: d.contacts ?? [],
      requested_podio: d.requested_podio ?? null,
      request_state: d.request_state ?? null,
      responsible_id: null, // themselves — createAccount defaults to the viewer
      comment: null,
    } as never,
    { via: "manual" }
  );
  if (!created.ok) return created as ActionResult<never>;
  const accountId = created.data!.id;
  await db().from("accounts").update({ direct_visit: true }).eq("id", accountId);

  const done = await finishDirectVisit(viewer, accountId, d, outcome, when);
  if (!done.ok) return done as ActionResult<never>;
  return {
    ok: true,
    data: { id: accountId, slug: created.data!.slug, visitDone: outcome.visitDone },
  };
}

/** Everything a direct visit writes AFTER the account exists — shared by the
 *  fresh-account path and the revived-from-archive path (v33.37). */
async function finishDirectVisit(
  viewer: Viewer,
  accountId: string,
  d: z.infer<typeof directVisitSchema>,
  outcome: (typeof DIRECT_VISIT_OUTCOMES)[number],
  when: Date
): Promise<ActionResult> {
  // ---- the contact attempt (they were reached — in person)
  await db().from("contact_attempts").insert({
    account_id: accountId,
    member_id: viewer.id,
    method: "Call",
    status: outcome.visitDone ? "Interested" : "Responded",
    comment: `🚶 Direct visit — ${outcome.label}. ${d.comment}`,
    created_at: when.toISOString(),
  });

  // ---- the visit itself, already reported.
  // TURNED AWAY AT THE DOOR IS NOT A VISIT (v33.37): reception blocked it, so
  // no visit happened and none is counted in anyone's KPIs — the walk-in
  // lives on as the contact attempt and the comment, which is what it was.
  if (d.outcome !== "turned_away") {
    await db().from("visits").insert({
      account_id: accountId,
      member_id: viewer.id,
      visit_date: d.visitDate,
      visit_time: d.visitTime,
      done: outcome.visitDone,
      visit_comment: `🚶 Direct visit — ${outcome.label}. ${d.comment}`,
      // it happened; nobody needs a follow-up prompt or a forgotten-visit nag
      followup_prompt_sent_at: new Date().toISOString(),
      report_sent_at: new Date().toISOString(),
    });
  }

  // ---- what happens next
  const nextStep =
    d.nextStep?.trim() ||
    (d.outcome === "revisit"
      ? "Go back for the visit"
      : d.outcome === "send_info"
        ? "Send them the info"
        : d.outcome === "turned_away"
          ? "Try again — reach the decision maker"
          : outcome.visitDone
            ? "Follow up on the pitch"
            : "");
  const patch: Record<string, unknown> = {};
  if (nextStep) patch.next_step = nextStep;
  if (d.nextDate) {
    patch.next_step_date = d.nextDate;
    if (d.nextTime) patch.next_step_time = d.nextTime;
  }
  if (Object.keys(patch).length > 0) {
    await db().from("accounts").update(patch).eq("id", accountId);
    if (d.nextDate) await syncNextStepReminder(accountId);
  }

  // "come back another time" WITH a date is a real booking — calendar event
  // and reminders like any other visit. Date only → 11:00 (the next-step
  // convention). No date at all → just the next step, to pin down later.
  if (d.outcome === "revisit" && d.nextDate) {
    await scheduleVisit({
      accountId,
      visitDate: d.nextDate,
      visitTime: d.nextTime || "11:00",
      notes: `Return visit — first walk-in on ${d.visitDate}. ${d.comment}`,
    });
  }

  // turned away AND clearly not worth another try — archive it on the spot,
  // through the real path so the blacklist and the mirrors stay right
  if (d.outOfProcess && d.outcome === "turned_away") {
    await setOutOfProcess(accountId, d.oopReason?.trim() || "Not Interested");
  }

  await logAudit(viewer.id, "direct_visit", "account", accountId, {
    outcome: d.outcome,
    visitDone: outcome.visitDone,
    archived: !!d.outOfProcess,
  });
  await stampWork(viewer.id, "direct_visit");
  refresh(accountId);
  return { ok: true };
}

const reportSchema = z.object({
  visitId: z.string().uuid(),
  done: z.boolean(),
  comment: z.string().trim().min(2, "Add a short comment about the visit"),
  nextStep: z.string().trim().optional(),
  nextStepDate: z.string().optional(),
  /** v33 — what came out of a COMPLETED visit; drives what happens next */
  result: z.string().trim().optional(),
});

/** Member reports a visit (done / not done) → styled email fires to the VP and
 *  the member's stakeholder immediately. */
export async function reportVisit(
  input: z.infer<typeof reportSchema>
): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { visitId, done, comment, nextStep, nextStepDate, result } = parsed.data;

  const { data: visit } = await db()
    .from("visits")
    .select("*")
    .eq("id", visitId)
    .maybeSingle<Visit>();
  if (!visit) return fail("Visit not found.");
  const account = await loadAccount(visit.account_id);
  if (!account || !canEditAccount(viewer, account))
    return fail("You are not allowed to report this visit.", "forbidden");

  // the RESULT is part of the report, so the history reads "Interested" and
  // not just a paragraph someone has to interpret (v33)
  const resultOk =
    !result || (VISIT_RESULTS as readonly string[]).includes(result);
  if (done && !resultOk) return fail("Pick what came out of the visit.");
  const body = done && result ? `${result}${comment ? ` — ${comment}` : ""}` : comment;

  await snapshotForUndo("visits", visitId);
  const { error } = await db()
    .from("visits")
    .update({ done, visit_comment: body, next_step: nextStep || null })
    .eq("id", visitId);
  if (error) return fail(error.message);

  // "Not interested" ends it — same rule as the contact log, where that answer
  // archives on the spot. Done BEFORE the notifications so the email describes
  // an account that is already out.
  if (done && result === "Not interested") {
    await setOutOfProcess(visit.account_id, "Not Interested").catch((e) =>
      console.error("[visit] auto-archive failed:", e)
    );
  }

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
      memberName: viewer.name,
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

/** Keeps only attachment records that point at a path this viewer just
 *  uploaded — the client sends them back after the PUT, so they are checked
 *  rather than trusted. */
function cleanAttachments(
  raw: { path: string; name: string }[] | undefined,
  viewerId: string
): { path: string; name: string }[] {
  return (raw ?? [])
    .filter((a) => typeof a?.path === "string" && a.path.startsWith(`${viewerId}/`))
    .slice(0, 5)
    .map((a) => ({ path: a.path, name: String(a.name ?? "file").slice(0, 120) }));
}

export async function submitFeedback(input: {
  type: "Bug" | "Enhancement" | "Other";
  category?: string;
  message: string;
  page?: string;
  anonymous?: boolean;
  /** screenshots, usually — a bug is easier shown than described (v33.13) */
  attachments?: { path: string; name: string }[];
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
    // the path always begins with the uploader's id, so an anonymous report
    // keeps its screenshot without the path naming them to the reader
    attachments: cleanAttachments(input.attachments, viewer.id),
  });
  if (error) {
    if (error.message.includes("category"))
      return fail("Feedback categories need migration 0017 — run it in the Supabase SQL editor.");
    return fail(error.message);
  }

  // straight to the IM director + IM coach inboxes
  const { feedbackEmail } = await import("@/lib/email/templates");
  const mail = feedbackEmail({
    memberName: input.anonymous ? "Anonymous member 🎭" : viewer.name,
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
export async function updateProfile(input: {
  phone: string;
  /** BACKUP GMAIL (v33.29): where system email reaches a member whose
   *  @aiesec.net hasn't landed yet — password resets, IR-call calendar
   *  invites. NEVER an identity: no sign-in, no session, not on the sheet
   *  (DB-only, so the membership import can't clobber it). */
  fallbackEmail?: string | null;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  const parsed = profileSchema.safeParse({ name: viewer.name, phone: input.phone });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const update: Record<string, string | null> = { phone: parsed.data.phone };
  if (input.fallbackEmail !== undefined) {
    const fb = (input.fallbackEmail ?? "").trim().toLowerCase();
    if (fb && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fb))
      return fail("The backup email doesn't look like an email address.");
    if (fb && viewer.email && fb === viewer.email.toLowerCase())
      return fail("That's already your main email — the backup is for a DIFFERENT inbox you check.");
    update.fallback_email = fb || null;
  }

  await snapshotForUndo("members", viewer.id); // sandbox test view: roll back on exit
  const { error } = await db()
    .from("members")
    .update(update)
    .eq("id", viewer.id);
  if (error) return fail(error.message);

  await writeProfileBackToSheet(viewer.id);
  await logAudit(viewer.id, "profile_update", "member", viewer.id);
  refresh();
  return { ok: true };
}

/** THE FUNCTION'S DEFAULTS (v33.32, migration 0054).
 *
 *  A function's LCVP/Director sets how their floor behaves — what a new
 *  account starts with, who may read the whole function, whether the OGX pool
 *  is self-service, whether TM chases their sessions. LCP/admin may set any
 *  function's; everyone else, none.
 *
 *  Stored as one JSONB blob, merged over the current row so a form that only
 *  sends what it renders can never blank a switch it doesn't show. */
export async function saveFunctionSettings(
  fn: string,
  patch: Record<string, unknown>
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { manageableFunctions, FUNCTION_SETTINGS_TAG } = await import("./function-settings");
  if (!manageableFunctions(viewer).includes(fn as never))
    return fail("Only that function's VP or Director can change its defaults.", "forbidden");
  const { resolveFunctionSettings } = await import("@/lib/function-settings");

  const { data: existing } = await db()
    .from("function_settings")
    .select("settings")
    .eq("function_key", fn)
    .maybeSingle<{ settings: unknown }>();
  const merged = resolveFunctionSettings(fn, {
    ...(typeof existing?.settings === "object" && existing?.settings ? existing.settings : {}),
    ...patch,
  });

  // deliberately NOT journalled for undo: `snapshotForUndo` keys on an `id`
  // column and this table is keyed by function_key. The audit row below
  // carries the full resolved blob, which is what a rollback would read.
  const { error } = await db().from("function_settings").upsert(
    {
      function_key: fn,
      settings: merged,
      updated_at: new Date().toISOString(),
      updated_by: viewer.id,
      updated_by_name: viewer.name,
    },
    { onConflict: "function_key" }
  );
  if (error) return fail(error.message);

  // The settings map is cached for a minute on every request that builds a
  // Viewer. `updateTag` (not revalidateTag) is the read-your-own-writes one in
  // Next 16 — a leader flipping a switch must not be served the stale value
  // they just changed while it revalidates in the background.
  const { updateTag } = await import("next/cache");
  updateTag(FUNCTION_SETTINGS_TAG);
  await logAudit(viewer.id, "function_settings_save", "function", fn, { settings: merged });
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
    /** v33.2 — holds the LC's Podio access, so they may set Request States */
    has_podio: z.boolean().optional(),
    /** v33.29 — backup Gmail for members without @aiesec.net yet. DB-only:
     *  deliberately NOT in SheetMemberRow, so the half-hourly import can
     *  never clobber it (the has_podio precedent). */
    fallback_email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === "" || EMAIL_RE.test(v), "The backup email doesn't look valid.")
      .nullish(),
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
    email: m.email || null,
    phone: m.phone || null,
    role: m.role,
    functions: m.functions,
    sub_functions: m.sub_functions,
    stakeholder_name: m.stakeholder_name || null,
    team_name: m.team_name || null,
    is_active: m.is_active,
    has_podio: m.has_podio ?? false,
    // only touch the backup email when the dialog actually sent the field —
    // an absent property must never erase what the member set on their profile
    ...(m.fallback_email !== undefined
      ? { fallback_email: m.fallback_email || null }
      : {}),
  };

  let id = m.id ?? null;
  if (id) {
    // capture the role BEFORE the update so a promotion can release the
    // member-level sign-up pool (v33.19 — the Marwan case)
    const { data: before } = await db()
      .from("members").select("role").eq("id", id).maybeSingle<{ role: string }>();
    // never ERASE an existing email with an empty field — adding one is the
    // phone-only upgrade path, removing one only happens via the sheet
    const { email: emailValue, ...rest } = row;
    const updatePayload = emailValue ? row : rest;
    const { error } = await db().from("members").update(updatePayload).eq("id", id);
    if (error) return fail(error.message);
    if (before && before.role !== m.role) {
      const { releaseSignupsOnPromotion } = await import("./data");
      await releaseSignupsOnPromotion(id, before.role, m.role).catch((e) =>
        console.error("[members] promotion release failed:", e)
      );
    }
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
    .select("id, name, role, functions, stakeholder_name, stakeholder_id, is_active");
  let targetId: string | null = null;
  if (m.stakeholder_name) {
    // a plain Member can never BE a manager — such names fall through to the
    // default chain (VP → Director → LCP)
    targetId =
      (all ?? []).find(
        (x) =>
          x.id !== id &&
          x.role !== "Member" &&
          x.name.trim().toLowerCase() === m.stakeholder_name!.trim().toLowerCase()
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

  // a corrected spelling must reach the SNAPSHOT columns too (v33.18) — the
  // IR log, touch points, calendar items, sign-up assignments and every
  // member's manager-by-name, or the old string keeps showing up in filters
  await cascadeMemberRename(id!, m.name).catch((e) =>
    console.error("[members] rename cascade failed:", e)
  );

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
    .select("id, email, name")
    .eq("id", memberId)
    .maybeSingle<{ id: string; email: string | null; name: string }>();
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
    // a human pressing the button IS the force case (v33.19 review)
    const imported = await importMembership({ force: true });
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
  // MMs and above (v33.12) — the same people who may work the archive. Never a
  // plain Member: this cascades through contacts, visits and deals, and the
  // sandbox can't undo it.
  const allowed =
    viewer.isAdmin ||
    ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(viewer.role);
  if (!allowed)
    return fail("Only MMs, VPs, Directors or the LCP delete archived accounts.", "forbidden");
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
  await stampWork(viewer.id, "podio_updated"); // v33.18
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
/** Brings an ARCHIVED account back into process and hands it to someone, from
 *  the add-account dialog (v33.7).
 *
 *  The person hitting the block is doing market research right now — they have
 *  fresh information about a company the LC wrote off months ago. Making them
 *  hunt through the archive to act on it is how a good lead dies in a dialog.
 *  Assignment is scoped: themselves, or someone they may already assign to. */
export async function reviveAndAssign(
  accountId: string,
  toMemberId?: string,
  /** required when the account lands in IGV — every IGV account carries one */
  project?: string | null
): Promise<ActionResult<{ slug: string }>> {
  const viewer = await getViewer();
  const account = await loadAccount(accountId);
  if (!account) return fail("That account no longer exists.");
  if (!account.out_of_process) return fail("That account is already in process.");
  if (!canReassignAccount(viewer, account))
    return fail("Only an MM or above can bring an archived account back.", "forbidden");

  // whoever may work the archive may hand the revived account to anyone —
  // the useful case is an IGV TL finding a company that belongs in IGT
  const target = toMemberId ?? viewer.id;

  // WHERE IT LANDS. A revived account joins the function of whoever takes it,
  // or it reappears somewhere its new owner can't open (v33.9). Moving INTO
  // IGV needs a Project, because every IGV account has one and an account
  // without it is broken the moment anyone filters by project.
  const { data: targetRow } = await db()
    .from("members")
    .select("functions, sub_functions")
    .eq("id", target)
    .maybeSingle<{ functions: string[] | null; sub_functions: string[] | null }>();
  const targetFns = [
    ...(targetRow?.functions ?? []),
    ...(targetRow?.sub_functions ?? []),
  ].filter((f) => ["IGV", "IGT", "B2B", "BD", "B2C"].includes(f));
  const landsIn = targetFns.includes(account.function)
    ? account.function
    : (targetFns[0] ?? account.function);

  const cleanProject = (project ?? "").trim();
  if (landsIn === "IGV" && !cleanProject)
    return fail(
      "This account lands in IGV, and every IGV account needs a project — pick one at the top of this form first."
    );

  const revived = await reviveAccount(accountId);
  if (!revived.ok) return revived;
  const assigned = await reassignAccount(accountId, target);
  if (!assigned.ok) return assigned;
  if (landsIn === "IGV" && cleanProject) {
    await db().from("accounts").update({ project: cleanProject }).eq("id", accountId);
  }
  refresh(accountId);
  return { ok: true, data: { slug: accountSlug(account.name) } };
}

/** Defers the first-sign-in planning step for a day (v33.8). */
export async function skipPlanForNow(): Promise<ActionResult> {
  const { PLAN_SKIP_COOKIE, PLAN_SKIP_HOURS } = await import("@/lib/plan-skip");
  const { cookies } = await import("next/headers");
  (await cookies()).set(PLAN_SKIP_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: PLAN_SKIP_HOURS * 3600,
  });
  return { ok: true };
}

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
  const { duplicate, blacklisted, crossWorldArchived, crossWorldActive } =
    await checkAccountName(clean, fn);
  if (blacklisted)
    return {
      ok: true,
      data: {
        status: "blacklisted",
        message: `"${clean}" is on the blocked list — it can't be added while it's there.`,
        info: {
          reason: blacklisted.comments,
          project: blacklisted.project,
          link: blacklisted.link,
          // a blocked NAME has no account behind it, so there is nothing to
          // revive — lifting the block is the only way forward, and that
          // stays a VP/Director call
          unblock: viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role)
            ? blacklisted.id
            : null,
        },
      },
    };
  if (duplicate && duplicate.out_of_process) {
    // AN MM CAN ACT ON IT (v33.7). Being told a name is archived and nothing
    // else is a dead end: the person doing the market research has to go find
    // the archive, search it, and work out whether the old reason still
    // stands. TL and up get a link into the account and a one-click revive
    // that assigns it to them.
    const canRevive = canReassignAccount(viewer, duplicate);
    return {
      ok: true,
      data: {
        status: "archived",
        message: `"${clean}" was worked before and is archived — it cannot be added again.`,
        info: {
          function: duplicate.function,
          reason: duplicate.oop_reason,
          archived_at: duplicate.oop_at?.slice(0, 10) ?? null,
          was_responsible: duplicate.responsible_name || "Unassigned",
          open: `/accounts/${duplicate.id}`,
          revive: canRevive ? duplicate.id : null,
        },
      },
    };
  }
  if (duplicate) {
    // AN UNOWNED DUPLICATE CAN BE TAKEN RIGHT HERE (v33.37). The old message
    // said "open it and hit Take it" — but a Member couldn't OPEN an
    // unassigned account at all, so the advice pointed at a locked door.
    const takeable = !duplicate.responsible_id && isClaimableAccount(viewer, duplicate);
    return {
      ok: true,
      data: {
        status: "duplicate",
        message: duplicate.responsible_id
          ? `"${clean}" already exists on ${duplicate.function} accounts.`
          : `"${clean}" is already in the CRM under ${duplicate.function}, and NOBODY owns it — take it right here and the research is yours.`,
        info: {
          function: duplicate.function,
          responsible:
            duplicate.responsible_name || "Unassigned",
          stage: duplicate.stage,
          project: duplicate.project ?? duplicate.sub_product,
          created_at: duplicate.created_at?.slice(0, 10) ?? null,
          open: duplicate.responsible_id ? null : `/accounts/${accountSlug(duplicate.name)}`,
          claim: takeable ? duplicate.id : null,
        },
      },
    };
  }
  // ACTIVE in another world — allowed since v33.29, but say who has it: the
  // same company can be an IGV partner, a BD sponsor and a B2C venue at once
  if (crossWorldActive)
    return {
      ok: true,
      data: {
        status: "free",
        note: `FYI: "${clean}" is already ACTIVE on ${crossWorldActive.function} (responsible: ${crossWorldActive.responsible_name || "Unassigned"}) — different business, so you can add it here too. Worth a word with them before you both knock on the same door.`,
      },
    };
  // archived in ANOTHER world — allowed, but worth knowing (v23.2)
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
  await stampWork(viewer.id, "proposal_email"); // v33.18: counts towards working hours
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
    .select("id, email, name, role, functions")
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
      senderName: viewer.name,
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
    .select("id, name, role, functions")
    .eq("is_active", true)
    .order("name");
  return {
    ok: true,
    data: (data ?? []).map((m) => ({
      id: m.id,
      label: m.name,
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
    .select("id, message, anonymous, member:members(id, name, email)")
    .eq("id", feedbackId)
    .maybeSingle<{
      id: string; message: string; anonymous: boolean;
      member: { id: string; name: string; email: string } | null;
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
    memberFirstName: f.member.name.split(" ")[0],
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
 *  PAST TOUCH POINT the author was part of, which reaches its organiser: positive
 *  shout-outs go straight to the person (bell + email); negative concerns land
 *  in an inbox only the LCP, the admin and TM's LCVP/Director can read
 *  (`canSeeLcConcerns`). The author is always stored for
 *  accountability but NEVER shown when anonymous. */
export async function submitLcFeedback(input: {
  positive: boolean;
  about: string[];
  message: string;
  anonymous?: boolean;
  /** TOUCH POINTS ARE RATED, NOT PRAISED OR REPORTED (v33.33): 1–5 stars.
   *  Required with a touchPointId, refused without one — a person is never
   *  given a score. */
  rating?: number | null;
  attachments?: { path: string; name: string }[];
  /** feedback about a past TOUCH POINT the viewer can see (v29): it resolves to
   *  the session's OWNER as the target and names the session in the message,
   *  so both flows travel the exact same shout-out / private-inbox path. */
  touchPointId?: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  let message = input.message?.trim();
  const rating =
    Number.isInteger(input.rating) && (input.rating as number) >= 1 && (input.rating as number) <= 5
      ? (input.rating as number)
      : null;
  if (input.touchPointId) {
    // the stars ARE the review — a comment on top of them is welcome, not owed
    if (!rating) return fail("Give the touch point a rating first ⭐");
    if (!message) message = "";
    else if (message.length < 3) return fail("Either write a real note or leave it empty 🙂");
  } else {
    if (rating) return fail("Ratings are for touch points — a person is never scored.");
    if (!message || message.length < 3) return fail("Write the feedback first 🙂");
  }
  const about = [...new Set(input.about ?? [])].filter((id) => id && id !== viewer.id);

  if (input.touchPointId) {
    // v33.19: the gate is "a PAST session you can see", not an attendance row —
    // a missing register means nobody took it, not that nobody was there
    const { getTouchPoint, viewerSeesTouchPoint } = await import("./touch-points-read");
    const tp = await getTouchPoint(input.touchPointId);
    if (!tp) return fail("That touch point no longer exists.");
    if (!viewerSeesTouchPoint(viewer, tp))
      return fail("You can only give feedback on a touch point you were part of.");
    if (tp.status === "cancelled")
      return fail("That touch point was cancelled — there was no session to review.");
    if (new Date(tp.starts_at).getTime() > Date.now())
      return fail("That touch point hasn't happened yet 🙂");
    const { touchPointLabel } = await import("@/lib/types");
    const { cairoWhen } = await import("@/lib/touch-points");
    message =
      `📍 ${"⭐".repeat(rating ?? 0)} (${rating}/5) — ${touchPointName(tp)} on ${cairoWhen(tp.starts_at)}` +
      (message ? `\n\n${message}` : "\n\n(no note left)");
    // A SESSION IS THE LC'S, NOT THE ORGANISER'S (v33.19.2). Feedback about a
    // touch point used to be addressed AT whoever booked it, which turned
    // "the meeting ran long" into a note about a person — and made an honest
    // review awkward when the organiser is your own TL. It goes to the people
    // who run the LC's touch points instead: the TM function, the LCP and
    // F&L's LCVP. (Feedback about a PERSON still works — pick them by name.)
    const { data: leadership } = await db()
      .from("members")
      .select("id, role, functions, sub_functions")
      .eq("is_active", true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routed = ((leadership ?? []) as any[])
      .filter((m) => {
        const fns = [...(m.functions ?? []), ...(m.sub_functions ?? [])];
        return (
          m.role === "LCP" ||
          fns.includes("TM") ||
          (m.role === "LCVP" && fns.includes("F&L"))
        );
      })
      .map((m) => m.id as string)
      .filter((id) => id !== viewer.id);
    if (routed.length === 0)
      return fail("Nobody is set up to receive touch-point feedback yet — tell the IM team.");
    for (const id of routed) if (!about.includes(id)) about.push(id);
  }

  if (about.length === 0) return fail("Pick at least one person (not yourself 🙂).");
  if (about.length > 10) return fail("Max 10 people per feedback.");

  const { data: targets } = await db()
    .from("members")
    .select("id, name, email")
    .in("id", about)
    .eq("is_active", true);
  if (!targets || targets.length === 0) return fail("Those members don't exist.");

  const { data: filed, error } = await db()
    .from("lc_feedback")
    .insert({
      author_id: viewer.id,
      anonymous: !!input.anonymous,
      // `positive` stays NOT NULL for every existing reader; for a rated
      // touch point it is derived (4+ stars) rather than chosen
      positive: rating ? rating >= 4 : input.positive,
      rating,
      about: targets.map((t) => t.id),
      message,
      attachments: cleanAttachments(input.attachments, viewer.id),
      // v33.22: touch-point feedback is its own KIND in the inbox, not a concern
      // with a session name glued to the front of it
      touch_point_id: input.touchPointId ?? null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) {
    if (error.message.includes("lc_feedback"))
      return fail("LC feedback needs migration 0017 — run it in the Supabase SQL editor.");
    return fail(error.message);
  }

  // A TOUCH-POINT REVIEW IS NEVER A SHOUT-OUT (v33.33): it goes to the people
  // who run the LC's sessions, quietly, whatever the stars say. Praising the
  // TM function by email because someone rated a meeting 5 was never the
  // point — the rating is data about the session, not applause for a person.
  const isReview = !!input.touchPointId;
  if (input.positive && !isReview) {
    // shout-out → tell the person right away (bell + branded email)
    const from = input.anonymous ? "Someone in the LC 🎭" : viewer.name;
    const { notifyMembers } = await import("./notify");
    await notifyMembers(
      targets.map((t) => t.id),
      "lc_feedback",
      `💙 ${from} appreciated you!`,
      message.slice(0, 300),
      input.anonymous ? null : viewer.id
    );
    // ONE EMAIL, EVERYONE ON BCC (v33.33). A shout-out to nine people used to
    // be nine separate sends: nine chances to fail, nine rows in the mailbox,
    // and nine times the quota for one message. The greeting is written for
    // the group when there IS a group, so nothing pretends to be personal
    // that isn't; a single recipient still gets their own name.
    const { lcShoutoutEmail } = await import("@/lib/email/templates");
    const withMail = targets.filter((t) => t.email);
    if (withMail.length === 1) {
      const t = withMail[0];
      const mail = lcShoutoutEmail({ firstName: t.name.split(" ")[0], from, message });
      sendEmail({ to: [t.email], ...mail }).catch((e) =>
        console.error("[lc-feedback] shout-out email failed:", e)
      );
    } else if (withMail.length > 1) {
      const mail = lcShoutoutEmail({ firstName: null, from, message });
      sendEmail({ to: [], bcc: withMail.map((t) => t.email), ...mail }).catch((e) =>
        console.error("[lc-feedback] shout-out email failed:", e)
      );
    }
  }
  // A CONCERN is quiet — never to the person it's about — but the people who
  // must act on it are told. Since v33.22 that list is exactly who can OPEN
  // the inbox (`canSeeLcConcerns`): TM, the LCP, F&L's LCVP and the IM
  // director. Telling someone about a concern they cannot then read was the
  // old bug in miniature.
  if (!input.positive || isReview) {
    const { data: owners } = await db()
      .from("members")
      .select("id, name, email, role, functions, sub_functions")
      .eq("is_active", true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inboxOwners = ((owners ?? []) as any[]).filter((m) => {
      const fns = [...(m.functions ?? []), ...(m.sub_functions ?? [])];
      return (
        m.role === "LCP" ||
        fns.includes("TM") ||
        (m.role === "LCVP" && fns.includes("F&L")) ||
        ((m.role === "Director" || m.role === "LCVP") && fns.includes("IM"))
      );
    });
    if (inboxOwners.length > 0) {
      const { notifyMembers } = await import("./notify");
      await notifyMembers(
        inboxOwners.map((m) => m.id),
        "lc_feedback",
        isReview ? "⭐ A touch point was rated" : "A new concern was filed",
        isReview
          ? `${rating}/5 — open the inbox to read the review.`
          : `About ${targets.length} ${targets.length === 1 ? "person" : "people"} — open the inbox to read it.`,
        null,
        "/lc-feedback"
      );
      if (!(await sandboxSuppressed("lc concern email"))) {
        const { lcConcernEmail } = await import("@/lib/email/templates");
        const mail = lcConcernEmail({ count: targets.length, rating });
        // one email, the inbox owners on BCC — they are being told the same
        // thing, and they don't need to see each other's addresses either
        const inboxes = inboxOwners.map((m) => m.email).filter(Boolean) as string[];
        if (inboxes.length > 0)
          await sendEmail({
            to: inboxes.length === 1 ? [inboxes[0]] : [],
            bcc: inboxes.length === 1 ? undefined : inboxes,
            ...mail,
          }).catch((e) => console.error("[lc-feedback] concern mail failed:", e));
      }
    }
  }

  // NEVER attribute anonymous feedback in the audit log — the admin reads BOTH
  // the audit log and the inbox, so an author here would deanonymize a concern.
  // (The lc_feedback row keeps author_id at the DB layer for true abuse
  // accountability, but that is never surfaced in any UI.)
  // the ACTOR stays null on an anonymous row — the audit table itself never
  // names them. `feedback_id` only points at the feedback; resolving it to a
  // person happens at read time and only for ADMIN_EMAILS (v33.30).
  await logAudit(input.anonymous ? null : viewer.id, "lc_feedback", "member", targets[0].id, {
    positive: input.positive,
    people: targets.length,
    anonymous: !!input.anonymous,
    about_touch_point: !!input.touchPointId,
    ...(input.anonymous && filed?.id ? { feedback_id: filed.id } : {}),
  });
  return { ok: true };
}

/** THE INBOX HAS THREE STATES (v33.22): new · done · archived.
 *
 *  "Seen" and "done" were the same thing in practice — nobody opened a
 *  concern and left it half-handled on purpose — so the middle state is gone
 *  and `archived` takes its place: filed away, not a to-do, not a resolution.
 *  Closing one records WHO closed it and when. */
export async function setLcFeedbackStatus(
  id: string,
  status: "new" | "done" | "archived"
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canSeeLcConcerns(viewer))
    return fail("Only TM, the LCP and F&L's LCVP manage this inbox.", "forbidden");
  if (!["new", "done", "archived"].includes(status)) return fail("Unknown status.");
  await snapshotForUndo("lc_feedback", id);
  const { error } = await db()
    .from("lc_feedback")
    .update({
      status,
      resolved_by: status === "new" ? null : viewer.id,
      resolved_at: status === "new" ? null : new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "lc_feedback_status", "lc_feedback", id, { status });
  refresh();
  return { ok: true };
}

/** PASS IT ON (v33.22) — most concerns need someone who wasn't in the inbox:
 *  the person's TL, the function's VP, whoever can actually do something.
 *  Sharing sends the feedback itself (bell + email) and records who it went
 *  to, so the same name is never looped in twice.
 *
 *  ANONYMITY SURVIVES SHARING: the author is never named, exactly as in the
 *  inbox. Sharing a concern is not a way to find out who filed it. */
export async function shareLcFeedback(
  id: string,
  memberIds: string[],
  note?: string
): Promise<ActionResult<{ shared: number }>> {
  const viewer = await getViewer();
  if (!canSeeLcConcerns(viewer))
    return fail("Only TM, the LCP and F&L's LCVP manage this inbox.", "forbidden");
  const ids = [...new Set((memberIds ?? []).filter(Boolean))].slice(0, 20);
  if (ids.length === 0) return fail("Pick at least one person.");
  const { data: row } = await db()
    .from("lc_feedback")
    .select("id, message, positive, anonymous, shared_with, touch_point_id")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      message: string;
      positive: boolean;
      anonymous: boolean;
      shared_with: string[] | null;
      touch_point_id: string | null;
    }>();
  if (!row) return fail("That feedback no longer exists.");
  const { data: people } = await db()
    .from("members")
    .select("id, name, email")
    .in("id", ids)
    .eq("is_active", true);
  const targets = (people ?? []) as { id: string; name: string; email: string | null }[];
  if (targets.length === 0) return fail("Nobody active in that list.");

  const kind = row.touch_point_id
    ? "touch-point feedback"
    : row.positive
      ? "a shout-out"
      : "a concern";
  const trimmed = (note ?? "").trim().slice(0, 500);
  const body = `${row.message}${trimmed ? `\n\n— ${viewer.name}: ${trimmed}` : ""}`;

  const { notifyMembers } = await import("./notify");
  await notifyMembers(
    targets.map((t) => t.id),
    "lc_feedback",
    `${viewer.name} shared ${kind} with you`,
    body.slice(0, 400),
    // the SHARER is named (they chose to pass it on); the AUTHOR never is
    viewer.id,
    "/lc-feedback"
  );
  if (!(await sandboxSuppressed("share lc feedback"))) {
    const { lcSharedFeedbackEmail } = await import("@/lib/email/templates");
    const mail = lcSharedFeedbackEmail({
      sharedBy: viewer.name,
      kind,
      message: row.message,
      note: trimmed || null,
    });
    // ONE email for the whole group, BCC (v33.33) — the text is identical
    // for every recipient, so N sends were N chances to fail for no gain
    const inboxes = targets.map((t) => t.email).filter(Boolean) as string[];
    if (inboxes.length > 0)
      await sendEmail({
        to: inboxes.length === 1 ? [inboxes[0]] : [],
        bcc: inboxes.length === 1 ? undefined : inboxes,
        ...mail,
      }).catch((e) => console.error("[lc-feedback] share mail failed:", e));
  }
  await snapshotForUndo("lc_feedback", id);
  const merged = [...new Set([...(row.shared_with ?? []), ...targets.map((t) => t.id)])];
  await db().from("lc_feedback").update({ shared_with: merged }).eq("id", id);
  await logAudit(viewer.id, "lc_feedback_share", "lc_feedback", id, { to: targets.length });
  refresh();
  return { ok: true, data: { shared: targets.length } };
}

/** CLOSE THE LOOP (v33.22) — tell whoever filed it that it was handled, with
 *  an optional word about what happened. Filing a concern into silence is how
 *  people stop filing them.
 *
 *  Works for ANONYMOUS feedback too: the system knows the author even when
 *  the reader doesn't, and telling them changes nothing about who can see
 *  their name. Marks the feedback done in the same move. */
export async function tellLcFeedbackAuthor(
  id: string,
  comment?: string
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canSeeLcConcerns(viewer))
    return fail("Only TM, the LCP and F&L's LCVP manage this inbox.", "forbidden");
  const { data: row } = await db()
    .from("lc_feedback")
    .select("id, author_id, anonymous, positive, message")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      author_id: string | null;
      anonymous: boolean;
      positive: boolean;
      message: string;
    }>();
  if (!row) return fail("That feedback no longer exists.");
  if (!row.author_id) return fail("Nobody to tell — the author has left the LC.");
  const { data: author } = await db()
    .from("members")
    .select("id, name, email, is_active")
    .eq("id", row.author_id)
    .maybeSingle<{ id: string; name: string; email: string | null; is_active: boolean }>();
  if (!author?.is_active) return fail("Nobody to tell — the author has left the LC.");

  const said = (comment ?? "").trim().slice(0, 800);
  const { notifyMembers } = await import("./notify");
  await notifyMembers(
    [author.id],
    "lc_feedback",
    "✅ Your feedback was handled",
    said || "Thank you for speaking up — it was read and acted on.",
    viewer.id,
    "/lc-feedback"
  );
  if (author.email && !(await sandboxSuppressed("lc feedback handled email"))) {
    const { lcFeedbackHandledEmail } = await import("@/lib/email/templates");
    await sendEmail({
      to: [author.email],
      ...lcFeedbackHandledEmail({
        name: author.name,
        handledBy: viewer.name,
        original: row.message,
        note: said || null,
      }),
    }).catch((e) => console.error("[lc-feedback] handled mail failed:", e));
  }
  await snapshotForUndo("lc_feedback", id);
  const { error } = await db()
    .from("lc_feedback")
    .update({
      author_told_at: new Date().toISOString(),
      resolution: said || null,
      status: "done",
      resolved_by: viewer.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "lc_feedback_told_author", "lc_feedback", id, {});
  refresh();
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

// ============================================ IGT expectation mail (v33.3)

import { IGT_MAIL_CC } from "@/lib/email/igt-expectation";

const igtMailSchema = z.object({
  epName: z.string().trim().min(2, "The EP's name is required."),
  projectName: z.string().trim().min(2, "The project name is required."),
  year: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "The year should be four digits, like 2026."),
});

const igtReviewedSchema = z.object({
  subject: z.string().trim().min(1, "The subject can't be empty."),
  html: z.string().trim().min(1, "The email body can't be empty."),
  toEp: z.string().trim().refine((v) => EMAIL_RE.test(v), "The EP email doesn't look valid."),
  /** the IR is OPTIONAL here (unlike the OGT mail) — plenty of incoming EPs
   *  arrive without one named, and blocking the mail on it helps nobody */
  toIr: z
    .string()
    .trim()
    .refine((v) => v === "" || EMAIL_RE.test(v), "The IR email doesn't look valid.")
    .optional(),
});

export type IgtReviewedMail = z.infer<typeof igtReviewedSchema>;

/** Step 1 — builds the exact mail (subject + HTML + signature) without
 *  touching Gmail, so the VP reviews and edits it before anything is sent. */
export async function previewIgtExpectationMail(
  input: z.infer<typeof igtMailSchema>
): Promise<ActionResult<{ subject: string; html: string }>> {
  const viewer = await getViewer();
  if (!canUseIgtExpectationMail(viewer))
    return fail("The IGT leadership sends this mail.", "forbidden");
  const parsed = igtMailSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (!viewer.email)
    return fail("Your AIESEC email isn't on file yet — the EP replies to it, so it can't be blank.");

  const { igtExpectationEmail } = await import("@/lib/email/igt-expectation");
  return {
    ok: true,
    data: igtExpectationEmail({
      ...parsed.data,
      senderName: viewer.name,
      senderPosition:
        viewer.role === "Director"
          ? "Director of Incoming Global Talent & Teacher"
          : "Local Committee Vice President of Incoming Global Talent & Teacher",
      senderEmail: viewer.email,
      senderPhone: viewer.phone,
    }),
  };
}

/** The recipients, identically for the send and the draft: the EP on To, the
 *  MC's customer-support inbox always on Cc, the IR too when there is one. */
function igtRecipients(d: IgtReviewedMail) {
  const ir = (d.toIr ?? "").trim();
  return { to: d.toEp, cc: ir ? [IGT_MAIL_CC, ir] : [IGT_MAIL_CC] };
}

/** Step 2a — sends it from the VP's OWN Gmail, so the EP's reply reaches a
 *  person rather than a robot mailbox. */
export async function sendIgtExpectationMail(input: IgtReviewedMail): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canUseIgtExpectationMail(viewer))
    return fail("The IGT leadership sends this mail.", "forbidden");
  const parsed = igtReviewedSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;
  if (!viewer.google_refresh_token)
    return fail(
      "Your Google access is missing — sign out, then sign in with Google once to grant it (it also powers your calendar reminders)."
    );

  const { to, cc } = igtRecipients(d);
  try {
    const { sendMemberEmail } = await import("@/lib/google/gmail");
    const messageId = await sendMemberEmail(viewer.google_refresh_token, {
      to: [to],
      cc,
      subject: d.subject,
      html: d.html,
    });
    if (!messageId) return fail("Google didn't accept the email — try again.");
    if (messageId === "sandbox") return { ok: true };
  } catch (e) {
    console.error("[igt-mail] send failed:", e);
    return fail(
      "Couldn't send the email. Sign out and sign in with Google again to refresh your access, then retry."
    );
  }
  await logAudit(viewer.id, "igt_mail_sent", "system", null, { to, subject: d.subject });
  return { ok: true };
}

/** Step 2b — the same mail as a DRAFT instead, for a VP who wants to attach
 *  something or send it later. */
export async function createIgtExpectationDraft(input: IgtReviewedMail): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!canUseIgtExpectationMail(viewer))
    return fail("The IGT leadership sends this mail.", "forbidden");
  const parsed = igtReviewedSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;
  if (!viewer.google_refresh_token)
    return fail(
      "Your Google access is missing — sign out, then sign in with Google once to grant it (it also powers your calendar reminders)."
    );

  const { to, cc } = igtRecipients(d);
  try {
    const { createMemberDraft } = await import("@/lib/google/gmail");
    const draftId = await createMemberDraft(viewer.google_refresh_token, {
      to,
      cc,
      subject: d.subject,
      html: d.html,
    });
    if (!draftId) return fail("Google didn't accept the draft — try again.");
    if (draftId === "sandbox") return { ok: true };
  } catch (e) {
    console.error("[igt-mail] draft failed:", e);
    return fail(
      "Couldn't create the draft. Sign out and sign in with Google again to refresh your access, then retry."
    );
  }
  await logAudit(viewer.id, "igt_mail_draft", "system", null, { to, subject: d.subject });
  return { ok: true };
}

// ================================================================== OGX sign-ups (v25)

import {
  canEditSignupVpFields,
  canViewSignup,
  canWorkSignup,
  ogxFunctions,
} from "@/lib/rbac";
import {
  SIGNUP_STATUSES, type OgxFunction as OgxFunctionT, type SignupComment,
  type SignupRow,
} from "@/lib/types";

async function loadSignup(id: string): Promise<SignupRow | null> {
  const { data } = await db().from("signups").select("*").eq("id", id).maybeSingle<SignupRow>();
  return data ?? null;
}

/** After every sign-up mutation: reload row + comments and push the workflow
 *  cells back to the tracker sheet ("as fast as possible" two-way sync). */
/** Mirrors one sign-up back to the tracker sheet — AFTER the response.
 *
 *  THIS USED TO BLOCK EVERY EDIT (v33.11). Ticking "Contacted", setting
 *  Interested, saving a comment: each awaited a full Google Sheets round trip
 *  — locate the row by EP ID in a tab read, then write it — before the member
 *  saw anything happen. Three DB reads and a Sheets call for one checkbox is
 *  why "any action on OGX is very slow".
 *
 *  The sheet is a MIRROR, not the source of truth: Sodio owns the workflow
 *  fields once a row is touched. So the write belongs after the response, not
 *  in front of it. `after()` keeps the lambda alive to finish it — a bare
 *  floating promise can be frozen mid-flight on Vercel. */
function pushSignupToSheet(id: string): void {
  after(async () => {
    try {
      await pushSignupToSheetNow(id);
    } catch (e) {
      console.error("[signups] deferred sheet write failed:", id, e);
    }
  });
}

async function pushSignupToSheetNow(id: string): Promise<void> {
  const signup = await loadSignup(id);
  if (!signup) return;
  const [{ data: comments }, assigned] = await Promise.all([
    db().from("signup_comments").select("*").eq("signup_id", id).order("created_at"),
    signup.assigned_to
      ? db()
          .from("members")
          .select("name")
          .eq("id", signup.assigned_to)
          .maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
  ]);
  const { writeSignupBack } = await import("@/lib/google/signups");
  await writeSignupBack(
    signup,
    (comments ?? []) as SignupComment[],
    assigned.data ? assigned.data.name : signup.assigned_name
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
  // THE POOL CAN BE CLOSED (v33.32): some leaders distribute the pool
  // themselves rather than letting members take from it. MMs and above still
  // assign — this only governs self-service.
  {
    const { functionSettingsFor } = await import("./function-settings");
    const s = await functionSettingsFor(signup.fn);
    const isMm =
      viewer.isAdmin ||
      ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(viewer.role);
    if (!s.poolClaimOpen && !isMm)
      return fail(
        "Your function hands out sign-ups rather than letting members claim them — ask your TL or VP for your next one."
      );
  }
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
        assigned_name: viewer.name,
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
  pushSignupToSheet(id);
  stampSignupActivity(viewer); // claiming = today's streak saved
  await stampWork(viewer.id, "signup_claim"); // v29: counts towards working hours
  refresh();
  return { ok: true };
}

/** TL/VP re-assignment (or un-assignment with null). */
export async function reassignSignup(
  id: string,
  memberId: string | null,
  opts?: { skipSheetPush?: boolean; skipRefresh?: boolean }
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
  let target: { id: string; name: string } | null = null;
  if (memberId) {
    const { data } = await db()
      .from("members")
      .select("id, name, is_active, role, functions, sub_functions")
      .eq("id", memberId)
      .maybeSingle<{
        id: string; name: string; is_active: boolean;
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
  const newName = target ? target.name : null;
  if ((target?.id ?? null) === signup.assigned_to && newName === signup.assigned_name)
    return { ok: true };
  await snapshotForUndo("signups", id);
  // A HAND-OVER IS A FRESH START (v33.10). Contacted/Interested describe a
  // conversation the PREVIOUS owner had; carrying them across makes the new
  // person's list look worked when nobody has spoken to these people yet, and
  // the funnel counts a contact twice. The comment history stays — that is
  // the context worth keeping — but the workflow state resets.
  const handedToSomeoneElse =
    !!target && !!signup.assigned_to && target.id !== signup.assigned_to;
  const reset =
    handedToSomeoneElse || (!!target && !signup.assigned_to)
      ? {
          contact_status: null, interested: null, contacted_at: null,
          // the CIC belongs to the FIRST call's context — a hand-over voids
          // the second-call assignment too (v33.19)
          cic_assigned_to: null, cic_assigned_name: null, cic_assigned_at: null,
          cic_contact_status: null, cic_interested: null,
        }
      : {};

  const { error } = await db()
    .from("signups")
    .update(
      touchSignup({
        assigned_to: target?.id ?? null,
        assigned_name: target ? target.name : null,
        assigned_at: target ? new Date().toISOString() : null,
        ...reset,
      })
    )
    .eq("id", id);
  if (error) return fail(error.message);
  await logSignupChange(
    viewer, id, "assigned", signup.assigned_name ?? null, target ? target.name : null
  );
  await logAudit(viewer.id, "signup_reassign", "signup", id, {
    to: target?.id ?? null,
    reset: Object.keys(reset).length > 0,
  });
  if (!opts?.skipSheetPush) pushSignupToSheet(id);
  if (!opts?.skipRefresh) refresh();
  return { ok: true };
}

/** Bulk assign (memberId) or unassign-back-to-the-pool (null) — ≤50 per call,
 *  the client chunks bigger selections. Loops reassignSignup so EVERY row
 *  re-checks scope (VP/Director/LCP-admin: anything in their fn; TL: only
 *  unassigned/own/team rows), keeps sodio_touched, and pushes to the sheet. */
export async function bulkReassignSignups(
  ids: string[],
  memberId: string | null,
  /** v33.11 — tell them, the way the accounts version does. Handing someone
   *  forty sign-ups without a word is how a pile sits untouched for a week. */
  notify = false
): Promise<ActionResult<{ done: number; failed: number; notified: boolean }>> {
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one sign-up.");
  if (ids.length > 50)
    return fail("Max 50 sign-ups per bulk call — run it in batches.");
  // per-row RBAC/scope still re-runs inside; the sheet push is batched below
  const results = await inBatches(ids, (id) =>
    reassignSignup(id, memberId, { skipSheetPush: true, skipRefresh: true })
  );
  const doneIds = ids.filter((_, i) => results[i].ok);
  const done = doneIds.length;
  const failed = ids.length - done;
  refresh();

  // ONE tab read + ONE batch write per sheet instead of ~3 calls per row —
  // and AFTER the response (v33.11), so a fifty-row assign returns as soon as
  // the database is right instead of holding the member while Google catches
  // up. The 15-minute import reconciles anything that fails.
  if (doneIds.length > 0)
    after(async () => {
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
    });

  // the heads-up: a bell always, an email when there is an address (and never
  // to yourself — you know what you just did)
  let notified = false;
  if (notify && memberId && doneIds.length > 0) {
    try {
      const viewer = await getViewer();
      if (memberId !== viewer.id) {
        const { data: target } = await db()
          .from("members")
          .select("id, name, email, role")
          .eq("id", memberId)
          .maybeSingle<{ id: string; name: string; email: string | null; role: string }>();
        if (target) {
          const { data: rows } = await db()
            .from("signups")
            .select("name")
            .in("id", doneIds);
          const names = ((rows ?? []) as { name: string }[]).map((r) => r.name);
          const { notifyMembers } = await import("./notify");
          await notifyMembers(
            [target.id],
            "broadcast",
            `🆕 ${viewer.name} assigned you ${names.length} sign-up${names.length === 1 ? "" : "s"}`,
            `${names.slice(0, 5).join(" · ")}${names.length > 5 ? ` · +${names.length - 5} more` : ""} — they're yours now, reach out!`,
            null,
            "/signups?view=mine"
          );
          if (target.email && target.role !== "LCP") {
            // SIGN-UPS, NOT ACCOUNTS (v33.24) — this used to borrow the
            // raising template and tell an OGX TL she owned 20 "accounts"
            const { signupsAssignedEmail } = await import("@/lib/email/templates");
            const mail = signupsAssignedEmail({
              memberName: target.name,
              managerName: viewer.name,
              signupNames: names,
              signupsUrl: `${env.appUrl}/signups?view=mine`,
            });
            after(async () => {
              try {
                const { sendEmail } = await import("@/lib/google/gmail");
                await sendEmail({ to: [target.email!], subject: mail.subject, html: mail.html });
              } catch (e) {
                console.error("[signups] assignment email failed:", e);
              }
            });
          }
          notified = true;
        }
      }
    } catch (e) {
      console.error("[signups] assignment heads-up failed:", e);
    }
  }

  return { ok: true, data: { done, failed, notified } };
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
  if (input.contactStatus !== undefined)
    await logSignupChange(viewer, id, "contacted", signup.contact_status ?? null, contact);
  if (input.interested !== undefined)
    await logSignupChange(viewer, id, "interested", signup.interested ?? null, clean(input.interested));
  await logAudit(viewer.id, "signup_contact", "signup", id, input);
  pushSignupToSheet(id);
  stampSignupActivity(viewer); // contact update = today's streak saved
  await stampWork(viewer.id, "signup_contact"); // v29: counts towards working hours
  refresh();
  return { ok: true };
}

/** CIC's own entry rule (v33.22), kept in ONE place so the queue query in
 *  data.ts and this gate can never drift apart again:
 *
 *  the first call HAPPENED — Contacted is answered, Yes or No. "No" is not an
 *  absence of a call, it's a call that didn't land, and that is precisely
 *  what a second caller re-tries. The old gate matched /^y/i, so every "No"
 *  was refused by the server and hidden from the queue.
 *
 *  The sheet writes the column free-hand ("yes", "YES", "Y", "no", "N"), so
 *  the test is emptiness, not equality. */
const contactAnswered = (v: string | null | undefined) => (v ?? "").trim() !== "";

/** A sign-up EDIT LOG entry (v33.19) — who changed what, when. Best-effort. */
/** ORGANIC REFERRALS (v33.32).
 *
 *  Not everyone we can approve came through a tracker. Someone's cousin, a
 *  friend from a session, an EP another member sent our way — until now those
 *  people had nowhere to live, so they were worked over WhatsApp and never
 *  appeared in a funnel, a leaderboard or a plan. A referral is simply a
 *  sign-up we created ourselves: same table, same columns, same statuses, same
 *  dashboard.
 *
 *  It carries `source = 'referral'`, which is what keeps the tracker sync away
 *  from it: the importer only ever touches rows whose source is one of the
 *  four sheet tabs, and BOTH write-back paths look the source up in
 *  SIGNUP_TABS and return early when it isn't there. It is also born
 *  `sodio_touched`, so nothing tries to reconcile it with a sheet row that
 *  doesn't exist.
 *
 *  ASSIGNED FROM BIRTH: an unassigned sign-up is invisible to the OGX
 *  dashboard by design (the pool is a to-do list, not progress), and a
 *  referral with nobody on it would be a name in a void. */
export async function addSignupReferral(input: {
  fn: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  /** YYYY-MM-DD — optional, same free-text column the tracker uses */
  dob?: string | null;
  /** where they want to go (v33.32.2) — validated against the country list */
  country?: string | null;
  /** OGT only — GTa / GTe */
  subProduct?: string | null;
  /** who sent them our way (a member's name, an EP, "walk-in") */
  referredBy?: string | null;
  /** THE FUNNEL, FROM THE START (v33.32.2). A referral is usually logged by
   *  the person who already spoke to them, so the form takes the first three
   *  steps instead of making them re-open the row to say what they know. */
  contacted?: string | null;
  interested?: string | null;
  status?: string | null;
  /** optional first comment */
  note?: string | null;
  /** MMs and above may hand it straight to someone else */
  assignTo?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const viewer = await getViewer();
  const fn = String(input.fn ?? "").toUpperCase();
  if (fn !== "OGT" && fn !== "OGV") return fail("Pick OGT or OGV.");
  if (!ogxFunctions(viewer).includes(fn))
    return fail("That's outside your function.", "forbidden");

  const isMm =
    viewer.isAdmin ||
    ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(viewer.role);
  {
    const { functionSettingsFor } = await import("./function-settings");
    const s = await functionSettingsFor(fn);
    if (s.referralsBy === "mms" && !isMm)
      return fail(
        `In ${fn}, referrals are added by TLs and above — send yours to your TL and they'll log it.`
      );
  }

  const name = (input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (name.length < 2) return fail("Type the person's name.");
  const clean = (v: string | null | undefined, max: number) =>
    (v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
  const email = clean(input.email, 200)?.toLowerCase() ?? null;
  if (email && !EMAIL_RE.test(email)) return fail("That email doesn't look right.");
  let phone = clean(input.phone, 40);
  if (phone) {
    const check = normalizePhone(phone);
    if (!check.ok)
      return fail(check.error ?? "That phone number doesn't look right.");
    phone = check.value;
  }
  if (!phone && !email)
    return fail("A referral needs a phone or an email — otherwise nobody can reach them.");

  // who carries it: yourself by default; an MM may hand it to anyone who
  // works this function (the same rule the reassign picker uses)
  let owner = { id: viewer.id, name: viewer.name };
  if (input.assignTo && input.assignTo !== viewer.id) {
    if (!isMm) return fail("Only TLs and above assign a referral to someone else.", "forbidden");
    const { data: target } = await db()
      .from("members")
      .select("id, name, functions, sub_functions")
      .eq("id", input.assignTo)
      .eq("is_active", true)
      .maybeSingle<{ id: string; name: string; functions: string[] | null; sub_functions: string[] | null }>();
    if (!target) return fail("Pick an active member.");
    if (![...(target.functions ?? []), ...(target.sub_functions ?? [])].includes(fn))
      return fail(`${target.name} doesn't work ${fn}.`);
    owner = { id: target.id, name: target.name };
  }

  // a date only counts when it IS one — the column is free text, the field
  // is a date picker, and a half-typed year must not be stored as fact
  const dobRaw = clean(input.dob, 10);
  const dob = dobRaw && /^\d{4}-\d{2}-\d{2}$/.test(dobRaw) ? dobRaw : null;
  if (dobRaw && !dob) return fail("That date of birth isn't a real date.");
  // the country is validated against the real list, exactly like a booking
  const countryRaw = clean(input.country, 60);
  let country: string | null = null;
  if (countryRaw) {
    const { COUNTRIES } = await import("@/lib/countries");
    const { resolveCountry } = await import("@/lib/timezones");
    country = resolveCountry(countryRaw, COUNTRIES);
    if (!country) return fail(`"${countryRaw}" isn't a country we know — pick one from the list.`);
  }
  const yesNo = (v: string | null | undefined) =>
    v === "Yes" || v === "No" ? v : null;
  const contacted = yesNo(input.contacted);
  const interested = yesNo(input.interested);
  const status =
    input.status && (SIGNUP_STATUSES as readonly string[]).includes(input.status)
      ? input.status
      : null;
  // Parents Approval is a VP call everywhere else — it stays one here
  if (status === "Parents Approval" && !canEditSignupVpFields(viewer, { fn: fn as OgxFunctionT }))
    return fail("Only a VP/Director sets Parents Approval.", "forbidden");

  const now = new Date();
  const epId = `REF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const { data: created, error } = await db()
    .from("signups")
    .insert({
      fn,
      batch: "new",
      source: "referral",
      ep_id: epId,
      name,
      phone,
      email,
      dob,
      country,
      contact_status: contacted,
      contacted_at: contacted ? now.toISOString() : null,
      interested,
      status,
      sub_product: fn === "OGT" ? clean(input.subProduct, 20) : null,
      program: fn === "OGV" ? "Global Volunteer" : clean(input.subProduct, 20),
      referral: clean(input.referredBy, 120),
      campaign: "Referral",
      signed_up_at: now.toISOString().slice(0, 10),
      assigned_to: owner.id,
      assigned_name: owner.name,
      assigned_at: now.toISOString(),
      sodio_touched: true,
      out_of_process: false,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return fail("That referral already exists — try again.");
    return fail(error.message);
  }

  if (input.note) {
    const body = clean(input.note, 2000);
    if (body)
      await db().from("signup_comments").insert({
        signup_id: created.id,
        author_id: viewer.id,
        author_name: viewer.name,
        author_class: isMm ? "vp" : "member",
        body,
      }).then(({ error: e }) => {
        if (e) console.error("[signups] referral comment failed:", e.message);
      });
  }

  await logSignupChange(viewer, created.id, "referral_added", null, name);
  if (owner.id !== viewer.id) {
    await logSignupChange(viewer, created.id, "assigned", null, owner.name);
    const { notifyMembers } = await import("./notify");
    await notifyMembers(
      [owner.id],
      "info",
      `🤝 A referral is yours — ${name}`,
      `${viewer.name} logged an organic referral in ${fn} and put it on you. Call them and move them through the funnel like any sign-up.`,
      null,
      "/signups?view=mine"
    );
  }
  await logAudit(viewer.id, "signup_referral_add", "signup", created.id, { fn, name });
  refresh();
  return { ok: true, data: { id: created.id } };
}

async function logSignupChange(
  viewer: { id: string; name: string },
  signupId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null
): Promise<void> {
  if (oldValue === newValue) return;
  await db()
    .from("signup_logs")
    .insert({
      signup_id: signupId,
      member_id: viewer.id,
      member_name: viewer.name,
      field,
      old_value: oldValue,
      new_value: newValue,
    })
    .then(({ error }) => {
      if (error) console.error("[signups] log failed:", error.message);
    });
}

/** CIC — assign the SECOND caller (v33.19). MMs+ only. The first assignee and
 *  their contacted/interested/KPIs are untouched: the second call lives in
 *  the cic_* columns. */
/** TAKE THE SECOND CALL BACK (v33.26). Handing out a CIC was one-way: a
 *  caller who left the function, or a row handed to the wrong person, could
 *  never be cleared. Clearing it returns the sign-up to the CIC queue — the
 *  first assignee and their numbers are untouched either way. */
export async function clearCicCaller(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const { seesCicQueue } = await import("./data");
  const signup = await loadSignup(id);
  if (!signup) return fail("Sign-up not found.");
  const isCaller = signup.cic_assigned_to === viewer.id;
  if (!isCaller && !seesCicQueue(viewer))
    return fail("CIC is handed out by MMs and above.", "forbidden");
  if (!isCaller && !ogxFunctions(viewer).includes(signup.fn))
    return fail("This sign-up isn't in your function.", "forbidden");
  if (!signup.cic_assigned_to) return { ok: true };
  await snapshotForUndo("signups", id);
  const { error } = await db()
    .from("signups")
    .update({
      cic_assigned_to: null,
      cic_assigned_name: null,
      cic_assigned_at: null,
      cic_contact_status: null,
      cic_interested: null,
    })
    .eq("id", id);
  if (error) return fail(error.message);
  // the open (outcome-less) OGX history row goes with it; rows that already
  // hold a recorded call stay — they happened
  await db()
    .from("signup_cic_calls")
    .delete()
    .eq("signup_id", id)
    .eq("side", "OGX")
    .eq("caller_id", signup.cic_assigned_to)
    .is("contact_status", null);
  await logSignupChange(viewer, id, "cic_assigned", signup.cic_assigned_name ?? null, null);
  await logAudit(viewer.id, "cic_clear", "signup", id, {});
  refresh();
  return { ok: true };
}

export async function assignCicCaller(
  id: string,
  callerId: string,
  /** internal — the bulk wrapper below sends ONE bell and refreshes once */
  opts: { quiet?: boolean } = {}
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { seesCicQueue } = await import("./data");
  if (!seesCicQueue(viewer)) return fail("CIC is handed out by MMs and above.", "forbidden");
  const signup = await loadSignup(id);
  if (!signup) return fail("Sign-up not found.");
  // HANDING OUT A VERIFICATION CALL IS NOT AN OWNERSHIP CHANGE (v33.19
  // review). `canWorkSignup` asks "is this row yours/your team's" — which is
  // false for most of the queue an MM is looking at, so the server refused
  // exactly the rows the CIC tab exists to distribute. The queue's own
  // predicate is the right gate: MM+ inside the sign-up's function.
  if (!ogxFunctions(viewer).includes(signup.fn))
    return fail("This sign-up isn't in your function.", "forbidden");
  // the function's leader can switch the second call off entirely (v33.32)
  {
    const { functionSettingsFor } = await import("./function-settings");
    if (!(await functionSettingsFor(signup.fn)).cicEnabled)
      return fail(
        `${signup.fn} doesn't run second calls — your VP can turn CIC back on from their profile.`
      );
  }
  // the same three conditions the queue itself is built from — held by a real
  // member, first call answered, no status yet
  if (!signup.assigned_to)
    return fail("Assign the sign-up to someone first — CIC verifies a call that happened.");
  if (!contactAnswered(signup.contact_status) || signup.status)
    return fail("Only a contacted sign-up with no status yet goes to CIC.");
  const { data: caller } = await db()
    .from("members")
    .select("id, name, functions, sub_functions")
    .eq("id", callerId)
    .eq("is_active", true)
    .maybeSingle<{ id: string; name: string; functions: string[] | null; sub_functions: string[] | null }>();
  if (!caller) return fail("Pick an active member.");
  if (![...(caller.functions ?? []), ...(caller.sub_functions ?? [])].includes(signup.fn))
    return fail(`The second caller must work ${signup.fn}.`);
  if (caller.id === signup.assigned_to)
    return fail("The second caller can't be the first assignee — that's the whole point.");
  await snapshotForUndo("signups", id);
  const { error } = await db()
    .from("signups")
    .update({
      cic_assigned_to: caller.id,
      cic_assigned_name: caller.name,
      cic_assigned_at: new Date().toISOString(),
      // a fresh second call starts blank — the first call's numbers stay put
      cic_contact_status: null,
      cic_interested: null,
    })
    .eq("id", id);
  if (error) return fail(error.message);
  // the CALL HISTORY row (v33.29, signup_cic_calls): every hand-out is its
  // own row, side-tagged, so many CIC calls can live on one sign-up — an
  // open OGX one and an open B2C one at once, plus everything before them
  await db().from("signup_cic_calls").insert({
    signup_id: id, side: "OGX", caller_id: caller.id, caller_name: caller.name,
    assigned_by: viewer.id, assigned_by_name: viewer.name,
  });
  await logSignupChange(viewer, id, "cic_assigned", signup.cic_assigned_name ?? null, caller.name);
  if (!opts.quiet)
    await import("./notify").then(({ notifyMembers }) =>
      notifyMembers(
        [caller.id],
        "info",
        `📞 CIC call to make — ${signup.name}`,
        "A customer interview call: check the first contact really happened and follow up.",
        viewer.id,
        "/signups"
      )
    );
  await logAudit(viewer.id, "cic_assign", "signup", id, { caller: caller.id });
  if (!opts.quiet) refresh();
  return { ok: true };
}

/** CIC in bulk (v33.21) — the queue is a LIST, and handing it out one row at a
 *  time is why it doesn't get handed out. Same per-row gate (assignCicCaller
 *  re-checks everything), one bell and one refresh at the end.
 *
 *  This is deliberately NOT `bulkReassignSignups`: a CIC hand-out must never
 *  move the row itself — the first assignee keeps it and keeps their numbers. */
export async function bulkAssignCicCaller(
  ids: string[],
  callerId: string,
  notify = true
): Promise<ActionResult<{ done: number; failed: number; why?: string }>> {
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one sign-up.");
  if (ids.length > 50) return fail("Max 50 sign-ups per bulk call — run it in batches.");
  const results = await inBatches(ids, (id) => assignCicCaller(id, callerId, { quiet: true }));
  const done = results.filter((r) => r.ok).length;
  const failed = ids.length - done;
  refresh();
  if (done > 0 && notify) {
    const viewer = await getViewer();
    await import("./notify").then(({ notifyMembers }) =>
      notifyMembers(
        [callerId],
        "info",
        `📞 ${done} CIC call${done === 1 ? "" : "s"} to make`,
        "Customer interview calls: check the first contact really happened and follow up.",
        viewer.id,
        "/signups"
      )
    );
  }
  // the first refusal is the useful one — 50 identical messages are not
  const why = results.find((r) => !r.ok)?.error;
  return { ok: true, data: { done, failed, why: failed ? why : undefined } };
}

/** CIC — the second caller records THEIR contacted/interested (v33.19). Writes
 *  only cic_* columns; the funnel's Contacted/Interested (the first call) are
 *  never touched, so KPIs/MOS are safe. */
export async function updateCicContact(
  id: string,
  input: { contactStatus?: string | null; interested?: string | null }
): Promise<ActionResult> {
  const viewer = await getViewer();
  const signup = await loadSignup(id);
  if (!signup) return fail("Sign-up not found.");
  const { seesCicQueue } = await import("./data");
  const isSecondCaller = signup.cic_assigned_to === viewer.id;
  if (!isSecondCaller && !seesCicQueue(viewer))
    return fail("Only the assigned CIC caller (or an MM) can record this.", "forbidden");
  if (!isSecondCaller && !ogxFunctions(viewer).includes(signup.fn))
    return fail("This sign-up isn't in your function.", "forbidden");
  const clean = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    if (!t) return null;
    return /^y/i.test(t) ? "Yes" : /^n/i.test(t) ? "No" : t;
  };
  const update: Record<string, unknown> = {};
  if (input.contactStatus !== undefined) {
    const next = clean(input.contactStatus);
    await logSignupChange(viewer, id, "cic_contacted", signup.cic_contact_status ?? null, next);
    update.cic_contact_status = next;
  }
  if (input.interested !== undefined) {
    const next = clean(input.interested);
    await logSignupChange(viewer, id, "cic_interested", signup.cic_interested ?? null, next);
    update.cic_interested = next;
  }
  if (Object.keys(update).length === 0) return { ok: true };
  await snapshotForUndo("signups", id);
  const { error } = await db().from("signups").update(update).eq("id", id);
  if (error) return fail(error.message);
  // mirror onto the caller's history row (v33.29) — the latest OGX one
  if (signup.cic_assigned_to) {
    const { data: openRow } = await db()
      .from("signup_cic_calls")
      .select("id")
      .eq("signup_id", id)
      .eq("side", "OGX")
      .eq("caller_id", signup.cic_assigned_to)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (openRow) {
      const rowUpdate: Record<string, unknown> = {};
      if (update.cic_contact_status !== undefined) rowUpdate.contact_status = update.cic_contact_status;
      if (update.cic_interested !== undefined) rowUpdate.interested = update.cic_interested;
      await db().from("signup_cic_calls").update(rowUpdate).eq("id", openRow.id);
    }
  }
  stampSignupActivity(viewer);
  await stampWork(viewer.id, "signup_contact");
  await logAudit(viewer.id, "cic_contact", "signup", id, input);
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------- B2C CIC (v33.29)

/** B2C CALLS THE SIGN-UP POOL TOO. The OGX crew's CIC verifies the first
 *  call; B2C's CIC SELLS — courses, events, student activities — to people
 *  who already picked up the phone once. Both live in `signup_cic_calls`,
 *  side-tagged, so one sign-up can carry an open OGX call AND an open B2C
 *  call at once, and the log says which side made which. The OGX funnel is
 *  never touched by a B2C row.
 *
 *  Assignment matrix (the LCP's spec): a B2C TL hands calls to themself or
 *  their own team; a B2C Coordinator takes them themself; the B2C
 *  LCVP/Director (and LCP-level) hand to any B2C member. */
export async function assignB2cCic(
  signupId: string,
  callerId: string,
  opts: { quiet?: boolean } = {}
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { seesB2cCicQueue } = await import("./data");
  if (!seesB2cCicQueue(viewer))
    return fail("B2C CIC is handed out by B2C MMs and above.", "forbidden");
  const signup = await loadSignup(signupId);
  if (!signup) return fail("Sign-up not found.");
  if (!signup.assigned_to)
    return fail("This sign-up is still in the unassigned pool — it hasn't had its first call.");
  if (!contactAnswered(signup.contact_status))
    return fail("B2C calls people the first call already reached — Contacted must be answered (Yes or No).");
  const { data: caller } = await db()
    .from("members")
    .select("id, name, functions, sub_functions, stakeholder_id")
    .eq("id", callerId)
    .eq("is_active", true)
    .maybeSingle<{
      id: string; name: string;
      functions: string[] | null; sub_functions: string[] | null;
      stakeholder_id: string | null;
    }>();
  if (!caller) return fail("Pick an active member.");
  const callerIsB2c = [...(caller.functions ?? []), ...(caller.sub_functions ?? [])].includes("B2C");
  if (!callerIsB2c) return fail("The B2C caller must work B2C.");
  const lcpLevel = master(viewer) || ["LCVP", "Director"].includes(viewer.role);
  if (!lcpLevel) {
    // TL → self + own team · Coordinator → self
    const mine =
      caller.id === viewer.id ||
      (viewer.role === "Team Leader" && viewer.teamMemberIds.includes(caller.id));
    if (!mine)
      return fail(
        viewer.role === "Team Leader"
          ? "A B2C TL hands calls to themself or their own team."
          : "As a B2C Coordinator you take the call yourself — leaders hand out further."
      );
  }
  // ONE open B2C call per sign-up: replace the open row's caller, else insert
  const { data: openRow } = await db()
    .from("signup_cic_calls")
    .select("id, caller_name")
    .eq("signup_id", signupId)
    .eq("side", "B2C")
    .is("contact_status", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; caller_name: string }>();
  if (openRow) {
    const { error } = await db()
      .from("signup_cic_calls")
      .update({
        caller_id: caller.id, caller_name: caller.name,
        assigned_by: viewer.id, assigned_by_name: viewer.name,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", openRow.id);
    if (error) return fail(error.message);
    await logSignupChange(viewer, signupId, "cic_b2c_assigned", openRow.caller_name, caller.name);
  } else {
    const { error } = await db().from("signup_cic_calls").insert({
      signup_id: signupId, side: "B2C", caller_id: caller.id, caller_name: caller.name,
      assigned_by: viewer.id, assigned_by_name: viewer.name,
    });
    if (error) return fail(error.message);
    await logSignupChange(viewer, signupId, "cic_b2c_assigned", null, caller.name);
  }
  if (!opts.quiet)
    await import("./notify").then(({ notifyMembers }) =>
      notifyMembers(
        [caller.id],
        "info",
        `📞 B2C call to make — ${signup.name}`,
        "They already answered the OGX first call — pitch them what B2C has for them.",
        viewer.id,
        "/signups?view=cic"
      )
    );
  await logAudit(viewer.id, "cic_b2c_assign", "signup", signupId, { caller: caller.id });
  if (!opts.quiet) refresh();
  return { ok: true };
}

/** B2C CIC in bulk — same per-row gate, one bell, one refresh. */
export async function bulkAssignB2cCic(
  ids: string[],
  callerId: string
): Promise<ActionResult<{ done: number; failed: number; why?: string }>> {
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one sign-up.");
  if (ids.length > 50) return fail("Max 50 sign-ups per bulk call — run it in batches.");
  const results = await inBatches(ids, (id) => assignB2cCic(id, callerId, { quiet: true }));
  const done = results.filter((r) => r.ok).length;
  const failed = ids.length - done;
  refresh();
  if (done > 0) {
    const viewer = await getViewer();
    await import("./notify").then(({ notifyMembers }) =>
      notifyMembers(
        [callerId],
        "info",
        `📞 ${done} B2C call${done === 1 ? "" : "s"} to make`,
        "People the OGX first call already reached — pitch them what B2C has.",
        viewer.id,
        "/signups?view=cic"
      )
    );
  }
  const why = results.find((r) => !r.ok)?.error;
  return { ok: true, data: { done, failed, why: failed ? why : undefined } };
}

/** The B2C caller records THEIR call — never the OGX funnel. */
export async function updateB2cCic(
  callRowId: string,
  input: { contactStatus?: string | null; interested?: string | null; note?: string | null }
): Promise<ActionResult> {
  const viewer = await getViewer();
  const { data: row } = await db()
    .from("signup_cic_calls")
    .select("id, signup_id, side, caller_id, caller_name, contact_status, interested, note")
    .eq("id", callRowId)
    .maybeSingle<{
      id: string; signup_id: string; side: string; caller_id: string | null;
      caller_name: string; contact_status: string | null; interested: string | null; note: string | null;
    }>();
  if (!row || row.side !== "B2C") return fail("That B2C call no longer exists.");
  const { seesB2cCicQueue } = await import("./data");
  if (row.caller_id !== viewer.id && !seesB2cCicQueue(viewer))
    return fail("Only the assigned B2C caller (or a B2C MM) can record this.", "forbidden");
  const clean = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    if (!t) return null;
    return /^y/i.test(t) ? "Yes" : /^n/i.test(t) ? "No" : t;
  };
  const update: Record<string, unknown> = {};
  if (input.contactStatus !== undefined) {
    const next = clean(input.contactStatus);
    await logSignupChange(viewer, row.signup_id, "cic_b2c_contacted", row.contact_status, next);
    update.contact_status = next;
  }
  if (input.interested !== undefined) {
    const next = clean(input.interested);
    await logSignupChange(viewer, row.signup_id, "cic_b2c_interested", row.interested, next);
    update.interested = next;
  }
  if (input.note !== undefined) update.note = (input.note ?? "").trim().slice(0, 500) || null;
  if (Object.keys(update).length === 0) return { ok: true };
  const { error } = await db().from("signup_cic_calls").update(update).eq("id", callRowId);
  if (error) return fail(error.message);
  stampSignupActivity(viewer);
  await stampWork(viewer.id, "signup_contact");
  await logAudit(viewer.id, "cic_b2c_record", "signup", row.signup_id, input);
  refresh();
  return { ok: true };
}

/** Take a B2C call back — the sign-up returns to the B2C queue. */
export async function clearB2cCic(callRowId: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const { data: row } = await db()
    .from("signup_cic_calls")
    .select("id, signup_id, side, caller_id, caller_name, contact_status")
    .eq("id", callRowId)
    .maybeSingle<{
      id: string; signup_id: string; side: string; caller_id: string | null;
      caller_name: string; contact_status: string | null;
    }>();
  if (!row || row.side !== "B2C") return { ok: true };
  const { seesB2cCicQueue } = await import("./data");
  if (row.caller_id !== viewer.id && !seesB2cCicQueue(viewer))
    return fail("Only the caller (or a B2C MM) can take the call back.", "forbidden");
  if (row.contact_status)
    return fail("This call was already recorded — it's history now, not an open hand-out.");
  const { error } = await db().from("signup_cic_calls").delete().eq("id", callRowId);
  if (error) return fail(error.message);
  await logSignupChange(viewer, row.signup_id, "cic_b2c_assigned", row.caller_name, null);
  await logAudit(viewer.id, "cic_b2c_clear", "signup", row.signup_id, {});
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
      author_name: viewer.name,
      author_class: isVpClass ? "vp" : "member",
      body: clean,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return fail(error.message);
  if (inserted) await recordUndo("signup_comments", inserted.id, "insert");
  await db().from("signups").update(touchSignup()).eq("id", id);
  await logAudit(viewer.id, "signup_comment", "signup", id);
  pushSignupToSheet(id);
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
  // ONE STATUS FIELD (v33.13): every stage lives here now, not split between
  // an owner's "Potential" and a VP's "Status" writing the same column.
  const next = status?.trim() || null;
  if (next !== null && !(SIGNUP_STATUSES as readonly string[]).includes(next))
    return fail("Pick a valid status.");
  // "Parents Approval" is still a VP call, whichever control you came from
  if (next === "Parents Approval" && !canEditSignupVpFields(viewer, signup))
    return fail('"Parents Approval" is set by your VP/Director.', "forbidden");
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
  await logSignupChange(viewer, id, "status", signup.status ?? null, next);
  await stampWork(viewer.id, "signup_status"); // v33.18: counts towards working hours
  await logAudit(viewer.id, "signup_potential", "signup", id, {
    from: signup.status,
    to: next,
  });
  // the push stamps Time Stamp etc. — the status cell itself stays system-only
  pushSignupToSheet(id);
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
  await stampWork(viewer.id, "signup_vp_fields"); // v33.18
  await logAudit(viewer.id, "signup_vp_fields", "signup", id, input);
  pushSignupToSheet(id);
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
  pushSignupToSheet(id);
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
  pushSignupToSheet(id);
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
    // a human pressing the button IS the force case (v33.19 review)
  const res = await importSignups({ force: true });
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
      publicRead: true, // screenshots are for whoever opens the call (v33.29)
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
  const { COUNTRIES } = await import("@/lib/countries");
  const { resolveCountry } = await import("@/lib/timezones");
  const country = resolveCountry(input.country, COUNTRIES);
  // NORMALIZED duplicate check (v33.17): "Lc kocaeli", "kocaeli" and
  // "AIESEC in Kocaeli" are one LC — the unique lower(name) index can't see
  // that, so match the whole (small) registry by normalized name first
  const dup = await findPartnerLcByNormalizedName(name);
  if (dup) {
    // ADD-ONLY (v33.23): the crew supplying a country for a row that has none
    // used to be discarded along with the duplicate. Nothing is ever
    // overwritten — a wrong country is a wrong time zone.
    if (!dup.country && country) {
      await db().from("partner_lcs").update({ country }).eq("id", dup.id).is("country", null);
      return { ok: true, data: { ...dup, country } };
    }
    return { ok: true, data: dup };
  }
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

/** The whole registry compared by `normalizeLcName` — small table, and the
 *  only way to catch "İstanbul Asia" vs "istanbul asia" or "Lc kocaeli" vs
 *  "kocaeli" (the unique index is exact-lower only). */
async function findPartnerLcByNormalizedName(name: string): Promise<PartnerLc | null> {
  const norm = normalizeLcName(name);
  if (!norm) return null;
  const { data } = await db()
    .from("partner_lcs")
    .select("id, name, country")
    .limit(1000);
  return (
    ((data ?? []) as PartnerLc[]).find((p) => normalizeLcName(p.name) === norm) ?? null
  );
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
    cvPoolLink?: string | null;
  screenshot?: { name: string; mimeType: string; dataBase64: string } | null;
  /** GV or GT — defaults to the caller's own product function (v33.23) */
  product?: string | null;
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
      // only a real http(s) link is stored — a half-typed one is worse than
      // none, because it looks clickable and isn't
      cv_pool_link: (() => {
        const v = (input.cvPoolLink ?? "").trim().slice(0, 500);
        return v && URL_RE.test(v) ? v : null;
      })(),
      screenshot_drive_id: screenshot?.id ?? null,
      screenshot_name: screenshot?.name ?? null,
      screenshot_link: screenshot?.link ?? null,
      // GV or GT, from the caller's own product function (v33.23); a member
      // who works both leaves it null and sets it in the in-call notes
      product: input.product === "GV" || input.product === "GT"
        ? input.product
        : irProductForMember(viewer),
      member_id: viewer.id,
      member_name: viewer.name,
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
  /** v33.37 — cap the calls one Cairo day may hold; null = unlimited */
  maxPerDay?: number | null;
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
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120)
    return fail("The buffer between calls must be between 0 minutes and 2 hours.");
  const maxPerDay =
    input.maxPerDay == null || input.maxPerDay === 0 ? null : Number(input.maxPerDay);
  if (maxPerDay !== null && (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 10))
    return fail("The daily cap must be between 1 and 10 calls (or no limit).");
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
    // "until MIDNIGHT" (v33.16): a to-time of 00:00 (the picker's "12 AM")
    // means the END of the day, and 23:59 was every member's workaround for
    // it — both read as 24:00, so a 22:00 → 00:00 window is 2 hours, not -22
    const endMins = (t: string) => {
      const m = mins(t);
      return m === 0 || m === 1439 ? 1440 : m;
    };
    if (endMins(to) - mins(from) < slotMinutes)
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
    // end 00:00 / 23:59 = midnight (must sort as the LATEST window, not the earliest)
    const toEndM = (t: string) => {
      const m = toM(t);
      return m === 0 || m === 1439 ? 1440 : m;
    };
    type Win = { from: number; to: number; label: string };
    const overlapIn = (list: Win[]): string | null => {
      const s = [...list].sort((a, b) => a.from - b.from);
      for (let i = 1; i < s.length; i++)
        if (s[i].from < s[i - 1].to) return `${s[i].label} overlaps ${s[i - 1].label}`;
      return null;
    };
    const win = (w: { from: string; to: string }): Win => ({
      from: toM(w.from), to: toEndM(w.to), label: `${w.from} → ${w.to}`,
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
    max_per_day: maxPerDay,
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
  /** the IANA zone the IR was LOOKING at while they picked (v33.22) — the
   *  page renders in it, and every later email speaks it back to them */
  tz?: string | null;
  /** what they want to talk about (v33.24) — the host used to walk in blind */
  note?: string | null;
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
  // the DOMAIN is checked while they can still fix it (v33.29) — a mailbox
  // can't be proven pre-send, but a dead or typo'd domain can be refused now
  {
    const { emailDomainIssue } = await import("@/lib/email-check");
    const issue = await emailDomainIssue(bookerEmail);
    if (issue) return fail(issue);
  }
  // country only counts when it IS a country — public input never gets to
  // store free text (CountryInput is client-side sugar, not validation)
  const countryRaw = plain(input.country, 60);
  const { COUNTRIES } = await import("@/lib/countries");
  const { resolveCountry } = await import("@/lib/timezones");
  // ENDONYMS COUNT (v33.23): an IR who types "Türkiye" or "UK" means a country
  // we know, and throwing it away leaves the LC with no country — and so no
  // fallback time zone for anyone who books from a device we can't read.
  // Still an exact match against a known list; still never a guess.
  const country = resolveCountry(countryRaw, COUNTRIES);
  // v29: name + role are REQUIRED on the public page (validated here too —
  // a public endpoint never trusts the client)
  const bookerName = plain(input.bookerName, 100);
  if (!bookerName) return fail("Tell us your name.");
  const bookerRole = plain(input.bookerRole, 40);
  if (!isKnownIrRole(bookerRole)) return fail("Pick your role in your LC.");
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
  // untrusted: an unknown zone must never reach toLocaleString, which throws
  const { isValidZone, whenLabelInZone } = await import("@/lib/timezones");
  const bookerTz = isValidZone(input.tz) ? String(input.tz) : null;
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
      "member_id, slug, slot_minutes, availability, active, buffer_minutes, min_notice_minutes, max_advance_days, start_date, end_date, guests_can_invite, max_per_day"
    )
    .ilike("slug", slug)
    .maybeSingle<IrBookingSettings>();
  if (!settings?.active) return fail("This booking link is not active.");
  const { data: owner } = await db()
    .from("members")
    .select("id, name, email, fallback_email, google_refresh_token, is_active, functions, sub_functions")
    .eq("id", settings.member_id)
    .maybeSingle<{
      id: string;
      name: string;
      email: string | null;
      google_refresh_token: string | null;
      is_active: boolean;
      functions: string[] | null;
      sub_functions: string[] | null;
    }>();
  if (!owner?.is_active) return fail("This booking link is not active.");
  const memberName = owner.name;

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
  // WHAT THE IR SEES vs WHAT WE SEE (v33.22): the crew works in Cairo, the IR
  // works at home, and both labels describe the same instant. Their label
  // leads in everything sent to them; ours leads in everything sent to us.
  const theirLabel = bookerTz ? whenLabelInZone(startIso, bookerTz) : null;

  // resolve / create the partner LC by NORMALIZED name (v33.17): IRs type
  // their LC free-hand, and "kocaeli" / "Lc kocaeli" / "AIESEC in Kocaeli"
  // must land on ONE registry row, not mint duplicates
  const esc = lcName.replaceAll("%", "\\%").replaceAll("_", "\\_");
  let lc: PartnerLc | null = await findPartnerLcByNormalizedName(lcName);
  if (lc) {
    // anonymous input never MUTATES an existing internal record — with ONE
    // add-only exception: a row missing its country may take the booker's
    // (nothing is overwritten, and the crew can still correct it in Sodio)
    if (!lc.country && country) {
      await db().from("partner_lcs").update({ country }).eq("id", lc.id).is("country", null);
      lc = { ...lc, country };
    }
    // same add-only rule for the zone — it becomes the fallback for this
    // LC's older calls, which carry no zone of their own
    if (bookerTz)
      await db().from("partner_lcs").update({ timezone: bookerTz }).eq("id", lc.id).is("timezone", null);
  } else {
    const ins = await db()
      .from("partner_lcs")
      .insert({ name: lcName, country, timezone: bookerTz })
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

  // EVERY IR BECOMES A REAL PERSON IN THE REGISTRY (v33.24). They used to
  // exist only as a snapshot on the call, which is why nothing could be
  // attached to them — no note, no product tag, no correction. Best-effort:
  // a failure here must never cost the booking.
  await db()
    .from("partner_lc_contacts")
    .upsert(
      {
        partner_lc_id: lc.id,
        name: bookerName,
        role: bookerRole,
        email: bookerEmail,
        phone: bookerPhone,
        product: irProductForMember(owner),
        source: "booking",
      },
      { onConflict: "partner_lc_id,email", ignoreDuplicates: true }
    )
    .then(undefined, (e) => console.error("[ir-booking] contact upsert failed:", e));

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
      booker_tz: bookerTz,
      booker_note: plain(input.note, 1000) || null,
      // which product this conversation is about, snapshotted at booking time
      // so a later function move can't rewrite it (v33.23)
      product: irProductForMember(owner),
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

  // best-effort calendar event + Meet room (a dead grant must never fail the
  // booking): the IR is a real attendee (Google emails the invite).
  // The IR is an ATTENDEE — they read this description. It must carry nothing
  // internal: no CRM link (they can't open it), no Sodio branding they have
  // no context for. Just who is meeting whom (v32.8).
  const bookerNote = plain(input.note, 1000);
  const eventDescription = `AIESEC IR call.\nPartner LC: ${lc.name}${
    country ? ` (${country})` : ""
  }${bookerName ? `\nBooked by: ${bookerName}` : ""}${
    bookerPhone ? ` · ${bookerPhone}` : ""
  } <${bookerEmail}>\nHost: ${owner.name}, AIESEC in Alexandria.${
    bookerNote ? `\n\nWhat they'd like to talk about:\n${bookerNote}` : ""
  }`;
  let meetLink: string | null = null;
  try {
    const {
      createIrCallEvent, createIrCallEventOnMailbox,
    } = await import("@/lib/google/calendar");
    // TIER 1 — the owner's own calendar (they run the Meet)
    const own = owner.google_refresh_token
      ? await createIrCallEvent(owner.google_refresh_token, {
          partnerLc: lc.name, start, minutes: settings.slot_minutes,
          attendeeEmail: bookerEmail,
          guestsCanInvite: settings.guests_can_invite ?? true,
          description: eventDescription,
        // a REVOKED grant throws here; without this catch the whole block
        // aborted and the IR got no invite at all — the fallback exists for
        // exactly this case (v33.19 review)
        }).catch((e) => {
          console.error("[ir-booking] owner calendar failed, trying mailbox:", e);
          return null;
        })
      : null;
    if (own) {
      meetLink = own.meetLink;
      await db()
        .from("ir_calls")
        .update({ calendar_event_id: own.id, meet_link: own.meetLink, event_calendar: "owner" })
        .eq("id", created.id);
    } else {
      // TIER 2 — the member has no Google grant (password sign-in): host the
      // event + Meet on the IM MAILBOX calendar so the IR still gets an invite
      // and the crew still gets a link (v33.19). The owner is invited too so
      // it lands on their calendar even without a grant.
      const viaMailbox = await createIrCallEventOnMailbox({
        partnerLc: lc.name, start, minutes: settings.slot_minutes,
        attendeeEmail: bookerEmail,
        // the AIESEC address, or the personal fallback until it lands — an
        // invited attendee walks straight into the Meet; an anonymous guest
        // knocks at a door whose host (the IM mailbox) never opens it (v33.29)
        ownerEmail: owner.email ?? (owner as { fallback_email?: string | null }).fallback_email ?? null,
        guestsCanInvite: settings.guests_can_invite ?? true,
        description: eventDescription,
      });
      if (viaMailbox) {
        meetLink = viaMailbox.meetLink;
        await db()
          .from("ir_calls")
          .update({
            calendar_event_id: viaMailbox.id, meet_link: viaMailbox.meetLink,
            event_calendar: "mailbox",
          })
          .eq("id", created.id);
      }
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
        memberFirstName: (owner.name).split(" ")[0],
        partnerLc: lc.name,
        country,
        bookerName,
        bookerEmail,
        whenLabel,
        slotMinutes: settings.slot_minutes,
        meetLink,
        note: bookerNote || null,
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
      whenLabel: theirLabel ?? whenLabel,
      cairoLabel: theirLabel ? whenLabel : null,
      slotMinutes: settings.slot_minutes,
      meetLink,
      manageUrl: `${env.appUrl}/book/manage/${manageToken}`,
    });
    await sendEmail({ to: [bookerEmail], subject: confirm.subject, html: confirm.html });
  } catch (e) {
    console.error("[ir-booking] booker confirmation email failed:", e);
    // A SEND THAT FAILS ON THE SPOT IS A BOUNCE WE ALREADY KNOW ABOUT
    // (v33.32). Gmail rejects some addresses synchronously — waiting for the
    // 15-minute bounce watcher to notice something we were just told is a
    // gap with no upside. Flag it now and put it in the host's hands.
    try {
      await db()
        .from("ir_calls")
        .update({ email_bounced_at: new Date().toISOString() })
        .eq("id", created.id);
      const { notifyMembers } = await import("./notify");
      await notifyMembers(
        [owner.id],
        "info",
        `⚠️ ${bookerName}'s email was rejected — ${lc.name}`,
        `We couldn't deliver anything to ${bookerEmail}. WhatsApp them (${bookerPhone}) for the right address, then open the call on Consideration → Fix the email.`,
        null,
        "/consideration"
      );
    } catch (inner) {
      console.error("[ir-booking] bounce flag failed:", inner);
    }
  }

  await logAudit(null, "ir_call_booked", "ir_call", created.id, {
    lc: lc.name,
    slug,
    when: whenLabel,
  });
  return { ok: true, data: { memberName, whenLabel: theirLabel ?? whenLabel, meetLink } };
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
    /** the partner LC's own CV pool, when they share one (v33.6) */
    cvPoolLink?: string | null;
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
      // only a real http(s) link is stored — a half-typed one is worse than
      // none, because it looks clickable and isn't
      cv_pool_link: (() => {
        const v = (input.cvPoolLink ?? "").trim().slice(0, 500);
        return v && URL_RE.test(v) ? v : null;
      })(),
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
/** DELETES an IR-call log outright (v33.5).
 *
 *  Cancelling is for a scheduled call that won't happen — the IR is told and
 *  the row stays as history. This is the other case: a log recorded by
 *  mistake, a duplicate, or a test. It leaves nothing behind, so it is the
 *  call's OWNER or a leader only, and it removes the calendar event with it.
 *
 *  No email: nobody was promised anything by a row that shouldn't exist. */
export async function deleteIrCall(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  if (viewer.sandbox)
    return fail("Deleting calls is disabled in the sandbox test view — a delete can't be undone on exit.");

  const { data: call } = await db()
    .from("ir_calls")
    .select("id, member_id, member_name, partner_lc_name, calendar_event_id, event_calendar, called_at")
    .eq("id", id)
    .maybeSingle();
  if (!call) return fail("That call is already gone.");

  const isLeader =
    viewer.isAdmin || ["LCP", "LCVP", "Director"].includes(viewer.role);
  if (call.member_id !== viewer.id && !isLeader)
    return fail("Only the person who logged this call — or a leader — can delete it.", "forbidden");

  // the event on the owner's calendar goes with it; a stale invite for a call
  // that no longer exists is worse than no invite
  if (call.calendar_event_id) {
    try {
      if ((call as { event_calendar?: string | null }).event_calendar === "mailbox") {
        const { deleteIrCallEventOnMailbox } = await import("@/lib/google/calendar");
        await deleteIrCallEventOnMailbox(call.calendar_event_id);
      } else {
        const { data: owner } = await db()
          .from("members")
          .select("google_refresh_token")
          .eq("id", call.member_id)
          .maybeSingle();
        const token = (owner as { google_refresh_token: string | null } | null)?.google_refresh_token;
        if (token) {
          const { deleteIrCallEvent } = await import("@/lib/google/calendar");
          await deleteIrCallEvent(token, call.calendar_event_id);
        }
      }
    } catch (e) {
      console.warn("[ir-call] calendar cleanup on delete failed:", e);
    }
  }

  await snapshotForUndo("ir_calls", id);
  const { error } = await db().from("ir_calls").delete().eq("id", id);
  if (error) return fail(error.message);
  await recordUndo("ir_calls", id, "delete");
  await logAudit(viewer.id, "ir_call_deleted", "ir_call", id, {
    lc: call.partner_lc_name,
    loggedBy: call.member_name,
  });
  revalidatePath("/consideration");
  return { ok: true };
}

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
      if ((call as { event_calendar?: string | null }).event_calendar === "mailbox") {
        const { deleteIrCallEventOnMailbox } = await import("@/lib/google/calendar");
        await deleteIrCallEventOnMailbox(call.calendar_event_id);
      } else {
        const { deleteIrCallEvent } = await import("@/lib/google/calendar");
        await deleteIrCallEvent(ownerToken, call.calendar_event_id);
      }
    } catch (e) {
      console.error("[ir-calls] calendar delete failed:", e);
    }
  }

  // the IR's cancellation email — reason + a rebook link (best-effort; the
  // sendEmail helper itself is sandbox-suppressed)
  if (call.booker_email) {
    try {
      const { irCallCancelledByMemberEmail } = await import("@/lib/email/templates");
      const { cairoWhenLabel, bookerZoneFor } = await import("./data");
      const { whenLabelInZone } = await import("@/lib/timezones");
      // THEIR clock, not ours (v33.22)
      const zone = await bookerZoneFor(call.booker_tz, call.partner_lc_id);
      const mail = irCallCancelledByMemberEmail({
        bookerName: call.booker_name,
        memberName: call.member_name,
        partnerLc: call.partner_lc_name,
        whenLabel: zone
          ? whenLabelInZone(call.called_at, zone)
          : cairoWhenLabel(call.called_at),
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

/** FIX THE IR'S EMAIL (v33.29 part 2) — when the invite bounced (or the crew
 *  spots a typo), the owner/VP corrects the address IN PLACE: the calendar
 *  event's attendee is swapped so Google re-sends the invite to the right
 *  inbox, the LC's contact row follows, the confirmation email (their clock
 *  first, manage link included) goes out again, and the bounce flag clears. */
export async function updateIrBookerEmail(id: string, emailRaw: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  if (viewer.sandbox)
    return fail("Fixing IR emails is disabled in the sandbox test view — the invite re-send is real.");
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return fail("That doesn't look like an email address.");
  const { emailDomainIssue } = await import("@/lib/email-check");
  const issue = await emailDomainIssue(email);
  if (issue) return fail(issue);
  const { data: call } = await db()
    .from("ir_calls")
    .select("*")
    .eq("id", id)
    .maybeSingle<IrCallServerRow>();
  if (!call) return fail("That call no longer exists.");
  if (call.status !== "scheduled")
    return fail("Only scheduled calls can have their email fixed.");
  if (call.member_id !== viewer.id && !isConsiderationLead(viewer))
    return fail("Only the call's owner or a VP/Director can fix the email.", "forbidden");
  const oldEmail = (call.booker_email ?? "").trim().toLowerCase() || null;
  // THE SAME ADDRESS IS A RETRY, NOT A MISTAKE (v33.36.1 — the Bhavika case:
  // her mailbox bounced for reasons on HER side, got fixed there, and the
  // address was right all along. Refusing it left no way to try again.)
  // Re-submitting the identical email clears the bounce flag, re-issues the
  // calendar invite (quiet-remove + loud re-add, so Google actually sends a
  // fresh one) and re-sends the confirmation.
  const retry = oldEmail === email;

  await snapshotForUndo("ir_calls", id);
  const { error } = await db()
    .from("ir_calls")
    .update({ booker_email: email, email_bounced_at: null })
    .eq("id", id);
  if (error) return fail(error.message);

  // the LC's contact row follows; unique (partner_lc_id, lower(email)) means
  // a row already holding the NEW email wins and the wrong one is removed.
  // A retry changes nothing here — the row is already right.
  if (call.partner_lc_id && oldEmail && !retry) {
    const { error: cErr } = await db()
      .from("partner_lc_contacts")
      .update({ email })
      .eq("partner_lc_id", call.partner_lc_id)
      .ilike("email", oldEmail);
    if (cErr)
      await db()
        .from("partner_lc_contacts")
        .delete()
        .eq("partner_lc_id", call.partner_lc_id)
        .ilike("email", oldEmail);
  }

  // ---- THE INVITE FOLLOWS THE CORRECTION (v33.32)
  //
  // "Removed from the first mail, added to the next": the wrong address is
  // dropped from the event (Google mails it a cancellation) and the right one
  // is invited (Google mails it the invite). That is what the attendee swap
  // does — but it can only patch an event that EXISTS on a calendar we can
  // reach, and the two cases where it can't are exactly the ones this feature
  // is for: a booking whose event was never created (dead grant at booking
  // time) and an owner-hosted event whose owner has since revoked Google.
  // So when the swap can't happen, the event is REBUILT on the IM mailbox —
  // old one deleted (which notifies the wrong address), new one created with
  // the right address and the host invited.
  const onMailbox =
    (call as { event_calendar?: string | null }).event_calendar === "mailbox";
  const { data: owner } = call.member_id
    ? await db()
        .from("members")
        .select("id, name, email, fallback_email, google_refresh_token")
        .eq("id", call.member_id)
        .maybeSingle<{
          id: string;
          name: string;
          email: string | null;
          fallback_email: string | null;
          google_refresh_token: string | null;
        }>()
    : { data: null };
  let inviteSwapped = false;
  let meetLink = call.meet_link;
  if (call.calendar_event_id) {
    try {
      const { swapIrCallAttendee } = await import("@/lib/google/calendar");
      inviteSwapped = await swapIrCallAttendee({
        hostRefreshToken: onMailbox ? null : owner?.google_refresh_token ?? null,
        onMailbox,
        eventId: call.calendar_event_id,
        oldEmail,
        newEmail: email,
      });
    } catch (e) {
      console.error("[ir-calls] attendee swap failed:", e);
    }
  }
  if (!inviteSwapped && !(await sandboxSuppressed("IR-call invite rebuild"))) {
    try {
      const {
        createIrCallEvent, createIrCallEventOnMailbox,
        deleteIrCallEvent, deleteIrCallEventOnMailbox,
      } = await import("@/lib/google/calendar");
      // drop the old event first — the wrong inbox gets the cancellation, and
      // nobody is left with two entries for one call
      if (call.calendar_event_id) {
        try {
          if (onMailbox) await deleteIrCallEventOnMailbox(call.calendar_event_id);
          else
            await deleteIrCallEvent(
              owner?.google_refresh_token ?? null,
              call.calendar_event_id
            );
        } catch (e) {
          console.error("[ir-calls] old event delete failed:", e);
        }
      }
      const start = new Date(call.called_at);
      const minutes = call.duration_minutes ?? 30;
      const description = `AIESEC IR call.\nPartner LC: ${call.partner_lc_name}${
        call.booker_name ? `\nBooked by: ${call.booker_name}` : ""
      } <${email}>\nHost: ${call.member_name}, AIESEC in Alexandria.${
        call.booker_note ? `\n\nWhat they'd like to talk about:\n${call.booker_note}` : ""
      }`;
      const made = owner?.google_refresh_token
        ? await createIrCallEvent(owner.google_refresh_token, {
            partnerLc: call.partner_lc_name,
            start,
            minutes,
            attendeeEmail: email,
            description,
          }).catch((e) => {
            console.error("[ir-calls] owner re-invite failed, trying mailbox:", e);
            return null;
          })
        : null;
      const rebuilt =
        made ??
        (await createIrCallEventOnMailbox({
          partnerLc: call.partner_lc_name,
          start,
          minutes,
          attendeeEmail: email,
          ownerEmail: owner?.email ?? owner?.fallback_email ?? null,
          description,
        }));
      if (rebuilt) {
        meetLink = rebuilt.meetLink;
        inviteSwapped = true;
        await db()
          .from("ir_calls")
          .update({
            calendar_event_id: rebuilt.id,
            meet_link: rebuilt.meetLink,
            event_calendar: made ? "owner" : "mailbox",
          })
          .eq("id", id);
      }
    } catch (e) {
      console.error("[ir-calls] invite rebuild failed:", e);
    }
  }

  // the confirmation, again — to the address that actually exists this time
  if (call.manage_token) {
    try {
      const { irBookingConfirmEmail } = await import("@/lib/email/templates");
      const { cairoWhenLabel, bookerZoneFor } = await import("./data");
      const { whenLabelInZone } = await import("@/lib/timezones");
      const zone = await bookerZoneFor(call.booker_tz, call.partner_lc_id);
      const cairo = cairoWhenLabel(call.called_at);
      const confirm = irBookingConfirmEmail({
        bookerName: call.booker_name,
        memberName: call.member_name,
        partnerLc: call.partner_lc_name,
        whenLabel: zone ? whenLabelInZone(call.called_at, zone) : cairo,
        cairoLabel: zone ? cairo : null,
        slotMinutes: call.duration_minutes ?? 30,
        // the link from the REBUILT event when there is one, so the mail never
        // hands them a Meet room that no longer exists
        meetLink,
        manageUrl: `${env.appUrl}/book/manage/${call.manage_token}`,
      });
      await sendEmail({ to: [email], subject: confirm.subject, html: confirm.html });
    } catch (e) {
      console.error("[ir-calls] confirmation re-send failed:", e);
      // the whole point of the fix is that the IR hears about it — a failure
      // here means the new address is bad too, so keep the call flagged
      await db()
        .from("ir_calls")
        .update({ email_bounced_at: new Date().toISOString() })
        .eq("id", id);
      return fail(
        "Saved the address, but the confirmation wouldn't send to it either — check it with the IR again."
      );
    }
  }

  await logAudit(viewer.id, retry ? "ir_call_email_retry" : "ir_call_email_fix", "ir_call", id, {
    lc: call.partner_lc_name,
    from: oldEmail,
    to: email,
    inviteSwapped,
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
    const { cairoWhenLabel, bookerZoneFor } = await import("./data");
    const { whenLabelInZone } = await import("@/lib/timezones");
    const zone = await bookerZoneFor(call.booker_tz, call.partner_lc_id);
    const mail = irRescheduleRequestEmail({
      bookerName: call.booker_name,
      memberName: call.member_name,
      partnerLc: call.partner_lc_name,
      whenLabel: zone
        ? whenLabelInZone(call.called_at, zone)
        : cairoWhenLabel(call.called_at),
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
        .select("id, name, email, google_refresh_token, is_active")
        .eq("id", call.member_id)
        .maybeSingle<{
          id: string;
          name: string;
          email: string | null;
          google_refresh_token: string | null;
          is_active: boolean;
        }>(),
      db()
        .from("ir_booking_settings")
        .select(
          "member_id, slug, slot_minutes, availability, active, buffer_minutes, min_notice_minutes, max_advance_days, start_date, end_date, guests_can_invite, max_per_day"
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
  const { cairoWhenLabel, bookerZoneFor } = await import("./data");
  const { whenLabelInZone } = await import("@/lib/timezones");
  const oldWhen = cairoWhenLabel(call.called_at);
  // the IR moved it from a page drawn in THEIR zone — the confirmation has to
  // agree with what they were looking at (v33.22)
  const zone = await bookerZoneFor(call.booker_tz, call.partner_lc_id);
  const newWhenTheirs = zone ? whenLabelInZone(startIso, zone) : null;

  // KEEP WHAT IT USED TO BE (v33.28). A reschedule overwrote `called_at` and
  // the old instant was gone — the crew could not tell that a call had moved
  // at all, let alone how often or who moved it.
  const history = [
    ...(Array.isArray(call.reschedules) ? call.reschedules : []),
    {
      at: new Date().toISOString(),
      from: call.called_at,
      to: startIso,
      by: "ir",
      byName: call.booker_name ?? call.partner_lc_name,
    },
  ].slice(-20);

  const { data: movedRows, error } = await db()
    .from("ir_calls")
    .update({
      called_at: startIso,
      duration_minutes: settings.slot_minutes,
      reschedule_requested_at: null,
      reschedules: history,
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

  // move the calendar event (attendees get Google's update) — best-effort,
  // on whichever calendar hosts it (owner's or the IM mailbox fallback)
  if (call.calendar_event_id) {
    try {
      if ((call as { event_calendar?: string | null }).event_calendar === "mailbox") {
        const { updateIrCallEventOnMailbox } = await import("@/lib/google/calendar");
        await updateIrCallEventOnMailbox(call.calendar_event_id, start, settings.slot_minutes);
      } else {
        const { updateIrCallEvent } = await import("@/lib/google/calendar");
        await updateIrCallEvent(
          owner.google_refresh_token,
          call.calendar_event_id,
          start,
          settings.slot_minutes
        );
      }
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
        memberFirstName: (owner.name).split(" ")[0],
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
        memberName: owner.name,
        partnerLc: call.partner_lc_name,
        whenLabel: newWhenTheirs ?? newWhen,
        cairoLabel: newWhenTheirs ? newWhen : null,
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
  return { ok: true, data: { whenLabel: newWhenTheirs ?? newWhen } };
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

  if (call.calendar_event_id) {
    try {
      // v33.19 review: this branch assumed the OWNER's calendar, so an event
      // hosted on the IM mailbox (the no-grant fallback) survived the IR's
      // cancellation — a ghost meeting on everyone's calendar. NULL keeps the
      // old behaviour for anything booked before the fallback existed.
      if ((call as { event_calendar?: string | null }).event_calendar === "mailbox") {
        const { deleteIrCallEventOnMailbox } = await import("@/lib/google/calendar");
        await deleteIrCallEventOnMailbox(call.calendar_event_id);
      } else if (owner) {
        const { deleteIrCallEvent } = await import("@/lib/google/calendar");
        await deleteIrCallEvent(owner.google_refresh_token, call.calendar_event_id);
      }
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
          memberFirstName: (owner.name).split(" ")[0],
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
/** Adds an IR contact to a partner LC (v33.9). MMs and above — the same
 *  people who may fix an LC's name, because this is the same act: keeping the
 *  registry true. */
export async function addPartnerLcContact(input: {
  partnerLcId: string;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  /** GV / GT — which programme this IR is our counterpart for (v33.23) */
  product?: string | null;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  if (
    !isConsiderationLead(viewer) &&
    !["Team Leader", "Coordinator"].includes(viewer.role)
  )
    return fail("Only MMs, VPs/Directors or the LCP can add an IR.", "forbidden");
  if (viewer.sandbox)
    return fail("Partner-LC edits are disabled in the sandbox test view.");

  const name = (input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return fail("The IR needs a name.");
  const email = (input.email ?? "").trim().slice(0, 200) || null;
  if (email && !EMAIL_RE.test(email)) return fail("That email doesn't look right.");

  // THE ROLE IS A PICK-LIST NOW (v33.23), the same one the public booking page
  // validates against — two vocabularies for one field meant the registry
  // showed "LCVP oGT", "uw" and "MM (Team Leader / Coordinator)" side by side
  // and nothing could be filtered or counted.
  const role = (input.role ?? "").trim();
  if (role && !isKnownIrRole(role)) return fail("Pick their role from the list.");
  const product = input.product === "GV" || input.product === "GT" ? input.product : null;

  const { error } = await db().from("partner_lc_contacts").insert({
    partner_lc_id: input.partnerLcId,
    name,
    role: role || null,
    email,
    phone: (input.phone ?? "").trim().slice(0, 40) || null,
    product,
    added_by: viewer.id,
  });
  if (error) return fail(error.message);
  revalidatePath("/consideration");
  return { ok: true };
}

/** NOTES ON AN LC, OR ON ONE OF ITS IRs (v33.23).
 *
 *  Everything the crew learns between calls — "their oGV peak starts in
 *  March", "Sarah is the one who actually answers" — had nowhere to live
 *  except the notes field of a single call, where the next person never looks.
 *  A null `contactId` means the note is about the LC as a whole. */
export async function addPartnerLcComment(input: {
  partnerLcId: string;
  contactId?: string | null;
  body: string;
}): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  const body = (input.body ?? "").trim().slice(0, 4000);
  if (body.length < 2) return fail("Write the note first 🙂");
  if (viewer.sandbox) return fail("Partner-LC notes are disabled in the sandbox test view.");
  // a contact must belong to THIS LC — otherwise a note about one entity's
  // person would file itself under another
  if (input.contactId) {
    const { data: c } = await db()
      .from("partner_lc_contacts")
      .select("id")
      .eq("id", input.contactId)
      .eq("partner_lc_id", input.partnerLcId)
      .maybeSingle<{ id: string }>();
    if (!c) return fail("That IR isn't on this LC.");
  }
  const { error } = await db().from("partner_lc_comments").insert({
    partner_lc_id: input.partnerLcId,
    contact_id: input.contactId || null,
    body,
    author_id: viewer.id,
    author_name: viewer.name,
  });
  if (error) {
    if (error.message.includes("partner_lc_comments"))
      return fail("LC notes need migration 0048 — run it in the Supabase SQL editor.");
    return fail(error.message);
  }
  await logAudit(viewer.id, "partner_lc_comment", "partner_lc", input.partnerLcId, {
    about_ir: !!input.contactId,
  });
  revalidatePath("/consideration");
  return { ok: true };
}

/** The author takes their own note back; a VP/Director/LCP can remove any. */
export async function deletePartnerLcComment(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  const { data: row } = await db()
    .from("partner_lc_comments")
    .select("id, author_id")
    .eq("id", id)
    .maybeSingle<{ id: string; author_id: string | null }>();
  if (!row) return { ok: true };
  if (row.author_id !== viewer.id && !isConsiderationLead(viewer))
    return fail("Only whoever wrote it (or a VP) can remove a note.", "forbidden");
  if (viewer.sandbox) return fail("Partner-LC notes are disabled in the sandbox test view.");
  const { error } = await db().from("partner_lc_comments").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/consideration");
  return { ok: true };
}

/** Removes an IR contact that was added by hand. */
export async function deletePartnerLcContact(id: string): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return considerationFail();
  if (
    !isConsiderationLead(viewer) &&
    !["Team Leader", "Coordinator"].includes(viewer.role)
  )
    return fail("Only MMs, VPs/Directors or the LCP can remove an IR.", "forbidden");
  if (viewer.sandbox)
    return fail("Partner-LC edits are disabled in the sandbox test view.");
  const { error } = await db().from("partner_lc_contacts").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/consideration");
  return { ok: true };
}

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
  // resolved, not stored verbatim (v33.23) — a hand-typed "Türkiye" that no
  // country table recognises silently costs this LC its fallback time zone
  const typedCountry = (patch.country ?? "").trim().slice(0, 60);
  const { COUNTRIES: KNOWN } = await import("@/lib/countries");
  const { resolveCountry: resolveC } = await import("@/lib/timezones");
  const country = typedCountry ? resolveC(typedCountry, KNOWN) : null;
  if (typedCountry && !country)
    return fail(`"${typedCountry}" isn't a country we know — pick one from the list.`);

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
  /** SHA-256 of the FILE BYTES, computed in the browser (v33.2) */
  sha256?: string;
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
  {
    const unsafe = unsafeUploadReason(file.name);
    if (unsafe) return fail(unsafe);
  }

  // DUPLICATE CHECK, before a byte is stored (v33.2). The pool is shared and
  // several people upload after the same IR call, so the same CV kept arriving
  // twice. Checking the content hash here means an exact duplicate costs no
  // storage and no Gemini call — and the person is told WHOSE copy already
  // exists, so they can go read it instead of re-uploading it.
  if (file.sha256 && /^[0-9a-f]{64}$/i.test(file.sha256)) {
    const { data: dupe } = await db()
      .from("cvs")
      .select("id, file_name, created_at, uploaded_by, members!uploaded_by(name)")
      .eq("file_hash", file.sha256.toLowerCase())
      .limit(1)
      .maybeSingle();
    if (dupe) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const who = (dupe as any).members?.name as string | undefined;
      const when = (dupe as { created_at?: string }).created_at?.slice(0, 10);
      return fail(
        `This exact CV is already in the pool — "${(dupe as { file_name?: string }).file_name ?? "uploaded"}"` +
          (who ? `, uploaded by ${who}` : "") +
          (when ? ` on ${when}` : "") +
          ". Search the pool for it instead of uploading it again.",
        "duplicate"
      );
    }
  }

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
  sha256?: string;
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
      // the content hash is what makes the NEXT upload of this file bounce
      file_hash:
        input.sha256 && /^[0-9a-f]{64}$/i.test(input.sha256)
          ? input.sha256.toLowerCase()
          : null,
      extraction_status: "pending",
      uploaded_by: viewer.id,
      uploader_name: viewer.name,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);

  await recordUndo("cvs", created.id, "insert");
  await stampWork(viewer.id, "cv_upload"); // v33.18: counts towards working hours
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
    /** the AI's read of the person, editable like everything else (v33.8) */
    summary?: string | null;
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
  const summary = clean(patch.summary, 4000);
  if (summary !== undefined) update.summary = summary;
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
export async function getCvFileUrl(
  id: string,
  /** true → the browser saves it, named for the person rather than
   *  "Cv-2_kopyası.pdf" (v33.8) */
  download = false
): Promise<ActionResult<{ url: string; fileName: string }>> {
  const viewer = await getViewer();
  if (!canSeeCvPool(viewer)) return considerationFail();
  const { data: cv } = await db()
    .from("cvs")
    .select("file_path, file_name, person_name, partner_lc_name, industry")
    .eq("id", id)
    .maybeSingle<{
      file_path: string;
      file_name: string | null;
      person_name: string | null;
      partner_lc_name: string | null;
      industry: string | null;
    }>();
  if (!cv) return fail("That CV no longer exists.");

  // THE NAME MATTERS (v33.8). These get forwarded to enablers, and a folder
  // of "Cv-2_kopyası.pdf" tells the person receiving them nothing. Named for
  // who it is, where they came from and what they do.
  const ext = (cv.file_name ?? "").includes(".")
    ? `.${cv.file_name!.split(".").pop()}`
    : "";
  const safe = (v: string | null | undefined) =>
    (v ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const parts = [safe(cv.person_name) || "CV", safe(cv.partner_lc_name), safe(cv.industry)]
    .filter(Boolean)
    .join(" — ");
  const fileName = `${parts}${ext}`.slice(0, 150);

  const { data, error } = await db()
    .storage.from("cvs")
    .createSignedUrl(cv.file_path, 600, download ? { download: fileName } : undefined);
  if (error || !data) return fail(error?.message ?? "Could not open the file — try again.");
  return { ok: true, data: { url: data.signedUrl, fileName } };
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

/** The viewer's next working-hours session — powers the "Next working hours"
 *  next-step button (v33). */
export async function getNextWorkingHours(): Promise<
  ActionResult<{ id: string; startsAt: string; label: string } | null>
> {
  const viewer = await getViewer();
  const { nextWorkingHoursFor } = await import("./data");
  return { ok: true, data: await nextWorkingHoursFor(viewer) };
}
