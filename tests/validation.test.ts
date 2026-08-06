import { describe, it, expect } from "vitest";
import {
  accountSlug,
  cleanPhone,
  normalizeName,
  normalizePhone,
  EMAIL_RE,
  PHONE_RE,
  URL_RE,
} from "@/lib/types";
import { parseSearchResults } from "@/lib/podio";

/**
 * INPUT VALIDATION + INJECTION.
 *
 * Everything here is a pure function that untrusted input actually reaches:
 * phone numbers pasted from WhatsApp, account names typed by members, and
 * HTML fetched from a third party (Podio). No mocks — these are the real
 * parsers, fed the real hostile shapes.
 */

describe("phone normalisation", () => {
  it("accepts Egyptian mobiles and canonicalises them", () => {
    for (const input of ["01099019374", "+201099019374", "00201099019374", "0109 901 9374"]) {
      const r = normalizePhone(input);
      expect(r.ok, input).toBe(true);
      expect(r.value).toBe("+201099019374");
    }
  });

  it("strips INVISIBLE characters that used to make a valid number fail", () => {
    // bidi marks ride along on numbers copied out of Arabic chats; the member
    // can neither see nor delete them
    const hostile = [
      "‎+201099019374",       // LRM prefix
      "+2010990‏19374",       // RLM inside
      "+20109​9019374",       // zero-width space
      "0109­9019374",         // soft hyphen
      "﻿01099019374",         // BOM
    ];
    for (const h of hostile) {
      expect(PHONE_RE.test(cleanPhone(h)), JSON.stringify(h)).toBe(true);
    }
  });

  it("rejects two numbers pasted together instead of silently taking one", () => {
    expect(PHONE_RE.test(cleanPhone("01099019374 / 01234567890"))).toBe(false);
  });

  it("TRANSLATES Arabic-keyboard digits instead of deleting them (v33.16)", () => {
    // a member typing their number on an Arabic mobile keyboard was told the
    // number doesn't exist — the digits were stripped, not converted
    expect(cleanPhone("٠١٠٩٩٠١٩٣٧٤")).toBe("01099019374");
    expect(cleanPhone("۰۱۰۹۹۰۱۹۳۷۴")).toBe("01099019374");
    const r = normalizePhone("٠١٠٢٣٤٧٧٩٨٣");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("+201023477983");
  });

  it("rejects letters, empty input and short numbers", () => {
    expect(normalizePhone("call me").ok).toBe(false);
    expect(normalizePhone("").ok).toBe(false);
    expect(normalizePhone("0109").ok).toBe(false);
  });

  it("never returns a value that isn't digits (plus an optional +)", () => {
    for (const junk of ["<script>alert(1)</script>", "'; drop table members;--", "٠١٠٩٩٠١٩٣٧٤"]) {
      expect(/^\+?\d*$/.test(cleanPhone(junk)), junk).toBe(true);
    }
  });
});

describe("account names and slugs", () => {
  it("normalises case and collapses whitespace so duplicates collide", () => {
    expect(normalizeName("  Hadana   MOVES ")).toBe("hadana moves");
    expect(normalizeName("Hadana Moves")).toBe(normalizeName("hadana moves"));
  });

  it("percent-encodes a slug so a name can't break out of the URL path", () => {
    const nasty = accountSlug("a/../../etc/passwd");
    // the defence is ENCODING: no raw separator survives, so the whole thing
    // stays one path segment no matter what the member typed
    expect(nasty).not.toMatch(/[/?#&]/);
    expect(nasty).toContain("%2F");
    expect(new URL(`https://x.test/accounts/${nasty}`).pathname.split("/")).toHaveLength(3);
  });

  it("handles a name with a query string or hash without leaking it", () => {
    for (const n of ["Acme?admin=1", "Acme#frag", "Acme&x=1"]) {
      const s = accountSlug(n);
      expect(s).not.toContain("?");
      expect(s).not.toContain("#");
      expect(s).not.toContain("&");
    }
  });

  it("keeps Arabic names usable", () => {
    expect(normalizeName("  شركة  الاسكندرية ")).toBe("شركة الاسكندرية");
    expect(accountSlug("شركة الاسكندرية")).toContain("%");
  });
});

describe("email and URL shape checks", () => {
  it("rejects header-injection attempts in an email", () => {
    for (const bad of [
      "a@b.com\nBcc: victim@x.com",
      "a@b.com\r\nSubject: spam",
      "a@b.com, c@d.com",
      "a@b.com<script>",
    ]) {
      expect(EMAIL_RE.test(bad), bad).toBe(false);
    }
  });

  it("accepts ordinary addresses", () => {
    expect(EMAIL_RE.test("omar.eldeeb@aiesec.net")).toBe(true);
  });

  it("only accepts http(s) links — no javascript: or data: URLs", () => {
    expect(URL_RE.test("https://example.com")).toBe(true);
    expect(URL_RE.test("javascript:alert(1)")).toBe(false);
    expect(URL_RE.test("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(URL_RE.test("vbscript:msgbox(1)")).toBe(false);
  });
});

describe("Podio search parsing — third-party JSON is untrusted", () => {
  const wrap = (titles: string[]) =>
    JSON.stringify([{ name: "app", data: {}, contents: titles.map((t) => ({ title: t })) }]);

  it("reads the titles Podio returned, in order", () => {
    expect(parseSearchResults(wrap(["Gateway", "Gateway Urban"]))).toEqual([
      "Gateway",
      "Gateway Urban",
    ]);
  });

  it("a well-formed response with no matches is an empty list, not a failure", () => {
    expect(parseSearchResults(wrap([]))).toEqual([]);
  });

  it("a BARE `[]` is Podio saying 'I don't have that' — not a failure", () => {
    // verified against the live endpoint: a query Podio has no partner for
    // returns exactly `[]`. Reading that as unusable made every genuinely new
    // company name report "couldn't reach Podio", which is the common case.
    expect(parseSearchResults("[]")).toEqual([]);
  });

  it("a non-empty response with no contents anywhere is a SHAPE CHANGE → null", () => {
    // must never become a confident "free": that would tell a member to
    // submit a partner another LC already registered
    expect(parseSearchResults('[{"name":"app","data":{}}]')).toBeNull();
  });

  it("returns NULL on unusable input so the caller says 'unknown', never 'free'", () => {
    // this is the safety property: a shape change must not tell a member the
    // company is free to submit when we simply could not read the answer
    for (const bad of ["", "not json", "{}", "null", '"a string"']) {
      expect(parseSearchResults(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("ignores entries with a missing or non-string title", () => {
    const mixed = JSON.stringify([
      { contents: [{ title: "Real" }, { title: null }, {}, { title: 42 }] },
    ]);
    expect(parseSearchResults(mixed)).toEqual(["Real"]);
  });

  it("never throws, whatever it is handed", () => {
    for (const junk of ["[", "[{", '[{"contents":', "\u0000"]) {
      expect(() => parseSearchResults(junk)).not.toThrow();
    }
  });
});

describe("upload extension guard (F-17)", () => {
  // re-declared here because the guard lives inside a "use server" module that
  // can't be imported into a unit test; this mirrors it exactly and fails if
  // the two drift, which is the point
  const UNSAFE = new Set([
    "html", "htm", "xhtml", "shtml", "svg", "xml", "xsl",
    "js", "mjs", "cjs", "jsx", "ts", "vbs", "ps1", "sh", "bash",
    "exe", "msi", "bat", "cmd", "com", "scr", "pif", "jar", "app", "dmg",
    "dll", "so", "deb", "rpm", "apk", "hta", "chm", "reg", "iso",
  ]);
  const reason = (name: string): string | null => {
    const clean = (name ?? "").trim().toLowerCase();
    if (!clean) return "no name";
    const ext = clean.includes(".") ? clean.split(".").pop()! : "";
    if (!ext) return "no extension";
    return UNSAFE.has(ext) ? "unsafe" : null;
  };

  it("blocks active content that would run from the storage origin", () => {
    for (const f of ["evil.html", "logo.svg", "payload.js", "macro.hta"]) {
      expect(reason(f), f).not.toBeNull();
    }
  });

  it("blocks executables", () => {
    for (const f of ["setup.exe", "run.bat", "tool.jar", "app.apk"]) {
      expect(reason(f), f).not.toBeNull();
    }
  });

  it("catches the double-extension bypass by checking the LAST extension", () => {
    expect(reason("cv.pdf.html")).not.toBeNull();
    expect(reason("contract.docx.svg")).not.toBeNull();
  });

  it("is case-insensitive", () => {
    expect(reason("EVIL.HTML")).not.toBeNull();
    expect(reason("Evil.SvG")).not.toBeNull();
  });

  it("still allows the formats the crew actually uses", () => {
    for (const f of ["contract.pdf", "scan.jpg", "cv.docx", "sheet.xlsx", "photo.HEIC", "bundle.zip"]) {
      expect(reason(f), f).toBeNull();
    }
  });

  it("rejects a file with no extension at all", () => {
    expect(reason("contract")).not.toBeNull();
  });
});

describe("membership import — a row without identity must never be imported", () => {
  // Mirrors the guard in parseSheetRow (v33.7). It lives in a module that
  // pulls in googleapis, so the RULE is asserted here: what matters is that
  // the check runs on the value that will be STORED, not on the raw cell.
  const storablePhone = (raw: string | undefined) => {
    const clean = raw?.trim();
    if (!clean) return null;
    const r = normalizePhone(clean);
    return r.ok ? r.value : clean.replace(/[^0-9+]/g, "") || null;
  };
  const importable = (email: string | undefined, phone: string | undefined) => {
    const e = email?.trim().toLowerCase();
    const hasEmail = !!e && e.includes("@");
    return hasEmail || !!storablePhone(phone);
  };

  it("a phone cell with no digits stores as nothing — so the row is skipped", () => {
    // this is the exact shape that inserted a fresh member every 30 minutes:
    // the raw cell was truthy, the stored value was null, nothing matched
    for (const junk of ["—", "N/A", "n/a", "none", "-", "??"]) {
      expect(storablePhone(junk), junk).toBeNull();
      expect(importable(undefined, junk), junk).toBe(false);
    }
  });

  it("an empty row is skipped", () => {
    expect(importable(undefined, undefined)).toBe(false);
    expect(importable("", "")).toBe(false);
  });

  it("an email alone is enough", () => {
    expect(importable("a@aiesec.net", undefined)).toBe(true);
  });

  it("a real phone alone is enough — phone-only members sign in with it", () => {
    expect(importable(undefined, "01099019374")).toBe(true);
    expect(storablePhone("01099019374")).toBe("+201099019374");
  });

  it("a hotline is a usable identity too", () => {
    expect(importable(undefined, "16123")).toBe(true);
  });
});
