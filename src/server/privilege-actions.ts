"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/server/data";
import { db } from "@/lib/supabase";
import { logAudit } from "@/server/audit";
import { canRunLcTools } from "@/lib/rbac";
import { MEMBER_ROLES, LC_FUNCTIONS, SUB_FUNCTIONS } from "@/lib/types";
import { cleanAudience } from "@/lib/tabs";
import { PRIVILEGE_KEYS, PRIVILEGE_REGISTRY, type PrivilegeBase } from "@/lib/privileges";
import { bustPrivilegeRules } from "@/server/privileges";

/** WRITES for Settings → Rules (v38.4). The LCP and the admins only
 *  (`canRunLcTools` — the same people who run every other LC tool), never
 *  from a test view: a rule saved there would be credited to the
 *  impersonated member and would then decide what everyone may do.
 *
 *  Every save busts the rule cache and revalidates the layout, so the person
 *  who flipped a switch sees it on their next click rather than up to a
 *  minute later. Deliberately a copy of `tab-actions.ts` in shape: two
 *  permission screens that validated their audiences differently would be
 *  exactly the kind of drift this system keeps paying for. */

type Res = { ok: true } | { ok: false; error: string };
const fail = (error: string): Res => ({ ok: false, error });

async function admin() {
  const viewer = await getViewer();
  if (!canRunLcTools(viewer))
    return { viewer, error: "Only the LCP and the admins change the LC's rules." };
  if (viewer.impersonated)
    return {
      viewer,
      error: "Exit the test view first — the change would be credited to someone else.",
    };
  return { viewer, error: null as string | null };
}

function done() {
  bustPrivilegeRules();
  revalidatePath("/", "layout");
}

const ROLES = new Set<string>(MEMBER_ROLES);
const FUNCTIONS = new Set<string>([...LC_FUNCTIONS, ...SUB_FUNCTIONS]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function audience(raw: unknown) {
  const a = cleanAudience(raw);
  return {
    members: a.members.filter((id) => UUID.test(id)),
    roles: a.roles.filter((r) => ROLES.has(r)),
    // functions on the membership sheet are free-form (an unknown value is
    // imported as-is), so anything short and printable passes — known first
    functions: a.functions.filter((f) => FUNCTIONS.has(f) || /^[\w&+ -]{1,20}$/.test(f)),
  };
}

export interface PrivilegeRuleInput {
  key: string;
  base?: PrivilegeBase;
  allow?: unknown;
  deny?: unknown;
  note?: string | null;
}

export async function savePrivilegeRule(input: PrivilegeRuleInput): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!PRIVILEGE_KEYS.has(input.key)) return fail("Unknown rule.");
  const base: PrivilegeBase =
    input.base === "everyone" || input.base === "nobody" ? input.base : "default";
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";

  const row = {
    key: input.key,
    base,
    allow_to: audience(input.allow),
    deny_from: audience(input.deny),
    note: note || null,
    updated_by: viewer.id,
    updated_at: new Date().toISOString(),
  };
  const { error: dbError } = await db()
    .from("privilege_rules")
    .upsert(row, { onConflict: "key" });
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "privilege_rule_save", "privilege_rules", null, row);
  done();
  return { ok: true };
}

/** Forget a rule entirely — the privilege goes back to what the code says.
 *  Unlike a tab rule there is no position to preserve, so the row goes. */
export async function resetPrivilegeRule(key: string): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!PRIVILEGE_KEYS.has(key)) return fail("Unknown rule.");
  const { error: dbError } = await db().from("privilege_rules").delete().eq("key", key);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "privilege_rule_reset", "privilege_rules", null, { key });
  done();
  return { ok: true };
}

/** Put every rule back to the code's own answer — the escape hatch for a
 *  screen that can change what forty people are allowed to do. */
export async function resetAllPrivilegeRules(): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  const { error: dbError } = await db()
    .from("privilege_rules")
    .delete()
    .in("key", PRIVILEGE_REGISTRY.map((p) => p.key));
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "privilege_rules_reset_all", "privilege_rules", null, {});
  done();
  return { ok: true };
}
