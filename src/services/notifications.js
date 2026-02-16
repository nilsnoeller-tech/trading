// ─── Notification Service ───
// Lokale Browser-Benachrichtigungen + Web Push Subscription Management.

const PROXY_BASE = "https://ncapital-market-proxy.nils-noeller.workers.dev";
const COOLDOWN_MS = 60 * 60 * 1000; // 1 Stunde pro Symbol
const notifiedRecently = new Map();

// ─── Local Notification API (unchanged) ───

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function getNotificationStatus() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission; // "default", "granted", "denied"
}

export function sendNotification(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  // Rate-Limit: max 1 pro Symbol pro Stunde
  if (tag && notifiedRecently.has(tag)) {
    const lastTime = notifiedRecently.get(tag);
    if (Date.now() - lastTime < COOLDOWN_MS) return;
  }

  try {
    const n = new Notification(title, {
      body,
      icon: "/ncapital-app/icons/icon-192.png",
      badge: "/ncapital-app/icons/icon-192.png",
      tag: tag || "watchlist",
      silent: false,
    });
    if (tag) notifiedRecently.set(tag, Date.now());

    // Auto-Close nach 10 Sekunden
    setTimeout(() => n.close(), 10000);
  } catch {
    // Notification fehlgeschlagen (z.B. Service Worker Kontext)
  }
}

export function checkAndNotify(scanResults, thresholds = { swing: 70, intraday: 75 }) {
  if (!scanResults || Notification.permission !== "granted") return;

  for (const result of scanResults) {
    const { displaySymbol, swing, intraday, price, currency } = result;

    if (swing.total >= thresholds.swing) {
      const topSignals = swing.signals.slice(0, 3).join(" + ");
      sendNotification(
        `${displaySymbol} Swing-Setup (Score: ${swing.total})`,
        `${price.toFixed(2)} ${currency} — ${topSignals || "Starkes Signal"}`,
        `swing-${displaySymbol}`
      );
    }

    if (intraday.total >= thresholds.intraday) {
      const topSignals = intraday.signals.slice(0, 3).join(" + ");
      sendNotification(
        `${displaySymbol} Intraday-Signal (Score: ${intraday.total})`,
        `${price.toFixed(2)} ${currency} — ${topSignals || "Starkes Signal"}`,
        `intraday-${displaySymbol}`
      );
    }
  }
}

// ─── Web Push Subscription Management ───

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getVapidPublicKey() {
  const resp = await fetch(`${PROXY_BASE}/api/push/vapid-public-key`);
  const data = await resp.json();
  return data.key;
}

export async function subscribeToPush(symbols, thresholds) {
  // 1. Ensure notification permission (caller should request first for user-gesture context)
  if (Notification.permission !== "granted") {
    const granted = await requestNotificationPermission();
    if (!granted) return null;
  }

  // 2. Get VAPID key from server
  const vapidKey = await getVapidPublicKey();

  // 3. Subscribe via Push Manager
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  // 4. Send subscription + watchlist to server
  await fetch(`${PROXY_BASE}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      symbols: symbols || [],
      thresholds: thresholds || { swing: 70, intraday: 75 },
    }),
  });

  return subscription;
}

export async function unsubscribeFromPush() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const endpoint = subscription ? subscription.endpoint : null;
    if (subscription) {
      await subscription.unsubscribe();
    }
    // Send endpoint so server only removes THIS device
    await fetch(`${PROXY_BASE}/api/push/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch (e) {
    console.warn("Unsubscribe failed:", e);
  }
}

export async function getPushSubscriptionStatus() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

export async function syncWatchlistToServer(symbols, thresholds) {
  try {
    await fetch(`${PROXY_BASE}/api/push/watchlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbols,
        thresholds: thresholds || { swing: 70, intraday: 75 },
      }),
    });
  } catch (e) {
    console.warn("Watchlist sync failed:", e);
  }
}

export async function sendTestPush() {
  try {
    const resp = await fetch(`${PROXY_BASE}/api/push/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
}

export async function getPushServerStatus() {
  try {
    const resp = await fetch(`${PROXY_BASE}/api/push/status`);
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Index Scanner API ───

export async function getScanResults() {
  try {
    const resp = await fetch(`${PROXY_BASE}/api/scan/results`);
    return await resp.json();
  } catch (e) {
    return { results: [], count: 0, error: e.message };
  }
}

export async function getScanStatus() {
  try {
    const resp = await fetch(`${PROXY_BASE}/api/scan/status`);
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
}

export async function updateScanConfig(config) {
  try {
    const resp = await fetch(`${PROXY_BASE}/api/scan/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
}
