import { describe, expect, it } from "vitest";
import { memberEmailProblem, memberNameProblem } from "@/lib/member-fields";

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
