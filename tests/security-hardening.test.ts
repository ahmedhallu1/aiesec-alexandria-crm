import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isSafeStorageKey } from "@/lib/storage-key";
import { exactIlike } from "@/lib/like-pattern";
import { cxpMimeType, isDangerousFile } from "@/lib/cxp/drive";
import { redactForSharedCopy } from "@/server/backup";

const UID = "3f2a9c1e-1b2c-4d5e-8f90-112233445566";

describe("isSafeStorageKey — only keys we could have issued (v37.7)", () => {
  it("accepts the shapes the upload actions issue", () => {
    expect(isSafeStorageKey(`${UID}/1712345678901-${UID}-screenshot (1).png`)).toBe(true);
    expect(isSafeStorageKey(`${UID}/${UID}/1712345678901-contract.pdf`)).toBe(true);
    expect(isSafeStorageKey(`1712345678901-${UID}-cv_final.pdf`)).toBe(true);
  });
  it("refuses dot-segments that walk out of the bucket", () => {
    expect(isSafeStorageKey(`${UID}/../../contracts/a/b/c.pdf`)).toBe(false);
    expect(isSafeStorageKey(`${UID}/./x.png`)).toBe(false);
    expect(isSafeStorageKey(`../cvs/x.pdf`)).toBe(false);
  });
  it("refuses encodings, separators and empty segments", () => {
    for (const k of [
      `${UID}/%2e%2e/x`, `${UID}\\..\\x`, `/${UID}/x`, `${UID}//x`, `${UID}/x?y=1`,
      `${UID}/x#frag`, `${UID}/x\u0000`, "", "a".repeat(1025),
    ])
      expect(isSafeStorageKey(k)).toBe(false);
    expect(isSafeStorageKey(undefined)).toBe(false);
    expect(isSafeStorageKey(42)).toBe(false);
  });
});

describe("exactIlike — an identity lookup matches ONE address (v37.7)", () => {
  it("escapes LIKE wildcards so `_` and `%` are literal", () => {
    expect(exactIlike("mona_ali@outlook.com")).toBe("mona\\_ali@outlook.com");
    expect(exactIlike("%hallul%@%")).toBe("\\%hallul\\%@\\%");
    expect(exactIlike("a\\b@x.com")).toBe("a\\\\b@x.com");
  });
  it("leaves ordinary addresses untouched", () => {
    expect(exactIlike("ahmed.hallul@aiesec.net")).toBe("ahmed.hallul@aiesec.net");
  });
  it("cannot express `*` (PostgREST reads it as %), so it is no match at all", () => {
    expect(exactIlike("*@aiesec.net")).toBeNull();
  });
  it("is what every identity lookup uses — no raw ilike('email', …) is left", () => {
    for (const f of ["src/lib/auth.ts", "src/server/auth-actions.ts", "src/server/data.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\.ilike\("email", (email|identifier)\)/);
    }
  });
});

describe("CXP documents served from Sodio's origin cannot run script (v37.7)", () => {
  it("stores a type decided by the extension, never the browser's claim", () => {
    expect(cxpMimeType("passport.PDF")).toBe("application/pdf");
    expect(cxpMimeType("photo.jpeg")).toBe("image/jpeg");
    expect(cxpMimeType("evil.html")).toBe("application/octet-stream");
    expect(cxpMimeType("no-extension")).toBe("application/octet-stream");
  });
  it("refuses active web content as an upload", () => {
    for (const n of ["x.html", "x.htm", "x.svg", "x.xhtml", "x.xml", "x.mhtml"])
      expect(isDangerousFile(n), n).toBe(true);
    expect(isDangerousFile("scan.pdf")).toBe(false);
  });
  it("the file route only inlines inert types", () => {
    const src = readFileSync("src/app/api/cxp/file/route.ts", "utf8");
    expect(src).toMatch(/INLINE_SAFE_TYPES/);
    expect(src).not.toMatch(/"Content-Type": file\.mimeType,/);
    expect(src).not.toMatch(/image\/svg/);
  });
});

describe("the EB-visible backup copy carries no credentials (v37.7)", () => {
  const payload = {
    takenAt: "2026-10-03T02:00:00.000Z",
    note: "x",
    data: {
      members: [{ id: "m1", name: "Mona", password_hash: "h", temp_password_hash: "t", temp_password_at: "2026", google_refresh_token: "r", phone: "+201" }],
      ir_calls: [{ id: "c1", booker_name: "IR", manage_token: "tok" }],
      lc_feedback: [
        { id: "f1", anonymous: true, author_id: "m1", message: "hi", attachments: [{ path: "m1/x.png" }] },
        { id: "f2", anonymous: false, author_id: "m2", message: "yo", attachments: [] },
      ],
      feedback: [{ id: "b1", anonymous: true, member_id: null, attachments: [{ path: "m1/y.png" }] }],
      cvs: [{ id: "v1", file_hash: "abc", person_name: "EP" }],
    },
  };
  const out = redactForSharedCopy(payload) as { data: Record<string, Record<string, unknown>[]> };
  it("drops hashes and tokens but keeps the row", () => {
    expect(out.data.members[0]).toEqual({ id: "m1", name: "Mona", phone: "+201" });
    expect(out.data.ir_calls[0]).toEqual({ id: "c1", booker_name: "IR" });
  });
  it("forgets who wrote an anonymous note, and its attachment keys", () => {
    expect(out.data.lc_feedback[0].author_id).toBeNull();
    expect(out.data.lc_feedback[0].attachments).toEqual([]);
    expect(out.data.lc_feedback[1].author_id).toBe("m2");
    expect(out.data.feedback[0].attachments).toEqual([]);
  });
  it("does not touch the original payload (the bucket copy stays complete)", () => {
    expect(payload.data.members[0].password_hash).toBe("h");
    expect(payload.data.lc_feedback[0].author_id).toBe("m1");
  });
});
