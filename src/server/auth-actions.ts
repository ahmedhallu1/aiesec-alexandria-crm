"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";

interface LoginProbe {
  is_active: boolean;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  temp_password_hash: string | null;
}

/** Looks the identifier up WITHOUT the active filter, so the login flow can
 *  tell "deactivated" and "email landed — use Google" apart from a plain
 *  wrong password. */
async function probeMember(identifier: string): Promise<LoginProbe | null> {
  const { db } = await import("@/lib/supabase");
  const cols = "is_active, email, phone, password_hash, temp_password_hash";
  if (identifier.includes("@")) {
    const { data } = await db().from("members").select(cols).ilike("email", identifier).maybeSingle<LoginProbe>();
    return data ?? null;
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
  const rows = (data ?? []) as LoginProbe[];
  const strip = (s: string | null) => (s ?? "").replace(/\D/g, "");
  // exact digits beat tail matches; among equals an ACTIVE row wins so a
  // tail collision with a deactivated member never bounces an active one
  const rank = (m: LoginProbe) =>
    (strip(m.phone) === digits ? 0 : 2) + (m.is_active ? 0 : 1);
  const tail = digits.slice(-9);
  return (
    rows
      .filter((m) => {
        const md = strip(m.phone);
        return md === digits || md.endsWith(tail) || tail.endsWith(md.slice(-9));
      })
      .sort((a, b) => rank(a) - rank(b))[0] ?? null
  );
}

export interface LoginState {
  error: string | null;
}

/** Password login — the identifier can be the AIESEC email OR the member's
 *  phone number. First-ever sign-in stays Google-only. */
export async function loginWithPassword(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password)
    return { error: "Enter your email (or phone) and a password." };
  const probe = await probeMember(email.toLowerCase()).catch(() => null);
  // deactivated members get the dedicated screen, not a cryptic error
  if (probe && !probe.is_active) redirect("/inactive");
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    return { error: null };
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.type === "CredentialsSignin") {
        // a former phone-only member whose AIESEC email has landed: the
        // phone-as-password door is closed — Google unlocks the full account
        if (probe && probe.email && !probe.password_hash && !probe.temp_password_hash)
          return {
            error:
              "Your AIESEC email is on Sodio now 🎉 — sign in with GOOGLE once to unlock everything (calendar, Gmail drafts). After that you can set a password from your Profile.",
          };
        // a phone-only member who already SET a password: the phone-in-both-
        // fields door closed the moment they did — telling them to use it
        // (the shape-based tip below) reads as "your number isn't on the
        // membership". Same membership-confirmation precedent as the branch
        // above.
        if (probe && !probe.email && probe.password_hash && !email.includes("@"))
          return {
            error:
              "This number IS on Sodio — but a password was set for this account, so the phone-in-both-fields trick no longer works. Type your phone + that PASSWORD. Forgot it? Ask the IM team to reset it.",
          };
        // the phone tip keys off the identifier SHAPE, not the probe — the
        // login form must not confirm who is or isn't a member
        return {
          error: !email.includes("@")
            ? "That didn't match. No AIESEC email yet? Type your PHONE NUMBER in both fields (identifier and password) to get in."
            : "Wrong password — or you haven't set one yet. Your FIRST sign-in must be with Google (it connects your calendar); after that you can use your email or phone + password.",
        };
      }
      return { error: "Sign-in failed. Try again — if it keeps happening, contact the IM team." };
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
    return { ok: false, message: "Type your AIESEC email first." };
  try {
    const { db } = await import("@/lib/supabase");
    const { data: member } = await db()
      .from("members")
      .select("id, name, email, fallback_email, is_active")
      .ilike("email", clean)
      .maybeSingle<{
        id: string; name: string; email: string; is_active: boolean;
      }>();
    if (member?.is_active) {
      const { issueTempPassword } = await import("./password");
      const res = await issueTempPassword(member);
      if (!res.ok) return { ok: false, message: res.error ?? "Couldn't send the password." };
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
