import { describe, it, expect } from "vitest";
import { mapHeaders, trackerPhone, SIGNUP_TABS } from "@/lib/google/signups";
import { signupBatchLabel, signupBatchesFor, SIGNUP_BATCHES } from "@/lib/types";

/**
 * OGV 26.2 — THE THIRD TRACKER GENERATION (v37.9).
 *
 * "Alexandria - OGV 26.2 New Signups" became the New batch; the 26.1 [New]
 * Main tab moved to Old and the 26.1 [Old] tab to Older. Its header row
 * differs from 26.1's (no Email, "Campaign Name", "Contact date", an "AIESEC
 * Representative" column) and its Phone column lost the leading 0. These pin
 * the mapping against the sheets' REAL header rows, copied verbatim.
 */

const HEADERS_262 = [
  "Signed up at", "EP ID", "Name", "Phone", "Gender", "DOB", "Person Status",
  "Program", "Backgrounds", "Home LC", "AIESEC Representative", "Campus",
  "Campaign Name", "Assigned to", "EP Manager", "Contact Status", "Interested",
  "Comment", "VP Comment", "Country", "Status", "Out of Process",
  "Assigned Date", "Contact date",
];

const HEADERS_261_MAIN = [
  "EP ID", "EP Name", "Signed up at", "Phone", "Email", "Gender", "DOB",
  "Status", "Backgrounds", "Program", "Home LC", "campaign Tag", "Assigned to ",
  "Contacted", "Intersted ", "Comments", "", "VP Comment", "Country", "Status",
  "Out of Process", "Assigned Date", "Assigned date", "Contacted Date",
];

describe("mapHeaders — OGV 26.2", () => {
  const H = mapHeaders(HEADERS_262);

  it("finds every intake column the sheet has", () => {
    expect(H).toMatchObject({
      signed_up_at: 0, ep_id: 1, name: 2, phone: 3, gender: 4, dob: 5,
      person_status: 6, program: 7, background: 8, home_lc: 9,
      referral: 10, // AIESEC Representative
      campaign: 12, // Campaign Name
    });
    expect(H.email).toBeUndefined();
  });

  it("finds every column the write-back writes", () => {
    expect(H).toMatchObject({
      assigned_name: 13, contact_status: 15, interested: 16, comment: 17,
      vp_comment: 18, country: 19, status: 20, out_of_process: 21,
      assigned_date: 22,
      contacted_date: 23, // "Contact date"
    });
  });

  it("the single Status column is the VP status, not the person status", () => {
    expect(H.status).toBe(20);
    expect(H.person_status).toBe(6);
  });

  it("Campus and EP Manager stay unmapped (empty on the sheet)", () => {
    expect(Object.values(H)).not.toContain(11);
    expect(Object.values(H)).not.toContain(14);
  });
});

describe("mapHeaders — OGV 26.1 Main is unchanged", () => {
  const H = mapHeaders(HEADERS_261_MAIN);
  it("keeps its 26.1 mapping", () => {
    expect(H).toMatchObject({
      ep_id: 0, name: 1, signed_up_at: 2, phone: 3, email: 4,
      person_status: 7, status: 19, campaign: 11, assigned_name: 12,
      contact_status: 13, interested: 14, comment: 15, vp_comment: 17,
      assigned_date: 21, contacted_date: 23,
    });
    expect(H.referral).toBeUndefined();
  });
});

describe("trackerPhone", () => {
  it("puts the eaten leading 0 back on Egyptian mobiles", () => {
    expect(trackerPhone("1012345678", true)).toBe("01012345678");
    expect(trackerPhone("1112345678", true)).toBe("01112345678");
    expect(trackerPhone("1212345678", true)).toBe("01212345678");
    expect(trackerPhone("1512345678", true)).toBe("01512345678");
    expect(trackerPhone("12 77301040", true)).toBe("01277301040");
  });

  it("only when the tab asks for it", () => {
    expect(trackerPhone("1012345678")).toBe("1012345678");
  });

  it("converts Arabic-Indic digits and drops bidi marks", () => {
    expect(trackerPhone("٠١٠٠٥٨١٨٧٧٨", true)).toBe("01005818778");
    expect(trackerPhone("‏1129922842", true)).toBe("01129922842");
    expect(trackerPhone("٠1555284125", true)).toBe("01555284125");
  });

  it("leaves anything that isn't a bare 10-digit mobile as typed", () => {
    expect(trackerPhone("01012345678", true)).toBe("01012345678");
    expect(trackerPhone("+201012345678", true)).toBe("+201012345678");
    expect(trackerPhone("10284702394", true)).toBe("10284702394"); // 11 digits — ambiguous
    expect(trackerPhone("1312345678", true)).toBe("1312345678"); // not a mobile prefix
    expect(trackerPhone("‏ 012028013", true)).toBe("012028013");
  });

  it("placeholders are not phones", () => {
    expect(trackerPhone(null, true)).toBeNull();
    expect(trackerPhone("-", true)).toBeNull();
    expect(trackerPhone("deleted phone number", true)).toBeNull();
  });
});

describe("SIGNUP_TABS", () => {
  const by = (s: string) => SIGNUP_TABS.find((t) => t.source === s);

  it("OGV runs New → Old → Older; OGT New/Old untouched", () => {
    expect(by("ogv_262")?.batch).toBe("new");
    expect(by("ogv_main")?.batch).toBe("old");
    expect(by("ogv_old")?.batch).toBe("older");
    expect(by("ogt_new")?.batch).toBe("new");
    expect(by("ogt_old")?.batch).toBe("old");
  });

  it("the 26.2 sheet is wired to its Main tab", () => {
    expect(by("ogv_262")).toMatchObject({
      fn: "OGV",
      spreadsheetId: "1Lgnl3XRQ4RbBgN6zLKSgkH6Jf-uYRDCFQmrsPkoPHRI",
      tab: "Main",
      restorePhoneZero: true,
      keepCampaignWhenBlank: true,
    });
  });

  it("every tab repairs phones (OGV v37.9, OGT v37.9.1)", () => {
    for (const t of SIGNUP_TABS) expect(t.restorePhoneZero).toBe(true);
  });

  it("sources and (spreadsheet, tab) pairs are unique", () => {
    const sources = SIGNUP_TABS.map((t) => t.source);
    expect(new Set(sources).size).toBe(sources.length);
    const tabs = SIGNUP_TABS.map((t) => `${t.spreadsheetId}/${t.tab}`);
    expect(new Set(tabs).size).toBe(tabs.length);
    expect(sources).not.toContain("referral");
  });

  it("each function has exactly one New tab", () => {
    for (const fn of ["OGT", "OGV"])
      expect(SIGNUP_TABS.filter((t) => t.fn === fn && t.batch === "new")).toHaveLength(1);
  });

  it("every tab's batch is one the database accepts", () => {
    for (const t of SIGNUP_TABS) expect(SIGNUP_BATCHES).toContain(t.batch);
  });
});

describe("batch labels", () => {
  it("labels all three, and falls back to Old", () => {
    expect(signupBatchLabel("new")).toBe("New");
    expect(signupBatchLabel("old")).toBe("Old");
    expect(signupBatchLabel("older")).toBe("Older");
    expect(signupBatchLabel(null)).toBe("Old");
  });

  it("OGT never offers Older; OGV and the all-functions view do", () => {
    expect(signupBatchesFor("OGT")).toEqual(["new", "old"]);
    expect(signupBatchesFor("OGV")).toEqual(["new", "old", "older"]);
    expect(signupBatchesFor(null)).toEqual(["new", "old", "older"]);
  });
});
