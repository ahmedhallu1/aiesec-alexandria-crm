/** WHICH B2C CALL IS "THE" CALL, AND WHAT PICKING A CALLER DOES (v37.4).
 *
 *  Pure — the CIC list, the server action and the tests all read this, so the
 *  two B2C cells (caller · outcome) can never disagree about which row they
 *  are showing again.
 *
 *  ⚠️ THE BUG THIS EXISTS FOR. The list used to show "the latest call with no
 *  outcome", and assigning reused "the latest call with no outcome". So the
 *  two cells cancelled each other out:
 *    1. pick yourself as caller   → a blank call row
 *    2. record "Out of service"   → the row is no longer "open" → the caller
 *                                    cell goes blank
 *    3. pick yourself again       → a NEW blank row → the outcome cell goes
 *                                    blank
 *  Production carried exactly that on 1 Oct 2026. The call on screen is now
 *  always the LATEST one, recorded or not. */

export interface B2cCallLike {
  side: string;
  caller_id: string | null;
  outcome: string | null;
  contact_status: string | null;
}

/** Nothing written on the call yet — the only state it can be taken back in,
 *  or quietly handed to somebody else. */
export function b2cCallUnrecorded(c: Pick<B2cCallLike, "outcome" | "contact_status"> | null | undefined): boolean {
  return !!c && !c.outcome && !c.contact_status;
}

/** The current B2C call: the newest B2C row. `calls` must be newest first,
 *  which is how every reader in the app orders them. */
export function currentB2cCall<T extends B2cCallLike>(calls: readonly T[] | null | undefined): T | null {
  return (calls ?? []).find((c) => c.side === "B2C") ?? null;
}

/** What assigning `callerId` does to a sign-up whose current B2C call is
 *  `latest`:
 *    · "noop"     — it is already theirs (re-picking must never make a row)
 *    · "handover" — the current call is still blank: hand THAT call over
 *    · "new"      — no call yet, or the current one was recorded by someone
 *                   else: a fresh call for them; the recorded one stays in
 *                   the history under the person who made it */
export function b2cAssignPlan(
  latest: Pick<B2cCallLike, "caller_id" | "outcome" | "contact_status"> | null | undefined,
  callerId: string
): "noop" | "handover" | "new" {
  if (!latest) return "new";
  if (latest.caller_id === callerId) return "noop";
  return b2cCallUnrecorded(latest) ? "handover" : "new";
}
