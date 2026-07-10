"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export interface LoginState {
  error: string | null;
}

/** Email + password login. Members with no password yet are accepted with any
 *  password and routed to the first-login onboarding to set their own. */
export async function loginWithPassword(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and a password." };
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    return { error: null };
  } catch (e) {
    if (e instanceof AuthError) {
      return {
        error:
          e.type === "CredentialsSignin"
            ? "Wrong password — or this email is not on the LC membership list. If you forgot your password, ask the IM team to reset it."
            : "Sign-in failed. Try again — if it keeps happening, contact the IM team.",
      };
    }
    throw e; // NEXT_REDIRECT on success
  }
}

export async function loginWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/" });
}

/** "Forgot password" CTA: notifies the IM team (director + coach) that this
 *  member wants a reset. Public on purpose — it only ever emails the IM team. */
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
      .select("name, nickname, email, is_active")
      .ilike("email", clean)
      .maybeSingle();
    if (member?.is_active) {
      const [{ sendEmail }, { passwordResetRequestEmail }, { FEEDBACK_INBOX_EMAILS }] =
        await Promise.all([
          import("@/lib/google/gmail"),
          import("@/lib/email/templates"),
          import("@/lib/types"),
        ]);
      const mail = passwordResetRequestEmail({
        memberName: member.nickname || member.name,
        memberEmail: member.email,
      });
      sendEmail({ to: [...FEEDBACK_INBOX_EMAILS], ...mail }).catch((e) =>
        console.error("[auth] reset-request email failed:", e)
      );
    }
    // same answer whether or not the email exists (no member-list probing)
    return {
      ok: true,
      message:
        "The IM team was notified ✅ — once they reset it, sign in with ANY password and you'll set a new one.",
    };
  } catch (e) {
    console.error("[auth] reset request failed:", e);
    return { ok: false, message: "Something went wrong — try again or contact the IM team directly." };
  }
}
