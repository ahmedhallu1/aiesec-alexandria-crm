import "server-only";
import bcrypt from "bcryptjs";
import { db } from "@/lib/supabase";
import { sendEmail } from "@/lib/google/gmail";
import { newPasswordEmail } from "@/lib/email/templates";
import { notifyMembers } from "./notify";

/** Readable random password (no confusable characters). */
export function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return `Elevate-${out}`;
}

/** "Forgot password" flow: generates a fresh password, stores its hash as the
 *  member's TEMP password (any existing password keeps working until they set
 *  a new one — nobody can lock someone out by requesting resets), and emails
 *  it straight to the member. */
export async function issueTempPassword(member: {
  id: string;
  email: string;
  name: string;
  nickname: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const password = generatePassword();
  const temp_password_hash = await bcrypt.hash(password, 10);
  const { error } = await db()
    .from("members")
    .update({ temp_password_hash, temp_password_at: new Date().toISOString() })
    .eq("id", member.id);
  if (error) {
    return {
      ok: false,
      error: error.message.includes("temp_password")
        ? "Password emails need migration 0009 — ask the IM team."
        : error.message,
    };
  }
  try {
    const mail = newPasswordEmail({
      memberFirstName: member.nickname || member.name.split(" ")[0],
      password,
    });
    await sendEmail({ to: [member.email], ...mail });
  } catch (e) {
    console.error("[auth] password email failed:", e);
    return { ok: false, error: "Couldn't send the email — try again or contact the IM team." };
  }
  await notifyMembers(
    [member.id],
    "reset",
    "A fresh password is in your inbox 🔑",
    "We emailed you a new password. Use it to sign in, then change it from your Profile anytime."
  );
  return { ok: true };
}
