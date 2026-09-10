import { describe, it, expect } from "vitest";
import { podioNameKey } from "@/lib/podio";

/**
 * THE PODIO NAME COMPARISON (v36.1).
 *
 * Reported with two screenshots: the national form's dropdown offered
 * "Momo’s Burgers" for a member who typed "Momo's Burgers", and Sodio said
 * "Not on Podio — you still need to submit it". Podio stores the curly
 * apostrophe, a keyboard types the straight one, and the comparison treated
 * them as different words — the one answer that makes a member submit a
 * duplicate.
 */

const same = (a: string, b: string) => podioNameKey(a) === podioNameKey(b);

describe("podioNameKey", () => {
  it("reads a curly apostrophe as the straight one — the reported case", () => {
    expect(same("Momo's Burgers", "Momo’s Burgers")).toBe(true);
    expect(same("Momo‘s Burgers", "Momo`s Burgers")).toBe(true);
  });

  it("folds curly double quotes, dashes and accents", () => {
    expect(same("The “Hub”", 'The "Hub"')).toBe(true);
    expect(same("Coca–Cola", "Coca-Cola")).toBe(true); // en dash
    expect(same("Coca—Cola", "Coca-Cola")).toBe(true); // em dash
    expect(same("Café Sofra", "Cafe Sofra")).toBe(true);
  });

  it("ignores invisible characters pasted in from another page", () => {
    expect(same("Momo’s\u200b Burgers", "Momo's Burgers")).toBe(true); // zero-width space
    expect(same("\ufeffGateway", "Gateway")).toBe(true); // byte-order mark
    expect(same("Gateway\u00a0Urban", "Gateway Urban")).toBe(true); // no-break space
  });

  it("still ignores case and spacing", () => {
    expect(same("  momo's   BURGERS ", "Momo’s Burgers")).toBe(true);
  });

  it("is still an EXACT match on the words", () => {
    expect(same("Gateway", "Gateway Urban")).toBe(false);
    expect(same("Momo's Burgers", "Momo Burgers")).toBe(false);
    expect(same("Momos Burgers", "Momo's Burgers")).toBe(false);
  });
});
