import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ATTACHMENT_BUDGET_MB,
  PROPOSAL_PDFS,
  PROPOSAL_PDF_LABEL,
  PROPOSAL_PDF_MB,
  attachmentTooBig,
  defaultProposalPdfs,
  proposalPdfFile,
  totalAttachmentMb,
  type ProposalProduct,
} from "@/lib/proposal-pdfs";

/**
 * THE OFFICIAL PROPOSAL DECKS.
 *
 * Two things are worth pinning here, and both have bitten before:
 *
 *  1. The DEFAULT set follows the email being written. B2B accounts shipped
 *     for four releases attaching nothing, because no B2B deck existed and
 *     the default was hard-coded empty rather than derived. Deriving it means
 *     adding a deck is enough — nobody has to remember a second place.
 *
 *  2. Every deck the UI offers must EXIST on disk, at a size Gmail will
 *     actually carry. A missing file only fails at send time, in front of a
 *     member who has already written the email; an oversized one fails in
 *     Gmail with a message nobody can act on.
 */

const PRODUCTS: ProposalProduct[] = ["iGV", "iGTa", "iGTe", "B2B", "BD"];

describe("proposal deck defaults", () => {
  it("attaches the deck that matches the email being written", () => {
    expect(defaultProposalPdfs("B2B")).toEqual(["B2B"]);
    expect(defaultProposalPdfs("iGV")).toEqual(["iGV"]);
    expect(defaultProposalPdfs("iGTa")).toEqual(["iGTa"]);
    expect(defaultProposalPdfs("iGTe")).toEqual(["iGTe"]);
  });

  it("attaches NOTHING to a BD email — its pitch has no deck", () => {
    expect(defaultProposalPdfs("BD")).toEqual([]);
  });

  it("never defaults to a deck that does not exist in the offer list", () => {
    for (const p of PRODUCTS) {
      for (const pdf of defaultProposalPdfs(p)) {
        expect(PROPOSAL_PDFS).toContain(pdf);
      }
    }
  });

  it("labels every offered deck", () => {
    for (const pdf of PROPOSAL_PDFS) {
      expect(PROPOSAL_PDF_LABEL[pdf]).toBeTruthy();
    }
  });
});

describe("the deck files themselves", () => {
  // Gmail refuses attachments over 25 MB and base64 inflates by 4/3, so the
  // ENCODED size is what has to fit. The B2B deck arrived at 26 MB — over the
  // limit before encoding — and was re-compressed to ship.
  const GMAIL_LIMIT = 25 * 1024 * 1024;

  for (const pdf of PROPOSAL_PDFS) {
    it(`${pdf}.pdf exists and fits in an email`, () => {
      const { path, filename } = proposalPdfFile(pdf);
      const full = join(process.cwd(), "proposals", path);
      expect(existsSync(full), `${path} is missing from proposals/`).toBe(true);

      const bytes = statSync(full).size;
      expect(bytes, `${path} is empty`).toBeGreaterThan(1000);
      // 4/3 for base64 — the number Gmail actually weighs
      expect(
        Math.ceil(bytes / 3) * 4,
        `${path} is ${(bytes / 1e6).toFixed(1)} MB — too big to email once base64-encoded`
      ).toBeLessThan(GMAIL_LIMIT);

      expect(filename).toMatch(/\.pdf$/);
    });
  }

  it("the declared MB of every deck matches the real file", () => {
    // the dialog cannot stat a file, so it trusts PROPOSAL_PDF_MB to warn
    // about an oversized attachment set — this is what stops that number
    // drifting the day a deck is replaced
    for (const pdf of PROPOSAL_PDFS) {
      const bytes = statSync(join(process.cwd(), "proposals", proposalPdfFile(pdf).path)).size;
      const realMb = bytes / 1e6;
      expect(
        Math.abs(realMb - PROPOSAL_PDF_MB[pdf]),
        `${pdf}.pdf is ${realMb.toFixed(1)} MB but PROPOSAL_PDF_MB says ${PROPOSAL_PDF_MB[pdf]}`
      ).toBeLessThan(0.6);
    }
  });
});

describe("the attachment budget", () => {
  const GMAIL_LIMIT = 25 * 1024 * 1024;

  it("is small enough that a full budget still encodes under Gmail's limit", () => {
    const rawBytes = ATTACHMENT_BUDGET_MB * 1e6;
    expect(Math.ceil(rawBytes / 3) * 4).toBeLessThan(GMAIL_LIMIT);
  });

  it("lets every DEFAULT set through — a default must never be unsendable", () => {
    for (const p of PRODUCTS) {
      expect(attachmentTooBig(defaultProposalPdfs(p)), `default for ${p}`).toBeNull();
    }
  });

  it("refuses the combination that would be rejected by Google", () => {
    // all four together is ~39 MB raw / 53 MB encoded
    expect(totalAttachmentMb(PROPOSAL_PDFS)).toBeGreaterThan(ATTACHMENT_BUDGET_MB);
    const msg = attachmentTooBig(PROPOSAL_PDFS);
    expect(msg).toContain("MB");
    expect(msg).toMatch(/Untick/);
  });

  it("allows attaching nothing", () => {
    expect(attachmentTooBig([])).toBeNull();
    expect(totalAttachmentMb([])).toBe(0);
  });
});
