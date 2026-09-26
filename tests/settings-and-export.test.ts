import { describe, expect, it } from "vitest";
import { safeSheetName, toCsv } from "@/lib/export/book";
import { resolveMemberSettings, withPersonalDefault } from "@/lib/member-settings";
import { resolveHandover, spreadsheetIdFrom, termLabelOf } from "@/lib/lc-term";
import { accountFiltersFromParams, keepCsv } from "@/lib/filters-from-params";
import { pageSizeOf } from "@/lib/page-size";

describe("export files (v37.2)", () => {
  it("writes CSV with a BOM, quoting commas and quotes", () => {
    const csv = toCsv({ name: "x", columns: ["Name", "Note"], rows: [["Ahmed, H", 'say "hi"'], [null, 3]] });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Ahmed, H","say ""hi"""');
    expect(csv).toContain(",3");
  });

  it("never lets a cell run as a formula in a spreadsheet", () => {
    const csv = toCsv({ name: "x", columns: ["a"], rows: [["=HYPERLINK(\"http://evil\")"], ["+201099019374"], ["@SUM(A1)"]] });
    expect(csv).not.toMatch(/\n=HYPERLINK/);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+201099019374");
    expect(csv).toContain("'@SUM");
  });

  it("keeps Excel tab names legal and unique", () => {
    const used = new Set<string>();
    expect(safeSheetName("Approvals: by person / MM", used)).toBe("Approvals  by person   MM");
    expect(safeSheetName("x".repeat(40), used)).toHaveLength(31);
    expect(safeSheetName("Leaderboard", used)).toBe("Leaderboard");
    expect(safeSheetName("Leaderboard", used)).toBe("Leaderboard (2)");
  });
});

describe("the same filters as the page", () => {
  it("drops bad picks one by one instead of the whole filter", () => {
    expect(keepCsv("GTa,nope,GTe", ["GTa", "GTe"])).toBe("GTa,GTe");
    expect(keepCsv("nope", ["GTa"])).toBeUndefined();
  });

  it("never reads the archive unless the viewer may", () => {
    expect(accountFiltersFromParams({ archived: "1" }, { archiveAllowed: false }).archived).toBe(false);
    expect(accountFiltersFromParams({ archived: "1" }, { archiveAllowed: true }).archived).toBe(true);
    expect(accountFiltersFromParams({ fn: "DROP TABLE" }, { archiveAllowed: true }).fn).toBeUndefined();
  });
});

describe("my defaults", () => {
  it("is empty (the system's own defaults) until someone sets one", () => {
    expect(resolveMemberSettings(null).defaults).toEqual({ home: null, dashboardLane: null, pageSize: null, signupsView: null });
  });

  it("keeps notification switches when a default is saved, and clears with null", () => {
    const withOff = { notify: { streak: { email: false } } };
    const saved = withPersonalDefault(withOff, "home", "/signups");
    const r = resolveMemberSettings(saved);
    expect(r.defaults.home).toBe("/signups");
    expect(r.notify.streak.email).toBe(false);
    expect(resolveMemberSettings(withPersonalDefault(saved, "home", null)).defaults.home).toBeNull();
  });

  it("refuses a home that isn't an in-app path", () => {
    expect(resolveMemberSettings({ defaults: { home: "https://evil.example" } }).defaults.home).toBeNull();
  });

  it("uses my rows-per-page only when the URL names none, and only a real size", () => {
    expect(pageSizeOf(undefined, 50)).toBe(50);
    expect(pageSizeOf("100", 50)).toBe(100);
    expect(pageSizeOf(undefined, 9999)).toBe(20);
  });
});

describe("the handover", () => {
  it("cleans what is stored — junk links and empty notes go", () => {
    const h = resolveHandover({
      general: "  Read the IGV partners list first  ",
      perFunction: { IGV: "Three deals open", OGT: "   " },
      links: [{ label: "Drive", url: "https://drive.google.com/x" }, { label: "bad", url: "javascript:alert(1)" }],
    });
    expect(h.general).toBe("Read the IGV partners list first");
    expect(h.perFunction).toEqual({ IGV: "Three deals open" });
    expect(h.links).toEqual([{ label: "Drive", url: "https://drive.google.com/x" }]);
  });

  it("names the term and reads a planning sheet from its link", () => {
    expect(termLabelOf(2026)).toBe("26.27");
    expect(termLabelOf(2099)).toBe("99.00");
    expect(spreadsheetIdFrom("https://docs.google.com/spreadsheets/d/1BF4nh017y12glrOzfQBNarS2tNya9P7QInvpE11HC5I/edit#gid=0"))
      .toBe("1BF4nh017y12glrOzfQBNarS2tNya9P7QInvpE11HC5I");
    expect(spreadsheetIdFrom("not a link")).toBeNull();
  });
});
