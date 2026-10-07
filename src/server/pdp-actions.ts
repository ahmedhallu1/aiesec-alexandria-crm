"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { canFilePdpFor, canReadPdp, isMm } from "@/lib/rbac";
import { PDP_TRACKS, type PdpTrack } from "@/lib/types";
import { pdpWeeks } from "@/lib/pdp";
import { getViewer } from "./data";
import { logAudit, diffFields } from "./audit";
import { notifyMembers } from "./notify";
import { recordUndo, sandboxSuppressed, snapshotForUndo } from "./sandbox";
import {
  activePdpCycle, getPdp, pdpNumbersFor, resolvePdpFilingTargets, resolvePdpPrompts,
  type PdpNumbers,
} from "./pdp";

/** THE O2O / PDP MUTATIONS (v36).
 *
 *  The TM process this replaces ran on Google Sheets: each VP or Director
 *  copied a workbook per MM, with an **O2O** tab (short questions, short
 *  answers) and a **PDP** tab (a personal soft-skill goal, a professional goal
 *  for the month, and last month's numbers with a funnel gap) — then every MM
 *  did the same for their own members. Four sheets per leader, no history, no
 *  way to see who had actually filed, and last month's numbers copied across
 *  by hand from a dashboard that already knew them.
 *
 *  ⚠️ EVERY AUTHORITY DECISION IS MADE BY THE SAME RESOLVER THE PICKER USES
 *  (`resolvePdpFilingTargets`), never by re-deriving it here. That is the
 *  `resolveTouchPointTargets` rule from v29.2, and it exists because a preview
 *  that can offer somebody the save will refuse is how a "critical" RBAC hole
 *  gets shipped feeling tested. */

type Result = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

const clean = (v: unknown, max: number): string | null => {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, max) : null;
};

export interface PdpInput {
  memberId: string;
  /** answers keyed by question id */
  o2o: Record<string, string>;
  personalSkill: string | null;
  personalGoal: string | null;
  professionalMetric: string | null;
  professionalTarget: number | null;
  professionalGoal: string | null;
  gapStep: string | null;
  gapNote: string | null;
  /** track → week (1-4) → the action step, "" for none */
  steps: Record<string, Record<string, string>>;
  /** false leaves it a draft — a half-written PDP is not a filed one */
  file: boolean;
}

/** Create or update the PDP a leader is filing FOR one of their people. */
export async function savePdp(input: PdpInput): Promise<Result> {
  const viewer = await getViewer();
  const cycle = await activePdpCycle();
  if (!cycle) return fail("There is no open PDP round right now.");
  if (!input.memberId) return fail("Pick who this is for.");

  // ⚠️ THE PICKER AND THE SAVE ASK THE SAME QUESTION, of the same function.
  const targets = await resolvePdpFilingTargets(viewer, cycle.id);
  const target =
    targets.mms.find((t) => t.id === input.memberId) ??
    targets.others.find((t) => t.id === input.memberId);
  if (!target)
    return fail("That isn't one of your people — a PDP is filed by the person who reviews you.");
  // Belt and braces: the pure predicate, on the same pair. The resolver above
  // is the authority; this catches a resolver that ever grows a hole, and it
  // is cheap.
  const { data: targetRow } = await db()
    .from("members")
    .select("id, stakeholder_id")
    .eq("id", input.memberId)
    .maybeSingle<{ id: string; stakeholder_id: string | null }>();
  if (!targetRow || !canFilePdpFor(viewer, targetRow as never))
    return fail("You can't file a PDP for them.");

  const { data: existing } = await db()
    .from("pdps")
    .select("*")
    .eq("cycle_id", cycle.id)
    .eq("member_id", input.memberId)
    .maybeSingle();

  // ⚠️ LAST MONTH'S NUMBERS ARE FROZEN INTO THE ROW, and read from the REAL
  // reader rather than a second copy of the funnel. A PDP is a conversation
  // about a specific month; if the numbers moved every time somebody opened
  // it, the gap it names would stop matching the steps agreed against it.
  // Only stamped once — a later edit keeps the numbers the conversation
  // actually happened over.
  const lastMonth =
    (existing?.last_month as unknown) ?? (await pdpNumbersFor(viewer, input.memberId, cycle.period_start));

  const patch = {
    cycle_id: cycle.id,
    member_id: input.memberId,
    author_id: viewer.id,
    status: input.file ? "filed" : "draft",
    filed_at: input.file ? new Date().toISOString() : null,
    o2o: input.o2o ?? {},
    personal_skill: clean(input.personalSkill, 160),
    personal_goal: clean(input.personalGoal, 2000),
    professional_metric: clean(input.professionalMetric, 60),
    professional_target:
      Number.isFinite(input.professionalTarget) && (input.professionalTarget ?? 0) >= 0
        ? Math.min(100000, Math.round(input.professionalTarget as number))
        : null,
    professional_goal: clean(input.professionalGoal, 2000),
    gap_step: clean(input.gapStep, 40),
    gap_note: clean(input.gapNote, 2000),
    last_month: lastMonth,
    updated_at: new Date().toISOString(),
  };

  let pdpId = existing?.id as string | undefined;
  if (existing) {
    await snapshotForUndo("pdps", existing.id);
    const { error } = await db().from("pdps").update(patch).eq("id", existing.id);
    if (error) return fail(error.message);
  } else {
    const { data: made, error } = await db()
      .from("pdps")
      .insert(patch)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) return fail(error.message);
    pdpId = made?.id;
    if (pdpId) await recordUndo("pdps", pdpId, "insert");
  }
  if (!pdpId) return fail("Couldn't save that — try again.");

  // ---- the weekly action steps ------------------------------------------
  //
  // Replaced wholesale rather than diffed: a PDP has at most 12 of them
  // (3 tracks × 4 weeks) and they are edited as one form. ⚠️ But the DONE
  // ticks are carried over first — they belong to the MEMBER, and a leader
  // tidying the wording of week 3 must not silently un-tick the two weeks
  // that person has already finished.
  const { data: oldSteps } = await db()
    .from("pdp_steps")
    .select("track, week, body, done, done_at, done_by")
    .eq("pdp_id", pdpId);
  const doneBefore = new Map(
    ((oldSteps ?? []) as { track: string; week: number; done: boolean; done_at: string | null; done_by: string | null }[])
      .filter((s) => s.done)
      .map((s) => [`${s.track}:${s.week}`, s])
  );

  const rows: Record<string, unknown>[] = [];
  for (const track of PDP_TRACKS.map((t) => t.value as PdpTrack)) {
    for (let week = 1; week <= 4; week++) {
      const body = clean(input.steps?.[track]?.[String(week)], 400);
      if (!body) continue;
      const prior = doneBefore.get(`${track}:${week}`);
      rows.push({
        pdp_id: pdpId,
        track,
        week,
        body,
        done: !!prior,
        done_at: prior?.done_at ?? null,
        done_by: prior?.done_by ?? null,
      });
    }
  }
  await db().from("pdp_steps").delete().eq("pdp_id", pdpId);
  if (rows.length > 0) {
    const { error } = await db().from("pdp_steps").insert(rows);
    if (error) return fail(error.message);
  }

  // filing it resolves whatever prompt was chasing this person
  if (input.file) await resolvePdpPrompts(input.memberId, cycle.id);

  await logAudit(
    viewer.id,
    existing ? "pdp_update" : "pdp_create",
    "pdp",
    pdpId,
    { member: target.name, status: patch.status, steps: rows.length },
    {
      changed: existing
        ? diffFields(existing as Record<string, unknown>, patch, [
            "status", "personal_skill", "professional_metric",
            "professional_target", "gap_step",
          ])
        : undefined,
      summary: `${input.file ? "Filed" : "Saved a draft of"} ${target.name}'s PDP`,
    }
  );

  // ⚠️ TOLD ONCE, WHEN IT IS ACTUALLY THEIRS TO READ. A draft is the leader's
  // working copy — belling somebody about a half-written plan invites them to
  // read a paragraph that has not been thought through yet.
  if (input.file && !(await sandboxSuppressed("pdp filed")))
    await notifyMembers(
      [input.memberId],
      "pdp",
      "📋 Your PDP for this month is ready",
      `${viewer.name} filed your development plan${
        input.personalSkill ? ` — the skill is ${input.personalSkill}` : ""
      }. Open it to see the weekly steps and tick them off as you go.`,
      "/pdp",
      null,
      "pdp"
    );

  revalidatePath("/pdp");
  return { ok: true, id: pdpId };
}

/** The MEMBER ticks off one of their own weekly steps.
 *
 *  ⚠️ Deliberately the ONE thing the person a PDP is about may change on it.
 *  The plan is a conversation their leader owns; the doing is theirs, and a
 *  plan you cannot mark progress on is a document, not a plan. Their leader
 *  (and the leader above) may also tick — a step is often confirmed in the
 *  next one-on-one rather than by the person alone. */
export async function togglePdpStep(stepId: string, done: boolean): Promise<Result> {
  const viewer = await getViewer();
  const { data: step } = await db()
    .from("pdp_steps")
    .select("id, pdp_id, track, week, done")
    .eq("id", stepId)
    .maybeSingle<{ id: string; pdp_id: string; track: string; week: number; done: boolean }>();
  if (!step) return fail("That step no longer exists.");

  const pdp = await getPdp(viewer, step.pdp_id);
  if (!pdp) return fail("You can't see that PDP.");
  const mine = pdp.member_id === viewer.id;
  const { data: subject } = await db()
    .from("members")
    .select("id, stakeholder_id")
    .eq("id", pdp.member_id)
    .maybeSingle<{ id: string; stakeholder_id: string | null }>();
  if (!mine && !(subject && canFilePdpFor(viewer, subject as never)))
    return fail("Only the person the plan is for, or their leader, can tick a step.");

  await snapshotForUndo("pdp_steps", stepId);
  const { error } = await db()
    .from("pdp_steps")
    .update({
      done,
      done_at: done ? new Date().toISOString() : null,
      done_by: done ? viewer.id : null,
    })
    .eq("id", stepId);
  if (error) return fail(error.message);

  await logAudit(viewer.id, "pdp_step", "pdp", step.pdp_id, {
    track: step.track, week: step.week, done,
  }, {
    changed: { done: [step.done, done] },
    summary: `${done ? "Ticked off" : "Un-ticked"} week ${step.week} of ${pdp.member_name}'s ${step.track} goal`,
  });
  revalidatePath("/pdp");
  return { ok: true };
}

/** TM opens the month's round: the window everyone files inside, and the
 *  deadline the nag counts from. */
export async function openPdpCycle(input: {
  periodStart: string;
  deadline: string;
  title?: string | null;
  note?: string | null;
}): Promise<Result> {
  const viewer = await getViewer();
  // `canReadPdp` with no subject answers "does this person RUN the process"
  if (!canReadPdp(viewer, "", "", null, null))
    return fail("Only TM and the LCP open a PDP round.");
  if (!/^\d{4}-\d{2}-01$/.test(input.periodStart))
    return fail("The month must be a first-of-month date.");
  const deadline = new Date(input.deadline);
  if (!Number.isFinite(deadline.getTime())) return fail("That deadline isn't a real date.");

  // ⚠️ ONE OPEN ROUND AT A TIME. Two would mean "your PDP" is ambiguous on
  // every screen, and the nag would chase people for both at once.
  const { data: open } = await db()
    .from("pdp_cycles")
    .select("id, period_start")
    .eq("active", true)
    .maybeSingle<{ id: string; period_start: string }>();
  if (open && open.period_start !== input.periodStart)
    return fail(
      `A round is already open for ${open.period_start.slice(0, 7)} — close that one first.`
    );

  const patch = {
    period_start: input.periodStart,
    deadline: deadline.toISOString(),
    title: clean(input.title, 120),
    note: clean(input.note, 1000),
    created_by: viewer.id,
    active: true,
  };
  const { data: made, error } = await db()
    .from("pdp_cycles")
    .upsert(patch, { onConflict: "period_start" })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return fail(error.message);
  if (made?.id) await recordUndo("pdp_cycles", made.id, "insert");

  await logAudit(viewer.id, "pdp_cycle_open", "pdp_cycle", made?.id ?? null, patch, {
    category: "admin",
    summary: `Opened the ${input.periodStart.slice(0, 7)} PDP round`,
  });
  revalidatePath("/pdp");
  return { ok: true, id: made?.id };
}

/** Close the round. Filed PDPs stay readable — closing stops the nag and stops
 *  new ones being filed against it, it does not delete anybody's plan. */
export async function closePdpCycle(cycleId: string): Promise<Result> {
  const viewer = await getViewer();
  if (!canReadPdp(viewer, "", "", null, null))
    return fail("Only TM and the LCP close a PDP round.");
  await snapshotForUndo("pdp_cycles", cycleId);
  const { error } = await db()
    .from("pdp_cycles")
    .update({ active: false })
    .eq("id", cycleId);
  if (error) return fail(error.message);
  await logAudit(viewer.id, "pdp_cycle_close", "pdp_cycle", cycleId, {}, {
    category: "admin",
    summary: "Closed a PDP round",
  });
  revalidatePath("/pdp");
  return { ok: true };
}

/** TM edits the O2O questions. They are DATA, not hard-coded strings, so the
 *  people who run one-on-ones can change what is asked without a release. */
export async function savePdpQuestions(
  questions: { id?: string; prompt: string; hint?: string | null }[]
): Promise<Result> {
  const viewer = await getViewer();
  if (!canReadPdp(viewer, "", "", null, null))
    return fail("Only TM and the LCP edit the O2O questions.");

  const wanted = questions
    .map((q, i) => ({ ...q, idx: i, prompt: clean(q.prompt, 300) }))
    .filter((q) => q.prompt);
  if (wanted.length === 0) return fail("Keep at least one question.");
  if (wanted.length > 20) return fail("Twenty questions is already a long one-on-one.");

  // ⚠️ EXISTING QUESTIONS ARE DEACTIVATED, NEVER DELETED. Answers are stored
  // against the question's id, so removing the row would orphan every answer
  // anybody has already given — a past PDP would render with the answers but
  // not the questions they answered.
  const { data: current } = await db()
    .from("pdp_questions")
    .select("id")
    .is("cycle_id", null);
  const keep = new Set(wanted.map((q) => q.id).filter(Boolean) as string[]);
  // one statement for every question that left the list (v37.10) — and every
  // write below is CHECKED: a failed one used to be ignored and the page still
  // said "saved", leaving a half-edited question set behind
  const retire = ((current ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !keep.has(id));
  if (retire.length > 0) {
    const { error } = await db().from("pdp_questions").update({ active: false }).in("id", retire);
    if (error) return fail(`Could not retire the removed questions: ${error.message}`);
  }

  for (const q of wanted) {
    const { error } = q.id
      ? await db()
          .from("pdp_questions")
          .update({ prompt: q.prompt, hint: clean(q.hint, 300), idx: q.idx, active: true })
          .eq("id", q.id)
      : await db()
          .from("pdp_questions")
          .insert({ prompt: q.prompt, hint: clean(q.hint, 300), idx: q.idx, active: true });
    if (error) return fail(`Could not save "${(q.prompt ?? "").slice(0, 40)}": ${error.message}`);
  }

  await logAudit(viewer.id, "pdp_questions", "pdp", null, { count: wanted.length }, {
    category: "admin",
    summary: `Edited the O2O questions (${wanted.length})`,
  });
  revalidatePath("/pdp");
  return { ok: true };
}

/** The weeks of the open round, for a client that wants to label the steps
 *  without importing the date maths. */
export async function pdpWeeksForCycle(): Promise<{ ok: boolean; weeks: ReturnType<typeof pdpWeeks> }> {
  const cycle = await activePdpCycle();
  return { ok: !!cycle, weeks: cycle ? pdpWeeks(cycle.period_start) : [] };
}

/** Exported for the nav gate — a Member with nobody under them still has a
 *  PDP of their own to read, so the tab is for everyone the process touches. */
export async function iAmAnMm(): Promise<boolean> {
  const viewer = await getViewer();
  return isMm(viewer);
}

/** Last month's numbers for one of MY people, for the form to show while the
 *  conversation is happening.
 *
 *  ⚠️ Gated by the same resolver as the save. Somebody's funnel is not public
 *  inside the LC, and "let me just look up your numbers" is exactly the shape
 *  of request this endpoint must refuse from anyone who is not their leader. */
export async function pdpNumbersForTarget(memberId: string): Promise<PdpNumbers | null> {
  const viewer = await getViewer();
  const cycle = await activePdpCycle();
  if (!cycle) return null;
  const targets = await resolvePdpFilingTargets(viewer, cycle.id);
  const ok =
    targets.mms.some((t) => t.id === memberId) ||
    targets.others.some((t) => t.id === memberId);
  if (!ok) return null;
  return pdpNumbersFor(viewer, memberId, cycle.period_start);
}
