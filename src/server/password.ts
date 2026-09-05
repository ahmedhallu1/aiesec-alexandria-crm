import "server-only";
import bcrypt from "bcryptjs";
import { db } from "@/lib/supabase";
import { sendEmail } from "@/lib/google/gmail";
import { newPasswordEmail } from "@/lib/email/templates";
import { notifyMembers } from "./notify";
import { logAuth } from "./audit";

/** Readable random password (no confusable characters). */
export function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return `Sodio-${out}`;
}

/** "Forgot password" flow: generates a fresh password, stores its hash as the
 *  member's TEMP password (any existing password keeps working until they set
 *  a new one — nobody can lock someone out by requesting resets), and emails
 *  it straight to the member. */
export async function issueTempPassword(member: {
  id: string;
  email: string | null;
  /** the personal Gmail that stands in until the AIESEC address lands */
  fallback_email?: string | null;
  name: string;
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
      memberFirstName: member.name.split(" ")[0],
      password,
    });
    // the AIESEC address when it exists, the fallback Gmail until then (v33.29)
    const dest = member.email ?? member.fallback_email;
    if (!dest) {
      await logAuth("password_issued", member.id, { reason: "no_inbox" }, "failed");
      return { ok: false, error: "No email on file — ask the IM team to add one." };
    }
    await sendEmail({ to: [dest], ...mail });
  } catch (e) {
    console.error("[auth] password email failed:", e);
    await logAuth("password_issued", member.id, { reason: "send_failed" }, "failed");
    return { ok: false, error: "Couldn't send the email — try again or contact the IM team." };
  }
  // ⚠️ RECORDED, AND THE PASSWORD ITSELF NEVER IS. A fresh password being
  // minted for somebody is exactly the event an audit trail exists for — it is
  // the one path that hands out a working credential without the holder
  // proving anything — but `details` is read back by whoever opens /admin, so
  // it carries only WHICH INBOX it went to, and only whether that was the
  // AIESEC address or the fallback. Never the password, never the address.
  await logAuth("password_issued", member.id, {
    sent_to: member.email ? "aiesec" : "fallback",
  });
  await notifyMembers(
    [member.id],
    "reset",
    "A fresh password is in your inbox 🔑",
    "We emailed you a new password. Use it to sign in, then change it from your Profile anytime."
  );
  return { ok: true };
}
