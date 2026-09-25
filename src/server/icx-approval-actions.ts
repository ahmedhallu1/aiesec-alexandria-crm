"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { getViewer, logAudit } from "./data";
import { recordUndo, snapshotForUndo } from "./sandbox";
import { notifyMembers } from "./notify";
import {
  approvalCreditTargets,
  approvalLanes,
  canEditApproval,
} from "./icx-approvals";
import { hasConsiderationAccess } from "@/lib/rbac";
import { cairoToday, normalizePhone } from "@/lib/types";
import { resolveCountry } from "@/lib/timezones";
import { COUNTRIES } from "@/lib/countries";
import {
  APPROVAL_PRODUCTS,
  APPROVAL_SOURCES,
  expaKey,
  functionOfProduct,
  isAlreadyLogged,
  isValidApprovalDate,
  type ApprovalProduct,
  type ApprovalSource,
} from "@/lib/icx-approvals";

/**
 * ICX APPROVALS — the writes (v37).
 *
 * WHO MAY LOG: anyone in the consideration module, for a lane they read.
 * WHO IT COUNTS FOR: one person, from `approvalCreditTargets` — the viewer,
 * or (for an MM or a leader) the crew they answer for. The picker offers
 * exactly that list and this file re-checks it, so the two cannot disagree.
 */

export type ApprovalResult =
  | { ok: true; id?: string; message: string }
  | { ok: false; error: string };

export interface ApprovalInput {
  product: ApprovalProduct;
  epName: string;
  expaId?: string | null;
  approvedOn: string;
  /** the sending LC — from the registry, or typed as a new one */
  partnerLcId?: string | null;
  newLcName?: string | null;
  country?: string | null;
  source: ApprovalSource;
  irCallId?: string | null;
  cvId?: string | null;
  accountId?: string | null;
  opportunity?: string | null;
  epEmail?: string | null;
  epPhone?: string | null;
  notes?: string | null;
  /** who made it — defaults to the viewer */
  madeBy?: string | null;
  /** claimed from an ECB SubTool suggestion */
  fromSubtool?: boolean;
}

const clean = (s: string | null | undefined, max = 500) => {
  const t = String(s ?? "").trim();
  return t ? t.slice(0, max) : null;
};

/** Validate + normalise one approval into the row the table stores. */
async function buildRow(
  input: ApprovalInput,
  viewer: Awaited<ReturnType<typeof getViewer>>,
  /** on an edit, the person it already counts for — keeping them is always
   *  allowed, even when the viewer could not have picked them (a TL fixing a
   *  typo on an approval credited to a VP) */
  keep?: { id: string; name: string } | null
): Promise<{ row: Record<string, unknown>; madeByName: string } | { error: string }> {
  if (!APPROVAL_PRODUCTS.includes(input.product)) return { error: "Pick the programme (GV, GTa or GTe)." };
  const fn = functionOfProduct(input.product);
  if (!approvalLanes(viewer).includes(fn)) {
    return { error: `You don't work ${fn} consideration, so you can't log its approvals.` };
  }
  const epName = clean(input.epName, 200);
  if (!epName || epName.length < 2) return { error: "Type the EP's name." };
  if (!isValidApprovalDate(input.approvedOn, cairoToday())) {
    return { error: "The approval date must be a real day, and not in the future." };
  }
  if (!APPROVAL_SOURCES.some((s) => s.value === input.source)) {
    return { error: "Say how the approval came." };
  }

  // WHO IT COUNTS FOR
  const madeById = input.madeBy || keep?.id || viewer.id;
  const target =
    keep && keep.id === madeById
      ? keep
      : (await approvalCreditTargets(viewer)).find((t) => t.id === madeById);
  if (!target) {
    return {
      error:
        "You can credit an approval to yourself, or — as an MM or a VP — to the consideration crew you answer for.",
    };
  }

  // WHERE FROM — a registry LC, or a new one added on the spot
  let partnerLcId: string | null = null;
  let partnerLcName: string | null = null;
  let country: string | null = input.country ? resolveCountry(input.country, COUNTRIES) : null;
  if (input.country && !country) return { error: `"${input.country}" isn't a country we know — pick it from the list.` };
  if (input.partnerLcId) {
    const { data: lc } = await db()
      .from("partner_lcs")
      .select("id, name, country")
      .eq("id", input.partnerLcId)
      .maybeSingle<{ id: string; name: string; country: string | null }>();
    if (!lc) return { error: "That partner LC no longer exists — pick another." };
    partnerLcId = lc.id;
    partnerLcName = lc.name;
    country = country ?? lc.country;
  } else if (clean(input.newLcName)) {
    const { addPartnerLc } = await import("./actions");
    const res = await addPartnerLc({ name: clean(input.newLcName)!, country });
    if (!res.ok) return { error: res.error };
    partnerLcId = res.data?.id ?? null;
    partnerLcName = res.data?.name ?? clean(input.newLcName);
    country = country ?? res.data?.country ?? null;
  } else {
    return { error: "Which LC did they come from? Pick the sending LC." };
  }

  // THE EP'S CONTACT — both optional, both checked when given
  let epPhone: string | null = null;
  if (clean(input.epPhone)) {
    const p = normalizePhone(input.epPhone!);
    if (!p.ok) return { error: `EP phone: ${p.error ?? "that doesn't look like a number"}. Use +<country code>.` };
    epPhone = p.value;
  }
  const epEmail = clean(input.epEmail, 200)?.toLowerCase() ?? null;
  if (epEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epEmail)) return { error: "That EP email doesn't look right." };

  // a linked record must be the kind the source says, and must exist
  const irCallId = input.source === "ir_call" ? clean(input.irCallId, 64) : null;
  const cvId = input.source === "cv_pool" ? clean(input.cvId, 64) : null;
  if (irCallId) {
    const { data } = await db().from("ir_calls").select("id").eq("id", irCallId).maybeSingle();
    if (!data) return { error: "That IR call no longer exists — pick another or leave it empty." };
  }
  if (cvId) {
    const { data } = await db().from("cvs").select("id").eq("id", cvId).maybeSingle();
    if (!data) return { error: "That CV no longer exists — pick another or leave it empty." };
  }
  const accountId = clean(input.accountId, 64);
  if (accountId) {
    const { data } = await db().from("accounts").select("id").eq("id", accountId).maybeSingle();
    if (!data) return { error: "That account no longer exists — pick another or leave it empty." };
  }

  return {
    madeByName: target.name,
    row: {
      product: input.product,
      ep_name: epName,
      expa_id: clean(input.expaId, 80),
      approved_on: input.approvedOn,
      partner_lc_id: partnerLcId,
      partner_lc_name: partnerLcName,
      country,
      source: input.source,
      ir_call_id: irCallId,
      cv_id: cvId,
      account_id: accountId,
      opportunity: clean(input.opportunity, 200),
      ep_email: epEmail,
      ep_phone: epPhone,
      notes: clean(input.notes, 2000),
      made_by: target.id,
      made_by_name: target.name,
    },
  };
}

/** The same EP must not be counted twice. The unique index is the real
 *  guard; this gives the person a sentence instead of a Postgres error. */
async function duplicateOf(expaId: string | null, exceptId?: string): Promise<string | null> {
  if (!expaKey(expaId)) return null;
  const { data } = await db().from("icx_approvals").select("id, expa_id, ep_name, made_by_name");
  // both directions: a bare EP id covers that EP's full pair, whichever of
  // the two was logged first
  const hit = (data ?? []).find(
    (r) =>
      r.id !== exceptId &&
      (isAlreadyLogged(String(r.expa_id ?? ""), [expaId]) ||
        isAlreadyLogged(String(expaId), [r.expa_id as string | null]))
  );
  return hit ? `${hit.ep_name} (${hit.expa_id}) is already logged — credited to ${hit.made_by_name || "someone"}.` : null;
}

const refresh = () => {
  revalidatePath("/consideration");
  revalidatePath("/dashboard");
  revalidatePath("/planning");
  revalidatePath("/profile");
};

export async function logIcxApproval(input: ApprovalInput): Promise<ApprovalResult> {
  const viewer = await getViewer();
  if (!hasConsiderationAccess(viewer)) return { ok: false, error: "Approvals live in the consideration module." };
  const built = await buildRow(input, viewer);
  if ("error" in built) return { ok: false, error: built.error };
  const dupe = await duplicateOf(built.row.expa_id as string | null);
  if (dupe) return { ok: false, error: dupe };

  const { data, error } = await db()
    .from("icx_approvals")
    .insert({ ...built.row, logged_by: viewer.id, from_subtool: !!input.fromSubtool })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That EP is already logged — someone got there first." };
    if (error.code === "42P01") return { ok: false, error: "Approvals aren't set up yet — run migration 0083." };
    return { ok: false, error: error.message };
  }
  await recordUndo("icx_approvals", data.id, "insert");
  await logAudit(viewer.id, "icx_approval_log", "icx_approval", data.id, {
    ep: built.row.ep_name,
    product: built.row.product,
    made_by: built.madeByName,
  });
  // somebody else's win is news to them; your own click never is
  if (built.row.made_by !== viewer.id) {
    await notifyMembers(
      [built.row.made_by as string],
      "info",
      `🏆 An approval counts for you: ${built.row.ep_name}`,
      `${viewer.name} logged ${built.row.ep_name} (${built.row.product}, from ${built.row.partner_lc_name ?? "—"}) as your approval.`,
      viewer.id,
      "/consideration?tab=approvals",
      "partnerships"
    );
  }
  refresh();
  return { ok: true, id: data.id, message: `🏆 ${built.row.ep_name} logged — it counts for ${built.madeByName}.` };
}

export async function updateIcxApproval(id: string, input: ApprovalInput): Promise<ApprovalResult> {
  const viewer = await getViewer();
  const { data: existing } = await db()
    .from("icx_approvals")
    .select("id, function, made_by, made_by_name, logged_by, from_subtool")
    .eq("id", id)
    .maybeSingle();
  if (!existing || !canEditApproval(viewer, existing)) {
    return { ok: false, error: "You can't edit this approval." };
  }
  const built = await buildRow(
    input,
    viewer,
    existing.made_by ? { id: existing.made_by, name: existing.made_by_name } : null
  );
  if ("error" in built) return { ok: false, error: built.error };
  const dupe = await duplicateOf(built.row.expa_id as string | null, id);
  if (dupe) return { ok: false, error: dupe };

  await snapshotForUndo("icx_approvals", id);
  const { error } = await db()
    .from("icx_approvals")
    .update({ ...built.row, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Another approval already carries that EXPA id." };
    return { ok: false, error: error.message };
  }
  await logAudit(viewer.id, "icx_approval_update", "icx_approval", id, {
    ep: built.row.ep_name,
    made_by: built.madeByName,
  });
  refresh();
  return { ok: true, id, message: "Saved." };
}

export async function deleteIcxApproval(id: string): Promise<ApprovalResult> {
  const viewer = await getViewer();
  const { data: existing } = await db()
    .from("icx_approvals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing || !canEditApproval(viewer, existing)) {
    return { ok: false, error: "You can't delete this approval." };
  }
  await recordUndo("icx_approvals", id, "delete", existing, `Approval · ${existing.ep_name}`);
  const { error } = await db().from("icx_approvals").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logAudit(viewer.id, "icx_approval_delete", "icx_approval", id, {
    ep: existing.ep_name,
    product: existing.product,
    made_by: existing.made_by_name,
  });
  refresh();
  return { ok: true, message: `${existing.ep_name} removed from the approvals.` };
}
