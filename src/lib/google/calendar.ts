import { google } from "googleapis";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import { cairoToUtc } from "@/lib/time";
import { sandboxSuppressed } from "@/server/sandbox";

export const LC_TIMEZONE = "Africa/Cairo";

// ------------------------------------------------------------------ mailbox calendar
// The RELIABLE path: create the visit as a real Google Calendar event via the
// IM mailbox (GMAIL_REFRESH_TOKEN) with attendees + sendUpdates:"all". Google
// then natively pushes the event onto every attendee's calendar (auto-added for
// same-domain Workspace users) and sends the invite — no per-member OAuth grant
// needed. Events live on a dedicated "Sodio — LC Visits" calendar so they don't
// clutter anyone's personal calendar. Requires the IM token to carry the
// calendar scope; if it doesn't, callers fall back to emailing the .ics.

function mailboxCalendar() {
  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: env.gmailRefreshToken });
  return google.calendar({ version: "v3", auth: oauth2 });
}

const VISITS_CAL_NAME = "Sodio — LC Visits";

/** In-process negative cache: once we learn the mailbox token can't use the
 *  Calendar API, skip the (slow, retrying) Google call for a while so every
 *  scheduleVisit stays fast and never blocks on a call we know will 403. */
let calendarDisabledUntil = 0;

/** Finds (or creates) the shared "Sodio — LC Visits" calendar on the IM mailbox
 *  and caches its id. Returns null if the mailbox token lacks calendar scope. */
export async function getVisitsCalendarId(): Promise<string | null> {
  if (!env.gmailRefreshToken || !env.googleClientId) return null;
  if (Date.now() < calendarDisabledUntil) return null; // known-unavailable, skip
  const { data: cached } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", "calendar:visits")
    .maybeSingle();
  if (cached?.value && typeof cached.value === "object" && "id" in cached.value) {
    return (cached.value as { id: string }).id;
  }
  try {
    const cal = mailboxCalendar();
    const list = await cal.calendarList.list({ maxResults: 250 });
    let id =
      (list.data.items ?? []).find((c) => c.summary === VISITS_CAL_NAME)?.id ?? null;
    if (!id) {
      const created = await cal.calendars.insert({
        requestBody: { summary: VISITS_CAL_NAME, timeZone: LC_TIMEZONE },
      });
      id = created.data.id ?? null;
    }
    if (id) {
      await db()
        .from("app_settings")
        .upsert({ key: "calendar:visits", value: { id }, updated_at: new Date().toISOString() });
    }
    return id;
  } catch (e) {
    // most likely the token lacks calendar scope — back off for 30 min so we
    // don't re-hit (and retry) Google on every visit; Tier 1/3 still cover it
    calendarDisabledUntil = Date.now() + 30 * 60 * 1000;
    console.error(
      "[calendar] mailbox calendar unavailable (token needs calendar scope), backing off 30m:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/** Creates or updates a visit event on the shared calendar with attendees. On
 *  success Google emails invites and auto-adds it to same-domain calendars.
 *  Returns the event id, or throws (caller falls back to the .ics email). */
export async function upsertMailboxVisitEvent(
  calendarId: string,
  existingEventId: string | null,
  input: VisitEventInput
): Promise<string | null> {
  if (await sandboxSuppressed("mailbox visit event")) return existingEventId;
  const cal = mailboxCalendar();
  const requestBody = eventBody(input);
  if (existingEventId) {
    try {
      const res = await cal.events.patch({
        calendarId,
        eventId: existingEventId,
        requestBody,
        sendUpdates: "all",
      });
      return res.data.id ?? existingEventId;
    } catch {
      // event was on a different (old) calendar or deleted — create a fresh one
    }
  }
  const res = await cal.events.insert({
    calendarId,
    requestBody,
    sendUpdates: "all",
  });
  return res.data.id ?? null;
}

/** Admin diagnostic: is the IM mailbox token able to use the Calendar API?
 *  Surfaces the exact reason so we know whether Tier 2 works. */
export async function diagnoseMailboxCalendar(): Promise<{ ok: boolean; detail: string }> {
  if (!env.gmailRefreshToken)
    return { ok: false, detail: "GMAIL_REFRESH_TOKEN is not set in the environment." };
  if (!env.googleClientId)
    return { ok: false, detail: "AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are not set." };
  try {
    const list = await mailboxCalendar().calendarList.list({ maxResults: 1 });
    return {
      ok: true,
      detail: `Calendar API reachable — ${list.data.items?.length ?? 0}+ calendars visible. Events will be created directly.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const scopeIssue = /insufficient|scope|forbidden|permission|ACCESS_TOKEN_SCOPE/i.test(msg);
    return {
      ok: false,
      detail: scopeIssue
        ? "The IM mailbox token can't use Calendar. Re-mint GMAIL_REFRESH_TOKEN with BOTH scopes: https://mail.google.com/ AND https://www.googleapis.com/auth/calendar (see SETUP.md §5). Tier-1 personal-calendar reminders + the .ics email still work meanwhile."
        : `Calendar API error: ${msg.slice(0, 200)}`,
    };
  }
}

/** Cancels a visit event on the shared calendar (notifies attendees). */
export async function deleteMailboxVisitEvent(eventId: string): Promise<void> {
  const calendarId = await getVisitsCalendarId();
  if (!calendarId) return;
  try {
    await mailboxCalendar().events.delete({ calendarId, eventId, sendUpdates: "all" });
  } catch {
    // already gone — nothing to do
  }
}

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
  if (await sandboxSuppressed("visit calendar event")) return null;
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
  if (await sandboxSuppressed("next-step reminder event")) return eventId;
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

// ------------------------------------------------------------------ IR-call bookings (v27/v28)

/** Creates a booked IR call on the OWNER's own calendar ("IR call — {LC}",
 *  slot-length duration, 1h + 10min pings). v28: the booker rides along as a
 *  real ATTENDEE (Google emails them the invite), a Meet room is provisioned
 *  (conferenceDataVersion 1) and guestsCanInviteOthers follows the member's
 *  booking settings. Called from the PUBLIC booking action (no viewer → no
 *  sandbox), best-effort: returns null without a grant and throws on API
 *  errors so the caller can log-and-continue. */
export async function createIrCallEvent(
  refreshToken: string | null,
  input: {
    partnerLc: string;
    start: Date;
    minutes: number;
    description?: string | null;
    /** the IR's email — invited as an attendee (Google sends the invite) */
    attendeeEmail?: string | null;
    guestsCanInvite?: boolean;
  }
): Promise<{ id: string; meetLink: string | null } | null> {
  if (!refreshToken || !env.googleClientId) return null;
  const end = new Date(input.start.getTime() + input.minutes * 60_000);
  const res = await calendarFor(refreshToken).events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: input.attendeeEmail ? "all" : "none",
    requestBody: {
      summary: `IR call — ${input.partnerLc}`,
      ...(input.description ? { description: input.description } : {}),
      start: { dateTime: input.start.toISOString(), timeZone: LC_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: LC_TIMEZONE },
      ...(input.attendeeEmail ? { attendees: [{ email: input.attendeeEmail }] } : {}),
      guestsCanInviteOthers: input.guestsCanInvite ?? true,
      conferenceData: {
        createRequest: {
          requestId: `ir-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },
          { method: "email", minutes: 60 },
          { method: "popup", minutes: 10 },
        ],
      },
    },
  });
  const id = res.data.id ?? null;
  if (!id) return null;
  const meetLink =
    res.data.hangoutLink ??
    res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ??
    null;
  return { id, meetLink };
}

/** Moves a booked IR call to a new time (public reschedule) — attendees get
 *  Google's update email. Best-effort: no grant / no event id → no-op. */
export async function updateIrCallEvent(
  refreshToken: string | null,
  eventId: string | null,
  start: Date,
  minutes: number
): Promise<void> {
  if (!refreshToken || !env.googleClientId || !eventId) return;
  const end = new Date(start.getTime() + minutes * 60_000);
  await calendarFor(refreshToken).events.patch({
    calendarId: "primary",
    eventId,
    sendUpdates: "all",
    requestBody: {
      start: { dateTime: start.toISOString(), timeZone: LC_TIMEZONE },
      end: { dateTime: end.toISOString(), timeZone: LC_TIMEZONE },
    },
  });
}

/** Deletes a booked IR call's event and lets Google notify the attendees
 *  (unlike deleteVisitEvent, which removes silently). */
export async function deleteIrCallEvent(
  refreshToken: string | null,
  eventId: string
): Promise<void> {
  if (!refreshToken || !env.googleClientId) return;
  try {
    await calendarFor(refreshToken).events.delete({
      calendarId: "primary",
      eventId,
      sendUpdates: "all",
    });
  } catch {
    // already deleted — nothing to do
  }
}
