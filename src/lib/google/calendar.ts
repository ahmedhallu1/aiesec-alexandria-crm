import { google } from "googleapis";
import { env } from "@/lib/env";
import { cairoToUtc } from "@/lib/time";

export const LC_TIMEZONE = "Africa/Cairo";

// ------------------------------------------------------------------ ICS invites
// The RELIABLE calendar path: a real iCalendar (.ics) invite emailed through the
// working IM mailbox. Every member gets it in their @aiesec.net inbox and Google
// Calendar / Outlook / Apple Mail auto-add it with the 24h & 1h reminders — no
// per-member OAuth grant required. TL/VP ride along as real ATTENDEEs.

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export interface VisitInvite {
  /** stable id so a reschedule UPDATES the same event (same UID, higher SEQ) */
  uid: string;
  accountName: string;
  visitDate: string; // YYYY-MM-DD (Cairo local)
  visitTime: string; // HH:MM (Cairo local)
  notes?: string | null;
  detailsUrl: string;
  organizerEmail: string;
  organizerName: string;
  /** everyone the event is shared with (responsible + TL/VP) */
  attendeeEmails: string[];
  /** REQUEST to add/update, CANCEL to remove */
  method?: "REQUEST" | "CANCEL";
}

/** Builds an RFC 5545 VEVENT (as a REQUEST) with 24h + 1h alarms. Times are
 *  emitted in UTC (computed from Cairo local, DST-aware) so every client shows
 *  the exact same moment. */
export function buildVisitIcs(input: VisitInvite): string {
  const method = input.method ?? "REQUEST";
  const start = cairoToUtc(input.visitDate, input.visitTime);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1h visit
  const seq = Math.floor(Date.now() / 1000); // monotonic → reschedules update
  const attendees = [...new Set(input.attendeeEmails.filter(Boolean))];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sodio//AIESEC in Alexandria//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${seq}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(`AIESEC visit — ${input.accountName}`)}`,
    `DESCRIPTION:${icsEscape(`${input.notes ? input.notes + "\n" : ""}Account: ${input.detailsUrl}`)}`,
    `ORGANIZER;CN=${icsEscape(input.organizerName)}:mailto:${input.organizerEmail}`,
    ...attendees.map(
      (email) =>
        `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`
    ),
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Visit in 24 hours",
    "TRIGGER:-PT24H",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Visit in 1 hour",
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // CRLF line endings per the spec
  return lines.join("\r\n");
}

function calendarFor(refreshToken: string) {
  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth: oauth2 });
}

export interface VisitEventInput {
  accountName: string;
  visitDate: string; // YYYY-MM-DD
  visitTime: string; // HH:MM[:SS]
  detailsUrl: string;
  notes?: string | null;
  /** emails to share the event with (TL / VP) — they get a Google invite */
  attendees?: string[];
}

function eventBody(input: VisitEventInput) {
  const start = `${input.visitDate}T${input.visitTime.slice(0, 5)}:00`;
  const [h, m] = input.visitTime.split(":").map(Number);
  const endDate = new Date(Date.UTC(2000, 0, 1, h, m));
  endDate.setUTCHours(endDate.getUTCHours() + 1);
  const end = `${input.visitDate}T${String(endDate.getUTCHours()).padStart(2, "0")}:${String(endDate.getUTCMinutes()).padStart(2, "0")}:00`;
  const attendees = [...new Set((input.attendees ?? []).filter(Boolean))];
  return {
    summary: `AIESEC visit — ${input.accountName}`,
    description: `Company visit for ${input.accountName}.\n${input.notes ? input.notes + "\n" : ""}Account: ${input.detailsUrl}`,
    start: { dateTime: start, timeZone: LC_TIMEZONE },
    end: { dateTime: end, timeZone: LC_TIMEZONE },
    ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
    reminders: {
      useDefault: false,
      overrides: [
        // exactly 24 hours and 1 hour before the visit
        { method: "popup", minutes: 24 * 60 },
        { method: "email", minutes: 24 * 60 },
        { method: "popup", minutes: 60 },
        { method: "email", minutes: 60 },
      ],
    },
  };
}

/** Creates the visit event on the responsible member's own calendar (and emails
 *  a Google invite to any attendees). Returns the event id, or null when the
 *  member has no stored Google grant. */
export async function createVisitEvent(
  refreshToken: string | null,
  input: VisitEventInput
): Promise<string | null> {
  if (!refreshToken || !env.googleClientId) return null;
  const res = await calendarFor(refreshToken).events.insert({
    calendarId: "primary",
    requestBody: eventBody(input),
    sendUpdates: (input.attendees ?? []).length ? "all" : "none",
  });
  return res.data.id ?? null;
}

export async function updateVisitEvent(
  refreshToken: string | null,
  eventId: string,
  input: VisitEventInput
): Promise<void> {
  if (!refreshToken || !env.googleClientId) return;
  await calendarFor(refreshToken).events.patch({
    calendarId: "primary",
    eventId,
    requestBody: eventBody(input),
    sendUpdates: (input.attendees ?? []).length ? "all" : "none",
  });
}

export async function deleteVisitEvent(
  refreshToken: string | null,
  eventId: string
): Promise<void> {
  if (!refreshToken || !env.googleClientId) return;
  try {
    await calendarFor(refreshToken).events.delete({ calendarId: "primary", eventId });
  } catch {
    // already deleted by the user — nothing to do
  }
}

/** Why a calendar call failed, in a form the UI can explain:
 *  "relogin" = the stored Google grant is dead or missing the calendar scope
 *  (fixed by signing in with Google once more); "error" = anything else. */
export function calendarErrorHint(e: unknown): "relogin" | "error" {
  const msg =
    e instanceof Error ? `${e.message} ${JSON.stringify((e as { response?: { data?: unknown } }).response?.data ?? "")}` : String(e);
  if (
    msg.includes("invalid_grant") ||
    msg.includes("insufficient") ||
    msg.includes("Insufficient Permission") ||
    msg.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    msg.includes("insufficientPermissions")
  )
    return "relogin";
  return "error";
}

// ------------------------------------------------------------------ next-step follow-ups

export interface FollowupEventInput {
  accountName: string;
  step: string | null;
  date: string; // YYYY-MM-DD
  /** HH:MM — when null the reminder lands at 11:00 that day */
  time: string | null;
  detailsUrl: string;
}

function followupEventBody(input: FollowupEventInput) {
  const time = (input.time ?? "11:00").slice(0, 5);
  const start = `${input.date}T${time}:00`;
  const [h, m] = time.split(":").map(Number);
  const endDate = new Date(Date.UTC(2000, 0, 1, h, m));
  endDate.setUTCMinutes(endDate.getUTCMinutes() + 30);
  const end = `${input.date}T${String(endDate.getUTCHours()).padStart(2, "0")}:${String(endDate.getUTCMinutes()).padStart(2, "0")}:00`;
  return {
    summary: `AIESEC follow-up — ${input.accountName}`,
    description: `${input.step ? `Next step: ${input.step}\n` : ""}Account: ${input.detailsUrl}`,
    start: { dateTime: start, timeZone: LC_TIMEZONE },
    end: { dateTime: end, timeZone: LC_TIMEZONE },
    reminders: {
      useDefault: false,
      overrides: [
        // ping right at the follow-up time (+ a 1h heads-up)
        { method: "popup", minutes: 0 },
        { method: "email", minutes: 0 },
        { method: "popup", minutes: 60 },
      ],
    },
  };
}

/** Creates or updates the next-step reminder on the responsible's calendar.
 *  Returns the event id (null when the member has no Google grant). */
export async function upsertFollowupEvent(
  refreshToken: string | null,
  eventId: string | null,
  input: FollowupEventInput
): Promise<string | null> {
  if (!refreshToken || !env.googleClientId) return null;
  const cal = calendarFor(refreshToken);
  const requestBody = followupEventBody(input);
  if (eventId) {
    try {
      await cal.events.patch({ calendarId: "primary", eventId, requestBody });
      return eventId;
    } catch {
      // deleted by the member — fall through and create a fresh one
    }
  }
  const res = await cal.events.insert({ calendarId: "primary", requestBody });
  return res.data.id ?? null;
}

export async function deleteFollowupEvent(
  refreshToken: string | null,
  eventId: string
): Promise<void> {
  return deleteVisitEvent(refreshToken, eventId);
}
