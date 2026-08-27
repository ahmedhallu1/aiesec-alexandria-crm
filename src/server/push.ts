import "server-only";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sandboxSuppressed } from "@/server/sandbox";

/** WEB PUSH — the bell, on the phone (v35).
 *
 *  Sodio's bell has rung inside an open tab since v8, which meant anything
 *  that actually needed somebody's attention had to travel by email, and the
 *  email volume is the thing the floor complains about. This is the other
 *  channel: a notification that arrives on a locked phone.
 *
 *  THE ANDROID APP IS THE SAME PATH. The Play build is a Trusted Web Activity
 *  wrapping sodio.vercel.app, and Bubblewrap's notification delegation hands
 *  the site's web-push notifications to the app's own tray. So there is no
 *  second sender to keep in sync, no FCM key to rotate, and a member on a
 *  laptop and a member on the app are served by one call.
 *
 *  Best-effort by construction: a failed push must never break the action
 *  that raised the notification. Every caller goes through `notifyMembers`,
 *  which owns the actor guard and the sandbox check.
 */

export interface PushMessage {
  title: string;
  body?: string | null;
  /** in-app path the notification opens — the same `link` the bell uses */
  url?: string | null;
  /** collapses notifications that supersede one another; omit to stack */
  tag?: string | null;
}

/** Is push wired up at all? Everything degrades to "the bell only" without it,
 *  and the health card says so rather than failing silently. */
export function pushConfigured(): boolean {
  return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one message to every device those members have registered.
 *
 *  Returns what actually happened — `sent` devices reached, `gone` devices
 *  pruned — because "we sent 40 notifications" and "40 people were reached"
 *  are different claims and the admin card must not confuse them. */
export async function sendPushToMembers(
  memberIds: string[],
  msg: PushMessage
): Promise<{ sent: number; failed: number; gone: number }> {
  const ids = [...new Set(memberIds)].filter(Boolean);
  const none = { sent: 0, failed: 0, gone: 0 };
  if (ids.length === 0 || !pushConfigured()) return none;
  // a test view must never make somebody's phone buzz — the v21 rule
  if (await sandboxSuppressed(`push "${msg.title}" → ${ids.length} member(s)`)) return none;

  const { data, error } = await db()
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("member_id", ids);
  if (error) {
    console.error("[push] could not read subscriptions:", error.message);
    return none;
  }
  const subs = (data ?? []) as SubRow[];
  if (subs.length === 0) return none;

  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(
    env.vapidSubject || `mailto:${env.gmailSender || "sodio@aiesec.net"}`,
    env.vapidPublicKey,
    env.vapidPrivateKey
  );

  const payload = JSON.stringify({
    title: msg.title,
    body: msg.body ?? "",
    url: msg.url ?? "/",
    tag: msg.tag ?? undefined,
  });

  const dead: string[] = [];
  let sent = 0;
  let failed = 0;
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        // 12 hours: a phone that has been off all morning still gets it, and
        // nothing older than that is news worth waking somebody for
        { TTL: 60 * 60 * 12, urgency: "normal" }
      )
    )
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      sent++;
      continue;
    }
    // 404/410 = THE SUBSCRIPTION IS DEAD (permission revoked, app removed,
    // browser data cleared). It will never work again, so it is deleted here
    // rather than retried forever — this is the only way the table stays
    // honest about how many devices Sodio can actually reach.
    const code = (r.reason as { statusCode?: number } | undefined)?.statusCode;
    if (code === 404 || code === 410) dead.push(subs[i].id);
    else {
      failed++;
      console.error("[push] send failed:", code ?? r.reason);
    }
  }
  if (dead.length > 0) {
    await db().from("push_subscriptions").delete().in("id", dead);
  }
  return { sent, failed, gone: dead.length };
}
