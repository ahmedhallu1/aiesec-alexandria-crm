import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/** Edge-safe part of the auth config (used by middleware). Database-touching
 *  callbacks live in auth.ts and only run in the Node.js route handler. */
export const authConfig = {
  trustHost: true,
  providers: [
    Google({
      authorization: {
        params: {
          // Full calendar (visit reminders + future availability features) and
          // gmail.send (future: emails sent on the member's own behalf).
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
