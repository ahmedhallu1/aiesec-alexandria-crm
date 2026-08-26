import { describe, it, expect } from "vitest";
import {
  buildStoredFileName,
  checkUpload,
  epFolderName,
  fileExtension,
  isDangerousFile,
  MATCH_REVIEW_THRESHOLD,
  matchRequirement,
  parseEpFolderName,
  sanitizeFilename,
  stageKeyFromFolderName,
  zipFileName,
} from "@/lib/cxp/drive";

/**
 * THE DRIVE NAMING + MATCHING TESTS.
 *
 * Two things are being protected here.
 *
 * The FOLDER AND FILE NAMES are a compatibility contract: real EP folders full
 * of real documents already exist under these exact names, and the drive index
 * finds them by parsing those names back out. A "tidier" convention orphans
 * every document the LC has collected this year.
 *
 * The MATCHER decides whether a file someone dropped into Drive counts as a
 * collected document. A false positive is worse than a miss — it marks a
 * requirement satisfied and the LC walks into the audit short — so the weak
 * cases below assert that it stays under the review threshold rather than
 * guessing.
 */

describe("filename safety", () => {
  it("reads extensions", () => {
    expect(fileExtension("passport.PDF")).toBe("pdf");
    expect(fileExtension("no-extension")).toBe("");
    expect(fileExtension(".hidden")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
  });

  it("rejects executables and scripts", () => {
    expect(isDangerousFile("payload.exe")).toBe(true);
    expect(isDangerousFile("script.sh")).toBe(true);
    expect(isDangerousFile("thing.JS")).toBe(true);
    expect(isDangerousFile("passport.pdf")).toBe(false);
    expect(isDangerousFile("stamp.jpg")).toBe(false);
  });

  it("strips directory paths", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\id.png")).toBe("id.png");
  });

  it("strips bidi overrides — the 'photo.png' that is really an .exe", () => {
    const spoof = "photo\u202egnp.exe";
    expect(sanitizeFilename(spoof)).toBe("photognp.exe");
    expect(isDangerousFile(sanitizeFilename(spoof))).toBe(true);
  });

  it("never returns an empty name", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("   ")).toBe("file");
    expect(sanitizeFilename("..")).toBe("file");
  });

  it("keeps the extension when truncating", () => {
    const long = `${"a".repeat(300)}.pdf`;
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("the folder + file naming contract", () => {
  it("puts the ID FIRST, matching the LC's existing folders", () => {
    // real example from Drive: "5583697_1331335 - Hager Ashraf"
    const folder = epFolderName("Hager Ashraf", "5583697_1331335");
    expect(folder).toBe("5583697_1331335 - Hager Ashraf");
    expect(parseEpFolderName(folder)).toBe("5583697_1331335");
  });

  it("survives an EP name containing a dash", () => {
    // the id-first order is what makes this safe: the split takes the FIRST
    // " - ", so any number of dashes in the NAME are harmless
    const folder = epFolderName("Omar El-Deeb", "5583697_1329441");
    expect(folder).toBe("5583697_1329441 - Omar El-Deeb");
    expect(parseEpFolderName(folder)).toBe("5583697_1329441");
  });

  it("parses the EP folders that exist in Drive today", () => {
    for (const [folder, id] of [
      ["6060146_1295898 - Ahmed Khamis", "6060146_1295898"],
      ["5282655_1330970 - ibrahim abdelftah taha kandil", "5282655_1330970"],
      ["245 - Omar", "245"],
    ] as [string, string][]) {
      expect(parseEpFolderName(folder)).toBe(id);
    }
  });

  it("returns undefined for a folder that is not an EP folder", () => {
    // "Communications" / "Health insurance" are topical subfolders, not EPs
    expect(parseEpFolderName("Communications")).toBe(undefined);
    expect(parseEpFolderName("")).toBe(undefined);
  });

  it("maps stage folders back to keys, post-approval first", () => {
    expect(stageKeyFromFolderName("Post Approval")).toBe("post_approval");
    expect(stageKeyFromFolderName("Approval")).toBe("approval");
    expect(stageKeyFromFolderName("Realization")).toBe("realization");
    expect(stageKeyFromFolderName("Finish")).toBe("finish");
    expect(stageKeyFromFolderName("Monthly Communication")).toBe("monthly");
    expect(stageKeyFromFolderName("Random")).toBe(undefined);
  });

  it("builds the stored filename in the old convention", () => {
    const name = buildStoredFileName(
      "111/222",
      "approval",
      "Passport / National ID",
      "scan.pdf",
      new Date(2026, 7, 26, 9, 5)
    );
    expect(name).toBe(
      "111_222 - Approval - Passport _ National ID - 2026-08-26_09-05 - scan.pdf"
    );
  });

  it("names the ZIP the way ECB receives it", () => {
    expect(zipFileName("IGV", "2026-08-27")).toBe("IGV - ECB Submission - 2026-08-27.zip");
  });
});

describe("matching a dropped file to a requirement", () => {
  const match = (name: string) => matchRequirement(name, "IGV", "realization");

  it("matches an obvious name with high confidence", () => {
    const m = match("amina passport.pdf");
    expect(m.requirementKey).toBe("passport");
    expect(m.confidence).toBeGreaterThan(MATCH_REVIEW_THRESHOLD);
  });

  it("matches via an alias", () => {
    expect(match("entry stamp with visa.jpg").requirementKey).toBe("entry_stamp");
    expect(match("health insurance certificate.pdf").requirementKey).toBe(
      "health_insurance"
    );
  });

  it("is not confused by separators or case", () => {
    expect(match("FLIGHT_TICKETS-final.PDF").requirementKey).toBe("flight_tickets");
  });

  it("matches the requirement key itself", () => {
    expect(match("comm_after_arrival.png").requirementKey).toBe("comm_after_arrival");
  });

  it("only offers requirements that belong to the given stage", () => {
    // "contract" is an OGX APPROVAL document; it must not surface here
    expect(match("contract signed.pdf").confidence).toBeLessThanOrEqual(
      MATCH_REVIEW_THRESHOLD
    );
    expect(matchRequirement("contract signed.pdf", "OGV", "approval").requirementKey).toBe(
      "contract_an"
    );
  });

  it("leaves a meaningless name BELOW the review threshold rather than guessing", () => {
    // a false positive marks a requirement collected when it is not — the one
    // failure mode that costs the LC money at audit
    for (const junk of ["IMG_4821.jpg", "scan001.pdf", "WhatsApp Image.jpeg", "final v2.png"]) {
      expect(match(junk).confidence, junk).toBeLessThanOrEqual(MATCH_REVIEW_THRESHOLD);
    }
  });

  it("returns nothing for a stage with no requirements", () => {
    // IGV has no Monthly stage — only the GT products do
    expect(matchRequirement("monthly comm.png", "IGV", "monthly").confidence).toBe(0);
  });

  it("handles an empty name", () => {
    expect(match("").confidence).toBe(0);
  });
});

describe("upload validation", () => {
  const base = {
    epOppId: "111/222",
    stageKey: "approval" as const,
    requirementName: "Passport / National ID",
    now: new Date(2026, 7, 26, 9, 5),
  };

  it("accepts a normal document and returns its stored name", () => {
    const r = checkUpload({ ...base, fileName: "passport.pdf", size: 400_000 });
    expect(r.ok).toBe(true);
    expect(r.storedName).toContain("Passport _ National ID");
  });

  it("rejects executables even when renamed with a path", () => {
    const r = checkUpload({ ...base, fileName: "../evil.exe", size: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("executable");
  });

  it("rejects an empty file", () => {
    expect(checkUpload({ ...base, fileName: "a.pdf", size: 0 }).ok).toBe(false);
  });

  it("rejects an oversized file and says the real size", () => {
    const r = checkUpload({ ...base, fileName: "a.pdf", size: 40 * 1024 * 1024 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("40.0 MB");
  });
});
