import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  failureNeedsHuman,
  looksLikeEmail,
  normalizeIdentifier,
  passwordFailure,
  routeLogin,
  type LoginIdentity,
} from "@/lib/login-routing";

/** WHICH DOOR IS ACTUALLY YOURS (v36).
 *
 *  These pin the decision the login page is built on. It is worth pinning
 *  hard, because the failure mode is not a wrong pixel — it is a member who
 *  cannot sign in and has no way to tell why. Two populations in particular
 *  have no second door at all, and both are real, counted numbers from
 *  production rather than hypotheticals:
 *
 *    · 15 of 80 active members have NO AIESEC address. Their username is their
 *      phone and (for 3 of them) so is their password. Break `phone_both` and
 *      a fifth of the LC is locked out with no self-service reset.
 *    · 6 have never set a password. `google_first` is the only thing that can
 *      work for them, and the old page put a fully operable password box in
 *      front of them anyway.
 *
 *  The routing is a pure function precisely so it can be tested here instead
 *  of by typing into a browser and hoping. */

const base: LoginIdentity = {
  is_active: true,
  name: "Hana Wael",
  email: "hana@aiesec.net",
  password_hash: null,
  temp_password_hash: null,
  hasInbox: true,
};
const who = (over: Partial<LoginIdentity> = {}): LoginIdentity => ({ ...base, ...over });

describe("routeLogin — the five doors", () => {
  it("nobody on the sheet is 'unknown', and says nothing else about them", () => {
    const r = routeLogin("ghost@aiesec.net", null);
    expect(r.door).toBe("unknown");
    expect(r.firstName).toBeNull();
    // an identifier that matched nothing must not imply an inbox or a door
    expect(r.canResetByEmail).toBe(false);
    expect(r.phoneAsPasswordWorks).toBe(false);
  });

  it("a member with an AIESEC address and no password gets Google, once", () => {
    const r = routeLogin("hana@aiesec.net", who());
    expect(r.door).toBe("google_first");
    expect(r.firstName).toBe("Hana");
  });

  it("a member with a password of their own gets the password door", () => {
    expect(routeLogin("hana@aiesec.net", who({ password_hash: "x" })).door).toBe("password");
  });

  it("AN EMAILED TEMPORARY PASSWORD BEATS THE GOOGLE-FIRST RULE", () => {
    // `okTemp` in auth.ts lets it through on a first sign-in precisely so
    // nobody is ever locked out. If this routed to google_first the page would
    // be telling somebody their only option is Google while a password that
    // works is sitting in their inbox.
    const r = routeLogin("hana@aiesec.net", who({ temp_password_hash: "t" }));
    expect(r.door).toBe("password");
    expect(r.hasTempPassword).toBe(true);
  });

  it("NO EMAIL AND NO PASSWORD → phone_both, the only door those members have", () => {
    const r = routeLogin("01001234567", who({ email: null, hasInbox: false }));
    expect(r.door).toBe("phone_both");
    expect(r.usernameIsPhone).toBe(true);
    expect(r.phoneAsPasswordWorks).toBe(true);
  });

  it("a phone-only member who HAS set a password goes to the password door", () => {
    // the phone-in-both-fields door closes the moment a password exists —
    // mirrors okPhoneAsPassword exactly
    const r = routeLogin("01001234567", who({ email: null, password_hash: "x" }));
    expect(r.door).toBe("password");
    expect(r.phoneAsPasswordWorks).toBe(false);
    expect(r.usernameIsPhone).toBe(true);
  });

  it("a phone-only member with only a TEMPORARY password keeps the phone door open", () => {
    // okPhoneAsPassword ignores temp_password_hash, so the route must too —
    // otherwise we would close the one door that works and offer a password
    // they may never have received.
    const r = routeLogin("01001234567", who({ email: null, temp_password_hash: "t" }));
    expect(r.phoneAsPasswordWorks).toBe(true);
  });

  it("a deactivated member is 'inactive' whatever else is true of them", () => {
    for (const over of [{}, { password_hash: "x" }, { email: null }]) {
      expect(routeLogin("x", who({ ...over, is_active: false })).door).toBe("inactive");
    }
  });

  it("offers a reset only when an inbox exists to send it to", () => {
    expect(routeLogin("a@aiesec.net", who({ password_hash: "x", hasInbox: true })).canResetByEmail).toBe(true);
    // a button that silently does nothing is worse than no button
    expect(routeLogin("0100", who({ email: null, password_hash: "x", hasInbox: false })).canResetByEmail).toBe(false);
  });

  it("never leaks anything beyond the first name", () => {
    const r = routeLogin("hana@aiesec.net", who({ name: "Hana Wael Mahmoud" }));
    expect(r.firstName).toBe("Hana");
    expect(JSON.stringify(r)).not.toContain("Mahmoud");
    // the row's own email is never echoed — only what the caller typed
    expect(JSON.stringify(r)).not.toContain("aiesec.net\",\"email");
  });
});

describe("normalizeIdentifier / looksLikeEmail", () => {
  it("trims and lower-cases, like every lookup in the auth path", () => {
    expect(normalizeIdentifier("  Hana@AIESEC.net ")).toBe("hana@aiesec.net");
  });
  it("tells an address from a phone number", () => {
    expect(looksLikeEmail("hana@aiesec.net")).toBe(true);
    expect(looksLikeEmail("01001234567")).toBe(false);
  });
});

describe("passwordFailure — one sentence per person, not one for three", () => {
  it("distinguishes the people the old single string served", () => {
    const notAMember = passwordFailure("ghost@aiesec.net", null);
    const neverSignedIn = passwordFailure("hana@aiesec.net", who());
    const phoneClosed = passwordFailure("01001234567", who({ email: null, password_hash: "x" }));
    const wrongPassword = passwordFailure("hana@aiesec.net", who({ password_hash: "x" }));
    expect(notAMember).toBe("not_a_member");
    expect(neverSignedIn).toBe("never_set");
    expect(phoneClosed).toBe("phone_door_closed");
    expect(wrongPassword).toBe("wrong_password");
    // four genuinely different situations, four different answers — the whole
    // point, since one string used to serve the first three
    expect(new Set([notAMember, neverSignedIn, phoneClosed, wrongPassword]).size).toBe(4);
  });

  it("tells a member whose AIESEC address just landed why their phone stopped working", () => {
    // they typed a PHONE, the row now has an email and no password: the
    // phone-in-both-fields door closed under them. The old shape-based tip
    // read as "your number isn't on the sheet", the opposite of true.
    expect(passwordFailure("01001234567", who())).toBe("email_landed");
  });

  it("a deactivated member never becomes an error string — /inactive owns them", () => {
    expect(passwordFailure("hana@aiesec.net", who({ is_active: false }))).toBe("inactive");
  });

  it("flags the failures a human has to fix, so the page can offer WhatsApp", () => {
    expect(failureNeedsHuman("not_a_member")).toBe(true);
    expect(failureNeedsHuman("phone_door_closed")).toBe(true);
    expect(failureNeedsHuman("wrong_password")).toBe(false);
  });
});

describe("authErrorMessage", () => {
  it("names the Google failures that mean different things", () => {
    const denied = authErrorMessage("AccessDenied");
    const callback = authErrorMessage("OAuthCallback");
    const config = authErrorMessage("Configuration");
    expect(new Set([denied, callback, config]).size).toBe(3);
    // the one people actually hit should say what to DO about it
    expect(denied.toLowerCase()).toContain("aiesec.net");
  });

  it("is a plain string, never a Promise", () => {
    // ⚠️ it lives in this pure module and NOT in auth-actions.ts, because that
    // file carries "use server" and every export of one must be async — an
    // async version would render "[object Promise]" to somebody who is
    // already failing to sign in.
    expect(typeof authErrorMessage("whatever")).toBe("string");
  });

  it("always answers, even for an error type nobody has seen before", () => {
    expect(authErrorMessage("SomethingNew").length).toBeGreaterThan(10);
  });
});
