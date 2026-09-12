import { describe, it, expect } from "vitest";
import {
  classifyByRules, needsContentCheck, parseContentVerdict, type Verdict,
} from "@/lib/drive-cv-plan";

/**
 * FILES THE NAME COULDN'T SETTLE (v36.5).
 *
 * Reported with a screenshot: "CV_ Tunisia opportunity.pdf" and a Canva export
 * "CV Professionnel Minimaliste Bleu_…pdf" were skipped as "Untitled document"
 * — real CVs, judged by file names that named nobody. Those files are now
 * OPENED and read before the verdict stands; files already recognised for
 * what they are (a certificate, a transcript) are not.
 */

const v = (o: Partial<Verdict>): Verdict => ({
  isCv: false, person: null, product: null, industry: null, reason: null, unsure: false, ...o,
});

describe("which files are opened and read", () => {
  it("opens the two CVs that were skipped as 'Untitled document'", () => {
    expect(needsContentCheck(v({ reason: "Untitled document" }), "CV_ Tunisia opportunity.pdf")).toBe(true);
    expect(
      needsContentCheck(v({ reason: "Untitled document" }), "CV Professionnel Minimaliste Bleu_20250423_205058_0000.pdf")
    ).toBe(true);
  });

  it("opens 'Untitled'-style rejections and anything the AI was unsure of", () => {
    expect(needsContentCheck(v({ reason: "Untitled document" }), "Document from Hibatun🎀.pdf")).toBe(true);
    expect(needsContentCheck(v({ reason: "Untitled document" }), "Professional Resume YT.pdf")).toBe(true);
    expect(needsContentCheck(v({ unsure: true, reason: "no name" }), "IMG_1234.jpg")).toBe(true);
  });

  it("opens a CV nobody could name, never one that already has a name", () => {
    expect(needsContentCheck(v({ isCv: true }), "scan.pdf")).toBe(true);
    expect(needsContentCheck(v({ isCv: true, person: "Ayoub Lasri" }), "Ayoub Lasri CV")).toBe(false);
  });

  it("leaves certificates, transcripts and policies alone", () => {
    expect(needsContentCheck(v({ reason: "Ayoub Lasri's TEFL certificate" }), "TEFL Ayoub Lasri")).toBe(false);
    expect(needsContentCheck(v({ reason: "Transcript" }), "relevé de notes 3 eme année.pdf")).toBe(false);
    expect(
      needsContentCheck(v({ reason: "Policy document" }), "(Make a Copy)_Anti-Substance Abuse Policy_copy.pdf")
    ).toBe(false);
  });
});

describe("reading the AI's answer about one file", () => {
  it("takes a yes with the name written on the CV", () => {
    expect(parseContentVerdict('{"is_cv": true, "person": "Hiba Tounsi", "reason": null}')).toEqual({
      isCv: true, person: "Hiba Tounsi", reason: null,
    });
  });

  it("takes a no with its reason", () => {
    expect(parseContentVerdict('{"is_cv": false, "person": null, "reason": "a job description"}')).toMatchObject({
      isCv: false, reason: "a job description",
    });
  });

  it("returns null for anything unusable, so the name-based verdict stands", () => {
    expect(parseContentVerdict("nope")).toBeNull();
    expect(parseContentVerdict('{"person": "x"}')).toBeNull();
  });
});

describe("the fallback rules", () => {
  it("never throw away a file whose name says CV, even with 'opportunity' in it", () => {
    const { items } = classifyByRules("CV POOL oGT @ in Agadir", [
      { id: "1", name: "CV_ Tunisia opportunity.pdf", mimeType: "application/pdf", size: 1, path: ["GTe"] },
    ]);
    expect(items[0]).toMatchObject({ isCv: true, product: "GTe" });
  });
});
