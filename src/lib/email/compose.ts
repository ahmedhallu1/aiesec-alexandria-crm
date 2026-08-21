import { env } from "@/lib/env";
import { escapeHtml } from "./templates";

/** THE MEMBER'S OWN LETTERS (v33.24).
 *
 *  Everything Sodio sends automatically is a template. This is the other
 *  half: a member writing to a partner, an EP, another LC — work that has
 *  been happening in Gmail from a blank page, so every letter looks
 *  different, half of them go out with no signature, and the LC has no record
 *  of what was said to whom.
 *
 *  The frame here is deliberately quieter than the system emails: this is a
 *  PERSON writing, not the CRM notifying. A slim branded header, the member's
 *  own words, and a real signature block underneath.
 */

const NAVY = "#0A2540";
const BLUE = "#037EF3";

/** The signature the LC actually uses — name, the full role title, the entity,
 *  the site, a WhatsApp-linked number, the address, and the two AIESEC lines.
 *  Built from the membership row so nobody retypes it (or forgets it). */
export function memberSignature(m: {
  name: string;
  title: string;
  email?: string | null;
  phone?: string | null;
}): string {
  const wa = (m.phone ?? "").replace(/\D/g, "");
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 0;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <tr>
    <td style="padding-right:20px;vertical-align:top;border-left:3px solid ${BLUE};padding-left:16px;">
      <div style="font-size:15px;font-weight:800;color:${NAVY};">${escapeHtml(m.name)}</div>
      <div style="font-size:13px;color:#41526b;margin-top:2px;">${escapeHtml(m.title)}</div>
      <div style="font-size:13px;font-weight:700;font-style:italic;color:${NAVY};margin-top:2px;">AIESEC in Alexandria.</div>
      <div style="margin-top:8px;font-size:13px;line-height:1.75;">
        <a href="https://www.aiesec.org" style="color:${BLUE};font-weight:bold;text-decoration:none;">www.aiesec.org</a>
        ${m.phone ? `<br><span style="color:#8b98a9;">WhatsApp:</span> <a href="https://wa.me/${wa}" style="color:#41526b;text-decoration:none;">${escapeHtml(m.phone)}</a>` : ""}
        ${m.email ? `<br><a href="mailto:${escapeHtml(m.email)}" style="color:${BLUE};text-decoration:none;font-style:italic;">${escapeHtml(m.email)}</a>` : ""}
      </div>
      <div style="margin-top:10px;font-size:12px;color:#5c6b80;line-height:1.6;">
        The world's largest youth-run organization.<br>
        The international platform for young people to explore and develop their potential.
      </div>
    </td>
    <td style="vertical-align:top;padding-left:4px;">
      <!-- THE VIOLET MAN, NOT THE LC MARK (v33.27). Every layout already carries
           the AIESEC in Alexandria logo at the top; repeating it 20 lines
           lower made the letter look like two letters stapled together. The
           walking human is the LC's own face and belongs to the person, which
           is what a signature is. -->
      <img src="${env.appUrl}/brand/aiesec-human-blue.png" alt="AIESEC" width="66"
           style="display:block;width:66px;max-width:66px;height:auto;border:0;">
    </td>
  </tr>
</table>`;
}

/** THE LAYOUTS (v33.25).
 *
 *  One letter is not like another: a first approach to a company should look
 *  like a company letter, a note to another entity should look like AIESEC
 *  talking to AIESEC, and a quick reply should look like a person typing. So
 *  the frame is a CHOICE, made per email and previewed before it goes.
 */
export type LayoutKey = "branded" | "banner" | "plain" | "letterhead";

export interface LayoutOption {
  key: LayoutKey;
  label: string;
  hint: string;
}

export const EMAIL_LAYOUTS: LayoutOption[] = [
  {
    key: "branded",
    label: "Branded card",
    hint: "The house look — logo, AIESEC colour band, white card. The safe default.",
  },
  {
    key: "banner",
    label: "Bold banner",
    hint: "A navy header with the white logo across it. For announcements and invitations.",
  },
  {
    key: "letterhead",
    label: "Letterhead",
    hint: "Formal and quiet: a rule under the logo, no card. For official letters.",
  },
  {
    key: "plain",
    label: "Plain",
    hint: "No frame at all — just your words and your signature, like a normal email.",
  },
];

/** The wrapper around whatever the member wrote. */
export function composedEmail(opts: {
  bodyHtml: string;
  signature: string;
  layout?: LayoutKey;
}): string {
  const body = `${opts.bodyHtml}${opts.signature}`;
  const inner = (() => {
    switch (opts.layout) {
      case "plain":
        return `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
        <tr><td style="padding:8px 4px;color:#12263f;font-size:15px;line-height:1.75;">${body}</td></tr>
      </table>`;
      case "banner":
        return `<table role="presentation" width="640" cellpadding="0" cellspacing="0"
             style="max-width:640px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dfe8f2;">
        <tr>
          <td align="center" style="background-color:${NAVY};background-image:linear-gradient(135deg,${NAVY} 0%,#0d3a6e 55%,${BLUE} 145%);padding:30px 34px;">
            <img src="${env.appUrl}/brand/alex-white.png" alt="AIESEC in Alexandria" width="240"
                 style="display:block;width:240px;max-width:72%;height:auto;border:0;">
          </td>
        </tr>
        <tr><td style="height:5px;background-image:linear-gradient(90deg,${BLUE},#0CB9C1 45%,#F48924 75%,#F85A40);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 34px 32px;color:#12263f;font-size:15px;line-height:1.75;">${body}</td></tr>
      </table>`;
      case "letterhead":
        return `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;">
        <tr>
          <td style="padding:30px 36px 14px;border-bottom:2px solid ${BLUE};">
            <img src="${env.appUrl}/brand/alex-blue.png" alt="AIESEC in Alexandria" width="200"
                 style="display:block;width:200px;max-width:58%;height:auto;border:0;">
          </td>
        </tr>
        <tr><td style="padding:26px 36px 34px;color:#12263f;font-size:15px;line-height:1.8;">${body}</td></tr>
      </table>`;
      default:
        return `<table role="presentation" width="640" cellpadding="0" cellspacing="0"
             style="max-width:640px;width:100%;background:#ffffff;border:1px solid #dfe8f2;border-top:5px solid ${BLUE};border-radius:14px;">
        <tr>
          <td style="padding:26px 34px 0;">
            <img src="${env.appUrl}/brand/alex-blue.png" alt="AIESEC in Alexandria" width="180"
                 style="display:block;width:180px;max-width:55%;height:auto;border:0;">
          </td>
        </tr>
        <tr><td style="padding:22px 34px 30px;color:#12263f;font-size:15px;line-height:1.75;">${body}</td></tr>
      </table>`;
    }
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${opts.layout === "plain" ? "#ffffff" : "#f4f7fb"};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${opts.layout === "plain" ? "#ffffff" : "#f4f7fb"};padding:26px 12px;">
    <tr><td align="center">${inner}</td></tr>
  </table>
</body>
</html>`;
}

/** The AIESEC marks a member can drop INTO the letter (v33.25) — served from
 *  the public /brand folder, so they render for any recipient. */
export const EMAIL_IMAGES: { key: string; label: string; file: string; width: number }[] = [
  { key: "alex-blue", label: "AIESEC in Alexandria (blue)", file: "alex-blue.png", width: 220 },
  { key: "alex-white", label: "AIESEC in Alexandria (white)", file: "alex-white.png", width: 220 },
  { key: "aiesec-blue", label: "AIESEC wordmark", file: "aiesec-blue.png", width: 170 },
  { key: "aiesec-human", label: "AIESEC human", file: "aiesec-human-blue.png", width: 120 },
  { key: "gv", label: "Global Volunteer", file: "gv-logo.png", width: 150 },
  { key: "gta", label: "Global Talent", file: "gta-logo.png", width: 150 },
];

export function emailImageUrl(file: string): string {
  return `${env.appUrl}/brand/${file}`;
}

/** STARTING POINTS, not straitjackets — each one is loaded into the editor and
 *  then rewritten. They exist because a blank page is why letters don't get
 *  written, and why the ones that do all look different. */
export interface ComposeTemplate {
  key: string;
  label: string;
  hint: string;
  subject: string;
  body: string;
  /** addresses to put on CC automatically when this template is picked
   *  (v33.37 — the contract mail carries customer support, always) */
  cc?: string[];
  /** WHO THIS IS A STARTING POINT FOR (v33.41). The tab belongs to every
   *  member now, so the list has to be theirs: absent = everyone, otherwise
   *  the viewer must hold one of these. `mmOnly` narrows further, for the
   *  letters that carry an LC-level commitment. */
  audience?: MailAudience[];
  mmOnly?: boolean;
}

/** The crews a template can be written for — matched against what the viewer
 *  actually does, never against their rank. */
export type MailAudience =
  | "raising"
  | "consideration"
  | "ogx"
  | "b2c"
  | "tm";

/** The starting points THIS person can use (v33.41) — a raiser is not shown
 *  the EP contract mail, an OGX member is not shown the company pitch, and
 *  everyone keeps Blank. */
export function templatesFor(
  templates: ComposeTemplate[],
  viewer: { audiences: MailAudience[]; isMm: boolean }
): ComposeTemplate[] {
  const mine = new Set(viewer.audiences);
  return templates.filter((t) => {
    if (t.mmOnly && !viewer.isMm) return false;
    if (!t.audience) return true;
    return t.audience.some((a) => mine.has(a));
  });
}

export const COMPOSE_TEMPLATES: ComposeTemplate[] = [
  {
    key: "blank",
    label: "Blank",
    hint: "Just the frame and your signature.",
    subject: "",
    body: "<p>Hi,</p><p></p>",
  },
  {
    key: "partner_intro",
    label: "Reaching a company",
    audience: ["raising", "b2c"],
    hint: "A first approach to a business you want to partner with.",
    subject: "A partnership between AIESEC in Alexandria and {{company}}",
    body: `<p>Dear {{name}},</p>
<p>I'm reaching out from <b>AIESEC in Alexandria</b>, part of the world's largest
youth-run organization, present in over 100 countries.</p>
<p>We work with organizations like {{company}} to bring international talent and
volunteers into their teams — people who add a global perspective, a second
language, and a lot of energy, at no recruitment cost to you.</p>
<p>Would you be open to a short meeting this week or next so I can show you
exactly how it works?</p>
<p>Looking forward to hearing from you,</p>`,
  },
  {
    key: "follow_up",
    label: "Following up",
    hint: "The polite nudge after a meeting or an unanswered email.",
    subject: "Following up — {{company}}",
    body: `<p>Dear {{name}},</p>
<p>I hope you're doing well. I wanted to follow up on my previous message about
working together with AIESEC in Alexandria.</p>
<p>If the timing wasn't right, I completely understand — I'd just like to know
whether it's worth keeping the conversation open.</p>
<p>Thank you for your time,</p>`,
  },
  {
    key: "thank_you",
    label: "Thank you after a meeting",
    audience: ["raising", "b2c", "consideration"],
    hint: "Sent the same day — it is what makes the second meeting happen.",
    subject: "Thank you for your time today",
    body: `<p>Dear {{name}},</p>
<p>Thank you for meeting me today — I really enjoyed the conversation and
learning more about {{company}}.</p>
<p>As promised, here is a summary of what we discussed:</p>
<ul><li></li><li></li></ul>
<p>I'll follow up on the next step by the date we agreed. In the meantime,
please don't hesitate to reach out with any question.</p>
<p>Warm regards,</p>`,
  },
  {
    key: "lc_to_lc",
    label: "Writing to another LC",
    audience: ["consideration"],
    hint: "IR: an entity abroad, about exchange or a partnership.",
    subject: "AIESEC in Alexandria — cooperation with {{company}}",
    body: `<p>Dear {{name}},</p>
<p>Greetings from <b>AIESEC in Alexandria, Egypt</b>! 🇪🇬</p>
<p>I'm writing to explore how our entities could work together this peak — we
have opportunities ready and would love to hear about your demand.</p>
<p>Would you be free for a short call in the coming days? You can pick a time
that suits you from my booking link and it will land in both our calendars.</p>
<p>Looking forward to working together,</p>`,
  },
  {
    key: "contract_signing",
    label: "Signing the contract",
    hint: "To an approved EP — the contract + acceptance note, with the signing steps. Customer support rides the CC automatically.",
    subject: "Signing the contract",
    audience: ["ogx"],
    mmOnly: true,
    cc: ["customer.support@aiesec.net.eg"],
    body: `<p>I attached the contract and acceptance note for your review and signature.</p>
<p>Kindly reply to this email with the signed copies of both documents attached at your earliest convenience respectively to the next steps .</p>
<ol>
<li>print first the contract and the acceptance note .</li>
<li>sign the contract in the places of signature of <b>EP</b> (exchange participant)</li>
<li>place the <b>ID</b> in every page from page 15 to the <b>END</b> of the contract in a way that id won’t cover any information in the contract then picture them.</li>
<li>sign the acceptance note beside your digital signature in the 2nd page of the acceptance note</li>
<li>place the <b>ID</b> in the two pages in a way that id won’t cover the information of the acceptance note then picture them .</li>
<li>reply all with all the pictures (preferred pdf).</li>
</ol>
<p><b>Attach student id to proceed in the process</b></p>`
  },
  // ---- v33.41: a real starting point for every crew, not just the raisers
  {
    key: "ep_first_reach",
    label: "Reaching a sign-up",
    audience: ["ogx"],
    hint: "The first written contact with someone who signed up and hasn't answered the phone.",
    subject: "AIESEC in Alexandria — about your application",
    body: `<p>Hi {{name}},</p>
<p>This is your contact from <b>AIESEC in Alexandria</b> — thank you for signing
up with us! I tried reaching you by phone and thought I'd write as well.</p>
<p>I'd love to walk you through the opportunities that fit you, what the process
looks like and what it costs, in a short call whenever suits you.</p>
<p>When would be a good time to talk?</p>`,
  },
  {
    key: "ep_nudge",
    label: "Nudging a quiet EP",
    audience: ["ogx"],
    hint: "For the sign-up who went quiet mid-process — warm, one question, easy to answer.",
    subject: "Still interested? — AIESEC in Alexandria",
    body: `<p>Hi {{name}},</p>
<p>I wanted to check in — we spoke about going abroad with AIESEC and I haven't
heard back since.</p>
<p>No pressure at all: just tell me whether you'd like to keep going, or whether
the timing isn't right this term. Either answer helps.</p>
<p>Talk soon,</p>`,
  },
  {
    key: "ir_cv_request",
    label: "Asking an LC for CVs",
    audience: ["consideration"],
    hint: "To a partner LC that has EPs ready — asking for their pool.",
    subject: "EP profiles for our opportunities — AIESEC in Alexandria",
    body: `<p>Dear {{name}},</p>
<p>Greetings from <b>AIESEC in Alexandria, Egypt</b>! 🇪🇬</p>
<p>Following our conversation, we have opportunities open and would love to see
the profiles you have ready — could you share your EP pool (CVs or the sheet
you keep) so we can match them against what our partners need?</p>
<p>Happy to send ours in return.</p>
<p>Best regards,</p>`,
  },
  {
    key: "b2c_offer",
    label: "Offering to a customer",
    audience: ["b2c"],
    hint: "A course, an event or a student activity — what it is and what the next step is.",
    subject: "{{company}} × AIESEC in Alexandria",
    body: `<p>Dear {{name}},</p>
<p>I'm writing from <b>AIESEC in Alexandria</b> about what we can offer your
students this term.</p>
<p>Here's what it includes:</p>
<ul><li></li><li></li></ul>
<p>If it sounds useful, I'd be glad to arrange a short meeting to go through the
details and the dates.</p>
<p>Warm regards,</p>`,
  },
  {
    key: "tm_invite",
    label: "Inviting the team",
    audience: ["tm"],
    hint: "A session, a meeting or working hours — the what, the when and the why.",
    subject: "See you there — {{company}}",
    body: `<p>Hi everyone,</p>
<p>We're getting together for:</p>
<p><b>What:</b> <br><b>When:</b> <br><b>Where:</b> </p>
<p>Please come on time — and tell me beforehand if you can't make it, so nobody
is marked absent for a reason we already knew about.</p>
<p>See you there,</p>`,
  }
];

/** The role line under the name. Uses the person's real function + role
 *  rather than the CRM's internal wording. */
export function signatureTitle(role: string, functions: string[]): string {
  const fn = functions[0] ?? "";
  const full: Record<string, string> = {
    IGV: "Incoming Global Volunteer",
    IGT: "Incoming Global Talent & Teacher",
    OGV: "Outgoing Global Volunteer",
    OGT: "Outgoing Global Talent & Teacher",
    B2B: "Business Development",
    BD: "Business Development",
    B2C: "Business to Customer",
    TM: "Talent Management",
    "F&L": "Finance & Legality",
    IM: "Information Management",
    CXP: "Customer Experience",
  };
  const area = full[fn] ?? fn;
  if (role === "LCP") return "Local Committee President";
  if (role === "LCVP") return `Local Committee Vice President of ${area}`;
  if (role === "Director") return `Director of ${area}`;
  if (role === "Team Leader") return `Team Leader — ${area}`;
  if (role === "Coordinator") return `Coordinator — ${area}`;
  return area ? `${area}, AIESEC in Alexandria` : "AIESEC in Alexandria";
}
