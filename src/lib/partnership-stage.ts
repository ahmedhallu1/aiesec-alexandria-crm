/** THE ROAD TO A PARTNERSHIP (v35.1).
 *
 *  Approaching a new LC was one bit of information — a target, then "done" —
 *  which is no use to the person holding it and no use to the MM watching. It
 *  is a process, and everyone on the floor already describes it the same way:
 *  you write to them, they answer, a call gets booked, the call happens, and
 *  the WhatsApp group goes up. The last one IS the partnership.
 *
 *  TWO OF THE FIVE ARE FACTS SODIO ALREADY HOLDS. An IR call with that LC for
 *  that programme is what "call scheduled" means, and a completed one is
 *  "call done" — so nobody should have to type them. The other three are
 *  things only the human knows.
 *
 *  ⚠️ AUTOMATIC MOVEMENT IS FORWARD ONLY (the user's call). The effective
 *  stage is the FURTHEST of what a human set and what the calls prove, so a
 *  cancelled call never silently drags a partnership backwards, and a human
 *  can always push it ahead of the calls. The consequence, stated plainly: a
 *  manual stage BELOW what the calls prove does not stick — the calls are
 *  facts, and a control that quietly contradicts them would be worse.
 *
 *  Pure — no DB, no server imports — so the reader, the action and the tests
 *  agree on one ladder.
 */

export const PARTNERSHIP_STAGES = [
  { value: "contacted", label: "Contacted", hint: "You've written to them" },
  { value: "answered", label: "Answered", hint: "They wrote back" },
  { value: "call_scheduled", label: "IR call scheduled", hint: "A call is booked — Sodio sets this itself" },
  { value: "call_done", label: "IR call done", hint: "The call happened — Sodio sets this itself" },
  { value: "group_made", label: "WhatsApp group made 🤝", hint: "That IS the partnership" },
] as const;

export type PartnershipStage = (typeof PARTNERSHIP_STAGES)[number]["value"];

const ORDER: PartnershipStage[] = PARTNERSHIP_STAGES.map((s) => s.value);

/** Where a stage sits on the ladder; -1 for "nothing yet". */
export function stageRank(stage: string | null | undefined): number {
  const i = ORDER.indexOf((stage ?? "") as PartnershipStage);
  return i;
}

export function isPartnershipStage(v: unknown): v is PartnershipStage {
  return typeof v === "string" && ORDER.includes(v as PartnershipStage);
}

export function stageLabel(stage: string | null | undefined): string | null {
  return PARTNERSHIP_STAGES.find((s) => s.value === stage)?.label ?? null;
}

/** The two stages the IR calls themselves prove. `null` when there are none.
 *
 *  A CANCELLED call proves nothing — it is excluded — but because the merge
 *  below only ever moves forward, a call that gets cancelled after the stage
 *  advanced does not pull it back down. */
export function stageFromCalls(
  calls: { status: string; product?: string | null }[],
  product: "GV" | "GT"
): PartnershipStage | null {
  const mine = calls.filter(
    (c) => c.status !== "cancelled" && (c.product == null || c.product === product)
  );
  if (mine.length === 0) return null;
  if (mine.some((c) => c.status === "completed")) return "call_done";
  return "call_scheduled";
}

/** What the LC card shows: the furthest of what a human set, what the calls
 *  prove, and — for a partnership already recorded — the finish line. */
export function effectiveStage(input: {
  manual?: string | null;
  calls?: { status: string; product?: string | null }[];
  product: "GV" | "GT";
  /** the partnership row is already `done` — the group exists, by definition */
  done?: boolean;
}): PartnershipStage | null {
  if (input.done) return "group_made";
  const auto = stageFromCalls(input.calls ?? [], input.product);
  const manual = isPartnershipStage(input.manual) ? input.manual : null;
  if (!auto) return manual;
  if (!manual) return auto;
  return stageRank(manual) >= stageRank(auto) ? manual : auto;
}

/** Did SODIO decide this, rather than a person? Drives the "set by Sodio"
 *  hint on the control, so nobody wonders why a stage moved on its own. */
export function stageIsAutomatic(input: {
  manual?: string | null;
  calls?: { status: string; product?: string | null }[];
  product: "GV" | "GT";
  done?: boolean;
}): boolean {
  if (input.done) return false;
  const auto = stageFromCalls(input.calls ?? [], input.product);
  if (!auto) return false;
  const manual = isPartnershipStage(input.manual) ? input.manual : null;
  return !manual || stageRank(auto) > stageRank(manual);
}
