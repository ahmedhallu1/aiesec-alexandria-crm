import { db } from "@/lib/supabase";
import {
  isTmCore,
  type Viewer,
} from "@/lib/rbac";
import type { TouchPointKind, TouchPointScope } from "@/lib/types";

/** Reads for TM touch points (v29). Plain module — NOT "use server" — so the
 *  calendar, the attendance module and the actions can all share it. */

export interface TouchPointRow {
  id: string;
  scope: TouchPointScope;
  kind: TouchPointKind;
  function_key: string | null;
  team_name: string | null;
  starts_at: string;
  note: string | null;
  invited_teams: string[];
  invited_functions: string[];
  status: "scheduled" | "cancelled";
  cancel_reason: string | null;
  owner_id: string | null;
  owner_name: string;
  attendance_recorded_at: string | null;
}

export interface AudienceMember {
  id: string;
  name: string;
  nickname: string | null;
  email: string | null;
  role: string;
  team_name: string | null;
}

const fnsOf = (m: { functions?: string[] | null; sub_functions?: string[] | null }) => [
  ...(m.functions ?? []),
  ...(m.sub_functions ?? []),
];

/** Everyone expected at a touch point — the audience the invite goes to and
 *  the exact list attendance is taken over. */
export async function touchPointAudience(tp: TouchPointRow): Promise<AudienceMember[]> {
  const { data } = await db()
    .from("members")
    .select("id, name, nickname, email, role, team_name, functions, sub_functions")
    .eq("is_active", true)
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (data ?? []) as any[];
  const teams = new Set([...(tp.invited_teams ?? []), ...(tp.team_name ? [tp.team_name] : [])]);
  const functions = new Set([
    ...(tp.invited_functions ?? []),
    ...(tp.function_key ? [tp.function_key] : []),
  ]);

  const keep = all.filter((m) => {
    if (tp.scope === "lc") return true;
    if (tp.scope === "function") return fnsOf(m).some((f) => functions.has(f));
    // a team point: that team's members, plus any invited team's members —
    // and any invited FUNCTION comes along whole (a team may invite siblings)
    return (
      (m.team_name && teams.has(m.team_name)) ||
      fnsOf(m).some((f) => (tp.invited_functions ?? []).includes(f))
    );
  });
  // the owner always belongs to their own touch point
  const withOwner =
    tp.owner_id && !keep.some((m) => m.id === tp.owner_id)
      ? [...keep, ...all.filter((m) => m.id === tp.owner_id)]
      : keep;
  return withOwner.map((m) => ({
    id: m.id,
    name: m.name,
    nickname: m.nickname,
    email: m.email,
    role: m.role,
    team_name: m.team_name,
  }));
}

/** Is this viewer part of the audience (so: does it belong on their calendar)?
 *  TM core sees everything; a member also sees OTHER teams' points inside
 *  their own function (explicit product rule). */
export function viewerSeesTouchPoint(viewer: Viewer, tp: TouchPointRow): boolean {
  if (isTmCore(viewer)) return true;
  if (tp.scope === "lc") return true;
  const mine = fnsOf(viewer);
  const fns = [...(tp.invited_functions ?? []), ...(tp.function_key ? [tp.function_key] : [])];
  if (fns.some((f) => mine.includes(f))) return true;
  const teams = [...(tp.invited_teams ?? []), ...(tp.team_name ? [tp.team_name] : [])];
  return !!viewer.team_name && teams.includes(viewer.team_name);
}

/** Every touch point the viewer may see in a window (the calendar month). */
export async function listTouchPoints(
  viewer: Viewer,
  range?: { from: string; to: string }
): Promise<TouchPointRow[]> {
  let q = db().from("touch_points").select("*").order("starts_at");
  if (range) q = q.gte("starts_at", range.from).lte("starts_at", range.to);
  const { data, error } = await q;
  if (error) {
    console.error("[touch-points] list failed:", error.message);
    return [];
  }
  return ((data ?? []) as TouchPointRow[]).filter((tp) => viewerSeesTouchPoint(viewer, tp));
}

export async function getTouchPoint(id: string): Promise<TouchPointRow | null> {
  const { data } = await db()
    .from("touch_points")
    .select("*")
    .eq("id", id)
    .maybeSingle<TouchPointRow>();
  return data ?? null;
}

/** The TM VP/Director — CC'd on every touch-point email by design. */
export async function tmLeadEmails(): Promise<string[]> {
  const { data } = await db()
    .from("members")
    .select("email, role, functions, sub_functions")
    .eq("is_active", true)
    .in("role", ["LCVP", "Director"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter((m) => fnsOf(m).includes("TM") && m.email)
    .map((m) => m.email as string);
}

/** Sibling teams a viewer may invite to a team touch point, and the other
 *  functions invitable to a function touch point. */
export async function invitableTeams(functionKey: string, exclude?: string | null): Promise<string[]> {
  const { data } = await db()
    .from("teams")
    .select("name, function_key, type")
    .eq("type", "Team")
    .eq("function_key", functionKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .map((t) => t.name as string)
    .filter((n) => n && n !== exclude);
}
