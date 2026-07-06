import { google } from "googleapis";
import { env } from "@/lib/env";

export const LC_TIMEZONE = "Africa/Cairo";

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
}

function eventBody(input: VisitEventInput) {
  const start = `${input.visitDate}T${input.visitTime.slice(0, 5)}:00`;
  const [h, m] = input.visitTime.split(":").map(Number);
  const endDate = new Date(Date.UTC(2000, 0, 1, h, m));
  endDate.setUTCHours(endDate.getUTCHours() + 1);
  const end = `${input.visitDate}T${String(endDate.getUTCHours()).padStart(2, "0")}:${String(endDate.getUTCMinutes()).padStart(2, "0")}:00`;
  return {
    summary: `AIESEC visit — ${input.accountName}`,
    description: `Company visit for ${input.accountName}.\n${input.notes ? input.notes + "\n" : ""}Account: ${input.detailsUrl}`,
    start: { dateTime: start, timeZone: LC_TIMEZONE },
    end: { dateTime: end, timeZone: LC_TIMEZONE },
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

/** Creates the visit event on the responsible member's own calendar.
 *  Returns the event id, or null when the member has no stored Google grant. */
export async function createVisitEvent(
  refreshToken: string | null,
  input: VisitEventInput
): Promise<string | null> {
  if (!refreshToken || !env.googleClientId) return null;
  const res = await calendarFor(refreshToken).events.insert({
    calendarId: "primary",
    requestBody: eventBody(input),
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
