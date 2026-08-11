import { describe, it, expect } from "vitest";
import {
  memberInTouchPointAudience, teamsOf, type TouchPointRow,
} from "../src/server/touch-points-read";

/** WHO IS ON THE ATTENDANCE SHEET (v33.34).
 *
 *  The audience decides who gets invited AND who can be marked absent, so a
 *  regression here doesn't show up as a broken page — it shows up as someone
 *  marked absent from a session nobody expected them at. The explicit guest
 *  list added in 0056 is the first thing that can override the derived rules,
 *  which makes it exactly the thing to pin down.
 */
const tp = (over: Partial<TouchPointRow> = {}): TouchPointRow =>
  ({
    id: "tp1",
    scope: "function",
    kind: "meeting",
    function_key: "IGV",
    team_name: null,
    starts_at: "2026-08-20T15:00:00Z",
    note: null,
    invited_teams: [],
    invited_functions: [],
    status: "scheduled",
    cancel_reason: null,
    owner_id: "owner",
    owner_name: "The Owner",
    attendance_recorded_at: null,
    members: null,
    ...over,
  }) as TouchPointRow;

const person = (over: Partial<Parameters<typeof memberInTouchPointAudience>[0]> = {}) => ({
  id: "m1",
  team_name: null,
  stakeholder_id: null,
  functions: ["IGV"],
  sub_functions: [],
  role: "Member",
  ...over,
});

describe("the derived audience still behaves exactly as before", () => {
  it("a function point takes everyone in the function", () => {
    expect(memberInTouchPointAudience(person(), tp())).toBe(true);
    expect(
      memberInTouchPointAudience(person({ id: "m2", functions: ["IGT"] }), tp())
    ).toBe(false);
  });

  it("the owner is always in their own point", () => {
    expect(
      memberInTouchPointAudience(person({ id: "owner", functions: ["OGV"] }), tp())
    ).toBe(true);
  });

  it("the Admin is never an attendee", () => {
    expect(memberInTouchPointAudience(person({ role: "Admin" }), tp())).toBe(false);
  });
});

describe("an explicit guest list decides on its own", () => {
  const guests = tp({ members: ["m1", "m3"] });

  it("includes exactly who was ticked", () => {
    expect(memberInTouchPointAudience(person({ id: "m1" }), guests)).toBe(true);
    expect(memberInTouchPointAudience(person({ id: "m3" }), guests)).toBe(true);
  });

  it("excludes someone the scope WOULD have caught", () => {
    // same function, so the derived rule says yes — the booker said no
    expect(memberInTouchPointAudience(person({ id: "m2" }), guests)).toBe(false);
  });

  it("leaves the OWNER out when they unticked themselves", () => {
    // the owner-always rule must not quietly re-add a row to the sheet
    expect(memberInTouchPointAudience(person({ id: "owner" }), guests)).toBe(false);
  });

  it("still refuses the Admin, whatever the list says", () => {
    expect(
      memberInTouchPointAudience(person({ id: "m1", role: "Admin" }), guests)
    ).toBe(false);
  });

  it("an EMPTY list is not a list — the derived rules stand", () => {
    // "nobody" is never what an empty array means here: the server refuses a
    // point with no one in it, so [] can only be an absent/legacy value
    expect(memberInTouchPointAudience(person(), tp({ members: [] }))).toBe(true);
  });

  it("a null list is the pre-0056 behaviour, untouched", () => {
    expect(memberInTouchPointAudience(person(), tp({ members: null }))).toBe(true);
  });
});

describe("teamsOf — one cell, many teams", () => {
  it("splits the membership sheet's comma list", () => {
    expect(teamsOf("Suits, شماريخ")).toEqual(["Suits", "شماريخ"]);
    expect(teamsOf(null)).toEqual([]);
  });
});
