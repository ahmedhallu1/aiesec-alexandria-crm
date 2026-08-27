/** WEB PUSH, ON THE BROWSER SIDE (v35).
 *
 *  The three things a page has to do to receive a notification — register the
 *  worker, ask for permission, mint a subscription — kept in one place so the
 *  settings toggle and the silent re-sync in the app shell cannot drift apart.
 *
 *  Everything here is guarded: an unsupported browser, a blocked permission or
 *  a missing VAPID key each resolve to null rather than throwing, because none
 *  of them is an error — they are just "no push on this device", and the UI
 *  says which one it is.
 */

export const PUSH_SW_PATH = "/sw.js";

/** The public half of the VAPID pair, inlined at build time. Empty means push
 *  was never configured for this deployment. */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** granted · denied · default ("not asked yet"), or null when unsupported. */
export function pushPermission(): NotificationPermission | null {
  return pushSupported() ? Notification.permission : null;
}

/** The VAPID key travels as URL-safe base64 and `subscribe()` wants bytes. */
function urlBase64ToBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function registerPushWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(PUSH_SW_PATH, { scope: "/" });
  } catch (e) {
    console.error("[push] worker registration failed:", e);
    return null;
  }
}

/** Flattens a live subscription into what the server stores. */
export function toInput(sub: PushSubscription): PushSubscriptionInput | null {
  const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return {
    endpoint: json.endpoint,
    p256dh,
    auth,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
  };
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(PUSH_SW_PATH);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks for permission (needs a real click behind it) and mints the
 *  subscription. Returns null when the member says no, or when the browser
 *  refuses — the caller reads `pushPermission()` to tell those apart. */
export async function subscribeToPush(): Promise<PushSubscriptionInput | null> {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return null;
  const reg = (await registerPushWorker()) ?? (await navigator.serviceWorker.ready);
  if (!reg) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const existing = await reg.pushManager.getSubscription();
  // A KEY CHANGE MEANS THE OLD SUBSCRIPTION IS UNUSABLE. `subscribe()` throws
  // rather than re-keying, so an existing one minted under a different VAPID
  // key has to go first — otherwise rotating the key would lock every device
  // that ever subscribed out of notifications for good, silently.
  if (existing) {
    const same =
      existing.options?.applicationServerKey &&
      bytesEqual(
        new Uint8Array(existing.options.applicationServerKey as ArrayBuffer),
        urlBase64ToBytes(VAPID_PUBLIC_KEY)
      );
    if (same) return toInput(existing);
    await existing.unsubscribe().catch(() => {});
  }

  const sub = await reg.pushManager.subscribe({
    // required by Chrome: every push MUST show a notification. Sodio has no
    // reason to want a silent one anyway.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY) as BufferSource,
  });
  return toInput(sub);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
