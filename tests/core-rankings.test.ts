import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseCoreRankings, rankingsForFunction, egyptTablePath,
  fetchCoreRankings, __clearCoreRankingsCache,
  type CoreRankings,
} from "../src/lib/core-rankings";

/** CORE'S NATIONAL RANKINGS (v36).
 *
 *  The fixtures are REAL captures of core.aiesec.org.eg taken 2026-09-02,
 *  trimmed to the two tables and the nav link the parser reads — no number
 *  edited. That matters more here than anywhere else in the suite: the whole
 *  risk in this module is somebody else's two-level header, and a hand-written
 *  fixture would agree with whatever the parser happens to do.
 *
 *  The numbers pinned below were read off the live Approved pane that day and
 *  are Alexandria's own positions:
 *      iGV #7 (57) · iGTa #8 (4) · iGTe #4 (12) · oGV #6 (53)
 *      oGTa #2 (19) · oGTe #7 (3) · Total #6 (148)
 */

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const HOME = fixture("core-home.html");
const EGYPT = fixture("core-eg.html");

/** Parsed once — the parser is pure, so every test can share it. */
const R = parseCoreRankings(HOME, EGYPT, "2026-09-02") as CoreRankings;
const of = (p: string) => R.programs.find((x) => x.program === p)!;

afterEach(() => {
  vi.unstubAllGlobals();
  __clearCoreRankingsCache();
});

describe("CORE's own top-10 board (the Approved pane)", () => {
  it("reads all seven programme rows", () => {
    expect(R).not.toBeNull();
    expect(R.programs.map((p) => p.program)).toEqual([
      "iGV", "iGTa", "iGTe", "oGV", "oGTa", "oGTe", "Total",
    ]);
    for (const p of R.programs) expect(p.top).toHaveLength(10);
  });

  it("keeps CORE's own order and counts", () => {
    expect(of("iGV").top.slice(0, 3)).toEqual([
      { rank: 1, lc: "Ain Shams University", approvals: 204, isAlexandria: false },
      { rank: 2, lc: "Cairo University", approvals: 106, isAlexandria: false },
      { rank: 3, lc: "Zagazig", approvals: 95, isAlexandria: false },
    ]);
    expect(of("Total").top[0]).toEqual({
      rank: 1, lc: "Ain Shams University", approvals: 379, isAlexandria: false,
    });
  });

  it("puts Alexandria exactly where CORE printed her, on all seven rows", () => {
    const expected: Record<string, [number, number]> = {
      iGV: [7, 57], iGTa: [8, 4], iGTe: [4, 12], oGV: [6, 53],
      oGTa: [2, 19], oGTe: [7, 3], Total: [6, 148],
    };
    for (const [program, [rank, approvals]] of Object.entries(expected)) {
      const row = of(program).top.find((r) => r.isAlexandria);
      expect(row, `${program} board row`).toBeDefined();
      expect([row!.rank, row!.approvals], program).toEqual([rank, approvals]);
    }
  });

  it("reads the Approved pane and not the two beside it", () => {
    // Realized has Alexandria 7th on iGV with 31, Completed drops her
    // entirely — either would sail through a looser pane match.
    expect(of("iGV").top.find((r) => r.isAlexandria)!.approvals).toBe(57);
    expect(of("iGTe").top[0].lc).toBe("Mansoura");
  });

  it("never mistakes AAST Alexandria for us", () => {
    // she is on the Egyptian table three rows away; only the exact name counts
    expect(EGYPT).toContain("AAST Alexandria");
    for (const p of R.programs)
      for (const row of p.top)
        expect(row.isAlexandria).toBe(row.lc === "Alexandria");
  });
});

describe("the exact rank, out of every Egyptian entity", () => {
  it("counts the whole table — closed entities included, as CORE numbers them", () => {
    // 28 rows on the page, 8 of them "(Closed)". CORE's own # column runs
    // 1..28, so that is the denominator a reader can check.
    expect(EGYPT).toContain("(Closed)");
    for (const p of R.programs) expect(p.alexandria!.of).toBe(28);
  });

  it("agrees with the board wherever there is no tie", () => {
    const expected: Record<string, [number, number]> = {
      iGV: [7, 57], iGTa: [8, 4], iGTe: [4, 12],
      oGTa: [2, 19], oGTe: [7, 3], Total: [6, 148],
    };
    for (const [program, [rank, approvals]] of Object.entries(expected)) {
      const a = of(program).alexandria!;
      expect([a.rank, a.approvals, a.inTop10], program).toEqual([rank, approvals, true]);
      expect(a.boardRank, program).toBe(rank);
    }
  });

  it("reports the oGV tie honestly instead of reproducing CORE's ordinal", () => {
    // Zagazig and Alexandria are BOTH on 53. CORE prints Zagazig 5th and
    // Alexandria 6th on some tiebreak it does not publish; the numbers alone
    // say they share 5th, and that is what we say — with the tie named, and
    // CORE's own column kept beside it.
    const a = of("oGV").alexandria!;
    expect(a.approvals).toBe(53);
    expect(a.rank).toBe(5);
    expect(a.boardRank).toBe(6);
    expect(a.tiedWith).toEqual(["Zagazig"]);
  });

  it("names a tie that CORE's own board happens to agree with too", () => {
    // iGTa: Helwan is also on 4, and CORE prints her 9th to our 8th
    const a = of("iGTa").alexandria!;
    expect(a.rank).toBe(8);
    expect(a.boardRank).toBe(8);
    expect(a.tiedWith).toEqual(["Helwan"]);
  });

  it("leaves an untied rank untied", () => {
    expect(of("Total").alexandria!.tiedWith).toEqual([]);
  });
});

describe("outside the top 10 is never the answer", () => {
  /** Real markup, real absence: on CORE's *Completed* pane Alexandria is not
   *  on the iGV row at all. The only edit here is which pane carries the
   *  `approved` id — the numbers and the rows are CORE's own, and this is the
   *  one case the whole feature exists for. */
  const homeCompletedAsApproved = HOME
    .replace(/id="approved"/, 'id="approved-was-here"')
    .replace(/id="completed"/, 'id="approved"');

  const C = parseCoreRankings(homeCompletedAsApproved, EGYPT, "2026-09-02") as CoreRankings;

  it("still states a rank when CORE's board does not list her", () => {
    const igv = C.programs.find((p) => p.program === "iGV")!;
    expect(igv.top).toHaveLength(10);
    expect(igv.top.some((r) => r.isAlexandria)).toBe(false);

    const a = igv.alexandria!;
    expect(a.inTop10).toBe(false);
    expect(a.boardRank).toBeNull();
    // the exact rank comes from the Egyptian table, which never drops a row
    expect([a.rank, a.of, a.approvals]).toEqual([7, 28, 57]);
  });

  it("keeps flagging her on the rows she IS on", () => {
    const igte = C.programs.find((p) => p.program === "iGTe")!;
    expect(igte.top.some((r) => r.isAlexandria)).toBe(true);
    expect(igte.alexandria!.inTop10).toBe(true);
  });
});

describe("the term label and the term-versioned URL", () => {
  it("reads the term off CORE's own nav link, and says to-date", () => {
    expect(R.termLabel).toBe("Term 26.27 · to date");
    expect(R.asOf).toBe("2026-09-02");
  });

  it("follows the homepage's current Egypt link rather than a frozen path", () => {
    expect(egyptTablePath(HOME)).toBe("/analytics/1609/LC26/");
    // next term the link becomes LC27 and the reader follows it
    expect(egyptTablePath(HOME.replace(/LC26/g, "LC27"))).toBe("/analytics/1609/LC27/");
    // and when the nav is gone entirely it still has somewhere to go
    expect(egyptTablePath("<html></html>")).toBe("/analytics/1609/LC26/");
  });
});

describe("function → programme map", () => {
  it("splits IGT and OGT, and gives B2B/BD the whole incoming side", () => {
    expect(rankingsForFunction(R, "IGV").map((p) => p.program)).toEqual(["iGV"]);
    expect(rankingsForFunction(R, "IGT").map((p) => p.program)).toEqual(["iGTa", "iGTe"]);
    expect(rankingsForFunction(R, "OGV").map((p) => p.program)).toEqual(["oGV"]);
    expect(rankingsForFunction(R, "OGT").map((p) => p.program)).toEqual(["oGTa", "oGTe"]);
    for (const fn of ["B2B", "BD", "bd"])
      expect(rankingsForFunction(R, fn).map((p) => p.program)).toEqual(["iGV", "iGTa", "iGTe"]);
  });

  it("gives B2C and every non-exchange function nothing to print", () => {
    for (const fn of ["B2C", "TM", "F&L", "CXP", "IM", "", "Total"])
      expect(rankingsForFunction(R, fn), fn).toEqual([]);
  });
});

describe("when CORE changes shape or goes dark", () => {
  it("returns null rather than throwing, on anything unreadable", () => {
    for (const [home, eg] of [
      ["", ""],
      [HOME, ""],                       // the board alone cannot state a rank
      ["", EGYPT],                      // the rank alone has no board to print
      ["<html>oops</html>", "<html>oops</html>"],
      ["<table id=\"signups-table\">", "<table class=\"table-national-rankings\">"],
    ]) {
      expect(parseCoreRankings(home, eg)).toBeNull();
    }
  });

  it("returns null when the two-level header loses a level", () => {
    // one header row means the offsets cannot be derived — and guessing them
    // is the exact failure this parser is built to avoid
    const flattened = EGYPT.replace(/<thead>[\s\S]*?<\/thead>/i, "<thead><tr><th>#</th></tr></thead>");
    expect(parseCoreRankings(HOME, flattened)).toBeNull();
  });

  it("returns null when both pages are unreachable, and caches no failure", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("ENOTFOUND core.aiesec.org.eg"); });
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchCoreRankings()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);   // homepage first, then it gives up

    // a failure must never be held for the 30-minute TTL: a bad minute on
    // CORE's side would otherwise blank a whole report cycle
    expect(await fetchCoreRankings()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when the homepage answers but the Egyptian table 404s", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/analytics/")
        ? new Response("not found", { status: 404 })
        : new Response(HOME, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchCoreRankings()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches a success for the whole TTL", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(url.includes("analytics") ? EGYPT : HOME, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchCoreRankings();
    expect(first).not.toBeNull();
    expect(first!.programs).toHaveLength(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = await fetchCoreRankings();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);   // module memory, not a refetch
  });
});
