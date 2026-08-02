"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import {
  bookableTouchPointScopes,
  canBookTouchPoint,
  canEditTouchPoint,
  type Viewer,
} from "@/lib/rbac";
import {
  NO_WORKING_HOURS_FUNCTIONS,
  TOUCH_POINT_KINDS,
  TOUCH_POINT_SCOPES,
  touchPointLabel,
  type TouchPointKind,
  type TouchPointScope,
} from "@/lib/types";
import { audienceLabel, cairoWhen, expandTouchPointFns } from "@/lib/touch-points";
import { cairoToUtc } from "@/lib/time";
import { getViewer, logAudit } from "./data";
import { recordUndo, sandboxSuppressed, snapshotForUndo } from "./sandbox";
import { notifyTouchPointAudience } from "./tm-notify";
import { sendEmail } from "@/lib/google/gmail";
import { resolveAttendancePrompts } from "./attendance-read";
import {
  getTouchPoint,
  invitableTeams,
  tmLeadEmails,
  touchPointAudience,
  type TouchPointRow,
} from "./touch-points-read";

/** TM TOUCH POINTS (v29) — the LC's meetings, working hours and outings.
 *  Booking rights come from rbac (`bookableTouchPointScopes`); a create, move
 *  or cancel emails + bells the whole audience with the TM VP on CC.
 *
 *  v31 — the announcement is a DECISION, not a reflex. It is off when the
 *  start time is already past (that's a touch point being LOGGED, not booked)
 *  or when the booker unticked "Tell everyone invited", and the answer is
 *  stored on the row (`announced`, migration 0033) so a later move or cancel
 *  stays just as quiet. Attendance is unaffected — recording it is the whole
 *  reason a past touch point gets logged. */

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; code?: string };

const fail = (error: string, code?: string): Result<never> => ({ ok: false, error, code });
const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function refresh() {
  revalidatePath("/", "layout");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}/;
/** A few minutes of slack for clock skew between the booker and the server —
 *  a start "two minutes ago" is still NOW, not a past log. */
const PAST_GRACE_MS = 5 * 60_000;
const isPastStart = (at: Date) => at.getTime() < Date.now() - PAST_GRACE_MS;

/** `touch_points.announced` (migration 0033). The read layer's TouchPointRow
 *  predates the column, so read it defensively — anything older than 0033 was
 *  announced, because announcing was the only behaviour there was. */
const wasAnnounced = (tp: TouchPointRow): boolean =>
  (tp as TouchPointRow & { announced?: boolean }).announced !== false;

/** The LC lives on CAIRO wall-clock: the browser sends the date and the time
 *  it typed, the server decides which instant that is (DST-aware). Never
 *  parse an offset-less string here — a booker abroad would shift everyone. */
function cairoStart(date: unknown, time: unknown): Date | null {
  const d = String(date ?? "");
  const t = String(time ?? "");
  if (!DATE_RE.test(d) || !TIME_RE.test(t)) return null;
  const at = cairoToUtc(d, t);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** One place decides what the audience is told, so a move and a cancel can
 *  never drift apart — and one place applies the sandbox rule (a test view
 *  bells the TESTER only and mails nobody: `notifyTouchPointAudience` +
 *  the `sandboxSuppressed` gate below). */
async function announce(
  tp: TouchPointRow,
  /** the member whose click caused this — the sandbox's only recipient */
  actorId: string,
  mode: "created" | "moved" | "cancelled",
  extra?: { previousWhen?: string; reason?: string }
): Promise<void> {
  const label = touchPointLabel(tp.scope, tp.kind);
  const audience = await touchPointAudience(tp);
  const who = audienceLabel(tp);
  const when = cairoWhen(tp.starts_at);

  const title =
    mode === "created"
      ? `📅 ${label} — ${when}`
      : mode === "moved"
        ? `🔁 ${label} moved — now ${when}`
        : `❌ ${label} cancelled (${when})`;
  const body =
    mode === "cancelled"
      ? extra?.reason ?? "It's off."
      : `${who} · booked by ${tp.owner_name}${tp.note ? ` — ${tp.note}` : ""}`;

  await notifyTouchPointAudience(
    actorId,
    audience.map((m) => m.id),
    "broadcast",
    title,
    body,
    tp.owner_id ?? null,
    "/calendar"
  );

  // …and NO email leaves the building during a test view
  if (await sandboxSuppressed(`touch-point ${mode} email`)) return;
  const to = audience.map((m) => m.email).filter((e): e is string => !!e);
  if (to.length === 0) return;
  const cc = (await tmLeadEmails()).filter((e) => !to.includes(e));

  const {
    touchPointInviteEmail,
    touchPointMovedEmail,
    touchPointCancelledEmail,
  } = await import("@/lib/email/touchpoint-templates");
  const base = {
    label,
    whenLabel: when,
    audience: who,
    ownerName: tp.owner_name,
    note: tp.note,
  };
  const mail =
    mode === "created"
      ? touchPointInviteEmail(base)
      : mode === "moved"
        ? touchPointMovedEmail({ ...base, previousWhen: extra?.previousWhen ?? "—" })
        : touchPointCancelledEmail({ ...base, reason: extra?.reason ?? "—" });

  await sendEmail({ to, cc, subject: mail.subject, html: mail.html }).catch((e) =>
    console.error("[touch-points] announce email failed:", e)
  );
}

export interface CreateTouchPointInput {
  scope: TouchPointScope;
  kind: TouchPointKind;
  /** required for team + function points (the VP picks when ambiguous) */
  functionKey?: string | null;
  /** required for team points */
  teamName?: string | null;
  /** CAIRO wall-clock of the START (there is no end time, by design) — the
   *  server converts, so a booker on another timezone can't shift the LC */
  date: string;
  time: string;
  note?: string | null;
  invitedTeams?: string[];
  invitedFunctions?: string[];
  /** Tell everyone invited (email + bell). DEFAULT TRUE — only an explicit
   *  `false` mutes it. A start time in the PAST mutes it regardless: that's a
   *  touch point being LOGGED after the fact, and nobody wants an invitation
   *  to a meeting they already sat through. */
  notify?: boolean;
}

/** The booking matrix in one sentence — so a refusal explains itself instead
 *  of saying "above your access" (v29.3: one scope per role). */
function scopeRefusal(viewer: Viewer): string {
  const allowed = bookableTouchPointScopes(viewer);
  if (allowed.length === 0)
    return "Only Team Leaders (team), VPs & Directors (function) and TM (LC) book touch points.";
  if (allowed.includes("lc"))
    return "TM books the LC's touch points — a function's or a team's belong to its VP/Director or its Team Leader.";
  if (allowed.includes("function"))
    return "You book FUNCTION touch points — a team's touch point is its Team Leader's call.";
  return "You book your own TEAM's touch points — function and LC ones aren't yours to book.";
}

export async function createTouchPoint(
  input: CreateTouchPointInput
): Promise<Result<{ id: string; announced: boolean }>> {
  const viewer = await getViewer();
  const scope = input.scope;
  const kind = input.kind;
  if (!TOUCH_POINT_SCOPES.includes(scope) || !TOUCH_POINT_KINDS.includes(kind))
    return fail("Pick a valid touch-point type.");
  // THE booking gate: exactly one scope per role (LCP/admin excepted). A VP
  // asking for "team", or TM asking for "function"/"team", stops right here —
  // the picker hides them, and the server means it.
  if (!canBookTouchPoint(viewer, scope))
    return fail(scopeRefusal(viewer), "forbidden");

  const startsAt = cairoStart(input.date, input.time);
  if (!startsAt) return fail("Pick the date and start time.");
  // v31: a start in the PAST is legal — it means "I'm logging a touch point
  // that already happened" (attendance is still taken on it, which is the
  // whole point). What it must NEVER do is invite people to it, so the
  // announcement is off for past points no matter what the booker ticked.
  const announced = input.notify !== false && !isPastStart(startsAt);

  const ownFns = [...viewer.functions, ...viewer.sub_functions];
  const functionKey =
    scope === "lc" ? null : clean(input.functionKey, 20) || ownFns[0] || null;
  if (scope !== "lc" && !functionKey) return fail("Pick the function.");
  if (
    scope !== "lc" &&
    functionKey &&
    !ownFns.includes(functionKey) &&
    !(viewer.isAdmin || viewer.role === "LCP")
  )
    return fail("You can only book for your own function.", "forbidden");

  // TEAM BINDING — a team name is free text in the DB and the audience is
  // resolved from it, so an unchecked name would let a Team Leader book for,
  // announce to and mark ABSENT a team they have no authority over.
  let teamName: string | null = null;
  let invitedTeams: string[] = [];
  if (scope === "team") {
    // the registry of teams in the function the viewer just proved they own
    const known = new Set([
      ...(viewer.team_name ? [viewer.team_name] : []), // registry may lag members.team_name
      ...(await invitableTeams(functionKey!, null)),
    ]);
    // v29.3: a VP/Director can no longer reach this branch at all (they book
    // FUNCTION points) — only the LCP/admin still pick any team in the registry
    const picksAnyTeam = viewer.isAdmin || viewer.role === "LCP";
    const picked = clean(input.teamName, 60) || viewer.team_name || "";
    // a Team Leader / Coordinator owns exactly one team — never someone else's
    teamName = picksAnyTeam
      ? known.has(picked)
        ? picked
        : null
      : picked && picked === viewer.team_name
        ? picked
        : null;
    if (!teamName)
      return fail(
        picksAnyTeam
          ? "Pick one of your function's teams."
          : "You can only book for your own team.",
        "forbidden"
      );
    invitedTeams = [...new Set((input.invitedTeams ?? []).map((t) => clean(t, 60)))]
      .filter((t) => t && t !== teamName && known.has(t))
      .slice(0, 10);
  }

  // TM / F&L / CXP have no working floor — no working hours for or with them
  if (kind === "working_hours" && functionKey && NO_WORKING_HOURS_FUNCTIONS.includes(functionKey))
    return fail(`${functionKey} doesn't run working hours.`);
  // "B2B" and "BD" are the same crew — inviting the other name would be a
  // no-op duplicate of the point's own function
  const fnSelf = expandTouchPointFns(functionKey ? [functionKey] : []);
  const invitedFunctions =
    scope === "function"
      ? [
          ...new Set(
            (input.invitedFunctions ?? [])
              .map((f) => clean(f, 20))
              .filter((f) => f && !fnSelf.has(f) && !NO_WORKING_HOURS_FUNCTIONS.includes(f))
          ),
        ].slice(0, 10)
      : [];

  const { data: created, error } = await db()
    .from("touch_points")
    .insert({
      scope,
      kind,
      function_key: functionKey,
      team_name: teamName,
      starts_at: startsAt.toISOString(),
      note: clean(input.note, 500) || null,
      invited_teams: invitedTeams,
      invited_functions: invitedFunctions,
      owner_id: viewer.id,
      owner_name: viewer.nickname || viewer.name,
      // remembered on the row (0033) so a later move/cancel can't mail people
      // who were never told this touch point existed
      announced,
    })
    .select("*")
    .single<TouchPointRow>();
  if (error || !created) return fail(error?.message ?? "Could not book it — try again.");

  await recordUndo("touch_points", created.id, "insert");
  if (announced) await announce(created, viewer.id, "created");
  await logAudit(viewer.id, "touch_point_create", "touch_point", created.id, {
    scope,
    kind,
    fn: functionKey,
    announced,
  });
  refresh();
  return { ok: true, data: { id: created.id, announced } };
}

export async function updateTouchPoint(
  id: string,
  patch: { date?: string; time?: string; note?: string | null }
): Promise<Result> {
  const viewer = await getViewer();
  const tp = await getTouchPoint(id);
  if (!tp) return fail("That touch point no longer exists.");
  if (!canEditTouchPoint(viewer, tp))
    return fail("Only its owner, the function's VP/Director or TM can change it.", "forbidden");
  if (tp.status !== "scheduled") return fail("This touch point is cancelled.");

  // was anyone ever invited to this? A LOGGED point (past start, or the booker
  // switched the announcement off) has an audience that never heard of it —
  // moving or cancelling it must stay just as quiet.
  const announced = wasAnnounced(tp);

  const next: Record<string, unknown> = {};
  let moved = false;
  const previousWhen = cairoWhen(tp.starts_at);
  if (patch.date || patch.time) {
    const d = cairoStart(patch.date, patch.time);
    if (!d) return fail("That date and time don't look right.");
    // an ANNOUNCED point is a real appointment people are holding — it can't
    // be dragged into the past. A logged one is a record: correcting when it
    // actually happened is exactly what editing it is for.
    if (announced && isPastStart(d))
      return fail("You can't move a touch point into the past.");
    // the stored value comes back with a "+00:00" offset — compare instants
    if (d.getTime() !== new Date(tp.starts_at).getTime()) {
      next.starts_at = d.toISOString();
      moved = true;
    }
  }
  if (patch.note !== undefined) next.note = clean(patch.note, 500) || null;
  if (Object.keys(next).length === 0) return { ok: true };

  await snapshotForUndo("touch_points", id);
  const { error } = await db().from("touch_points").update(next).eq("id", id);
  if (error) return fail(error.message);

  // a MOVE is news — the audience hears about it again (unless they were
  // never told about the touch point in the first place)
  if (moved && announced) {
    const fresh = await getTouchPoint(id);
    if (fresh) await announce(fresh, viewer.id, "moved", { previousWhen });
  }
  await logAudit(viewer.id, "touch_point_update", "touch_point", id, { moved, announced });
  refresh();
  return { ok: true };
}

export async function cancelTouchPoint(id: string, reason: string): Promise<Result> {
  const viewer = await getViewer();
  const tp = await getTouchPoint(id);
  if (!tp) return fail("That touch point no longer exists.");
  if (!canEditTouchPoint(viewer, tp))
    return fail("Only its owner, the function's VP/Director or TM can cancel it.", "forbidden");
  if (tp.status === "cancelled") return fail("It's already cancelled.");
  const why = clean(reason, 500);
  if (why.length < 3) return fail("Add a short reason — everyone invited reads it.");

  await snapshotForUndo("touch_points", id);
  const { error } = await db()
    .from("touch_points")
    .update({ status: "cancelled", cancel_reason: why })
    .eq("id", id);
  if (error) return fail(error.message);

  // a cancelled point can never be recorded, so its nag prompts can never be
  // resolved by a save — clear them here or they block the responsible forever
  if (!(await sandboxSuppressed("attendance prompt resolve")))
    await resolveAttendancePrompts(id);

  // …and a point nobody was ever invited to is dropped in silence
  if (wasAnnounced(tp))
    await announce({ ...tp, status: "cancelled" }, viewer.id, "cancelled", { reason: why });
  await logAudit(viewer.id, "touch_point_cancel", "touch_point", id, { reason: why });
  refresh();
  return { ok: true };
}
