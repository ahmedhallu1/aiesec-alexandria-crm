import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { db } from "./supabase";
import { sendEmail } from "./google/gmail";
import { welcomeEmail } from "./email/templates";
import { phoneSessionKey, type Member } from "./types";

async function findMember(email: string): Promise<Member | null> {
  const { data: member } = await db()
    .from("members")
    .select("*")
    .ilike("email", email)
    .maybeSingle<Member>();
  return member && member.is_active ? member : null;
}

/** Password sign-in accepts the AIESEC email OR the member's phone number. */
async function findMemberByIdentifier(identifier: string): Promise<Member | null> {
  if (identifier.includes("@")) return findMember(identifier);
  const digits = identifier.replace(/\D/g, "");
  if (digits.length < 7) return null;
  const { data } = await db()
    .from("members")
    .select("*")
    .not("phone", "is", null)
    .ilike("phone", `%${digits.slice(-8)}%`)
    .limit(10);
  const candidates = ((data ?? []) as Member[]).filter((m) => m.is_active);
  // exact full-digit match first — tail matching is only a typing convenience
  const exact = candidates.find((m) => (m.phone ?? "").replace(/\D/g, "") === digits);
  if (exact) return exact;
  const tail = digits.slice(-9);
  return (
    candidates.find((m) => {
      const md = (m.phone ?? "").replace(/\D/g, "");
      return md.endsWith(tail) || tail.endsWith(md.slice(-9));
    }) ?? null
  );
}

function markFirstLogin(member: Member) {
  if (member.first_login_at) return;
  db()
    .from("members")
    .update({ first_login_at: new Date().toISOString() })
    .eq("id", member.id)
    .then(() => {
      if (member.email) {
        const mail = welcomeEmail(member);
        sendEmail({ to: [member.email], ...mail }).catch((e) =>
          console.error("[auth] welcome email failed:", e)
        );
      }
      import("@/server/notify").then(({ notifyMembers }) =>
        notifyMembers(
          [member.id],
          "welcome",
          "Welcome to Sodio 🎉",
          "Sodio is yours — the Blue Man walks beside you from here."
        )
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
        // "email" carries the identifier: AIESEC email OR phone number
        const identifier = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!identifier || !password) return null;
        try {
          const member = await findMemberByIdentifier(identifier);
          if (!member) return null;
          // FIRST sign-in must be with Google (it grants the calendar access
          // the CRM needs) — password login only works once a password exists.
          // The emailed "forgot password" temp password is accepted alongside
          // the member's own password until they change it.
          const okOwn = member.password_hash
            ? await bcrypt.compare(password, member.password_hash)
            : false;
          const okTemp = member.temp_password_hash
            ? await bcrypt.compare(password, member.temp_password_hash)
            : false;
          // Members WITHOUT an AIESEC email (v24): until they set a real
          // password, their phone works in BOTH fields — identifier AND
          // password. Once an email lands on their row, this door closes and
          // the login form tells them to sign in with Google instead.
          const pwDigits = password.replace(/\D/g, "");
          const phoneDigits = (member.phone ?? "").replace(/\D/g, "");
          const okPhoneAsPassword =
            !member.email &&
            !member.password_hash &&
            pwDigits.length >= 7 &&
            phoneDigits.length >= 7 &&
            phoneDigits.length <= 15 &&
            (phoneDigits.endsWith(pwDigits.slice(-9)) ||
              pwDigits.endsWith(phoneDigits.slice(-9)));
          if (!okOwn && !okTemp && !okPhoneAsPassword) return null;
          markFirstLogin(member);
          return {
            // no email → a synthetic phone-keyed session identity
            email: member.email ?? phoneSessionKey(member.phone ?? ""),
            name: member.name,
            image: member.avatar_url || member.photo_url,
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
        if (!member) {
          // deactivated members get the dedicated screen (unknown → denied)
          const { data } = await db()
            .from("members")
            .select("is_active")
            .ilike("email", email)
            .maybeSingle<{ is_active: boolean }>();
          return data && !data.is_active ? "/inactive" : false;
        }

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
          sendEmail({ to: [member.email ?? email], ...mail }).catch((e) =>
            console.error("[auth] welcome email failed:", e)
          );
          import("@/server/notify").then(({ notifyMembers }) =>
            notifyMembers(
              [member.id],
              "welcome",
              "Welcome to Sodio 🎉",
              "Sodio is yours — the Blue Man walks beside you from here."
            )
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
