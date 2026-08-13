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
          // Full calendar (visit reminders + availability features) and
          // gmail.compose (proposal DRAFTS created in the member's own Gmail,
          // which they review and send themselves).
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.compose",
          access_type: "offline",
          // ALWAYS SHOW THE ACCOUNT PICKER (v33.44). With `consent` alone
          // Google reuses whatever account context the browser is already in
          // — the `authuser=1` in the failing URL — and a member signed into
          // several accounts could be bounced with a 401 "malformed request"
          // ("Can't sign in to …: Request canceled") or, worse, silently
          // approve with their PERSONAL Gmail, which no membership row
          // matches. `select_account` makes them pick every time; `consent`
          // stays because it is what returns a refresh token.
          prompt: "select_account consent",
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
