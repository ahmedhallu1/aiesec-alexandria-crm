import { describe, it, expect } from "vitest";
import { hasLetters, looksLikeEmail, looksLikePhone } from "@/lib/member-fields";
import { personalPageSize, pageSizeOf, DEFAULT_PAGE_SIZE } from "@/lib/page-size";
import { planFnOfProduct, planFnsOfLane, productsOfLane } from "@/lib/icx-approvals";
import { functionDefaults, resolveFunctionSettings } from "@/lib/function-settings";
import {
  canRunLcTools, canSeePlanning, canWorkArchived, fnSetting, icxFunctions, isB2B, isB2C, isBd,
  type Viewer,
} from "@/lib/rbac";

/** Pure helpers Jules flagged as untested (v37.10) — the ones that really
 *  were. Each one gates something people see, so each is pinned. */

const v = (over: Partial<Viewer> = {}): Viewer =>
  ({
    id: "x", name: "X", nickname: null, email: null, phone: null,
    functions: [], sub_functions: [], role: "Member",
    stakeholder_name: null, stakeholder_id: null, team_name: null, is_active: true,
    google_refresh_token: null, isAdmin: false, teamMemberIds: [], ...over,
  }) as Viewer;

describe("member-fields shape checks", () => {
  it("looksLikeEmail needs text on both sides of the @", () => {
    expect(looksLikeEmail("hana@aiesec.net")).toBe(true);
    expect(looksLikeEmail("Hana @ home")).toBe(false);
    expect(looksLikeEmail("@hana")).toBe(false);
  });
  it("looksLikePhone: mostly digits, Arabic digits included", () => {
    expect(looksLikePhone("+20 101 234 5678")).toBe(true);
    expect(looksLikePhone("٠١٠١٢٣٤٥٦٧٨")).toBe(true);
    expect(looksLikePhone("1234")).toBe(false); // too short to be anything
    expect(looksLikePhone("Room 12345 Building A Hall")).toBe(false);
  });
  it("hasLetters counts Arabic as letters", () => {
    expect(hasLetters("هنا")).toBe(true);
    expect(hasLetters("Al")).toBe(true);
    expect(hasLetters("A")).toBe(false);
    expect(hasLetters("12-34")).toBe(false);
    expect(hasLetters("A", 1)).toBe(true);
  });
});

describe("personal page size", () => {
  it("reads the saved default, or null", () => {
    expect(personalPageSize({ settings: { defaults: { pageSize: 50 } } })).toBe(50);
    expect(personalPageSize({ settings: { defaults: {} } })).toBeNull();
    expect(personalPageSize({ settings: null })).toBeNull();
    expect(personalPageSize({})).toBeNull();
    expect(personalPageSize({ settings: { defaults: { pageSize: "50" } } })).toBeNull();
  });
  it("a URL size wins, a saved one comes next, anything odd falls back", () => {
    expect(pageSizeOf("100", 50)).toBe(100);
    expect(pageSizeOf(undefined, 50)).toBe(50);
    expect(pageSizeOf(undefined, 33)).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("ICX approvals lane maps", () => {
  it("IGV counts GV; IGT counts GTa + GTe", () => {
    expect(productsOfLane("IGV")).toEqual(["GV"]);
    expect(productsOfLane("IGT")).toEqual(["GTa", "GTe"]);
    expect(planFnsOfLane("IGV")).toEqual(["IGV"]);
    expect(planFnsOfLane("IGT")).toEqual(["IGTa", "IGTe"]);
  });
  it("each product maps to its planning-sheet row", () => {
    expect(planFnOfProduct("GV")).toBe("IGV");
    expect(planFnOfProduct("GTa")).toBe("IGTa");
    expect(planFnOfProduct("GTe")).toBe("IGTe");
  });
});

describe("rbac function predicates", () => {
  it("B2B and BD are one crew for isB2B, functions OR sub-functions", () => {
    expect(isB2B(v({ functions: ["B2B"] }))).toBe(true);
    expect(isB2B(v({ sub_functions: ["BD"] }))).toBe(true);
    expect(isB2B(v({ functions: ["IGV"] }))).toBe(false);
    expect(isBd(v({ functions: ["BD"] }))).toBe(true);
    expect(isBd(v({ functions: ["B2B"] }))).toBe(false);
    expect(isB2C(v({ sub_functions: ["B2C"] }))).toBe(true);
    expect(isB2C(v({ functions: ["B2B"] }))).toBe(false);
  });
  it("icxFunctions keeps only IGV/IGT from the Function column", () => {
    expect(icxFunctions(v({ functions: ["IGV", "B2B", "IGT", "TM"] }))).toEqual(["IGV", "IGT"]);
    expect(icxFunctions(v({ sub_functions: ["IGV"] }))).toEqual([]);
  });
  it("fnSetting falls back to the defaults, and reads what the viewer carries", () => {
    expect(fnSetting(v(), "IGV")).toEqual(functionDefaults("IGV"));
    const s = resolveFunctionSettings("IGV", { cicEnabled: false });
    expect(fnSetting(v({ fnSettings: { IGV: s } }), "IGV").cicEnabled).toBe(false);
  });
  it("canRunLcTools: LCP and admins only — never the EB", () => {
    expect(canRunLcTools(v({ role: "LCP" }))).toBe(true);
    expect(canRunLcTools(v({ isAdmin: true }))).toBe(true);
    expect(canRunLcTools(v({ sub_functions: ["Admin"] }))).toBe(true);
    expect(canRunLcTools(v({ role: "LCVP", functions: ["IGV"] }))).toBe(false);
    expect(canRunLcTools(v({ role: "Director", functions: ["TM"] }))).toBe(false);
  });
  it("canSeePlanning: VPs/Directors of the planned functions, plus the LCP", () => {
    expect(canSeePlanning(v({ role: "LCP" }))).toBe(true);
    expect(canSeePlanning(v({ role: "LCVP", functions: ["OGV"] }))).toBe(true);
    expect(canSeePlanning(v({ role: "Director", functions: ["B2C"] }))).toBe(false);
    expect(canSeePlanning(v({ role: "Team Leader", functions: ["IGV"] }))).toBe(false);
  });
  it("canWorkArchived: archived rows only, MMs and leaders of a raising function", () => {
    const archived = { function: "IGV", responsible_id: "someone", out_of_process: true };
    const live = { ...archived, out_of_process: false };
    expect(canWorkArchived(v({ role: "Team Leader", functions: ["IGV"], sub_functions: ["Raising"] }), archived)).toBe(true);
    expect(canWorkArchived(v({ role: "Team Leader", functions: ["IGV"], sub_functions: ["Raising"] }), live)).toBe(false);
    expect(canWorkArchived(v({ role: "Member", functions: ["IGV"], sub_functions: ["Raising"] }), archived)).toBe(false);
    expect(canWorkArchived(v({ role: "LCP" }), archived)).toBe(true);
  });
});

describe("the AI email draft is sanitized before it reaches the editor", () => {
  it("draftEmailWithAi runs the proposal sanitizer on the model's HTML", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync("src/server/actions.ts", "utf8");
    const at = src.indexOf("export async function draftEmailWithAi");
    const body = src.slice(at, src.indexOf("\nexport ", at + 10));
    expect(body).toContain("sanitizeEditedEmailHtml");
  });
  it("and that sanitizer strips the handler a pasted prompt could smuggle in", async () => {
    const { sanitizeEditedEmailHtml } = await import("@/lib/email/edited-html");
    const out = sanitizeEditedEmailHtml('<p>Hi</p><img src=x onerror="alert(1)"><a href="javascript:x()">y</a>');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("<p>Hi</p>");
  });
});
