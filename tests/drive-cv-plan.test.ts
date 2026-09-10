import { describe, it, expect } from "vitest";
import {
  classifyByRules, driveFolderIdFrom, mightBeCv, parseClassification, skipReasonForType,
  type DriveEntry,
} from "@/lib/drive-cv-plan";

/**
 * THE DRIVE CV IMPORT — the parts that don't need Drive (v36.4).
 *
 * The two folders the floor sent are laid out differently — by programme then
 * sector with per-person folders (CV + video + a "needs" note), and by
 * programme with CVs, TEFL certificates and a transcript loose side by side.
 * These pin the rules that stand in when the AI can't be reached, and how the
 * AI's own answer is read.
 */

const pdf = "application/pdf";
const entry = (path: string[], name: string, mimeType = pdf): DriveEntry => ({
  id: `${path.join("/")}/${name}`,
  name,
  mimeType,
  size: 200_000,
  path,
});

describe("driveFolderIdFrom", () => {
  it("reads every link shape Drive hands out", () => {
    const id = "1aTuwiXe0Tgl7RJjby0FtUZ_n7d5IvT1K";
    expect(driveFolderIdFrom(`https://drive.google.com/drive/folders/${id}`)).toBe(id);
    expect(driveFolderIdFrom(`https://drive.google.com/drive/u/0/folders/${id}?usp=sharing`)).toBe(id);
    expect(driveFolderIdFrom(`https://drive.google.com/open?id=${id}`)).toBe(id);
    expect(driveFolderIdFrom(`  ${id}  `)).toBe(id);
  });

  it("refuses what isn't a folder link", () => {
    expect(driveFolderIdFrom("https://example.com")).toBeNull();
    expect(driveFolderIdFrom("")).toBeNull();
  });
});

describe("what is worth reading as a CV", () => {
  it("documents and scans yes, videos and spreadsheets no", () => {
    expect(mightBeCv({ mimeType: pdf })).toBe(true);
    expect(mightBeCv({ mimeType: "image/jpeg" })).toBe(true);
    expect(mightBeCv({ mimeType: "application/vnd.google-apps.document" })).toBe(true);
    expect(mightBeCv({ mimeType: "video/mp4" })).toBe(false);
    expect(mightBeCv({ mimeType: "application/vnd.google-apps.spreadsheet" })).toBe(false);
    expect(skipReasonForType("video/mp4")).toBe("a video");
  });
});

describe("the rules, when the AI can't be reached", () => {
  it("reads the first example: programme → sector → person folders", () => {
    const docs = [
      entry(["oGTa", "IT", "oumayma sghaier"], "oumayma-sghaier-cv.pdf"),
      entry(["oGTa", "Finance"], "dhawedi ranim Fin.pdf"),
      entry(["oGTe", "Mariem Echi"], "Mariem Echi's CV.PDF"),
      entry(["oGTe", "Mariem Echi"], "Mariem Echi needs", "application/vnd.google-apps.document"),
    ];
    const { items } = classifyByRules("CVs 26.27", docs);
    expect(items[0]).toMatchObject({ isCv: true, person: "Oumayma Sghaier", product: "GTa", industry: "IT/Software" });
    expect(items[1]).toMatchObject({ isCv: true, product: "GTa", industry: "Finance" });
    expect(items[2]).toMatchObject({ isCv: true, person: "Mariem Echi", product: "GTe" });
    expect(items[3].isCv).toBe(false); // the "needs" note
  });

  it("reads the second example: certificates and transcripts are not CVs", () => {
    const docs = [
      entry(["GTe", "Ayoub Lasri"], "Ayoub Lasri CV"),
      entry(["GTe", "Ayoub Lasri"], "TEFL Ayoub Lasri"),
      entry(["GTe", "Rachid Ait Ahmed"], "TESOL/TEFL  Rachid Ait Ahmed "),
      entry(["GTa"], "relevé de notes 3 eme année.pdf"),
      entry(["GTa"], "(Make a Copy)_Anti-Substance Abuse Policy_copy.pdf"),
      entry(["GTa"], "houda oumghar cv.pdf"),
    ];
    const { items, lcGuess } = classifyByRules("CV POOL oGT @ in Agadir", docs);
    expect(items.map((i) => i.isCv)).toEqual([true, false, false, false, false, true]);
    expect(items[0]).toMatchObject({ person: "Ayoub Lasri", product: "GTe" });
    expect(items[5]).toMatchObject({ person: "Houda Oumghar", product: "GTa" });
    expect(lcGuess).toBe("Agadir");
  });
});

describe("reading the AI's answer", () => {
  it("maps each verdict back to its document and snaps the fields", () => {
    const raw = JSON.stringify({
      lc_guess: "Agadir",
      items: [
        { n: 0, is_cv: true, person: "Ayoub Lasri", product: "GTe", industry: "Education", reason: null },
        { n: 1, is_cv: false, person: null, product: "GTe", industry: null, reason: "a TEFL certificate" },
        { n: 2, is_cv: true, person: "Houda", product: "Global Talent", industry: "IT", reason: null },
      ],
    });
    const out = parseClassification(raw, 3)!;
    expect(out.lcGuess).toBe("Agadir");
    expect(out.items[0]).toMatchObject({ isCv: true, product: "GTe", industry: "Education" });
    expect(out.items[1]).toMatchObject({ isCv: false, reason: "a TEFL certificate" });
    // anything outside the allowed values is dropped, never guessed
    expect(out.items[2]).toMatchObject({ product: null, industry: null });
  });

  it("treats a document the AI left out as NOT a CV", () => {
    const out = parseClassification(JSON.stringify({ items: [{ n: 0, is_cv: true }] }), 2)!;
    expect(out.items[1].isCv).toBe(false);
  });

  it("returns null for an unusable reply, so the rules take over", () => {
    expect(parseClassification("not json", 2)).toBeNull();
    expect(parseClassification(JSON.stringify({ nope: 1 }), 2)).toBeNull();
    expect(parseClassification("```json\n{\"items\":[]}\n```", 0)).toEqual({ lcGuess: null, items: [] });
  });
});
