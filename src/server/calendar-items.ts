"use server";

/** CUSTOM CALENDAR ITEMS (v33.16) — Google-Calendar-style slots and tasks.
 *
 *  NOT touch points: a touch point derives its audience from scope/team/
 *  function and rides the attendance machinery (nightly reminder ladder,
 *  working-hours engine). A custom item's audience is the EXPLICIT list its
 *  owner picked, it has no attendance and is never nagged about. Visibility
 *  is invite-shaped: owner + assignees only.
 *
 *  Who creates for whom (server-enforced, mirrored by the dialog's picker):
 *  TL → self + their own team; LCVP/Director → their function(s); LCP-level
 *  (incl. F&L since v33.16) → anyone. Owner or LCP-level deletes.
 */

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import {
  calendarItemScopes, canCreateCalendarItems,
  type CalendarItemScope, type Viewer,
} from "@/lib/rbac";
import { cairoToUtc } from "@/lib/time";
import { expandTouchPointFns } from "@/lib/touch-points";
import { getViewer, logAudit } from "./data";
import { recordUndo } from "./sandbox";
import { notifyMembers } from "./notify";

export interface CalendarItemRow {
  id: string;
  title: string;
  note: string | null;
  starts_at: string;
  ends_at: string | null;
  owner_id: string;
  owner_name: string;
  assignee_ids: string[];
  function_key: string | null;
  /** who ELSE sees it, on top of the owner + assignees (v33.31) */
  visibility: CalendarItemScope;
  /** resolved by listCalendarItems for display */
  assignee_names?: string[];
}

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The members this viewer may put on a custom item. TL → their reports (+
 *  themself); LCVP/Director → everyone in their function(s); LCP-level → all. */
export async function assignableForItems(
  viewer: Viewer
): Promise<{ id: string; label: string }[]> {
  if (!canCreateCalendarItems(viewer)) return [];
  const { data } = await db()
    .from("members")
    .select("id, name, role, functions, sub_functions, stakeholder_id")
    .eq("is_active", true)
    .order("name");
  const all = (data ?? []) as {
    id: string; name: string; role: string;
    functions: string[] | null; sub_functions: string[] | null;
    stakeholder_id: string | null;
  }[];
  const lcpLevel =
    viewer.isAdmin || viewer.role === "LCP" || viewer.role === "Admin" ||
    (viewer.functions ?? []).includes("F&L");
  const allowed = lcpLevel
    ? all
    : viewer.role === "Team Leader"
      ? all.filter((m) => m.id === viewer.id || viewer.teamMemberIds.includes(m.id))
      : viewer.role === "LCVP" || viewer.role === "Director"
        ? all.filter((m) =>
            [...(m.functions ?? []), ...(m.sub_functions ?? [])].some((f) =>
              (viewer.functions ?? []).includes(f)
            )
          )
        : // a MEMBER/COORDINATOR reaches their own TEAM (v33.29): themself,
          // their teammates (same manager) and the TL — "a slot my team sees"
          all.filter(
            (m) =>
              m.id === viewer.id ||
              (viewer.stakeholder_id != null &&
                (m.id === viewer.stakeholder_id ||
                  m.stakeholder_id === viewer.stakeholder_id))
          );
  return allowed.map((m) => ({ id: m.id, label: m.name }));
}

export async function createCalendarItem(input: {
  title: string;
  date: string;
  time: string;
  endTime?: string | null;
  note?: string | null;
  assigneeIds: string[];
  /** ROUTINE (v33.29): repeat this slot weekly, same day + time, for N weeks
   *  total (1 = just this one). Each occurrence is its own row, so one can be
   *  deleted without touching the rest — exactly how the touch-point routine
   *  builder works. */
  repeatWeeks?: number;
  /** WHO SEES IT (v33.31) — 'self' keeps the original owner+assignees rule */
  visibility?: CalendarItemScope;
}): Promise<Result> {
  const viewer = await getViewer();
  if (!canCreateCalendarItems(viewer))
    return fail("Custom calendar items are added by Team Leaders and above.");
  const title = String(input.title ?? "").trim();
  if (!title || title.length > 120)
    return fail("Give the item a title (up to 120 characters).");
  if (!DATE_RE.test(input.date) || !TIME_RE.test(input.time))
    return fail("Pick the item's date and time.");
  const startsAt = cairoToUtc(input.date, input.time);
  let endsAt: Date | null = null;
  if (input.endTime) {
    if (!TIME_RE.test(input.endTime)) return fail("The end time doesn't look right.");
    // end 00:00 = midnight (the day after); an end before the start is the
    // same wrap — treat both as next-day rather than refusing what a person
    // obviously meant
    endsAt = cairoToUtc(input.date, input.endTime);
    if (endsAt.getTime() <= startsAt.getTime())
      endsAt = new Date(endsAt.getTime() + 86_400_000);
  }
  const note = String(input.note ?? "").trim() || null;

  // every assignee must be inside the viewer's assignable scope
  const allowed = new Set((await assignableForItems(viewer)).map((m) => m.id));
  const assigneeIds = [...new Set((input.assigneeIds ?? []).filter(Boolean))].slice(0, 80);
  for (const id of assigneeIds) {
    if (!allowed.has(id))
      return fail("One of the assignees is outside your team/function scope.");
  }

  // the scope must be one this person is actually allowed to pick
  const allowedScopes = calendarItemScopes(viewer);
  const visibility: CalendarItemScope = input.visibility ?? "self";
  if (!allowedScopes.includes(visibility))
    return fail("You can't share an item with that group.");

  const weeks = Math.min(12, Math.max(1, Math.round(input.repeatWeeks ?? 1)));
  const rows = Array.from({ length: weeks }, (_, w) => ({
    title,
    note,
    starts_at: new Date(startsAt.getTime() + w * 7 * 86_400_000).toISOString(),
    ends_at: endsAt ? new Date(endsAt.getTime() + w * 7 * 86_400_000).toISOString() : null,
    owner_id: viewer.id,
    owner_name: viewer.name,
    assignee_ids: assigneeIds,
    visibility,
    // FROZEN AT CREATION (v33.31): deriving the audience from the owner's
    // CURRENT functions would rewrite the visibility of every past item the
    // day they change function — the ir_calls.fn lesson from v33.23.
    function_key:
      (viewer.functions ?? [])[0] ?? (viewer.sub_functions ?? [])[0] ?? null,
  }));
  const { data: createdRows, error } = await db()
    .from("calendar_items")
    .insert(rows)
    .select("id");
  if (error) return fail(error.message);
  const created = (createdRows ?? [])[0] as { id: string } | undefined;
  for (const r of (createdRows ?? []) as { id: string }[])
    await recordUndo("calendar_items", r.id, "insert");

  // bell the assignees (never the owner about their own item); best-effort,
  // sandbox-suppressed inside notifyMembers
  const others = assigneeIds.filter((id) => id !== viewer.id);
  if (others.length > 0) {
    await notifyMembers(
      others,
      "info",
      `📌 ${viewer.name} added "${title}" to your calendar`,
      `${input.date} ${input.time}${weeks > 1 ? ` · repeats weekly ×${weeks}` : ""}${note ? ` — ${note}` : ""}`,
      viewer.id,
      "/calendar"
    );
  }
  await logAudit(viewer.id, "calendar_item_create", "calendar_item", created?.id ?? "?", {
    title, date: input.date, time: input.time, assignees: assigneeIds.length, weeks,
  });
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteCalendarItem(id: string): Promise<Result> {
  const viewer = await getViewer();
  const { data: item } = await db()
    .from("calendar_items")
    .select("id, title, owner_id, assignee_ids, starts_at")
    .eq("id", id)
    .maybeSingle<CalendarItemRow>();
  if (!item) return fail("That item is already gone.");
  const lcpLevel =
    viewer.isAdmin || viewer.role === "LCP" || viewer.role === "Admin" ||
    (viewer.functions ?? []).includes("F&L");
  if (item.owner_id !== viewer.id && !lcpLevel)
    return fail("Only whoever added the item (or the LCP) can remove it.");
  const { error } = await db().from("calendar_items").delete().eq("id", id);
  if (error) return fail(error.message);
  const others = (item.assignee_ids ?? []).filter((a) => a !== viewer.id);
  if (others.length > 0) {
    await notifyMembers(
      others,
      "info",
      `🗑 "${item.title}" was removed from your calendar`,
      null,
      viewer.id,
      "/calendar"
    );
  }
  await logAudit(viewer.id, "calendar_item_delete", "calendar_item", id, { title: item.title });
  revalidatePath("/calendar");
  return { ok: true };
}

/** The viewer's custom items in a UTC window — invite-shaped visibility:
 *  the ones they own plus the ones they're assigned to. */
export async function listCalendarItems(
  viewer: Viewer,
  fromIso: string,
  toIso: string
): Promise<CalendarItemRow[]> {
  // The window is a calendar MONTH — tens of rows — so the audience test runs
  // in JS rather than as a PostgREST .or() chain. A stringly-built OR across
  // five scopes is exactly the kind of thing that silently widens when
  // someone appends a clause; this way the rule is one readable predicate.
  const { data, error } = await db()
    .from("calendar_items")
    .select(
      "id, title, note, starts_at, ends_at, owner_id, owner_name, assignee_ids, function_key, visibility"
    )
    .gte("starts_at", fromIso)
    .lte("starts_at", toIso)
    .order("starts_at");
  if (error) {
    // pre-0044 DB: the table isn't there yet — the calendar renders without it
    console.error("[calendar-items] list failed:", error.message);
    return [];
  }
  const all = (data ?? []) as CalendarItemRow[];

  // the owners' team + function facts, one query, for the scope tests below
  const ownerIds = [...new Set(all.map((r) => r.owner_id))];
  const owners = new Map<string, { stakeholder_id: string | null }>();
  if (ownerIds.length > 0) {
    const { data: os } = await db()
      .from("members")
      .select("id, stakeholder_id")
      .in("id", ownerIds);
    for (const o of ((os ?? []) as { id: string; stakeholder_id: string | null }[]))
      owners.set(o.id, { stakeholder_id: o.stakeholder_id });
  }
  const myFns = expandTouchPointFns([
    ...(viewer.functions ?? []),
    ...(viewer.sub_functions ?? []),
  ]);
  const onTheEb = viewer.role === "LCP" || viewer.role === "LCVP";

  const canSee = (r: CalendarItemRow): boolean => {
    // the owner and anyone it was handed to, always — the 0044 rule
    if (r.owner_id === viewer.id) return true;
    if ((r.assignee_ids ?? []).includes(viewer.id)) return true;
    switch (r.visibility) {
      case "lc":
        return true;
      case "eb":
        return onTheEb;
      case "function": {
        if (!r.function_key) return false;
        return [...expandTouchPointFns([r.function_key])].some((f) => myFns.has(f));
      }
      case "team": {
        // teammates share a manager, or one manages the other
        const owner = owners.get(r.owner_id);
        if (!owner) return false;
        return (
          (owner.stakeholder_id != null &&
            owner.stakeholder_id === viewer.stakeholder_id) ||
          owner.stakeholder_id === viewer.id ||
          viewer.stakeholder_id === r.owner_id
        );
      }
      default:
        return false; // 'self'
    }
  };
  const rows = all.filter(canSee);
  const ids = [...new Set(rows.flatMap((r) => r.assignee_ids ?? []))];
  if (ids.length > 0) {
    const { data: people } = await db().from("members").select("id, name").in("id", ids);
    const nameOf = new Map(((people ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
    for (const r of rows) {
      r.assignee_names = (r.assignee_ids ?? [])
        .map((a) => nameOf.get(a))
        .filter((n): n is string => !!n);
    }
  }
  return rows;
}
