import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { db } from "./supabase";
import { sendEmail } from "./google/gmail";
import { welcomeEmail } from "./email/templates";
import type { Member } from "./types";

/** Full auth config (Node.js only). Sign-in is allowed exclusively for active
 *  emails in the members table — the Membership sheet is the source of truth. */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      try {
        const { data: member } = await db()
          .from("members")
          .select("*")
          .ilike("email", email)
          .maybeSingle<Member>();
        if (!member || !member.is_active) return false;

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
