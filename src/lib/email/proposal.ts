import { BRAND, escapeHtml, sodioCredit } from "./templates";
import { env } from "@/lib/env";
import type { ProposalProduct } from "@/lib/proposal-pdfs";

/** ICX Proposal Email — builds the company outreach email the member sends
 *  from their own Gmail (v34.10: it always SENDS; the old "leave it in drafts"
 *  path is gone, replaced by an in-app preview of this exact HTML),
 *  matching the LC's original proposal-tool design (card layout, "why this
 *  could be a strong fit" callout, opportunity snapshot + AIESEC cards,
 *  meeting request). ONE brand color for every product (Sodio purple #7552CC);
 *  only the CONTENT changes per function. "B2B" is the general all-programs
 *  variant pointing at aiesec.org/partners. It goes out from the MEMBER's own
 *  address, so the reply lands with them. No company-logo section by design. */

// the deck set lives in its own import-free module so the CLIENT dialog can
// read it without pulling this file's template tree into the browser bundle
export type { ProposalProduct, ProposalPdf } from "@/lib/proposal-pdfs";
export {
  PROPOSAL_PDFS, PROPOSAL_PDF_LABEL, defaultProposalPdfs, proposalPdfFile,
} from "@/lib/proposal-pdfs";

export interface ProposalInput {
  product: ProposalProduct;
  companyName: string;
  sector: string | null;
  customNote: string | null;
  memberName: string;
  memberPhone: string | null;
  memberEmail: string;
}

/** ONE accent colour for every product — Sodio's purple since v34.10, so a
 *  proposal is recognisably from the same house as every other LC email.
 *  AIESEC blue stays for the links that point at AIESEC's own sites. */
const BLUE = BRAND.purple;
const LINK = "#037EF3"; // AIESEC's own blue — aiesec.org links only
const NAVY = BRAND.navy;

interface Pitch {
  programName: string;
  /** the sender's title in the signature (product-based, not the CRM role) */
  signatureTitle: string;
  /** program logo in /public/brand (absolute URL at render time) — text badge when missing */
  logo: string | null;
  subject: (company: string) => string;
  headline: (company: string) => string;
  intro1: (company: string) => string;
  intro2: (company: string, sector: string | null) => string;
  bullets: string[];
  snapshot: string[];
  meeting: (company: string) => string;
  moreLabel: string;
  moreUrl: string;
}

const PITCHES: Record<ProposalProduct, Pitch> = {
  iGV: {
    programName: "Global Volunteer",
    signatureTitle: "Global Volunteer Manager",
    logo: "gv-logo.png",
    subject: (c) => `Collaborate on Social Impact Initiatives with Global Volunteers — ${c}`,
    headline: (c) => `Exploring Global Volunteer collaboration with ${c}`,
    intro1: (c) =>
      `We are reaching out from AIESEC in Alexandria to explore a potential collaboration with ${c}. We believe there may be a strong synergy between your mission and our Global Volunteer program.`,
    intro2: (c, s) =>
      s
        ? `Given ${c}'s work in ${s} and its commitment to the community, partnering with international volunteers through AIESEC's Global Volunteer program could amplify your reach and impact.`
        : `Partnering with international volunteers through AIESEC's Global Volunteer program could amplify ${c}'s reach and impact.`,
    bullets: [
      "Support your social mission by hosting international volunteers dedicated to community engagement.",
      "Infuse a multicultural perspective into your initiatives and broaden your impact within the community.",
      "Gain insights into your organization's contribution to the Sustainable Development Goals through impactful volunteer projects.",
    ],
    snapshot: [
      "Program: Global Volunteer",
      "Typical duration: around 6 to 8 weeks",
      "Working hours: around 25 to 35 hours per week",
      "Focus: social impact and SDG-aligned projects",
      "Volunteer setup and logistics are aligned based on project design",
    ],
    meeting: (c) =>
      `Would you be available for a brief 20-minute meeting next week to discuss how a partnership could mutually benefit ${c} and the communities you serve?`,
    moreLabel: "More about Global Volunteer",
    moreUrl: "https://aiesec.org/partners/global-volunteer",
  },
  iGTa: {
    programName: "Global Talent",
    signatureTitle: "Global Talent Manager",
    logo: "gta-logo.png",
    subject: (c) => `Exploring International Talent for ${c}'s Growth`,
    headline: (c) => `Exploring Global Talent collaboration with ${c}`,
    intro1: (c) =>
      `We are reaching out from AIESEC in Alexandria to explore potential collaborations that can support ${c}'s mission and growth.`,
    intro2: (c, s) =>
      s
        ? `Given ${c}'s focus on ${s}, integrating international talent through Global Talent may offer fresh perspectives and specialized skills to enhance your operations.`
        : `Integrating international talent through Global Talent may offer ${c} fresh perspectives and specialized skills to enhance your operations.`,
    bullets: [
      "Access a diverse pool of young international professionals with skills in engineering, business, marketing and more.",
      "Enhance your team with global insights and cross-cultural collaboration.",
      "Strengthen your brand by showcasing a commitment to international exchange and development.",
    ],
    snapshot: [
      "Program: Global Talent",
      "Duration options: 3 months, 6 months, or 1 year",
      "Accommodation can be provided or covered",
      "Working hours: 35 to 45 hours per week",
      "Compensation guidance: starting from 8k EGP",
    ],
    meeting: (c) =>
      `Would you be open to a brief 20-minute meeting next week to discuss how Global Talent can align with ${c}'s objectives?`,
    moreLabel: "More about Global Talent",
    moreUrl: "https://aiesec.org/partners/global-talent",
  },
  iGTe: {
    programName: "Global Teacher",
    signatureTitle: "Global Teacher Manager",
    logo: null,
    subject: (c) => `Enhancing ${c}'s Programs with International Teaching Talent`,
    headline: (c) => `Exploring Global Teacher collaboration with ${c}`,
    intro1: (c) =>
      `We are reaching out from AIESEC in Alexandria, an organization dedicated to fostering cross-cultural understanding and providing valuable international experiences. We've been following ${c}'s work and we're impressed by your commitment to education.`,
    intro2: (c, s) =>
      s
        ? `As an organization focused on ${s}, you may find value in integrating diverse teaching methodologies and international perspectives into your curriculum.`
        : `${c} may find real value in integrating diverse teaching methodologies and international perspectives into its curriculum.`,
    bullets: [
      "Access a global pool of passionate young educators to enrich your teaching staff.",
      "Introduce new cultural insights and teaching approaches to your students.",
      "Strengthen your institution's international profile and attract a wider audience.",
    ],
    snapshot: [
      "Program: Global Teacher",
      "Duration options: 3 months, 6 months, or 1 year",
      "Accommodation can be provided or covered",
      "Working hours: 35 to 45 hours per week",
      "Compensation guidance: starting from 8k EGP",
    ],
    meeting: () =>
      `We would be delighted to schedule a brief 20-minute meeting to explore how AIESEC's Global Teacher program can support your educational mission.`,
    moreLabel: "More about Global Teacher",
    moreUrl: "https://aiesec.org/partners/global-teacher",
  },
  B2B: {
    programName: "Global Programs",
    signatureTitle: "Business Development Manager",
    logo: null,
    subject: (c) => `Exploring a Partnership between AIESEC in Alexandria and ${c}`,
    headline: (c) => `Exploring a partnership with ${c}`,
    intro1: (c) =>
      `We are reaching out from AIESEC in Alexandria to explore a potential partnership with ${c}. Through our global exchange programs we connect organizations with international volunteers, young professionals and educators from all over the world.`,
    intro2: (c, s) =>
      s
        ? `Given ${c}'s work in ${s}, we believe one (or several) of our programs could bring real value — whether that's amplifying your social impact, adding international talent to your team, or enriching your educational programs.`
        : `We believe one (or several) of our programs could bring real value to ${c} — whether that's amplifying your social impact, adding international talent to your team, or enriching your educational programs.`,
    bullets: [
      "Host international volunteers for your social-impact initiatives (6–8 week projects).",
      "Bring young international professionals into your team (3 to 12 month placements).",
      "Enrich your educational programs with passionate international teachers.",
    ],
    snapshot: [
      "Programs: Global Volunteer, Global Talent & Global Teacher",
      "Durations: from 6 weeks up to 12 months",
      "AIESEC supports matching, paperwork and follow-up end-to-end",
      "The setup is tailored to your goals in a short scoping conversation",
    ],
    meeting: (c) =>
      `Would you be open to a brief 20-minute meeting next week to explore which of our programs fits ${c} best?`,
    moreLabel: "To know more about partnering with AIESEC",
    moreUrl: "https://aiesec.org/partners",
  },
  // BD accounts: the talent-solutions pitch of aiesec.org.eg/partner.html —
  // NO ready-made PDF attachments ride with this one.
  BD: {
    programName: "Talent Solutions",
    signatureTitle: "Business Development Manager",
    logo: null,
    subject: (c) => `Talent Solutions for ${c} — Partnering with AIESEC in Alexandria`,
    headline: (c) => `Exploring a partnership with ${c}`,
    intro1: (c) =>
      `We are reaching out from AIESEC in Alexandria. AIESEC offers talent solutions to a variety of organizations — companies, start-ups and NGOs — helping them find the right candidate for the job from our pool of global talents, and we believe ${c} could benefit directly.`,
    intro2: (c, s) =>
      s
        ? `Given ${c}'s work in ${s}, we see concrete ways our programs could support your team, your projects and your growth.`
        : `We see concrete ways our programs could support ${c}'s team, projects and growth.`,
    bullets: [
      "Find the right candidate from a global pool of skilled young talents — volunteers, professionals and teachers.",
      "Build a strong employer brand and gain recognition with our partners group on our website, annual report and media channels.",
      "Expand your organization's impact and drive growth through innovative, purpose-driven collaborations with youth.",
    ],
    snapshot: [
      "Volunteer hiring: Global Volunteer — youth for social-impact, SDG-aligned projects",
      "Intern hiring: Global Talent — skilled young professionals for your HR needs",
      "Teacher hiring: Global Teacher — young educators for educational institutions",
      "Partner branding: special branding options + media exposure across our channels",
    ],
    meeting: (c) =>
      `Would you be open to a brief 20-minute meeting next week to discuss which talent solution fits ${c} best?`,
    moreLabel: "To know more about partnering with AIESEC in Egypt",
    moreUrl: "https://aiesec.org.eg/partner.html",
  },
};

/** Left-accent callout box (same style as the original proposal tool). */
function callout(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>
    <td style="border-left:4px solid ${BLUE};background:#f4f1fc;border-radius:0 10px 10px 0;padding:16px 20px;color:${NAVY};font-size:14px;line-height:1.7;">${inner}</td>
  </tr></table>`;
}

export function proposalEmail(input: ProposalInput): { subject: string; html: string } {
  const p = PITCHES[input.product];
  const company = escapeHtml(input.companyName);
  const sector = input.sector ? escapeHtml(input.sector) : null;
  const subject = p.subject(input.companyName);

  // the phone in the signature opens a WhatsApp chat directly
  const waDigits = input.memberPhone?.replace(/\D/g, "") ?? "";

  const programBadge = p.logo
    ? `<img src="${env.appUrl}/brand/${p.logo}" alt="${p.programName}" height="40" style="height:40px;display:block;border:0;">`
    : `<span style="font-size:17px;font-weight:800;color:${BLUE};letter-spacing:0.2px;">${p.programName}</span>`;

  const html = `<div style="margin:0;padding:0;background:#f4f7fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:24px 10px;"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #dfe8f2;border-top:6px solid ${BLUE};border-radius:16px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:${NAVY};">

  <!-- header: AIESEC logo + program badge (ONE brand color, no company logos) -->
  <tr><td style="padding:22px 32px;border-bottom:1px solid #e8eef6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="left" style="vertical-align:middle;">
        <!-- the LC lockup is 716×408, nearly three times taller in ratio than
             the old AIESEC wordmark that sat here — 34px made it unreadable -->
        <img src="${env.appUrl}/brand/alex-blue.png" alt="AIESEC in Alexandria" height="56" style="height:56px;width:auto;display:block;border:0;">
      </td>
      <td align="right" style="vertical-align:middle;">${programBadge}</td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:30px 32px 36px;font-size:15px;line-height:1.75;">
    <h1 style="margin:0 0 18px;font-size:25px;line-height:1.3;color:${NAVY};font-weight:800;">${p.headline(company)}</h1>

    <p style="margin:0 0 16px;">${p.intro1(company)}</p>
    <p style="margin:0 0 6px;">${p.intro2(company, sector)}</p>

    ${callout(`<b style="display:block;margin-bottom:8px;font-size:15px;">Why this could be a strong fit</b>
      <ul style="margin:0;padding-left:20px;">
        ${p.bullets.map((b) => `<li style="margin:6px 0;">${b}</li>`).join("")}
      </ul>`)}

    <!-- opportunity snapshot + about AIESEC, side by side -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 6px;"><tr>
      <td width="50%" style="vertical-align:top;padding-right:8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border:1px solid #dfe8f2;border-radius:12px;padding:16px 18px;font-size:13.5px;line-height:1.65;">
            <b style="display:block;margin-bottom:8px;font-size:15px;color:${NAVY};">Opportunity snapshot</b>
            <ul style="margin:0;padding-left:18px;">
              ${p.snapshot.map((s) => `<li style="margin:5px 0;">${s}</li>`).join("")}
            </ul>
          </td>
        </tr></table>
      </td>
      <td width="50%" style="vertical-align:top;padding-left:8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="border:1px solid #dfe8f2;border-radius:12px;padding:16px 18px;font-size:13.5px;line-height:1.65;">
            <b style="display:block;margin-bottom:8px;font-size:15px;color:${NAVY};">AIESEC in Alexandria</b>
            AIESEC is a global non-profit, youth-led organization. We support organizations in connecting
            with international youth and designing practical cross-cultural collaborations.
          </td>
        </tr></table>
      </td>
    </tr></table>

    ${input.customNote ? `<p style="margin:18px 0 0;">${escapeHtml(input.customNote)}</p>` : ""}

    ${callout(`<b>Meeting request:</b> ${p.meeting(company)}`)}

    <p style="margin:0 0 16px;">${p.moreLabel}:
      <a href="${p.moreUrl}" style="color:${LINK};font-weight:bold;text-decoration:underline;">${p.moreUrl.replace("https://", "")}</a>
    </p>

    <p style="margin:0;">We look forward to the possibility of collaborating with you.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
      <td style="border-top:1px solid #e8eef6;padding-top:18px;font-size:14px;line-height:1.7;">
        <b style="color:${NAVY};">${escapeHtml(input.memberName)}</b><br>
        ${p.signatureTitle}<br>
        <a href="https://aiesec.org.eg/" style="color:${LINK};font-weight:bold;text-decoration:underline;">AIESEC in Alexandria</a>
        ${input.memberPhone && waDigits ? `<br><a href="https://wa.me/${waDigits}" style="color:${BLUE};text-decoration:underline;">${escapeHtml(input.memberPhone)}</a>` : ""}
        <br>${escapeHtml(input.memberEmail)}
      </td>
    </tr></table>
  </td></tr>

</table>
<!-- this email leaves the LC: "Sodio" is a name out here, never a link (v34.10) -->
<div style="text-align:center;padding:4px 0 2px;">${sodioCredit()}</div>
</td></tr></table>
</div>`;

  return { subject, html };
}
