import { google } from "googleapis";
import { env, requireEnv } from "@/lib/env";

/** Sends branded transactional email from the IM director's mailbox
 *  (GMAIL_SENDER) via the Gmail API using an offline refresh token. */
export async function sendEmail(opts: {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
}): Promise<void> {
  const missing = requireEnv("googleClientId", "googleClientSecret", "gmailRefreshToken", "gmailSender");
  if (missing) {
    console.warn(`[email] Not sent ("${opts.subject}"): ${missing}`);
    return;
  }

  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: env.gmailRefreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const headers = [
    `From: ${encodeHeader(env.gmailSenderName)} <${env.gmailSender}>`,
    `To: ${opts.to.join(", ")}`,
    ...(opts.cc?.length ? [`Cc: ${opts.cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const message = headers.join("\r\n") + "\r\n\r\n" + Buffer.from(opts.html).toString("base64");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: Buffer.from(message).toString("base64url"),
    },
  });
}

/** RFC 2047 encoding so subjects/names survive non-ASCII characters. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}
