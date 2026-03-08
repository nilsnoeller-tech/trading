// ─── Custom Service Worker ───
// Workbox Precaching + Runtime Caching + Web Push Handler

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

// Workbox precaching (manifest injected by vite-plugin-pwa at build time)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ─── Runtime Caching (same rules as previous generateSW config) ───

registerRoute(
  /^https:\/\/api\.frankfurter\.(app|dev)\/.*/i,
  new NetworkFirst({
    cacheName: "fx-api",
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 86400 })],
  })
);

registerRoute(
  /^https:\/\/ncapital-market-proxy\..*\.workers\.dev\/.*/i,
  new NetworkFirst({
    cacheName: "market-data-api",
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 14400 })],
  })
);

registerRoute(
  /^https:\/\/finviz\.com\/chart\.ashx\?.*/i,
  new CacheFirst({
    cacheName: "finviz-charts",
    plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 3600 })],
  })
);

// ─── Push Event Handler ───

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "N-Capital", body: event.data.text() };
  }

  const title = data.title || "N-Capital Alert";
  const options = {
    body: data.body || "",
    icon: "/trading/icons/icon-192.png",
    badge: "/trading/icons/icon-192.png",
    tag: data.tag || "watchlist",
    data: { url: data.url || "/trading/" },
    vibrate: [200, 100, 200],
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification Click Handler ───

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/trading/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Focus existing tab if open
        for (const client of windowClients) {
          if (client.url.includes("/trading/") && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open new tab
        return clients.openWindow(url);
      })
  );
});

// Skip waiting + claim clients immediately so updates take effect without closing tabs
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
