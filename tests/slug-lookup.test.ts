import { describe, it, expect } from "vitest";
import { accountSlug, normalizeName, slugLikePattern } from "@/lib/types";

/**
 * SLUG → ROW RESOLUTION (v33.15).
 *
 * The regression that hid 32 live accounts: the slug→row LIKE pattern used to
 * STRIP `_` and `%` (shortening the pattern) instead of neutralizing them
 * position-for-position. These tests pin the property that matters: for every
 * real account name, the LIKE pattern built from its own slug MUST match its
 * stored normalized_name, and the JS exact-slug comparison must then accept
 * the row.
 */

/** Simulates Postgres ILIKE: `_` = one char, `%` = any run. */
const ilike = (pattern: string, value: string): boolean => {
  const rx = pattern
    .split("")
    .map((ch) => (ch === "_" ? "." : ch === "%" ? ".*" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${rx}$`, "is").test(value);
};

/** What findAccountRow does: decoded slug → pattern → DB ilike → JS verify. */
const resolves = (name: string): boolean => {
  const stored = normalizeName(name); // the normalized_name column
  const raw = decodeURIComponent(accountSlug(name)); // the URL param, decoded
  const pattern = slugLikePattern(raw);
  if (!ilike(pattern, stored)) return false;
  // the JS exact filter (either clause may accept)
  return (
    accountSlug(name) === raw ||
    decodeURIComponent(accountSlug(name)) === raw ||
    normalizeName(name) === raw.replace(/-/g, " ")
  );
};

describe("slugLikePattern", () => {
  it("preserves length — every metachar becomes a single-char wildcard", () => {
    for (const s of ["omama_burgerhouse", "purity-101%", "a\\b", "i-fikra-x"]) {
      expect(slugLikePattern(s)).toHaveLength(s.length);
    }
    expect(slugLikePattern("omama_burgerhouse")).toBe("omama_burgerhouse".replace(/_/g, "_"));
  });

  it("never emits the multi-char wildcard %", () => {
    expect(slugLikePattern("purity-101%")).not.toContain("%");
  });
});

describe("every real-world account name resolves at its own URL", () => {
  const names = [
    // the v33.15 regression set — Instagram-handle names with underscores
    "omama_burgerhouse",
    "crema_speciality_coffee",
    "roma_pizza",
    "Hush_eg",
    "jcafe_1996",
    "8back_",
    "pentola_cafe_and_restaurant",
    // % in the name (was stripped too)
    "purity 101%",
    // dots, pipes, colons, ampersands — never metachars, but keep them honest
    "myturtle.store",
    "am:pm speciality coffee",
    "911 Specialty Coffee & Bakery (Nine Eleven)",
    "ALAANAK|شركة تسويق الكتروني في مصر اعلانك",
    // dashes-in-name (the v33.7 case the JS filter exists for)
    "i-fikra software company",
    // plain names + Arabic
    "Hadana Moves",
    "شركة الاسكندرية",
    "2 shot cafe - كافيه 2 شوت",
  ];
  for (const name of names) {
    it(`resolves ${JSON.stringify(name)}`, () => {
      expect(resolves(name)).toBe(true);
    });
  }
});

/** CASE NEVER MAKES TWO ACCOUNTS (v35.1).
 *
 *  Reported from the floor as "Sodio's own duplicate check is case-sensitive".
 *  Checked against production first and it is not: `normalized_name` is a
 *  generated, lower-cased column (4,501 accounts, zero mismatches), the query
 *  is an ILIKE on top of that, and a mixed-case name finds the row. So this is
 *  a RATCHET rather than a fix — the property is already true and these
 *  assertions fail the moment anything in the chain stops folding case.
 *
 *  The Podio check is a different thing entirely and keeps its own matching:
 *  it asks a third party about their data, not Sodio about ours.
 */
describe("the duplicate check ignores case", () => {
  const pairs: [string, string][] = [
    ["Gamal", "gamal"],
    ["GAMAL", "GaMaL"],
    ["INNOVA STEM EDU", "innova stem edu"],
    ["Hadana Moves", "hadana moves"],
    ["i-Fikra Software Company", "I-FIKRA SOFTWARE COMPANY"],
    ["Omama_Burgerhouse", "omama_burgerhouse"],
  ];
  for (const [a, b] of pairs) {
    it(`treats ${JSON.stringify(a)} and ${JSON.stringify(b)} as one name`, () => {
      // the stored key is identical…
      expect(normalizeName(a)).toBe(normalizeName(b));
      // …the URL is identical…
      expect(accountSlug(a)).toBe(accountSlug(b));
      // …and the pattern built from one matches the other's stored value
      expect(ilike(slugLikePattern(decodeURIComponent(accountSlug(a))), normalizeName(b))).toBe(true);
    });
  }

  it("still tells genuinely different names apart", () => {
    expect(normalizeName("Gamal")).not.toBe(normalizeName("Gamall"));
    expect(accountSlug("gamal cafe")).not.toBe(accountSlug("gamal cafes"));
  });
});
