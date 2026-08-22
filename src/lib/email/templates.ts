import { env } from "@/lib/env";
import { fmtClock12, ROLE_BLURBS } from "@/lib/types";

/** THE HOUSE EMAIL (v33.24 rebuild).
 *
 *  Every email Sodio sends is the LC talking to its own people, so it should
 *  look like the LC — the REAL logo, not a text imitation of it, the AIESEC
 *  colour bar, and a body with room to breathe. The old layout drew the
 *  wordmark with a `<span>` and a `float:right` label, which renders
 *  differently in every client and looked typed rather than designed.
 *
 *  Table-based and inline-styled on purpose: Outlook, Gmail's clipper and the
 *  iOS Mail dark-mode transform all break anything cleverer. The logo is the
 *  white mark on the navy header, served from the public /brand folder (which
 *  the proxy exempts), so it loads for anyone — no auth, no CID attachment.
 */
/** WHO IS TALKING DECIDES WHICH MARK GOES ON TOP.
 *  An INTERNAL email is Sodio talking to the LC's own people, so it wears the
 *  Sodio lockup. An EXTERNAL one — an IR abroad booking a call — is AIESEC in
 *  Alexandria talking to a stranger who has never heard of Sodio, so it keeps
 *  the LC's own logo and never mentions the CRM at all. */
const SODIO_LOCKUP = `${env.appUrl}/brand/sodio-email-lockup.png`;
const ALEX_LOGO = `${env.appUrl}/brand/alex-white.png`;

/** The banded header both layouts share. */
function emailHeader(opts: { external?: boolean } = {}): string {
  const external = opts.external === true;
  return `
        <tr>
          <td style="background-color:#0A2540;background-image:linear-gradient(135deg,#0A2540 0%,#1c2f5c 55%,#7552CC 150%);border-radius:16px 16px 0 0;padding:28px 32px 24px;" align="center">
            <img src="${external ? ALEX_LOGO : SODIO_LOCKUP}" width="${external ? 230 : 240}"
                 alt="${external ? "AIESEC in Alexandria" : "Sodio — AIESEC in Alexandria"}"
                 style="display:block;width:${external ? 230 : 240}px;max-width:72%;height:auto;border:0;outline:none;text-decoration:none;">
          </td>
        </tr>
        <tr>
          <td style="height:5px;background-image:linear-gradient(90deg,#037EF3,#7552CC);font-size:0;line-height:0;">&nbsp;</td>
        </tr>`;
}

function shell(opts: { preheader?: string; header: string; body: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#eef0f4;font-family:Karla,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  ${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef0f4;padding:30px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-collapse:separate;">
        ${opts.header}
        <tr>
          <td style="background-color:#ffffff;padding:34px 34px 30px;border-radius:0 0 16px 16px;color:#0A2540;font-size:15px;line-height:1.7;">
            ${opts.body}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px 4px;color:#52565E;font-size:12px;text-align:center;line-height:1.7;">
            ${opts.footer}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The layout for everyone INSIDE the LC. */
export function emailLayout(opts: { preheader?: string; body: string }): string {
  return shell({
    preheader: opts.preheader,
    header: emailHeader(),
    body: opts.body,
    footer: `Sent automatically by Sodio · AIESEC in Alexandria ·
            <a href="${env.appUrl}" style="color:#5B3BA8;text-decoration:none;font-weight:bold;">Open the CRM</a><br>
            <span style="color:#93a5bc;">This system is built for you — reply with feedback anytime. 💙</span>`,
  });
}

/** The layout for emails that leave the LC — IRs abroad booking calls (v29).
 *  They are not Sodio users: never mention the CRM, never link into it. */
export function externalEmailLayout(opts: { preheader?: string; body: string }): string {
  return shell({
    preheader: opts.preheader,
    header: emailHeader({ external: true }),
    body: opts.body,
    footer: `AIESEC in Alexandria · Egypt<br>
            <span style="color:#93a5bc;">The international platform for young people to explore and develop their potential.</span>`,
  });
}

export function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
    <td style="background-color:#7552CC;background-image:linear-gradient(135deg,#7552CC,#5B3BA8);border-radius:10px;box-shadow:0 2px 6px rgba(117,82,204,0.30);">
      <a href="${url}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-weight:bold;text-decoration:none;font-size:14px;letter-spacing:0.3px;">${label} →</a>
    </td></tr></table>`;
}

function row(label: string, value: string, rawHtml = false): string {
  return `<tr>
    <td style="padding:10px 14px;background:#EDF1F6;font-weight:600;color:#0A2540;white-space:nowrap;border-bottom:2px solid #ffffff;vertical-align:top;">${label}</td>
    <td style="padding:10px 14px;background:#F7F8FA;border-bottom:2px solid #ffffff;color:#0A2540;">${rawHtml ? value : escapeHtml(value)}</td>
  </tr>`;
}

/** `html: true` means the CALLER has already escaped every piece of the value
 *  and is supplying markup on purpose (v33.54 — the period report's small
 *  "vs last sprint" line under each number). */
export function detailsTable(
  rows: [string, string | null | undefined][],
  opts: { html?: boolean } = {}
): string {
  const filled = rows.filter(([, v]) => v != null && v !== "");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-radius:10px;overflow:hidden;margin:18px 0;border:1px solid #DDE5EE;">
    ${filled.map(([l, v]) => row(l, v as string, opts.html)).join("")}
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
  role: string;
  functions?: string[] | null;
  sub_functions?: string[] | null;
}) {
  const first = member.name.split(" ")[0];

  // module detection — mirrors the rbac.ts viewer predicates closely enough
  // for copy (the member row has no Viewer wrapper here)
  const fns = member.functions ?? [];
  const subs = member.sub_functions ?? [];
  const all = [...fns, ...subs];
  const fnLead = member.role === "LCVP" || member.role === "Director";
  const raising =
    member.role === "LCP" ||
    all.some((f) => f === "B2B" || f === "BD" || f === "B2C") ||
    (fns.some((f) => f === "IGV" || f === "IGT") &&
      (fnLead || subs.some((s) => s === "Raising" || s === "ICX")));
  const ogx = all.includes("OGT") || all.includes("OGV");
  const consideration = all.includes("Consideration");
  const tm = all.includes("TM");

  // ONE primary workspace names the email (same priority as the home routing)
  const workspace = raising
    ? {
        intro: `This is where your <b>accounts, contacts, visits and pipeline</b> live from now on.`,
        blurb: ROLE_BLURBS[member.role] ?? ROLE_BLURBS.Member,
        rules: [
          `Log <b>every contact attempt</b> from the account's Contact button.`,
          `After a first contact without a visit, always set a <b>next step with a date</b>.`,
          `Visits you schedule land on your <b>Google Calendar</b> with reminders 24h and 1h before.`,
        ],
      }
    : ogx
      ? {
          intro: `This is where your <b>sign-ups</b> live from now on — the Sign-ups tab is your workspace, two-way synced with the tracker sheet.`,
          blurb: "Your OGX workspace is ready — the sign-ups pool, the funnel, and Approved as the finish line.",
          rules: [
            `Contact a sign-up from the <b>Unassigned</b> pool and hit <b>Claim</b> — it's yours.`,
            `Mark <b>Contacted</b> and <b>Interested</b> and log comments — everything writes back to the sheet.`,
            `<b>Approved</b> is the goal — keep every claimed sign-up moving down the funnel.`,
          ],
        }
      : consideration
        ? {
            intro: `This is where your <b>IR calls</b> live from now on — the Consideration tab is your workspace.`,
            blurb: "Your Consideration workspace is ready — IR calls with partner LCs and your personal booking link.",
            rules: [
              `Set your <b>availability + slot length</b> on the "My booking link" card and share your link with IRs abroad.`,
              `Booked calls land on your <b>Google Calendar</b> automatically, with a bell + email.`,
              `Saving a call's <b>notes</b> (demand, campaigns, screenshot) completes it.`,
            ],
          }
        : tm
          ? {
              intro: `The <b>Members</b> tab is your workspace — the whole LC's directory in one place.`,
              blurb: "Your Talent Management workspace is ready — the whole LC's directory, KPIs and contact shortcuts.",
              rules: [
                `Every member's <b>info, team and manager</b> at a glance.`,
                `Per-member <b>KPIs and MOS</b>, live from the pipelines.`,
                `One-tap <b>email / call / WhatsApp</b> shortcuts on every row.`,
              ],
            }
          : {
              intro: `Your function's workspace is <b>on the way</b> — your Profile, the Playbook and Feedback are already live, and you'll get an email the moment your module opens.`,
              blurb: "Welcome aboard — your workspace is being built on the same engine the live modules run on.",
              rules: [
                `Complete your <b>profile</b> on first sign-in.`,
                `Skim the <b>Playbook</b> — it's the manual for the whole system.`,
                `Ideas? The <b>Feedback</b> card on your Profile goes straight to the IM team.`,
              ],
            };

  return {
    subject: "Welcome to Sodio 🎉",
    html: emailLayout({
      preheader: "Your CRM access is ready",
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;color:#0A2540;">Welcome aboard, ${escapeHtml(first)}!</h1>
        <p>Your account on <b>Sodio</b> — the CRM of AIESEC in Alexandria — is active. ${workspace.intro}</p>
        <p style="border-left:4px solid #7552CC;background:#EFEAFA;border-radius:0 8px 8px 0;padding:12px 16px;font-weight:600;">
          ${escapeHtml(workspace.blurb)}
        </p>
        ${detailsTable([
          ["Role", member.role],
          ["Function", member.functions?.join(", ") || "—"],
        ])}
        <p style="margin-bottom:0;">A few ground rules the CRM will help you keep:</p>
        <ul style="margin-top:8px;">
          ${workspace.rules.map((r) => `<li>${r}</li>`).join("\n          ")}
        </ul>
        ${button("Open the CRM", env.appUrl)}
        <p style="color:#5c6b80;font-size:13px;">Spotted a bug or have an idea? Open the <b>Feedback</b> card on your Profile — your feedback builds this system for you.</p>`,
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
          ["Visit date", `${opts.visitDate} ${fmtClock12(opts.visitTime)}`],
          ["Completed", opts.done ? "Yes" : "No"],
          ["Visit comment", opts.visitComment],
          ["Next step", opts.nextStep],
        ])}
        ${button("Open the account", opts.accountUrl)}`,
    }),
  };
}

/** The +2h "was it completed?" prompt. Goes to the responsible member AND
 *  their team leader (when the responsible is a Member/Coordinator) so the
 *  team stays accountable together; leaders get it for themselves only. */
export function visitFollowupEmail(opts: {
  memberFirstName: string;
  responsibleName: string;
  accountName: string;
  visitDate: string;
  visitTime: string;
  nextStep: string | null;
  leaderName: string | null;
  reportUrl: string;
}) {
  return {
    subject: `How did the visit to ${opts.accountName} go?`,
    html: emailLayout({
      preheader: "2-minute visit report",
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Hey ${escapeHtml(opts.memberFirstName)} 👋</h1>
        <p>This visit was scheduled — was it completed?</p>
        ${detailsTable([
          ["Account", opts.accountName],
          ["When", `${opts.visitDate} at ${fmtClock12(opts.visitTime)}`],
          ["Responsible", opts.responsibleName],
          ["Planned next step", opts.nextStep],
        ])}
        <p>Report it now — it takes less than 2 minutes, and your TL & VP get notified automatically.</p>
        ${button("Report the visit", opts.reportUrl)}
        <p style="color:#5c6b80;font-size:13px;">Didn't happen? Report it as not completed and set the next step so the account keeps moving.${
          opts.leaderName ? ` ${escapeHtml(opts.leaderName)} is on this email too, so you're covered as a team.` : ""
        }</p>`,
    }),
  };
}

/** One week after the follow-up prompt with still no report: a firmer nudge to
 *  the same people — log the result, or archive the account if the company
 *  isn't interested, so no resources sit wasted. */
export function visitForgottenEmail(opts: {
  memberFirstName: string;
  responsibleName: string;
  accountName: string;
  visitDate: string;
  visitTime: string;
  leaderName: string | null;
  reportUrl: string;
}) {
  return {
    subject: `⏰ Still no report on ${opts.accountName} — don't let it slip`,
    html: emailLayout({
      preheader: "A visit from last week was never reported",
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">${escapeHtml(opts.memberFirstName)}, this one got forgotten 👀</h1>
        <p>A week ago we asked how the visit to <b>${escapeHtml(opts.accountName)}</b> went —
        it's still unreported, and the account is frozen in the pipeline in the meantime.</p>
        ${detailsTable([
          ["Account", opts.accountName],
          ["Visit was", `${opts.visitDate} at ${fmtClock12(opts.visitTime)}`],
          ["Responsible", opts.responsibleName],
          ["Waiting since", "1 week+"],
        ])}
        <p style="margin-bottom:6px;"><b>Two minutes now keeps us organized:</b></p>
        <ul style="margin-top:0;">
          <li><b>Visit happened?</b> Report the result and set the next step.</li>
          <li><b>Company not interested?</b> Mark the account <b>Out of Process</b> — no shame in it, it frees your time for accounts that will close.</li>
        </ul>
        ${button("Open the account & report", opts.reportUrl)}
        <p style="color:#5c6b80;font-size:13px;">Unreported visits waste the LC's resources — this is the last automatic reminder for this visit.${
          opts.leaderName ? ` ${escapeHtml(opts.leaderName)} is on this email too.` : ""
        }</p>`,
    }),
  };
}

/** Function-wide "a visit was booked" announcement — fans out to everyone in
 *  the product's raising crew + B2B (so the whole function sees the momentum).
 *  Purely informational; the responsible + their leaders get the calendar
 *  invite separately. */
/** The calendar INVITE email (carries the .ics) sent to the responsible + the
 *  leaders it's shared with. Their mail client adds the event + reminders. */
export function visitInviteEmail(opts: {
  accountName: string;
  visitDate: string;
  visitTime: string;
  notes: string | null;
  sharedWith: string[];
  accountUrl: string;
}) {
  return {
    subject: `🗓️ Visit invite — ${opts.accountName} (${opts.visitDate} ${fmtClock12(opts.visitTime)})`,
    html: emailLayout({
      preheader: `Calendar invite for your visit to ${opts.accountName}`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Your visit is on the calendar 🗓️</h1>
        <p>Accept the attached invite and it lands on your calendar with reminders
        <b>24 hours</b> and <b>1 hour</b> before.</p>
        ${detailsTable([
          ["Account", opts.accountName],
          ["When", `${opts.visitDate} at ${fmtClock12(opts.visitTime)}`],
          ["Notes", opts.notes],
          ["Shared with", opts.sharedWith.length ? opts.sharedWith.join(", ") : "just you"],
        ])}
        <p style="color:#5c6b80;font-size:13px;">Your Team Leader and VP are on this invite too, so everyone's in sync.</p>
        ${button("Open the account", opts.accountUrl)}`,
    }),
  };
}

export function visitAnnouncementEmail(opts: {
  responsibleName: string;
  accountName: string;
  product: string;
  visitDate: string;
  visitTime: string;
  notes: string | null;
  accountUrl: string;
  /** the visit already existed and was MOVED (v33.23) — the crew was told
   *  about it once already, so this must not read as a fresh booking */
  moved?: boolean;
}) {
  return {
    subject: opts.moved
      ? `🗓️ Visit moved — ${opts.accountName} (${opts.product})`
      : `📢 New visit booked — ${opts.accountName} (${opts.product})`,
    html: emailLayout({
      preheader: opts.moved
        ? `${opts.responsibleName} moved the visit with ${opts.accountName}`
        : `${opts.responsibleName} booked a visit with ${opts.accountName}`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">${
          opts.moved ? "A visit was moved 🗓️" : "A visit just got booked! 🗓️"
        }</h1>
        <p><b>${escapeHtml(opts.responsibleName)}</b> ${
          opts.moved
            ? "rescheduled a company visit — the new time is below."
            : "scheduled a company visit — sharing it with the function to keep everyone in the loop."
        }</p>
        ${detailsTable([
          ["Account", opts.accountName],
          ["Product", opts.product],
          ["Responsible", opts.responsibleName],
          ["When", `${opts.visitDate} at ${fmtClock12(opts.visitTime)}`],
          ["Notes", opts.notes],
        ])}
        <p style="color:#5c6b80;font-size:13px;">You're getting this because you're part of this
        account's own raising function. It's an FYI — no action needed.</p>
        ${button("Open the account", opts.accountUrl)}`,
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

/** "Forgot password": the fresh password lands straight in the member's inbox. */
export function newPasswordEmail(opts: {
  memberFirstName: string;
  password: string;
}) {
  return {
    subject: "🔑 Your new Sodio password",
    html: emailLayout({
      preheader: "Sign in with this password — you can change it anytime",
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Here you go, ${escapeHtml(opts.memberFirstName)} 🔑</h1>
        <p>You asked for a new Sodio password. Use this one to sign in:</p>
        <p style="margin:20px 0;text-align:center;">
          <span style="display:inline-block;background:#EFEAFA;border:2px dashed #7552CC;border-radius:12px;padding:14px 26px;font-family:Consolas,Menlo,monospace;font-size:20px;font-weight:bold;letter-spacing:1px;color:#0A2540;">${escapeHtml(opts.password)}</span>
        </p>
        <p>Your old password (if you had one) still works too — nothing breaks
        until <i>you</i> change it. You can set a password you'll remember from
        <b>Profile → Change password</b>.</p>
        ${button("Sign in to Sodio", `${env.appUrl}/login`)}
        <p style="color:#5c6b80;font-size:13px;">Didn't request this? You can ignore it — your old password keeps working.</p>`,
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
        <b>Sodio</b> is ready to use.</p>
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

export function feedbackThanksEmail(opts: {
  memberFirstName: string;
  feedbackSnippet: string;
}) {
  return {
    subject: "Your feedback just made Sodio better 💙",
    html: emailLayout({
      preheader: "Thank you from the IM team",
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;color:#0A2540;">Thank you, ${escapeHtml(opts.memberFirstName)}! 🎉</h1>
        <p>Your feedback was heard, taken seriously, and <b>applied</b>:</p>
        <p style="border-left:4px solid #7552CC;background:#EFEAFA;border-radius:0 8px 8px 0;padding:12px 16px;font-style:italic;">
          "${escapeHtml(opts.feedbackSnippet)}"
        </p>
        <p>Sodio is built for you, by you — keep it coming. 💙</p>
        ${button("Open Sodio", env.appUrl)}`,
    }),
  };
}

// (v22) goalPeriodEndedEmail + newGoalEmail removed — goals now come from
// the planning sheet and the TLs' filed plans; nothing is set in-app.

/** B2C (v23): the account's Podio-refresh date arrived — sent to the
 *  responsible MM and the B2C VP/Director, once per cycle. */
/** ONE EMAIL, EVERY ACCOUNT THAT IS DUE (v34.1).
 *
 *  This used to send one email PER ACCOUNT, to the responsible AND every
 *  VP/Director of the function. A member holding twenty due accounts got
 *  twenty emails on the same morning, and the leaders got everyone's — which
 *  is how a reminder becomes a filter rule. Now it is a digest, and it goes to
 *  the person who can actually act on it: the owner.
 *
 *  Accounts arrive in two groups because they are two different asks — "this
 *  is due" and "we said this a week ago". */
export interface PodioDueAccount {
  name: string;
  fn: string;
  url: string;
  /** 0 = due today; >0 = this many days late */
  daysOverdue: number;
  everyDays: number;
}

export function podioUpdateDigestEmail(opts: {
  firstName: string;
  /** first reminder of this cycle */
  due: PodioDueAccount[];
  /** reminded a week ago, still pending */
  stillPending: PodioDueAccount[];
  accountsUrl: string;
}) {
  const total = opts.due.length + opts.stillPending.length;
  const n = (arr: PodioDueAccount[]) => arr.length;
  const worst = Math.max(0, ...[...opts.due, ...opts.stillPending].map((a) => a.daysOverdue));

  // gridTable escapes every cell, and each row here carries a real link — so
  // this builds its own rows, escaping the NAME and nothing else.
  const list = (rows: PodioDueAccount[]) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="font-size:14px;border-radius:10px;overflow:hidden;margin:14px 0;border:1px solid #DDE5EE;">
      ${rows
        .map(
          (a, i) => `<tr>
        <td style="padding:10px 14px;background:${i % 2 ? "#F7F8FA" : "#ffffff"};border-bottom:1px solid #EDF1F6;">
          <a href="${a.url}" style="color:#5B3BA8;font-weight:700;text-decoration:none;">${escapeHtml(a.name)}</a>
          <div style="color:#52565E;font-size:12px;">${escapeHtml(a.fn)} · every ${a.everyDays} days</div>
        </td>
        <td style="padding:10px 14px;background:${i % 2 ? "#F7F8FA" : "#ffffff"};border-bottom:1px solid #EDF1F6;text-align:right;white-space:nowrap;color:${a.daysOverdue > 0 ? "#A82A18" : "#52565E"};font-weight:600;">
          ${a.daysOverdue > 0 ? `${a.daysOverdue} day${a.daysOverdue === 1 ? "" : "s"} late` : "due today"}
        </td>
      </tr>`
        )
        .join("")}
    </table>`;

  const subject =
    n(opts.stillPending) > 0
      ? `⏰ ${total} account${total === 1 ? "" : "s"} still waiting for a Podio update`
      : worst > 0
        ? `🔄 ${total} account${total === 1 ? "" : "s"} due on Podio — ${worst} day${worst === 1 ? "" : "s"} late`
        : `🔄 ${total} account${total === 1 ? "" : "s"} due for a Podio update`;

  return {
    subject,
    html: emailLayout({
      preheader: `${total} of your account${total === 1 ? "" : "s"} need refreshing on Podio`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Podio refresh — ${total} account${total === 1 ? "" : "s"} 🔄</h1>
        <p>Hey ${escapeHtml(opts.firstName)} — these are yours, and they are due a refresh on
        Podio. Update each one there, then hit <b>"Updated on Podio"</b> on the account:
        that resets its countdown and stops the reminder.</p>
        ${
          n(opts.stillPending) > 0
            ? `<p style="border-left:4px solid #7552CC;background:#EFEAFA;border-radius:0 8px 8px 0;padding:12px 16px;font-weight:600;">
                 ⏰ ${n(opts.stillPending)} of these were already flagged a week ago and are still pending.
               </p>${list(opts.stillPending)}`
            : ""
        }
        ${n(opts.due) > 0 ? (n(opts.stillPending) > 0 ? `<p style="margin:22px 0 4px;font-size:13px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:#5B3BA8;">Also due now</p>` : "") + list(opts.due) : ""}
        ${button("Open my accounts", opts.accountsUrl)}
        <p style="color:#52565E;font-size:13px;">One email a day, however many accounts are due —
        never one per account.</p>`,
    }),
  };
}

export function accountsAssignedEmail(opts: {
  memberName: string;
  managerName: string;
  accountNames: string[];
  accountsUrl: string;
}) {
  const n = opts.accountNames.length;
  const listed = opts.accountNames.slice(0, 15);
  const more = n - listed.length;
  return {
    subject: `📋 ${opts.managerName} assigned you ${n} account${n === 1 ? "" : "s"}`,
    html: emailLayout({
      preheader: `${n} account${n === 1 ? "" : "s"} just landed on your plate — open Sodio and start raising`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Fresh accounts for you 📋</h1>
        <p>Hey ${escapeHtml(opts.memberName)} — <b>${escapeHtml(opts.managerName)}</b> just made you
        the <b>Responsible</b> of ${n === 1 ? "an account" : `${n} accounts`}. They're yours now:
        contacts, visits, deals and the leaderboard numbers all follow you.</p>
        <ul style="margin:12px 0;padding-left:20px;color:#334155;">
          ${listed.map((a) => `<li style="margin:2px 0;">${escapeHtml(a)}</li>`).join("")}
          ${more > 0 ? `<li style="margin:2px 0;color:#64748B;">…and ${more} more</li>` : ""}
        </ul>
        <p>Golden rule: every in-process account carries a next step with a date.
        Log the first contact and keep them moving 🚀</p>
        ${button("Open my accounts", opts.accountsUrl)}`,
    }),
  };
}

/** SIGN-UPS ARE NOT ACCOUNTS (v33.24).
 *
 *  A bulk sign-up hand-over used to borrow `accountsAssignedEmail`, so an OGX
 *  Team Leader was told she had been made "the Responsible of 20 accounts",
 *  with the raising golden rule and a button to "Open my accounts" — for rows
 *  that are EPs in a tracker sheet. Every module gets its own words. */
export function signupsAssignedEmail(opts: {
  memberName: string;
  managerName: string;
  signupNames: string[];
  signupsUrl: string;
}) {
  const n = opts.signupNames.length;
  const listed = opts.signupNames.slice(0, 15);
  const more = n - listed.length;
  return {
    subject: `🆕 ${opts.managerName} assigned you ${n} sign-up${n === 1 ? "" : "s"}`,
    html: emailLayout({
      preheader: `${n} sign-up${n === 1 ? "" : "s"} are yours now — reach out while they're warm`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">New sign-ups for you 🆕</h1>
        <p>Hey ${escapeHtml(opts.memberName)} — <b>${escapeHtml(opts.managerName)}</b> just handed you
        ${n === 1 ? "a sign-up" : `${n} sign-ups`}. They're on your <b>My sign-ups</b> list now:</p>
        <ul style="margin:12px 0;padding-left:20px;color:#334155;">
          ${listed.map((a) => `<li style="margin:2px 0;">${escapeHtml(a)}</li>`).join("")}
          ${more > 0 ? `<li style="margin:2px 0;color:#64748B;">…and ${more} more</li>` : ""}
        </ul>
        <p>Reach them, then mark <b>Contacted</b> and <b>Interested</b> and leave a
        comment — every edit writes straight back to the tracker sheet. Approved
        is the finish line 🏆</p>
        ${button("Open my sign-ups", opts.signupsUrl)}`,
    }),
  };
}

export function broadcastEmail(opts: {
  title: string;
  body: string;
  senderName: string;
}) {
  return {
    subject: `📣 ${opts.title}`,
    html: emailLayout({
      preheader: opts.body.slice(0, 90),
      body: `
        <h1 style="margin:0 0 16px;font-size:22px;color:#0A2540;">${escapeHtml(opts.title)}</h1>
        <p style="white-space:pre-wrap;">${escapeHtml(opts.body)}</p>
        <p style="color:#5c6b80;font-size:13px;">— ${escapeHtml(opts.senderName)}, via Sodio</p>
        ${button("Open Sodio", env.appUrl)}`,
    }),
  };
}

/** v21 — LC people feedback: a positive shout-out delivered to the member. */
export function lcShoutoutEmail(opts: {
  /** null when the same shout-out goes to SEVERAL people on BCC (v33.33) —
   *  one email instead of nine, so the greeting stops pretending to be
   *  personal rather than addressing nine people by one person's name */
  firstName: string | null;
  from: string;
  message: string;
}): { subject: string; html: string } {
  return {
    subject: `💙 ${opts.from} appreciated you!`,
    html: emailLayout({
      preheader: "Someone in the LC has something nice to say about you.",
      body: `
        <h2 style="margin:0 0 10px;">You got a shout-out${opts.firstName ? `, ${escapeHtml(opts.firstName)}` : ""}! 🎉</h2>
        <p style="margin:0 0 6px;color:#5c6b80;">From <b>${escapeHtml(opts.from)}</b>:</p>
        <p style="border-left:4px solid #7552CC;background:#EFEAFA;border-radius:0 8px 8px 0;padding:14px 16px;font-size:16px;font-style:italic;">
          “${escapeHtml(opts.message)}”
        </p>
        <p style="margin:16px 0 0;">Keep doing what you're doing — people notice. 💙</p>`,
    }),
  };
}

// ------------------------------------------------------------- period reports

/** Multi-column table for report waterfalls (detailsTable is 2-col only). */
export function gridTable(
  headers: string[],
  rows: (string | number)[][],
  opts: { boldRows?: number[]; indentCol0?: number[] } = {}
): string {
  const th = headers
    .map(
      (h, i) =>
        `<th style="padding:7px 9px;background:#0A2540;color:#ffffff;font-size:12px;text-align:${i === 0 ? "left" : "center"};white-space:nowrap;">${escapeHtml(h)}</th>`
    )
    .join("");
  const body = rows
    .map((r, ri) => {
      const bold = opts.boldRows?.includes(ri);
      const indent = opts.indentCol0?.includes(ri);
      return `<tr>${r
        .map((c, ci) => {
          const base = `padding:6px 9px;font-size:13px;border-bottom:1px solid #eef3fa;${ci === 0 ? `text-align:left;${indent ? "padding-left:24px;color:#5c6b80;" : ""}` : "text-align:center;"}`;
          const weight = bold ? "font-weight:bold;background:#EFEAFA;" : "";
          return `<td style="${base}${weight}">${escapeHtml(String(c))}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
  return `<div style="overflow-x:auto;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;margin:12px 0;border-collapse:collapse;">
    <tr>${th}</tr>${body}
  </table></div>`;
}

/** v21 — the per-function period report (sprint / month / quarter): function
 *  totals, plan-vs-achieved, then the waterfall (each team → each member). */
export function periodReportEmail(opts: {
  functionLabel: string;
  periodKind: "sprint" | "month" | "quarter";
  periodLabel: string;
  /** label · value · an optional comparison note, printed small under the
   *  value ("▲ 12 vs last sprint (31)") — v33.54 */
  kpis: [string, string, string?][];
  planLine?: string | null;
  waterfallHeaders: string[];
  waterfallRows: (string | number)[][];
  boldRows: number[];
  indentRows: number[];
  mmPlanLines?: string[];
  dashboardUrl: string;
}): { subject: string; html: string } {
  const kindLabel =
    opts.periodKind === "sprint" ? "Sprint report" : opts.periodKind === "month" ? "Monthly report" : "Quarter report";
  return {
    subject: `📊 ${opts.functionLabel} ${kindLabel} — ${opts.periodLabel}`,
    html: emailLayout({
      preheader: `${opts.functionLabel} numbers for ${opts.periodLabel} — totals + every member.`,
      body: `
        <h2 style="margin:0 0 4px;">${escapeHtml(opts.functionLabel)} · ${kindLabel}</h2>
        <p style="margin:0 0 14px;color:#5c6b80;">${escapeHtml(opts.periodLabel)}</p>
        ${opts.planLine ? `<p style="border-left:4px solid #7552CC;background:#EFEAFA;border-radius:0 8px 8px 0;padding:12px 16px;font-weight:600;">${escapeHtml(opts.planLine)}</p>` : ""}
        <p style="margin:18px 0 4px;font-size:13px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:#5B3BA8;">Function totals</p>
        ${detailsTable(
          opts.kpis.map(([l, v, note]) => [
            l,
            note
              ? `${escapeHtml(v)}<div style="font-size:11px;color:#7b8794;font-weight:500;margin-top:2px;">${escapeHtml(note)}</div>`
              : escapeHtml(v),
          ]) as [string, string][],
          { html: true }
        )}
        <p style="margin:22px 0 4px;font-size:13px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:#5B3BA8;">The waterfall — every team, every person</p>
        <p style="margin:0 0 6px;color:#5c6b80;font-size:13px;">Bold rows are team totals; the rows under them are that team's people.</p>
        ${gridTable(opts.waterfallHeaders, opts.waterfallRows, { boldRows: opts.boldRows, indentCol0: opts.indentRows })}
        ${
          opts.mmPlanLines && opts.mmPlanLines.length > 0
            ? `<p style="margin:22px 0 4px;font-size:13px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:#5B3BA8;">MM plans this period</p>
               <ul style="margin:6px 0;padding-left:20px;">${opts.mmPlanLines.map((l) => `<li style="margin:5px 0;">${escapeHtml(l)}</li>`).join("")}</ul>`
            : ""
        }
        ${button("Open the dashboard", opts.dashboardUrl)}
        <p style="margin:14px 0 0;color:#5c6b80;font-size:13px;">Numbers cover ${escapeHtml(opts.periodLabel)} only. Questions? Ask The Violet Man. 🔵</p>`,
    }),
  };
}

// ------------------------------------------------- OGT/OGV expectation setting

/** "Home Entity Expectation Setting Mail" — sent by an OGT/OGV VP to the
 *  HOSTING entity before approving an EP. Deliberately PLAIN professional
 *  HTML (no branded gradient layout — the recipient is an external AIESEC
 *  entity, not an LC member). Variant rule: OGT carries a "Salary (If any)"
 *  line and NO TN Fee; OGV carries "TN Fee and what it covers" and NO Salary.
 *  Everything else is the LC's official template wording — do not reword. */
export function ogtExpectationEmail(opts: {
  variant: "OGT" | "OGV";
  hostingEntity: string;
  epName: string;
  hostLcName: string;
  epId: string;
  oppId: string;
  oppName: string;
  /** already formatted for display, e.g. "Aug 5, 2026" */
  slotStartLabel: string;
  slotEndLabel: string;
  workingHours: string;
  /** rendered interval lines, e.g. "Mon, Tue: 09:00–17:00" */
  workingDayLines: string[];
  workingDaysNote?: string | null;
  /** OGT only — rendered as "Salary (If any)", empty → N/A */
  salary?: string | null;
  /** OGV only — rendered as "TN Fee and what it covers" */
  tnFee?: string | null;
  computerProvided: boolean;
  accommodationProvided: boolean;
  accommodationCovered: boolean;
  transportationProvided: boolean;
  /** required by the caller when transportation is NOT provided */
  transportationDetail?: string | null;
  accommodationType: "Hostel" | "Host Family" | "Private Apartment";
  /** required by the caller for Hostel / Private Apartment */
  accommodationTypeDetail?: string | null;
  mealsProvided: string;
  senderName: string;
  /** e.g. "Local Committee Vice President — Outgoing Global Talent, AIESEC in Alexandria" */
  senderPosition?: string | null;
  senderPhone?: string | null;
  senderEmail?: string | null;
}): { subject: string; html: string } {
  const yn = (v: boolean) => (v ? "yes" : "no");
  const li = (label: string, value: string) =>
    `<li style="margin:4px 0;"><b>${label}:</b> ${value}</li>`;

  const workingDays = [
    ...opts.workingDayLines.map((l) => escapeHtml(l)),
    ...(opts.workingDaysNote?.trim() ? [escapeHtml(opts.workingDaysNote.trim())] : []),
  ].join("<br>");

  const transportation =
    yn(opts.transportationProvided) +
    (!opts.transportationProvided && opts.transportationDetail?.trim()
      ? ` (daily cost, duration &amp; method: ${escapeHtml(opts.transportationDetail.trim())})`
      : "");

  const accommodationType =
    escapeHtml(opts.accommodationType) +
    ((opts.accommodationType === "Hostel" || opts.accommodationType === "Private Apartment") &&
    opts.accommodationTypeDetail?.trim()
      ? ` (${escapeHtml(opts.accommodationTypeDetail.trim())})`
      : "");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#111111;">
  <p>Dear AIESEC in ${escapeHtml(opts.hostingEntity)},</p>
  <p>I'm writing this mail to confirm with you that <b>${escapeHtml(opts.epName)}</b> will be approved on an opportunity with AIESEC in ${escapeHtml(opts.hostLcName)}. To deliver the full experience for our exchange participant and make sure that all the information are aligned and agreed between the two sides. We would like to get your confirmation on the following information:</p>
  <p><b>EP ID:</b> ${escapeHtml(opts.epId)}<br>
  <b>OPP ID:</b> ${escapeHtml(opts.oppId)}</p>
  <p><b>Opportunity Information:</b></p>
  <ul style="margin:0 0 14px;padding-left:22px;">
    ${li("Opportunity Name", escapeHtml(opts.oppName))}
    ${li("Slot Start Date", escapeHtml(opts.slotStartLabel))}
    ${li("Slot End Date", escapeHtml(opts.slotEndLabel))}
    ${li("Working Hours", escapeHtml(opts.workingHours))}
    ${li("Working Days (Highlight if any of them is on weekend)", `<br>${workingDays}`)}
    ${
      opts.variant === "OGT"
        ? li("Salary (If any)", escapeHtml(opts.salary?.trim() || "N/A"))
        : li("TN Fee and what it covers", escapeHtml(opts.tnFee?.trim() || ""))
    }
  </ul>
  <p><b>Logistics:</b></p>
  <ul style="margin:0 0 14px;padding-left:22px;">
    ${li("Computer provided", yn(opts.computerProvided))}
    ${li("Accommodation provided", yn(opts.accommodationProvided))}
    ${li("Accommodation covered", yn(opts.accommodationCovered))}
    ${li("Transportation provided", transportation)}
    ${li("Accommodation Type", accommodationType)}
    ${li("Meals Provided", escapeHtml(opts.mealsProvided))}
  </ul>
  <p><b>Documents / Information required before approval:</b><br>
  1. Accommodation Pictures (If the accommodation isn't available at the time of approval, please submit an example of the accommodation (bedroom, bathroom, utilities such as kitchen if any) to specify its level and state clearly that the accommodation will be as minimum as the pictures attached)<br>
  2. COVID restrictions</p>
  <p><b>Documents / Information required after approval</b><br>
  1. Visa booklet/Information: follow to assist in the visa process<br>
  2. Invitation letter within 2 weeks: essential to apply for the visa (If an original letter is required, HE shall specify a DDL to send the letter specifying the shipping method and shipping fees liability considering that the EP will have enough time to apply and get the VISA when the letter arrive to the SE)<br>
  3. If any delay happens in the VISA process or unexpected circumstance and the EP will postpone his/her realization for a few days, please specify the number of days allowed.</p>
  <p><b>Notes:</b><br>
  1- In Case of an EP Girl, we request by default that the Accommodation provided to not have any Adult males by anyway, either it's a host family (With Females only), dorms or an apartment or any other accommodation (For Females)<br>
  2- Any communication between you as Hosting Entity and the EP must include us as Sending Entity or it will not be taken into consideration or else it'll be invalid.<br>
  3- Any confirmation needed from the EP for any change either by making the EP send a standalone mail or reply with confirmation on a mail must have our confirmation as Sending Entity as well or it will not be considered<br>
  4- We are considering the single bed standard as a mandatory (it should be a bed not a couch or any other options), and any change in the accommodation should be prior aligned with the EP and Sending LC and by maximum one change if accepted from both sides..</p>
  <p>Please "Reply All" to this mail by confirming the above information. If your mail signature doesn't have your full name, position and LC Name, please write them in your reply.</p>
  <p style="margin-top:22px;">Best regards,<br>
  <b>${escapeHtml(opts.senderName)}</b><br>
  ${escapeHtml(opts.senderPosition?.trim() || "AIESEC in Alexandria")}${
    opts.senderPhone?.trim() ? `<br>\n  ${escapeHtml(opts.senderPhone.trim())}` : ""
  }${opts.senderEmail?.trim() ? `<br>\n  ${escapeHtml(opts.senderEmail.trim())}` : ""}</p>
</div>`;

  return {
    // the LC's standard subject (editable in the review step)
    subject: "Home Entity Expectation Setting Mail",
    html,
  };
}

// ------------------------------------------------- IR-call booking (v27)

/** Sent to the booking link's OWNER the moment an IR abroad books a slot on
 *  /book/<slug> — who booked, which LC, when (Cairo), jump to /consideration. */
export function irCallBookedEmail(opts: {
  memberFirstName: string;
  partnerLc: string;
  country: string | null;
  bookerName: string | null;
  /** already formatted, e.g. "Sat, Aug 2 · 6:00 PM (Cairo time)" */
  whenLabel: string;
  slotMinutes: number;
  considerationUrl: string;
  /** v28: the Meet room + the IR's email */
  meetLink?: string | null;
  bookerEmail?: string | null;
  /** what the IR said they want to talk about (v33.24) */
  note?: string | null;
}): { subject: string; html: string } {
  return {
    subject: `📅 IR call booked — ${opts.partnerLc} · ${opts.whenLabel}`,
    html: emailLayout({
      preheader: `${opts.partnerLc} booked an IR call with you — ${opts.whenLabel}.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">An IR call just landed on your calendar, ${escapeHtml(opts.memberFirstName)} 🌍</h1>
        <p>Someone abroad picked a slot on your Sodio booking link:</p>
        ${detailsTable([
          ["Partner LC", opts.partnerLc],
          ["Country", opts.country],
          ["Booked by", opts.bookerName],
          ["Their email", opts.bookerEmail],
          ["When", opts.whenLabel],
          ["Duration", `${opts.slotMinutes} minutes`],
          ["Google Meet", opts.meetLink],
          ["What they want to talk about", opts.note],
        ])}
        <p>It's on your Google Calendar (if your grant is live) with the IR
        invited${opts.meetLink ? " and a Meet room attached" : ""}, and pinned
        to the top of the IR-calls tab. During the call, open it there and fill
        the in-call notes — their <b>demand</b>, their <b>B2C campaign
        dates</b> and a screenshot.</p>
        ${button("Open the Consideration module", opts.considerationUrl)}
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">Can't make it? Cancel the call from the IR-calls tab (with a reason) so the slot opens up again — or ask them to reschedule.</p>`,
    }),
  };
}

/** v28 — the IR's confirmation, sent to booker_email from the system sender:
 *  when, with whom, the Meet link and the public manage link (reschedule or
 *  cancel without an account). */
export function irBookingConfirmEmail(opts: {
  bookerName: string | null;
  memberName: string;
  partnerLc: string;
  /** THE IR'S OWN LOCAL TIME (v33.22) — their clock leads, ours follows */
  whenLabel: string;
  /** the same instant in Cairo, shown as the secondary line. Null when we
   *  don't know their zone, in which case whenLabel IS Cairo time. */
  cairoLabel?: string | null;
  slotMinutes: number;
  meetLink: string | null;
  manageUrl: string;
  /** true when this confirmation follows a reschedule */
  rescheduled?: boolean;
}): { subject: string; html: string } {
  const verb = opts.rescheduled ? "moved" : "confirmed";
  return {
    subject: `${opts.rescheduled ? "🔁 IR call rescheduled" : "✅ IR call confirmed"} — ${opts.memberName} · ${opts.whenLabel}`,
    html: externalEmailLayout({
      preheader: `Your IR call with ${opts.memberName} (AIESEC in Alexandria) is ${verb} — ${opts.whenLabel}.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Your IR call is ${verb} 🌍</h1>
        <p>Hi${opts.bookerName ? ` ${escapeHtml(opts.bookerName)}` : ""} — your call
        with <b>${escapeHtml(opts.memberName)}</b> of AIESEC in Alexandria is
        booked. A Google Calendar invite is on its way to this address.</p>
        ${detailsTable([
          ["With", opts.memberName],
          ["Your LC", opts.partnerLc],
          ["When (your time)", opts.whenLabel],
          ["Same moment in Cairo", opts.cairoLabel ?? null],
          ["Duration", `${opts.slotMinutes} minutes`],
          ["Google Meet", opts.meetLink],
        ])}
        ${opts.meetLink ? button("Join the Google Meet", opts.meetLink) : ""}
        <p>Plans changed? Use the link below to pick a new time or cancel —
        it opens straight from this email, nothing to sign up for:</p>
        ${button(opts.rescheduled ? "Manage this booking" : "Reschedule or cancel", opts.manageUrl)}
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">${
          opts.cairoLabel
            ? "Times are shown in your own time zone, and the calendar invite will show it in whatever zone your calendar is set to."
            : "All times are Cairo time (GMT+2/+3)."
        } Booked through Sodio — AIESEC in Alexandria.</p>`,
    }),
  };
}

/** v28 — the OWNER's heads-up when the IR moves the call from the public
 *  manage page. */
export function irCallRescheduledOwnerEmail(opts: {
  memberFirstName: string;
  partnerLc: string;
  bookerName: string | null;
  oldWhenLabel: string;
  newWhenLabel: string;
  considerationUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `🔁 IR call moved — ${opts.partnerLc} · now ${opts.newWhenLabel}`,
    html: emailLayout({
      preheader: `${opts.partnerLc} moved your IR call to ${opts.newWhenLabel}.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">${escapeHtml(opts.partnerLc)} moved your IR call 🔁</h1>
        <p>Hey ${escapeHtml(opts.memberFirstName)} — ${opts.bookerName ? `<b>${escapeHtml(opts.bookerName)}</b> of ` : ""}${escapeHtml(opts.partnerLc)} picked a new time on your booking link:</p>
        ${detailsTable([
          ["Was", opts.oldWhenLabel],
          ["Now", opts.newWhenLabel],
        ])}
        <p>Your Google Calendar event was moved too (if your grant is live) —
        same Meet link, new time.</p>
        ${button("Open the Consideration module", opts.considerationUrl)}`,
    }),
  };
}

/** v28 — the OWNER's heads-up when the IR cancels from the manage page
 *  (reason included; the slot is free again). */
export function irCallCancelledByBookerEmail(opts: {
  memberFirstName: string;
  partnerLc: string;
  bookerName: string | null;
  whenLabel: string;
  reason: string;
  considerationUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `❌ IR call cancelled — ${opts.partnerLc} · ${opts.whenLabel}`,
    html: emailLayout({
      preheader: `${opts.partnerLc} cancelled the ${opts.whenLabel} IR call.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">${escapeHtml(opts.partnerLc)} cancelled the call ❌</h1>
        <p>Hey ${escapeHtml(opts.memberFirstName)} — ${opts.bookerName ? `<b>${escapeHtml(opts.bookerName)}</b> of ` : ""}${escapeHtml(opts.partnerLc)} cancelled your <b>${escapeHtml(opts.whenLabel)}</b> IR call.</p>
        ${detailsTable([["Their reason", opts.reason]])}
        <p>The slot is open on your booking link again, and the calendar event
        was removed.</p>
        ${button("Open the Consideration module", opts.considerationUrl)}`,
    }),
  };
}

/** v28 — sent to the IR when the MEMBER cancels a booked call: the reason +
 *  a link to book a fresh slot. */
export function irCallCancelledByMemberEmail(opts: {
  bookerName: string | null;
  memberName: string;
  partnerLc: string;
  whenLabel: string;
  reason: string;
  /** the member's live booking page — omitted when the link is off */
  bookingUrl: string | null;
}): { subject: string; html: string } {
  return {
    subject: `❌ IR call cancelled — ${opts.memberName} · ${opts.whenLabel}`,
    html: externalEmailLayout({
      preheader: `${opts.memberName} had to cancel your ${opts.whenLabel} IR call.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Your IR call was cancelled 😔</h1>
        <p>Hi${opts.bookerName ? ` ${escapeHtml(opts.bookerName)}` : ""} —
        <b>${escapeHtml(opts.memberName)}</b> of AIESEC in Alexandria had to
        cancel your <b>${escapeHtml(opts.whenLabel)}</b> call
        (${escapeHtml(opts.partnerLc)}). Sorry about that!</p>
        ${detailsTable([["Reason", opts.reason]])}
        ${
          opts.bookingUrl
            ? `<p>Their calendar is still open — pick a fresh slot whenever suits you:</p>
        ${button("Book a new time", opts.bookingUrl)}`
            : `<p>Reach back out to them to line up a new time.</p>`
        }
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">Times are shown in your own time zone. Sent via Sodio — AIESEC in Alexandria.</p>`,
    }),
  };
}

/** ── A CALL CHANGES HANDS (v33.58) ──────────────────────────────────────
 *
 *  Three people need to hear about a hand-over and they need to hear three
 *  different things, which is why this is three templates and not one with a
 *  flag: the person now expected to show up, the person who no longer is, and
 *  the IR abroad — who never asked for any of this and only cares that
 *  somebody will be on the other end of the Meet.
 *
 *  The IR's copy is `externalEmailLayout` like every other booker-facing mail
 *  (v29): no CRM links, no internal wording, nothing they have no context for. */
export function irCallHandedToYouEmail(opts: {
  memberFirstName: string;
  /** who handed it over — the previous host, or the leader who moved it */
  fromName: string;
  partnerLc: string;
  country: string | null;
  bookerName: string | null;
  bookerEmail: string | null;
  /** Cairo label, like every internal mail */
  whenLabel: string;
  slotMinutes: number;
  meetLink: string | null;
  note: string | null;
  considerationUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `🤝 An IR call is yours now — ${opts.partnerLc} · ${opts.whenLabel}`,
    html: emailLayout({
      preheader: `${opts.fromName} handed you the ${opts.partnerLc} IR call — ${opts.whenLabel}.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">You're taking this one, ${escapeHtml(opts.memberFirstName)} 🌍</h1>
        <p><b>${escapeHtml(opts.fromName)}</b> handed you an IR call that was
        already booked. It is on your calendar now, with the IR invited — you
        are the host they'll be expecting.</p>
        ${detailsTable([
          ["Partner LC", opts.partnerLc],
          ["Country", opts.country],
          ["Who you're meeting", opts.bookerName],
          ["Their email", opts.bookerEmail],
          ["When", opts.whenLabel],
          ["Duration", `${opts.slotMinutes} minutes`],
          ["Google Meet", opts.meetLink],
          ["What they want to talk about", opts.note],
        ])}
        <p>Open it in the IR-calls tab before the call, and fill the in-call
        notes afterwards — their <b>demand</b>, their <b>B2C campaign
        dates</b> and a screenshot. It counts for you now.</p>
        ${button("Open the Consideration module", opts.considerationUrl)}
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">Can't take it either? Hand it on, or cancel it with a reason so the IR can rebook — don't leave them waiting in an empty room.</p>`,
    }),
  };
}

/** The other half: the person who is no longer expected on the call. */
export function irCallHandedOverEmail(opts: {
  memberFirstName: string;
  toName: string;
  /** who moved it — them, or a leader acting over them */
  byName: string;
  byLeader: boolean;
  partnerLc: string;
  whenLabel: string;
  considerationUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `🤝 Your ${opts.partnerLc} IR call now belongs to ${opts.toName}`,
    html: emailLayout({
      preheader: `The ${opts.whenLabel} call with ${opts.partnerLc} moved to ${opts.toName}.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">That call is off your plate, ${escapeHtml(opts.memberFirstName)}</h1>
        <p>${
          opts.byLeader
            ? `<b>${escapeHtml(opts.byName)}</b> moved your`
            : "You handed over your"
        } <b>${escapeHtml(opts.whenLabel)}</b> call with
        <b>${escapeHtml(opts.partnerLc)}</b> to
        <b>${escapeHtml(opts.toName)}</b>.</p>
        ${detailsTable([
          ["Partner LC", opts.partnerLc],
          ["When", opts.whenLabel],
          ["Now hosted by", opts.toName],
        ])}
        <p>The calendar invite has been removed from your calendar and rebuilt
        on theirs, and the IR has been told who to expect. Nothing is left for
        you to do — and the call will count for ${escapeHtml(opts.toName)}, not you.</p>
        ${button("Open the Consideration module", opts.considerationUrl)}`,
    }),
  };
}

/** The IR's copy — the one that actually matters on the day. */
export function irCallHostChangedEmail(opts: {
  bookerName: string | null;
  /** who they'll now be meeting */
  newMemberName: string;
  /** who they booked with */
  oldMemberName: string;
  partnerLc: string;
  /** THEIR clock leads (v33.22) */
  whenLabel: string;
  cairoLabel?: string | null;
  slotMinutes: number;
  meetLink: string | null;
  manageUrl: string | null;
}): { subject: string; html: string } {
  return {
    subject: `🤝 Your IR call is now with ${opts.newMemberName} — ${opts.whenLabel}`,
    html: externalEmailLayout({
      preheader: `Same time, new host: ${opts.newMemberName} will be meeting you instead of ${opts.oldMemberName}.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Same time — a different colleague 🤝</h1>
        <p>Hi${opts.bookerName ? ` ${escapeHtml(opts.bookerName)}` : ""} — a
        quick heads-up about your call with AIESEC in Alexandria:
        <b>${escapeHtml(opts.newMemberName)}</b> will be meeting you instead of
        ${escapeHtml(opts.oldMemberName)}. <b>The time has not changed</b>, and
        they have everything you told us.</p>
        ${detailsTable([
          ["Now meeting", opts.newMemberName],
          ["Your LC", opts.partnerLc],
          ["When (your time)", opts.whenLabel],
          ["Same moment in Cairo", opts.cairoLabel ?? null],
          ["Duration", `${opts.slotMinutes} minutes`],
          ["Google Meet", opts.meetLink],
        ])}
        <p>A fresh calendar invite is on its way to this address — <b>use that
        one</b>, the earlier invite has been withdrawn.</p>
        ${opts.meetLink ? button("Join the Google Meet", opts.meetLink) : ""}
        ${
          opts.manageUrl
            ? `<p>If the new time or host doesn't suit you, you can still move or cancel it here:</p>
        ${button("Reschedule or cancel", opts.manageUrl)}`
            : ""
        }
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">${
          opts.cairoLabel
            ? "Times are shown in your own time zone."
            : "All times are Cairo time (GMT+2/+3)."
        } Sent via Sodio — AIESEC in Alexandria.</p>`,
    }),
  };
}

/** v28 — sent to the IR when the MEMBER asks to move the call: the IR picks
 *  the new time themselves on the public manage page. */
export function irRescheduleRequestEmail(opts: {
  bookerName: string | null;
  memberName: string;
  partnerLc: string;
  whenLabel: string;
  /** why they can't make it — written by the member, shown verbatim (v29) */
  reason?: string | null;
  manageUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `🔁 ${opts.memberName} asked to move your IR call (${opts.whenLabel})`,
    html: externalEmailLayout({
      preheader: `${opts.memberName} can't make ${opts.whenLabel} — pick a new time that suits you.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Can we move the call? 🔁</h1>
        <p>Hi${opts.bookerName ? ` ${escapeHtml(opts.bookerName)}` : ""} —
        <b>${escapeHtml(opts.memberName)}</b> of AIESEC in Alexandria can't make
        your <b>${escapeHtml(opts.whenLabel)}</b> IR call
        (${escapeHtml(opts.partnerLc)}) and asked to move it.</p>
        ${
          opts.reason
            ? `<p style="border-left:4px solid #7552CC;background:#EFEAFA;border-radius:0 8px 8px 0;padding:12px 16px;margin:16px 0;"><b>Their reason:</b> ${escapeHtml(opts.reason)}</p>`
            : ""
        }
        <p>Pick whichever new time suits you from their live availability — it
        takes a few seconds and the current time stays booked until you do:</p>
        ${button("Pick a new time", opts.manageUrl)}
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">Times are shown in your own time zone. Sent via Sodio — AIESEC in Alexandria.</p>`,
    }),
  };
}

/** v27 — the OGV contact-streak game's end-of-day nag (19:00 Cairo): the
 *  member's ≥3-day streak dies at Cairo midnight unless ONE sign-up contact
 *  action lands today. The comedy escalates with the stakes. */
export function streakNagEmail(opts: { firstName: string; streak: number }) {
  const n = opts.streak;
  const tier =
    n >= 14
      ? {
          subject: `🚨 ${n} days. Do NOT let it end tonight.`,
          headline: `${n} days. We're in awe. And in danger. 🚨`,
          body: `<b>${n} consecutive days</b> of contacting sign-ups. People write
            theses about less. Statues get raised for less. And tonight at midnight,
            all of it can quietly become a <b>zero</b> — over ONE quiet day.`,
        }
      : n >= 7
        ? {
            subject: `😱 ${n} days of fire — and it dies at midnight`,
            headline: `${n === 7 ? "SEVEN" : n} days. Legends have fallen for less. 😱`,
            body: `your <b>${n}-day streak</b> is pacing the room and checking the
              clock. Empires have crumbled over one missed day — don't let a
              perfectly good streak join the history books tonight.`,
          }
        : {
            subject: `🔥 Your ${n}-day streak is about to sleep hungry`,
            headline: `The flame is getting sleepy 🔥😴`,
            body: `your <b>${n}-day streak</b> is about to sleep hungry — no sign-up
              has heard from you today, and streaks are famously dramatic about
              that sort of thing.`,
          };
  return {
    subject: tier.subject,
    html: emailLayout({
      preheader: `No sign-up contact today — your ${n}-day streak ends at Cairo midnight`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">${tier.headline}</h1>
        <p>Hey ${escapeHtml(opts.firstName)} — ${tier.body}</p>
        <p>Saving it takes <b>one real contact</b> before midnight: reach a
        sign-up and mark it <b>Contacted</b>. That's
        it — the flame lives another day.</p>
        ${button("Save my streak", `${env.appUrl}/signups`)}`,
    }),
  };
}

/** A concern was filed about someone (v32.8). Goes to the LCP and the TM
 *  leadership only — deliberately says NOTHING about who or what, so the
 *  private channel stays private even in an inbox preview. */
export function lcConcernEmail(opts: { count: number; rating?: number | null }) {
  const who = opts.count === 1 ? "a member" : `${opts.count} members`;
  // a RATED touch point is a review, not a concern — same private inbox, very
  // different thing to walk in expecting (v33.33)
  if (opts.rating)
    return {
      subject: `⭐ A touch point was rated ${opts.rating}/5`,
      html: emailLayout({ body: `
        <h2 style="margin:0 0 12px;font-size:20px;">A touch point was reviewed</h2>
        <p>Someone rated one of the LC's sessions <b>${opts.rating} out of 5</b>${
          opts.rating >= 4 ? "" : " — worth a read"
        }. The review is in the inbox; nothing about it is repeated here on purpose.</p>
        ${button("Open the inbox", `${env.appUrl}/lc-feedback`)}
        <p style="color:#64748b;font-size:13px;margin-top:16px;">
          Only TM, the LCP and F&amp;L's LCVP can read this inbox.
        </p>
      ` }),
    };
  return {
    subject: "🔒 A new concern was filed",
    html: emailLayout({ body: `
      <h2 style="margin:0 0 12px;font-size:20px;">A concern needs your eyes</h2>
      <p>Someone filed a concern about ${who}. The details are in the private
         inbox — nothing about it is repeated in this email on purpose.</p>
      ${button("Open the inbox", `${env.appUrl}/lc-feedback`)}
      <p style="color:#64748b;font-size:13px;margin-top:16px;">
        Only TM, the LCP and F&amp;L's LCVP can read this inbox.
      </p>
    ` }),
  };
}

/** Someone in the inbox passed a piece of feedback on to you (v33.22). The
 *  MESSAGE travels; the author never does — a shared concern is still
 *  anonymous if it was filed anonymously. */
export function lcSharedFeedbackEmail(opts: {
  sharedBy: string;
  kind: string;
  message: string;
  note: string | null;
}) {
  return {
    subject: `📨 ${opts.sharedBy} shared ${opts.kind} with you`,
    html: emailLayout({ body: `
      <h2 style="margin:0 0 12px;font-size:20px;">Shared with you</h2>
      <p><b>${escapeHtml(opts.sharedBy)}</b> passed you ${escapeHtml(opts.kind)} from the LC
         feedback inbox, because it needs you.</p>
      <blockquote style="margin:14px 0;padding:10px 14px;border-left:3px solid #7552CC;background:#f8fafc;color:#0f172a;white-space:pre-wrap;">${escapeHtml(opts.message)}</blockquote>
      ${opts.note ? `<p style="white-space:pre-wrap;"><b>${escapeHtml(opts.sharedBy)} adds:</b> ${escapeHtml(opts.note)}</p>` : ""}
      <p style="color:#64748b;font-size:13px;margin-top:16px;">
        Who wrote it is not shown — feedback can be filed anonymously, and
        sharing it never reveals the author.
      </p>
    ` }),
  };
}

/** The loop closes (v33.22): the person who spoke up hears that it was
 *  handled. Filing into silence is how people stop filing. */
export function lcFeedbackHandledEmail(opts: {
  name: string;
  handledBy: string;
  original: string;
  note: string | null;
}) {
  return {
    subject: "✅ Your feedback was handled",
    html: emailLayout({ body: `
      <h2 style="margin:0 0 12px;font-size:20px;">Thank you for speaking up</h2>
      <p>Hi ${escapeHtml(opts.name)} — the feedback you filed has been handled by
         <b>${escapeHtml(opts.handledBy)}</b>.</p>
      <blockquote style="margin:14px 0;padding:10px 14px;border-left:3px solid #7552CC;background:#f8fafc;color:#0f172a;white-space:pre-wrap;">${escapeHtml(opts.original)}</blockquote>
      ${opts.note ? `<p style="white-space:pre-wrap;"><b>What happened:</b> ${escapeHtml(opts.note)}</p>` : ""}
      <p style="color:#64748b;font-size:13px;margin-top:16px;">
        Your name was never shown to anyone if you filed this anonymously —
        that hasn't changed.
      </p>
    ` }),
  };
}

/** THE TIME-ZONE CORRECTION (v33.22, one-off).
 *
 *  Bookings made before the public page spoke the visitor's own clock were
 *  shown Cairo time with a footnote. Nothing about them is WRONG — the call
 *  is at the instant it always was, and the calendar invite has always been
 *  right — but an IR who read "6:00 PM" as their own 6 PM would be an hour or
 *  six out. So: confirm, in their words, in their zone, with the option to
 *  move it if that turns out not to work. Never an apology for a broken
 *  booking; there isn't one. */
/** "RATE IT" — the end-of-day nudge (v33.35).
 *
 *  v33.33 made session feedback a 1–5 star tap. Nobody was ever asked for it,
 *  so almost nobody gave it. This asks — once, the evening of the session,
 *  everyone who was there, with TM and the booker on CC — and it is written
 *  to be believed: the ask really is four seconds, and saying so plainly is
 *  the only thing that gets a busy member to open the tab. */
export function touchPointFeedbackNudgeEmail(opts: {
  /** "Meeting · IGV" */
  label: string;
  whenLabel: string;
  ownerName: string;
  feedbackUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `⭐ ${opts.label} — how was it? (four seconds, we counted)`,
    html: emailLayout({
      preheader: "Five stars to tap. That's the whole email.",
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">How was it? ⭐</h1>
        <p>You were at <b>${escapeHtml(opts.label)}</b> — ${escapeHtml(opts.whenLabel)},
        run by ${escapeHtml(opts.ownerName)}. Tell us how it went.</p>
        <p style="border-left:4px solid #7552CC;background:#EFEAFA;border-radius:0 8px 8px 0;padding:14px 16px;">
          <b>It is one tap.</b> Five stars, pick one, done. No form, no essay,
          no &quot;describe your experience in 200 words&quot;. There is a box
          for a note if you have something to say — and it is genuinely
          optional, we are not going to sulk.
        </p>
        <p style="font-size:26px;line-height:1;margin:0 0 12px;">⭐⭐⭐⭐⭐</p>
        ${button("Rate it (seriously, four seconds)", opts.feedbackUrl)}
        <p style="color:#5c6b80;font-size:13px;">Open Feedback → pick <b>A touch point</b> → tap the stars. It goes to TM and the LCP, never to the person who ran it as a complaint about them — a session is a session.</p>
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">Already rated it? You are a legend and this email is not for you. 💙</p>`,
    }),
  };
}

/** BOOKED, THE TIME PASSED, STILL NOT REPORTED (v33.32).
 *
 *  A scheduled call whose slot is behind us is nobody's "upcoming" and
 *  nobody's "done" — it just sits there, and until v33.32 nothing counted it
 *  or chased it. This is the chase: one email per HOST listing every call of
 *  theirs that is waiting, so the answer is one visit to the tab rather than
 *  one per call. */
export function irCallsOverdueEmail(opts: {
  memberFirstName: string;
  /** already formatted, Cairo — oldest first */
  calls: { partnerLc: string; whenLabel: string; bookerName: string | null }[];
  considerationUrl: string;
}): { subject: string; html: string } {
  const n = opts.calls.length;
  return {
    subject: `⏰ ${n} IR call${n === 1 ? "" : "s"} waiting for your report`,
    html: emailLayout({
      preheader: `${n} booked call${n === 1 ? "" : "s"} of yours ${n === 1 ? "has" : "have"} passed with nothing recorded.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Two minutes, ${escapeHtml(opts.memberFirstName)} ⏰</h1>
        <p>${n === 1 ? "One of your booked IR calls has" : `${n} of your booked IR calls have`}
        come and gone with nothing recorded. Until ${n === 1 ? "it is" : "they are"}
        closed off ${n === 1 ? "it counts" : "they count"} as neither done nor
        upcoming — so ${n === 1 ? "it is" : "they are"} missing from your
        numbers and from the LC's.</p>
        ${gridTable(
          ["Partner LC", "When it was", "Who booked it"],
          opts.calls.map((c) => [c.partnerLc, c.whenLabel, c.bookerName ?? "—"])
        )}
        <p><b>Open the call on Consideration and pick one:</b></p>
        <ul style="margin:0 0 16px;padding-left:20px;color:#0A2540;">
          <li><b>It happened</b> → fill the in-call notes (their demand, their
              B2C campaign dates, a screenshot). That completes it.</li>
          <li><b>It didn't</b> → cancel it with a reason, so the slot opens up
              again and the IR knows where they stand.</li>
        </ul>
        ${button("Open my IR calls", opts.considerationUrl)}
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">If one of these only just finished, ignore that line — this is a nudge, not a telling-off.</p>`,
    }),
  };
}

/** THE IR'S EMAIL CAME BACK UNDELIVERABLE (v33.32).
 *
 *  The bounce watcher flags the call; this is what reaches the HOST, because a
 *  bell alone was being missed for days while the IR sat with no invite, no
 *  Meet link and no idea. It carries the one thing that actually unblocks it:
 *  a WhatsApp link straight to the IR, since their number is the one channel
 *  we know still works. */
export function irEmailBouncedEmail(opts: {
  memberFirstName: string;
  bookerName: string | null;
  partnerLc: string;
  badEmail: string;
  /** already formatted, Cairo */
  whenLabel: string;
  /** wa.me link, when the IR left a number */
  whatsappUrl: string | null;
  bookerPhone: string | null;
  considerationUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `⚠️ Fix ${opts.bookerName ?? "the IR"}'s email — the invite bounced (${opts.partnerLc})`,
    html: emailLayout({
      preheader: `${opts.badEmail} doesn't exist — the IR has no invite for ${opts.whenLabel}.`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">An IR's email bounced, ${escapeHtml(opts.memberFirstName)} ⚠️</h1>
        <p>The confirmation and the calendar invite for your call could not be
        delivered — the mail server says that address doesn't exist. As things
        stand, <b>the IR has no invite and no Meet link</b>, and unless someone
        reaches them another way, they will not show up.</p>
        ${detailsTable([
          ["Partner LC", opts.partnerLc],
          ["IR", opts.bookerName],
          ["The address that bounced", opts.badEmail],
          ["When the call is", opts.whenLabel],
          ["Their WhatsApp", opts.bookerPhone],
        ])}
        <p><b>What to do — it takes two minutes:</b></p>
        <ol style="margin:0 0 16px;padding-left:20px;color:#0A2540;">
          <li>Message them on WhatsApp and ask for the correct email.</li>
          <li>Open the call in Sodio → <b>Fix the email</b>.</li>
          <li>That's it: the wrong address is dropped from the invite, the
              right one is invited in its place, and a fresh confirmation with
              the Meet link goes out to them automatically.</li>
        </ol>
        ${opts.whatsappUrl ? button("Message the IR on WhatsApp", opts.whatsappUrl) : ""}
        ${button("Open the call in Sodio", opts.considerationUrl)}
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">If they don't answer, cancel the call so the slot opens up again.</p>`,
    }),
  };
}

export function irTimeZoneConfirmEmail(opts: {
  bookerName: string | null;
  memberName: string;
  partnerLc: string;
  /** the call in the IR's own zone — the headline */
  theirLabel: string;
  /** the same instant in Cairo — what the first email said */
  cairoLabel: string;
  meetLink: string | null;
  manageUrl: string;
}): { subject: string; html: string } {
  return {
    subject: `📅 Your IR call with ${opts.memberName} — ${opts.theirLabel}`,
    html: externalEmailLayout({
      preheader: `Confirming your IR call: ${opts.theirLabel} (that is ${opts.cairoLabel}).`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Confirming your IR call 🌍</h1>
        <p>Hi${opts.bookerName ? ` ${escapeHtml(opts.bookerName)}` : ""} — quick
        confirmation of your call with <b>${escapeHtml(opts.memberName)}</b> of
        AIESEC in Alexandria. Nothing has changed; we are just writing the time
        out in <b>your</b> local time, because the booking page you used showed
        it in <b>Cairo</b> time.</p>
        ${detailsTable([
          ["Your local time", opts.theirLabel],
          ["Cairo time (what the first email said)", opts.cairoLabel],
          ["With", opts.memberName],
          ["Your LC", opts.partnerLc],
          ["Google Meet", opts.meetLink],
        ])}
        <p>Both lines are the same moment — and your calendar invite has always
        been correct, since Google shows it in whatever zone your calendar is
        set to.</p>
        <p>If that time doesn't work now that you see it in your own clock,
        the link below lets you pick another one in a few seconds:</p>
        ${button("Reschedule or cancel", opts.manageUrl)}
        <p style="color:#5c6b80;font-size:13px;margin-bottom:0;">From now on our booking pages show every time in your own time zone. Sent via Sodio — AIESEC in Alexandria.</p>`,
    }),
  };
}
