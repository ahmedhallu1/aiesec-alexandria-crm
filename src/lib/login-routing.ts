/** WHICH DOOR IS ACTUALLY YOURS (v36).
 *
 *  Sodio has four different ways in and, until now, showed all of them to
 *  everybody at once and let the member guess. The guess is usually wrong,
 *  because which door works is a property of the MEMBER'S ROW, not of anything
 *  they can see:
 *
 *    · a member who has never signed in has no password, so the password form
 *      in front of them cannot possibly work — but it is fully operable, and
 *      the only statement of that rule was an 11px grey paragraph at the foot
 *      of the page;
 *    · **15 of the 80 active members have no AIESEC email at all** (verified in
 *      production 2026-09-05). Their phone is BOTH the username and the
 *      password. That is a fifth of the LC, not an edge case, and the only
 *      place it was ever said was a placeholder inside the password box;
 *    · **13 of those 15 have no inbox on file anywhere** — no AIESEC address,
 *      no backup Gmail — so "Forgot password?" can never reach them. Twelve of
 *      them DO have a password. If they forget it there is no self-service
 *      recovery whatsoever, only a human.
 *
 *  So the login page asks who you are first and then shows one door. This
 *  module is the decision, kept pure and away from Next, the database and
 *  React, because it is the part that must be right and the part worth testing
 *  (`tests/auth-login.test.ts`). It never reads a password and never compares
 *  one — it only says which door to open. */

/** What the caller looked the identifier up and found. Deliberately the
 *  narrowest shape that answers the question: no role, no function, no team.
 *  See `identifyMember` in `src/server/auth-actions.ts` for why. */
export interface LoginIdentity {
  is_active: boolean;
  /** the display name, for the greeting only */
  name: string | null;
  email: string | null;
  password_hash: string | null;
  temp_password_hash: string | null;
  /** whether ANY inbox exists we could email a fresh password to — a boolean,
   *  never the address itself: the login page has no business handing out a
   *  member's personal Gmail to whoever typed their phone number */
  hasInbox: boolean;
}

export type LoginDoor =
  /** never signed in and has an AIESEC address: Google, once, and only Google */
  | "google_first"
  /** a password (their own, or an emailed temporary one) exists */
  | "password"
  /** no AIESEC address on the sheet: the phone is username AND password */
  | "phone_both"
  /** on the sheet but switched off — /inactive says so properly */
  | "inactive"
  /** not on the membership sheet under what they typed */
  | "unknown";

export interface LoginRoute {
  door: LoginDoor;
  /** first name only — enough to say "yes, Sodio knows you", and the least it
   *  can be said with. null when we found nobody. */
  firstName: string | null;
  /** echoed back so the next screen can name what they typed */
  identifier: string;
  /** shapes the "we couldn't find that" copy: a mistyped @aiesec.net and a
   *  phone number that isn't on the sheet are two different conversations */
  looksLikeEmail: boolean;
  /** their username is their phone number, because no AIESEC address exists */
  usernameIsPhone: boolean;
  /** the phone-in-both-fields door is genuinely open right now — this mirrors
   *  `okPhoneAsPassword` in `src/lib/auth.ts` exactly (no email AND no password
   *  of their own; a temporary one does not close it) */
  phoneAsPasswordWorks: boolean;
  /** an emailed temporary password exists. It bypasses the Google-first rule on
   *  purpose (`okTemp`, so nobody is ever locked out) — which means the copy
   *  must NOT tell this person their first sign-in has to be Google. */
  hasTempPassword: boolean;
  /** "Forgot password?" can actually deliver something. False for the 13
   *  members with no inbox anywhere: offering them a button that silently does
   *  nothing is worse than telling them to message the IM team. */
  canResetByEmail: boolean;
}

/** Trim + lower-case the way every lookup in the auth path already does, so the
 *  decision and the lookup can never disagree about what was typed. */
export function normalizeIdentifier(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@");
}

/** THE DECISION. `found` is null when the identifier matched no membership row.
 *
 *  Order matters, and each step is a fact about what would actually happen if
 *  the member pressed the button:
 *
 *   1. nobody → `unknown`. Nothing else can be true.
 *   2. deactivated → `inactive`.
 *      ⚠️ THIS IS DISCLOSED BEFORE AUTHENTICATION, DELIBERATELY. An
 *      unauthenticated caller can confirm that an address belongs to a
 *      deactivated member. The pre-v36 code already did this (it redirected on
 *      the probe, before checking the password) and the trade-off is accepted
 *      knowingly: this is an internal tool whose membership list lives in a
 *      Google Sheet every EB member can read, so "is X still in the LC" is not
 *      a secret worth protecting — while a deactivated member stuck in a
 *      generic wrong-password loop is a support ticket every single time, and
 *      /inactive exists precisely to answer them.
 *   3. a password of ANY kind exists → `password`. This is checked BEFORE the
 *      email test on purpose: the 12 phone-only members who have set a password
 *      type their phone as the username, and an emailed temporary password
 *      beats the Google-first rule (`okTemp`).
 *   4. no password and no email → `phone_both`. This is the ONLY door those 3
 *      members have.
 *   5. otherwise → `google_first`: an AIESEC address, no password, so Google is
 *      the only thing that can work. */
export function routeLogin(
  rawIdentifier: string,
  found: LoginIdentity | null
): LoginRoute {
  const identifier = normalizeIdentifier(rawIdentifier);
  const asEmail = looksLikeEmail(identifier);

  const base = {
    identifier,
    looksLikeEmail: asEmail,
    firstName: null as string | null,
    usernameIsPhone: false,
    phoneAsPasswordWorks: false,
    hasTempPassword: false,
    canResetByEmail: false,
  };

  if (!found) return { ...base, door: "unknown" };

  const firstName = (found.name ?? "").trim().split(/\s+/)[0] || null;
  const hasEmail = !!(found.email ?? "").trim();
  const hasOwnPassword = !!found.password_hash;
  const hasTempPassword = !!found.temp_password_hash;

  const shared = {
    ...base,
    firstName,
    usernameIsPhone: !hasEmail,
    hasTempPassword,
    // mirrors okPhoneAsPassword: a temporary password does not close this door
    phoneAsPasswordWorks: !hasEmail && !hasOwnPassword,
    canResetByEmail: found.hasInbox,
  };

  if (!found.is_active) return { ...shared, door: "inactive" };
  if (hasOwnPassword || hasTempPassword) return { ...shared, door: "password" };
  if (!hasEmail) return { ...shared, door: "phone_both" };
  return { ...shared, door: "google_first" };
}

// --------------------------------------------------------------- the failures

/** WHY A PASSWORD SIGN-IN WAS REFUSED.
 *
 *  Before v36 one string served three unrelated people (`auth-actions.ts:96`):
 *  a real member who had simply never set a password, somebody typing their
 *  personal Gmail, and somebody not on the membership sheet at all. All three
 *  were told "Wrong password — or you haven't set one yet… your FIRST sign-in
 *  must be with Google", which sent the last two to the Google button to fail
 *  again for a completely different reason, and told the first that the thing
 *  they were about to try was the thing that would work. */
export type PasswordFailure =
  /** a password exists and that wasn't it */
  | "wrong_password"
  /** on the sheet, an AIESEC address, but no password has ever been set */
  | "never_set"
  /** was phone-only, the AIESEC address has since landed: Google unlocks it */
  | "email_landed"
  /** phone-only AND has set a password: the phone-in-both trick is over */
  | "phone_door_closed"
  /** no membership row matches what was typed */
  | "not_a_member"
  /** switched off — handled by /inactive, never as an error string */
  | "inactive";

export function passwordFailure(
  rawIdentifier: string,
  found: LoginIdentity | null
): PasswordFailure {
  const identifier = normalizeIdentifier(rawIdentifier);
  if (!found) return "not_a_member";
  if (!found.is_active) return "inactive";
  const hasEmail = !!(found.email ?? "").trim();
  const hasAnyPassword = !!found.password_hash || !!found.temp_password_hash;

  // No password of any kind, but an AIESEC address exists — so Google is the
  // only way through either way. The two variants differ only in what the
  // member needs told: somebody who TYPED A PHONE was using the phone-in-both-
  // fields door successfully until their address landed and closed it, and the
  // thing they actually need is the reason it stopped, not a rule they have
  // never met. Somebody who typed an email is simply new here.
  if (hasEmail && !hasAnyPassword)
    return looksLikeEmail(identifier) ? "never_set" : "email_landed";
  // The mirror case: still no AIESEC address, but they set a password, so the
  // phone-in-both-fields trick stopped working the day they did. Telling them
  // to use it (the old shape-based tip) reads as "your number isn't on the
  // membership sheet", which is the opposite of true.
  if (!hasEmail && found.password_hash) return "phone_door_closed";
  return "wrong_password";
}

/** The sentence the member reads. Kept beside the decision so the two cannot
 *  drift, and pure so the tests can assert the split rather than trusting it.
 *
 *  No link is baked into the text: the UI renders the IM WhatsApp button itself
 *  (see `failureNeedsHuman`), because a bare URL inside a sentence is not
 *  something anybody taps on a phone. */
export function passwordFailureMessage(
  failure: PasswordFailure,
  identifier: string
): string {
  switch (failure) {
    case "wrong_password":
      return "That password isn't right. Try again — or use “Forgot password?” and Sodio will email you a fresh one.";
    case "never_set":
      return "You haven't set a password yet. Sign in with GOOGLE once — it connects your calendar and lets Sodio send email as you. You'll set a password immediately after.";
    case "email_landed":
      return "Your AIESEC email is on Sodio now 🎉 — so your phone no longer works as a password. Sign in with GOOGLE once to unlock everything, then set a password from your Profile.";
    case "phone_door_closed":
      return "This number IS on Sodio — but a password was set for this account, so typing your phone in both fields no longer works. Type your phone and that PASSWORD.";
    case "inactive":
      return "This account is switched off in the membership sheet.";
    case "not_a_member":
      return looksLikeEmail(identifier)
        ? `We couldn't find ${identifier} on the membership sheet. It has to be the AIESEC address that is ON the sheet — a personal Gmail will never match.`
        : `We couldn't find ${identifier} on the membership sheet. Check the number, or try your @aiesec.net address instead.`;
  }
}

/** Does this failure need a human rather than another attempt? These are the
 *  ones where trying again cannot possibly help, so the page shows the IM
 *  WhatsApp link instead of leaving somebody retyping. */
export function failureNeedsHuman(failure: PasswordFailure): boolean {
  return failure === "not_a_member" || failure === "phone_door_closed";
}

/** Auth.js error types, in words a member and the IM team can both act on.
 *
 *  ⚠️ IT LIVES HERE, NOT IN auth-actions.ts, FOR A REASON THE BUILD ENFORCES:
 *  that file carries "use server", and every export of a "use server" module
 *  must be an async function — Next rejects the build otherwise. This is a
 *  pure switch over a string with no business being a server action, and
 *  making it async to satisfy the rule would put a Promise where `/login`
 *  renders a sentence, i.e. "[object Promise]" in front of somebody who is
 *  already failing to sign in. Keeping it pure also lets the login page and
 *  the tests read it directly. */
export function authErrorMessage(type: string): string {
  switch (type) {
    case "AccessDenied":
      return "That Google account isn't on the LC membership list. Make sure you picked your @aiesec.net account — a personal Gmail will never match.";
    case "OAuthCallbackError":
    case "OAuthCallback":
    case "Callback":
      return "Google didn't finish the sign-in. This is usually several Google accounts fighting in one browser: sign out of the others (or use a private window) and try again.";
    case "OAuthAccountNotLinked":
      return "That Google account is already tied to a different Sodio member. Pick your own @aiesec.net account.";
    case "Configuration":
      return "Sodio's Google sign-in is misconfigured — this one is on us, not on you. Tell the IM team; use your password meanwhile if you have one.";
    case "Verification":
      return "That sign-in link has expired. Start again from the login page.";
    default:
      return "Sign-in failed. Try once more — if it keeps happening, tell the IM team what you typed and what you saw.";
  }
}
