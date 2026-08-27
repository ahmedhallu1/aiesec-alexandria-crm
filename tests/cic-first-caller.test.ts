import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** THE CIC QUEUE'S 1ST-CALLER FILTER (v35).
 *
 *  The queue always showed the first assignee — that column IS the first
 *  caller — but the only way to narrow by them was the name-string funnel
 *  every other view uses, and a stored name is a snapshot. Production had
 *  "Ahmed kadry" and "Ahmed Kadry" as two entries of 7 rows each: one person,
 *  one member id, and a pick that silently dropped half their work.
 *
 *  So this filter is by member ID, and its option list is built from the CIC
 *  pool itself. Both of those are load-bearing and neither is visible in a
 *  typecheck.
 */

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the filter narrows by PERSON, not by a stored spelling", () => {
  const data = read("src/server/data.ts");

  it("matches assigned_to (the id), never assigned_name", () => {
    const block = data.slice(data.indexOf("pickList(filters.firstCaller)"));
    expect(block.slice(0, 400)).toContain('q.eq("assigned_to"');
    expect(block.slice(0, 400)).not.toContain("assigned_name");
  });

  it("drops anything that isn't a real id rather than querying with it", () => {
    expect(data).toMatch(/pickList\(filters\.firstCaller\)\.filter\(\(v\) => UUID_RE\.test\(v\)\)/);
  });

  it("labels the options with the member's CURRENT name — one row per human", () => {
    const fn = data.slice(data.indexOf("export async function cicFirstCallerOptions"));
    expect(fn).toContain('.from("members")');
  });
});

describe("the funnel cannot offer somebody with nothing in the queue", () => {
  const data = read("src/server/data.ts");

  it("the CIC pool is ONE predicate, read by the queue AND by the options", () => {
    // Two copies of "held by a member · first call answered · no status yet"
    // would drift, and the drift shows up as a funnel full of dead picks.
    expect(data).toContain("function cicPoolFilter");
    // (the generic declaration reads `cicPoolFilter<T …>(`, so it is not a
    // call-site match — the two are the queue and the option list)
    const calls = data.match(/cicPoolFilter\(/g) ?? [];
    expect(calls.length, "the queue AND the option list call it").toBeGreaterThanOrEqual(2);
  });

  it("is offered only to whoever can see the whole queue", () => {
    const fn = data.slice(
      data.indexOf("export async function cicFirstCallerOptions"),
      data.indexOf("export async function cicFirstCallerOptions") + 1200
    );
    expect(fn).toMatch(/seesB2cCicQueue\(viewer\) : seesCicQueue\(viewer\)/);
  });

  it("spans BOTH OGX sides when no side chip is pressed (B2C's default view)", () => {
    const fn = data.slice(data.indexOf("export async function cicFirstCallerOptions"));
    expect(fn.slice(0, 1500)).toMatch(/const want = fn && scope\.includes\(fn\) \? \[fn\] : scope;/);
  });
});

describe("the column says what it is", () => {
  const view = read("src/components/crm/signups-view.tsx");

  it('reads "1st caller" on the CIC queue and "Assigned" everywhere else', () => {
    expect(view).toMatch(/label: cic \? "1st caller" : "Assigned"/);
  });

  it("keeps the name funnel for every other view", () => {
    expect(view).toContain("filterOptions.assigned_name");
  });

  it("carries a mobile control too — a header funnel is unreachable on a phone", () => {
    // the v33.50 lesson: the CV pool shipped five filters that phones never saw
    const mobile = view.slice(view.indexOf('<div className="contents md:hidden">'));
    expect(mobile.slice(0, 1200)).toContain("Any 1st caller");
  });
});
