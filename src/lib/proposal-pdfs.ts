/** THE OFFICIAL PROPOSAL DECKS — shape and defaults, and NOTHING ELSE.
 *
 *  ⚠️ This file exists so the Proposal dialog (a CLIENT component) can read
 *  these VALUES without dragging `email/proposal.ts` — and through it the
 *  whole 1,500-line template tree and `env` — into the browser bundle. Same
 *  reason `api-scope.ts` exists (v34.6). Keep it import-free.
 *
 *  The files themselves live in `proposals/<key>.pdf` and are bundled into the
 *  serverless function by `outputFileTracingIncludes` in next.config.ts. */

/** What an outreach email can be WRITTEN for. */
export type ProposalProduct = "iGTa" | "iGTe" | "iGV" | "B2B" | "BD";

/** What there is a DECK for. BD is deliberately absent: its pitch is Talent
 *  Solutions (aiesec.org.eg/partner.html) and the LC has never had a deck for
 *  it, so a BD email carries no ready attachment. */
export type ProposalPdf = "B2B" | "iGV" | "iGTa" | "iGTe";

export const PROPOSAL_PDFS: readonly ProposalPdf[] = ["B2B", "iGV", "iGTa", "iGTe"];

export const PROPOSAL_PDF_LABEL: Record<ProposalPdf, string> = {
  B2B: "B2B — the partnership proposal (iGTa · iGTe · iGV)",
  iGV: "iGV — Global Volunteer",
  iGTa: "iGTa — Global Talent",
  iGTe: "iGTe — Global Teacher",
};

/** WHAT RIDES ALONG BY DEFAULT: the deck that matches the email actually
 *  being sent (v34.8).
 *
 *  B2B accounts used to default to attaching NOTHING (v20), for the plain
 *  reason that no B2B deck existed. One does now, so a B2B partnership email
 *  carries the B2B partnership proposal, and switching the body to a single
 *  product switches the deck with it. BD keeps its empty default — there is
 *  no BD deck to send. */
export function defaultProposalPdfs(body: ProposalProduct): ProposalPdf[] {
  return body === "BD" ? [] : [body];
}

/** The file in `proposals/` and the name the recipient sees on it. */
export function proposalPdfFile(pdf: ProposalPdf): { path: string; filename: string } {
  return { path: `${pdf}.pdf`, filename: `AIESEC Alexandria — ${pdf} Proposal.pdf` };
}

// ------------------------------------------------------- how much fits in one email

/** APPROXIMATE ON-DISK SIZE OF EACH DECK, in megabytes.
 *
 *  The dialog runs in the browser and cannot stat a file, but it has to be
 *  able to say "that's too much to email" BEFORE the member writes the email.
 *  `tests/proposal-pdfs.test.ts` asserts every number here against the real
 *  file, so it cannot quietly drift when a deck is replaced. */
export const PROPOSAL_PDF_MB: Record<ProposalPdf, number> = {
  B2B: 8.4,
  iGV: 12.4,
  iGTa: 9.4,
  iGTe: 9.4,
};

/** WHAT GMAIL WILL ACTUALLY CARRY.
 *
 *  Gmail refuses a message over 25 MB, and it weighs the message AFTER base64
 *  encoding, which inflates by 4/3. So the budget for the RAW bytes is 25 × ¾
 *  minus room for the HTML body and MIME overhead. Attaching all four decks
 *  is 39 MB raw / 53 MB encoded — the send would be rejected by Google with a
 *  message the member can do nothing with, which is why this is checked
 *  up-front on both sides. */
export const ATTACHMENT_BUDGET_MB = 17.5;

export const totalAttachmentMb = (pdfs: readonly ProposalPdf[]): number =>
  pdfs.reduce((n, p) => n + PROPOSAL_PDF_MB[p], 0);

/** Null when the set fits; otherwise the sentence to show the member. */
export function attachmentTooBig(pdfs: readonly ProposalPdf[]): string | null {
  const mb = totalAttachmentMb(pdfs);
  if (mb <= ATTACHMENT_BUDGET_MB) return null;
  return `Those proposals add up to ${mb.toFixed(1)} MB — more than an email can carry (${ATTACHMENT_BUDGET_MB} MB). Untick one and send the rest, or send the others in a follow-up.`;
}
