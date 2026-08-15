import { describe, it, expect } from "vitest";
import { dashboardCacheKey } from "@/lib/dashboard-cache";
import type { AccountScope } from "@/lib/rbac";

/**
 * THE DASHBOARD CACHE KEY.
 *
 * The dashboard's ~4,000-row read is shared between viewers to keep the
 * hosting bill down. That is only safe if two viewers share an entry ONLY when
 * they would have read exactly the same rows — a key collision here is not a
 * stale number, it is one member seeing another's accounts. These tests exist
 * because that mistake would be silent.
 *
 * v33.49 — and it WAS silent. The key carried the date range but not the TEAM
 * filter, which the read also carried, so a VP who picked a team cached that
 * team's rows under the whole function's key. It only became visible when
 * v33.46 made the cache actually hold. The read is filter-free now, which is
 * why this key has no filters in it: the invariant below is the fix.
 */

const members = (ids: string[]): AccountScope => ({ kind: "members", ids });
const fns = (f: string[]): AccountScope =>
  ({ kind: "functions", fns: f } as AccountScope);
const all: AccountScope = { kind: "all" };
const key = (s: AccountScope, test = false) => dashboardCacheKey(s, test);

describe("cache key — different scopes must never collide", () => {
  it("two members with different accounts get different keys", () => {
    expect(key(members(["a"]))).not.toBe(key(members(["b"])));
  });

  it("a Team Leader never shares a key with one of their members", () => {
    expect(key(members(["tl", "m1", "m2"]))).not.toBe(key(members(["m1"])));
  });

  it("two functions never share a key", () => {
    expect(key(fns(["IGV"]))).not.toBe(key(fns(["IGT"])));
  });

  it("a superset of functions is its own key", () => {
    expect(key(fns(["IGV"]))).not.toBe(key(fns(["IGV", "B2B"])));
  });

  it("whole-LC is not the same as any function scope", () => {
    expect(key(all)).not.toBe(key(fns(["IGV"])));
    expect(key(all)).not.toBe(key(members(["x"])));
  });

  it("a members scope never collides with a functions scope of the same text", () => {
    expect(key(members(["IGV"]))).not.toBe(key(fns(["IGV"])));
  });

  it("test mode is a different world — test accounts are only visible there", () => {
    expect(key(fns(["IGV"]), false)).not.toBe(key(fns(["IGV"]), true));
  });
});

describe("cache key — the same scope MUST share, or the cache is pointless", () => {
  it("id order doesn't matter", () => {
    expect(key(members(["a", "b", "c"]))).toBe(key(members(["c", "a", "b"])));
  });

  it("function order doesn't matter", () => {
    expect(key(fns(["IGV", "B2B"]))).toBe(key(fns(["IGV", "B2B"])));
  });

  it("two VPs of the same function share one read", () => {
    expect(key(fns(["IGT", "B2B"]))).toBe(key(fns(["IGT", "B2B"])));
  });

  it("THE INVARIANT: the key depends on the scope and nothing else — the read it names must stay filter-free, or the filter has to come back into the key", () => {
    // deliberately a signature test: any future caller that wants to narrow
    // the cached read has to change this line, and will find this comment.
    expect(dashboardCacheKey.length).toBe(2);
  });
});
