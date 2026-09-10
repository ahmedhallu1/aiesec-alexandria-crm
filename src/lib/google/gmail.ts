import { google } from "@/lib/google/apis";
import { env, requireEnv } from "@/lib/env";
import { sandboxSuppressed } from "@/server/sandbox";

/** Sends branded transactional email from the IM director's mailbox
 *  (GMAIL_SENDER) via the Gmail API using an offline refresh token. */
export async function sendEmail(opts: {
  /** sets the Reply-To header — replies go to a person, not the mailbox */
  replyTo?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  /** an iCalendar invite — Gmail shows an "add to calendar" card and Outlook/
   *  Apple Mail add the event automatically (used for visit reminders). */
  ics?: { content: string; method?: "REQUEST" | "CANCEL" };
  /** files riding along as MIME parts (the nightly backup's off-site copy). */
  attachments?: { filename: string; mimeType: string; contentBase64: string }[];
}): Promise<void> {
  if (await sandboxSuppressed(`email "${opts.subject}"`)) return;
  const missing = requireEnv("googleClientId", "googleClientSecret", "gmailRefreshToken", "gmailSender");
  if (missing) {
    console.warn(`[email] Not sent ("${opts.subject}"): ${missing}`);
    return;
  }

  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: env.gmailRefreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  // A BCC-ONLY SEND STILL NEEDS A `To:` (v33.33). One message to nine people
  // on BCC is the right shape — nine separate sends is not — but an empty To
  // header is rejected by some servers and renders as a blank recipient in
  // the rest. Addressing it to ourselves is the standard way to say
  // "undisclosed recipients" and keeps the copy in the LC's own mailbox.
  const toLine = opts.to.length > 0 ? opts.to.join(", ") : env.gmailSender;

  const addrHeaders = [
    `From: ${encodeHeader(env.gmailSenderName)} <${env.gmailSender}>`,
    `To: ${toLine}`,
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    ...(opts.cc?.length ? [`Cc: ${opts.cc.join(", ")}`] : []),
    ...(opts.bcc?.length ? [`Bcc: ${opts.bcc.join(", ")}`] : []),
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
  ];

  let message: string;
  if (opts.ics) {
    // CANONICAL invite: multipart/alternative with text/html + text/calendar
    // (method=REQUEST). Gmail renders this as an RSVP invite card and Google
    // Workspace auto-adds it to same-domain calendars. (A multipart/mixed
    // wrapper or a separate .ics attachment makes Gmail show it as a plain
    // file instead — so we deliberately DON'T do that.)
    const alt = `alt_${Date.now().toString(36)}`;
    const method = opts.ics.method ?? "REQUEST";
    const icsB64 = Buffer.from(opts.ics.content).toString("base64");
    message = [
      ...addrHeaders,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      `--${alt}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(opts.html).toString("base64"),
      "",
      `--${alt}`,
      `Content-Type: text/calendar; charset="UTF-8"; method=${method}`,
      "Content-Transfer-Encoding: base64",
      "",
      icsB64,
      "",
      `--${alt}--`,
    ].join("\r\n");
  } else if (opts.attachments?.length) {
    // multipart/mixed: the body, then each file. (An invite would need
    // multipart/alternative INSIDE this, which nothing needs today.)
    const mix = `mix_${Date.now().toString(36)}`;
    message = [
      ...addrHeaders,
      `Content-Type: multipart/mixed; boundary="${mix}"`,
      "",
      `--${mix}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(opts.html).toString("base64"),
      ...opts.attachments.flatMap((a) => [
        "",
        `--${mix}`,
        `Content-Type: ${a.mimeType}; name="${a.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${a.filename}"`,
        "",
        a.contentBase64,
      ]),
      "",
      `--${mix}--`,
    ].join("\r\n");
  } else {
    message =
      [...addrHeaders, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64"].join("\r\n") +
      "\r\n\r\n" +
      Buffer.from(opts.html).toString("base64");
  }

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

export interface MailAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string;
}

/** ONE RFC822 BUILDER FOR BOTH THE DRAFT AND THE SEND PATH (v34.8).
 *
 *  These were two copies of the same MIME assembly, and only the draft copy
 *  ever learned about attachments — which is why "send the proposal now"
 *  could not exist until this was shared: sending it would silently have
 *  dropped the PDF the member asked for. */
function rawMessage(opts: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}): string {
  const headers = [
    `To: ${opts.to.join(", ")}`,
    ...(opts.cc?.length ? [`Cc: ${opts.cc.join(", ")}`] : []),
    // BCC is a real header on the OUTGOING message — Gmail strips it from
    // every delivered copy, which is the whole point of it (v33.25)
    ...(opts.bcc?.length ? [`Bcc: ${opts.bcc.join(", ")}`] : []),
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
  ];
  const body = Buffer.from(opts.html).toString("base64");

  if (!opts.attachments?.length) {
    return (
      [...headers, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64"].join("\r\n") +
      "\r\n\r\n" +
      body
    );
  }

  const boundary = `crm_${Date.now().toString(36)}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ];
  for (const a of opts.attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${encodeHeader(a.filename)}"`,
      `Content-Disposition: attachment; filename="${encodeHeader(a.filename)}"`,
      "Content-Transfer-Encoding: base64",
      "",
      a.contentBase64
    );
  }
  parts.push(`--${boundary}--`);
  return parts.join("\r\n");
}


/** Creates a DRAFT in the MEMBER's own Gmail (gmail.compose scope from their
 *  Google sign-in). The member reviews and hits send themselves. Optional
 *  attachments (e.g. the official proposal PDF) ride along as MIME parts. */
export async function createMemberDraft(
  refreshToken: string,
  opts: {
    to: string;
    cc?: string[];
    subject: string;
    html: string;
    attachments?: MailAttachment[];
  }
): Promise<string | null> {
  if (await sandboxSuppressed(`gmail draft "${opts.subject}"`)) return "sandbox";
  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const message = rawMessage({ ...opts, to: [opts.to] });

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: Buffer.from(message).toString("base64url") } },
  });
  return res.data.id ?? null;
}

/** SENDS an email from the MEMBER's own Gmail (their gmail.compose grant —
 *  the scope covers sending mail the member composed). Used by the
 *  Expectation-mail flow after the VP reviews & edits the exact body in-app.
 *  Same OAuth client + raw RFC822 building as createMemberDraft, but the
 *  message goes straight out via users.messages.send. */
export async function sendMemberEmail(
  refreshToken: string,
  opts: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html: string;
    /** v34.8 — the proposal email can now go out with its PDF straight away */
    attachments?: MailAttachment[];
  }
): Promise<string | null> {
  if (await sandboxSuppressed(`gmail send "${opts.subject}"`)) return "sandbox";
  const oauth2 = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  const message = rawMessage(opts);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(message).toString("base64url") },
  });
  return res.data.id ?? null;
}
