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
export function cairoToUtc(date: string, time: string): Date {
  const guess = new Date(`${date}T${time.slice(0, 5)}:00Z`);
  return new Date(guess.getTime() - tzOffsetMs(LC_TIMEZONE, guess));
}
