import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { db } from "./supabase";
import { sendEmail } from "./google/gmail";
import { welcomeEmail } from "./email/templates";
import type { Member } from "./types";

async function findMember(email: string): Promise<Member | null> {
  const { data: member } = await db()
    .from("members")
    .select("*")
    .ilike("email", email)
    .maybeSingle<Member>();
  return member && member.is_active ? member : null;
}

function markFirstLogin(member: Member) {
  if (member.first_login_at) return;
  db()
    .from("members")
    .update({ first_login_at: new Date().toISOString() })
    .eq("id", member.id)
    .then(() => {
      const mail = welcomeEmail(member);
      sendEmail({ to: [member.email], ...mail }).catch((e) =>
        console.error("[auth] welcome email failed:", e)
      );
    });
}

/** Full auth config (Node.js only). Sign-in is allowed exclusively for active
 *  emails in the members table — the Membership sheet is the source of truth.
 *
 *  Password login: until a member sets their own password (first-login
 *  onboarding), ANY password is accepted for their listed email. Once set,
 *  it is verified with bcrypt. Google sign-in stays available (it also grants
 *  the calendar permission used for visit reminders). */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        try {
          const member = await findMember(email);
          if (!member) return null;
          if (member.password_hash) {
            const ok = await bcrypt.compare(password, member.password_hash);
            if (!ok) return null;
          }
          // no password set yet → any password logs in; onboarding will set one
          markFirstLogin(member);
          return {
            email: member.email,
            name: member.nickname || member.name,
            image: member.photo_url,
          };
        } catch (e) {
          console.error("[auth] credentials check failed:", e);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true; // credentials already checked
      const email = user.email?.toLowerCase();
      if (!email) return false;
      try {
        const member = await findMember(email);
        if (!member) return false;

        const updates: Record<string, unknown> = {};
        if (account?.refresh_token) updates.google_refresh_token = account.refresh_token;
        const picture = (profile as { picture?: string } | null)?.picture;
        if (picture && picture !== member.photo_url) updates.photo_url = picture;
        const firstLogin = !member.first_login_at;
        if (firstLogin) updates.first_login_at = new Date().toISOString();
        if (Object.keys(updates).length > 0) {
          await db().from("members").update(updates).eq("id", member.id);
        }
        if (firstLogin) {
          const mail = welcomeEmail(member);
          sendEmail({ to: [member.email], ...mail }).catch((e) =>
            console.error("[auth] welcome email failed:", e)
          );
        }
        return true;
      } catch (e) {
        console.error("[auth] sign-in check failed:", e);
        return false;
      }
    },
  },
});
