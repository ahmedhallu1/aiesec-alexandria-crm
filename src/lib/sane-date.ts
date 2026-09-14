/** A calendar date a human could actually have meant (v36.6).
 *
 *  A date input accepts a six-digit year, so a slipped key stores "20888-09-17"
 *  as a next step — and Google Calendar then refuses the reminder ("Invalid
 *  start time", twice in the production log). YYYY-MM-DD, a real day of a real
 *  month, and a year Sodio will plausibly still be running in. */
export function isSaneIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2020 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= days;
}

/** HH:MM or HH:MM:SS, 24-hour. */
export function isSaneTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v);
}
