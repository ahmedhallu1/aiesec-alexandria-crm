import { describe, expect, it } from "vitest";
import {
  epPartOf,
  expaKey,
  functionOfProduct,
  isAlreadyLogged,
  isValidApprovalDate,
  laneApprovals,
  mosCountFor,
  plannedApprovals,
  productFromRaw,
  tallyApprovals,
  teamLeaderOf,
  type CreditMember,
  type LaneApprovalRow,
} from "@/lib/icx-approvals";

/** The LC's credit rule, stated when approvals were built (v37): an approval
 *  belongs to ONE person, a member's approvals also count for their MM (the
 *  Team Leader they report to), and the MM's own count too. */
const members: CreditMember[] = [
  { id: "vp", name: "Vera VP", role: "LCVP", managerId: "lcp" },
  { id: "tl", name: "Tarek TL", role: "Team Leader", managerId: "vp" },
  { id: "m1", name: "Mona", role: "Member", managerId: "tl" },
  { id: "m2", name: "Omar", role: "Member", managerId: "tl" },
  { id: "co", name: "Coco Coord", role: "Coordinator", managerId: "vp" },
  { id: "m3", name: "Nour", role: "Member", managerId: "vp" }, // filed under a VP: no team
];
const byId = new Map(members.map((m) => [m.id, m]));
const row = (made_by: string | null, extra: Partial<LaneApprovalRow> = {}): LaneApprovalRow => ({
  made_by,
  made_by_name: made_by ? (byId.get(made_by)?.name ?? "") : "Gone Person",
  approved_on: "2026-09-10",
  product: "GV",
  partner_lc_name: "AIESEC in Tunis",
  source: "ir_call",
  ...extra,
});

describe("the credit rule", () => {
  it("rolls a member up to their Team Leader, and a TL up to themself", () => {
    expect(teamLeaderOf("m1", byId)).toBe("tl");
    expect(teamLeaderOf("tl", byId)).toBe("tl");
  });

  it("never makes the EB a team — a member filed under a VP rolls up to nobody", () => {
    expect(teamLeaderOf("m3", byId)).toBeNull();
    expect(teamLeaderOf("co", byId)).toBeNull();
    expect(teamLeaderOf("vp", byId)).toBeNull();
  });

  it("puts a TL on both boards: own on the person board, own + team on the MM board", () => {
    const { people, mms } = tallyApprovals(
      [row("m1"), row("m1"), row("m2"), row("tl"), row("m3")],
      members
    );
    expect(people.find((p) => p.id === "m1")?.own).toBe(2);
    expect(people.find((p) => p.id === "tl")?.own).toBe(1);
    expect(mms).toEqual([{ id: "tl", name: "Tarek TL", own: 1, team: 3, total: 4 }]);
  });

  it("keeps someone who has left on the board by their snapshot name", () => {
    const { people } = tallyApprovals([row(null)], members);
    expect(people[0]).toMatchObject({ id: null, name: "Gone Person", own: 1 });
  });

  it("counts a TL's MOS as their own plus their team's, and a member's as their own", () => {
    const rows = [row("m1"), row("m2"), row("tl"), row("m3")];
    expect(mosCountFor("tl", rows, members)).toBe(3);
    expect(mosCountFor("m1", rows, members)).toBe(1);
    expect(mosCountFor("vp", rows, members)).toBe(0);
  });
});

describe("one EP, one approval", () => {
  it("normalises the EXPA id the same way the database does", () => {
    expect(expaKey(" 6207212_1334682 ")).toBe("6207212_1334682");
    expect(expaKey("")).toBeNull();
    expect(epPartOf("6207212_1334682")).toBe("6207212");
  });

  it("treats a bare EP id as covering that EP's full pair", () => {
    expect(isAlreadyLogged("6207212_1334682", ["6207212"])).toBe(true);
    expect(isAlreadyLogged("6207212_1334682", ["6207212_1334682"])).toBe(true);
  });

  it("never treats two different opportunities as one approval", () => {
    expect(isAlreadyLogged("6207212_1334682", ["6207212_9999999"])).toBe(false);
    expect(isAlreadyLogged("6207212_1334682", [null, "", "5555555"])).toBe(false);
  });
});

describe("products and dates", () => {
  it("maps the SubTool's raw product and our lanes", () => {
    expect(productFromRaw("GV")).toBe("GV");
    expect(productFromRaw("gta")).toBe("GTa");
    expect(productFromRaw("Global Talent Teacher")).toBe("GTe");
    expect(productFromRaw("", "IGV")).toBe("GV");
    expect(productFromRaw("", "IGT")).toBeNull();
    expect(functionOfProduct("GTe")).toBe("IGT");
  });

  it("refuses a future day, a fake day and junk", () => {
    expect(isValidApprovalDate("2026-09-20", "2026-09-26")).toBe(true);
    expect(isValidApprovalDate("2026-09-27", "2026-09-26")).toBe(false);
    expect(isValidApprovalDate("2026-02-30", "2026-09-26")).toBe(false);
    expect(isValidApprovalDate("yesterday", "2026-09-26")).toBe(false);
  });
});

describe("planned vs achieved", () => {
  const cells = [
    { fn: "IGTa", scope: "month", period_start: "2026-09-01", metric: "approvals", value: 2.5 },
    { fn: "IGTe", scope: "month", period_start: "2026-09-01", metric: "approvals", value: 1.2 },
    { fn: "IGTa", scope: "sprint", period_start: "2026-09-16", metric: "approvals", value: 2 },
    { fn: "IGTa", scope: "month", period_start: "2026-08-01", metric: "approvals", value: 3 },
    { fn: "IGTa", scope: "month", period_start: "2026-09-01", metric: "opens", value: 9 },
  ];

  it("sums a lane's products and rounds a fractional target UP", () => {
    expect(plannedApprovals(cells, "month", ["2026-09-01"])).toBe(4);
  });

  it("says 'no plan' rather than 'a plan of zero' when the sheet is silent", () => {
    expect(plannedApprovals(cells, "month", ["2026-10-01"])).toBeNull();
  });

  const month = { start: "2026-09-01", end: "2026-09-30", label: "September 2026", planKeys: ["2026-09-01"] };
  const sprint = { start: "2026-09-16", end: "2026-09-30", label: "Sprint 2", planKeys: ["2026-09-16"] };
  const peak = {
    label: "Winter peak",
    start: "2026-08-01",
    end: "2027-01-31",
    months: ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"],
  };
  const rows = [
    row("m1", { approved_on: "2026-08-20", product: "GTa" }),
    row("m1", { approved_on: "2026-09-05", product: "GTa" }),
    row("m2", { approved_on: "2026-09-18", product: "GTe", source: "cv_pool" }),
    row("tl", { approved_on: "2026-09-20", product: "GTa" }),
  ];

  it("follows the filter bar: the month, or the sprint while it is pressed", () => {
    const m = laneApprovals({ rows, members, cells, month, sprint, peak, sprintMode: false, today: "2026-09-26" });
    expect(m.plan).toMatchObject({ mode: "month", planned: 4, achieved: 3 });
    expect(m.lastMonth).toBe(1);
    const s = laneApprovals({ rows, members, cells, month, sprint, peak, sprintMode: true, today: "2026-09-26" });
    expect(s.plan).toMatchObject({ mode: "sprint", planned: 2, achieved: 2 });
  });

  it("strips the peak month by month against the plan", () => {
    const m = laneApprovals({ rows, members, cells, month, sprint, peak, sprintMode: false, today: "2026-09-26" });
    expect(m.byMonth.map((b) => [b.month, b.achieved, b.planned])).toEqual([
      ["2026-08", 1, 3],
      ["2026-09", 3, 4],
    ]);
    expect(m.peak).toMatchObject({ achieved: 4, planned: 7 });
  });

  it("has no 'last month' in the first month of a peak", () => {
    const aug = { start: "2026-08-01", end: "2026-08-31", label: "August", planKeys: ["2026-08-01"] };
    const m = laneApprovals({ rows, members, cells, month: aug, sprint, peak, sprintMode: false, today: "2026-08-20" });
    expect(m.lastMonth).toBeNull();
  });

  it("narrows the boards to the filter window when one is set", () => {
    const m = laneApprovals({
      rows, members, cells, month, sprint, peak, sprintMode: false, today: "2026-09-26",
      window: { from: "2026-09-15", to: "2026-09-30" },
    });
    expect(m.total).toBe(2);
    expect(m.mms[0]).toMatchObject({ id: "tl", own: 1, team: 1, total: 2 });
    expect(m.bySource.map((s) => s.source).sort()).toEqual(["cv_pool", "ir_call"]);
  });
});
