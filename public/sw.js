/*
 * Service worker for phone alerts (web push). Registered by the "Phone alerts" row of the side panel.
 * push: shows the message from src/lib/server/push.ts ({ title, body, tag, url }); the tag is market + plan, so a newer
 * alert for the same market and plan replaces the older one. Tap: focus the open app, or open it.
 * No offline cache on purpose: advice must always be live.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Advisor";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png", // monochrome: Android shows only its shape in the status bar
      tag: data.tag || "advisor",
      renotify: true,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
