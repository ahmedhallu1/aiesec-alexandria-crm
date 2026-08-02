"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { canBookTouchPoint, canEditTouchPoint } from "@/lib/rbac";
import {
  NO_WORKING_HOURS_FUNCTIONS,
  TOUCH_POINT_KINDS,
  TOUCH_POINT_SCOPES,
  touchPointLabel,
  type TouchPointKind,
  type TouchPointScope,
} from "@/lib/types";
import { audienceLabel, cairoWhen } from "@/lib/touch-points";
import { getViewer, logAudit } from "./data";
import { recordUndo, sandboxSuppressed, snapshotForUndo } from "./sandbox";
import { notifyMembers } from "./notify";
import { sendEmail } from "@/lib/google/gmail";
import {
  getTouchPoint,
  tmLeadEmails,
  touchPointAudience,
  type TouchPointRow,
} from "./touch-points-read";

/** TM TOUCH POINTS (v29) — the LC's meetings, working hours and outings.
 *  Booking rights come from rbac (`bookableTouchPointScopes`); every create,
 *  move and cancel emails + bells the whole audience with the TM VP on CC. */

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; code?: string };

const fail = (error: string, code?: string): Result<never> => ({ ok: false, error, code });
const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function refresh() {
  revalidatePath("/", "layout");
}

/** One place decides what the audience is told, so a move and a cancel can
 *  never drift apart. */
async function announce(
  tp: TouchPointRow,
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

  await notifyMembers(
    audience.map((m) => m.id),
    "broadcast",
    title,
    body,
    tp.owner_id ?? null,
    "/calendar"
  );

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
  /** ISO instant of the START (there is no end time, by design) */
  startsAt: string;
  note?: string | null;
  invitedTeams?: string[];
  invitedFunctions?: string[];
}

export async function createTouchPoint(
  input: CreateTouchPointInput
): Promise<Result<{ id: string }>> {
  const viewer = await getViewer();
  const scope = input.scope;
  const kind = input.kind;
  if (!TOUCH_POINT_SCOPES.includes(scope) || !TOUCH_POINT_KINDS.includes(kind))
    return fail("Pick a valid touch-point type.");
  if (!canBookTouchPoint(viewer, scope))
    return fail("That touch-point type is above your access.", "forbidden");

  const startsAt = new Date(String(input.startsAt ?? ""));
  if (!input.startsAt || Number.isNaN(startsAt.getTime()))
    return fail("Pick the date and start time.");

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

  const teamName = scope === "team" ? clean(input.teamName, 60) || viewer.team_name : null;
  if (scope === "team" && !teamName) return fail("Pick the team.");

  // TM / F&L / CXP have no working floor — no working hours for or with them
  if (kind === "working_hours" && functionKey && NO_WORKING_HOURS_FUNCTIONS.includes(functionKey))
    return fail(`${functionKey} doesn't run working hours.`);

  const invitedTeams =
    scope === "team" ? [...new Set((input.invitedTeams ?? []).map((t) => clean(t, 60)).filter(Boolean))] : [];
  const invitedFunctions =
    scope === "function"
      ? [
          ...new Set(
            (input.invitedFunctions ?? [])
              .map((f) => clean(f, 20))
              .filter((f) => f && f !== functionKey && !NO_WORKING_HOURS_FUNCTIONS.includes(f))
          ),
        ]
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
    })
    .select("*")
    .single<TouchPointRow>();
  if (error || !created) return fail(error?.message ?? "Could not book it — try again.");

  await recordUndo("touch_points", created.id, "insert");
  await announce(created, "created");
  await logAudit(viewer.id, "touch_point_create", "touch_point", created.id, {
    scope,
    kind,
    fn: functionKey,
  });
  refresh();
  return { ok: true, data: { id: created.id } };
}

export async function updateTouchPoint(
  id: string,
  patch: { startsAt?: string; note?: string | null }
): Promise<Result> {
  const viewer = await getViewer();
  const tp = await getTouchPoint(id);
  if (!tp) return fail("That touch point no longer exists.");
  if (!canEditTouchPoint(viewer, tp))
    return fail("Only its owner, the function's VP/Director or TM can change it.", "forbidden");
  if (tp.status !== "scheduled") return fail("This touch point is cancelled.");

  const next: Record<string, unknown> = {};
  let moved = false;
  const previousWhen = cairoWhen(tp.starts_at);
  if (patch.startsAt) {
    const d = new Date(patch.startsAt);
    if (Number.isNaN(d.getTime())) return fail("That date and time don't look right.");
    if (d.toISOString() !== tp.starts_at) {
      next.starts_at = d.toISOString();
      moved = true;
    }
  }
  if (patch.note !== undefined) next.note = clean(patch.note, 500) || null;
  if (Object.keys(next).length === 0) return { ok: true };

  await snapshotForUndo("touch_points", id);
  const { error } = await db().from("touch_points").update(next).eq("id", id);
  if (error) return fail(error.message);

  // a MOVE is news — the audience hears about it again
  if (moved) {
    const fresh = await getTouchPoint(id);
    if (fresh) await announce(fresh, "moved", { previousWhen });
  }
  await logAudit(viewer.id, "touch_point_update", "touch_point", id, { moved });
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

  await announce({ ...tp, status: "cancelled" }, "cancelled", { reason: why });
  await logAudit(viewer.id, "touch_point_cancel", "touch_point", id, { reason: why });
  refresh();
  return { ok: true };
}
