import { describe, expect, it } from "vitest";
import { memberEmailProblem, memberNameProblem, memberStatus } from "@/lib/member-fields";

describe("wrong data in the right-looking box", () => {
  it("refuses an email address typed into Name — the reported case", () => {
    expect(memberNameProblem("ahmedhallul@aiesec.net")).toMatch(/email address/i);
    expect(memberNameProblem("  mariam.h@gmail.com ")).toMatch(/email address/i);
  });

  it("refuses a phone number typed into Name", () => {
    expect(memberNameProblem("01099019374")).toMatch(/phone number/i);
    expect(memberNameProblem("+20 109 901 9374")).toMatch(/phone number/i);
  });

  it("refuses a link, and anything with no letters", () => {
    expect(memberNameProblem("https://sodio.vercel.app")).toBeTruthy();
    expect(memberNameProblem("---- ----")).toMatch(/letters/i);
  });

  it("accepts the names this LC actually has", () => {
    for (const n of [
      "Mariam Hassan",
      "Youssef Atya",
      "أحمد حلول",
      "Abdel-Rahman El-Saied",
      "Dai",
      "Mohamed 2",
    ]) {
      expect(memberNameProblem(n), `${n} should be accepted`).toBeNull();
    }
  });

  it("still requires a name at all", () => {
    expect(memberNameProblem("")).toBeTruthy();
    expect(memberNameProblem("a")).toBeTruthy();
  });

  it("keeps phone numbers out of the email fields, and vice versa", () => {
    expect(memberEmailProblem("01099019374", "AIESEC Mail")).toMatch(/phone number/i);
    expect(memberEmailProblem("Mariam Hassan", "AIESEC Mail")).toMatch(/email address/i);
    expect(memberEmailProblem("mariam@aiesec.net", "AIESEC Mail")).toBeNull();
    expect(memberEmailProblem("", "AIESEC Mail")).toBeNull();
    expect(memberEmailProblem(null, "AIESEC Mail")).toBeNull();
  });
});

describe("a member's status, and the filter that shows it", () => {
  const M = (o: Partial<Parameters<typeof memberStatus>[0]>) =>
    memberStatus({ is_active: true, first_login_at: "2026-01-01", left_at: null, ...o });

  it("names the three states the Status column actually renders", () => {
    expect(M({})).toBe("active");
    expect(M({ first_login_at: null })).toBe("never");
    expect(M({ is_active: false })).toBe("inactive");
  });

  it("treats someone removed from the sheet as left, whatever else is set", () => {
    expect(M({ left_at: "2026-08-01" })).toBe("left");
    expect(M({ left_at: "2026-08-01", is_active: false })).toBe("left");
  });

  it("gives every state exactly one bucket — so a filter option can never match nobody", () => {
    const people = [
      { is_active: true, first_login_at: "x", left_at: null },
      { is_active: true, first_login_at: null, left_at: null },
      { is_active: false, first_login_at: "x", left_at: null },
      { is_active: false, first_login_at: null, left_at: "y" },
    ];
    expect(people.map(memberStatus)).toEqual(["active", "never", "inactive", "left"]);
  });

  it("PICKING TWO OPTIONS IS AN OR — the bug was that it returned nothing", () => {
    const people = [
      { is_active: true, first_login_at: "x", left_at: null },   // active
      { is_active: true, first_login_at: null, left_at: null },  // never
      { is_active: false, first_login_at: "x", left_at: null },  // inactive
    ];
    const picks = ["active", "never"];
    const shown = people.filter((m) => picks.includes(memberStatus(m)));
    expect(shown).toHaveLength(2);
  });
});
