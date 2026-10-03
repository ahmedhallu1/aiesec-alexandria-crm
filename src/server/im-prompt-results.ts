"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { fetchAll, getRealViewer, logAudit } from "./data";
import { canUseAdminTools } from "@/lib/rbac";

/**
 * WHAT THE LC ANSWERED (v37.3). "Say something to the LC" (v34.7) stored every
 * rating, sentence, acknowledgement and skip in `im_prompt_responses` — and
 * nothing ever read them back. This is the reader: per prompt, who answered
 * what, who waved it away, and who still has it waiting.
 *
 * Admin tools only, read as the REAL viewer — a test view cannot be used to
 * read somebody's answers.
 */

export interface ImPromptResult {
  id: string;
  title: string;
  body: string;
  responseKind: "none" | "acknowledge" | "rating" | "text";
  responseLabel: string | null;
  audience: string;
  audienceValues: string[];
  dismissible: boolean;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
  sent: number;
  answered: number;
  skipped: number;
  waiting: number;
  avgRating: number | null;
  /** index 0 = ★1 … index 4 = ★5 */
  ratingCounts: number[];
  responses: {
    name: string;
    role: string;
    rating: number | null;
    text: string | null;
    acknowledged: boolean;
    skipped: boolean;
    at: string;
  }[];
  waitingPeople: { name: string; role: string }[];
}

export async function loadImPromptResults(): Promise<
  { ok: true; data: ImPromptResult[] } | { ok: false; error: string }
> {
  const viewer = await getRealViewer();
  if (!canUseAdminTools(viewer)) return { ok: false, error: "Admin tools only." };

  const [{ data: prompts, error }, { data: members }] = await Promise.all([
    db()
      .from("im_prompts")
      .select("id, title, body, response_kind, response_label, audience, audience_values, dismissible, active, created_at, created_by")
      .order("created_at", { ascending: false })
      .limit(100),
    db().from("members").select("id, name, role"),
  ]);
  if (error) return { ok: false, error: error.message };

  // (v37.7) answers and "sent" rows only for the prompts being shown, PAGED —
  // the old .limit(10000/20000) reads were capped at 1000 rows by PostgREST,
  // so once an LC-wide prompt or two had been sent the counts went wrong
  const promptIds = (prompts ?? []).map((p) => p.id as string);
  type RespRow = { prompt_id: string; member_id: string; rating: number | null; text_answer: string | null; acknowledged: boolean; skipped: boolean; created_at: string };
  type PendRow = { ref_id: string; member_id: string; resolved: boolean };
  const [responses, pending] = promptIds.length
    ? await Promise.all([
        fetchAll<RespRow>(() =>
          db()
            .from("im_prompt_responses")
            .select("prompt_id, member_id, rating, text_answer, acknowledged, skipped, created_at")
            .in("prompt_id", promptIds)
            .order("id")
        ).catch(() => [] as RespRow[]),
        fetchAll<PendRow>(() =>
          db()
            .from("pending_prompts")
            .select("ref_id, member_id, resolved")
            .eq("kind", "im_prompt")
            .in("ref_id", promptIds)
            .order("id")
        ).catch(() => [] as PendRow[]),
      ])
    : [[] as RespRow[], [] as PendRow[]];

  const who = new Map((members ?? []).map((m) => [m.id as string, { name: m.name as string, role: m.role as string }]));
  const person = (id: string) => who.get(id) ?? { name: "—", role: "" };

  const data: ImPromptResult[] = (prompts ?? []).map((p) => {
    const rs = (responses ?? []).filter((r) => r.prompt_id === p.id);
    const sentRows = (pending ?? []).filter((x) => x.ref_id === p.id);
    const answeredRows = rs.filter((r) => !r.skipped);
    const ratings = answeredRows.map((r) => r.rating).filter((x): x is number => typeof x === "number");
    const counts = [0, 0, 0, 0, 0];
    for (const r of ratings) if (r >= 1 && r <= 5) counts[r - 1] += 1;
    const respondedIds = new Set(rs.map((r) => r.member_id as string));
    // waiting = still on their screen: filed for them, not resolved, no answer
    const waitingIds = sentRows
      .filter((x) => !x.resolved && !respondedIds.has(x.member_id as string))
      .map((x) => x.member_id as string);
    return {
      id: p.id as string,
      title: p.title as string,
      body: (p.body as string) ?? "",
      responseKind: p.response_kind as ImPromptResult["responseKind"],
      responseLabel: (p.response_label as string | null) ?? null,
      audience: p.audience as string,
      audienceValues: (p.audience_values as string[]) ?? [],
      dismissible: !!p.dismissible,
      active: !!p.active,
      createdAt: p.created_at as string,
      createdBy: p.created_by ? person(p.created_by as string).name : null,
      sent: sentRows.length,
      answered: answeredRows.length,
      skipped: rs.filter((r) => r.skipped).length,
      waiting: waitingIds.length,
      avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      ratingCounts: counts,
      responses: rs
        .map((r) => ({
          ...person(r.member_id as string),
          rating: (r.rating as number | null) ?? null,
          text: (r.text_answer as string | null) ?? null,
          acknowledged: !!r.acknowledged,
          skipped: !!r.skipped,
          at: r.created_at as string,
        }))
        .sort((a, b) => b.at.localeCompare(a.at)),
      waitingPeople: waitingIds.map(person).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
  return { ok: true, data };
}

/** STOP A PROMPT — it leaves every screen it is still waiting on. Answers
 *  already given stay. */
export async function closeImPrompt(id: string): Promise<{ ok: true; closed: number } | { ok: false; error: string }> {
  const viewer = await getRealViewer();
  if (!canUseAdminTools(viewer)) return { ok: false, error: "Admin tools only." };
  const { error } = await db().from("im_prompts").update({ active: false }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  const { data: closed } = await db()
    .from("pending_prompts")
    .update({ resolved: true })
    .eq("kind", "im_prompt")
    .eq("ref_id", id)
    .eq("resolved", false)
    .select("id");
  await logAudit(viewer.id, "im_prompt_close", "im_prompt", id, { closed: closed?.length ?? 0 });
  revalidatePath("/admin");
  return { ok: true, closed: closed?.length ?? 0 };
}
