/** Typed access to server env vars. Everything is optional at build time so the
 *  app compiles without secrets; integrations degrade gracefully and report
 *  what is missing instead of crashing. */
export const env = {
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  googleClientId: process.env.AUTH_GOOGLE_ID ?? "",
  googleClientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
  gmailSender: process.env.GMAIL_SENDER ?? "",
  gmailSenderName: process.env.GMAIL_SENDER_NAME ?? "Sodio · AIESEC in Alexandria",
  gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN ?? "",
  serviceAccountKeyBase64: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 ?? "",
  driveFolderId: process.env.DRIVE_FOLDER_ID ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  adminEmails: (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};

export function requireEnv(...keys: (keyof typeof env)[]): string | null {
  for (const key of keys) {
    const v = env[key];
    if (v === "" || (Array.isArray(v) && v.length === 0)) {
      return `Missing environment variable for "${String(key)}" — see .env.example`;
    }
  }
  return null;
}
