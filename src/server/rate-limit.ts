import "server-only";
import crypto from "node:crypto";
import { db } from "@/lib/supabase";

/** The caller's IP as Vercel's edge reports it ("unknown" outside a request). */
export async function clientIp(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/** One atomic hourly bucket (`bump_rate_bucket`, migration 0030) keyed by a
 *  HASH of the subject, so no address or IP is stored in app_settings.
 *  FAILS OPEN, like every other use of that RPC: a broken counter must never
 *  be the thing that stops the LC signing in. */
export async function underHourlyLimit(
  scope: string,
  subject: string,
  limit: number
): Promise<boolean> {
  try {
    const hash = crypto.createHash("sha256").update(subject).digest("hex").slice(0, 16);
    const k = `${scope}:${hash}:${new Date().toISOString().slice(0, 13)}`;
    const { data, error } = await db().rpc("bump_rate_bucket", { k });
    if (error) {
      console.error(`[rate] ${scope} bucket failed:`, error.message);
      return true;
    }
    return ((data as number | null) ?? 0) <= limit;
  } catch (e) {
    console.error(`[rate] ${scope} check failed:`, e);
    return true;
  }
}

/** PASSWORD GUESSES COST SOMETHING (v37.7). Ten tries per identifier and a
 *  hundred per network an hour — no member signing in gets near either, and
 *  guessing eighty passwords stops being a loop. Checked inside `authorize`, so
 *  it covers the login action AND a direct POST to the Auth.js callback. */
export async function passwordAttemptAllowed(identifier: string): Promise<boolean> {
  const ip = await clientIp();
  const [byIp, byId] = await Promise.all([
    underHourlyLimit("pwip", ip, 100),
    underHourlyLimit("pwid", identifier, 10),
  ]);
  return byIp && byId;
}
