import { describe, expect, it } from "vitest";
import { accountActions, podioDueDay, worstTone, type ActionableAccount } from "@/lib/account-actions";

const TODAY = "2026-08-22";
const base: ActionableAccount = {
  function: "IGV",
  out_of_process: false,
  responsible_id: "m1",
  requested_podio: true,
  request_state: null,
  next_step_missing: false,
  no_response_attempts: 0,
};
const kinds = (a: Partial<ActionableAccount>) =>
  accountActions({ ...base, ...a }, TODAY).map((x) => x.kind);

describe("what an account is waiting for", () => {
  it("says nothing about a healthy account", () => {
    expect(kinds({})).toEqual([]);
  });

  it("flags a visit whose day has passed with no report", () => {
    expect(kinds({ visit_id: "v1", visit_done: null, visit_date: "2026-08-20" }))
      .toContain("visit_report");
    // today's visit is not late yet
    expect(kinds({ visit_id: "v1", visit_done: null, visit_date: TODAY }))
      .not.toContain("visit_report");
    // a reported visit is done with
    expect(kinds({ visit_id: "v1", visit_done: true, visit_date: "2026-08-20" }))
      .not.toContain("visit_report");
  });

  it("flags a Podio refresh only once it is actually due", () => {
    const on = { podio_update_enabled: true, podio_update_every_days: 14 };
    expect(kinds({ ...on, podio_updated_at: "2026-08-01T00:00:00Z" })).toContain("podio_update");
    expect(kinds({ ...on, podio_updated_at: "2026-08-21T00:00:00Z" })).not.toContain("podio_update");
    // off the cycle entirely
    expect(podioDueDay({ ...base, podio_update_enabled: false })).toBeNull();
  });

  it("colours each action by WHAT it is: a lost visit is red, a Podio refresh amber", () => {
    const on = { podio_update_enabled: true, podio_update_every_days: 14 };
    const podio = accountActions({ ...base, ...on, podio_updated_at: "2026-07-01T00:00:00Z" }, TODAY);
    expect(podio.find((a) => a.kind === "podio_update")?.tone).toBe("amber");
    const visit = accountActions(
      { ...base, visit_id: "v1", visit_done: null, visit_date: "2026-08-20" },
      TODAY
    );
    expect(visit.find((a) => a.kind === "visit_report")?.tone).toBe("red");
  });

  it("the dot shows the LOUDEST open action", () => {
    expect(worstTone([{ kind: "podio_check", label: "", tone: "muted" }])).toBe("muted");
    expect(
      worstTone([
        { kind: "podio_check", label: "", tone: "muted" },
        { kind: "podio_update", label: "", tone: "amber" },
      ])
    ).toBe("amber");
    expect(
      worstTone([
        { kind: "podio_update", label: "", tone: "amber" },
        { kind: "visit_report", label: "", tone: "red" },
      ])
    ).toBe("red");
    expect(worstTone([])).toBe("muted");
  });

  it("only asks for a Podio check on an OWNED account — the pool would drown it", () => {
    expect(kinds({ requested_podio: false, request_state: null })).toContain("podio_check");
    expect(kinds({ requested_podio: false, request_state: null, responsible_id: null }))
      .not.toContain("podio_check");
    expect(kinds({ requested_podio: false, request_state: "Approved" })).not.toContain("podio_check");
  });

  it("flags a missing next step and three unanswered attempts", () => {
    expect(kinds({ next_step_missing: true })).toContain("next_step");
    expect(kinds({ no_response_attempts: 3 })).toContain("no_response");
    expect(kinds({ no_response_attempts: 2 })).not.toContain("no_response");
  });

  it("says nothing at all about an archived account — it is out of the game", () => {
    expect(
      kinds({
        out_of_process: true,
        next_step_missing: true,
        no_response_attempts: 9,
        visit_id: "v1",
        visit_done: null,
        visit_date: "2026-01-01",
      })
    ).toEqual([]);
  });

  it("can report several at once", () => {
    const k = kinds({ next_step_missing: true, no_response_attempts: 4 });
    expect(k).toEqual(expect.arrayContaining(["next_step", "no_response"]));
  });
});
