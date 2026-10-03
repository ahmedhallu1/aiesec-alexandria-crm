"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import {
  bookableTouchPointScopes,
  canBookTouchPoint,
  canEditTouchPoint,
  type Viewer,
} from "@/lib/rbac";
import { cairoToday, NO_WORKING_HOURS_FUNCTIONS, TOUCH_POINT_KINDS, TOUCH_POINT_SCOPES, WORK_SESSION_HOURS, type TouchPointKind, type TouchPointScope } from "@/lib/types";
import { audienceLabel, cairoWhen, expandTouchPointFns, touchPointName } from "@/lib/touch-points";
import { cairoToUtc } from "@/lib/time";
import { getViewer, logAudit } from "./data";
import { recordUndo, sandboxSuppressed, snapshotForUndo } from "./sandbox";
import { notifyTouchPointAudience } from "./tm-notify";
import { sendEmail } from "@/lib/google/gmail";
import { resolveAttendancePrompts } from "./attendance-read";
import {
  getTouchPoint,
  invitableTeams,
  ownTeamName,
  teamsOf,
  tmLeadEmails,
  derivedTouchPointAudience,
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
  const label = touchPointName(tp);
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
      : `${who}${tp.location ? ` · ${tp.location}` : ""}${tp.note ? ` — ${tp.note}` : ""}`;

  // WHO IS ACTUALLY TOLD (v33.43, by the LCP's request):
  //   · not the person who just booked it — they know, and a bell about your
  //     own click is the definition of noise;
  //   · not the LCVPs/Directors/LCP — a touch point is the floor's business
  //     and they can read the calendar. Being off the announcement does NOT
  //     remove them from the audience: attendance still covers them.
  const told = audience.filter(
    (m) => m.id !== tp.owner_id && !["LCVP", "Director", "LCP"].includes(m.role)
  );

  await notifyTouchPointAudience(
    actorId,
    told.map((m) => m.id),
    "broadcast",
    title,
    body,
    tp.owner_id ?? null,
    "/calendar"
  );

  // …and NO email leaves the building during a test view
  if (await sandboxSuppressed(`touch-point ${mode} email`)) return;
  const to = told.map((m) => m.email).filter((e): e is string => !!e);
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
    location: tp.location,
    note: tp.note,
  };
  const mail =
    mode === "created"
      ? touchPointInviteEmail(base)
      : mode === "moved"
        ? touchPointMovedEmail({ ...base, previousWhen: extra?.previousWhen ?? "—" })
        : touchPointCancelledEmail({ ...base, reason: extra?.reason ?? "—" });

  await sendEmail({ topic: "touch_points", to, cc, subject: mail.subject, html: mail.html }).catch((e) =>
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
  /** v33.43 — where it happens; meaningless (and hidden) when virtual */
  location?: string | null;
  invitedTeams?: string[];
  invitedFunctions?: string[];
  /** VIRTUAL (v32.9): creates a Google Calendar event with a Meet room and
   *  the whole audience invited, so their Yes/No RSVP becomes attendance */
  virtual?: boolean;
  /** WHO IS ACTUALLY COMING (v33.34). Omit (or send the whole derived list)
   *  and the audience stays DERIVED — it grows as people join the function.
   *  Send a narrower list and that becomes the audience: the invite and the
   *  attendance sheet both. The server refuses any id outside the derived
   *  audience, so this can only ever narrow. */
  memberIds?: string[] | null;
  /** set when a TIMELINE generated this point */
  routineId?: string | null;
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

/** WHO A TOUCH POINT IS FOR — resolved and AUTHORITY-CHECKED (v33.34).
 *
 *  Extracted from `createTouchPoint` so the booking dialog can ask "who would
 *  this invite?" before anything is booked, and get back exactly the list the
 *  create path would build. One implementation, so the preview can never
 *  offer someone the create would refuse (or hide someone it would include).
 *
 *  Everything here is a REFUSAL boundary, not a convenience: a team name is
 *  free text in the DB, so an unchecked one would let a Team Leader book for,
 *  announce to and mark ABSENT a team they have no authority over.
 */
async function resolveTouchPointTargets(
  viewer: Viewer,
  input: Pick<
    CreateTouchPointInput,
    "scope" | "kind" | "functionKey" | "teamName" | "invitedTeams" | "invitedFunctions"
  >
): Promise<
  | { error: Result<never> }
  | {
      functionKey: string | null;
      teamName: string | null;
      invitedTeams: string[];
      invitedFunctions: string[];
    }
> {
  const { scope, kind } = input;
  const ownFns = [...viewer.functions, ...viewer.sub_functions];
  const functionKey =
    scope === "lc" ? null : clean(input.functionKey, 20) || ownFns[0] || null;
  if (scope !== "lc" && !functionKey) return { error: fail("Pick the function.") };
  if (
    scope !== "lc" &&
    functionKey &&
    !ownFns.includes(functionKey) &&
    !(viewer.isAdmin || viewer.role === "LCP")
  )
    return { error: fail("You can only book for your own function.", "forbidden") };

  // TEAM BINDING — a team name is free text in the DB and the audience is
  // resolved from it, so an unchecked name would let a Team Leader book for,
  // announce to and mark ABSENT a team they have no authority over.
  let teamName: string | null = null;
  let invitedTeams: string[] = [];
  if (scope === "team") {
    // the registry of teams in the function the viewer just proved they own
    // the viewer's OWN team is the registered one in their cell, not the
    // whole comma-list of every team they belong to (v33.5)
    const mine = await ownTeamName(viewer);
    const known = new Set([
      ...(mine ? [mine] : []), // registry may lag members.team_name
      ...teamsOf(viewer.team_name),
      ...(await invitableTeams(functionKey!, null)),
    ]);
    // v29.3: a VP/Director can no longer reach this branch at all (they book
    // FUNCTION points) — only the LCP/admin still pick any team in the registry
    const picksAnyTeam = viewer.isAdmin || viewer.role === "LCP";
    const picked = clean(input.teamName, 60) || mine || "";
    // a Team Leader / Coordinator owns exactly one team — never someone else's
    teamName = picksAnyTeam
      ? known.has(picked)
        ? picked
        : null
      : // a TL/Coordinator books exactly one team: their own. The label is
        // whatever `ownTeamName` resolved; membership comes from who reports
        // to them, so a name they typed can never widen the audience.
        mine;
    if (!teamName)
      return { error: fail(
        picksAnyTeam
          ? "Pick one of your function's teams."
          : "You can only book for your own team.",
        "forbidden"
      ) };
    invitedTeams = [...new Set((input.invitedTeams ?? []).map((t) => clean(t, 60)))]
      .filter((t) => t && t !== teamName && known.has(t))
      .slice(0, 10);
  }
  // TM / F&L / CXP have no working floor — no working hours for or with them
  if (kind === "working_hours" && functionKey && NO_WORKING_HOURS_FUNCTIONS.includes(functionKey))
    return { error: fail(`${functionKey} doesn't run working hours.`) };
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
  return { functionKey, teamName, invitedTeams, invitedFunctions };
}

/** WHO WOULD THIS INVITE? (v33.34) — the dialog asks before booking, so the
 *  booker can untick the three people who aren't in the function yet, or the
 *  two who already said they can't make it, instead of marking them absent
 *  from something nobody expected them at.
 *
 *  Runs the same authority checks as the create path (via
 *  `resolveTouchPointTargets`), so this can never be used to read a roster
 *  the caller couldn't book for. */
export async function previewTouchPointAudience(input: {
  scope: TouchPointScope;
  kind: TouchPointKind;
  functionKey?: string | null;
  teamName?: string | null;
  invitedTeams?: string[];
  invitedFunctions?: string[];
}): Promise<
  Result<{ people: { id: string; name: string; role: string; team: string | null }[] }>
> {
  const viewer = await getViewer();
  if (!TOUCH_POINT_SCOPES.includes(input.scope) || !TOUCH_POINT_KINDS.includes(input.kind))
    return fail("Pick a valid touch-point type.");
  if (!canBookTouchPoint(viewer, input.scope))
    return fail(scopeRefusal(viewer), "forbidden");
  const targets = await resolveTouchPointTargets(viewer, input);
  if ("error" in targets) return targets.error;
  const people = await derivedTouchPointAudience({
    scope: input.scope,
    kind: input.kind,
    function_key: targets.functionKey,
    team_name: targets.teamName,
    invited_teams: targets.invitedTeams,
    invited_functions: targets.invitedFunctions,
    owner_id: viewer.id,
    owner_name: viewer.name,
    starts_at: new Date().toISOString(),
    id: "", note: null, status: "scheduled", cancel_reason: null,
    attendance_recorded_at: null, members: null,
  });
  return {
    ok: true,
    data: {
      people: people.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        team: m.team_name,
      })),
    },
  };
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

  const targets = await resolveTouchPointTargets(viewer, input);
  if ("error" in targets) return targets.error;
  const { functionKey, teamName, invitedTeams, invitedFunctions } = targets;

  // NO WORKING HOURS ON TOP OF THE LC'S (v33.6). An LC working-hours session
  // already has everyone in it; a team session at the same moment doesn't add
  // a session, it splits one — the members owe attendance twice and whoever
  // records it has to guess which one they were in. Meetings and outings are
  // free to overlap: a team meeting during LC working hours is a normal thing
  // to do.
  if (kind === "working_hours" && scope === "team") {
    const from = new Date(startsAt.getTime() - WORK_SESSION_HOURS * 3600_000).toISOString();
    const to = new Date(startsAt.getTime() + WORK_SESSION_HOURS * 3600_000).toISOString();
    const { data: lcSessions } = await db()
      .from("touch_points")
      .select("starts_at")
      .eq("scope", "lc")
      .eq("kind", "working_hours")
      .neq("status", "cancelled")
      .gte("starts_at", from)
      .lte("starts_at", to);
    const clash = ((lcSessions ?? []) as { starts_at: string }[]).find((l) => {
      const lcStart = new Date(l.starts_at).getTime();
      const lcEnd = lcStart + WORK_SESSION_HOURS * 3600_000;
      const mineEnd = startsAt.getTime() + WORK_SESSION_HOURS * 3600_000;
      return startsAt.getTime() < lcEnd && lcStart < mineEnd;
    });
    if (clash)
      return fail(
        `The LC already runs working hours then (${cairoWhen(clash.starts_at)}) — your team is in that one. Pick another time, or book a team MEETING if you need your own slot.`
      );
  }

  // ---- WHO IS COMING (v33.34)
  //
  // The audience is derived from everything decided above; the booker may
  // have unticked some of it. Validate against the DERIVED list — a booker
  // narrows their own audience, never reaches outside it — and store nothing
  // when they kept everyone, so the point keeps picking up people who join
  // the function later (which is the right default and the old behaviour).
  let memberIds: string[] | null = null;
  if (Array.isArray(input.memberIds)) {
    const derived = await derivedTouchPointAudience({
      scope, kind,
      function_key: functionKey,
      team_name: teamName,
      invited_teams: invitedTeams,
      invited_functions: invitedFunctions,
      owner_id: viewer.id,
      owner_name: viewer.name,
      starts_at: startsAt.toISOString(),
      id: "", note: null, status: "scheduled", cancel_reason: null,
      attendance_recorded_at: null, members: null,
    });
    const allowed = new Set(derived.map((m) => m.id));
    const picked = [...new Set(input.memberIds)].filter((id) => allowed.has(id));
    if (picked.length === 0)
      return fail("Pick at least one person — a touch point with nobody in it isn't one.");
    // everyone kept = leave it derived, so the audience stays alive
    memberIds = picked.length === allowed.size ? null : picked;
  }

  const { data: created, error } = await db()
    .from("touch_points")
    .insert({
      scope,
      kind,
      function_key: functionKey,
      team_name: teamName,
      members: memberIds,
      starts_at: startsAt.toISOString(),
      note: clean(input.note, 500) || null,
      // a virtual touch point's "where" is its Meet link — never a room
      location: input.virtual ? null : clean(input.location, 160) || null,
      invited_teams: invitedTeams,
      invited_functions: invitedFunctions,
      owner_id: viewer.id,
      owner_name: viewer.name,
      // remembered on the row (0033) so a later move/cancel can't mail people
      // who were never told this touch point existed
      announced,
      virtual: !!input.virtual,
      routine_id: input.routineId ?? null,
    })
    .select("*")
    .single<TouchPointRow>();
  if (error || !created) return fail(error?.message ?? "Could not book it — try again.");

  // A VIRTUAL touch point IS a calendar event: the audience is invited, Google
  // sends the invite and collects Yes/No on it, and that RSVP becomes the
  // provisional attendance (v32.9). Best-effort — a dead Google grant must
  // never lose the touch point itself.
  if (input.virtual && announced) {
    const { createTouchPointEvent } = await import("@/lib/google/calendar");
    const audience = await touchPointAudience(created);
    const { data: owner } = await db()
      .from("members")
      .select("google_refresh_token")
      .eq("id", viewer.id)
      .maybeSingle<{ google_refresh_token: string | null }>();
    const event = await createTouchPointEvent(owner?.google_refresh_token ?? null, {
      title: `${audienceLabel(created)} — ${kind.replace("_", " ")}`,
      start: startsAt,
      minutes: 60,
      description: clean(input.note, 500) || null,
      attendeeEmails: audience.map((m) => m.email).filter((e): e is string => !!e),
    });
    if (event) {
      await db()
        .from("touch_points")
        .update({ calendar_event_id: event.id, meet_link: event.meetLink })
        .eq("id", created.id);
    }
  }

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

/** The guest list AS IT STANDS — the derived pool plus who is currently on
 *  it, so the manage dialog can edit it without the calendar page carrying an
 *  audience for every touch point in the month (v33.35). */
export async function touchPointGuestList(id: string): Promise<
  Result<{
    people: { id: string; name: string; role: string; team: string | null }[];
    excluded: string[];
    locked: boolean;
  }>
> {
  const viewer = await getViewer();
  const tp = await getTouchPoint(id);
  if (!tp) return fail("That touch point no longer exists.");
  if (!canEditTouchPoint(viewer, tp))
    return fail("Only its owner, the function's VP/Director or TM can change it.", "forbidden");
  const derived = await derivedTouchPointAudience({ ...tp, members: null });
  const picked = Array.isArray(tp.members) && tp.members.length > 0 ? tp.members : null;
  return {
    ok: true,
    data: {
      people: derived.map((m) => ({
        id: m.id, name: m.name, role: m.role, team: m.team_name,
      })),
      excluded: picked ? derived.filter((m) => !picked.includes(m.id)).map((m) => m.id) : [],
      // once attendance is signed off, the register is history
      locked: !!tp.attendance_recorded_at,
    },
  };
}

/** WHO IS COMING, AFTER THE FACT (v33.35).
 *
 *  "Set at booking and never again" was the wrong default: people join, people
 *  drop out, and the whole point of an explicit list is that it matches
 *  reality. Same authority rule as booking — a subset of the DERIVED audience,
 *  never a name from outside it — and `null` puts the point back on the
 *  derived audience, which is the honest way to say "everyone again".
 *
 *  Deliberately quiet: this does NOT re-announce. Someone tidying a guest list
 *  the morning of a meeting should not mail twenty people about it; the
 *  attendance sheet is what changes, and whoever was added sees it on their
 *  calendar. Removing yourself from a session you booked is allowed. */
export async function updateTouchPointMembers(
  id: string,
  memberIds: string[] | null
): Promise<Result> {
  const viewer = await getViewer();
  const tp = await getTouchPoint(id);
  if (!tp) return fail("That touch point no longer exists.");
  if (!canEditTouchPoint(viewer, tp))
    return fail("Only its owner, the function's VP/Director or TM can change it.", "forbidden");
  if (tp.status !== "scheduled") return fail("This touch point is cancelled.");
  if (tp.attendance_recorded_at)
    return fail(
      "Attendance is already recorded for this one — changing who was invited now would rewrite a register somebody signed off."
    );

  let next: string[] | null = null;
  if (Array.isArray(memberIds)) {
    const derived = await derivedTouchPointAudience({ ...tp, members: null });
    const allowed = new Set(derived.map((m) => m.id));
    const picked = [...new Set(memberIds)].filter((m) => allowed.has(m));
    if (picked.length === 0)
      return fail("Pick at least one person — a touch point with nobody in it isn't one.");
    next = picked.length === allowed.size ? null : picked;
  }

  await snapshotForUndo("touch_points", id);
  const { error } = await db().from("touch_points").update({ members: next }).eq("id", id);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "touch_point_members", "touch_point", id, {
    count: next?.length ?? null,
  });
  refresh();
  return { ok: true };
}

export async function updateTouchPoint(
  id: string,
  patch: { date?: string; time?: string; note?: string | null; location?: string | null }
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
  if (patch.location !== undefined) next.location = clean(patch.location, 160) || null;
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

// RSVP attendance (v32.9): syncTouchPointRsvps / syncDueRsvps moved to
// ./touch-point-rsvp.ts (v37.7) — a "use server" file turns every export into a
// public endpoint, and these two take no viewer. No behaviour change.

// ==================================================== timelines (v32.9)

export interface RoutineInput {
  id?: string | null;
  scope: TouchPointScope;
  kind: TouchPointKind;
  functionKey?: string | null;
  teamName?: string | null;
  /** 0 = Sunday … 6 = Saturday, Cairo */
  weekday: number;
  /** Cairo wall-clock "HH:MM" */
  time: string;
  virtual?: boolean;
  note?: string | null;
  startsOn: string;
  endsOn: string;
  invitedTeams?: string[];
  invitedFunctions?: string[];
}

/** A TIMELINE: the fixed routine a Team Leader / VP / TM VP keeps across the
 *  peak — "team meeting every Tuesday 19:00", "working hours every Saturday".
 *
 *  Saving one GENERATES every occurrence up front, so the whole peak is on the
 *  calendar from day one and any single date can be moved when something
 *  happens (exams, a clash) without disturbing the rest. A point that has been
 *  moved or cancelled by hand is flagged and left alone if the routine is
 *  later regenerated — the exception a human made always survives.
 *
 *  Every occurrence goes through `createTouchPoint`, so the booking matrix,
 *  the team binding and the announcements behave exactly as they do for a
 *  hand-booked point. Nothing here is a permission shortcut. */
export async function saveRoutine(
  input: RoutineInput
): Promise<Result<{ id: string; created: number; skipped: number }>> {
  const viewer = await getViewer();
  const scope = input.scope;
  const kind = input.kind;
  if (!TOUCH_POINT_SCOPES.includes(scope) || !TOUCH_POINT_KINDS.includes(kind))
    return fail("Pick a valid touch-point type.");
  // the SAME booking gate as a hand-booked point — a timeline is not a way
  // around the one-scope-per-role rule
  if (!canBookTouchPoint(viewer, scope))
    return fail(scopeRefusal(viewer), "forbidden");
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)
    return fail("Pick the day of the week.");
  if (!/^\d{2}:\d{2}$/.test(input.time)) return fail("Pick the time.");
  const startsOn = String(input.startsOn ?? "").slice(0, 10);
  const endsOn = String(input.endsOn ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn))
    return fail("Pick the period the routine runs for.");
  if (endsOn < startsOn) return fail("The end date is before the start date.");
  // a routine spanning years would generate thousands of points
  const days = (Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000;
  if (days > 400) return fail("A timeline covers at most about a year.");

  const row = {
    owner_id: viewer.id,
    owner_name: viewer.name,
    scope,
    kind,
    function_key: input.functionKey ?? null,
    team_name: input.teamName ?? null,
    weekday: input.weekday,
    at_time: input.time,
    virtual: !!input.virtual,
    note: (input.note ?? "").trim().slice(0, 500) || null,
    starts_on: startsOn,
    ends_on: endsOn,
    invited_teams: input.invitedTeams ?? [],
    invited_functions: input.invitedFunctions ?? [],
    updated_at: new Date().toISOString(),
  };

  let routineId = input.id ?? null;
  if (routineId) {
    // (v37.7) the update is scoped to the owner, but a 0-row match is not an
    // error — without this check someone else's routine id fell through to
    // the delete below and wiped that owner's future occurrences
    const { data: updatedRows, error } = await db()
      .from("touch_point_routines")
      .update(row)
      .eq("id", routineId)
      .eq("owner_id", viewer.id)
      .select("id");
    if (error) return fail(error.message);
    if (!updatedRows || updatedRows.length === 0)
      return fail("Timeline not found.", "forbidden");
    // drop the FUTURE occurrences this routine made and that nobody has
    // touched — the past stays as history, hand-moved dates stay as decided
    await db()
      .from("touch_points")
      .delete()
      .eq("routine_id", routineId)
      .eq("moved_from_routine", false)
      .gte("starts_at", new Date().toISOString());
  } else {
    const { data, error } = await db()
      .from("touch_point_routines")
      .insert(row)
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return fail(error?.message ?? "Could not save the timeline.");
    routineId = data.id;
  }

  // generate every occurrence up front
  let created = 0;
  let skipped = 0;
  const today = cairoToday();
  for (const date of weeklyDates(startsOn, endsOn, input.weekday)) {
    if (date < today) continue; // never book the past
    const res = await createTouchPoint({
      scope,
      kind,
      functionKey: input.functionKey,
      teamName: input.teamName,
      date,
      time: input.time,
      note: input.note,
      invitedTeams: input.invitedTeams,
      invitedFunctions: input.invitedFunctions,
      virtual: input.virtual,
      routineId,
      // one invite per occurrence would be spam — a timeline is announced
      // once, by its own summary, not 20 times
      notify: false,
    });
    if (res.ok) created += 1;
    else skipped += 1;
  }
  return { ok: true, data: { id: routineId!, created, skipped } };
}

/** Every Cairo date on `weekday` between two dates, inclusive. */
function weeklyDates(from: string, to: string, weekday: number): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  // walk to the first matching weekday
  while (cur.getUTCDay() !== weekday && cur <= end) cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
}

/** The timelines this viewer owns. */
export async function listRoutines(): Promise<
  (RoutineInput & { id: string; owner_name: string; occurrences: number })[]
> {
  const viewer = await getViewer();
  const { data } = await db()
    .from("touch_point_routines")
    .select("*")
    .eq("owner_id", viewer.id)
    .order("created_at", { ascending: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  const out = [];
  for (const r of rows) {
    const { count } = await db()
      .from("touch_points")
      .select("id", { count: "exact", head: true })
      .eq("routine_id", r.id);
    out.push({
      id: r.id,
      owner_name: r.owner_name,
      scope: r.scope,
      kind: r.kind,
      functionKey: r.function_key,
      teamName: r.team_name,
      weekday: r.weekday,
      time: r.at_time,
      virtual: r.virtual,
      note: r.note,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      invitedTeams: r.invited_teams ?? [],
      invitedFunctions: r.invited_functions ?? [],
      occurrences: count ?? 0,
    });
  }
  return out;
}

/** Deletes a timeline and its FUTURE untouched occurrences. */
export async function deleteRoutine(id: string): Promise<Result> {
  const viewer = await getViewer();
  const { data: r } = await db()
    .from("touch_point_routines")
    .select("owner_id")
    .eq("id", id)
    .maybeSingle<{ owner_id: string | null }>();
  if (!r) return fail("Timeline not found.");
  if (r.owner_id !== viewer.id && !viewer.isAdmin && viewer.role !== "LCP")
    return fail("Only the person who set this timeline can remove it.", "forbidden");
  await db()
    .from("touch_points")
    .delete()
    .eq("routine_id", id)
    .eq("moved_from_routine", false)
    .gte("starts_at", new Date().toISOString());
  const { error } = await db().from("touch_point_routines").delete().eq("id", id);
  if (error) return fail(error.message);
  return { ok: true };
}
