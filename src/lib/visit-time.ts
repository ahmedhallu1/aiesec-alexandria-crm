/** WHEN A VISIT CAN BE BOOKED.
 *
 *  Visit times are Cairo wall-clock ("HH:MM"), typed by hand into a time input
 *  — which is exactly where a slipped AM/PM or a stray digit lands. Nobody in
 *  this LC visits a company at 4 in the morning, so that is refused outright;
 *  the hours either side of it are legal but odd, so they ask rather than
 *  block. The rule lives here so the server and every one of the four time
 *  inputs that can book a visit read the SAME hours. */

/** Refused: no partner takes a meeting in these hours. */
export const VISIT_BLOCKED_FROM = 3; // 03:00
export const VISIT_BLOCKED_TO = 7; // until 06:59

export type VisitTimeVerdict =
  /** fine, say nothing */
  | { ok: true; warning: null }
  /** legal but unusual — show it, let them through */
  | { ok: true; warning: string }
  /** refused, with the reason the member should read */
  | { ok: false; error: string };

const OK: VisitTimeVerdict = { ok: true, warning: null };

/** 24h "HH:MM" (or "HH:MM:SS") → the hour, or null if unparseable. */
export function visitHour(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h;
}

/** The one rule. Unparseable input returns OK — the schema owns "is this even
 *  a time", and reporting the same field twice in two voices helps nobody. */
export function checkVisitTime(time: string | null | undefined): VisitTimeVerdict {
  const h = visitHour(time);
  if (h === null) return OK;
  if (h >= VISIT_BLOCKED_FROM && h < VISIT_BLOCKED_TO)
    return {
      ok: false,
      error:
        "A visit can't be booked between 3:00 and 7:00 AM — nobody is there to take it. Pick a working hour.",
    };
  if (h < VISIT_BLOCKED_FROM)
    return {
      ok: true,
      warning: "That's after midnight. Double-check the time is right — did you mean PM?",
    };
  if (h < 9)
    return {
      ok: true,
      warning: "That's before 9 AM. Double-check the partner is open that early.",
    };
  return OK;
}
