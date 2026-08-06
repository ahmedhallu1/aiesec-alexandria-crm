import { db } from "@/lib/supabase";
import {
  isTmCore,
  type Viewer,
} from "@/lib/rbac";
import { NO_WORKING_HOURS_FUNCTIONS, type TouchPointKind, type TouchPointScope } from "@/lib/types";
import { expandTouchPointFns } from "@/lib/touch-points";

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
  email: string | null;
  role: string;
  team_name: string | null;
}

const fnsOf = (m: { functions?: string[] | null; sub_functions?: string[] | null }) => [
  ...(m.functions ?? []),
  ...(m.sub_functions ?? []),
];

/** The teams a person belongs to. The membership sheet lists ALL of them in
 *  one cell — "Suits, شماريخ" is the function-leaders team AND the LB — so a
 *  team is a member of this list, never the whole string (v33.5).
 *
 *  Matching the whole cell was two bugs at once: a touch point was labelled
 *  with the full list ("booked for Suits, شماريخ" instead of Hana's team), and
 *  the audience only matched people whose cell was byte-identical, so anyone
 *  belonging to a different combination of the same teams was silently left
 *  out of the invite and the attendance sheet. */
export function teamsOf(cell: string | null | undefined): string[] {
  return (cell ?? "")
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** What to CALL a Team Leader's own team.
 *
 *  Most TL teams have no name at all: the registry holds EB, LB, function and
 *  function-leaders teams, and a leader's cell lists those — Hana's reads
 *  "Suits, شماريخ", which is the B2B function-leaders team and the LB, neither
 *  of which is her team. So: the registered `Team` from her cell if one
 *  exists, otherwise "Hana Wael's team", the same convention the dashboard
 *  filters already use. The NAME is only a label — who actually belongs is
 *  decided by who reports to her (v33.5). */
export async function ownTeamName(v: {
  name: string;
  team_name: string | null;
}): Promise<string> {
  const names = teamsOf(v.team_name);
  if (names.length > 0) {
    const { data } = await db().from("teams").select("name").eq("type", "Team");
    const registered = new Set(
      ((data ?? []) as { name: string }[]).map((t) => t.name.trim().toLowerCase())
    );
    const real = names.find((n) => registered.has(n.toLowerCase()));
    if (real) return real;
  }
  return `${v.name}'s team`;
}

/** The pure per-member membership test behind `touchPointAudience` — also
 *  powers the calendar's "only mine" filter (v33.16), where it answers "does
 *  this touch point actually involve ME" without the whole-members scan. */
export function memberInTouchPointAudience(
  m: {
    id: string;
    team_name: string | null;
    stakeholder_id: string | null;
    functions: string[] | null;
    sub_functions: string[] | null;
    role?: string | null;
  },
  tp: TouchPointRow
): boolean {
  // the ADMIN is the system's caretaker, not an attendee (v33.19, by the
  // LCP's request): never in any audience, never on an attendance sheet
  if (m.role === "Admin") return false;
  // the owner always belongs to their own touch point
  if (tp.owner_id && m.id === tp.owner_id) return true;
  const teams = new Set([...(tp.invited_teams ?? []), ...(tp.team_name ? [tp.team_name] : [])]);
  const functions = expandTouchPointFns([
    ...(tp.invited_functions ?? []),
    ...(tp.function_key ? [tp.function_key] : []),
  ]);
  const invFns = expandTouchPointFns(tp.invited_functions ?? []);
  // a team point belongs to ONE function — a team name matching across
  // functions would drag strangers into someone's attendance sheet
  const ownFns = expandTouchPointFns(tp.function_key ? [tp.function_key] : []);
  if (tp.scope === "lc")
    // TM / F&L / CXP have nothing that stamps work — an LC working-hours
    // session must not judge people with no stampable workspace
    return (
      tp.kind !== "working_hours" ||
      !fnsOf(m).some((f) => NO_WORKING_HOURS_FUNCTIONS.includes(f))
    );
  if (tp.scope === "function") return fnsOf(m).some((f) => functions.has(f));
  // a team point: that team's members INSIDE the point's own function, plus
  // any invited team's — and an invited FUNCTION comes along whole
  // A TEAM IS WHO REPORTS TO THE LEADER, not who shares a string (v33.5).
  // Most TL teams have no registered name, and the members' team cells list
  // the structural teams instead — so name-matching quietly produced an
  // audience of nobody. The manager link is the actual team; the name match
  // stays for INVITED teams, which are named by definition.
  if (tp.owner_id && m.stakeholder_id === tp.owner_id) return true;
  return (
    (teamsOf(m.team_name).some((t) => teams.has(t)) &&
      (ownFns.size === 0 || fnsOf(m).some((f) => ownFns.has(f)))) ||
    fnsOf(m).some((f) => invFns.has(f))
  );
}

/** Everyone expected at a touch point — the audience the invite goes to and
 *  the exact list attendance is taken over. */
export async function touchPointAudience(tp: TouchPointRow): Promise<AudienceMember[]> {
  const { data } = await db()
    .from("members")
    .select("id, name, email, role, team_name, stakeholder_id, functions, sub_functions")
    .eq("is_active", true)
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (data ?? []) as any[];
  const keep = all.filter((m) => memberInTouchPointAudience(m, tp));
  // the owner always belongs to their own touch point
  const withOwner =
    tp.owner_id && !keep.some((m) => m.id === tp.owner_id)
      ? [...keep, ...all.filter((m) => m.id === tp.owner_id && m.role !== "Admin")]
      : keep;
  return withOwner.map((m) => ({
    id: m.id,
    name: m.name,
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
  const fns = expandTouchPointFns([
    ...(tp.invited_functions ?? []),
    ...(tp.function_key ? [tp.function_key] : []),
  ]);
  if (mine.some((f) => fns.has(f))) return true;
  if (tp.owner_id && viewer.stakeholder_id === tp.owner_id) return true;
  const teams = [...(tp.invited_teams ?? []), ...(tp.team_name ? [tp.team_name] : [])];
  return teamsOf(viewer.team_name).some((t) => teams.includes(t));
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
    // B2B and BD are one crew — their teams are registered under either name
    .in("function_key", [...expandTouchPointFns([functionKey])]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .map((t) => t.name as string)
    .filter((n) => n && n !== exclude);
}
