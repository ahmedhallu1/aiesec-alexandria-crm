"use server";

import { db } from "@/lib/supabase";
import { getViewer } from "@/server/data";
import { canUseAdminTools } from "@/lib/rbac";
import { cairoToday } from "@/lib/types";
import { defaultResponseLabel } from "@/lib/im-prompt";

/** ── PROMPTS THAT ASK FOR SOMETHING BACK (v34.7) ────────────────────────────
 *
 *  `pending_prompts` (0031) already delivers "you must see this on your next
 *  app open" and has a per-day escape. Both new prompts ride it rather than
 *  inventing a second mechanism:
 *
 *   · `im_prompt`          — the IM director's own message, optionally
 *                            capturing a rating, a sentence, or just "got it"
 *   · `touchpoint_rating`  — rate an LC touch point, 7h after it ran
 *
 *  THE SKIP LADDER IS `pending_prompts.reminders`, which already exists:
 *  skip once and it says why the rating matters and comes back TOMORROW;
 *  skip a second time and it resolves for good. No new column, no new table. */

export type PromptOutcome = { ok: true } | { ok: false; error: string };

const fail = (error: string): PromptOutcome => ({ ok: false, error });

/** Skip the prompt in front of me.
 *
 *  First skip → we say the feedback matters and it returns tomorrow.
 *  Second skip → resolved, and they are never asked about this one again.
 *  Returns whether it will come back, so the dialog can say so honestly. */
export async function skipPrompt(
  promptId: string
): Promise<{ ok: true; comingBack: boolean } | { ok: false; error: string }> {
  const viewer = await getViewer();
  const { data: row } = await db()
    .from("pending_prompts")
    .select("id, member_id, kind, ref_id, reminders")
    .eq("id", promptId)
    .maybeSingle<{ id: string; member_id: string; kind: string; ref_id: string | null; reminders: number }>();
  if (!row) return { ok: false, error: "That prompt is already gone." };
  if (row.member_id !== viewer.id) return { ok: false, error: "That prompt isn't yours." };

  // an ATTENDANCE prompt is a must-do and has always been unskippable — it
  // resolves when the record lands, not when someone waves it away
  if (row.kind === "attendance") return { ok: false, error: "This one needs recording first." };

  const skips = (row.reminders ?? 0) + 1;
  const done = skips >= 2;
  await db()
    .from("pending_prompts")
    .update({ reminders: skips, last_reminded_on: cairoToday(), resolved: done })
    .eq("id", promptId);

  // a skipped IM prompt is still an answer — the director should see who
  // never engaged, not a silent gap
  if (done && row.kind === "im_prompt" && row.ref_id) {
    await db()
      .from("im_prompt_responses")
      .upsert(
        { prompt_id: row.ref_id, member_id: viewer.id, skipped: true },
        { onConflict: "prompt_id,member_id", ignoreDuplicates: true }
      );
  }
  return { ok: true, comingBack: !done };
}

/** Answer the IM director's prompt: a rating, a sentence, or just "got it". */
export async function answerImPrompt(
  promptId: string,
  answer: { rating?: number | null; text?: string | null }
): Promise<PromptOutcome> {
  const viewer = await getViewer();
  const { data: row } = await db()
    .from("pending_prompts")
    .select("id, member_id, kind, ref_id")
    .eq("id", promptId)
    .maybeSingle<{ id: string; member_id: string; kind: string; ref_id: string | null }>();
  if (!row || row.kind !== "im_prompt" || !row.ref_id) return fail("That prompt is already gone.");
  if (row.member_id !== viewer.id) return fail("That prompt isn't yours.");

  const { data: prompt } = await db()
    .from("im_prompts")
    .select("id, response_kind")
    .eq("id", row.ref_id)
    .maybeSingle<{ id: string; response_kind: string }>();
  if (!prompt) return fail("That prompt is already gone.");

  const rating =
    prompt.response_kind === "rating" ? Math.round(Number(answer.rating ?? 0)) : null;
  if (prompt.response_kind === "rating" && !(rating && rating >= 1 && rating <= 5))
    return fail("Pick a rating first.");
  const text = prompt.response_kind === "text" ? (answer.text ?? "").trim().slice(0, 2000) : null;
  if (prompt.response_kind === "text" && !text) return fail("Write something first.");

  const { error } = await db().from("im_prompt_responses").upsert(
    {
      prompt_id: prompt.id,
      member_id: viewer.id,
      rating,
      text_answer: text,
      acknowledged: true,
      skipped: false,
    },
    { onConflict: "prompt_id,member_id" }
  );
  if (error) return fail(error.message);

  await db().from("pending_prompts").update({ resolved: true }).eq("id", promptId);
  return { ok: true };
}

/** Rate an LC touch point straight from the prompt. Writes the SAME
 *  `lc_feedback` row the Feedback page writes — one rating, one place. */
export async function rateTouchPointFromPrompt(
  promptId: string,
  rating: number,
  note?: string | null
): Promise<PromptOutcome> {
  const viewer = await getViewer();
  const { data: row } = await db()
    .from("pending_prompts")
    .select("id, member_id, kind, ref_id")
    .eq("id", promptId)
    .maybeSingle<{ id: string; member_id: string; kind: string; ref_id: string | null }>();
  if (!row || row.kind !== "touchpoint_rating" || !row.ref_id)
    return fail("That prompt is already gone.");
  if (row.member_id !== viewer.id) return fail("That prompt isn't yours.");

  const stars = Math.round(Number(rating));
  if (!(stars >= 1 && stars <= 5)) return fail("Pick a rating first.");

  const { error } = await db().from("lc_feedback").insert({
    author_id: viewer.id,
    // a session is RATED, never praised or reported (v33.33) — `positive` is
    // NOT NULL for every existing reader, so it is derived from the stars
    positive: stars >= 4,
    rating: stars,
    // `message` and `about` are NOT NULL on this table — the stars ARE the
    // review (v33.33), so a rating with no note stores an empty string and an
    // empty audience, not a null that the insert would reject
    message: (note ?? "").trim().slice(0, 2000),
    about: [],
    touch_point_id: row.ref_id,
    anonymous: false,
    status: "new",
  });
  if (error) return fail(error.message);

  await db().from("pending_prompts").update({ resolved: true }).eq("id", promptId);
  return { ok: true };
}

/** Compose a prompt for the LC. IM director / admin tools only. */
export async function createImPrompt(input: {
  title: string;
  /** optional since v34.8 — the title is often the whole message */
  body?: string;
  responseKind: "none" | "acknowledge" | "rating" | "text";
  responseLabel?: string | null;
  audience: "all" | "function" | "role" | "picked";
  audienceValues: string[];
  dismissible: boolean;
}): Promise<{ ok: true; sentTo: number } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!canUseAdminTools(viewer)) return { ok: false, error: "Admin tools only." };
  const title = input.title.trim();
  // ONE MANDATORY FIELD (v34.8). It used to be three — a title, a body, AND a
  // question above the rating control — for what is often a single sentence
  // ("Peak review is on Sunday", "How ready do you feel?"). Three boxes to
  // fill for one sentence is how a feature stops being used. The title is the
  // sentence; everything under it is optional and falls back to something
  // sensible rather than being demanded.
  const body = (input.body ?? "").trim();
  if (title.length < 2) return { ok: false, error: "Give it a title." };
  if (input.audience !== "all" && input.audienceValues.length === 0)
    return { ok: false, error: "Pick who it goes to." };

  const { data: prompt, error } = await db()
    .from("im_prompts")
    .insert({
      created_by: viewer.id,
      title,
      body: body || null,
      response_kind: input.responseKind,
      // no question typed → the control asks the obvious one for its kind, so
      // the prompt never renders a bare box with nothing above it
      response_label:
        (input.responseLabel ?? "").trim() || defaultResponseLabel(input.responseKind),
      audience: input.audience,
      audience_values: input.audienceValues,
      dismissible: input.dismissible,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // WHO SEES IT — resolved ONCE, now, and fanned out as pending_prompts rows.
  // Computing the audience on every app open would mean re-deriving it for
  // every member on every page; 80 rows written once is the cheaper shape,
  // and it also freezes the audience so a function change tomorrow does not
  // silently add or drop someone mid-flight.
  const { data: members } = await db()
    .from("members")
    .select("id, role, functions, sub_functions")
    .eq("is_active", true);
  const all = (members ?? []) as {
    id: string; role: string; functions: string[] | null; sub_functions: string[] | null;
  }[];
  const wanted = new Set(input.audienceValues);
  const targets = all.filter((m) => {
    if (input.audience === "all") return true;
    if (input.audience === "picked") return wanted.has(m.id);
    if (input.audience === "role") return wanted.has(m.role);
    return [...(m.functions ?? []), ...(m.sub_functions ?? [])].some((f) => wanted.has(f));
  });
  if (targets.length === 0) return { ok: false, error: "That reaches nobody — check the audience." };

  const { error: fanError } = await db().from("pending_prompts").insert(
    targets.map((m) => ({
      member_id: m.id,
      kind: "im_prompt",
      ref_id: prompt.id,
      title,
      body: body || null,
      link: null,
    }))
  );
  if (fanError) return { ok: false, error: fanError.message };
  return { ok: true, sentTo: targets.length };
}
