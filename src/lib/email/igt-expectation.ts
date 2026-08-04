/**
 * THE INCOMING (IGT) EXPECTATION MAIL — v33.3.
 *
 * The first thing an incoming EP reads from AIESEC in Alexandria: what their
 * project is, how they get a visa, what to expect of Egypt, and who to call.
 * It was being retyped by hand for every EP, which is how a link rots or a
 * rule goes missing from one EP's copy and not another's.
 *
 * WHAT VARIES is deliberately tiny — the EP's name, the project, the year,
 * and whoever is VP this term. Everything else is the LC's standing promise
 * and is fixed here, WORD FOR WORD from the mail the IGT VP actually sends.
 *
 * THE LINKS ARE THE POINT. An EP who cannot reach the invitation-letter form
 * cannot get a visa, so every one of them stays a real anchor — never pasted
 * as bare text, and never a tracking redirect (the source mail carried a YAMM
 * redirect on aiesec.org; it is replaced with the real address, which will
 * still resolve in a year).
 */

/** The standing links. Changing one here changes it for every future EP —
 *  which is the entire reason they live in one place. */
export const IGT_LINKS = {
  invitationLetter:
    "https://docs.google.com/forms/d/e/1FAIpQLSe10GRmXbbqizAxZfLpnxO2MacYALM9USFGqRAIlw5EA9rZtw/viewform",
  visaGuide:
    "https://docs.google.com/spreadsheets/d/1RRDjcDh-mjgU4Y0B57YPDF65-ReWbAV86Rx-jTr-uqk/edit?gid=453735580#gid=453735580",
  tourismGuide: "https://www.experienceegypt.eg/files/Egypt%20Tourism%20Guide-Eng.pdf",
  costOfLiving: "https://www.numbeo.com/cost-of-living/in/Alexandria",
  aiesec: "https://www.aiesec.org",
} as const;

/** Always on Cc — the MC's customer-support inbox is the EP's fallback when
 *  the term changes and the VP who wrote this is gone. */
export const IGT_MAIL_CC = "customer.support@aiesec.net.eg";

const BLUE = "#037EF3";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const a = (href: string, text: string) =>
  `<a href="${href}" style="color:${BLUE};text-decoration:underline;">${text}</a>`;

export interface IgtExpectationInput {
  /** the EP this is for — "Yusra Irfan" */
  epName: string;
  /** their opportunity — "English Teacher" */
  projectName: string;
  /** the exchange year — "2026" */
  year: string;
  /** the VP writing it (filled in automatically from who is signed in) */
  senderName: string;
  senderPosition: string;
  senderEmail: string;
  senderPhone: string | null;
}

/** Builds the subject + HTML. Nothing here touches Gmail: the VP reviews and
 *  edits this before anything leaves their mailbox. */
export function igtExpectationEmail(o: IgtExpectationInput): {
  subject: string;
  html: string;
} {
  const ep = esc(o.epName.trim());
  const project = esc(o.projectName.trim());
  const year = esc(o.year.trim());
  const vp = esc(o.senderName.trim());
  const vpEmail = esc(o.senderEmail.trim());
  const phone = (o.senderPhone ?? "").trim();
  const waDigits = phone.replace(/[^\d]/g, "");

  const li = (html: string) => `<li style="margin:0 0 10px 0;">${html}</li>`;
  const p = (html: string) => `<p style="margin:0 0 14px 0;">${html}</p>`;

  const html = `
<div style="font-family:Lato,Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1f2937;">
  ${p("Hello, dear future Exchange Participant,")}
  ${p(`<b>${ep},</b>`)}
  ${p("I hope this email finds you well.")}
  ${p(
    `First of all, let me introduce myself. I'm <b>${vp}</b> from AIESEC in Alexandria. This means I am the final person responsible for all the incoming global talent/teaching exchanges at AIESEC in Alexandria. Congratulations, you are one step closer to becoming one of our exchange participants for ${year}. We are really excited to meet you!!`
  )}
  ${p(
    "Please read this email carefully. In this email you will find some information that you will need during your stay in Egypt and that might answer most of your questions."
  )}

  ${p(`<b>AIESEC in Alexandria Project details:</b>`)}
  <ul style="margin:0 0 14px 0;padding-left:22px;">
    ${li(`Your project name is <b>${project}</b>`)}
    ${li("Your IPS [Incoming Preparation Seminar] date will be given to you upon your arrival.")}
  </ul>

  ${p(
    "There are a few things you should know before you come to Egypt, which I will introduce to you in this email; therefore, read it carefully and star this email!"
  )}

  <ol style="margin:0 0 14px 0;padding-left:22px;">
    ${li(
      `Our terms change per semester and per year (for vice presidents like me). If you are coming next year, my successor and his new team will be supporting you. We have a database of all of our people that are coming in the future; therefore, other AIESECers in the future might contact you if I am not here anymore. If you are feeling lost, you can send an email to ${a(
        `mailto:${vpEmail}`,
        vpEmail
      )}.`
    )}
    ${li(
      `<b>Arrival Pick-up:</b> We need to know when you are coming so we can support you. Once your flight tickets are booked, please contact us directly via <b>WhatsApp</b> or <b>email</b> with your arrival details. Please provide this information at least 1 week to 72 hours before your arrival date. For any notification sent after this timeframe, AIESEC in Alexandria will not be responsible for the pickup, or extra charges may be applied.
      <br><i>Note: you might have to wait at the airport with the AIESEC representative, and there might be other interns picked up with you.</i>`
    )}
    ${li(
      `<b>Invitation Letter:</b> For you to apply for a visa or come to Egypt, you need a document saying that you are coming with AIESEC. Once you are ready to apply for a visa, fill out the following form: ${a(
        IGT_LINKS.invitationLetter,
        "AIESEC in Egypt Invitation Letter"
      )}`
    )}
    ${li(
      `<b>Visa Acquisition:</b> Check how to acquire your visa through this link: ${a(
        IGT_LINKS.visaGuide,
        "Guide to EGYPT VISA REQUIREMENTS"
      )}`
    )}
    ${li(
      `<b>About Egypt:</b> check our National Booklet with information about the country, prices, weather, and safety here: ${a(
        IGT_LINKS.tourismGuide,
        "Egypt Tourism Guide"
      )}`
    )}
    ${li(
      "<b>Accommodation:</b> you will be in apartments. We will provide you with the location before you arrive or upon arrival, but don't worry, you will stay in the region of AIESEC in Alexandria. We will be supporting you when it comes to dealing with the landlord."
    )}
    ${li(
      `<b>Departure support:</b> Once you are leaving Egypt, AIESEC is here to guide you to go back to the airport, although we do not take you there.
      <ul style="margin:8px 0 0 0;padding-left:20px;">
        <li style="margin:0 0 6px 0;">If you are in Cairo, you can take an Uber or a Careem ("Egyptian Uber").</li>
        <li>If you are outside Cairo, you will take a bus to Cairo and then an Uber or Careem.</li>
      </ul>`
    )}
    ${li(
      `<b>More expectations:</b> Egypt has a strong base of values and a strong military institution.
      <ul style="margin:8px 0 0 0;padding-left:20px;">
        <li style="margin:0 0 6px 0;">Do not take pictures of national or military buildings.</li>
        <li style="margin:0 0 6px 0;">Try not to wear small shorts or a tank top; show the minimum you can from your skin (mainly legs). Swimsuits are fine at the beach.</li>
        <li style="margin:0 0 6px 0;">Girls do not need to wear a scarf; it is not mandatory.</li>
        <li style="margin:0 0 6px 0;">Do not drink on the streets; this is illegal.</li>
        <li style="margin:0 0 6px 0;">Avoid physical contact with people of the opposite sex.</li>
        <li style="margin:0 0 6px 0;">In accommodations, you cannot bring a person of a different sex. In Egypt, only married couples can stay together under the same roof.</li>
        <li>Do not travel to Israel, Ethiopia, and/or Libya while on your exchange due to conflictual situations.</li>
      </ul>`
    )}
    ${li(
      "<b>Standards Provided:</b> Through this email, we are providing (4) Expectation Setting, (5) Visa and Work Permit, (6) Arrival Pickup, and (15) Departure Support."
    )}
    ${li(
      `<b>Work Requirements:</b> You must attend all working days stated in the opportunity.
      <ul style="margin:8px 0 0 0;padding-left:20px;">
        <li style="margin:0 0 6px 0;">Request leave or early departure in advance and wait for company confirmation.</li>
        <li style="margin:0 0 6px 0;">Procrastinating or not fulfilling your job description will lead to consequences.</li>
        <li>Dress code: You can dress casually, but you should have a formal one.</li>
      </ul>`
    )}
    ${li(
      `<b>Cost of Living:</b> Check daily life costs here: ${a(
        IGT_LINKS.costOfLiving,
        "Cost of Living in Alexandria"
      )}.`
    )}
    ${li(
      "The working hours will be 40 hours per week and there will be 2 days off per week (further details about the exact starting and ending time will be discussed with you and the managers in the center; it's flexible)."
    )}
  </ol>

  ${p("If you still have any doubts, please do not hesitate to contact me.")}
  ${p(`<b>PLEASE CONFIRM BY REPLYING ALL ON GETTING THIS MAIL!</b>`)}

  <div style="margin-top:22px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:14px;line-height:1.6;color:#374151;">
    <p style="margin:0 0 4px 0;">Best regards,</p>
    <p style="margin:0;font-weight:700;color:#111827;">${vp}</p>
    <p style="margin:0;">${esc(o.senderPosition)}</p>
    <p style="margin:0;">AIESEC in Alexandria.</p>
    <p style="margin:8px 0 0 0;">${a(IGT_LINKS.aiesec, "www.aiesec.org")}</p>
    ${
      phone
        ? `<p style="margin:0;">WhatsApp: ${a(`https://wa.me/${waDigits}`, esc(phone))}</p>`
        : ""
    }
    <p style="margin:0;">${a(`mailto:${vpEmail}`, vpEmail)}</p>
    <p style="margin:8px 0 0 0;color:#6b7280;">The world's largest youth-run organization.</p>
    <p style="margin:0;color:#6b7280;">The international platform for young people to explore and develop their potential.</p>
  </div>
</div>`.trim();

  return { subject: `Expectation mail - ${o.epName.trim()}`, html };
}
