/** AN MM'S ACCESS, SET BY THEIR VP (v37.4).
 *
 *  The role used to decide it alone: a Team Leader reached their direct team,
 *  a Coordinator reached nobody but themself. The LC wanted the function's
 *  leader to decide it PER MM, because the job a person does doesn't always
 *  match the seat they hold — a TL covering the whole floor for a sprint, a TL
 *  being turned into a Coordinator, a Coordinator who runs the queue.
 *
 *  Three settings, for any MM (Team Leader or Coordinator) of an operations
 *  function — ICX (IGV · IGT), B2B & BD, B2C, OGX (OGT · OGV):
 *    · "team"     — their direct team (a Team Leader's default)
 *    · "function" — every member of the function
 *    · "none"     — nobody but themself (a Coordinator's default)
 *
 *  "Access" is the MM's authority over other people's WORK: whose accounts and
 *  sign-ups they see, work and hand over, whose calls they answer for. It is
 *  NOT the team itself — the team card, the team plan and the team board still
 *  follow the Manager column, because who reports to whom didn't change.
 *
 *  Stored in the function's own defaults blob (`function_settings`) as
 *  `mmAccess: { [memberId]: mode }`, so it needs no migration and an MM with no
 *  entry behaves exactly as they did before. Pure — the settings page, the
 *  Viewer builder and the tests all read this one file. */

export type MmAccess = "team" | "function" | "none";

export const MM_ACCESS_MODES: readonly MmAccess[] = ["team", "function", "none"];

export const MM_ACCESS_LABEL: Record<MmAccess, string> = {
  team: "Their team",
  function: "The whole function",
  none: "Only themself",
};

export const MM_ACCESS_HINT: Record<MmAccess, string> = {
  team: "Sees and works their own team's accounts, sign-ups and calls.",
  function: "Sees and works every member's — like a Team Leader over the whole function.",
  none: "Works alone, like a Coordinator: their own work only.",
};

/** The operations functions a VP may set this for. TM and the support
 *  functions have no pool of work to reach into. */
export const MM_ACCESS_FUNCTIONS = ["IGV", "IGT", "B2B", "BD", "B2C", "OGT", "OGV"] as const;

/** B2B and BD are one crew with two labels (as everywhere else): an MM's
 *  access is stored once, under B2B, whichever label their row carries. */
export function mmAccessKey(fn: string): string {
  return fn === "BD" ? "B2B" : fn;
}

export function isMmAccess(v: unknown): v is MmAccess {
  return typeof v === "string" && (MM_ACCESS_MODES as readonly string[]).includes(v);
}

/** What an MM gets when their VP has said nothing — the old role rule. */
export function defaultMmAccess(role: string): MmAccess {
  return role === "Team Leader" ? "team" : "none";
}

/** Clean a stored map: uuid-ish keys, known modes, nothing else. */
export function resolveMmAccessMap(stored: unknown): Record<string, MmAccess> {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: Record<string, MmAccess> = {};
  for (const [k, v] of Object.entries(stored as Record<string, unknown>))
    if (/^[0-9a-f-]{8,64}$/i.test(k) && isMmAccess(v)) out[k] = v;
  return out;
}

/** The operations functions a member works, by settings key (BD → B2B). */
export function mmAccessFunctionsOf(m: {
  functions?: string[] | null;
  sub_functions?: string[] | null;
}): string[] {
  const mine = new Set([...(m.functions ?? []), ...(m.sub_functions ?? [])]);
  return [
    ...new Set(
      (MM_ACCESS_FUNCTIONS as readonly string[]).filter((f) => mine.has(f)).map(mmAccessKey)
    ),
  ];
}

/** THE REACH, resolved for one MM.
 *
 *  Returns `null` when nothing was set for them anywhere — the caller then
 *  keeps the plain role rule, so an LC that never opens the card cannot tell
 *  it exists. When a VP HAS set something, only the explicit choices count:
 *  "none" on IGV must not be quietly undone by the IGT default the IGT VP
 *  never touched. `functions` are the settings keys whose whole membership
 *  the MM reaches. */
export function resolveMmReach(
  member: {
    id: string;
    role: string;
    functions?: string[] | null;
    sub_functions?: string[] | null;
  },
  mapsByFn: Record<string, Record<string, MmAccess> | undefined>
): { team: boolean; functions: string[] } | null {
  if (member.role !== "Team Leader" && member.role !== "Coordinator") return null;
  const explicit = mmAccessFunctionsOf(member)
    .map((fn) => ({ fn, mode: mapsByFn[fn]?.[member.id] }))
    .filter((x): x is { fn: string; mode: MmAccess } => isMmAccess(x.mode));
  if (explicit.length === 0) return null;
  return {
    team: explicit.some((x) => x.mode === "team"),
    functions: explicit.filter((x) => x.mode === "function").map((x) => x.fn),
  };
}

/** Does a member belong to a function's pool of people, for a "function"
 *  reach? The function's leaders are not part of the floor an MM reaches. */
export function inMmAccessFloor(
  m: { id: string; role: string; functions?: string[] | null; sub_functions?: string[] | null },
  fnKey: string
): boolean {
  if (["LCP", "LCVP", "Director"].includes(m.role)) return false;
  return mmAccessFunctionsOf(m).includes(fnKey);
}
