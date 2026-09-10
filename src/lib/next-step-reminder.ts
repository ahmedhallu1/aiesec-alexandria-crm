import { cairoToUtc } from "@/lib/time";

/** WHEN A NEXT STEP IS REMINDED (v36.2) — pure, so the tests pin it.
 *
 *  Measured before this existed: of 100 upcoming next steps, only 50 had any
 *  reminder at all, because the only one was a Google Calendar event and 44
 *  owners had never connected Google. So the reminder now comes from Sodio
 *  itself — bell, phone and email — for everybody; the calendar event stays as
 *  a bonus for those who have it.
 *
 *  · a step WITH a time is reminded an hour before it;
 *  · a step with only a DATE is reminded at 09:00 Cairo that morning;
 *  · once per (date, time): moving the step changes the key, so the new
 *    date is reminded too, and an unchanged one never nags twice. */

export const NEXT_STEP_MORNING = "09:00";
export const NEXT_STEP_LEAD_MS = 60 * 60 * 1000;

export function nextStepKey(date: string, time: string | null): string {
  return `${date} ${time ? time.slice(0, 5) : "--:--"}`;
}

/** The instant (UTC ms) the reminder may go out. */
export function nextStepRemindAt(date: string, time: string | null): number {
  return time
    ? cairoToUtc(date, time).getTime() - NEXT_STEP_LEAD_MS
    : cairoToUtc(date, NEXT_STEP_MORNING).getTime();
}

export function nextStepDue(
  row: {
    next_step_date: string | null;
    next_step_time: string | null;
    next_step_reminded_key: string | null;
  },
  /** Cairo's calendar date, YYYY-MM-DD */
  today: string,
  now: number
): boolean {
  // only TODAY's steps: an overdue one is a different conversation, and a
  // reminder for a day that has passed is not a reminder
  if (!row.next_step_date || row.next_step_date !== today) return false;
  if (row.next_step_reminded_key === nextStepKey(row.next_step_date, row.next_step_time)) return false;
  return now >= nextStepRemindAt(row.next_step_date, row.next_step_time);
}
