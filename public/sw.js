/* SODIO'S SERVICE WORKER — PUSH, AND NOTHING ELSE (v35).
 *
 * It exists for one reason: a browser will only deliver a push notification
 * to a service worker, so Sodio needs one to reach a phone at all. The same
 * worker serves the Android app — the Play build is a Trusted Web Activity
 * around sodio.vercel.app, and its notifications are these ones handed to the
 * app's own tray.
 *
 * ⚠️ THERE IS DELIBERATELY NO `fetch` HANDLER AND NO CACHING. Every page in
 * Sodio is per-member and auth-gated; a caching service worker over that is
 * how one member ends up looking at another member's cached accounts list, or
 * at a page from before they were deactivated. Offline support, if it is ever
 * wanted, is a separate decision with its own scoping — not a side effect of
 * wanting notifications.
 */

self.addEventListener("install", () => {
  // take over immediately — a member who just enabled notifications should
  // not have to close every tab before the first one can arrive
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // a payload we can't read is still worth showing as something
    data = { title: "Sodio", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Sodio";
  const url = data.url || "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // the path travels on the notification, so the click knows where to go
      data: { url },
      // omitted unless the sender means "this replaces the last one" — a tag
      // silently collapses notifications, and a missed one is worse than two
      ...(data.tag ? { tag: data.tag } : {}),
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // REUSE A WINDOW THAT IS ALREADY OPEN rather than stacking a new one on
      // every tap — in the installed app there is only ever one, and opening a
      // second is what makes an app feel broken.
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              /* cross-origin or not allowed — the focus is still the right move */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});
