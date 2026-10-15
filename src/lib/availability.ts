/** AVAILABILITY RULES, SHARED (v33.28).
 *
 *  The member builds a list of windows and finds out on SAVE whether any of
 *  them is impossible — one message for the whole form, so a row further down
 *  than the one you are looking at can be the one that's wrong. Google
 *  Calendar marks the offending line as you type; so does this.
 *
 *  These are the same three rules the server enforces, in one place so the two
 *  cannot drift. The server keeps its own check — this only moves the answer
 *  earlier, it never replaces it.
 */

export interface AvailabilityWindow {
  /** 0-6, Sunday-first — null on a one-off row */
  day?: number | null;
  /** YYYY-MM-DD on a one-off row */
  date?: string | null;
  from?: string | null;
  to?: string | null;
}

const HHMM = /^\d{2}:\d{2}$/;

/** Minutes since midnight. */
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** A window may END at midnight: "00:00" and the legacy "23:59" workaround
 *  both mean the end of the day, not the start of it. */
export const toEndMin = (t: string) => {
  const m = toMin(t);
  return m === 0 || m === 1439 ? 1440 : m;
};

/** What is wrong with ONE row, on its own — null when it is fine. */
export function windowIssue(w: AvailabilityWindow): string | null {
  const from = String(w.from ?? "");
  const to = String(w.to ?? "");
  if (!HHMM.test(from) || !HHMM.test(to)) return "Pick a start and an end time.";
  if (toEndMin(to) - toMin(from) < 10)
    return "This window is shorter than 10 minutes — no call would fit in it.";
  if (w.date != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(w.date)))
      return "Pick the date this one-off applies to.";
  } else if (typeof w.day !== "number" || w.day < 0 || w.day > 6) {
    return "Pick a day of the week.";
  }
  return null;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Which rows CLASH with an earlier row — two windows on the same day would
 *  mint two overlapping slot grids, and the same minute would be offered
 *  twice. Returns a message per offending row index. */
export function overlapIssues(windows: AvailabilityWindow[]): Map<number, string> {
  const out = new Map<number, string>();
  type Span = { i: number; from: number; to: number };
  const groups = new Map<string, Span[]>();
  const weekly = new Map<number, Span[]>();
  const dated: (Span & { date: string })[] = [];
  windows.forEach((w, i) => {
    if (windowIssue(w)) return; // a broken row reports its own problem first
    const span = { i, from: toMin(String(w.from)), to: toEndMin(String(w.to)) };
    const key = w.date != null ? `d:${w.date}` : `w:${w.day}`;
    groups.set(key, [...(groups.get(key) ?? []), span]);
    if (w.date != null) dated.push({ ...span, date: String(w.date) });
    else weekly.set(Number(w.day), [...(weekly.get(Number(w.day)) ?? []), span]);
  });
  for (const list of groups.values()) {
    // v37.13 — compare against the window that reaches FURTHEST so far, not
    // just the previous one: 09:00–17:00, 10:00–11:00, 12:00–13:00 used to
    // mark only the second row, though the third sits inside the first too
    const sorted = [...list].sort((a, b) => a.from - b.from);
    let reach = sorted[0];
    for (const cur of sorted.slice(1)) {
      if (cur.from < reach.to)
        out.set(
          cur.i,
          `This overlaps another window on the same day — the one starting ${hhmm(reach.from)}.`
        );
      if (cur.to > reach.to) reach = cur;
    }
  }
  // a one-off date ALSO carries that weekday's weekly windows — the server
  // (saveIrBookingSettings) merges the two before its own overlap check, so
  // the form must too, or Save is offered and then refused
  for (const d of dated) {
    if (out.has(d.i)) continue;
    const dow = new Date(`${d.date}T12:00:00Z`).getUTCDay();
    const hit = (weekly.get(dow) ?? []).find((w) => d.from < w.to && w.from < d.to);
    if (hit)
      out.set(
        d.i,
        `This overlaps your weekly ${DAY_NAMES[dow]} window starting ${hhmm(hit.from)}.`
      );
  }
  return out;
}

function hhmm(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
}

/** Every row's problem, keyed by index — the shape the form renders from. */
export function availabilityIssues(
  windows: AvailabilityWindow[]
): Map<number, string> {
  const out = overlapIssues(windows);
  windows.forEach((w, i) => {
    const own = windowIssue(w);
    if (own) out.set(i, own);
  });
  return out;
}
