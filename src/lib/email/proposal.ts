import { escapeHtml } from "./templates";

/** ICX Proposal Email — generates the ready-to-review company outreach draft
 *  for the 3 ICX products (iGTa / iGTe / iGV), mirroring the LC's proposal
 *  tool: the draft lands in the MEMBER's own Gmail, they review and send. */

export type ProposalProduct = "iGTa" | "iGTe" | "iGV";

export interface ProposalInput {
  product: ProposalProduct;
  companyName: string;
  recipientName: string;
  sector: string | null;
  customNote: string | null;
  attachmentsNote: string | null;
  memberName: string;
  memberRole: string;
  memberPhone: string | null;
  memberEmail: string;
}

const PRODUCT_PITCH: Record<ProposalProduct, { headline: string; body: string; bullets: string[] }> = {
  iGTa: {
    headline: "Global Talent — international professional interns",
    body: "Through our <b>Global Talent</b> program, we connect your company with qualified international talents (6 weeks to 12 months) ready to join your team on-site — bringing new skills, fresh perspectives and a global mindset to your operations.",
    bullets: [
      "Pre-screened international candidates matched to your role requirements",
      "End-to-end support: visa, arrival, onboarding and follow-up handled with AIESEC",
      "A cost-efficient way to bring cross-cultural competence into your team",
    ],
  },
  iGTe: {
    headline: "Global Teacher — international educators for your institution",
    body: "Through our <b>Global Teacher</b> program, we bring experienced international teachers to your institution — strengthening your curriculum with global exposure and native-level language instruction.",
    bullets: [
      "International educators for languages, STEM and more",
      "Cultural exchange that raises your institution's profile",
      "Full support from AIESEC across the placement, from paperwork to follow-up",
    ],
  },
  iGV: {
    headline: "Global Volunteer — international volunteers for your impact projects",
    body: "Through our <b>Global Volunteer</b> program, international volunteers join your projects for 6–8 weeks — adding capacity, energy and cross-cultural perspectives to the causes you drive.",
    bullets: [
      "Motivated international volunteers aligned with the UN SDGs",
      "Zero recruitment overhead — AIESEC manages matching and logistics",
      "A partnership that amplifies your social impact and visibility",
    ],
  },
};

export function proposalDraft(input: ProposalInput): { subject: string; html: string } {
  const pitch = PRODUCT_PITCH[input.product];
  const subject = `Partnership opportunity with AIESEC in Alexandria — ${input.companyName}`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0A2540;line-height:1.7;max-width:640px;">
<p>Dear ${escapeHtml(input.recipientName)},</p>

<p>I hope this email finds you well. My name is <b>${escapeHtml(input.memberName)}</b>,
${escapeHtml(input.memberRole)} at <b>AIESEC in Alexandria</b> — the local chapter of the
world's largest youth-led organization, present in 100+ countries and working with
companies and institutions on international talent and impact programs.</p>

${
  input.sector
    ? `<p>We've been following the great work <b>${escapeHtml(input.companyName)}</b> is doing in the <b>${escapeHtml(input.sector)}</b> field, and we believe there is a strong fit for a partnership.</p>`
    : `<p>We've been following the great work <b>${escapeHtml(input.companyName)}</b> is doing, and we believe there is a strong fit for a partnership.</p>`
}

<p style="margin:18px 0 6px;"><b style="color:#037EF3;">${pitch.headline}</b></p>
<p>${pitch.body}</p>
<ul>
${pitch.bullets.map((b) => `  <li>${b}</li>`).join("\n")}
</ul>

${input.customNote ? `<p>${escapeHtml(input.customNote)}</p>` : ""}
${
  input.attachmentsNote
    ? `<p><i>Attached: ${escapeHtml(input.attachmentsNote)}</i></p><p style="color:#c2410c;"><b>[⚠ Reminder for you: attach the file(s) before sending, then delete this line]</b></p>`
    : ""
}

<p>I would love to schedule a short call or visit to walk you through the details and
explore what a collaboration could look like for ${escapeHtml(input.companyName)}.
Would this week or the next suit you?</p>

<p>Looking forward to hearing from you.</p>

<p style="margin-bottom:2px;">Best regards,</p>
<p style="margin:0;"><b>${escapeHtml(input.memberName)}</b><br>
${escapeHtml(input.memberRole)} · AIESEC in Alexandria<br>
${input.memberPhone ? `${escapeHtml(input.memberPhone)}<br>` : ""}
${escapeHtml(input.memberEmail)}</p>
</div>`;

  return { subject, html };
}
