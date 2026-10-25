"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/server/data";
import { db } from "@/lib/supabase";
import { logAudit } from "@/server/audit";
import { canRunLcTools } from "@/lib/rbac";
import { MEMBER_ROLES, LC_FUNCTIONS, SUB_FUNCTIONS } from "@/lib/types";
import {
  TAB_HREFS, TAB_REGISTRY, cleanAudience, publicTwinLive, ruleFromRow, tabCanWiden, type TabBase,
} from "@/lib/tabs";
import { bustTabRules } from "@/server/tabs";
import { broadcast } from "@/server/realtime";
import { warSnapshot } from "@/server/war";
import { WAR_ROOM_PATH, WAR_SLUG } from "@/lib/war/model";

/** WRITES for Settings → Tabs (v38). The LCP and the admins only
 *  (`canRunLcTools` — the LC decided who runs the LC's tools), never from a
 *  test view: a rule saved there would be credited to the impersonated
 *  member. Every save busts the rule cache and revalidates the layout so the
 *  sidebar changes on the next click. */

type Res = { ok: true; publicLive?: boolean } | { ok: false; error: string };
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

/** Is this tab's public twin live, read straight from the table (never the
 *  30-second copy)? null = no twin, or the read failed. */
async function twinLive(href: string): Promise<boolean | null> {
  if (!TAB_REGISTRY.find((t) => t.href === href)?.publicHref) return null;
  const { data, error } = await db().from("tab_rules").select("*").eq("href", href).maybeSingle();
  if (error) return null;
  return publicTwinLive(data ? ruleFromRow(data as Record<string, unknown>) : undefined);
}

/** THE LIVE BOARD FOLLOWS ITS SWITCH (v38.3). /no-peace is pushed to over
 *  Realtime, so taking it down in the database alone left every open board
 *  live and still receiving. live → off tells open boards it closed (they
 *  reload into the 404); off → live pushes a fresh snapshot, since nothing
 *  was broadcast while it was down. Best effort: a failed push only means a
 *  viewer sees it on their next load. */
async function announceTwin(href: string, before: boolean | null): Promise<boolean | null> {
  const after = await twinLive(href);
  if (href !== WAR_ROOM_PATH || after === null || after === before) return after;
  if (!after) broadcast(WAR_SLUG, "closed", {});
  else {
    try {
      broadcast(WAR_SLUG, "snapshot", await warSnapshot());
    } catch (e) {
      console.error("[tabs] war snapshot for reopen failed:", e instanceof Error ? e.message : e);
    }
  }
  return after;
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
  const show = audience(input.show);
  // HIDE-ONLY tabs (lib/tabs.ts): their pages have no role check of their own
  // behind the gate, so no rule may hand them out — refused, not dropped,
  // so the person saving knows
  if (!tabCanWiden(def.href) && (base === "everyone" || show.members.length + show.roles.length + show.functions.length > 0))
    return fail(`${def.label} can only be hidden — it can't be shown to anyone the code doesn't already give it to.`);
  const before = await twinLive(def.href);

  const row = {
    href: input.href,
    label: label && label !== def.label ? label : null,
    base,
    show_to: show,
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
  await announceTwin(def.href, before);
  return { ok: true };
}

/** Retire = "delete" from the LC's point of view: hidden from everyone,
 *  restorable. `publicToo` sets the public twin to FOLLOW the tab (v38.3) —
 *  down while retired, back on restore — instead of switching it off for
 *  good: restore used to clear `public_off`, which also brought back a page
 *  someone had switched off on purpose. `publicToo=false` now really keeps
 *  it up. */
export async function retireTab(href: string, publicToo: boolean): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!TAB_HREFS.has(href)) return fail("Unknown tab.");
  const def = TAB_REGISTRY.find((t) => t.href === href)!;
  const before = await twinLive(href);
  const now = new Date().toISOString();
  const { error: dbError } = await db().from("tab_rules").upsert(
    {
      href,
      retired_at: now,
      ...(def.publicHref ? { public_with_tab: publicToo === true } : {}),
      updated_by: viewer.id,
      updated_at: now,
    },
    { onConflict: "href" }
  );
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "tab_retire", "tab_rules", null, { href, publicToo });
  done();
  const publicLive = await announceTwin(href, before);
  return { ok: true, ...(publicLive === null ? {} : { publicLive }) };
}

/** Bring a retired (or date-removed) tab back: clears retired_at and a
 *  remove date that has already passed. The public twin comes back only if
 *  it was following the tab — a page switched off on its own stays off
 *  (`publicLive` tells the manager which). */
export async function restoreTab(href: string): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!TAB_HREFS.has(href)) return fail("Unknown tab.");
  const before = await twinLive(href);
  const { data } = await db().from("tab_rules").select("remove_at").eq("href", href).maybeSingle();
  const pastRemove = data?.remove_at && Date.parse(data.remove_at as string) <= Date.now();
  const { error: dbError } = await db()
    .from("tab_rules")
    .update({
      retired_at: null,
      ...(pastRemove ? { remove_at: null } : {}),
      updated_by: viewer.id,
      updated_at: new Date().toISOString(),
    })
    .eq("href", href);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "tab_restore", "tab_rules", null, { href });
  done();
  const publicLive = await announceTwin(href, before);
  return { ok: true, ...(publicLive === null ? {} : { publicLive }) };
}

/** Forget every rule on a tab — it goes back to what the code says. Its
 *  place in the LC's order is NOT a rule about who sees it: a tab that has a
 *  position keeps it (v38.3 — deleting the row sent it to the bottom). */
export async function resetTabRule(href: string): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!TAB_HREFS.has(href)) return fail("Unknown tab.");
  const before = await twinLive(href);
  const { data: current, error: readError } = await db()
    .from("tab_rules")
    .select("position")
    .eq("href", href)
    .maybeSingle();
  if (readError) return fail(readError.message);
  const { error: dbError } =
    typeof current?.position === "number"
      ? await db()
          .from("tab_rules")
          .update({
            label: null,
            base: "default",
            show_to: {},
            hide_from: {},
            visible_from: null,
            remove_at: null,
            retired_at: null,
            public_off: false,
            public_with_tab: false,
            note: null,
            updated_by: viewer.id,
            updated_at: new Date().toISOString(),
          })
          .eq("href", href)
      : await db().from("tab_rules").delete().eq("href", href);
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "tab_rule_reset", "tab_rules", null, { href });
  done();
  await announceTwin(href, before);
  return { ok: true };
}

/** The LC's default sidebar order. A member's own arrangement still wins on
 *  their device — this is where a fresh sidebar starts. Writes ONLY the
 *  position (v38.3): stamping updated_by on every row made each tab's rule
 *  read "by" whoever last nudged an arrow. The audit log keeps who moved it. */
export async function saveTabOrder(hrefs: string[]): Promise<Res> {
  const { viewer, error } = await admin();
  if (error) return fail(error);
  if (!Array.isArray(hrefs)) return fail("Nothing to save.");
  const clean = [...new Set(hrefs.filter((h) => TAB_HREFS.has(h)))];
  if (clean.length === 0) return fail("Nothing to save.");
  const rows = clean.map((href, i) => ({ href, position: i }));
  const { error: dbError } = await db().from("tab_rules").upsert(rows, { onConflict: "href" });
  if (dbError) return fail(dbError.message);
  await logAudit(viewer.id, "tab_order", "tab_rules", null, { order: clean });
  done();
  return { ok: true };
}
