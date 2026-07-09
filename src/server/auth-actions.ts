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
