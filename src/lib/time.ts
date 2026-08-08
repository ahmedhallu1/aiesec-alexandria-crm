import { LC_TIMEZONE } from "./google/calendar";

function tzOffsetMs(timeZone: string, utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(utcDate).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
  );
  return asUtc - utcDate.getTime();
}

/** Converts a local Alexandria (Africa/Cairo) date + time into a UTC Date,
 *  DST-aware. Used to know when a visit actually happens. */
/** DOES THIS CAIRO WALL-CLOCK ACTUALLY EXIST? (v33.24)
 *
 *  Egypt runs DST again (last Friday of April → last Thursday of October), and
 *  on the spring-forward night the clock jumps 00:00 → 01:00: 00:30 that night
 *  is not a time. `cairoToUtc` resolves it forward to 01:30, which is the
 *  standard behaviour and the only sane one — but a BOOKING PAGE must not
 *  OFFER a slot whose label and instant disagree, or an IR picks "12:30 AM"
 *  and gets an invite for 1:30 AM.
 *
 *  So: convert, convert back, and only trust it if it round-trips. */
export function cairoWallClockExists(date: string, time: string): boolean {
  const hhmm = time.slice(0, 5);
  const back = new Intl.DateTimeFormat("en-GB", {
    timeZone: LC_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(cairoToUtc(date, hhmm));
  const get = (t: string) => back.find((p) => p.type === t)?.value ?? "";
  return (
    `${get("year")}-${get("month")}-${get("day")}` === date &&
    `${get("hour")}:${get("minute")}` === hhmm
  );
}

export function cairoToUtc(date: string, time: string): Date {
  // two-pass: the offset must be evaluated AT the resulting instant, or
  // slots on a DST-transition evening land one hour off
  const guess = new Date(`${date}T${time.slice(0, 5)}:00Z`);
  const first = new Date(guess.getTime() - tzOffsetMs(LC_TIMEZONE, guess));
  return new Date(guess.getTime() - tzOffsetMs(LC_TIMEZONE, first));
}
