// WeGood? service worker.
//
// The browser keeps this small script installed for our site and can wake it up
// even when the app is closed. It has two jobs: show a notification when a push
// arrives, and open the right screen when the notification is tapped.
// (Plain JavaScript on purpose: the browser loads this file directly, it does
// not go through the Next.js build.)

// Take over straight away instead of waiting for every old tab to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: fall back to the defaults below.
  }

  // waitUntil keeps the worker alive until the notification is on screen.
  // Browsers require every push to show one (that is what "userVisibleOnly"
  // promised when subscribing), so there is always a fallback title.
  event.waitUntil(
    self.registration.showNotification(data.title || "WeGood?", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Same tag = the new one replaces the old one instead of stacking up.
      tag: data.kind || "wegood",
      renotify: true,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Resolve against our own origin so a notification can never open another site.
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open WeGood? window if there is one, otherwise open a new one.
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if (client.url !== target.href && "navigate" in client) {
            await client.navigate(target.href).catch(() => {});
          }
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
