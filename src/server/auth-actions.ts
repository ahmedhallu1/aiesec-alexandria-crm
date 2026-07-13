"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

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
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    return { error: null };
  } catch (e) {
    if (e instanceof AuthError) {
      return {
        error:
          e.type === "CredentialsSignin"
            ? "Wrong password — or you haven't set one yet. Your FIRST sign-in must be with Google (it connects your calendar); after that you can use your email or phone + password."
            : "Sign-in failed. Try again — if it keeps happening, contact the IM team.",
      };
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
      .select("id, name, nickname, email, is_active")
      .ilike("email", clean)
      .maybeSingle<{
        id: string; name: string; nickname: string | null; email: string; is_active: boolean;
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
