import { cairoToday } from "./types";

/** A sign-up currently marked contacted, as the streak reads it. */
export interface StreakContactRow {
  id: string;
  assigned_to: string | null;
  contacted_at: string;
  source: string | null;
}

/** "Who flipped this sign-up to Contacted, and when" — a signup_logs row. */
export interface StreakContactLog {
  signup_id: string;
  member_id: string | null;
  at: string;
}

/** THE DAYS EACH MEMBER CONTACTED ON — ONE RULE FOR THE CARD AND THE NAG
 *  (v37.14).
 *
 *  Every currently-contacted sign-up counts for its assignee on the Cairo day
 *  of `contacted_at` — except a REFERRAL (v33.39, the abuse fix): it arrives
 *  pre-contacted by whoever logged it, so it counts only when the assignee
 *  flipped the contact themselves, on the day of their own first log.
 *
 *  The streak card applied that rule and the 19:00 nag cron didn't, so an MM
 *  whose only "contact" today was a referral someone else logged was told
 *  nothing by the nag (it saw the day as saved) while the card let the streak
 *  die at midnight. Both read this now.
 *
 *  Returns member → one Cairo day PER SIGN-UP (duplicates kept: the card's
 *  "contacted today" tally counts them). */
export function contactDaysByMember(
  rows: readonly StreakContactRow[],
  logs: readonly StreakContactLog[]
): Map<string, string[]> {
  // sign-up → member → the first Cairo day that member logged a contact on it
  const ownDay = new Map<string, Map<string, string>>();
  for (const l of logs) {
    if (!l.member_id) continue;
    const at = new Date(l.at);
    if (Number.isNaN(at.getTime())) continue;
    const per = ownDay.get(l.signup_id) ?? new Map<string, string>();
    const day = cairoToday(at);
    const prev = per.get(l.member_id);
    if (!prev || day < prev) per.set(l.member_id, day);
    ownDay.set(l.signup_id, per);
  }

  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.assigned_to) continue;
    let day: string;
    if (r.source === "referral") {
      const own = ownDay.get(r.id)?.get(r.assigned_to);
      if (!own) continue;
      day = own;
    } else {
      const at = new Date(r.contacted_at);
      if (Number.isNaN(at.getTime())) continue;
      day = cairoToday(at);
    }
    const list = out.get(r.assigned_to) ?? [];
    list.push(day);
    out.set(r.assigned_to, list);
  }
  return out;
}
