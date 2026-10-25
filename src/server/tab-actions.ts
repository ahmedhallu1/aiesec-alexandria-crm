"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/server/data";
import { db } from "@/lib/supabase";
import { logAudit } from "@/server/audit";
import { canRunLcTools } from "@/lib/rbac";
import { MEMBER_ROLES, LC_FUNCTIONS, SUB_FUNCTIONS } from "@/lib/types";
import { TAB_HREFS, TAB_REGISTRY, cleanAudience, type TabBase } from "@/lib/tabs";
import { bustTabRules } from "@/server/tabs";

/** WRITES for Settings → Tabs (v38). The LCP and the admins only
 *  (`canRunLcTools` — the LC decided who runs the LC's tools), never from a
 *  test view: a rule saved there would be credited to the impersonated
 *  member. Every save busts the rule cache and revalidates the layout so the
 *  sidebar changes on the next click. */

type Res = { ok: true } | { ok: false; error: string };
const fail = (error: string): Res => ({ ok: false, error });

async function admin() {
  const viewer = await getViewer();
  if (!canRunLcTools(viewer)) return { viewer, error: "Only the LCP and the admins manage tabs." };
  if (viewer.impersonated) return { viewer, error: "Exit the test view first — the change would be credited to someone else." };
  return { viewer, error: null as string | null };
}

function done() {
  bustTabRules();
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
    // functions on the sheet are free-form (an unknown value is imported
    // as-is), so anything short and printable is allowed — known ones first
    functions: a.functions.filter((f) => FUNCTIONS.has(f) || /^[\w&+ -]{1,20}$/.test(f)),
  };
}

const when = (v: unknown): string | null | "bad" => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return "bad";
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : "bad";
};

export interface TabRuleInput {
  href: string;
  label?: string | null;
  base?: TabBase;
  show?: unknown;
  hide?: unknown;
  visibleFrom?: string | null;
  removeAt?: string | null;
  publicOff?: boolean;
  publicWithTab?: boolean;
  note?: string | null;
}

export async function saveTabRule(input: TabRuleInput): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!TAB_HREFS.has(input.href)) return fail("Unknown tab.");
  const base: TabBase = input.base === "everyone" || input.base === "nobody" ? input.base : "default";
  const visibleFrom = when(input.visibleFrom);
  const removeAt = when(input.removeAt);
  if (visibleFrom === "bad" || removeAt === "bad") return fail("A date isn't valid.");
  if (visibleFrom && removeAt && Date.parse(removeAt) <= Date.parse(visibleFrom))
    return fail("The remove date must come after the show date.");
  const label = typeof input.label === "string" ? input.label.trim().slice(0, 40) : "";
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  const def = TAB_REGISTRY.find((t) => t.href === input.href)!;

  const row = {
    href: input.href,
    label: label && label !== def.label ? label : null,
    base,
    show_to: audience(input.show),
    hide_from: audience(input.hide),
    visible_from: visibleFrom,
    remove_at: removeAt,
    public_off: def.publicHref ? input.publicOff === true : false,
    public_with_tab: def.publicHref ? input.publicWithTab === true : false,
    note: note || null,
    updated_by: viewer.id,
    updated_at: new Date().toISOString(),
  };
  const { error: dbError } = await db().from("tab_rules").upsert(row, { onConflict: "href" });
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "tab_rule_save", "tab_rules", null, row);
  done();
  return { ok: true };
}

/** Retire = "delete" from the LC's point of view: hidden from everyone,
 *  restorable. `publicToo` also takes the public twin down. */
export async function retireTab(href: string, publicToo: boolean): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!TAB_HREFS.has(href)) return fail("Unknown tab.");
  const def = TAB_REGISTRY.find((t) => t.href === href)!;
  const now = new Date().toISOString();
  const { error: dbError } = await db().from("tab_rules").upsert(
    {
      href,
      retired_at: now,
      ...(def.publicHref && publicToo ? { public_off: true } : {}),
      updated_by: viewer.id,
      updated_at: now,
    },
    { onConflict: "href" }
  );
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "tab_retire", "tab_rules", null, { href, publicToo });
  done();
  return { ok: true };
}

/** Bring a retired (or date-removed) tab back: clears retired_at and a
 *  remove date that has already passed, and the public twin comes back. */
export async function restoreTab(href: string): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!TAB_HREFS.has(href)) return fail("Unknown tab.");
  const { data } = await db().from("tab_rules").select("remove_at").eq("href", href).maybeSingle();
  const pastRemove = data?.remove_at && Date.parse(data.remove_at as string) <= Date.now();
  const { error: dbError } = await db()
    .from("tab_rules")
    .update({
      retired_at: null,
      public_off: false,
      ...(pastRemove ? { remove_at: null } : {}),
      updated_by: viewer.id,
      updated_at: new Date().toISOString(),
    })
    .eq("href", href);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "tab_restore", "tab_rules", null, { href });
  done();
  return { ok: true };
}

/** Forget every rule on a tab — it goes back to what the code says. */
export async function resetTabRule(href: string): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!TAB_HREFS.has(href)) return fail("Unknown tab.");
  const { error: dbError } = await db().from("tab_rules").delete().eq("href", href);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "tab_rule_reset", "tab_rules", null, { href });
  done();
  return { ok: true };
}

/** The LC's default sidebar order. A member's own arrangement still wins on
 *  their device — this is where a fresh sidebar starts. */
export async function saveTabOrder(hrefs: string[]): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!Array.isArray(hrefs)) return fail("Nothing to save.");
  const clean = [...new Set(hrefs.filter((h) => TAB_HREFS.has(h)))];
  if (clean.length === 0) return fail("Nothing to save.");
  const now = new Date().toISOString();
  const rows = clean.map((href, i) => ({ href, position: i, updated_by: viewer.id, updated_at: now }));
  const { error: dbError } = await db().from("tab_rules").upsert(rows, { onConflict: "href" });
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "tab_order", "tab_rules", null, { order: clean });
  done();
  return { ok: true };
}
