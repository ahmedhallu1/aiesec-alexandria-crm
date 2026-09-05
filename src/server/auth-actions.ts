"use server";

import crypto from "node:crypto";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import {
  authErrorMessage,
  failureNeedsHuman,
  normalizeIdentifier,
  passwordFailure,
  passwordFailureMessage,
  routeLogin,
  type LoginIdentity,
  type LoginRoute,
} from "@/lib/login-routing";
import { logAuth } from "./audit";

/** Everything the login flow needs to know about a row, plus the two things
 *  only the server may hold: the member's id (so an auth event names a person)
 *  and whether an inbox exists at all. */
interface IdentityRow extends LoginIdentity {
  id: string;
}

/** Looks the identifier up WITHOUT the active filter, so the login flow can
 *  tell "deactivated" and "email landed — use Google" apart from a plain
 *  wrong password.
 *
 *  ⚠️ THIS RUNS BEFORE ANYONE HAS PROVED ANYTHING. It must therefore never
 *  answer more than "this identifier is / isn't on the membership sheet", plus
 *  the first name so the next screen can greet a member who IS on it. No role,
 *  no function, no team, no email address, no phone number — those would turn
 *  the login page into a directory. The one thing it deliberately does reveal
 *  beyond membership is deactivation; the reasoning is written out in full in
 *  `routeLogin`. */
async function lookupIdentity(identifier: string): Promise<IdentityRow | null> {
  const { db } = await import("@/lib/supabase");
  const cols =
    "id, is_active, name, email, phone, fallback_email, password_hash, temp_password_hash";
  type Raw = {
    id: string;
    is_active: boolean;
    name: string | null;
    email: string | null;
    phone: string | null;
    fallback_email: string | null;
    password_hash: string | null;
    temp_password_hash: string | null;
  };
  const shape = (r: Raw): IdentityRow => ({
    id: r.id,
    is_active: r.is_active,
    name: r.name,
    email: r.email,
    password_hash: r.password_hash,
    temp_password_hash: r.temp_password_hash,
    // an inbox is an inbox: the backup Gmail is exactly what we keep for the
    // members whose @aiesec.net has not landed yet (v33.44)
    hasInbox: !!(r.email ?? "").trim() || !!(r.fallback_email ?? "").trim(),
  });

  if (identifier.includes("@")) {
    const { data } = await db()
      .from("members")
      .select(cols)
      .ilike("email", identifier)
      .maybeSingle<Raw>();
    return data ? shape(data) : null;
  }
  const { asciiDigits } = await import("@/lib/types");
  const digits = asciiDigits(identifier).replace(/\D/g, "");
  if (digits.length < 7) return null;
  const { data } = await db()
    .from("members")
    .select(cols)
    .not("phone", "is", null)
    .ilike("phone", `%${digits.slice(-8)}%`)
    .limit(10);
  const rows = (data ?? []) as Raw[];
  const strip = (s: string | null) => (s ?? "").replace(/\D/g, "");
  // exact digits beat tail matches; among equals an ACTIVE row wins so a
  // tail collision with a deactivated member never bounces an active one
  const rank = (m: Raw) => (strip(m.phone) === digits ? 0 : 2) + (m.is_active ? 0 : 1);
  const tail = digits.slice(-9);
  const hit = rows
    .filter((m) => {
      const md = strip(m.phone);
      return md === digits || md.endsWith(tail) || tail.endsWith(md.slice(-9));
    })
    .sort((a, b) => rank(a) - rank(b))[0];
  return hit ? shape(hit) : null;
}

/** IDENTIFY-FIRST IS AN ENUMERATION ORACLE, AND IT IS CHEAPER THAN THE OLD ONE.
 *
 *  Before v36 you could learn the same fact — is this address on the sheet? —
 *  by submitting the password form and reading which of the two error strings
 *  came back, so nothing new is disclosed here. What IS new is the cost: one
 *  request per identifier instead of a full credentials round trip with a
 *  bcrypt compare in it. So the endpoint gets the same atomic hourly bucket the
 *  public booking page uses (0030): 40 an hour per network, which no human
 *  signing in will ever approach and which makes mining eighty names tedious.
 *
 *  It FAILS OPEN, like every other use of this RPC in the codebase — a broken
 *  counter must never be the thing that stops the LC signing in. */
async function identifyThrottle(): Promise<boolean> {
  try {
    const { db } = await import("@/lib/supabase");
    const { headers } = await import("next/headers");
    const ip =
      (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const hourKey = `loginrl:${ipHash}:${new Date().toISOString().slice(0, 13)}`;
    const { data: n, error } = await db().rpc("bump_rate_bucket", { k: hourKey });
    if (error) {
      console.error("[auth] identify rate bucket failed:", error.message);
      return true;
    }
    return (n ?? 0) <= 40;
  } catch (e) {
    console.error("[auth] identify rate limit check failed:", e);
    return true;
  }
}

export interface IdentifyResult {
  route: LoginRoute | null;
  /** set only when the identifier could not even be looked at (throttled) */
  error: string | null;
}

/** STEP ONE OF THE LOGIN: who are you?
 *
 *  The whole point of v36's login rewrite. Sodio asks for one identifier, works
 *  out which of its four doors is actually yours, and then shows only that one
 *  — instead of putting a fully operable password form in front of the 3
 *  members who have never had a password and a Google button in front of the 15
 *  who have no AIESEC address to press it with. */
export async function identifyMember(rawIdentifier: string): Promise<IdentifyResult> {
  const identifier = normalizeIdentifier(rawIdentifier);
  if (!identifier)
    return { route: null, error: "Type your AIESEC email or your phone number." };
  if (!(await identifyThrottle()))
    return {
      route: null,
      error:
        "Too many sign-in attempts from this network — wait an hour, or message the IM team on WhatsApp.",
    };

  const found = await lookupIdentity(identifier).catch((e) => {
    console.error("[auth] identify lookup failed:", e);
    return null;
  });
  const route = routeLogin(identifier, found);

  if (route.door === "inactive") {
    // recorded before the redirect, because the redirect throws
    await logAuth("inactive_bounce", found?.id ?? null, {
      identifier,
      at: "identify",
    });
    redirect("/inactive");
  }
  if (route.door === "unknown")
    await logAuth("sign_in_failed", null, { identifier, reason: "not_a_member" });

  return { route, error: null };
}

export interface LoginState {
  error: string | null;
  /** the page shows the IM WhatsApp link when retrying cannot help */
  needsHuman?: boolean;
}

/** Password login — the identifier can be the AIESEC email OR the member's
 *  phone number. First-ever sign-in stays Google-only, except for a member
 *  holding an emailed temporary password (`okTemp` in `src/lib/auth.ts`), which
 *  exists precisely so nobody can be locked out. */
export async function loginWithPassword(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  // the form posts `identifier`; `email` is still read as a fallback because
  // that is the field name the credentials provider itself uses
  const typed = String(formData.get("identifier") ?? formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!typed || !password)
    return { error: "Enter your email (or phone) and a password." };
  const identifier = normalizeIdentifier(typed);
  const found = await lookupIdentity(identifier).catch(() => null);
  // deactivated members get the dedicated screen, not a cryptic error
  if (found && !found.is_active) {
    await logAuth("inactive_bounce", found.id, { identifier, at: "password" });
    redirect("/inactive");
  }
  try {
    await signIn("credentials", { email: typed, password, redirectTo: "/" });
    return { error: null };
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.type === "CredentialsSignin") {
        // ONE STRING NO LONGER SERVES THREE PEOPLE (v36). The split lives in
        // `src/lib/login-routing.ts`, pure and pinned by tests/auth-login.test.ts,
        // so the message a member reads is decided by the state of their row
        // rather than by the shape of what they typed.
        const failure = passwordFailure(identifier, found);
        // `authorize` already logged the refusal with the reason it saw; this
        // is not logged twice.
        return {
          error: passwordFailureMessage(failure, identifier),
          needsHuman: failureNeedsHuman(failure),
        };
      }
      // EVERY OTHER Auth.js FAILURE USED TO READ THE SAME (v36). They are
      // operationally different things and the IM team cannot triage
      // "Sign-in failed" — so at least name the ones that mean something.
      await logAuth("sign_in_failed", found?.id ?? null, {
        identifier,
        reason: e.type,
      });
      return { error: authErrorMessage(e.type), needsHuman: true };
    }
    throw e; // NEXT_REDIRECT on success
  }
}

export async function loginWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/" });
}

/** "Forgot password": a fresh password is generated and EMAILED straight to
 *  the member. Their old password keeps working until they change it, so
 *  nobody can lock anyone out by spamming this. */
export async function requestPasswordReset(
  email: string
): Promise<{ ok: boolean; message: string }> {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean.includes("@"))
    return {
      ok: false,
      message:
        "A reset needs an inbox to send to. If you have no AIESEC address yet, message the IM team on WhatsApp — they can set your password by hand.",
    };
  try {
    const { db } = await import("@/lib/supabase");
    // THE BACKUP GMAIL IS AN INBOX TOO (v33.44). The lookup only ever asked
    // the AIESEC column, so a member whose @aiesec.net hasn't landed yet —
    // exactly the person we keep `fallback_email` for — typed the address
    // they actually own, matched nothing, and got the same reassuring
    // "check your inbox" as everyone else while nothing was sent.
    // `issueTempPassword` has always been happy to send there; only finding
    // them was missing.
    // ILIKE takes LIKE metacharacters, and `_` is legal in an email local
    // part — an unescaped one would match a DIFFERENT member's address.
    const pattern = clean.replaceAll("\\", "").replaceAll("%", "\\%").replaceAll("_", "\\_");
    type Row = {
      id: string; name: string; email: string | null;
      fallback_email: string | null; is_active: boolean;
    };
    const find = async (column: "email" | "fallback_email") =>
      (
        await db()
          .from("members")
          .select("id, name, email, fallback_email, is_active")
          .ilike(column, pattern)
          .limit(2)
      ).data as Row[] | null;
    let rows = (await find("email")) ?? [];
    if (rows.length === 0) rows = (await find("fallback_email")) ?? [];

    // THE THREE SILENT FAILURES (v36). All three of these used to end in the
    // same cheerful "Check your inbox 📬", and two of them left a member
    // watching an inbox that was never going to receive anything.
    //
    // Anti-enumeration justifies the silence for exactly ONE of them — nobody
    // matched — because that is the answer that would otherwise turn this
    // endpoint into a membership-list probe. It justifies nothing about the
    // other two, where we know perfectly well who the person is and simply
    // cannot help them without saying so.
    if (rows.length > 1) {
      // never guess: two members sharing one backup address is a data error,
      // and mailing a fresh password to the wrong person is not a recovery
      await logAuth("password_reset_requested", null, {
        identifier: clean,
        reason: "ambiguous",
      }, "failed");
      return {
        ok: false,
        message:
          "Two membership rows share that address, so Sodio can't tell which one is you — it won't guess and email the wrong person. Message the IM team on WhatsApp and they'll sort the duplicate.",
      };
    }
    const member = rows[0] ?? null;
    if (member && !member.is_active) {
      await logAuth("password_reset_requested", member.id, {
        identifier: clean,
        reason: "inactive",
      }, "failed");
      return {
        ok: false,
        message:
          "That account is switched off in the membership sheet, so a new password wouldn't get you in. Ask your VP to reactivate you, or message the IM team.",
      };
    }
    if (member) {
      await logAuth("password_reset_requested", member.id, { identifier: clean });
      const { issueTempPassword } = await import("./password");
      const res = await issueTempPassword(member);
      if (!res.ok) return { ok: false, message: res.error ?? "Couldn't send the password." };
    } else {
      // no row at all: log it (so a burst of these is visible in the console)
      // and answer exactly as if it had worked
      await logAuth("password_reset_requested", null, {
        identifier: clean,
        reason: "no_match",
      }, "failed");
    }
    // same answer whether or not the email exists (no member-list probing)
    return {
      ok: true,
      message:
        "Check your inbox 📬 — a fresh password is on its way. Sign in with it, then change it from your Profile.",
    };
  } catch (e) {
    console.error("[auth] reset request failed:", e);
    return { ok: false, message: "Something went wrong — try again or contact the IM team directly." };
  }
}
