import { env } from "@/lib/env";

/** AIESEC-branded transactional email layout.
 *  Blue #0A2540, Cyan #037EF3 — table-based so it renders everywhere. */
export function emailLayout(opts: { preheader?: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background-color:#f0f4f9;font-family:Arial,Helvetica,sans-serif;">
  ${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${opts.preheader}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f4f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background-color:#0A2540;border-radius:12px 12px 0 0;padding:24px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">AIESEC <span style="color:#037EF3;">in Alexandria</span></span>
            <span style="float:right;color:#93a5bc;font-size:12px;padding-top:6px;">ICX CRM</span>
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff;padding:32px;border-radius:0 0 12px 12px;color:#0A2540;font-size:15px;line-height:1.6;">
            ${opts.body}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;color:#5c6b80;font-size:12px;text-align:center;">
            Sent automatically by the AIESEC in Alexandria CRM ·
            <a href="${env.appUrl}" style="color:#037EF3;text-decoration:none;">Open the CRM</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>
    <td style="background-color:#037EF3;border-radius:8px;">
      <a href="${url}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-weight:bold;text-decoration:none;font-size:14px;">${label}</a>
    </td></tr></table>`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 12px;background:#f0f4f9;font-weight:bold;white-space:nowrap;border-bottom:2px solid #ffffff;">${label}</td>
    <td style="padding:8px 12px;background:#f7f9fc;border-bottom:2px solid #ffffff;">${escapeHtml(value)}</td>
  </tr>`;
}

export function detailsTable(rows: [string, string | null | undefined][]): string {
  const filled = rows.filter(([, v]) => v != null && v !== "");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-radius:8px;overflow:hidden;margin:16px 0;">
    ${filled.map(([l, v]) => row(l, v as string)).join("")}
  </table>`;
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ------------------------------------------------------------------ templates

export function welcomeEmail(member: {
  name: string;
  nickname: string | null;
  role: string;
  functions?: string[] | null;
}) {
  const first = member.nickname || member.name.split(" ")[0];
  return {
    subject: "Welcome to the AIESEC in Alexandria CRM 🎉",
    html: emailLayout({
      preheader: "Your CRM access is ready",
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;color:#0A2540;">Welcome aboard, ${escapeHtml(first)}!</h1>
        <p>Your account on the <b>AIESEC in Alexandria CRM</b> is active. This is where your
        accounts, contacts, visits and pipeline live from now on.</p>
        ${detailsTable([
          ["Role", member.role],
          ["Function", member.functions?.join(", ") || "—"],
        ])}
        <p style="margin-bottom:0;">A few ground rules the CRM will help you keep:</p>
        <ul style="margin-top:8px;">
          <li>Log <b>every contact attempt</b> from the account's Contact button.</li>
          <li>After a first contact without a visit, always set a <b>next step with a date</b>.</li>
          <li>Visits you schedule land on your <b>Google Calendar</b> with reminders 24h and 1h before.</li>
        </ul>
        ${button("Open the CRM", env.appUrl)}
        <p style="color:#5c6b80;font-size:13px;">Spotted a bug or have an idea? Open <b>Feedback</b> in the CRM sidebar — your feedback builds this system for you.</p>`,
    }),
  };
}

export function visitReportEmail(opts: {
  memberName: string;
  accountName: string;
  visitDate: string;
  visitTime: string;
  done: boolean;
  visitComment: string | null;
  nextStep: string | null;
  accountUrl: string;
}) {
  return {
    subject: `${opts.done ? "✅ Visit done" : "⚠️ Visit not completed"} — ${opts.accountName} (${opts.memberName})`,
    html: emailLayout({
      preheader: `${opts.memberName} reported the visit to ${opts.accountName}`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Visit report from ${escapeHtml(opts.memberName)}</h1>
        ${detailsTable([
          ["Account", opts.accountName],
          ["Visit date", `${opts.visitDate} ${opts.visitTime.slice(0, 5)}`],
          ["Completed", opts.done ? "Yes" : "No"],
          ["Visit comment", opts.visitComment],
          ["Next step", opts.nextStep],
        ])}
        ${button("Open the account", opts.accountUrl)}`,
    }),
  };
}

export function visitFollowupEmail(opts: {
  memberFirstName: string;
  accountName: string;
  visitDate: string;
  visitTime: string;
  reportUrl: string;
}) {
  return {
    subject: `How did the visit to ${opts.accountName} go?`,
    html: emailLayout({
      preheader: "2-minute visit report",
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Hey ${escapeHtml(opts.memberFirstName)} 👋</h1>
        <p>Your visit to <b>${escapeHtml(opts.accountName)}</b> was scheduled for
        <b>${opts.visitDate} at ${opts.visitTime.slice(0, 5)}</b>. Was it completed?</p>
        <p>Report it now — it takes less than 2 minutes, and your TL & VP get notified automatically.</p>
        ${button("Report the visit", opts.reportUrl)}
        <p style="color:#5c6b80;font-size:13px;">Didn't happen? Report it as not completed and set the next step so the account keeps moving.</p>`,
    }),
  };
}

export function feedbackEmail(opts: {
  memberName: string;
  memberEmail: string;
  type: string;
  message: string;
  inboxUrl: string;
}) {
  const icon = opts.type === "Bug" ? "🐞" : opts.type === "Enhancement" ? "✨" : "💬";
  return {
    subject: `${icon} CRM feedback (${opts.type}) — ${opts.memberName}`,
    html: emailLayout({
      preheader: `${opts.memberName}: ${opts.message.slice(0, 80)}`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">New feedback from ${escapeHtml(opts.memberName)}</h1>
        ${detailsTable([
          ["Type", `${icon} ${opts.type}`],
          ["From", `${opts.memberName} <${opts.memberEmail}>`],
        ])}
        <p style="white-space:pre-wrap;background:#f7f9fc;border-radius:8px;padding:14px;">${escapeHtml(opts.message)}</p>
        ${button("Open the feedback inbox", opts.inboxUrl)}`,
    }),
  };
}
