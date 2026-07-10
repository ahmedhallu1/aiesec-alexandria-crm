import { env } from "@/lib/env";
import { ROLE_BLURBS } from "@/lib/types";

/** AIESEC-branded transactional email layout.
 *  Blue #0A2540, Cyan #037EF3 — table-based so it renders everywhere. */
export function emailLayout(opts: { preheader?: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background-color:#eef3fa;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  ${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${opts.preheader}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3fa;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background-color:#0A2540;background-image:linear-gradient(135deg,#0A2540 0%,#0d3a6e 60%,#037EF3 140%);border-radius:16px 16px 0 0;padding:26px 32px;">
            <span style="color:#ffffff;font-size:21px;font-weight:800;letter-spacing:0.5px;">AIESEC <span style="color:#5db4ff;">in Alexandria</span></span>
            <span style="float:right;color:#9db8d4;font-size:12px;padding-top:8px;letter-spacing:1px;">ICX&nbsp;CRM</span>
          </td>
        </tr>
        <tr>
          <td style="height:4px;background-image:linear-gradient(90deg,#037EF3,#0CB9C1 45%,#F48924 75%,#F85A40);font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="background-color:#ffffff;padding:32px;border-radius:0 0 16px 16px;color:#0A2540;font-size:15px;line-height:1.65;">
            ${opts.body}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;color:#5c6b80;font-size:12px;text-align:center;line-height:1.7;">
            Sent automatically by the AIESEC in Alexandria CRM ·
            <a href="${env.appUrl}" style="color:#037EF3;text-decoration:none;font-weight:bold;">Open the CRM</a><br>
            <span style="color:#93a5bc;">This system is built for you — reply with feedback anytime. 💙</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>
    <td style="background-color:#037EF3;background-image:linear-gradient(135deg,#037EF3,#0a66d0);border-radius:10px;">
      <a href="${url}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-weight:bold;text-decoration:none;font-size:14px;letter-spacing:0.3px;">${label} →</a>
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
        <p style="border-left:4px solid #037EF3;background:#f0f7ff;border-radius:0 8px 8px 0;padding:12px 16px;font-weight:600;">
          ${escapeHtml(ROLE_BLURBS[member.role] ?? ROLE_BLURBS.Member)}
        </p>
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

export function passwordResetRequestEmail(opts: {
  memberName: string;
  memberEmail: string;
}) {
  return {
    subject: `🔑 Password reset request — ${opts.memberName}`,
    html: emailLayout({
      preheader: `${opts.memberName} forgot their CRM password`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Password reset request</h1>
        <p><b>${escapeHtml(opts.memberName)}</b> (${escapeHtml(opts.memberEmail)})
        forgot their CRM password and asked for a reset.</p>
        <p>Open <b>Membership</b> → edit the member → <b>Reset password</b>. Their next
        sign-in will accept any password and walk them through setting a new one.</p>
        ${button("Open Membership", `${env.appUrl}/membership`)}`,
    }),
  };
}

/** Announcement for members whose module just went live (sent on demand). */
export function moduleReadyEmail(opts: {
  memberFirstName: string;
  role: string;
  functions: string[];
  appUrl: string;
}) {
  return {
    subject: "🚀 Your CRM workspace is ready",
    html: emailLayout({
      preheader: "Your module is live — here's how to start",
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;color:#0A2540;">It's live, ${escapeHtml(opts.memberFirstName)}! 🎉</h1>
        <p>Your <b>${escapeHtml(opts.functions.join(" & ") || "AIESEC")}</b> workspace on the
        <b>AIESEC in Alexandria CRM</b> is ready to use.</p>
        <ul style="margin-top:8px;">
          <li><b>Sign in</b> with your AIESEC email — first time, any password works, then you set your own.</li>
          <li><b>Add your accounts</b> (or import a whole sheet of market research).</li>
          <li><b>Log every contact</b> — the CRM keeps next steps, visits and reminders on track for you.</li>
          <li><b>Watch the dashboard</b> — your team's goal and the leaderboard live there.</li>
        </ul>
        ${button("Open your workspace", opts.appUrl)}
        <p style="color:#5c6b80;font-size:13px;">Questions or ideas? The Feedback page inside the CRM goes straight to the IM team.</p>`,
    }),
  };
}
