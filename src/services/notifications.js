// ─── Browser Notification Service ───
// Sendet lokale Browser-Benachrichtigungen bei interessanten Watchlist-Signalen.
// Kein Backend noetig — nutzt die Notification API direkt.

const COOLDOWN_MS = 60 * 60 * 1000; // 1 Stunde pro Symbol
const notifiedRecently = new Map();

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
