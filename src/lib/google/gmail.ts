import { google } from "googleapis";
import { env, requireEnv } from "@/lib/env";

/** Sends branded transactional email from the IM director's mailbox
 *  (GMAIL_SENDER) via the Gmail API using an offline refresh token. */
export async function sendEmail(opts: {
  to: string[];
  cc?: string[];
  bcc?: string[];
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
    ...(opts.bcc?.length ? [`Bcc: ${opts.bcc.join(", ")}`] : []),
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


/** Creates a DRAFT in the MEMBER's own Gmail (gmail.compose scope from their
 *  Google sign-in). The member reviews and hits send themselves. Optional
 *  attachments (e.g. the official proposal PDF) ride along as MIME parts. */
export async function createMemberDraft(
  refreshToken: string,
  opts: {
    to: string;
    subject: string;
    html: string;
    attachments?: { filename: string; mimeType: string; contentBase64: string }[];
  }
): Promise<string | null> {
  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  let message: string;
  if (opts.attachments && opts.attachments.length > 0) {
    const boundary = `crm_${Date.now().toString(36)}`;
    const parts = [
      `To: ${opts.to}`,
      `Subject: ${encodeHeader(opts.subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(opts.html).toString("base64"),
    ];
    for (const a of opts.attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${a.mimeType}; name="${a.filename}"`,
        `Content-Disposition: attachment; filename="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        a.contentBase64
      );
    }
    parts.push(`--${boundary}--`);
    message = parts.join("\r\n");
  } else {
    const headers = [
      `To: ${opts.to}`,
      `Subject: ${encodeHeader(opts.subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ];
    message =
      headers.join("\r\n") + "\r\n\r\n" + Buffer.from(opts.html).toString("base64");
  }

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: Buffer.from(message).toString("base64url") } },
  });
  return res.data.id ?? null;
}
